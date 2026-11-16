// 联网自更新：查 GitHub Releases → 下载 tgz → 校验 → 交给安装流程。
// 只读公开信息时不需要 token；私有仓库要设 GITHUB_TOKEN。
//
// 配置：config/update.json  { "repo": "owner/name", "asset": "dsh-plugin-ai-diary-*.tgz", "channel": "latest" }
// 接口：https://api.github.com/repos/<repo>/releases/latest
// 下载：browser_download_url（release asset 上限 2GB，我们 200 多 MB 没问题）

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
