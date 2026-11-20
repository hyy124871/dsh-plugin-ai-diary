// B 站扫码登录（服务端版）：给面板出二维码、轮询状态、成功后把 Cookie 写进设置。
//
// 走的还是网页扫码那组公开接口：
//   GET /x/passport-login/web/qrcode/generate -> { url, qrcode_key }
//   GET /x/passport-login/web/qrcode/poll     -> code 86101 未扫 / 86090 已扫待确认 / 86038 过期 / 0 成功
// 与 scripts/qr-login.mjs 的区别：那边是命令行自己弹图片看，这边把 PNG 直接回给面板显示。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { qrPng } from './qr.mjs';
import { saveSettings, loadSettings } from './settings.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOME = 'https://www.bilibili.com/';
const KEEP = ['SESSDATA', 'bili_jct', 'buvid3', 'buvid4', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];

// 进程内记住客户端 Cookie 库里那条 buvid3，带上少一层风控（拿不到就算了）
let buvid3Cache = null;

async function clientBuvid() {
  if (buvid3Cache !== null) return buvid3Cache;
  buvid3Cache = '';
  try {
    const root = path.join(os.homedir(), 'AppData', 'Roaming', 'bilibili');
    if (!fs.existsSync(root)) return buvid3Cache;
    const { readDb } = await import('../scripts/grab-cookie.mjs');
    const rows = readDb(root, '');
    const row = rows.find((r) => r.name === 'buvid3' && String(r.value || '').trim());
    if (row) buvid3Cache = String(row.value).trim();
  } catch {
    /* 读不到就空着 */
  }
  return buvid3Cache;
}

async function passport(pathname, cookie) {
  const headers = { 'User-Agent': UA, Referer: HOME };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`https://passport.bilibili.com${pathname}`, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 走后面报错 */
  }
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
  } catch {
    /* 没有 url 就只靠 Set-Cookie */
  }
  return out;
}

function joinCookie(obj) {
  return KEEP.filter((k) => obj[k])
    .map((k) => `${k}=${obj[k]}`)
    .join('; ');
}

/** 网页端 SESSDATA 有效期约半年；每次保活成功都按这个窗口顺延 */
export const SESSION_DAYS = 180;
const DAY_MS = 86400000;

/** 面板读的登录态：剩余天数 + 预警级别（none 没 Cookie / bad 验不过 / expired / soon / ok） */
export function sessionInfo(root) {
  const st = loadSettings(root);
  const s = st.biliSession || {};
  const cookie = process.env.BILI_COOKIE || String((st.keys && st.keys.bili) || '');
  const now = Date.now();
  const exp = s.expiresAt ? Date.parse(s.expiresAt) : 0;
  const daysLeft = exp ? Math.ceil((exp - now) / DAY_MS) : null;
  let level = 'ok';
  if (!cookie) level = 'none';
  else if (!s.checkedAt) level = 'unknown';
  else if (!s.ok) level = 'bad';
  else if (daysLeft !== null && daysLeft <= 0) level = 'expired';
  else if (daysLeft !== null && daysLeft <= 7) level = 'soon';
  return {
    cookieReady: Boolean(cookie),
    ok: Boolean(s.ok),
    uname: s.uname || '',
    mid: s.mid || 0,
    lastOkAt: s.lastOkAt || null,
    checkedAt: s.checkedAt || null,
    expiresAt: s.expiresAt || null,
    daysLeft,
    level,
    failReason: s.failReason || '',
  };
}

function recordSession(root, patch) {
  const prev = loadSettings(root).biliSession || {};
  saveSettings(root, { biliSession: { ...prev, checkedAt: new Date().toISOString(), ...patch } });
}

/** 拿现有 Cookie 问一次 nav，确认到底登录没有；成功就记下昵称并顺延会话到期时间 */
export async function whoami(root, opts = {}) {
  const st = loadSettings(root);
  const cookie = process.env.BILI_COOKIE || String((st.keys && st.keys.bili) || '');
  if (!cookie) {
    recordSession(root, { ok: false, failReason: '还没配 Cookie' });
    return { ok: false, reason: '还没配 Cookie' };
  }
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'User-Agent': UA, Referer: HOME, Cookie: cookie },
    });
    const j = await res.json();
    if (j && j.code === 0 && j.data && j.data.isLogin) {
      if (opts.record !== false) {
        const now = new Date();
        recordSession(root, {
          ok: true,
          uname: j.data.uname,
          mid: j.data.mid,
          lastOkAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString(),
          failReason: '',
        });
      }
      return { ok: true, uname: j.data.uname, mid: j.data.mid };
    }
    const reason = `接口返回 ${j && j.code}（${(j && j.message) || '未登录'}）`;
    recordSession(root, { ok: false, failReason: reason });
    return { ok: false, reason };
  } catch (e) {
    const reason = String((e && e.message) || e);
    recordSession(root, { ok: false, failReason: reason });
    return { ok: false, reason };
  }
}

/** 保活：成功即把到期时间顺延到「现在 + 180 天」，等于让登录态一直活着 */
export async function keepAlive(root) {
  const me = await whoami(root, { record: true });
  return { ...me, at: new Date().toISOString(), session: sessionInfo(root) };
}

/** 出一张登录二维码：PNG 直接给 dataURL，面板 <img> 就能显示 */
export async function startQr() {
  const buvid = await clientBuvid();
  let gen = null;
  for (let i = 0; i < 2; i += 1) {
    const r = await passport('/x/passport-login/web/qrcode/generate', buvid ? `buvid3=${buvid}` : null);
    if (r.json && r.json.code === 0 && r.json.data) {
      gen = r.json.data;
      break;
    }
    await new Promise((res) => setTimeout(res, 1200));
  }
  if (!gen) return { ok: false, reason: '口令接口没返回二维码，稍后再试' };
  const png = qrPng(gen.url, { scale: 9, margin: 4 });
  return {
    ok: true,
    key: gen.qrcode_key,
    url: gen.url,
    image: 'data:image/png;base64,' + png.toString('base64'),
    withBuvid: Boolean(buvid),
  };
}

/**
 * 轮询扫码状态。成功时顺手把 Cookie 写进设置并校验一次登录态。
 * 返回 status：wait 未扫 / scan 已扫待确认 / expired 过期 / ok 成功 / error
 */
export async function pollQr(root, key) {
  if (!key) return { status: 'error', reason: '缺 qrcode_key' };
  const buvid = await clientBuvid();
  const r = await passport(`/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`, buvid ? `buvid3=${buvid}` : null);
  if (!r.json || r.json.code !== 0) return { status: 'error', reason: String(r.text || '接口异常').slice(0, 200) };
  const data = r.json.data || {};
  const code = data.code;

  if (code === 86101) return { status: 'wait' };
  if (code === 86090) return { status: 'scan' };
  if (code === 86038) return { status: 'expired' };
  if (code !== 0) return { status: 'error', reason: `未知状态 ${code}` };

  const cookies = { ...parseUrlCookie(data.url), ...parseSetCookie(r.res) };
  if (!cookies.SESSDATA || !cookies.bili_jct) {
    return { status: 'error', reason: '扫码成功但没拿到 SESSDATA / bili_jct，换个网络再试' };
  }
  const cookie = joinCookie(cookies);
  saveSettings(root, { keys: { bili: cookie } });

  const me = await whoami(root);
  return {
    status: 'ok',
    saved: true,
    uname: me.uname || null,
    mid: me.mid || null,
    fields: KEEP.filter((k) => cookies[k]),
    cookiePreview: cookies.SESSDATA.slice(0, 4) + '■■■■' + cookies.SESSDATA.slice(-4),
  };
}
