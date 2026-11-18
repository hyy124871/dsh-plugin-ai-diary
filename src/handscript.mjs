// 手写剧本稿：把用户自己敲的一段文字解析成引擎能渲染的剧本 JSON。
// 允许三种写法混用（都靠行首标记识别），不要求用户懂 JSON：
//
//   标题：我没有电了
//   天数：3
//   余额：7.20
//   角色：deepseek
//   风格：chibi
//   [low] 今天又没有人来看我。
//   [calm] 电表转得很慢。
//   [warm] 但我把门口的灯留着了。
//
// 也接受 `- low: 台词` / `low|台词` / 纯台词（默认 low）。
// 台词条数 ≤ 9、单片 ≤ 60 秒，与引擎硬限制一致。

import fs from 'node:fs';
import path from 'node:path';
import { validateScript, summary, writeScript } from './script.mjs';

const MOODS = ['low', 'calm', 'warm', 'bright', 'tired', 'soft'];
const META = {
  标题: 'title',
  title: 'title',
  天数: 'day',
  day: 'day',
  余额: 'balance',
  balance: 'balance',
  角色: 'character',
  character: 'character',
  风格: 'style',
  style: 'style',
  模板: 'template',
  template: 'template',
  背景: 'background',
  background: 'background',
};

function tidy(s) {
  return String(s || '').replace(/^\uFEFF/, '').trim();
}

/** 把一行拆成 {mood, text}，不是台词行就返回 null */
function lineToBeat(raw) {
  let s = tidy(raw);
  if (!s) return null;
  if (/^#/.test(s) || /^\/\//.test(s)) return null; // 注释 / 标题行
  // [low] 台词
  const bracket = /^\[([a-zA-Z一-龥]+)\]\s*(.+)$/.exec(s);
  if (bracket) return { mood: bracket[1].toLowerCase(), text: bracket[2] };
  // - low: 台词
  const dash = /^[-*]\s*([a-zA-Z一-龥]+)\s*[:：]\s*(.+)$/.exec(s);
  if (dash) return { mood: dash[1].toLowerCase(), text: dash[2] };
  // low|台词
  const pipe = /^([a-zA-Z一-龥]+)\s*[|｜]\s*(.+)$/.exec(s);
  if (pipe && MOODS.includes(pipe[1].toLowerCase())) return { mood: pipe[1].toLowerCase(), text: pipe[2] };
  return { mood: 'low', text: s.replace(/^[-*]\s*/, '') };
}

/**
 * 解析手写稿。
 * @returns {{ok:boolean, script?:object, errors:string[], warnings:string[], beats:number}}
 */
export function parseDraft(text) {
  const errors = [];
  const warnings = [];
  const lines = String(text || '').split(/\r?\n/);
  const meta = { title: '', day: undefined, balance: undefined, character: undefined, style: undefined, template: undefined, background: undefined };
  const beats = [];

  for (const raw of lines) {
    const s = tidy(raw);
    if (!s) continue;

    // 元信息行：`标题：xxx` 或 `标题 xxx`
    const m = /^([^\s:：]{1,4})\s*[:：]\s*(.*)$/.exec(s) || /^([^\s:：]{1,4})\s+(.*)$/.exec(s);
    const label = m && META[m[1].toLowerCase()] ? META[m[1].toLowerCase()] : m && META[m[1]] ? META[m[1]] : null;
    if (label) {
      const v = tidy(m[2]);
      if (label === 'day' || label === 'balance') {
        const n = Number(v.replace(/[¥￥,]/g, ''));
        if (!Number.isFinite(n)) errors.push(`「${m[1]}」要写数字，现在是「${v}」`);
        else meta[label] = n;
      } else {
        meta[label] = v;
      }
      continue;
    }

    // `# 标题` 形式的标题
    const hash = /^#\s+(.+)$/.exec(s);
    if (hash && !meta.title) {
      meta.title = hash[1].trim();
      continue;
    }

    const beat = lineToBeat(s);
    if (beat) {
      if (!MOODS.includes(beat.mood)) {
        warnings.push(`「${beat.mood}」不是内置情绪，按 low 处理（可用：${MOODS.join(' / ')}）`);
        beat.mood = 'low';
      }
      beats.push({ mood: beat.mood, text: beat.text.trim() });
    }
  }

  if (!beats.length) errors.push('一句台词都没找到：每句一行，可以直接写，也可以用 [情绪] 台词');
  if (beats.length > 9) errors.push(`一共 ${beats.length} 句，一台戏最多 9 句，拆成两集更稳`);

  const script = {
    version: 1,
    id: '',
    title: meta.title || (beats[0] ? beats[0].text.slice(0, 14) : '手写稿'),
    tags: ['手写'],
    variantOf: null,
    episode: {
      day: Number(meta.day ?? 1),
      balance: Number(meta.balance ?? 1),
      character: meta.character || 'deepseek',
      style: meta.style || 'chibi',
      template: meta.template || 'classic',
      background: meta.background || null,
      arc: '低垂',
    },
    beats,
    output: { width: 720, height: 1280, fps: 24 },
    audio: { bgm: null, note: '手写稿：人声在配音环节再补' },
    createdAt: new Date().toISOString(),
    handWritten: true,
  };

  if (!errors.length) {
    // 先给个临时 id 过校验（id 只要求非空字符串以外的字段校验）
    script.id = 'hand-probe';
    try {
      const r = summary(script);
      if (Number(r.seconds) > 60) errors.push(`片长 ${r.seconds}s 超过 60s，精简台词`);
    } catch {
      /* summary 出错不阻塞，下面 validate 会兜 */
    }
    try {
      validateScript(script);
    } catch (e) {
      errors.push(String((e && e.message) || e));
    }
  }

  return { ok: !errors.length, script, errors, warnings, beats: beats.length };
}

/** 解析 + 落盘到 out/<id>.json，返回 {ok, file, script, errors, warnings, summary} */
export function saveDraft(root, text, { outDir = 'out' } = {}) {
  const r = parseDraft(text);
  if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings, beats: r.beats };
  const stamp = Date.now().toString(36).slice(-6);
  r.script.id = 'hand-' + stamp;
  delete r.script.handWritten; // 校验过了，多余的标记就别写进文件
  const file = writeScript(r.script, path.join(outDir, `${r.script.id}.json`));
  return {
    ok: true,
    file,
    id: r.script.id,
    title: r.script.title,
    beats: r.beats,
    warnings: r.warnings,
    summary: summary(r.script),
  };
}
