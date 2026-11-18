// 单把 key 的连通性测试：优先用各家的「列模型」类只读端点（零费用），
// 没有这种端点的（小米 TTS / MiniMax / 方舟）发一个必然参数错误的畸形请求，
// 靠状态码判断鉴权过没过 —— 401/403 是 key 不对，400/404/422 说明 key 已被接受。

import { loadSettings, SECRETS } from './settings.mjs';

const TIMEOUT = 12000;

/** 状态码 → 结论 */
function verdict(status, hint) {
  if (status === 200 || status === 201) return { ok: true, state: 'key-ok', hint: hint || '鉴权通过' };
  if (status === 401 || status === 403) return { ok: false, state: 'key-bad', hint: 'key 无效或没有权限' };
  if (status === 402) return { ok: false, state: 'no-credit', hint: 'key 有效，但账户没额度了' };
  if (status === 429) return { ok: false, state: 'limited', hint: 'key 有效，但被限流了，等一会儿再试' };
  if (status === 400 || status === 404 || status === 405 || status === 422)
    return { ok: true, state: 'key-ok', hint: (hint ? hint + '；' : '') + `鉴权通过（HTTP ${status} 是参数/模型错误，不是 key 的问题）` };
  if (status === 0) return { ok: false, state: 'network', hint: '网络不通（开了系统代理的话，Node 不会自动走代理）' };
  return { ok: false, state: 'unknown', hint: `HTTP ${status}` };
}

async function hit(url, { method = 'GET', key, body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: key ? `Bearer ${key}` : 'none',
        'Content-Type': 'application/json',
        'User-Agent': 'dsh-plugin-ai-diary',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - t0, text: text.slice(0, 220) };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { status: 0, ms: Date.now() - t0, text: msg, network: true };
  } finally {
    clearTimeout(timer);
  }
}

/** 每家怎么测 */
const PROBES = {
  dashscope: {
    label: '千问 DashScope',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    method: 'GET',
    hint: '列模型（不消耗额度）',
  },
  deepseek: {
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/models',
    method: 'GET',
    hint: '列模型（不消耗额度）',
  },
  github: {
    label: 'GitHub',
    url: 'https://api.github.com/user',
    method: 'GET',
    hint: '读当前用户（只动一次 API 额度）',
  },
  ark: {
    label: '火山方舟 ARK',
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    method: 'POST',
    body: { model: 'ep-keyprobe-not-exist', messages: [{ role: 'user', content: '1' }], max_tokens: 1 },
    hint: '故意用一个不存在的接入点，只看鉴权',
  },
  mimo: {
    label: '小米 MiMo',
    url: 'https://api.xiaomimimo.com/v1/chat/completions',
    method: 'POST',
    body: { model: 'mimo-v2.5-tts', messages: [] },
    hint: '故意发空 messages，只看鉴权',
  },
  minimax: {
    label: 'MiniMax',
    url: 'https://api.minimax.cn/v1/t2a_v2',
    method: 'POST',
    body: { model: 'speech-2.8-hd', text: '' },
    hint: '故意发空文本，只看鉴权',
  },
};

function keyFor(st, field) {
  const envName = SECRETS[field];
  return { key: process.env[envName] || String((st.keys && st.keys[field]) || ''), source: process.env[envName] ? 'env' : 'file' };
}

/**
 * 测一把 key。
 * @returns {Promise<{field,label,ok,state,hint,status,ms,source}>}
 */
export async function testKey(root, field, { settings } = {}) {
  const st = settings || loadSettings(root);
  const envName = SECRETS[field];
  const found = keyFor(st, field);
  const base = { field, env: envName, source: found.source, status: 0, ms: 0 };

  if (!envName) return { ...base, ok: false, state: 'unknown-field', hint: '没有这个字段' };
  if (!found.key) return { ...base, ok: false, state: 'empty', hint: '还没填 key' };

  // B 站不是 Bearer 体系，走 nav 接口看登录态
  if (field === 'bili') {
    const t0 = Date.now();
    const r = await hit('https://api.bilibili.com/x/web-interface/nav', { key: '' });
    const ms = Date.now() - t0;
    let login = false;
    try {
      login = JSON.parse(r.text).data.isLogin === true;
    } catch {}
    if (r.status === 0) return { ...base, ok: false, state: 'network', hint: '网络不通', ms, status: 0 };
    if (!login) return { ...base, ok: false, state: 'cookie-bad', hint: 'Cookie 未登录或已过期（重扫一次二维码最稳）', ms, status: r.status };
    return { ...base, ok: true, state: 'key-ok', hint: 'Cookie 有效，已登录', ms, status: r.status };
  }

  const p = PROBES[field];
  if (!p) return { ...base, ok: false, state: 'no-probe', hint: '这把 key 没有可用的探测端点' };

  const r = await hit(p.url, { method: p.method, key: found.key, body: p.body });
  const v = verdict(r.status, p.hint);
  return { ...base, ...v, label: p.label, status: r.status, ms: r.ms, detail: r.text };
}

/** 一次测全部，返回每把一条 */
export async function testAllKeys(root, { settings } = {}) {
  const st = settings || loadSettings(root);
  const fields = Object.keys(SECRETS);
  const rows = await Promise.all(fields.map((f) => testKey(root, f, { settings: st })));
  return {
    ok: rows.every((r) => r.ok || r.state === 'empty'),
    rows,
    summary: {
      total: rows.length,
      passed: rows.filter((r) => r.ok).length,
      failed: rows.filter((r) => !r.ok && r.state !== 'empty').length,
      empty: rows.filter((r) => r.state === 'empty').length,
    },
  };
}
