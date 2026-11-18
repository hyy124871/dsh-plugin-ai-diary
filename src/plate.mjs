// 动态底板读取：底板存成「帧目录」assets/plates/<name>/f_0001.jpg ... + meta.json。
// 运行时按时间索引取一帧、用小 LRU 缓存已解码的图。
// 比 ffmpeg 管道逐帧读更稳：没有进程间延迟、没有大 buffer、内存只留最近几帧。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadImage } from '@napi-rs/canvas';

export const PLATE_FPS = 12;

export function findPlate(root, name) {
  if (!name) return null;
  const dir = path.isAbsolute(name) ? name : path.join(root, 'assets', 'plates', name);
  if (!fs.existsSync(dir)) return null;
  const stat = fs.statSync(dir);
  if (stat.isDirectory()) {
    const meta = path.join(dir, 'meta.json');
    return fs.existsSync(meta) ? dir : null;
  }
  return null; // 旧的单文件 mp4 不再直接使用，先跑一次 plate 命令转成帧目录
}

export class FramePlate {
  constructor(dir, W, H) {
    this.dir = dir;
    this.W = W; this.H = H;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    this.fps = Number(meta.fps) || PLATE_FPS;
    this.count = Number(meta.frames) || fs.readdirSync(dir).filter(f => /^f_\d+\.jpg$/.test(f)).length;
    this.cache = new Map(); // idx -> Image
    this.order = [];
  }

  fileFor(idx) {
    return path.join(this.dir, `f_${String(idx + 1).padStart(4, '0')}.jpg`);
  }

  async at(t) {
    const idx = Math.round(t * this.fps) % this.count;
    const hit = this.cache.get(idx);
    if (hit) return hit;
    const img = await loadImage(this.fileFor(idx));
    this.cache.set(idx, img);
    this.order.push(idx);
    while (this.order.length > 6) {
      const old = this.order.shift();
      if (old !== idx) this.cache.delete(old);
    }
    return img;
  }
}

export function openPlate(root, name, W, H) {
  const dir = findPlate(root, name);
  if (!dir) return null;
  try {
    return new FramePlate(dir, W, H);
  } catch {
    return null;
  }
}

/** 把一段视频或一张静帧转成底板帧目录（默认 1920×1080 横屏，跟成片同规格，渲染时不再二次放大） */
export function buildPlateFrames({ from, dir, ffmpeg, width = 1920, height = 1080, seconds = 8, fps = PLATE_FPS, zoom = 0.0007 }) {
  if (!from || !fs.existsSync(from)) throw new Error('找不到素材：' + from);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^f_\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(dir, f));

  const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(from);
  const frames = Math.round(seconds * fps);
  let vf;
  if (isVideo) {
    vf = `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  } else {
    const scale = `${Math.round(width * 1.5)}:${Math.round(height * 1.5)}`;
    vf = [
      `scale=${scale}`,
      `zoompan=z='1.02+${zoom}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
      `eq=brightness='0.015*sin(t*1.1)'`,
      `noise=alls=5:allf=t+u`,
    ].join(',');
  }
  const outPattern = path.join(dir, 'f_%04d.jpg');
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
    .concat(isVideo ? [] : ['-loop', '1'])
    .concat(['-i', from, '-vf', vf, '-frames:v', String(frames), '-q:v', '3', outPattern]);
  execFileSync(ffmpeg, args, { stdio: 'pipe' });

  const written = fs.readdirSync(dir).filter(f => /^f_\d+\.jpg$/.test(f)).length;
  const meta = { source: path.basename(from), fps, frames: written, width, height, seconds: Number((written / fps).toFixed(2)), builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}
