// 题材引擎：本地选题，不调用 LLM，不消耗 token。
// 规则：优先选没做过的题材 → 再看角色是否可用 → 允许换角色做变体 → 记录历史避免重复。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'topics.json');
const HISTORY = path.join(ROOT, 'out', 'history.json');

export const CHARACTERS = [
  { id: 'deepseek', name: 'DeepSeek', sub: '蓝鲸娘' },
  { id: 'gpt', name: 'ChatGPT', sub: '白龙娘' },
  { id: 'gemini', name: 'Gemini', sub: '猫娘' },
  { id: 'claude', name: 'Claude', sub: '克劳姬' },
  { id: 'grok', name: 'Grok', sub: '战斧' },
  { id: 'glm', name: 'GLM', sub: 'Z 小姐' },
  { id: 'qwen', name: 'Qwen', sub: '折扇' },
  { id: 'kimi', name: 'Kimi', sub: '月牙' },
];

export function loadTopics() {
  return JSON.parse(fs.readFileSync(DATA, 'utf8')).topics;
}

function readHistory() {
  try {
    const h = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
    return Array.isArray(h.done) ? h : { done: [] };
  } catch {
    return { done: [] };
  }
}

export function recordPick(topicId) {
  const h = readHistory();
  h.done.push({ id: topicId, at: new Date().toISOString() });
  h.done = h.done.slice(-200);
  fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
  fs.writeFileSync(HISTORY, JSON.stringify(h, null, 2), 'utf8');
}

// 确定性随机，便于复现
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

/**
 * 选题。
 * @param {object} o
 * @param {number} [o.count=1] 需要几个
 * @param {string} [o.character] 指定主角
 * @param {boolean} [o.fresh=true] 是否避开历史里做过的
 * @param {number} [o.seed] 指定随机种子
 */
export function pickTopics({ count = 1, character, fresh = true, seed } = {}) {
  let pool = loadTopics();
  if (character) pool = pool.filter(t => t.character === character);
  if (fresh) {
    const used = new Set(readHistory().done.map(d => d.id));
    const unused = pool.filter(t => !used.has(t.id));
    if (unused.length) pool = unused;
  }
  const r = rng(seed ?? Date.now());
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export function listTopics() {
  return loadTopics().map(t => ({
    id: t.id,
    title: t.title,
    character: t.character,
    day: t.day,
    balance: t.balance,
    beats: t.beats.length,
    tags: t.tags,
  }));
}

/**
 * 变体：把同一套情绪骨架换一个主角，少量改写文案里的指代。
 * 用于"同一个题材，八个角色各演一遍"的连播。
 */
export function variantOf(topic, { character, day, balance } = {}) {
  const c = CHARACTERS.find(x => x.id === character);
  if (!character || !c) throw new Error('变体需要合法的 character');
  return {
    ...topic,
    id: `${topic.id}--${character}`,
    title: `${topic.title}（${c.name} 篇）`,
    character,
    day: day ?? topic.day,
    balance: balance ?? topic.balance,
    variantOf: topic.id,
  };
}

export function characterOf(id) {
  return CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
}
