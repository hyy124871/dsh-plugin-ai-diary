#!/usr/bin/env node
// 把 ffmpeg 补进插件的 vendor/ —— 装完插件、机器上又没有 ffmpeg 时的一条命令。
//
// 零依赖：curl 下载 zip → 系统自带 tar 解开（Win10+ 是 bsdtar，能解 zip）→ 找出 ffmpeg.exe
// → 复制到 vendor/ → 跑一遍 -version 验收。下载源可从 --url 覆盖，也认 HTTPS_PROXY。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : '';
};

const SOURCES = [
  { name: 'GitHub · BtbN 完整构建', url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' },
  { name: 'gyan.dev · essentials', url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' },
];

function log(s = '') {
  process.stdout.write(`${s}\n`);
}

function ran(cmd, a, opts = {}) {
  try {
    return execFileSync(cmd, a, { stdio: opts.inherit ? 'inherit' : 'pipe', encoding: 'utf8' });
  } catch (e) {
    return '';
  }
}

function walkFind(dir, name, depth = 0) {
  if (depth > 6) return '';
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = walkFind(path.join(dir, e.name), name, depth + 1);
    if (hit) return hit;
  }
  return '';
}

async function download(url, out) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || '';
  const hasCurl = Boolean(ran('curl', ['--version']).trim());
  if (hasCurl) {
    // -s 静默：curl 的进度条在 PowerShell 里会被当成报错噪音刷屏，这里自己报结果
    const a = ['-s', '-L', '--fail', '--retry', '2', '--connect-timeout', '20', '-o', out];
    if (proxy) a.push('-x', proxy);
    a.push(url);
    log(`  curl 下载${proxy ? `（走代理 ${proxy}）` : ''}…`);
    ran('curl', a);
    if (fs.existsSync(out) && fs.statSync(out).size > 1e7) return true;
    return false;
  }
  log('  没有 curl，改用 Node fetch…');
  const res = await fetch(url);
  if (!res.ok) return false;
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return fs.statSync(out).size > 1e7;
}

async function main() {
  if (!flag('force') && fs.existsSync(path.join(VENDOR, EXE))) {
    log(`已存在 ${path.join(VENDOR, EXE)}，跳过（要覆盖加 --force）`);
    return 0;
  }

  if (process.platform !== 'win32' && !flag('url')) {
    log('非 Windows 请用系统包管理器装 ffmpeg（apt/brew），或 --url 指一个直链');
  }

  const list = opt('url') ? [{ name: '自定义', url: opt('url') }] : SOURCES;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidiary-ffmpeg-'));
  let zip = '';
  let ok = false;

  if (opt('zip')) {
    // 离线：直接给一个下好的 ffmpeg 压缩包
    zip = path.resolve(opt('zip'));
    if (!fs.existsSync(zip)) {
      log(`--zip 指的包不存在：${zip}`);
      return 1;
    }
    ok = true;
    log(`\n[源] 本地包 ${zip}`);
  }

  for (const src of (ok ? [] : list)) {
    log(`\n[源] ${src.name}`);
    log(`     ${src.url}`);
    zip = path.join(tmp, 'ffmpeg.zip');
    try {
      fs.rmSync(zip, { force: true });
      if (await download(src.url, zip)) {
        ok = true;
        break;
      }
      log('  没拿到文件，换下一个源');
    } catch (e) {
      log(`  失败：${e.message}`);
    }
  }

  if (!ok) {
    log('\n下载全失败。常见原因：GitHub 直连被 reset。设好代理再跑：');
    log('  $env:HTTPS_PROXY="http://127.0.0.1:7897"; node scripts/get-ffmpeg.mjs');
    return 1;
  }

  log(`\n[解压] ${Math.round(fs.statSync(zip).size / 1e6)} MB`);
  const outDir = path.join(tmp, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  // tar 成功时没有 stdout，不能用输出判断成败 —— 看目录里有没有东西
  ran('tar', ['-xf', zip, '-C', outDir]);
  let unzipped = fs.readdirSync(outDir).length > 0;
  if (!unzipped) {
    log('  tar 没解开，换 PowerShell Expand-Archive…');
    ran('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${outDir}" -Force`]);
    unzipped = fs.readdirSync(outDir).length > 0;
  }
  if (!unzipped) {
    log('  解压失败');
    return 1;
  }

  const found = walkFind(outDir, 'ffmpeg.exe') || walkFind(outDir, 'ffmpeg');
  if (!found) {
    log('  解出来的包里没找到 ffmpeg');
    return 1;
  }
  fs.mkdirSync(VENDOR, { recursive: true });
  const dest = path.join(VENDOR, EXE);
  fs.copyFileSync(found, dest);
  log(`\n[落盘] ${dest}（${Math.round(fs.statSync(dest).size / 1e6)} MB）`);

  const ver = ran(dest, ['-version']);
  const first = String(ver).split(/\r?\n/)[0];
  if (!first) {
    log('  装进去但跑不起来，可能被杀软拦了');
    return 1;
  }
  log(`[验收] ${first}`);
  if (!flag('keep')) fs.rmSync(tmp, { recursive: true, force: true });
  log('\n搞定。再跑一次 node bin/ai-diary.mjs status 确认 ffmpeg 那行变 ✓');
  return 0;
}

main().then((c) => process.exit(c), (e) => {
  console.error(e);
  process.exit(1);
});
