// 联网自更新：查 GitHub Releases → 下载 tgz → 校验 → 交给安装流程。
// 只读公开信息时不需要 token；私有仓库要设 GITHUB_TOKEN。
//
// 配置：config/update.json  { "repo": "owner/name", "asset": "dsh-plugin-ai-diary-*.tgz", "channel": "latest" }
// 接口：https://api.github.com/repos/<repo>/releases/latest
// 下载：browser_download_url（release asset 上限 2GB，我们 200 多 MB 没问题）

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { backupSettings, healSettings } from './settings.mjs';

const API = 'https://api.github.com';

export const DEFAULT_CONFIG = {
  repo: '',
  asset: 'dsh-plugin-ai-diary-*.tgz',
  channel: 'latest',
};

export function loadConfig(root) {
  const f = path.join(root, 'config', 'update.json');
  if (!fs.existsSync(f)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function readLocalVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 比较 semver（含预发布段），返回 -1 / 0 / 1。1.0.0-preview < 1.0.0 < 1.0.1 */
export function compareVersion(a, b) {
  const parse = (v) => {
    const s = String(v || '').replace(/^v/, '').trim();
    const [core, pre = ''] = s.split('-');
    const nums = core.split('.').map((x) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : 0;
    });
    return { nums, pre };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = A.nums[i] || 0;
    const y = B.nums[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1; // 正式版比同号预发布版新
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}

function headers() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-plugin-ai-diary' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function getJSON(url, timeout = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: headers(), signal: ctrl.signal });
    if (res.status === 404) throw new Error('仓库或 release 不存在（404）：' + url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return JSON.parse(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 用 asset 通配匹配 release 里的 tgz，分三类：
 *   - delta：`*-delta-from-<旧版本>.tgz`，只含那一版以来改动过的文件（通常几十 KB）
 *   - code：`*-code.tgz`，只含代码不含素材（几百 KB）
 *   - full：完整包（素材占 224 MB）
 * 升级时能走 delta 就走 delta，跳版本时退到 code，首次安装才用 full。
 */
function matchAsset(assets = [], pattern = DEFAULT_CONFIG.asset) {
  const rx = new RegExp('^' + String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  const shape = (a) => (a ? { name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest || null } : null);
  const fromOf = (a) => {
    const m = /-delta-from-([0-9][^/]*?)\.tgz$/i.exec(a.name || '');
    return m ? m[1] : null;
  };
  const isCode = (a) => /-code\.tgz$/i.test(a.name || '');
  const isDelta = (a) => Boolean(fromOf(a));

  const deltas = assets
    .filter((a) => isDelta(a) && rx.test(a.name))
    .map((a) => ({ from: fromOf(a), ...shape(a) }))
    .sort((x, y) => (compareVersion(y.from, x.from) < 0 ? -1 : 1)); // 越新的 from 越优先

  const full =
    assets.find((a) => rx.test(a.name) && !isCode(a) && !isDelta(a)) ||
    assets.find((a) => /\.tgz$/i.test(a.name || '') && !isCode(a) && !isDelta(a)) ||
    null;
  const code = assets.find((a) => rx.test(a.name) && isCode(a)) || assets.find((a) => isCode(a)) || null;
  return { full: shape(full), code: shape(code), deltas };
}

/**
 * 检查更新：返回 {ok, current, latest, hasUpdate, asset?, release?, reason?}
 * 不下载、不安装。
 */
export async function checkUpdate(root, { repo } = {}) {
  const cfg = loadConfig(root);
  const slug = repo || cfg.repo;
  const current = readLocalVersion(root);
  if (!slug) {
    return {
      ok: false,
      current,
      reason: '还没配置更新源：config/update.json 里的 repo（形如 owner/name）是空的',
      hint: '填上仓库后即可联网查新；也可以直接 local --action ... 不走网络。',
    };
  }
  try {
    const rel = await getJSON(`${API}/repos/${slug}/releases/${cfg.channel === 'latest' ? 'latest' : 'tags/' + cfg.channel}`);
    const latest = String(rel.tag_name || rel.name || '').replace(/^v/, '');
    const picked = matchAsset(rel.assets, cfg.asset);
    return {
      ok: true,
      current,
      latest: latest || current,
      hasUpdate: compareVersion(latest, current) > 0,
      repo: slug,
      release: { tag: rel.tag_name, name: rel.name, publishedAt: rel.published_at, url: rel.html_url },
      asset: picked.full,
      codeAsset: picked.code,
      deltaAssets: picked.deltas,
    };
  } catch (e) {
    return { ok: false, current, repo: slug, reason: e.message, hint: '确认仓库有 release（不是只有 tag）；私有仓库需 GITHUB_TOKEN。' };
  }
}

/**
 * 探测本机可用代理。宿主进程里的 fetch 不走系统代理，GitHub release 的下载域名
 * 在直连失败时只会抛一个光秃秃的 `fetch failed`，所以先找一个能用的本地代理端口。
 * 顺序：显式传入 > 环境变量 > 常见本地端口（Clash / V2Ray / Shadowsocks 默认端口）。
 */
export async function detectProxy(explicit) {
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const env =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    '';
  if (env && !/^socks/i.test(env)) return env.replace(/\/+$/, '');
  for (const port of [7897, 7890, 10809, 10808, 1080, 8889, 8080]) {
    const alive = await new Promise((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port });
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        try {
          sock.destroy();
        } catch {}
        resolve(v);
      };
      sock.setTimeout(400);
      sock.on('connect', () => finish(true));
      sock.on('timeout', () => finish(false));
      sock.on('error', () => finish(false));
    });
    if (alive) return `http://127.0.0.1:${port}`;
  }
  return '';
}

/**
 * 下载到文件。先走 curl（能挂代理、自带重试），失败再退回 fetch。
 * curl 在有代理时同样带上 Authorization，私有仓库也能下。
 */
async function downloadToFile(url, outFile, proxy) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const px = await detectProxy(proxy);
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  try {
    const args = [
      '-sSL',
      '--fail',
      '--retry',
      '3',
      '--retry-delay',
      '2',
      '--connect-timeout',
      '20',
      '--max-time',
      '1500',
      // 断点续传：一次 200+MB 走代理要好几分钟，中途断了再点更新能从断点接着拉
      '-C',
      '-',
      '-o',
      outFile,
    ];
    if (px) args.push('-x', px);
    if (token) args.push('-H', `Authorization: Bearer ${token}`);
    args.push(url);
    execFileSync(curl, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 1550000 });
    const st = fs.statSync(outFile);
    if (st.size > 1024) return px ? `curl via ${px}` : 'curl direct';
  } catch {}
  try {
    fs.rmSync(outFile, { force: true });
  } catch {}
  const res = await fetch(url, { headers: headers(), redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}（直连与代理都没走通，先在设置里填 GitHub Token 或开代理）`);
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
  return 'fetch';
}

/** 下载 release asset 到 dist/，返回 {file, bytes, sha256, via} */
export async function downloadUpdate(root, asset, { dir = path.join('dist', 'updates'), proxy } = {}) {
  if (!asset?.url) throw new Error('没有可下载的 asset');
  const outDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, asset.name);
  const via = await downloadToFile(asset.url, outFile, proxy);
  const buf = fs.readFileSync(outFile);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  let digestOk = null;
  if (asset.digest && /^sha256:/i.test(asset.digest)) digestOk = asset.digest.split(':')[1].toLowerCase() === sha256;
  return { file: outFile, bytes: buf.length, sha256, digestOk, via };
}

/** 组装安装命令（不自作主张执行；apply 时由调用方带 profile 才跑） */
export function installCommand(tgz, profile) {
  if (!profile) return null;
  const script = path.join('install.ps1');
  return `powershell -ExecutionPolicy Bypass -File "${script}" -Mode tgz -PackagePath "${tgz}" -ProfileRoot "${profile}"`;
}

/* ---------------- 自动更新：查新状态、找 profile、装进去 ---------------- */

/** 上次查新的结果：面板和体检在离线时也能看到“有新版本” */
export function stateFile() {
  const dir = process.env.AIDIARY_HOME || path.join(os.homedir(), '.ai-diary');
  return path.join(dir, 'update-state.json');
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return null;
  }
}

export function writeState(patch) {
  try {
    const f = stateFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const out = { ...(readState() || {}), ...patch, at: new Date().toISOString() };
    fs.writeFileSync(f, JSON.stringify(out, null, 2), 'utf8');
    return out;
  } catch {
    return null;
  }
}

/**
 * 面板要展示的查新状态：缓存过期或与本地实际版本对不上时，就别再拿它当「远端最新」。
 * 典型场景：上次查新时本地还是 0.8.0、远端 0.8.1，之后手动装成了 0.8.2，
 * 缓存没刷新，面板却还写「本地 0.8.2 · 远端 0.8.1（有新版本）」。
 */
export function freshState(root, { maxAgeMs = 6 * 3600 * 1000 } = {}) {
  const s = readState();
  if (!s) return null;
  const local = readLocalVersion(root);
  // 刚装完就是最新：查新那一刻的 current 一定比本地旧，别拿它当过期依据
  if (s.installedVersion && s.installedVersion === local && !s.error) {
    return { ...s, stale: false, current: local, latest: local, hasUpdate: false };
  }
  const at = Date.parse(s.at || '') || 0;
  const age = at ? Date.now() - at : Infinity;
  const mismatched = Boolean(s.current) && s.current !== local;
  if (mismatched || age > maxAgeMs) {
    return {
      ...s,
      stale: true,
      current: local,
      hasUpdate: false,
      latest: null,
      staleReason: mismatched ? `缓存里的本地版本是 ${s.current}，实际是 ${local}` : '缓存超过 6 小时',
    };
  }
  return { ...s, stale: false };
}

/** 扫本机 profile，找出装了本插件的（桌面版默认在 ~/.dsh/profiles/<名字>） */
export function findProfiles(pluginName = 'dsh-plugin-ai-diary') {
  const base = path.join(os.homedir(), '.dsh', 'profiles');
  if (!fs.existsSync(base)) return [];
  const hits = [];
  for (const name of fs.readdirSync(base)) {
    const dir = path.join(base, name);
    const pkgFile = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgFile)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      if (j && j.dependencies && j.dependencies[pluginName]) hits.push(dir);
    } catch {
      /* 坏 json 跳过 */
    }
  }
  return hits;
}

/** 找 pnpm：Harness 自带的优先，其次 PATH 上的 */
export function findPnpm() {
  const cands = [
    process.env.DSH_PNPM,
    'D:/harness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs',
    path.join(os.homedir(), 'AppData', 'Local', 'DoubaoWork', 'User Data', 'Default', 'agent_infra', 'pnpm', 'bin', 'pnpm.cjs'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  try {
    const line = String(execSync(process.platform === 'win32' ? 'where pnpm' : 'which pnpm', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      .split(/\r?\n/)[0]
      .trim();
    if (line) return line;
  } catch {}
  return null;
}

/**
 * 把一个 tgz 装进指定 profile：
 * 备 tgz 到 ~/.dsh/plugin-packages、备份并改写 package.json 依赖、pnpm install、补 ffmpeg。
 * 会重建 node_modules，Harness 运行中也能装，但要重启才生效。
 */
export function installIntoProfile(root, profile, tgz) {
  const pkgFile = path.join(profile, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new Error('profile 里没有 package.json：' + profile);

  const pkgDir = path.join(os.homedir(), '.dsh', 'plugin-packages');
  fs.mkdirSync(pkgDir, { recursive: true });
  const dest = path.join(pkgDir, path.basename(tgz));
  if (path.resolve(dest) !== path.resolve(tgz)) fs.copyFileSync(tgz, dest);

  const raw = fs.readFileSync(pkgFile, 'utf8');
  const backup = pkgFile + '.bak-aidiary-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  fs.writeFileSync(backup, raw, 'utf8');
  const j = JSON.parse(raw);
  j.dependencies = j.dependencies || {};
  j.dependencies['dsh-plugin-ai-diary'] = 'file:' + dest.split(path.sep).join('/');
  fs.writeFileSync(pkgFile, JSON.stringify(j, null, 4) + '\n', 'utf8');

  const pnpm = findPnpm();
  if (!pnpm) throw new Error('没找到 pnpm，无法自动安装（可手动跑 install.ps1）');
  execFileSync(process.execPath, [pnpm, 'install', '--prefer-offline'], {
    cwd: profile,
    stdio: 'pipe',
    timeout: 900000,
  });

  // tgz 里不带 ffmpeg（100MB），从当前插件根补一份，保证装完直接能出片
  const instDir = path.join(profile, 'node_modules', 'dsh-plugin-ai-diary');
  const vendorSrc = path.join(root, 'vendor');
  if (fs.existsSync(vendorSrc) && fs.existsSync(instDir)) {
    const dst = path.join(instDir, 'vendor');
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(vendorSrc)) {
      const s = path.join(vendorSrc, f);
      try {
        if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dst, f));
      } catch {}
    }
  }
  return { profile, tgz: dest, backup };
}

/**
 * 代码包覆盖安装：把代码包解到既有的 node_modules 目录，素材保持不动。
 * 只适用于「这个 profile 已经装过本插件」的环境；没装过就退回完整包。
 */
export function installCodeIntoProfile(profile, tgz) {
  const instDir = path.join(profile, 'node_modules', 'dsh-plugin-ai-diary');
  const pkgFile = path.join(instDir, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new Error('这个 profile 没装过本插件，需要完整包：' + profile);
  let from = null;
  try {
    from = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version || null;
  } catch {}

  fs.mkdirSync(instDir, { recursive: true });
  execFileSync('tar', ['-xzf', tgz, '-C', instDir, '--strip-components=1'], { stdio: 'pipe', timeout: 120000 });

  let to = null;
  try {
    to = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version || null;
  } catch {}
  return { profile, mode: 'code', from, to };
}

/**
 * 一键自动更新：查新 → 下载 → 装进 profile。
 * install=false 只到下载（试运行）；装完必须重启 Harness 才生效。
 */
export async function autoUpdate(root, { profile, repo, install = true } = {}) {
  const c = await checkUpdate(root, { repo });
  writeState({ ok: c.ok, current: c.current, latest: c.latest, hasUpdate: Boolean(c.hasUpdate), reason: c.reason || null });
  if (!c.ok) return { ok: false, stage: 'check', ...c };
  if (!c.hasUpdate) return { ok: true, stage: 'up-to-date', ...c };
  if (!c.asset && !c.codeAsset && !(c.deltaAssets || []).length)
    return { ok: false, stage: 'asset', reason: '最新 release 里没有 .tgz 资源', ...c };

  const targets = profile ? [path.resolve(profile)] : findProfiles();
  if (!targets.length) return { ok: false, stage: 'profile', reason: '没找到装了本插件的 profile（可显式指定）', ...c };

  // 三级取包：差分包（本地版本正好等于 delta.from）> 代码包（跳版本）> 完整包（首次安装）
  const installedAll = targets.every((p) => fs.existsSync(path.join(p, 'node_modules', 'dsh-plugin-ai-diary', 'package.json')));
  const delta = (c.deltaAssets || []).find((d) => String(d.from) === String(c.current));
  let mode = 'full';
  let asset = c.asset;
  if (installedAll && delta) {
    mode = 'delta';
    asset = delta;
  } else if (installedAll && c.codeAsset) {
    mode = 'code';
    asset = c.codeAsset;
  }
  if (!asset) return { ok: false, stage: 'asset', reason: '没有可下载的 asset', ...c };

  // 进度写盘：面板轮询 update-state.json 就能看到走到哪一步，不必挂着一个长请求
  writeState({ stage: 'download', mode, latest: c.latest, current: c.current, asset: asset.name });
  let d;
  try {
    d = await downloadUpdate(root, asset, { dir: path.join(root, 'dist', 'updates') });
  } catch (e) {
    const reason = String((e && e.message) || e);
    writeState({ stage: 'failed', ok: false, error: reason, lastAttemptAt: new Date().toISOString(), lastAttemptOk: false });
    return { ok: false, stage: 'download', reason, ...c };
  }
  writeState({ stage: 'download-done', bytes: d.bytes, via: d.via, mode });
  if (!install) return { ok: true, stage: 'downloaded', mode, ...c, ...d, targets };

  writeState({ stage: 'install', bytes: d.bytes, via: d.via, mode });
  // 装之前先把设置拍一张快照：key / 模型 / 音色都在里面，更新后自己回填
  const settingsBackup = backupSettings(root, 'update');
  const results = [];
  for (const p of targets) {
    try {
      // delta 与 code 都是 package/ 结构、只覆盖部分文件，走同一个覆盖安装
      const r = mode === 'full' ? installIntoProfile(root, p, d.file) : installCodeIntoProfile(p, d.file);
      results.push({ ...r, ok: true, mode });
    } catch (e) {
      results.push({ profile: p, ok: false, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  const allOk = results.every((r) => r.ok);
  // 装完再对一遍设置：哪个 key 被清空了就从刚才的快照补回来
  const heal = allOk ? healSettings(root, settingsBackup) : { healed: [], keys: 0 };
  writeState({
    stage: allOk ? 'installed' : 'install-failed',
    mode,
    current: allOk ? c.latest : c.current,
    // 装完本地就是最新了，别再让面板挂着「有新版本」的旧结论
    latest: allOk ? c.latest : c.latest,
    hasUpdate: allOk ? false : Boolean(c.hasUpdate),
    error: allOk ? undefined : String(results.find((r) => !r.ok)?.error || '安装失败').slice(0, 300),
    installedVersion: allOk ? c.latest : undefined,
    installedAt: allOk ? new Date().toISOString() : undefined,
    healed: heal.keys,
    settingsBackup: settingsBackup || undefined,
    lastAttemptAt: new Date().toISOString(),
    lastAttemptOk: allOk,
    targets: results.map((r) => ({ profile: r.profile, ok: r.ok })),
  });
  return {
    ok: allOk,
    stage: 'installed',
    mode,
    ...c,
    hasUpdate: allOk ? false : c.hasUpdate,
    current: allOk ? c.latest : c.current,
    ...d,
    targets: results,
    needsRestart: allOk,
    settingsBackup,
    healed: heal,
  };
}
