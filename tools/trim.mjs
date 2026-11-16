// 裁掉透明 PNG 四周的空边，让立绘在成片里贴合底部与右侧定位。
// 用法：node tools/trim.mjs <输入文件|目录> <输出目录>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas';

export async function trimAlpha(srcFile, dstFile) {
  const img = await loadImage(srcFile);
  const w = img.width, h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('整张图都是透明的：' + srcFile);
  const outW = x1 - x0 + 1, outH = y1 - y0 + 1;
  const out = createCanvas(outW, outH);
  out.getContext('2d').putImageData(new ImageData(data, w, h), -x0, -y0);
  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
  fs.writeFileSync(dstFile, out.toBuffer('image/png'));
  return { file: dstFile, from: `${w}×${h}`, to: `${outW}×${outH}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) { console.error('用法：node tools/trim.mjs <输入文件|目录> <输出目录>'); process.exit(1); }
  const isDir = fs.statSync(src).isDirectory();
  const list = isDir ? fs.readdirSync(src).filter((f) => f.endsWith('.png')).map((f) => path.join(src, f)) : [src];
  for (const f of list) {
    const outFile = isDir ? path.join(dst, path.basename(f)) : dst;
    const r = await trimAlpha(f, outFile);
    console.log(`${path.basename(f)} ${r.from} → ${r.to}`);
  }
}
