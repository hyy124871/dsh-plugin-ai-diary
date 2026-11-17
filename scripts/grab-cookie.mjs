// 从本机浏览器的 cookie 库里读 .bilibili.com 的 SESSDATA / bili_jct / buvid3。
//
// 为什么有这个：让别人去 F12 一格格复制三项 Cookie 很容易抄错，而且 Cookie 会过期。
// 这个脚本直接读 Chromium 系浏览器的 Cookies(SQLite)，用 Windows DPAPI 还原密钥、
// AES-256-GCM 解密条目，找到三项就写进设置。
//
// 支持：Chrome / Edge / 哔哩哔哩客户端（都是 Chromium 内核，库里格式一样）。
// 不支持：v20 / app_bound 加密（新版 Chromium 的加固格式），遇到会明确报出来，不硬猜。
//
// 用法：
//   node scripts/grab-cookie.mjs --browser edge           # 只看，不写设置
//   node scripts/grab-cookie.mjs --browser edge --write   # 写进 settings.keys.bili
//   node scripts/grab-cookie.mjs --browser auto --json    # 自动挑一个已登录的
//   node scripts/grab-cookie.mjs --browser edge --profile "Profile 1"

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const WANT = ['SESSDATA', 'bili_jct', 'buvid3', 'buvid4', 'DedeUserID'];

const BROWSERS = {
  chrome: () => path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
  edge: () => path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
  bili: () => path.join(os.homedir(), 'AppData', 'Roaming', 'bilibili'),
};

function argOf(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function userDataRoot(browser) {
  const fn = BROWSERS[browser];
  return fn ? fn() : null;
}

/** 用 DPAPI 还原 Chromium 的 os_crypt.encrypted_key（去掉 "DPAPI" 前缀） */
function dpapiUnprotect(b64) {
  const ps = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Security',
    `$k=[Convert]::FromBase64String('${String(b64).replace(/'/g, "''")}')`,
    '$u=[System.Security.Cryptography.ProtectedData]::Unprotect($k,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    'Write-Output ([Convert]::ToBase64String($u))',
  ].join('; ');
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  return Buffer.from(out.trim(), 'base64');
}

function cryptKey(root) {
  const statePath = path.join(root, 'Local State');
  if (!fs.existsSync(statePath)) throw new Error(`找不到 ${statePath}`);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const oc = state.os_crypt || {};
  const encKey = oc.encrypted_key;
  if (!encKey) throw new Error('Local State 里没有 os_crypt.encrypted_key');
  const raw = Buffer.from(encKey, 'base64');
  if (raw.subarray(0, 5).toString() !== 'DPAPI') throw new Error(`encrypted_key 前缀不是 DPAPI（${raw.subarray(0, 5).toString()}），可能是 app_bound 加密`);
  const key = dpapiUnprotect(raw.subarray(5).toString('base64'));
  return key;
}

