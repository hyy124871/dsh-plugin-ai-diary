// 联网自更新：查 GitHub Releases → 下载 tgz → 校验 → 交给安装流程。
// 只读公开信息时不需要 token；私有仓库要设 GITHUB_TOKEN。
//
// 配置：config/update.json  { "repo": "owner/name", "asset": "dsh-plugin-ai-diary-*.tgz", "channel": "latest" }
// 接口：https://api.github.com/repos/<repo>/releases/latest
// 下载：browser_download_url（release asset 上限 2GB，我们 200 多 MB 没问题）

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

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

/** 比较 semver，返回 -1 / 0 / 1 */
export function compareVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
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

/** 用 asset 通配匹配 release 里的 tgz */
function matchAsset(assets = [], pattern = DEFAULT_CONFIG.asset) {
  const rx = new RegExp('^' + String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  return assets.find((a) => rx.test(a.name)) || assets.find((a) => /\.tgz$/i.test(a.name)) || null;
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
    const asset = matchAsset(rel.assets, cfg.asset);
    return {
      ok: true,
      current,
      latest: latest || current,
      hasUpdate: compareVersion(latest, current) > 0,
      repo: slug,
      release: { tag: rel.tag_name, name: rel.name, publishedAt: rel.published_at, url: rel.html_url },
      asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url, digest: asset.digest || null } : null,
    };
  } catch (e) {
    return { ok: false, current, repo: slug, reason: e.message, hint: '确认仓库有 release（不是只有 tag）；私有仓库需 GITHUB_TOKEN。' };
  }
}

/** 下载 release asset 到 dist/，返回 {file, bytes, sha256} */
export async function downloadUpdate(root, asset, { dir = path.join('dist', 'updates') } = {}) {
  if (!asset?.url) throw new Error('没有可下载的 asset');
  const outDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, asset.name);
  const res = await fetch(asset.url, { headers: headers(), redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outFile, buf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  let digestOk = null;
  if (asset.digest && /^sha256:/i.test(asset.digest)) digestOk = asset.digest.split(':')[1].toLowerCase() === sha256;
  return { file: outFile, bytes: buf.length, sha256, digestOk };
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
 * 一键自动更新：查新 → 下载 → 装进 profile。
 * install=false 只到下载（试运行）；装完必须重启 Harness 才生效。
 */
export async function autoUpdate(root, { profile, repo, install = true } = {}) {
  const c = await checkUpdate(root, { repo });
  writeState({ ok: c.ok, current: c.current, latest: c.latest, hasUpdate: Boolean(c.hasUpdate), reason: c.reason || null });
  if (!c.ok) return { ok: false, stage: 'check', ...c };
  if (!c.hasUpdate) return { ok: true, stage: 'up-to-date', ...c };
  if (!c.asset) return { ok: false, stage: 'asset', reason: '最新 release 里没有 .tgz 资源', ...c };

  const targets = profile ? [path.resolve(profile)] : findProfiles();
  if (!targets.length) return { ok: false, stage: 'profile', reason: '没找到装了本插件的 profile（可显式指定）', ...c };

  const d = await downloadUpdate(root, c.asset, { dir: path.join(root, 'dist', 'updates') });
  if (!install) return { ok: true, stage: 'downloaded', ...c, ...d, targets };

  const results = [];
  for (const p of targets) {
    try {
      const r = installIntoProfile(root, p, d.file);
      results.push({ ...r, ok: true });
    } catch (e) {
      results.push({ profile: p, ok: false, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  const allOk = results.every((r) => r.ok);
  writeState({
    installedVersion: allOk ? c.latest : undefined,
    installedAt: allOk ? new Date().toISOString() : undefined,
    lastAttemptAt: new Date().toISOString(),
    lastAttemptOk: allOk,
    targets: results.map((r) => ({ profile: r.profile, ok: r.ok })),
  });
  return { ok: allOk, stage: 'installed', ...c, ...d, targets: results, needsRestart: allOk };
}
