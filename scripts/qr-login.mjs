// 扫码登录：拿 SESSDATA / bili_jct，全程不碰浏览器、不用 F12。
//
// 原理是 B 站网页扫码登录用的同一组公开接口：
//   GET /x/passport-login/web/qrcode/generate  -> { url, qrcode_key }
//   GET /x/passport-login/web/qrcode/poll      -> code 86101 未扫 / 86090 已扫待确认 / 86038 过期 / 0 成功
// 成功时响应头 Set-Cookie 和 data.url 里都带着 SESSDATA / bili_jct / DedeUserID。
//
// 用法（在插件根目录）：
//   node scripts/qr-login.mjs                  # 出码 + 打开图片 + 等扫码
//   node scripts/qr-login.mjs --write          # 拿到后直接写 settings.keys.bili
//   node scripts/qr-login.mjs --no-open        # 不自动打开图片，只打印路径
//   node scripts/qr-login.mjs --timeout 300    # 等更久
//   node scripts/qr-login.mjs --selftest       # 自检编码器（需要 python 的 qrcode 包）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { qrPng, qrEncode } from '../src/qr.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

// node:sqlite 会甩一条 ExperimentalWarning，读客户端 cookie 库时很吵，这里只吞掉这一类
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning') return;
  if (w && w.stack) console.error(w.stack);
});

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOME = 'https://www.bilibili.com/';
const KEEP = ['SESSDATA', 'bili_jct', 'buvid3', 'buvid4', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];

function argOf(name, dflt = false) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function mask(v) {
  const s = String(v || '');
  return s.length <= 8 ? '■'.repeat(s.length) : `${s.slice(0, 4)}${'■'.repeat(Math.min(10, s.length - 8))}${s.slice(-4)}`;
}

async function get(pathname, cookie) {
  const headers = { 'User-Agent': UA, Referer: HOME };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`https://passport.bilibili.com${pathname}`, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, json, text };
}

function parseSetCookie(res) {
  const out = {};
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const first = String(line).split(';')[0];
    const i = first.indexOf('=');
    if (i <= 0) continue;
    const name = first.slice(0, i).trim();
    if (KEEP.includes(name)) out[name] = first.slice(i + 1).trim();
  }
  return out;
}

function parseUrlCookie(url) {
  const out = {};
  try {
    const u = new URL(url);
    for (const [k, v] of u.searchParams) if (KEEP.includes(k)) out[k] = v;
  } catch {}
  return out;
}

/** 客户端 Cookie 库里那条匿名的 buvid3；带上能让服务端认设备，少一层风控 */
async function clientBuvid() {
  try {
    const root = path.join(os.homedir(), 'AppData', 'Roaming', 'bilibili');
    if (!fs.existsSync(root)) return null;
    const { readDb } = await import('./grab-cookie.mjs');
    const rows = readDb(root, '');
    const row = rows.find((r) => r.name === 'buvid3' && String(r.value || '').trim());
    return row ? String(row.value).trim() : null;
  } catch {
    return null;
  }
}

function openFile(p) {
  try {
    execFile('cmd.exe', ['/c', 'start', '', p], { windowsHide: true }, () => {});
  } catch {}
}

async function verify(cookie) {
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': UA, Referer: HOME, Cookie: cookie },
  });
  return res.json();
}

