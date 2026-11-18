// 发布：两种模式
//   client（默认）：走本机哔哩哔哩客户端 —— 定位客户端 → 文案写进剪贴板 + 落一份 .upload.txt → 带视频启动客户端
//   browser：走 Chrome CDP 打开创作中心自动填表（老方案，保留给需要全自动的场景）
// 两种模式都默认 dry-run：不会替用户点「投稿」。发布是对外不可逆动作，最后一下必须人来按。

import { spawn, execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const CLIENT_CANDIDATES = [
  'C:/Program Files/bilibili/哔哩哔哩.exe',
  'C:/Program Files (x86)/bilibili/哔哩哔哩.exe',
  'C:/Program Files/哔哩哔哩/哔哩哔哩.exe',
];

export const UPLOAD_URL = 'https://member.bilibili.com/platform/upload/text/edit';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 客户端模式 ---------------- */

function findClient() {
  if (process.env.DIARY_BILI_CLIENT && fs.existsSync(process.env.DIARY_BILI_CLIENT)) return process.env.DIARY_BILI_CLIENT;
  for (const p of CLIENT_CANDIDATES) if (fs.existsSync(p)) return p;
  // 兜底：读注册表里的安装位置
  if (process.platform === 'win32') {
    try {
      const out = execSync(
        'powershell -NoProfile -Command "Get-ItemProperty HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName -match \'哔哩\' } | Select-Object -First 1 -ExpandProperty DisplayIcon"',
        { encoding: 'utf8' },
      ).trim();
      if (out) {
        const dir = path.dirname(out.replace(/["']/g, '').trim());
        for (const name of ['哔哩哔哩.exe', 'bilibili.exe']) {
          const exe = path.join(dir, name);
          if (fs.existsSync(exe)) return exe;
        }
      }
    } catch { /* 忽略 */ }
  }
  return null;
}

function isRunning(exeName) {
  if (process.platform !== 'win32') return false;
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq ' + exeName + '"', { encoding: 'utf8' });
    return out.includes(exeName);
  } catch { return false; }
}

/** 把文案写进剪贴板（中文走临时文件，避免命令行转义问题） */
function setClipboard(text) {
  if (process.platform !== 'win32' || !text) return false;
  const tmp = path.join(os.tmpdir(), `aidiary-clip-${process.pid}.txt`);
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    execSync(
      'powershell -NoProfile -Command "Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 \'' + tmp + '\')"',
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** 文案落盘成 sidecar，客户端崩了也不丢 */
function writeSidecar(video, { title, desc, tags }) {
  const file = video.replace(/\.mp4$/i, '') + '.upload.txt';
  const body = [
    '# 哔哩哔哩投稿文案（复制粘贴用）',
    '',
    '[标题]',
    title || '',
    '',
    '[简介]',
    desc || '',
    '',
    '[标签]',
    (tags || []).join('  '),
    '',
    '[视频文件]',
    video,
    '',
  ].join('\n');
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

/** 找 ffmpeg：插件自带的优先，再看环境变量和 PATH（不 import engine，免得连带 canvas 依赖） */
function findFfmpegQuick() {
  const env = process.env.DIARY_FFMPEG;
  if (env && fs.existsSync(env)) return env;
  const v = path.join(ROOT, 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(v)) return v;
  try {
    const line = String(execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      .split(/\r?\n/)[0]
      .trim();
    if (line) return line;
  } catch {}
  return null;
}

/**
 * 上传前自检：分辨率、画面比例、时长、体积。
 * 1080p 之后这条最有用 —— 别把旧 720p 的片子当新规格投出去，白掉一次推荐。
 */
export function preflight(video) {
  const abs = path.resolve(video);
  if (!fs.existsSync(abs)) return { ok: false, issues: ['视频文件不存在：' + abs], info: null };
  const ff = findFfmpegQuick();
  if (!ff) return { ok: true, issues: [], info: null, note: '没找到 ffmpeg，跳过规格检查' };

  let dump = '';
  try {
    dump = String(execFileSync(ff, ['-hide_banner', '-i', abs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    dump = String((e && (e.stderr || e.stdout)) || '');
  }
  const dur = dump.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const vid = dump.match(/Video: .*?(\d{2,5})x(\d{2,5})/);
  const mb = fs.statSync(abs).size / 1048576;
  const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null;
  const width = vid ? Number(vid[1]) : null;
  const height = vid ? Number(vid[2]) : null;

  const issues = [];
  if (!width || !height) issues.push('读不到分辨率');
  else {
    const ar = width / height;
    const is169 = Math.abs(ar - 16 / 9) <= 0.08;
    const is916 = Math.abs(ar - 9 / 16) <= 0.05;
    if (!is169 && !is916) issues.push(`画面比例不是 16:9 横屏或 9:16 竖屏（${width}×${height}）`);
    if (Math.min(width, height) < 720) issues.push(`分辨率只有 ${width}×${height}，不到 720p —— 旧片重投会掉清晰度`);
  }
  if (seconds !== null && seconds < 8) issues.push(`时长只有 ${seconds}s，太短容易被判低质`);
  if (mb > 8000) issues.push(`体积 ${Math.round(mb)}MB，超过 B 站单文件上限（约 8GB）`);

  return {
    ok: issues.length === 0,
    issues,
    info: { width, height, seconds, mb: Math.round(mb) },
  };
}

export async function publishViaClient({ video, title, desc, tags = [], dryRun = true } = {}) {
  const exe = findClient();
  if (!exe) {
    return {
      ok: false,
      needsClient: true,
      message: '没找到哔哩哔哩客户端：装好客户端后重试，或用环境变量 DIARY_BILI_CLIENT 指定 exe 路径。',
    };
  }
  const videoAbs = path.resolve(video);
  if (!fs.existsSync(videoAbs)) throw new Error('视频文件不存在: ' + videoAbs);

  const sidecar = writeSidecar(videoAbs, { title, desc, tags });
  const clipOk = setClipboard([title, '', desc, '', (tags || []).join(' ')].join('\n'));
  const pf = preflight(videoAbs);

  const wasRunning = isRunning(path.basename(exe));
  if (!wasRunning) {
    const child = spawn(exe, [videoAbs], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    // 已经在跑就只把文件丢给关联程序，避免开第二个实例
    spawn('cmd', ['/c', 'start', '', videoAbs], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  }
  await sleep(2500);
  const running = isRunning(path.basename(exe));

  return {
    ok: true,
    mode: 'client',
    dryRun,
    client: exe,
    clientRunning: running,
    clipboard: clipOk,
    sidecar,
    preflight: pf,
    message: [
      running ? '哔哩哔哩客户端已打开。' : '已发起启动请求，客户端可能还在加载。',
      clipOk ? '标题+简介+标签已放进剪贴板（Ctrl+V 即可粘贴）。' : '剪贴板写入失败，请用 sidecar 文案。',
      '投稿文案也存到了 ' + path.basename(sidecar) + '。',
      pf.ok
        ? `成片规格：${pf.info && pf.info.width ? `${pf.info.width}×${pf.info.height} / ${pf.info.seconds}s / ${pf.info.mb}MB` : '未读到（跳过检查）'}`
        : `成片规格提醒：${pf.issues.join('；')}`,
      '剩下三步需要你点：客户端里进「投稿 / 上传视频」→ 选中 ' + path.basename(videoAbs) + ' → 粘贴文案后自己点「投稿」。',
      '插件不会替你在客户端里点发布：那是不可逆的对外动作。',
    ].join('\n'),
  };
}

/* ---------------- 浏览器模式（保留） ---------------- */

function findChrome() {
  if (process.env.DIARY_CHROME && fs.existsSync(process.env.DIARY_CHROME)) return process.env.DIARY_CHROME;
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  return 'chrome';
}

async function jsonVersion(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome 调试端口没起来（端口被占用？换 --port）');
}

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
    return this;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 60000);
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面执行出错: ' + (r.exceptionDetails.text || ''));
  return r.result?.value;
}

export async function openStudio({ port = 9222, profileDir, chrome } = {}) {
  const dir = profileDir || path.join(ROOT, '.chrome-profile');
  fs.mkdirSync(dir, { recursive: true });
  const exe = chrome || findChrome();
  const child = spawn(exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    UPLOAD_URL,
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  const ver = await jsonVersion(port);
  const browser = await new CDP(ver.webSocketDebuggerUrl).open();
  let target;
  for (let i = 0; i < 20; i++) {
    const { targetInfos } = await browser.send('Target.getTargets');
    target = targetInfos.find((t) => t.type === 'page' && t.url.includes('member.bilibili.com'));
    if (target) break;
    await sleep(300);
  }
  if (!target) throw new Error('没有找到 B 站创作中心标签页');
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const page = { send: (method, params) => browser.send(method, { ...params, sessionId }) };
  await page.send('Page.enable').catch(() => {});
  await page.send('Runtime.enable').catch(() => {});
  return { browser, page };
}

const fillHelper = `
window.__diaryFill = function(sel, value) {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
              : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value').set : null;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
};
window.__diaryFillEditor = function(value) {
  const box = document.querySelector('.ql-editor, [contenteditable="true"]');
  if (!box) return false;
  box.focus();
  box.innerHTML = value.split('\\n').map(p => '<p>' + p + '</p>').join('');
  box.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
  return true;
};
true;
`;

export async function publishViaBrowser({ video, title, desc, tags = [], dryRun = true, port } = {}) {
  const { page, browser } = await openStudio({ port });
  try {
    await sleep(2500);
    const url = await evaluate(page, 'location.href');
    const loggedIn = !String(url).includes('passport.bilibili.com');
    if (!loggedIn) {
      return {
        ok: false,
        needsLogin: true,
        url,
        message: '这个 Chrome 配置还没登录 B 站：在打开的窗口里扫码登录后再执行一次（配置存在插件目录 .chrome-profile，下次免登）。',
      };
    }
    await evaluate(page, fillHelper);
    const videoAbs = path.resolve(video);
    if (!fs.existsSync(videoAbs)) throw new Error('视频文件不存在: ' + videoAbs);

    const doc = await page.send('DOM.getDocument', { depth: -1, pierce: true });
    const q = await page.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    if (q?.nodeId) await page.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [videoAbs] });

    const titleOk = await evaluate(page, `__diaryFill('input[placeholder*="标题"], input[maxlength="80"]', ${JSON.stringify(title || '')})`);
    const descOk = await evaluate(page, `__diaryFillEditor(${JSON.stringify(desc || '')})`);
    let tagsOk = 0;
    for (const t of (tags || []).slice(0, 10)) {
      const ok = await evaluate(page, `(() => {
        const inp = document.querySelector('input[placeholder*="标签"], input[placeholder*="回车"]');
        if (!inp) return false;
        __diaryFill(inp, ${JSON.stringify(t)});
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        return true;
      })()`);
      if (ok) tagsOk++;
      await sleep(120);
    }
    return {
      ok: true,
      mode: 'browser',
      dryRun,
      videoFileSet: Boolean(q?.nodeId),
      titleFilled: titleOk,
      descFilled: descOk,
      tagsFilled: tagsOk,
      message: dryRun
        ? '已填好标题/简介/标签并挂上视频，页面停在投稿前，请检查封面与分区后自己点「投稿」。'
        : '已填好并尝试提交，请在窗口里确认结果。',
    };
  } finally {
    try { browser.close(); } catch { /* ignore */ }
  }
}

/** 统一入口：mode 默认 client（用户要求不用浏览器） */
export async function publish({ mode = 'client', ...rest } = {}) {
  return mode === 'browser' ? publishViaBrowser(rest) : publishViaClient(rest);
}
