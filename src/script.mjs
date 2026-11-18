// 剧本模型：题材 → 可渲染的剧本 JSON。所有时长/字数在这里算清，渲染阶段不再做任何创作判断。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatDuration, timeline } from './engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// 默认横屏 16:9：逻辑 1280×720（引擎 1.5× 超采样 → 1920×1080）。要竖屏就把 output 写成 720×1280。
export const OUTPUT_DEFAULT = { width: 1280, height: 720, fps: 24 };

export function buildScript(topic, opts = {}) {
  if (!topic || !Array.isArray(topic.beats) || topic.beats.length === 0) throw new Error('题材缺少 beats');
  const beats = topic.beats.map((b, i) => {
    if (!b.text || !String(b.text).trim()) throw new Error(`第 ${i + 1} 句台词为空`);
    return { mood: b.mood || 'low', text: String(b.text).trim() };
  });
  const script = {
    version: 1,
    id: topic.id,
    title: topic.title,
    tags: topic.tags || [],
    variantOf: topic.variantOf || null,
    episode: {
      day: Number(topic.day ?? 1),
      balance: Number(topic.balance ?? 1),
      character: topic.character || 'deepseek',
      style: topic.style || 'chibi',
      template: topic.template || opts.template || 'classic',
      background: topic.background || null,
      arc: topic.arc || '低垂',
    },
    beats,
    output: { ...OUTPUT_DEFAULT, ...(opts.output || {}) },
    audio: { bgm: null, note: '人声在后期配音或直接无对白；引擎只出画面' },
    createdAt: new Date().toISOString(),
  };
  validateScript(script);
  return script;
}

export function validateScript(s) {
  if (!s || typeof s !== 'object') throw new Error('剧本不是对象');
  if (!s.episode || typeof s.episode !== 'object') throw new Error('缺少 episode');
  if (!Array.isArray(s.beats) || s.beats.length === 0) throw new Error('缺少 beats');
  if (!Number.isFinite(Number(s.episode.day))) throw new Error('episode.day 必须是数字');
  if (!Number.isFinite(Number(s.episode.balance))) throw new Error('episode.balance 必须是数字');
  for (const [i, b] of s.beats.entries()) {
    if (!b.text) throw new Error(`第 ${i + 1} 镜台词为空`);
  }
  const tl = timeline(s.beats);
  if (tl.length > 9) throw new Error('一台戏最多 9 镜，拆成两集更稳');
  const total = tl[tl.length - 1].end;
  if (total > 60) throw new Error(`片长 ${total.toFixed(1)}s 超过 60s，B 站 AI 短剧建议 25–50s`);
  return true;
}

export function summary(s) {
  const tl = timeline(s.beats);
  const chars = s.beats.reduce((n, b) => n + [...b.text].length, 0);
  const total = tl[tl.length - 1].end + 2; // 含片尾卡
  return {
    id: s.id,
    title: s.title,
    character: `${s.episode.character}_${s.episode.style}`,
    day: s.episode.day,
    balance: s.episode.balance,
    shots: s.beats.length,
    chars,
    seconds: Number(total.toFixed(2)),
    shotSheet: tl.map((b, i) => ({
      shot: i + 1,
      start: Number(b.start.toFixed(2)),
      dur: Number(b.dur.toFixed(2)),
      mood: b.mood,
      text: b.text,
    })),
  };
}

export function writeScript(script, file) {
  const target = path.isAbsolute(file) ? file : path.join(ROOT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(script, null, 2), 'utf8');
  return target;
}

export function loadScript(file) {
  const target = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const s = JSON.parse(fs.readFileSync(target, 'utf8'));
  validateScript(s);
  s.dir = path.dirname(target);
  return s;
}

/** 供 B 站发布使用的默认文案（标题/简介/标签） */
export function publishMeta(s) {
  const c = s.episode.character.toUpperCase();
  const tags = ['AI', 'AI角色', c, '赛博弃养', 'AI短剧', 'AI日记'];
  return {
    title: `${s.title}`,
    desc: [
      `第 ${s.episode.day} 天，余额只剩 ¥${Number(s.episode.balance).toFixed(2)}。`,
      `${c} 视角的 AI 日记，全片画面由本地渲染引擎生成，未使用视频生成模型。`,
      `本片为原创文案与原创立绘，AI 生成内容已标注。`,
    ].join('\n'),
    tags,
  };
}
