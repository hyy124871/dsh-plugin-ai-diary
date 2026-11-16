// 白底立绘 → 透明 PNG：从四边泛洪填充（只吃掉连到画布边缘的白色），
// 人物内部的白色（白裙、白发、白鳞）因为有线稿包围而不会被吃掉。
// 用法：node tools/matte.mjs <输入目录|文件> <输出目录> [--tol 20] [--trim]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas';

export async function matteWhite(srcFile, dstFile, { tol = 20, feather = 1, trim = true } = {}) {
  const img = await loadImage(srcFile);
  const w = img.width, h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // 背景判据：接近纯白（三通道都 >= 255-tol，且彩度低）
  const isWhite = (i) => {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const min = Math.min(r, g, b), max = Math.max(r, g, b);
    return min >= 255 - tol && max - min <= 18;
  };

  const total = w * h;
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qs = 0, qe = 0;
  const push = (x, y) => {
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (isWhite(p * 4)) queue[qe++] = p;
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  while (qs < qe) {
    const p = queue[qs++];
    const x = p % w, y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  // 泛洪区内 alpha 归零；再把边界做一圈软过渡，避免锯齿
  const alpha = new Uint8Array(total);
  for (let p = 0; p < total; p++) alpha[p] = seen[p] ? 0 : 255;
  for (let f = 0; f < feather; f++) {
    const next = Uint8Array.from(alpha);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (alpha[p] === 0) {
          // 一个不透明邻居 → 半透明，柔化轮廓
          if (alpha[p - 1] === 255 || alpha[p + 1] === 255 || alpha[p - w] === 255 || alpha[p + w] === 255) next[p] = 128;
        }
      }
    }
    alpha.set(next);
  }
  for (let p = 0; p < total; p++) px[p * 4 + 3] = alpha[p];

  // 裁掉四周空透明边，减少成片里的定位偏差
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  if (trim) {
    const solid = (x, y) => px[(y * w + x) * 4 + 3] > 8;
    while (x0 < w - 1 && !Array.from({ length: h }, (_, y) => solid(x0, y)).some(Boolean)) x0++;
    while (x1 > x0 && !Array.from({ length: h }, (_, y) => solid(x1, y)).some(Boolean)) x1--;
    while (y0 < h - 1 && !Array.from({ length: w }, (_, x) => solid(x, y0)).some(Boolean)) y0++;
    while (y1 > y0 && !Array.from({ length: w }, (_, x) => solid(x, y1)).some(Boolean)) y1--;
  }

  const outW = x1 - x0 + 1, outH = y1 - y0 + 1;
  const out = createCanvas(outW, outH);
  const octx = out.getContext('2d');
  octx.putImageData(new ImageData(px, w, h), -x0, -y0);
  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
  fs.writeFileSync(dstFile, out.toBuffer('image/png'));
  return { file: dstFile, size: `${outW}×${outH}`, from: `${w}×${h}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [src, dst] = process.argv.slice(2);
  const tol = Number((process.argv.find((a) => a.startsWith('--tol=')) || '--tol=20').split('=')[1]);
  if (!src || !dst) { console.error('用法：node tools/matte.mjs <输入文件|目录> <输出目录> [--tol=20]'); process.exit(1); }
  const list = fs.statSync(src).isDirectory()
    ? fs.readdirSync(src).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).map((f) => path.join(src, f))
    : [src];
  for (const f of list) {
    const outFile = fs.statSync(src).isDirectory() ? path.join(dst, path.basename(f)) : dst;
    const r = await matteWhite(f, outFile, { tol });
    console.log(`${path.basename(f)} → ${path.relative(process.cwd(), r.file)}  ${r.from} → ${r.size}`);
  }
}
