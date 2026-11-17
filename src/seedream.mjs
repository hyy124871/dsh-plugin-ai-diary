// Seedream 文生图 / 图生图接入（火山方舟 Ark）。
//   POST https://ark.cn-beijing.volces.com/api/v3/images/generations
//   Authorization: Bearer <ARK_API_KEY>
//   body { model, prompt, size, response_format, n, image? }
//   返回 data: [{ url }] 或 [{ b64_json }]
// 用途：给 AI 日记角色补立绘/表情/姿势，或生成 B 站封面底图。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://ark.cn-beijing.volces.com/api/v3';

// 型号 id 随方舟控制台上架会变，这里给的是常见公开 id；设置里可覆盖成任意 id。
// 2026-11 的现状：5.5 是最新一代（原生 RGBA、百轮编辑、文字更准），5.0 pro 强在坐标/图层编辑，
// 5.0 flash 与 pro 能力同级但更快更便宜，4.0 已标注「即将下线」。
export const MODELS = {
  'seedream-5.5': {
    id: 'doubao-seedream-5-5-261028',
    sizes: ['1K', '1.5K', '2K'],
    refs: true,
    note: '最新一代：原生 RGBA 透明素材、最多 100 轮编辑、文字与真实感更强',
  },
  'seedream-5.0-pro': {
    id: 'doubao-seedream-5-0-pro-260628',
    sizes: ['1K', '1.5K', '2K'],
    refs: true,
    note: '支持坐标/框选精准编辑与图层拆分（1 底图 + 16 图层）',
  },
  'seedream-5.0-flash': {
    id: 'doubao-seedream-5-0-flash-260915',
    sizes: ['1K', '1.5K', '2K'],
    refs: true,
    note: '能力与 5.0 pro 同级，速度更快、价格更低',
  },
  'seedream-4.0': {
    id: 'doubao-seedream-4-0-250828',
    sizes: ['1K', '2K', '4K', '1024x1024', '1536x1024', '1024x1536'],
    refs: true,
    note: '旧版，方舟已标注即将下线',
  },
  'seedream-3.0': {
    id: 'doubao-seedream-3-0-t2i-250415',
    sizes: ['1024x1024', '864x1152', '1152x864', '1280x720', '720x1280', '832x1248', '1248x832', '1512x648'],
    refs: false,
    note: '纯文生图',
  },
};

/** 设置里可选的型号清单（面板下拉直接用） */
export function modelOptions() {
  return Object.entries(MODELS).map(([name, s]) => ({ name, id: s.id, note: s.note || '', refs: Boolean(s.refs) }));
}

export function resolveKey(cfg = {}) {
  return process.env.ARK_API_KEY || process.env.SEEDREAM_API_KEY || cfg.apiKey || '';
}

export function resolveModel(name, cfg = {}) {
  if (cfg.model) return cfg.model;
  const m = MODELS[name];
  if (!m) throw new Error(`未知 Seedream 型号 ${name}，可选 ${Object.keys(MODELS).join(' / ')}（或在设置里填自定义 model id）`);
  return m.id;
}

/**
 * 生成图片。
 * refs 非空时走图生图（Seedream 4.0 支持参考图），refs 支持公网 URL 或本地文件（自动转 data URI）。
 */
export async function generate({
  prompt,
  size = '2K',
  model = 'seedream-5.5',
  refs = [],
  n = 1,
  seed,
  watermark = false,
  cfg = {},
} = {}) {
  const key = resolveKey(cfg);
  if (!key) throw new Error('缺少 ARK_API_KEY：Seedream 需要火山方舟的 API Key（设置里填 keys.ark，或环境变量 ARK_API_KEY）');
  if (!prompt || !prompt.trim()) throw new Error('prompt 不能为空');
  if (prompt.length > 3000) throw new Error(`提示词 ${prompt.length} 字，上限 3000`);

  const body = {
    model: resolveModel(model, cfg),
    prompt: prompt.trim(),
    size,
    response_format: 'url',
    n: Math.max(1, Math.min(4, Number(n) || 1)),
  };
  if (!watermark) body.watermark = false;
  if (Number.isFinite(Number(seed))) body.seed = Number(seed);
  if (refs.length) {
    const spec = MODELS[model];
    if (spec && !spec.refs) throw new Error(`${model} 不支持参考图，图生图请换 seedream-5.5 / 5.0 pro / 5.0 flash / 4.0`);
    body.image = refs.map((r) => (/^https?:\/\//i.test(r) ? r : toDataUri(r)));
  }

  const res = await fetch(`${BASE}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Seedream 生成失败 HTTP ${res.status}: ${raw.slice(0, 400)}`);
  let json;
  try { json = JSON.parse(raw); } catch { throw new Error('Seedream 返回非 JSON：' + raw.slice(0, 200)); }

  const items = json.data || [];
  if (!items.length) throw new Error('Seedream 返回里没有图片：' + raw.slice(0, 300));

  const outDir = path.join(ROOT, 'assets', 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const files = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.url) {
      try {
        const buf = Buffer.from(await (await fetch(it.url)).arrayBuffer());
        const f = path.join(outDir, `sd-${stamp}-${i}.png`);
        fs.writeFileSync(f, buf);
        files.push({ file: f, bytes: buf.length, url: it.url });
      } catch {
        files.push({ file: '', url: it.url });
      }
    } else if (it.b64_json) {
      const buf = Buffer.from(it.b64_json, 'base64');
      const f = path.join(outDir, `sd-${stamp}-${i}.png`);
      fs.writeFileSync(f, buf);
      files.push({ file: f, bytes: buf.length });
    }
  }
  return { files, raw: json };
}

/** 本地图片 → data URI（方舟接受 data URI 作为 image 输入） */
export function toDataUri(file) {
  const ext = path.extname(file).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const buf = fs.readFileSync(file);
  if (buf.length > 20 * 1024 * 1024) throw new Error('单张参考图超过 20MB 上限');
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}

export function modelTable() {
  return Object.entries(MODELS).map(([name, s]) => ({
    name,
    id: s.id,
    sizes: s.sizes,
    refs: s.refs,
  }));
}
