// B 站评论接口客户端（纯 Node，无第三方依赖）。
//
// 为什么要有这一层：评论管理页靠截图 + OCR 点「发表回复」太脆（会点到视频标题、
// 会点到删除、按钮认不出来）。走官方接口只有一次 HTTPS 请求，成功与否由返回的
// code 判定，不依赖像素坐标。
//
// 需要的 Cookie 三项：
//   SESSDATA  登录态
//   bili_jct  CSRF token，回复接口的 csrf 参数就是它
//   buvid3    设备指纹，缺了容易被 -412 拦
//
// 接口：
//   读自己稿件   /x/space/wbi/arc/search   （要 WBI 签名）
//   读评论       /x/v2/reply/wbi/main      （要 WBI 签名，退化到 /x/v2/reply/main）
//   发回复       /x/v2/reply/add           （csrf=bili_jct；回复某条评论必须带 root/parent）
//
// 限频：平台约 30 秒 1 条评论，本模块不尝试突破，只按节拍排队。

import crypto from 'node:crypto';
import https from 'node:https';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// WBI mixin key 的固定重排表（官方前端同一张表，不要改）
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** 带业务 code 的错误，便于上层判断「该不该回退 GUI」 */
export class BiliApiError extends Error {
  constructor(message, code, detail) {
    super(message);
    this.name = 'BiliApiError';
    this.code = code;
    this.detail = detail || null;
  }
}

/** "SESSDATA=xx; bili_jct=yy" 或换行分隔的粘贴内容 → 对象 */
export function parseCookie(raw) {
  const out = {};
  for (const part of String(raw || '').split(/[;\n]/)) {
    const s = part.trim();
    if (!s) continue;
    const i = s.indexOf('=');
    if (i <= 0) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return out;
}

export function cookieString(cookie) {
  const c = typeof cookie === 'string' ? parseCookie(cookie) : cookie || {};
  return Object.entries(c)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** 检查 Cookie 是否够用；缺失项回给用户，不要自己猜 */
export function checkCookie(cookie) {
  const c = typeof cookie === 'string' ? parseCookie(cookie) : cookie || {};
  const missing = ['SESSDATA', 'bili_jct'].filter((k) => !c[k]);
  return {
    ok: missing.length === 0,
    missing,
    hasBuvid: Boolean(c.buvid3 || c.buvid4),
    mid: c.DedeUserID ? Number(c.DedeUserID) : null,
  };
}

function requestJson(url, { method = 'GET', cookie = {}, form = null, referer, origin, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Encoding': 'identity',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: referer || 'https://www.bilibili.com/',
      Origin: origin || 'https://www.bilibili.com',
    };
    const ck = cookieString(cookie);
    if (ck) headers.Cookie = ck;
    let body = null;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(
      { protocol: u.protocol, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          raw += d;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = null;
          }
          if (!parsed) {
            reject(new BiliApiError(`接口返回的不是 JSON（HTTP ${res.statusCode}）`, `http_${res.statusCode}`, raw.slice(0, 300)));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new BiliApiError('接口超时（15s）', 'timeout'));
    });
    req.on('error', (e) => reject(e instanceof BiliApiError ? e : new BiliApiError(`网络请求失败：${e.message}`, 'network')));
    if (body) req.write(body);
    req.end();
  });
}

/** 按业务 code 抛错：-101 未登录、-412 被拦、25004 风控 */
function assertCode(json, what) {
  const code = Number(json && json.code);
  if (code === 0) return json;
  const msg = String((json && (json.message || json.msg)) || '');
  throw new BiliApiError(`${what}失败（code=${code}）：${msg}`, code, json);
}

export function mixinKey(imgKey, subKey) {
  const raw = String(imgKey || '') + String(subKey || '');
  return MIXIN_KEY_ENC_TAB.map((i) => raw[i] || '').join('').slice(0, 32);
}