/** v10 = AES-256-GCM；明文可能带 32 字节 host 绑定哈希前缀 */
function decryptValue(buf, key, hostKey) {
  const prefix = buf.subarray(0, 3).toString('latin1');
  if (prefix === 'v20') throw new Error('条目是 v20(app_bound) 加密，暂不支持，请手动复制');
  if (prefix !== 'v10') throw new Error(`未知加密前缀 ${JSON.stringify(prefix)}`);
  const iv = buf.subarray(3, 15);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(15, buf.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  let plain = Buffer.concat([d.update(ct), d.final()]);
  // Chromium M104+ 会在明文前塞 32 字节 SHA256(host_key)，验证后剥掉
  if (plain.length > 32) {
    const h = crypto.createHash('sha256').update(String(hostKey || '')).digest();
    if (plain.subarray(0, 32).equals(h)) plain = plain.subarray(32);
  }
  return plain.toString('utf8');
}

function readDb(root, profile) {
  const dbPath = path.join(root, profile, 'Network', 'Cookies');
  if (!fs.existsSync(dbPath)) throw new Error(`没有 cookie 库：${dbPath}`);
  const sql = `select host_key, name, value, encrypted_value
               from cookies
               where host_key like '%bilibili%' and name in (${WANT.map(() => '?').join(',')})`;

  // 先试直接读（用共享读拷一份，不动原文件）；浏览器把库锁死了就退到 python 的 immutable 读
  try {
    const tmp = path.join(os.tmpdir(), `grab-cookie-${crypto.randomUUID()}.db`);
    fs.writeFileSync(tmp, fs.readFileSync(dbPath));
    const db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare(sql).all(...WANT);
    db.close();
    try {
      fs.unlinkSync(tmp);
    } catch {}
    return rows.map((r) => ({ host_key: r.host_key, name: r.name, value: r.value, encrypted_value: r.encrypted_value }));
  } catch (e) {
    if (!/EBUSY|busy|locked|used by another/i.test(e.message)) throw e;
  }

  const py = path.resolve(import.meta.dirname, 'dump-cookies.py');
  const out = execFileSync('python', [py, dbPath], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  if (!parsed.ok) throw new Error(`读 cookie 库失败：${parsed.error}`);
  return parsed.rows.map((r) => ({
    host_key: r.host,
    name: r.name,
    value: r.value,
    encrypted_value: r.enc ? Buffer.from(r.enc, 'base64') : null,
  }));
}

function collect(browser, profile) {
  const root = userDataRoot(browser);
  if (!root || !fs.existsSync(root)) throw new Error(`没装 ${browser}，或目录不存在：${root}`);
  const key = cryptKey(root);
  const rows = readDb(root, profile);
  const out = { browser, profile, root, found: {}, encrypted: 0, errors: [] };
  for (const r of rows) {
    try {
      let val = String(r.value || '');
      if (!val) {
        val = decryptValue(Buffer.from(r.encrypted_value), key, r.host_key);
        out.encrypted += 1;
      }
      out.found[r.name] = { value: val, host: r.host_key };
    } catch (e) {
      out.errors.push(`${r.name}: ${e.message}`);
    }
  }
  return out;
}

function candidates(browser) {
  const root = userDataRoot(browser);
  if (!root || !fs.existsSync(root)) return [];
  // 客户端这类没有 profile 子目录，Cookies 直接挂在根上
  if (fs.existsSync(path.join(root, 'Network', 'Cookies'))) return [''];
  const list = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (d.name === 'Default' || /^Profile \d+$/.test(d.name)) list.push(d.name);
  }
  return list;
}

function mask(v) {
  const s = String(v || '');
  return s.length <= 8 ? '■'.repeat(s.length) : s.slice(0, 4) + '■'.repeat(Math.min(10, s.length - 8)) + s.slice(-4);
}

export { decryptValue, cryptKey, readDb };

async function main() {
  const browserArg = String(argOf('browser', 'auto'));
const profileArg = argOf('profile', null);
const wantJson = Boolean(argOf('json', false));
const wantWrite = Boolean(argOf('write', false));

const targets = browserArg === 'auto' ? ['edge', 'chrome', 'bili'] : [browserArg];
const report = [];

for (const b of targets) {
  if (!BROWSERS[b]) {
    report.push({ browser: b, ok: false, error: `不认识的浏览器 ${b}，可选 edge / chrome / bili` });
    continue;
  }
  const profiles = profileArg ? [String(profileArg)] : candidates(b);
  if (!profiles.length) {
    report.push({ browser: b, ok: false, error: `${b} 没有找到 profile 目录` });
    continue;
  }
  for (const p of profiles) {
    try {
      const r = collect(b, p);
      const hasLogin = Boolean(r.found.SESSDATA && r.found.bili_jct);
      report.push({ browser: b, profile: p, ok: hasLogin, login: hasLogin, decrypted: r.encrypted, errors: r.errors, found: r.found });
    } catch (e) {
      report.push({ browser: b, profile: p, ok: false, error: e.message });
    }
  }
}

const good = report.filter((r) => r.ok);
if (wantJson) {
  console.log(JSON.stringify(report.map((r) => ({ ...r, found: Object.fromEntries(Object.entries(r.found || {}).map(([k, v]) => [k, mask(v.value)])) })), null, 2));
} else {
  for (const r of report) {
    if (r.error) {
      console.log(`${r.browser}/${r.profile}: ${r.error}`);
      continue;
    }
    const names = Object.keys(r.found || {});
    const state = r.login ? '已登录' : names.length ? `只有匿名 Cookie（${names.join(',')}），没有 SESSDATA` : '没有 bilibili 的 Cookie';
    console.log(`${r.browser}/${r.profile}: ${state}${r.decrypted ? `（解密 ${r.decrypted} 条）` : ''}`);
    for (const e of r.errors || []) console.log(`   ! ${e}`);
  }
}

if (!good.length) {
  console.log('\n没找到可用的登录态。先在这个浏览器里打开 bilibili.com 并登录，再跑一次。');
  process.exitCode = 2;
} else {
  const best = good[0];
  const cookie = ['SESSDATA', 'bili_jct', 'buvid3', 'buvid4', 'DedeUserID']
    .filter((k) => best.found[k])
    .map((k) => `${k}=${best.found[k].value}`)
    .join('; ');
  console.log(`\n取自 ${best.browser}/${best.profile}：${Object.keys(best.found).join(' / ')}`);
  if (wantWrite) {
    const { saveSettings } = await import('../src/settings.mjs');
    const root = path.resolve(import.meta.dirname, '..');
    saveSettings(root, { keys: { bili: cookie } });
    console.log('已写入设置 keys.bili（不再回显明文）。下一步：node bin/ai-diary.mjs comments --action auth');
    } else {
      console.log('加 --write 就会直接写进设置，不用手动复制。');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((e) => {
    console.error('出错：' + e.message);
    process.exitCode = 1;
  });
}
