// 把 variants 里的新姿势拼成一张总览图，便于人工核对
// 用法：node tools/pose-sheet.mjs <输出 png> [角色…]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAR = path.join(ROOT, 'assets', 'characters', 'transparent', 'variants');
const out = process.argv[2] || path.join(ROOT, 'out', 'check', 'poses-sheet.png');
const only = process.argv.slice(3);

const CHARS = ['deepseek', 'gpt', 'claude', 'gemini', 'grok', 'glm', 'qwen', 'kimi'];
const NEW_LOOKS = (process.env.SHEET_LOOKS || 'v4,v5,v10,v11,v12,v13,v14,v15').split(',');

for (const f of ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf']) {
  if (fs.existsSync(f)) {
    GlobalFonts.registerFromPath(f, 'SheetCJK');
    break;
  }
}

const cols = 6;
const cellW = 300, cellH = 430, pad = 10, labelH = 26;
const rows = Math.ceil((CHARS.length * 2 * 4) / cols); // 保守估计，实际按收集结果重算
const items = [];
for (const c of CHARS) {
  if (only.length && !only.includes(c)) continue;
  for (const l of NEW_LOOKS) {
    const p = path.join(VAR, `${c}_chibi_${l}.png`);
    if (fs.existsSync(p)) items.push({ p, label: `${c} · ${l}` });
  }
}

const realRows = Math.ceil(items.length / cols);
const W = cols * cellW + pad * 2;
const H = realRows * cellH + pad * 2 + 60;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0e1116';
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = '#e8ecf2';
ctx.font = '26px SheetCJK';
ctx.fillText(`AI 日记工坊 · 新姿势总览（${items.length} 张）`, pad + 6, 42);

for (let i = 0; i < items.length; i++) {
  const col = i % cols, row = Math.floor(i / cols);
  const x = pad + col * cellW, y = 60 + pad + row * cellH;
  ctx.fillStyle = '#191e26';
  ctx.fillRect(x + 4, y + 4, cellW - 8, cellH - 8);
  const img = await loadImage(items[i].p);
  const maxW = cellW - 24, maxH = cellH - labelH - 24;
  const s = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, x + (cellW - w) / 2, y + 10 + (maxH - h) / 2, w, h);
  ctx.fillStyle = '#9fb0c4';
  ctx.font = '16px SheetCJK';
  ctx.fillText(items[i].label, x + 12, y + cellH - 14);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`写出 ${out}（${items.length} 张，${W}×${H}）`);
