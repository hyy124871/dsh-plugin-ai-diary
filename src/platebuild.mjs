// 把一张静帧做成 8 秒动态底板 MP4：缓慢推近 + 轻微颗粒 + 光照微颤。
// 不消耗任何生成额度；Seedance 成片回来时，同名覆盖 assets/plates/<模板>.mp4 即可热替换。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildPlate({ from, out, seconds = 8, width = 720, height = 1280, fps = 24, ffmpeg, zoom = 0.0007 }) {
  if (!from || !fs.existsSync(from)) throw new Error('找不到底图：' + from);
  const ff = ffmpeg || path.join(ROOT, 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const frames = Math.round(seconds * fps);
  const scale = `${Math.round(width * 1.5)}:${Math.round(height * 1.5)}`;
  const vf = [
    `scale=${scale}`,
    `zoompan=z='1.02+${zoom}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
    `eq=brightness='0.015*sin(t*1.1)'`,
    `noise=alls=5:allf=t+u`,
    'format=yuv420p',
  ].join(',');
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', from, '-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', out];
  execFileSync(ff, args, { stdio: 'pipe' });
  return { file: out, seconds, frames, width, height, fps };
}
