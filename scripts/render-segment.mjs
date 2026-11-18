// 并行渲染的段渲染子进程：只画 [frame-start, frame-end) 这一段，直接喂给 ffmpeg 编成 .ts。
// 由 src/parallel.mjs 拉起，不要手动调用。
import fs from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};

const scriptFile = flag('script');
if (!scriptFile) {
  console.error('缺少 --script');
  process.exit(2);
}

const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
const { renderEpisode } = await import('../src/engine.mjs');

const opts = {
  out: flag('out'),
  frameStart: Number(flag('frame-start', 0)),
  frameEnd: Number(flag('frame-end', 0)) || undefined,
  fps: Number(flag('fps', 0)) || undefined,
  width: Number(flag('width', 0)) || undefined,
  height: Number(flag('height', 0)) || undefined,
  scale: flag('scale') ? Number(flag('scale')) : undefined,
  orientation: flag('orientation') || undefined,
  template: flag('template'),
  look: flag('look'),
  maxSeconds: flag('max-seconds') ? Number(flag('max-seconds')) : undefined,
  threads: flag('threads') ? Number(flag('threads')) : undefined,
  accelerator: flag('accelerator'),
  onProgress: (ratio) => console.log('PROGRESS ' + ratio.toFixed(4)),
};

const r = await renderEpisode(script, opts);
console.log('DONE ' + JSON.stringify({ file: r.file, frames: r.frames }));
