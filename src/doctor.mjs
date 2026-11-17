// 插件体检：把「装没装好、缺什么」压成一屏，不用去翻日志。
//
// 设计原则：
// - 只读，不改任何设置、不动客户端、不发请求（加 --online 才会做两个小的网络探测）。
// - 每一行都是「状态 + 事实 + 下一步」，缺 key 这类可选项不算失败，只有真会挡住流程的才标红。
// - 中文标签要按显示宽度补齐（CJK 算 2 格），不然终端里对不齐，看着像坏了。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');

const ICON = { ok: '✓', warn: '!', fail: '✗', skip: '·' };
const COLOR = { ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m', skip: '\x1b[90m', dim: '\x1b[90m', head: '\x1b[36m', reset: '\x1b[0m' };

/** 终端显示宽度：CJK / 全角算 2 格 */
function width(s) {
  let w = 0;
  for (const ch of String(s)) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return w;
}
function padTo(s, w) {
  const n = w - width(s);
  return n > 0 ? s + ' '.repeat(n) : s;
}

function row(group, name, state, detail, hint) {
  return { group, name, state, detail: String(detail || ''), hint: String(hint || '') };
}

const exists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

function cookies(str) {
  const out = {};
  for (const part of String(str || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function countFiles(dir, filter) {
  try {
    return fs.readdirSync(dir).filter(filter).length;
  } catch {
    return 0;
  }
}

/** 自己找 ffmpeg，而不是 import engine（engine 顶层就 import canvas，缺 canvas 时连 ffmpeg 都测不了） */
function detectFfmpeg(root) {
  const env = process.env.DIARY_FFMPEG;
  if (env && exists(env)) return env;
  const vendored = path.join(root, 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (exists(vendored)) return vendored;
  try {
    const sys = execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)[0]
      .trim();
    if (sys) return sys;
  } catch {}
  try {
    const py = execSync('python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (py && exists(py)) return py;
  } catch {}
  return '';
}

export async function runDoctor(root = ROOT, { online = false } = {}) {
  const checks = [];
  const S = await import('./settings.mjs');
  const settings = S.loadSettings(root);
  const view = S.publicView(settings);

  /* ---------- 环境 ---------- */
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(
    row('环境', 'Node', major >= 22 ? 'ok' : 'fail', process.versions.node, major >= 22 ? '' : '插件要求 Node ≥ 22（用到 node:sqlite 与内置 fetch）'),
  );

  checks.push(row('环境', 'ffmpeg', 'pending', '', ''));
  let ffmpegPath = '';
  try {
    ffmpegPath = detectFfmpeg(root);
  } catch {}
  checks[checks.length - 1] = ffmpegPath
    ? row('环境', 'ffmpeg', 'ok', ffmpegPath)
    : row('环境', 'ffmpeg', 'fail', '找不到', 'node scripts/get-ffmpeg.mjs 一键补（或设 DIARY_FFMPEG，装完插件这一步很常见）');

  checks.push(row('环境', '画布库', 'pending', '', ''));
  try {
    await import('@napi-rs/canvas');
    checks[checks.length - 1] = row('环境', '画布库', 'ok', '@napi-rs/canvas');
  } catch {
    checks[checks.length - 1] = row('环境', '画布库', 'warn', '未安装', '只有装进 dsh 才具备；单独在源码目录跑渲染要先 npm i');
  }

  let settingsWritable = false;
  try {
    fs.mkdirSync(path.dirname(view.file), { recursive: true });
    fs.accessSync(view.file, fs.constants.W_OK);
    settingsWritable = true;
  } catch {
    settingsWritable = !exists(view.file) ? false : true;
  }
  checks.push(
    row(
      '环境',
      '设置文件',
      settingsWritable || !exists(view.file) ? 'ok' : 'fail',
      path.relative(os.homedir(), view.file) || view.file,
    ),
  );

  /* ---------- 账号 ---------- */
  const okCookie = String(process.env.BILI_COOKIE || settings.keys.bili || '');
  const ck = cookies(okCookie);
  const hasSess = Boolean(ck.SESSDATA);
  const hasJct = Boolean(ck.bili_jct);
  const hasBuvid = Boolean(ck.buvid3);
  if (!okCookie) {
    checks.push(row('账号', 'B 站登录态', 'skip', '未配置', 'node scripts/qr-login.mjs --write 扫码一次即可'));
  } else if (hasSess && hasJct) {
    checks.push(row('账号', 'B 站登录态', 'ok', `SESSDATA 等 ${Object.keys(ck).length} 项${hasBuvid ? '（含 buvid3）' : '（缺 buvid3）'}`, hasBuvid ? '' : '可以补 buvid3，否则接口可能报 -412'));
  } else {
    checks.push(row('账号', 'B 站登录态', 'fail', `缺 ${[!hasSess && 'SESSDATA', !hasJct && 'bili_jct'].filter(Boolean).join(' / ')}`, '重跑 node scripts/qr-login.mjs --write'));
  }

  /* ---------- 发布环境 ---------- */
  const client = process.env.DIARY_BILI_CLIENT || 'C:\\Program Files\\bilibili\\哔哩哔哩.exe';
  checks.push(
    exists(client)
      ? row('发布', '客户端', 'ok', client)
      : row('发布', '客户端', 'warn', '没找到', '装了哔哩哔哩客户端才能走 GUI 投稿；只发评论可以用接口路线'),
  );

  /* ---------- 内容 ---------- */
  let tplCount = 0;
  try {
    const T = await import('./templates.mjs');
    tplCount = T.TEMPLATE_IDS.length;
  } catch {}
  checks.push(row('内容', '版面模板', tplCount ? 'ok' : 'warn', `${tplCount} 套`));

  let plateCount = 0;
  let plateDirs = [];
  try {
    plateDirs = fs.readdirSync(path.join(root, 'assets', 'plates'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    plateCount = plateDirs.length;
  } catch {}
  const plateList = plateDirs.length > 6 ? `${plateDirs.slice(0, 6).join(' / ')} …` : plateDirs.join(' / ');
  checks.push(row('内容', '动态底板', plateCount ? 'ok' : 'warn', `${plateCount} 套${plateList ? '：' + plateList : ''}`));

  const portraits = countFiles(path.join(root, 'assets', 'characters', 'transparent'), (f) => f.endsWith('.png'));
  const variants = countFiles(path.join(root, 'assets', 'characters', 'transparent', 'variants'), (f) => f.endsWith('.png'));
  checks.push(row('内容', '立绘', portraits ? 'ok' : 'warn', `${portraits} 张基础 + ${variants} 张变体`));

  const motions = countFiles(path.join(root, 'assets', 'characters', 'motion'), (f) => f.endsWith('.mp4'));
  checks.push(row('内容', '角色短片', motions ? 'ok' : 'skip', motions ? `${motions} 段` : '还没收', motions ? '' : 'node bin/ai-diary.mjs motion --action import --from <视频>'));

  let topicCount = 0;
  try {
    const TP = await import('./topics.mjs');
    topicCount = TP.loadTopics().length;
  } catch {}
  checks.push(row('内容', '题材库', topicCount ? 'ok' : 'fail', `${topicCount} 条`));

  // 成片规格：默认 1.5× 超采样（逻辑 720×1280 → 真实 1080×1920），渲染前就知道会出多大
  const spec = settings.render || {};
  const ss = Number(spec.scale ?? 1.5) || 1.5;
  const w = Math.round(720 * ss);
  const h = Math.round(1280 * ss);
  const fps = Number(spec.fps ?? 24) || 24;
  checks.push(
    row(
      '内容',
      '成片规格',
      'ok',
      `${w}×${h} @${fps}fps（超采样 ${ss}×）`,
      ss < 1.5 ? '想要 1080p 就把 render.scale 设回 1.5（或用 --scale 1.5）' : '',
    ),
  );

  /* ---------- 定时 ---------- */
  const sch = settings.schedule || {};
  checks.push(
    row(
      '定时',
      '每日出片',
      sch.enabled ? 'ok' : 'skip',
      sch.enabled ? `${sch.dailyAt} · 出片${sch.make ? '✓' : '✗'} 配音${sch.voice ? '✓' : '✗'} 投稿${sch.publish ? '✓' : '✗'}` : '未开启',
      sch.enabled ? '' : '在设置面板打开，或 node bin/ai-diary.mjs schedule --action enable --at 20:30',
    ),
  );
  if (sch.lastRun) checks.push(row('定时', '上次执行', 'skip', `${sch.lastRun}${sch.lastResult ? ' · ' + String(sch.lastResult).slice(0, 60) : ''}`));

  /* ---------- 在线（可选） ---------- */
  if (online) {
    if (okCookie && hasSess) {
      try {
        const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/', Cookie: okCookie },
          signal: AbortSignal.timeout(8000),
        });
        const j = await res.json();
        checks.push(
          j.code === 0
            ? row('在线', 'B 站登录校验', 'ok', `${j.data.uname}（UID ${j.data.mid}）`)
            : row('在线', 'B 站登录校验', 'fail', `code ${j.code} ${j.message || ''}`, j.code === -101 ? 'Cookie 失效，重跑 qr-login' : ''),
        );
      } catch (e) {
        checks.push(row('在线', 'B 站登录校验', 'warn', '请求失败', e.message));
      }
    }

    const comfy = String(settings.comfy?.base || 'http://127.0.0.1:8188');
    try {
      const res = await fetch(`${comfy.replace(/\/$/, '')}/system_stats`, { signal: AbortSignal.timeout(3000) });
      checks.push(res.ok ? row('在线', 'ComfyUI', 'ok', comfy) : row('在线', 'ComfyUI', 'warn', `HTTP ${res.status}`, '没开也能用，只是本地出图不可用'));
    } catch {
      checks.push(row('在线', 'ComfyUI', 'skip', '没连上', `确认 ${comfy} 是否在跑`));
    }

    try {
      const U = await import('./update.mjs');
      const r = await U.checkUpdate(root);
      checks.push(
        row('在线', '版本', 'ok', r && r.hasUpdate ? `有新版本 ${r.latest}` : `已是最新（${U.readLocalVersion(root)}）`, r && r.hasUpdate ? 'node bin/ai-diary.mjs update --action check' : ''),
      );
    } catch (e) {
      checks.push(row('在线', '版本', 'warn', '查不到', String(e.message).slice(0, 80)));
    }
  }

  const tally = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) tally[c.state] = (tally[c.state] || 0) + 1;
  const hints = [];
  for (const c of checks) if (c.hint) hints.push(`${c.group}·${c.name}：${c.hint}`);

  return {
    ok: tally.fail === 0,
    version: (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
      } catch {
        return '?';
      }
    })(),
    root,
    tally,
    checks,
    hints,
  };
}

/** 把体检结果画成一屏；color=false 时不带 ANSI（写文件/日志用） */
export function renderDoctor(report, { color = true } = {}) {
  const c = (k, s) => (color ? `${COLOR[k] || ''}${s}${COLOR.reset}` : s);
  const lines = [];
  const total = report.checks.length;
  const headline = `${report.tally.ok}/${total} 通过` + (report.tally.fail ? `，${report.tally.fail} 项会挡路` : '，没有硬故障');
  lines.push(c('head', `AI 日记工坊 ${report.version} · 体检`));
  lines.push(c('dim', '─'.repeat(Math.min(56, width(headline) + 18))));
  lines.push(
    `${c(report.tally.fail ? 'fail' : 'ok', report.tally.fail ? '✗' : '✓')} ${headline}` +
      c('dim', `（未配置 ${report.tally.skip}，注意 ${report.tally.warn}）`),
  );

  let group = '';
  for (const chk of report.checks) {
    if (chk.group !== group) {
      group = chk.group;
      lines.push('');
      lines.push(c('head', `[${group}]`));
    }
    const icon = c(chk.state, ICON[chk.state] || '·');
    const name = padTo(chk.name, 16);
    const detail = chk.detail ? `  ${chk.state === 'skip' ? c('dim', chk.detail) : chk.detail}` : '';
    lines.push(`  ${icon} ${name}${detail}`);
  }

  if (report.hints.length) {
    lines.push('');
    lines.push(c('head', '[下一步]'));
    for (const h of report.hints) lines.push(`  · ${h}`);
  }
  return lines.join('\n');
}

export { ROOT };
