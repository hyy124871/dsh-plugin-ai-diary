// 角色动态素材（5 秒循环短片）管理：把用户生成的 Seedance 角色短片收进插件，
// 并在需要时转成 9:16 动态底板给 render 当背景层。
//
// 目录：assets/characters/motion/<角色>-loop.mp4 + manifest.json（记录时长/尺寸/来源）
// 约束：引擎只能把整段视频转成底板（plate），不支持把视频里的角色单独抠出来叠加到立绘位。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MOTION_DIR = ['assets', 'characters', 'motion'];
export const CHARACTERS = ['deepseek', 'gpt', 'gemini', 'claude', 'grok', 'glm', 'qwen', 'kimi'];

export function motionRoot(root) {
  return path.join(root, ...MOTION_DIR);
}

export function manifestPath(root) {
  return path.join(motionRoot(root), 'manifest.json');
}

export function readManifest(root) {
  const f = manifestPath(root);
  if (!fs.existsSync(f)) return { clips: {} };
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return { clips: {} };
  }
}

export function writeManifest(root, data) {
  const f = manifestPath(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
  return f;
}

/** 用 ffmpeg 读时长/分辨率/帧率（仓库里只带了 ffmpeg，没有 ffprobe） */
export function probeVideo(ffmpeg, file) {
  let txt = '';
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: 'pipe' });
  } catch (e) {
    txt = String(e.stderr || e.stdout || '');
  }
  const dur = (txt.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/) || []);
  const seconds = dur.length ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null;
  const vs = (txt.match(/Video:[\s\S]*?(\d{2,5})x(\d{2,5})/) || []);
  const fps = (txt.match(/(\d+(?:\.\d+)?)\s*fps/) || [])[1] || null;
  return {
    seconds: seconds ? Number(seconds.toFixed(2)) : null,
    width: vs[2] ? Number(vs[1] || vs[2]) : null,
    height: vs[2] ? Number(vs[2]) : null,
    fps: fps ? Number(fps) : null,
  };
}

/** 收一段短片进插件：复制到 assets/characters/motion/ 并写 manifest */
export function importClip({ root, from, character, name, ffmpeg, note }) {
  if (!from || !fs.existsSync(from)) throw new Error('找不到素材文件：' + from);
  if (!CHARACTERS.includes(character)) throw new Error(`角色只能是 ${CHARACTERS.join(' / ')}，收到 ${character}`);
  const dir = motionRoot(root);
  fs.mkdirSync(dir, { recursive: true });
  const slug = String(name || 'loop').replace(/[^a-z0-9-]/gi, '') || 'loop';
  const target = path.join(dir, `${character}-${slug}.mp4`);
  if (path.resolve(from) !== path.resolve(target)) fs.copyFileSync(from, target);
  const meta = probeVideo(ffmpeg, target);
  const data = readManifest(root);
  data.clips[`${character}-${slug}`] = {
    character,
    key: `${character}-${slug}`,
    file: path.relative(root, target).replace(/\\/g, '/'),
    bytes: fs.statSync(target).size,
    ...meta,
    source: path.basename(from),
    note: note || '',
    importedAt: new Date().toISOString(),
  };
  writeManifest(root, data);
  return data.clips[`${character}-${slug}`];
}

/** 列出现有短片（manifest + 目录实际文件对齐） */
export function listClips(root) {
  const data = readManifest(root);
  const dir = motionRoot(root);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')) : [];
  const out = [];
  for (const f of files) {
    const key = f.replace(/\.mp4$/, '');
    const m = data.clips[key] || {};
    out.push({ key, file: path.join(dir, f), have: true, ...m, bytes: fs.statSync(path.join(dir, f)).size });
  }
  const missing = CHARACTERS.filter((c) => !out.some((o) => o.character === c || o.key.startsWith(c)));
  return { clips: out, missing };
}
