// AI 日记渲染引擎 —— 纯本地确定性渲染，不调用任何生成模型，不消耗 token。
// 输入一份剧本 JSON，输出 16:9 横屏 MP4（或 PNG 帧序列）；把 output 写成 720×1280 就是竖屏。
// 依赖：@napi-rs/canvas（Skia 绘制）+ ffmpeg（编码）。

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTemplate, makeDust, drawDust, drawTemplatePaper, drawTemplateIntro, drawTemplateOutro, TEMPLATE_IDS } from './templates.mjs';
import { findPlate, FramePlate } from './plate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// 默认横屏 16:9：逻辑坐标 1280×720，scale 1.5 → 真实输出 1920×1080。
// 版面按宽度自适应：字号与 HUD 之类硬编码像素按 UIK = W/720 缩放，竖屏（W=720）时 UIK=1，与旧版逐像素一致。
export const DEFAULTS = { width: 1280, height: 720, fps: 24, scale: 1.5 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/* ---------- 编码器：CPU（libx264）/ GPU（NVENC→QSV→AMF） ---------- */
// 每种硬件编码器的质量参数不同，统一折算到「视觉上接近 x264 crf17」的档位。
const GPU_CANDIDATES = [
  { codec: 'h264_nvenc', label: 'NVIDIA NVENC', args: ['-preset', 'p5', '-rc', 'vbr', '-cq', '17', '-b:v', '0', '-profile:v', 'high'] },
  { codec: 'h264_qsv', label: 'Intel QSV', args: ['-global_quality', '15', '-look_ahead', '0', '-profile:v', 'high'] },
  { codec: 'h264_amf', label: 'AMD AMF', args: ['-quality', 'quality', '-rc', 'cqp', '-qp_i', '16', '-qp_p', '18'] },
];

let _gpuProbe;

/** 探测本机可用的硬件编码器；没有就返回 null。结果缓存，重复调用不再试跑。 */
export function detectGpuEncoder(ffmpegPath) {
  if (_gpuProbe !== undefined) return _gpuProbe;
  for (const c of GPU_CANDIDATES) {
    try {
      execSync(
        `"${ffmpegPath}" -hide_banner -loglevel error -f lavfi -i color=c=black:s=320x240:r=1:d=1 -frames:v 1 -c:v ${c.codec} -f null -`,
        { stdio: 'pipe', timeout: 20000 },
      );
      _gpuProbe = c;
      return c;
    } catch {
      /* 这个硬件编码器不可用，试下一个 */
    }
  }
  _gpuProbe = null;
  return null;
}

/**
 * 生成 ffmpeg 视频编码参数。
 * accelerator: 'cpu' 强制 x264 | 'gpu' 强制硬件（不可用则回落 x264）| 'auto' 有硬件就用
 */
export function videoCodecArgs(ffmpegPath, opts = {}) {
  const accel = String(opts.accelerator || 'auto').toLowerCase();
  const cpuArgs = ['-c:v', 'libx264', '-preset', String(opts.preset || 'medium'), '-crf', String(opts.crf ?? 17), '-profile:v', 'high', '-level', '4.1'];
  if (accel === 'cpu') return cpuArgs;
  const gpu = detectGpuEncoder(ffmpegPath);
  if (gpu) return ['-c:v', gpu.codec, ...gpu.args];
  if (accel === 'gpu') console.warn('[ai-diary] 未检测到可用的硬件编码器，已回落 CPU（libx264）');
  return cpuArgs;
}

/** 当前实际会用的编码器名，给 status/面板显示 */
export function describeAccelerator(ffmpegPath, accel = 'auto') {
  const a = String(accel || 'auto').toLowerCase();
  if (a === 'cpu') return 'CPU (libx264)';
  const gpu = detectGpuEncoder(ffmpegPath);
  if (gpu) return `${gpu.label} (${a})`;
  return 'CPU (libx264，未检测到硬件编码器)';
}

/* ---------- 时长规则（与网页版工坊一致） ---------- */
export function beatDuration(text, mood) {
  const n = [...String(text)].length;
  const base = clamp(1.05 + n * 0.30, 3.2, 9);
  if (mood === 'panic') return base * 0.94;
  if (mood === 'calm') return base * 1.06;
  if (mood === 'relief') return base * 1.10;
  return base;
}

export function timeline(beats) {
  let t = 0;
  return beats.map((b, i) => {
    const dur = beatDuration(b.text, b.mood);
    const seg = { index: i, start: t, dur, end: t + dur, text: b.text, mood: b.mood || 'low' };
    t += dur;
    return seg;
  });
}

export function totalSeconds(script) {
  const tl = timeline(script.beats);
  return tl.length ? tl[tl.length - 1].end : 0;
}

/* ---------- 字体 ---------- */
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/msyhbd.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
];
let fontFamily = 'sans-serif';
let fontLoaded = false;
function ensureFont() {
  if (fontLoaded) return fontFamily;
  fontLoaded = true;
  for (const f of FONT_CANDIDATES) {
    if (!fs.existsSync(f)) continue;
    try {
      GlobalFonts.registerFromPath(f, 'DiarySans');
      fontFamily = 'DiarySans';
      break;
    } catch { /* 换下一个 */ }
  }
  return fontFamily;
}

