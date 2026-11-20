// 分段并行渲染：把整片按帧切成 N 段，每段用独立子进程画 + 编码，
// 最后 ffmpeg concat 无损拼接。画的部分吃满多核 CPU，编码也并行。
//
// 为什么要分段：单进程里 Skia 逐帧绘制是纯 CPU 串行（一帧 1080p 要几十毫秒），
// 而 ffmpeg 的 x264 本身已经多线程了 —— 真正卡住时间的是画，不是编。
// 分段之后 N 段同时画，总时间大致按核数下降；每段用同样的编码参数，拼回去逐帧一致。
//
// 约束：只有不落 PNG 的直出路径才能并行（pngDir 模式只做单片渲染）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, timeline, renderEpisode, resolveSize, findFfmpeg } from './engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 单段最少帧数：段太短时进程启动与资源加载的开销会盖过并行收益 */
const MIN_FRAMES_PER_SEG = 48;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    const err = [];
    const out = [];
    p.stdout?.on('data', (d) => out.push(d));
    p.stderr?.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve({ out: Buffer.concat(out).toString(), err: Buffer.concat(err).toString() });
      reject(new Error(`${path.basename(cmd)} exit ${code}: ${Buffer.concat(err).toString().slice(-800)}`));
    });
  });
}

/** 决定并行段数：设置值优先，0/未设 = 自动（核数的一半，最多 4 段） */
export function decideWorkers(script, opts = {}, setting = 0) {
  const want = Number(opts.workers ?? setting ?? 0);
  if (want > 0) return Math.max(1, Math.min(16, Math.floor(want)));
  const cpus = (os.cpus() || []).length || 4;
  const accel = String(opts.accelerator || 'auto').toLowerCase();
  // 瓶颈始终在 Skia 绘制（纯 CPU），所以 GPU 模式也要并行画；
  // 实测 1080p 36s 片：GPU 4 段 34.2s，GPU 2 段 43.0s，CPU 4 段 65.6s。
  if (accel === 'gpu') return Math.max(1, Math.min(4, Math.floor(cpus / 2) || 2));
  return Math.max(1, Math.min(4, Math.floor(cpus / 2) || 1));
}

/** 与 renderEpisode 一致地算出总帧数，用来切段 */
export function totalFrames(script, opts = {}) {
  const fps = Number(opts.fps || script.output?.fps || DEFAULTS.fps);
  const tl = timeline(script.beats);
  const total = tl.length ? tl[tl.length - 1].end + 2.0 : 2.0;
  const renderTotal = opts.maxSeconds ? Math.min(total, opts.maxSeconds) : total;
  return Math.max(1, Math.round(renderTotal * fps));
}

/**
 * 并行渲染。
 * @returns 同 renderEpisode，多一个 segments 字段
 */
export async function renderEpisodeParallel(script, opts = {}) {
  const frames = totalFrames(script, opts);
  const workers = decideWorkers(script, opts, opts.workerSetting || 0);
  const per = Math.ceil(frames / workers);

  // 段太短、只要求一核、或要走 PNG 序列：老老实实单片
  if (workers <= 1 || per < MIN_FRAMES_PER_SEG || opts.pngDir) {
    const r = await renderEpisode(script, opts);
    return { ...r, segments: 1 };
  }

  const outFile = opts.out || path.join(ROOT, 'out', `${script.id || 'episode'}.mp4`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmpDir = path.join(path.dirname(outFile), `.seg-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const scriptFile = path.join(tmpDir, 'script.json');
  fs.writeFileSync(scriptFile, JSON.stringify(script), 'utf8');

  const segRunner = path.join(ROOT, 'scripts', 'render-segment.mjs');
  const segs = [];
  for (let i = 0; i < workers; i++) {
    const f0 = i * per;
    if (f0 >= frames) break;
    segs.push({ i, f0, f1: Math.min(frames, f0 + per), file: path.join(tmpDir, `seg_${i}.ts`) });
  }

  const started = Date.now();
  let done = 0;
  const offsets = segs.map((s) => s.f0);
  const { width: segW, height: segH } = resolveSize(script, opts);
  const progress = (segIdx, ratio) => {
    if (!opts.onProgress) return;
    // 用帧号近似总进度：按各段起点加权
    const approx = (offsets[segIdx] + ratio * (segs[segIdx].f1 - segs[segIdx].f0)) / frames;
    opts.onProgress(Math.min(0.99, approx));
  };

  await Promise.all(
    segs.map(
      (s) =>
        new Promise((resolve, reject) => {
          const args = [
            segRunner,
            '--script', scriptFile,
            '--out', s.file,
            '--frame-start', String(s.f0),
            '--frame-end', String(s.f1),
            '--fps', String(opts.fps || script.output?.fps || DEFAULTS.fps),
            '--width', String(segW),
            '--height', String(segH),
            '--scale', String(opts.scale ?? script.output?.scale ?? DEFAULTS.scale),
          ];
          if (opts.orientation) args.push('--orientation', String(opts.orientation));
          if (opts.template) args.push('--template', String(opts.template));
          if (opts.look) args.push('--look', String(opts.look));
          if (opts.maxSeconds) args.push('--max-seconds', String(opts.maxSeconds));
          if (opts.accelerator) args.push('--accelerator', String(opts.accelerator));
          const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT });
          const err = [];
          p.stdout.on('data', (d) => {
            const m = /PROGRESS ([0-9.]+)/.exec(String(d));
            if (m) progress(s.i, Number(m[1]));
          });
          p.stderr.on('data', (d) => err.push(d));
          p.on('error', reject);
          p.on('close', (code) => {
            if (code === 0) {
              done++;
              progress(s.i, 1);
              return resolve();
            }
            reject(new Error(`段 ${s.i} 渲染失败（exit ${code}）：${Buffer.concat(err).toString().slice(-600)}`));
          });
        }),
    ),
  );

  // concat：mpegts 段 + -c copy 最稳（每段 GOP 独立，不重编码、不掉帧）
  const listFile = path.join(tmpDir, 'list.txt');
  fs.writeFileSync(listFile, segs.map((s) => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  const ffmpeg = opts.ffmpeg || findFfmpeg();
  await run(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy', '-movflags', '+faststart',
    outFile,
  ]);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  const sw = Number(opts.scale ?? script.output?.scale ?? DEFAULTS.scale) || 1;
  const { width: rw, height: rh } = resolveSize(script, opts);
  return {
    file: outFile,
    frames,
    seconds: Number((frames / (opts.fps || script.output?.fps || DEFAULTS.fps)).toFixed(2)),
    width: Math.round(rw * sw),
    height: Math.round(rh * sw),
    fps: opts.fps || script.output?.fps || DEFAULTS.fps,
    scale: Number(opts.scale ?? script.output?.scale ?? DEFAULTS.scale) || 1,
    segments: segs.length,
    elapsed: Number(((Date.now() - started) / 1000).toFixed(1)),
  };
}
