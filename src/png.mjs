import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * 极简 PNG 解码：只支持 8bit 的 RGB / RGBA（截图都是这两种）。
 * 返回 { width, height, data }，data 是 RGBA 的 Uint8Array。
 */
export function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const dataStart = pos + 8;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      if (buf[dataStart + 12] !== 0) throw new Error('不支持隔行扫描 PNG');
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`不支持的 PNG 格式：bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      }
      line[i] = v;
    }

    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      out[di] = line[si];
      out[di + 1] = line[si + 1];
      out[di + 2] = line[si + 2];
      out[di + 3] = channels === 4 ? line[si + 3] : 255;
    }
    prev = line;
  }

  return { width, height, data: out };
}

/** 在区域里找「竖向厚度足够」的蓝色块（B 站按钮是实心蓝底，输入框只是细蓝边） */
export function findBlueButton({ width, height, data }, box, opts = {}) {
  const rMax = opts.rMax ?? 110;
  const gMin = opts.gMin ?? 110;
  const bMin = opts.bMin ?? 170;
  const minColHits = opts.minColHits ?? 14;

  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(width - 1, box.x + (box.w || width));
  const y1 = Math.min(height - 1, box.y + (box.h || height));

  const cols = new Int32Array(x1 - x0 + 2);
  const sumY = new Float64Array(x1 - x0 + 2);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < rMax && data[i + 1] > gMin && data[i + 2] > bMin) {
        const k = x - x0;
        cols[k] += 1;
        sumY[k] += y;
      }
    }
  }

  const runs = [];
  let start = -1;
  for (let k = 0; k < cols.length; k++) {
    if (cols[k] >= minColHits) {
      if (start < 0) start = k;
    } else if (start >= 0) {
      runs.push([start, k - 1]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, cols.length - 1]);
  if (!runs.length) return null;

  let best = runs[0];
  for (const r of runs) if (r[1] - r[0] > best[1] - best[0]) best = r;

  let tot = 0;
  let totY = 0;
  for (let k = best[0]; k <= best[1]; k++) {
    tot += cols[k];
    totY += sumY[k];
  }
  if (!tot) return null;

  return {
    x: Math.round(x0 + (best[0] + best[1]) / 2),
    y: Math.round(totY / tot),
    w: best[1] - best[0],
    h: Math.round(tot / (best[1] - best[0] + 1)),
    count: tot,
  };
}