/* ---------- 素材解析 ---------- */
export function assetPaths(episode, script = {}, opts = {}) {
  const charId = episode.character || 'deepseek';
  const style = episode.style || 'chibi';
  const bgMap = {
    night: 'backgrounds/night-sky.png',
    warm: 'backgrounds/warm-card.png',
    rain: 'backgrounds/rain-night.png',
    dusk: 'backgrounds/dusk-room.png',
    sakura: 'backgrounds/sakura-night.png',
    blank: 'backgrounds/blank-card.png',
    report: 'backgrounds/report-desk.png',
    dossier: 'backgrounds/dossier-room.png',
    terminal: 'backgrounds/terminal-desk.png',
    audit: 'backgrounds/audit-room.png',
    specimen: 'backgrounds/specimen-lab.png',
    platform: 'backgrounds/train-platform.png',
    ember: 'backgrounds/ember-room.png',
  };
  // 模板族优先用专属底板：旧题材里写死的 night/warm 等槽位不再压模板
  const tplDef = getTemplate(episode.template || 'chat');
  const legacyBg = ['night', 'warm', 'rain', 'dusk', 'sakura', 'blank'];
  const chosenBg = (tplDef.id !== 'classic' && (!episode.background || legacyBg.includes(episode.background)))
    ? tplDef.bg
    : (episode.background || tplDef.bg || 'night');
  const res = (p) => path.join(ROOT, 'assets', p);
  // 立绘：剧本可指定 look（v2/v3…）换一套模样，不指定就用原版，避免旧片风格漂移
  const lookFile = episode.look
    ? res(`characters/transparent/variants/${charId}_${style}_${episode.look}.png`)
    : null;
  const charFile = script.assets?.character
    ? path.resolve(script.dir || ROOT, script.assets.character)
    : (lookFile && fs.existsSync(lookFile) ? lookFile : res(`characters/transparent/${charId}_${style}.png`));
  const charFallback = res(`characters/${charId}_${style}.png`);
  return {
    character: fs.existsSync(charFile) ? charFile : charFallback,
    background: (() => {
      const bg = bgMap[chosenBg] || bgMap.night;
      const f = res(bg);
      return fs.existsSync(f) ? f : null;
    })(),
    // 动态底板：assets/plates/<名字>/ 帧目录存在就优先当背景层
    // 优先级：命令行 --plate → 剧本里的 plate → 剧本背景槽位同名底板 → 模板 id
    plate: findPlate(ROOT, opts.plate)
      || findPlate(ROOT, episode.plate)
      || findPlate(ROOT, episode.background)
      || findPlate(ROOT, tplDef.id),
  };
}

