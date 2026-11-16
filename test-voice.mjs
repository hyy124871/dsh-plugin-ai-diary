// 配音管线离线自检：用 ffmpeg 合成三段假配音，验证「逐镜对齐 → 拼接 → 混流」全链路，
// 不消耗 TTS 额度。跑法：node test-voice.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { findFfmpeg } from './src/engine.mjs';
import { audioDuration, fitShotAudio, concatAudio, muxVoice, checkConfig } from './src/voice.mjs';

const ROOT = path.resolve('.');
const ff = findFfmpeg();
const dir = path.join(ROOT, 'out', 'check', 'voicetest');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const log = (...a) => console.log(...a);
const sh = (args) => execFileSync(ff, args, { stdio: 'pipe' });

// 三段假配音：2.0s / 5.0s / 1.0s，镜头要求 2.0 / 3.0 / 1.5
const cases = [[2.0, 2.0], [5.0, 3.0], [1.0, 1.5]];
const files = [];
cases.forEach(([got, want], i) => {
  const src = path.join(dir, `raw${i + 1}.wav`);
  sh(['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${400 + i * 120}:duration=${got}`, '-ar', '44100', '-ac', '2', src]);
  files.push({ src, want });
});

(async () => {
  const fitted = [];
  for (const [i, f] of files.entries()) {
    const out = path.join(dir, `fit${i + 1}.wav`);
    const r = await fitShotAudio(ff, f.src, f.want, out);
    const d = await audioDuration(ff, out);
    const ok = Math.abs(d - f.want) < 0.12;
    log(`${ok ? 'PASS' : 'FAIL'} 镜${i + 1} 原始 ${r.got}s → 目标 ${r.want}s，实际 ${d.toFixed(2)}s${r.got > r.want ? '（atempo 压缩）' : '（apad 补静音）'}`);
    if (!ok) process.exitCode = 1;
    fitted.push(out);
  }

  const track = path.join(dir, 'track.wav');
  await concatAudio(ff, fitted, track);
  const total = await audioDuration(ff, track);
  const wantTotal = files.reduce((s, f) => s + f.want, 0);
  const ok = Math.abs(total - wantTotal) < 0.2;
  log(`${ok ? 'PASS' : 'FAIL'} 拼接音轨 ${total.toFixed(2)}s（期望 ${wantTotal}s）`);
  if (!ok) process.exitCode = 1;

  // 混流：拿一段 7 秒预览片接上这条音轨
  const video = path.join(ROOT, 'out', 'check', 'audit-look2.mp4');
  if (fs.existsSync(video)) {
    const out = path.join(dir, 'muxed.mp4');
    await muxVoice(video, track, out, ff);
    const probe = spawnSync(ff, ['-i', out, '-f', 'null', '-'], { encoding: 'utf8' });
    const hasAudio = /Audio:/i.test(probe.stderr || '');
    log(`${fs.existsSync(out) && hasAudio ? 'PASS' : 'FAIL'} 混流输出 ${path.relative(ROOT, out)}（${(fs.statSync(out).size / 1024).toFixed(0)} KB，含音轨 ${hasAudio}）`);
  } else {
    log('SKIP 混流：先跑 render --preview 生成 out/check/audit-look2.mp4');
  }

  const c = await checkConfig({});
  log(`${c.ok ? '配置就绪' : '配置缺失'}：${c.ok ? c.keyHint : c.hint}`);
})();
