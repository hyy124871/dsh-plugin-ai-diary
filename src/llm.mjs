// 文本生成适配：让「自主选材」能真的用模型写台词，而不是套题材库模板。
// 只走用户已经配过 key 的服务商；两家都是 OpenAI 兼容的 chat/completions。
//   ARK        —— 豆包方舟，模型名由用户在设置里给（endpoint id 形式）
//   DASHSCOPE  —— 千问，默认 qwen-plus
// 都不可用时返回 null，由调用方退回本地启发式，绝不让「没配 key」把出片流程堵死。

import { loadSettings } from './settings.mjs';

export const PROVIDERS = {
  dashscope: {
    label: '千问 DashScope',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    env: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
  },
  ark: {
    label: '豆包方舟 ARK',
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    env: 'ARK_API_KEY',
    defaultModel: '',
  },
};

/** 谁能用：返回 {provider, model, key} 或 null */
export function pickProvider(root, settings) {
  const st = settings || loadSettings(root);
  if (st.text && st.text.provider === 'off') return null;
  const order = (st.text && st.text.provider) ? [st.text.provider] : ['dashscope', 'ark'];
  for (const id of order) {
    const p = PROVIDERS[id];
    if (!p) continue;
    const key = process.env[p.env] || (st.keys && st.keys[id]) || '';
    if (!key) continue;
    const model = (st.text && st.text.model) || p.defaultModel;
    if (!model) continue;
    return { provider: id, model, key, url: p.url };
  }
  return null;
}

async function postJson(url, body, key, timeout = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 让模型写一段文本。
 * @returns {Promise<{ok:boolean, text?:string, provider?:string, error?:string}>}
 */
export async function chat(root, { system, user, maxTokens = 800, temperature = 0.9 } = {}) {
  const st = loadSettings(root);
  const p = pickProvider(root, st);
  if (!p) return { ok: false, error: '没配文本模型（dashscope / ark 至少一个）' };
  try {
    const j = await postJson(
      p.url,
      {
        model: p.model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      },
      p.key,
    );
    const text = j?.choices?.[0]?.message?.content;
    if (!text) return { ok: false, error: '模型没返回内容', provider: p.provider };
    return { ok: true, text: String(text).trim(), provider: p.provider, model: p.model };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), provider: p.provider };
  }
}

/** 从模型回答里抠出 JSON（模型爱套 ```json 代码块） */
export function parseJsonLoose(text) {
  if (!text) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fence ? fence[1] : text;
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    return null;
  }
}