async function selftest() {
  // 用 python 的 qrcode 库生成同版本同 mask 的矩阵，逐模块比对
  const sample = 'https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=0123456789abcdef0123456789abcdef&from=';
  const mine = qrEncode(sample);
  const py = [
    'import json,sys',
    'import qrcode',
    'from qrcode.constants import ERROR_CORRECT_L',
    'text = sys.argv[1]',
    `qr = qrcode.QRCode(version=${mine.version}, error_correction=ERROR_CORRECT_L, box_size=1, border=0, mask_pattern=0)`,
    'qr.add_data(text, optimize=0)',
    'qr.make(fit=False)',
    'm = qr.get_matrix()',
    'print(json.dumps([[1 if c else 0 for c in row] for row in m]))',
  ].join('\n');
  const out = await new Promise((resolve, reject) => {
    execFile('python', ['-c', py, sample], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
  const theirs = JSON.parse(out);
  let diff = 0;
  if (theirs.length !== mine.size) {
    console.log(`尺寸不一致：我的 ${mine.size}，python 的 ${theirs.length}`);
    process.exitCode = 1;
    return;
  }
  for (let r = 0; r < mine.size; r += 1) {
    for (let c = 0; c < mine.size; c += 1) if (mine.modules[r][c] !== theirs[r][c]) diff += 1;
  }
  console.log(`version ${mine.version} / ${mine.size}x${mine.size} / 差异模块 ${diff}`);
  if (diff === 0) console.log('矩阵与 python qrcode 完全一致 ✓');
  else process.exitCode = 1;
}

async function main() {
  if (argOf('selftest')) {
    await selftest();
    return;
  }

  const timeout = Number(argOf('timeout', 180)) * 1000;
  const wantWrite = Boolean(argOf('write'));
  const noOpen = Boolean(argOf('no-open'));
  const buvid = await clientBuvid();

  let gen;
  for (let tries = 0; tries < 2; tries += 1) {
    const r = await get('/x/passport-login/web/qrcode/generate', buvid ? `buvid3=${buvid}` : null);
    if (r.json && r.json.code === 0) {
      gen = r.json.data;
      break;
    }
    await new Promise((res) => setTimeout(res, 1200));
  }
  if (!gen) {
    console.error('取登录二维码失败，稍后再试（接口没返回 code=0）');
    process.exitCode = 1;
    return;
  }

  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const pngPath = path.join(outDir, 'qr-login.png');
  fs.writeFileSync(pngPath, qrPng(gen.url, { scale: 9, margin: 4 }));

  console.log('二维码已生成：' + pngPath);
  console.log('用手机哔哩哔哩 App 的「扫一扫」扫这张图，然后在手机上点确认。');
  if (!noOpen) openFile(pngPath);
  console.log('（不想弹图片查看器就用 --no-open，自己打开上面的路径）\n');
  if (buvid) console.log(`已带上客户端 Cookie 库里的 buvid3（${buvid.slice(0, 8)}…），少一层风控。`);

  const deadline = Date.now() + timeout;
  let last = '';
  let data;
  for (;;) {
    if (Date.now() > deadline) {
      console.log('\n等待超时，二维码已失效。重跑一次即可（二维码只有几分钟寿命）。');
      process.exitCode = 2;
      return;
    }
    const key = gen.qrcode_key;
    const r = await get(`/x/passport-login/web/qrcode/poll?qrcode_key=${key}`, buvid ? `buvid3=${buvid}` : null);
    if (!r.json || r.json.code !== 0) {
      console.log('接口返回异常：' + String(r.text || '').slice(0, 160));
      process.exitCode = 1;
      return;
    }
    data = r.json.data || {};
    const code = data.code;
    if (code === 0) {
      const cookies = { ...parseUrlCookie(data.url), ...parseSetCookie(r.res) };
      const names = KEEP.filter((k) => cookies[k]);
      if (!cookies.SESSDATA || !cookies.bili_jct) {
        console.log(`扫码成功，但没拿到 SESSDATA/bili_jct（拿到的是 ${names.join(',') || '空'}）。`);
        process.exitCode = 1;
        return;
      }
      const cookie = KEEP.filter((k) => cookies[k])
        .map((k) => `${k}=${cookies[k]}`)
        .join('; ');

      const nav = await verify(cookie);
      if (nav && nav.code === 0) {
        console.log(`登录成功：${nav.data.uname}（UID ${nav.data.mid}）`);
      } else {
        console.log(`拿到 Cookie，但校验登录态返回 ${nav && nav.code}（${(nav && nav.message) || '未知'}）`);
      }
      console.log(`Cookie 字段：${KEEP.filter((k) => cookies[k]).map((k) => `${k}(${cookies[k].length}字)`).join(' / ')}`);

      if (wantWrite) {
        const { saveSettings } = await import('../src/settings.mjs');
        saveSettings(ROOT, { keys: { bili: cookie } });
        console.log(`\n已写入设置 keys.bili（${mask(cookies.SESSDATA)}）。`);
        console.log('下一步：node bin/ai-diary.mjs comments --action auth');
      } else {
        console.log('\n没加 --write，所以没落盘。要直接写进设置就重跑并加 --write。');
      }
      return;
    }
    const hint =
      code === 86101 ? '还没扫' : code === 86090 ? '已扫码，等你在手机上点「确认登录」' : code === 86038 ? '二维码已失效' : `未知状态 ${code}`;
    if (hint !== last) {
      console.log(`→ ${hint}`);
      last = hint;
    }
    if (code === 86038) {
      console.log('二维码失效了，正在换一张新的…');
      fs.writeFileSync(pngPath, qrPng(gen.url, { scale: 9, margin: 4 })); // 占位，下面重新取
      const r2 = await get('/x/passport-login/web/qrcode/generate', buvid ? `buvid3=${buvid}` : null);
      if (r2.json && r2.json.code === 0) {
        gen = r2.json.data;
        fs.writeFileSync(pngPath, qrPng(gen.url, { scale: 9, margin: 4 }));
        console.log('新码已写到 ' + pngPath);
        last = '';
        continue;
      }
      process.exitCode = 1;
      return;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
}

main().catch((e) => {
  console.error('出错：' + e.message);
  process.exitCode = 1;
});