/** RFC3986：十六进制大写，空格 %20，!'()* 也要转 */
export function encodeRfc3986(v) {
  return encodeURIComponent(String(v)).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

/** wts + w_rid（md5(排序后的 query + mixinKey)） */
export function signWbi(params, key, wts = Math.floor(Date.now() / 1000)) {
  const p = { ...params, wts };
  const query = Object.keys(p)
    .filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== '')
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(p[k])}`)
    .join('&');
  const w_rid = crypto.createHash('md5').update(query + String(key || '')).digest('hex');
  return { query: `${query}&w_rid=${w_rid}`, params: { ...p, w_rid } };
}

function keysFromWbiImg(wbi) {
  const imgKey = String((wbi && wbi.img_url) || '').split('/').pop().split('.')[0];
  const subKey = String((wbi && wbi.sub_url) || '').split('/').pop().split('.')[0];
  return { imgKey, subKey, mixin: mixinKey(imgKey, subKey) };
}

/** 登录态 + 自己的 mid + 当天 WBI 密钥（key 每天轮换，不要在进程里长期缓存） */
export async function getNav(cookie) {
  const json = await requestJson('https://api.bilibili.com/x/web-interface/nav', { cookie });
  const code = Number(json.code);
  if (code === -101) throw new BiliApiError('Cookie 已失效（-101），需要重新登录后粘贴新的 SESSDATA', -101, json);
  if (code !== 0 && code !== -400) assertCode(json, '取登录态');
  const data = json.data || {};
  if (!data.isLogin) throw new BiliApiError('Cookie 没有登录态（isLogin=false），请重新复制 SESSDATA', 'not-login', json);
  return {
    mid: Number(data.mid),
    uname: data.uname || '',
    vip: Boolean(data.vipStatus),
    keys: keysFromWbiImg(data.wbi_img),
  };
}

/** 取自己最近发布的稿件（拿 aid 用）；先走 space/wbi，失败退回创作中心稿件列表接口 */
export async function listMyVideos(cookie, mid, { pn = 1, ps = 5, keys } = {}) {
  const errs = [];
  if (keys) {
    try {
      const base = { mid, ps, pn, order: 'pubdate', platform: 'web', web_location: '1550101', dm_img_list: '[]', dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ', dm_cover_img_str: 'QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgNjMwICgweDAwMDAzRTkyKSBEaXJlY3QzRDExIHZzXzVfMF9wXzVfMCksIEdMRVNf', dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}' };
      const signed = signWbi(base, keys.mixin);
      const json = await requestJson(`https://api.bilibili.com/x/space/wbi/arc/search?${signed.query}`, {
        cookie,
        referer: `https://space.bilibili.com/${mid}/video`,
      });
      assertCode(json, '取稿件列表');
      const vlist = (((json.data || {}).list || {}).vlist) || [];
      if (vlist.length) return vlist.map(videoRow);
    } catch (e) {
      errs.push(e);
    }
  }
  try {
    return await memberArchives(cookie, { pn, ps });
  } catch (e) {
    errs.push(e);
  }
  const last = errs[errs.length - 1];
  throw new BiliApiError(`取不到稿件列表：${errs.map((e) => e.message).join(' / ')}`, last && last.code, last && last.detail);
}

function videoRow(v) {
  return {
    aid: Number(v.aid),
    bvid: v.bvid,
    title: v.title,
    created: Number(v.created || 0),
    length: v.length || '',
    play: Number(v.play || 0),
  };
}

/** 创作中心「稿件管理」列表（只要 Cookie，不用签名） */
async function memberArchives(cookie, { pn = 1, ps = 5 } = {}) {
  const json = await requestJson(
    `https://member.bilibili.com/x/web/archives?status=is_pubing%2Cpubed&pn=${pn}&ps=${ps}&coor=1`,
    { cookie, referer: 'https://member.bilibili.com/platform/upload/video/frame', origin: 'https://member.bilibili.com' }
  );
  assertCode(json, '取稿件列表（创作中心）');
  const d = json.data || {};
  const rows = (d.arc_audits || []).map((x) => (x && x.Archive) || x).concat(d.archives || []);
  return rows.filter((x) => x && x.aid).map(videoRow);
}