/* ---------- 绘图工具 ---------- */
function coverDraw(ctx, img, W, H, zoom = 1, dx = 0, dy = 0) {
  const s = Math.max(W / img.width, H / img.height) * zoom;
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
}

function makeNoise(W, H) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  let seed = 20261114;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < W * H; i++) {
    const v = 128 + (rnd() - 0.5) * 60;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function makeStars(W, H, count = 90) {
  let seed = 7717;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: count }, () => ({
    x: rnd() * W, y: rnd() * H * 0.78, r: 0.6 + rnd() * 1.9, p: rnd() * Math.PI * 2, sp: 0.25 + rnd() * 0.9,
  }));
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of [...text]) {
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/* ---------- 主渲染 ---------- */
// 避免出现「只有一两个字」的孤行：从上一行末尾补几个字下来
function wrapBalanced(ctx, text, maxWidth) {
  const lines = wrapText(ctx, text, maxWidth);
  if (lines.length >= 2) {
    for (let i = lines.length - 2; i >= 0; i--) {
      while ([...lines[i + 1]].length < 3 && [...lines[i]].length > 4) {
        const prev = [...lines[i]];
        const moved = prev.pop();
        lines[i] = prev.join('');
        lines[i + 1] = moved + lines[i + 1];
      }
    }
  }
  return lines;
}

// 画面方向决定逻辑画布：横屏 1280×720 / 竖屏 720×1280。opts.orientation 优先于剧本里写死的 output。
export const ORIENT_WH = { landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } };

export function resolveSize(script, opts = {}) {
  const orient = opts.orientation === 'portrait' || opts.orientation === 'landscape' ? opts.orientation : null;
  const base = orient ? ORIENT_WH[orient] : DEFAULTS;
  return {
    width: opts.width || (orient ? base.width : script.output?.width || DEFAULTS.width),
    height: opts.height || (orient ? base.height : script.output?.height || DEFAULTS.height),
  };
}