/** 拉某个稿件的评论（顶层评论 + 各自带的楼中楼） */
export async function listComments(cookie, oid, { next = 0, keys, mode = 3 } = {}) {
  const paths = ['https://api.bilibili.com/x/v2/reply/wbi/main', 'https://api.bilibili.com/x/v2/reply/main'];
  let lastErr = null;
  for (const url of paths) {
    try {
      let query = '';
      if (url.includes('/wbi/')) {
        if (!keys) throw new BiliApiError('缺少 WBI 密钥', 'no-wbi');
        query = '?' + signWbi({ oid, type: 1, mode, next, ps: 20, plat: 1, web_location: '1315875' }, keys.mixin).query;
      } else {
        query = `?oid=${oid}&type=1&mode=${mode}&next=${next}&ps=20`;
      }
      const json = await requestJson(url + query, { cookie, referer: 'https://www.bilibili.com/' });
      assertCode(json, '拉评论');
      const data = json.data || {};
      const top = (data.top_replies || []).concat(data.replies || []);
      const seen = new Set();
      const list = [];
      for (const r of top) {
        if (!r || seen.has(r.rpid)) continue;
        seen.add(r.rpid);
        list.push(normalizeReply(r));
      }
      return { list, cursor: data.cursor || null, hasMore: Boolean((data.cursor || {}).is_end === false) };
    } catch (e) {
      lastErr = e;
      if (e instanceof BiliApiError && ['-101', -101, '-412', -412, '25004', 25004].includes(e.code)) throw e;
    }
  }
  throw lastErr || new BiliApiError('拉评论失败', 'unknown');
}

export function normalizeReply(r) {
  const member = r.member || {};
  return {
    rpid: Number(r.rpid),
    oid: Number(r.oid),
    root: Number(r.root || r.rpid),
    parent: Number(r.parent || 0),
    mid: Number(member.mid || 0),
    uname: member.uname || '',
    text: String(((r.content || {}).message) || ''),
    like: Number(r.like || 0),
    ctime: Number(r.ctime || 0),
    replies: Array.isArray(r.replies) ? r.replies.map(normalizeReply) : [],
  };
}

/** 回复某条评论：root=根评论 rpid，parent=被回复评论 rpid（漏了会变新评论） */
export async function addReply(cookie, { oid, message, root, parent, bvid, csrf } = {}) {
  const c = typeof cookie === 'string' ? parseCookie(cookie) : cookie || {};
  const token = csrf || c.bili_jct;
  if (!token) throw new BiliApiError('缺少 bili_jct（csrf 参数）', 'no-csrf');
  if (!oid) throw new BiliApiError('缺少 oid（稿件 aid）', 'no-oid');
  const msg = String(message || '').trim();
  if (!msg) throw new BiliApiError('回复内容为空', 'empty-message');
  const referer = bvid ? `https://www.bilibili.com/video/${bvid}` : 'https://www.bilibili.com/';
  const json = await requestJson('https://api.bilibili.com/x/v2/reply/add', {
    method: 'POST',
    cookie: c,
    form: { oid, type: 1, message: msg, root: root || oid, parent: parent || 0, plat: 1, csrf: token },
    referer,
  });
  const code = Number(json.code);
  if (code !== 0) {
    const hint =
      code === -101 ? '登录态失效，重新取 SESSDATA' :
      code === -412 ? '被风控拦截：检查是否带 buvid3、请求频率是否过快' :
      code === 25004 ? '触发风控（25004）：停一段时间再试，不要连续重试' :
      code === -400 ? '参数不对：检查 oid/root/parent' :
      code === 12002 ? '评论已关闭' : '';
    throw new BiliApiError(`发表回复失败（code=${code}）：${json.message || json.msg || ''}${hint ? ' · ' + hint : ''}`, code, json);
  }
  return { ok: true, code, data: json.data || null, rpid: Number(((json.data || {}).rpid) || 0) };
}

/** 这条评论是不是我自己发的 / 我是不是已经在楼里回过了 */
export function answeredByMe(comment, selfMid) {
  if (!comment) return false;
  if (Number(comment.mid) === Number(selfMid)) return true;
  return (comment.replies || []).some((r) => Number(r.mid) === Number(selfMid));
}

export const _internals = { MIXIN_KEY_ENC_TAB, keysFromWbiImg };