export async function renderEpisode(script, opts = {}) {
  ensureFont();
  // 画面方向：显式 opts.orientation 优先（设置里的 render.orientation 会传进来），
  // 其次看剧本自己写死的 output 尺寸，最后回默认横屏。
  const { width: W, height: H } = resolveSize(script, opts);
  const FPS = opts.fps || script.output?.fps || DEFAULTS.fps;
  const S = Math.max(1, Number(opts.scale ?? script.output?.scale ?? DEFAULTS.scale) || 1);
  const OW = Math.round(W * S);
  const OH = Math.round(H * S);

  const ep = opts.template
    ? { ...(script.episode || {}), template: opts.template, background: null }
    : (script.episode || {});
  const tl = timeline(script.beats);
  const total = tl.length ? tl[tl.length - 1].end + 2.0 : 2.0; // 片尾 2s
  const renderTotal = opts.maxSeconds ? Math.min(total, opts.maxSeconds) : total;
  const framesAll = Math.max(1, Math.round(renderTotal * FPS));
  // 分段并行：只渲染 [frameStart, frameEnd) 这一段，其他逻辑（时间轴、片头片尾）都按绝对帧号算，
  // 所以每一段拼回去和单片渲染逐帧一致。
  const f0 = Math.max(0, Math.floor(Number(opts.frameStart) || 0));
  const f1 = Math.min(framesAll, Math.floor(Number(opts.frameEnd) || framesAll));
  const frames = Math.max(1, f1 - f0);

  const { character, background, plate } = opts.assetPaths || assetPaths(ep, script, opts);
  const charImg = character && fs.existsSync(character) ? await loadImage(character) : null;
  const bgImg = background && fs.existsSync(background) ? await loadImage(background) : null;

  // 动态底板：帧目录存在就用，缺了就退回静态底图
  const plateReader = plate && fs.existsSync(plate) ? new FramePlate(plate, OW, OH) : null;

  const canvas = createCanvas(OW, OH);
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S); // 之后所有绘制都用逻辑坐标（横屏 1280×720 / 竖屏 720×1280）
  const noise = makeNoise(96, 96);
  const stars = makeStars(W, H, 80);
  const dust = makeDust(W, H);
  const tpl = getTemplate(ep.template || opts.template || script.template || 'chat');
  // 版面自适应系数：竖屏 720 宽 = 1（与 0.9.x 逐像素一致），横屏 1280 宽 = 1.78
  const UIK = W / 720;

  const outFile = opts.out || path.join(ROOT, 'out', `${script.id || 'episode'}.mp4`);
  const pngDir = opts.pngDir || null;
  if (pngDir) fs.mkdirSync(pngDir, { recursive: true });

  const ffmpegPath = opts.ffmpeg || findFfmpeg();
  let encoder = null;
  if (!pngDir) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    // 编码器按设置选：cpu=libx264（画质最好），gpu=硬件编码（快 3–5 倍），auto=有硬件就用
    encoder = spawn(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OW}x${OH}`, '-framerate', String(FPS), '-i', '-',
      ...videoCodecArgs(ffmpegPath, opts),
      // 分段并行时每段要限线程，否则 N 个 x264 互相抢核反而更慢
      ...(Number(opts.threads) > 0 ? ['-threads', String(Number(opts.threads))] : []),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outFile,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    const errBuf = [];
    encoder.stderr.on('data', d => errBuf.push(d));
    encoder.on('close', code => { if (code !== 0) console.error('ffmpeg error', Buffer.concat(errBuf).toString().slice(0, 2000)); });
  }

  const totalChars = tl.reduce((s, b) => s + [...b.text].length, 0);
  const balance = Number(ep.balance ?? 1);
  const day = String(ep.day ?? 1).padStart(2, '0');
  const charName = (ep.character || 'deepseek').toUpperCase();
  const moodColor = { calm: '#8FD6C4', low: '#7FA8C9', panic: '#E08A4B', relief: '#C8B6EE' };

  for (let k = 0; k < frames; k++) {
    const i = f0 + k;
    const t = i / FPS;
    const prog = t / total;

    // 每帧重置绘图状态：canvas 是复用的，上一帧片头/片尾残留的 globalAlpha 会污染整帧
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // 当前镜与「已显示字数 → 余额」进度（模板卡与 HUD 都要用）
    const cur = tl.find(b => t >= b.start && t < b.end) || tl[tl.length - 1] || { mood: 'low', text: '', start: 0, dur: 1, index: 0 };
    const shownChars = (() => {
      let c = 0;
      for (const b of tl) { if (t >= b.end) c += [...b.text].length; else if (t >= b.start) c += [...b.text].length * ((t - b.start) / b.dur); }
      return c;
    })();
    const spentRatio = totalChars ? shownChars / totalChars : 0;
    const remain = Math.max(0, balance * (1 - spentRatio * 0.97));

    // 1) 背景（动态底板优先；没有就静态底图缓推）
    ctx.fillStyle = tpl.bg === 'ember' ? '#1A0B07' : '#050B16';
    ctx.fillRect(0, 0, W, H);
    if (plateReader) {
      const img = await plateReader.at(t);
      // 底板本身已经动了，这里 1:1 贴上，不做二次缩放（省掉逐帧重采样）
      ctx.drawImage(img, 0, 0, W, H);
    } else if (bgImg) coverDraw(ctx, bgImg, W, H, 1.02 + 0.05 * prog, 0, -6 * prog);
    else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      if (tpl.bg === 'ember') {
        // 暗红棕暖雾：对应 chat 模板的参考背景
        g.addColorStop(0, '#3B1B14'); g.addColorStop(0.55, '#24120C'); g.addColorStop(1, '#0E0705');
      } else {
        g.addColorStop(0, '#071426'); g.addColorStop(0.55, '#0B1A2E'); g.addColorStop(1, '#050B16');
      }
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (tpl.bg === 'ember') {
        // 左上暖光斑（参考图的壁灯/窗光）
        const wg = ctx.createRadialGradient(W * 0.20, -H * 0.12, 0, W * 0.20, -H * 0.12, W * 0.95);
        wg.addColorStop(0, 'rgba(255,160,96,0.26)');
        wg.addColorStop(0.5, 'rgba(255,126,74,0.10)');
        wg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);
      }
    }

    // 2) 星点（仅原版星空模板）
    if (tpl.id === 'classic') {
      for (const s of stars) {
        const a = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * s.sp + s.p));
        ctx.fillStyle = `rgba(190,220,255,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 2.4) 背景暗角：只压背景，纸卡画在它上面，卡面保持干净
    const vgBg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
    vgBg.addColorStop(0, 'rgba(0,0,0,0)');
    vgBg.addColorStop(1, tpl.id === 'chat' ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vgBg; ctx.fillRect(0, 0, W, H);

    // 2.5) 模板纸面（报告卡 / 档案卡 / 终端面板）—— 画在背景之上、立绘之下
    drawTemplatePaper(ctx, tpl, {
      W, H, t, prog, ep, tl, cur, script,
      day, remain, balance, charName, fontFamily,
      beatIndex: cur ? cur.index : 0,
      mood: cur ? cur.mood : 'low',
    });

    // 3) 角色（呼吸 / 浮动 / 轻摆）—— 位姿跟随模板：原版居中，模板族靠右让出纸面
    if (charImg) {
      const h = H * tpl.char.hR;
      const w = (charImg.width / charImg.height) * h;
      const cx = W * tpl.char.xr;
      const breathe = 1 + 0.009 * Math.sin(t * 1.85);
      const floatY = Math.sin(t * 1.25) * 3.2;
      const sway = Math.sin(t * 0.9) * 0.35 * Math.PI / 180;
      const footY = H * tpl.char.footR;
      ctx.save();
      ctx.translate(cx, footY + floatY);
      ctx.rotate(sway);
      ctx.scale(1, breathe);
      ctx.drawImage(charImg, -w / 2, -h, w, h);
      ctx.restore();

      // 底部接地阴影（人物脚下一圈）
      const sh = ctx.createRadialGradient(cx, footY, 0, cx, footY, w * 0.72);
      sh.addColorStop(0, 'rgba(0,0,0,0.38)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh;
      ctx.save(); ctx.translate(0, footY); ctx.scale(1, 0.18); ctx.translate(0, -footY);
      ctx.beginPath(); ctx.arc(cx, footY, w * 0.72, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 3.5) 尘埃（模板族的空气感，随光柱缓慢上浮）
    if (tpl.id !== 'classic') {
      drawDust(ctx, W, H, t, dust, tpl.id === 'terminal' ? '150,235,225' : '240,225,200');
    }

    // 4) 情绪光：只有原版 classic 用（模板族的氛围已经在背景图和背景暗角里，纸卡不再被二次压暗）
    if (tpl.id === 'classic') {
      const moodRGB = cur.mood === 'panic' ? '224,138,75' : cur.mood === 'relief' ? '200,182,238' : '110,150,200';
      const moodAlpha = 0.10;
      const outAlpha = 0.55;
      const lg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, W * 0.95);
      lg.addColorStop(0, `rgba(${moodRGB},${moodAlpha})`);
      lg.addColorStop(1, `rgba(0,0,0,${outAlpha})`);
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    }

    // 5) 顶部 HUD（仅原版模板；模板族的状态面板画在纸卡里）
    if (tpl.hud === 'classic') {
    ctx.save();
    ctx.globalAlpha = 0.92;
    // DAY 徽章
    ctx.fillStyle = 'rgba(6,16,30,0.72)';
    roundRect(ctx, 26 * UIK, 30 * UIK, 118 * UIK, 44 * UIK, 10 * UIK); ctx.fill();
    ctx.fillStyle = '#CFE0F2'; ctx.font = `600 ${15 * UIK}px ${fontFamily}`; ctx.textBaseline = 'middle';
    ctx.fillText('DAY', 42 * UIK, 52 * UIK);
    ctx.fillStyle = '#7FE0CF'; ctx.font = `700 ${22 * UIK}px ${fontFamily}`;
    ctx.fillText(day, 92 * UIK, 52 * UIK);

    // 余额面板
    const px = W - 26 * UIK - 190 * UIK;
    ctx.fillStyle = 'rgba(6,16,30,0.72)';
    roundRect(ctx, px, 30 * UIK, 190 * UIK, 64 * UIK, 12 * UIK); ctx.fill();
    ctx.fillStyle = '#8FA6BF'; ctx.font = `600 ${11 * UIK}px ${fontFamily}`;
    ctx.fillText('BALANCE', px + 14 * UIK, 46 * UIK);
    ctx.fillStyle = remain < 3 && Math.sin(t * 6.2) > 0 ? '#FF9B7B' : '#7FE0CF';
    ctx.font = `700 ${26 * UIK}px ${fontFamily}`;
    ctx.fillText('¥' + remain.toFixed(2), px + 14 * UIK, 70 * UIK);
    // 电量条
    const barW = 160 * UIK, barH = 5 * UIK;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, px + 14 * UIK, 80 * UIK, barW, barH, 2.5 * UIK); ctx.fill();
    const ratio = Math.max(0, remain / Math.max(balance, 1));
    ctx.fillStyle = remain < 3 ? '#E08A4B' : '#5FD6C0';
    roundRect(ctx, px + 14 * UIK, 80 * UIK, Math.max(2, barW * ratio), barH, 2.5 * UIK); ctx.fill();
    ctx.restore();
    }

    // 6) 台词（打字机）—— 片头卡 / 片尾卡期间不画，避免和标题叠字
    if (tpl.id === 'chat') {
      // 对话卡模板：台词已经在左侧卡里逐字打出来，底部只放本集标题（参考图的底部大字）
      if (t >= 1.4 && t <= total - 1.9) {
        const tfs = Math.round(20 * UIK);
        ctx.font = `700 ${tfs}px ${fontFamily}`;
        const tLines = wrapBalanced(ctx, script.title || 'AI 日记', W * 0.72);
        const lh = tfs * 1.34;
        const baseY = H * tpl.subtitle.yR - (tLines.length - 1) * lh;
        // 轻底衬，只压暗画面下缘，不糊卡片
        const bandTop = H * 0.72;
        const bg = ctx.createLinearGradient(0, bandTop, 0, H);
        bg.addColorStop(0, 'rgba(10,5,3,0)');
        bg.addColorStop(0.45, 'rgba(10,5,3,0.34)');
        bg.addColorStop(1, 'rgba(10,5,3,0.62)');
        ctx.fillStyle = bg; ctx.fillRect(0, bandTop, W, H - bandTop);
        ctx.textAlign = 'center';
        tLines.forEach((ln, idx) => {
          const y = baseY + idx * lh;
          ctx.fillStyle = tpl.subtitle.shadow;
          ctx.fillText(ln, W / 2 + 2, y + 2);
          ctx.fillStyle = tpl.subtitle.color;
          ctx.fillText(ln, W / 2, y);
        });
        ctx.textAlign = 'left';
      }
    } else if (cur && t >= 1.4 && t <= total - 1.9) {
      const inBeat = (t - cur.start) / cur.dur;
      const chars = [...cur.text];
      const shown = clamp(Math.floor(chars.length * Math.min(1, inBeat * 1.25)), 0, chars.length);
      const txt = chars.slice(0, shown).join('');
      const fsBase = tpl.id === 'classic' ? 32 : 31;
      const fs = Math.round(fsBase * (W >= H ? 1.25 : 1)); // 横屏画面宽，字幕略放大才压得住，但不吃掉画面
      ctx.font = `500 ${fs}px ${fontFamily}`;
      const lines = wrapBalanced(ctx, txt, W * (tpl.id === 'classic' ? 0.86 : 0.82));
      const lh = fs * 1.45;
      const lastY = H * tpl.subtitle.yR;
      const baseY = lastY - (lines.length - 1) * lh;
      // 文字底衬（横屏字幕更高，带上沿要上移，否则多行会盖到立绘）
      const bandTopR = W >= H ? 0.80 : tpl.subtitle.bandTopR;
      const bandTop = H * bandTopR;
      const bg = ctx.createLinearGradient(0, bandTop, 0, H * Math.min(1, bandTopR + tpl.subtitle.bandBottom));
      bg.addColorStop(0, 'rgba(3,9,18,0)');
      bg.addColorStop(0.30, tpl.id === 'classic' ? 'rgba(3,9,18,0.58)' : 'rgba(6,4,3,0.60)');
      bg.addColorStop(1, tpl.id === 'classic' ? 'rgba(3,9,18,0.80)' : 'rgba(6,4,3,0.82)');
      ctx.fillStyle = bg; ctx.fillRect(0, bandTop, W, H * tpl.subtitle.bandBottom);
      ctx.textAlign = 'center';
      lines.forEach((ln, idx) => {
        const y = baseY + idx * lh;
        ctx.fillStyle = tpl.subtitle.shadow;
        ctx.fillText(ln, W / 2 + 1.5, y + 1.5);
        ctx.fillStyle = tpl.subtitle.color;
        ctx.fillText(ln, W / 2, y);
      });
      // 说话人（只在竖屏画：横屏画面矮，字幕已经贴近底部，再塞一行会压住字幕与进度条）
      if (W < H) {
        const speakerY = tpl.id === 'classic' ? 0.962 : 0.947;
        ctx.font = `600 ${Math.round(12 * UIK)}px ${fontFamily}`;
        ctx.fillStyle = tpl.id === 'classic' ? (moodColor[cur.mood] || '#8FA6BF') : tpl.accent;
        ctx.fillText(`${charName} · AI DIARY`, W / 2, H * speakerY);
      }
      ctx.textAlign = 'left';
    }

    // 7) 底部进度 ticks
    tl.forEach((b, idx) => {
      const tw = (W - 52 * UIK) / tl.length - 6;
      const x = 26 * UIK + idx * ((W - 52 * UIK) / tl.length);
      ctx.fillStyle = t >= b.end ? 'rgba(127,224,207,0.75)' : t >= b.start ? 'rgba(127,224,207,0.35)' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, H - (W >= H ? 13 : 24), tw, 3);
    });

    // 8) 颗粒（暗角已经压在背景层，卡片不再被二次压暗）
    ctx.globalAlpha = 0.05;
    ctx.drawImage(noise, 0, 0, W, H);
    ctx.globalAlpha = 1;

    // 9) 片头卡
    if (t < 1.4) {
      const handled = drawTemplateIntro(ctx, tpl, { W, H, t, ep, script, fontFamily, wrapBalanced });
      if (!handled) {
      const a = t < 0.55 ? t / 0.55 : t < 0.95 ? 1 : 1 - (t - 0.95) / 0.45;
      ctx.fillStyle = `rgba(3,8,16,${(0.93 * a).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7FE0CF'; ctx.font = `600 ${Math.round(13 * UIK)}px ${fontFamily}`;
      ctx.fillText('AI DIARY · 第 ' + Number(ep.day ?? 1) + ' 天', W / 2, H * (W >= H ? 0.16 : 0.20));
      ctx.fillStyle = '#F2F7FB'; ctx.font = `700 ${Math.round(32 * (W >= H ? 1.2 : UIK))}px ${fontFamily}`;
      const titleLines = wrapBalanced(ctx, script.title || 'AI 日记', W * 0.80);
      const topY = H * (W >= H ? 0.27 : 0.26);
      const lineH = W >= H ? 52 : 46 * UIK;
      titleLines.forEach((ln, i) => ctx.fillText(ln, W / 2, topY + i * lineH));
      ctx.fillStyle = 'rgba(127,224,207,0.85)'; ctx.font = `500 ${Math.round(14 * UIK)}px ${fontFamily}`;
      ctx.fillText('余额 ¥' + Number(ep.balance ?? 1).toFixed(2) + ' · 共 ' + Number(ep.day ?? 1) + ' 天', W / 2, topY + titleLines.length * lineH + 18 * UIK);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
      }
    }

    // 10) 片尾卡
    if (t > total - 1.9) {
      const handled = drawTemplateOutro(ctx, tpl, { W, H, t, total, remain, fontFamily });
      if (!handled) {
      const a = clamp((t - (total - 1.9)) / 0.7, 0, 1);
      ctx.fillStyle = `rgba(3,8,16,${(0.90 * a).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = a; ctx.textAlign = 'center';
      ctx.fillStyle = '#8FA6BF'; ctx.font = `600 ${Math.round(15 * UIK)}px ${fontFamily}`;
      ctx.fillText('未完待续', W / 2, H * 0.40);
      ctx.fillStyle = 'rgba(127,224,207,0.9)'; ctx.font = `500 ${Math.round(12 * UIK)}px ${fontFamily}`;
      ctx.fillText('AI DIARY · 余额 ' + '¥' + remain.toFixed(2), W / 2, H * 0.44);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
      }
    }

    // 输出
    if (pngDir) {
      fs.writeFileSync(path.join(pngDir, `f_${String(i).padStart(4, '0')}.png`), await canvas.encode('png'));
    } else {
      // 直接吐 RGBA 像素给 ffmpeg，跳过逐帧 PNG 压缩（实测快 3–4 倍）
      // getImageData 用物理像素，不受 ctx.scale 影响 —— 这里必须是放大后的尺寸
      const img = ctx.getImageData(0, 0, OW, OH);
      const buf = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
      if (!encoder.stdin.write(buf)) await new Promise(r => encoder.stdin.once('drain', r));
    }
    if (k % 48 === 0 && opts.onProgress) opts.onProgress(k / frames);
  }

  if (encoder) {
    encoder.stdin.end();
    await new Promise((resolve, reject) => {
      encoder.on('close', c => (c === 0 ? resolve() : reject(new Error('ffmpeg exit ' + c))));
    });
  }
  return { file: pngDir ? null : outFile, frames, seconds: Number((frames / FPS).toFixed(2)), width: OW, height: OH, logicalWidth: W, logicalHeight: H, scale: S, fps: FPS };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- ffmpeg 定位 ---------- */
export function findFfmpeg() {
  if (process.env.DIARY_FFMPEG && fs.existsSync(process.env.DIARY_FFMPEG)) return process.env.DIARY_FFMPEG;
  const vendored = path.join(ROOT, 'vendor', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(vendored)) return vendored;
  try {
    const sys = execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg', { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    if (sys) return sys;
  } catch { /* 继续 */ }
  try {
    const py = execSync('python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"', { encoding: 'utf8' }).trim();
    if (py && fs.existsSync(py)) return py;
  } catch { /* 继续 */ }
  throw new Error('找不到 ffmpeg：可设置环境变量 DIARY_FFMPEG，或把 ffmpeg.exe 放到 vendor/ 下，或 pip install imageio-ffmpeg');
}
