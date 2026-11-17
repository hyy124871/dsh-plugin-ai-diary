// 配音：多服务商适配（小米 MiMo / 千问 DashScope / MiniMax T2A）
// 统一入口 synthesize(text, opts) → Buffer(wav|mp3)，由 ffmpeg 后续统一转码对齐。
//
// 三家接口形态（都按各自官方文档实现，未做凭据内嵌）：
//   小米   POST https://api.xiaomimimo.com/v1/chat/completions       头 api-key，文本放 role=assistant，音频 base64 在 choices[0].message.audio.data
//   千问   POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation  头 Authorization: Bearer，model=qwen3-tts-flash，
//          input={text, voice, language_type}；非流式返回 output.audio.url（也可能是 base64 的 data）
//   MiniMax POST https://api.minimax.cn/v1/t2a_v2                     头 Authorization: Bearer，model=speech-2.8-hd，
//          voice_setting/audio_setting；output_format=hex 时 data.audio 是 hex 编码的音频

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { timeline } from './engine.mjs';

const XIAOMI_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
const QWEN_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const MINIMAX_ENDPOINT = 'https://api.minimax.cn/v1/t2a_v2';

export const PROVIDERS = {
  xiaomi: {
    label: '小米 MiMo',
    keyEnv: 'MIMO_API_KEY',
    endpoint: XIAOMI_ENDPOINT,
    model: 'mimo-v2.5-tts',
    designModel: 'mimo-v2.5-tts-voicedesign',
    models: [
      { id: 'mimo-v2.5-tts', note: '预置音色，按 voice 选' },
      { id: 'mimo-v2.5-tts-voicedesign', note: '按文字描述现造声线，不用挑音色' },
    ],
    voices: ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'],
    defaultVoice: '冰糖',
  },
  qwen: {
    label: '千问 Qwen-TTS',
    keyEnv: 'DASHSCOPE_API_KEY',
    endpoint: QWEN_ENDPOINT,
    model: 'qwen3-tts-flash',
    models: [
      { id: 'qwen3-tts-flash', note: '默认档，7 个常用音色，按字数计费' },
      { id: 'qwen3-tts-flash-realtime', note: '实时流式版，17 种高表现力音色，低延迟' },
    ],
    voices: ['Cherry', 'Serena', 'Ethan', 'Chelsie', 'Dylan', 'Jada', 'Sunny'],
    defaultVoice: 'Cherry',
    note: '单次文本上限 600 字符；音色表以百炼控制台为准',
  },
  minimax: {
    label: 'MiniMax T2A',
    keyEnv: 'MINIMAX_API_KEY',
    endpoint: MINIMAX_ENDPOINT,
    model: 'speech-2.8-hd',
    models: [
      { id: 'speech-2.8-hd', note: '最新一代高清档，2.8 系列语气词更自然' },
      { id: 'speech-2.8-turbo', note: '同代极速档，便宜一半' },
      { id: 'speech-02-hd', note: '上一代高清档' },
      { id: 'speech-02-turbo', note: '上一代极速档，最省' },
    ],
    voices: ['female-shaonv', 'female-yujie', 'female-tianmei', 'male-qn-qingse', 'male-qn-badao', 'presenter_male', 'presenter_female'],
    defaultVoice: 'female-shaonv',
    note: 'speech-2.8 系列支持行内语气词标签，如 (laughs)(sighs)',
  },
};

/** 面板下拉直接用：每家可选的模型 */
export function modelOptions() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    provider: id,
    label: p.label,
    keyEnv: p.keyEnv,
    models: p.models || [{ id: p.model, note: '' }],
    voices: p.voices || [],
    defaultVoice: p.defaultVoice,
  }));
}

export const PRESET_VOICES = PROVIDERS.xiaomi.voices; // 兼容旧调用

// 每个角色在三家各配一色，换服务商也不至于八个人一个嗓
export const CHARACTER_VOICES = {
  xiaomi: { deepseek: '冰糖', gpt: '茉莉', claude: '白桦', gemini: '冰糖', grok: '苏打', glm: '白桦', qwen: '冰糖', kimi: '茉莉' },
  qwen: { deepseek: 'Cherry', gpt: 'Serena', claude: 'Ethan', gemini: 'Chelsie', grok: 'Dylan', glm: 'Ethan', qwen: 'Cherry', kimi: 'Jada' },
  minimax: { deepseek: 'female-shaonv', gpt: 'female-yujie', claude: 'presenter_female', gemini: 'female-tianmei', grok: 'male-qn-badao', glm: 'presenter_male', qwen: 'female-yujie', kimi: 'female-tianmei' },
};

// 小米 voicedesign 模式下按角色描述造声线
export const CHARACTER_VOICE_DESIGN = {
  deepseek: '年轻女性，二十出头，声线偏冷而干净，略带鼻音，语速偏慢，句尾常带一点气声，像深夜独处时低声自语。',
  gpt: '清亮温柔的年轻女声，发音标准克制，句尾轻轻上扬，像在耐心解释一件小事，不慌不忙。',
  claude: '成熟女性，中低音，语速平稳，咬字清晰，带着图书管理员的耐心与体面。',
  gemini: '少年感的活泼女声，音调偏高，语速偏快，句尾轻跳，像随时会笑出来。',
  grok: '尖锐有攻击性的年轻女声，带沙哑颗粒，语速快，尾音短促，透着一股挑衅。',
  glm: '冷静的中性女声，几乎没有情绪起伏，音量偏小，停顿多，克制到近乎冷淡。',
  qwen: '明亮爽利的年轻女声，语速中等偏快，条理清楚，像在会议上一句句落地。',
  kimi: '轻柔、略带气音的少女声，音色偏虚，语速慢，像贴着耳朵说悄悄话。',
};

const MOOD_DIRECTION = {
  panic: '情绪紧绷，呼吸偏浅，咬字快一点，句尾有点抖。',
  low: '情绪低落，语速慢，句与句之间留出明显的停顿。',
  calm: '平静克制，平铺直叙，不要加重音。',
  relief: '松一口气的释然，语速放松，尾音轻轻落下。',
};

export function resolveApiKey(cfg = {}) {
  const p = PROVIDERS[cfg.provider] || PROVIDERS.xiaomi;
  return process.env[p.keyEnv] || cfg.apiKey || '';
}

export function loadVoiceConfig(root) {
  const file = path.join(root, 'config', 'voice.json');
  const base = { provider: 'xiaomi', mode: 'preset', voice: null, perCharacter: true, apiKey: '' };
  if (!fs.existsSync(file)) return base;
  try {
    return { ...base, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    throw new Error('config/voice.json 解析失败：' + e.message);
  }
}

export function voiceFor(provider, character, cfg = {}) {
  if (cfg.voice) return cfg.voice;
  if (cfg.voices && cfg.voices[character]) return cfg.voices[character];
  if (cfg.perCharacter !== false) return CHARACTER_VOICES[provider]?.[character] || PROVIDERS[provider].defaultVoice;
  return PROVIDERS[provider].defaultVoice;
}

function hexToBuffer(hex) {
  const clean = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
  if (clean.length < 8) throw new Error('音频 hex 数据为空或长度异常');
  return Buffer.from(clean, 'hex');
}

/* ---------------- 各家合成实现 ---------------- */

async function synthXiaomi(text, opts) {
  // 选了 voicedesign 型号就算没传 mode 也走描述造声线那条路
  const isDesign = opts.mode === 'design' || /voicedesign/i.test(String(opts.model || ''));
  const body = {
    model: opts.model || (isDesign ? PROVIDERS.xiaomi.designModel : PROVIDERS.xiaomi.model),
    messages: [
      { role: 'user', content: opts.instruction || '自然口语，像日常自言自语。' },
      { role: 'assistant', content: String(text) },
    ],
    audio: isDesign
      ? { format: 'wav', optimize_text_preview: false }
      : { format: 'wav', voice: opts.voice || PROVIDERS.xiaomi.defaultVoice },
  };
  const res = await fetch(opts.endpoint || XIAOMI_ENDPOINT, {
    method: 'POST',
    headers: { 'api-key': opts.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`小米 TTS HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const data = json?.choices?.[0]?.message?.audio?.data;
  if (!data) throw new Error('小米 TTS 返回缺少 choices[0].message.audio.data：' + raw.slice(0, 300));
  return Buffer.from(data, 'base64');
}

async function synthQwen(text, opts) {
  const body = {
    model: opts.model || PROVIDERS.qwen.model,
    input: {
      text: String(text),
      voice: opts.voice || PROVIDERS.qwen.defaultVoice,
      language_type: opts.language || 'Chinese',
    },
  };
  const res = await fetch(opts.endpoint || QWEN_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`千问 TTS HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const audio = json?.output?.audio;
  if (audio?.data) return Buffer.from(audio.data, 'base64');
  if (audio?.url) {
    const r = await fetch(audio.url);
    if (!r.ok) throw new Error(`千问音频下载失败 HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error('千问 TTS 返回缺少 output.audio：' + raw.slice(0, 300));
}

async function synthMinimax(text, opts) {
  const body = {
    model: opts.model || PROVIDERS.minimax.model,
    text: String(text),
    stream: false,
    voice_setting: {
      voice_id: opts.voice || PROVIDERS.minimax.defaultVoice,
      speed: Number(opts.speed ?? 1),
      vol: 1,
      pitch: 0,
      ...(opts.emotion ? { emotion: opts.emotion } : {}),
    },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'wav', channel: 1 },
    output_format: 'hex',
  };
  const res = await fetch(opts.endpoint || MINIMAX_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`MiniMax TTS HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const status = json?.base_resp?.status_code;
  if (status !== undefined && status !== 0) throw new Error(`MiniMax TTS 业务错误 ${status}: ${json?.base_resp?.status_msg || ''}`);
  const audio = json?.data?.audio;
  if (!audio) throw new Error('MiniMax TTS 返回缺少 data.audio：' + raw.slice(0, 300));
  return hexToBuffer(audio);
}

export async function synthesize(text, opts = {}) {
  const provider = PROVIDERS[opts.provider] ? opts.provider : 'xiaomi';
  const key = resolveApiKey(opts);
  const envName = PROVIDERS[provider].keyEnv;
  if (!key) throw new Error(`缺少 ${envName}：${PROVIDERS[provider].label} 需要你自己申请 key，可设环境变量 ${envName} 或写进 config/voice.json 的 apiKey`);
  const merged = { ...opts, provider, apiKey: key, voice: opts.voice || voiceFor(provider, opts.character, opts) };
  if (provider === 'xiaomi') return synthXiaomi(text, merged);
  if (provider === 'qwen') return synthQwen(text, merged);
  return synthMinimax(text, merged);
}

/* ---------------- 音频处理 ---------------- */

function run(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${label} ffmpeg exit ${c}: ${err.slice(-400)}`))));
  });
}

export function audioDuration(ffmpeg, file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', () => {
      const m = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return reject(new Error('读不出音频时长：' + file));
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
  });
}

/** 把一条配音对齐到镜头时长：超长用 atempo 提速（上限 1.6×），不足用 apad 补静音 */
export async function fitShotAudio(ffmpeg, src, want, outFile) {
  const got = await audioDuration(ffmpeg, src);
  if (got > want + 0.05) {
    const tempo = Math.min(1.6, Math.max(1.01, got / want));
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-filter:a', `atempo=${tempo.toFixed(3)}`, '-t', want.toFixed(2), outFile], 'fit');
  } else {
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-af', `apad=pad_dur=${Math.max(0, want - got).toFixed(2)}`, '-t', want.toFixed(2), outFile], 'pad');
  }
  return { got: Number(got.toFixed(2)), want };
}

export async function concatAudio(ffmpeg, files, outFile) {
  const dir = path.dirname(outFile);
  const list = path.join(dir, 'concat.txt');
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  await run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '44100', '-ac', '2', outFile], 'concat');
  return outFile;
}

/** 逐镜合成 + 按镜头时长对齐 + 拼成与成片等长的音轨 */
export async function buildVoiceTrack(script, { root, ffmpeg, outDir, cfg = {}, onProgress } = {}) {
  const tl = timeline(script.beats);
  const provider = PROVIDERS[cfg.provider] ? cfg.provider : 'xiaomi';
  const dir = outDir || path.join(root, 'out', 'voice', script.id);
  fs.mkdirSync(dir, { recursive: true });
  const char = script.episode.character || 'deepseek';
  const pieces = [];
  for (const [i, shot] of tl.entries()) {
    onProgress?.(`配音 ${i + 1}/${tl.length}（${PROVIDERS[provider].label}）：${shot.text.slice(0, 16)}…`);
    const buf = await synthesize(shot.text, {
      ...cfg,
      provider,
      character: char,
      instruction: [CHARACTER_VOICE_DESIGN[char] || CHARACTER_VOICE_DESIGN.deepseek, MOOD_DIRECTION[shot.mood] || MOOD_DIRECTION.low].join(' '),
      emotion: shot.mood === 'panic' ? 'angry' : shot.mood === 'relief' ? 'happy' : undefined,
    });
    const src = path.join(dir, `shot${String(i + 1).padStart(2, '0')}.wav`);
    fs.writeFileSync(src, buf);
    const fitted = path.join(dir, `fit${String(i + 1).padStart(2, '0')}.wav`);
    const fit = await fitShotAudio(ffmpeg, src, shot.dur, fitted);
    pieces.push({ file: fitted, dur: shot.dur, got: fit.got });
  }
  const track = path.join(dir, `${script.id}-voice.wav`);
  await concatAudio(ffmpeg, pieces.map((p) => p.file), track);
  return { track, dir, pieces, total: Number(tl[tl.length - 1].end.toFixed(2)), provider };
}

/** 把音轨混进成片（视频流直接 copy，不重编码画面） */
export async function muxVoice(videoFile, audioFile, outFile, ffmpeg) {
  await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-i', videoFile, '-i', audioFile,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-shortest', '-movflags', '+faststart',
    outFile,
  ], 'mux');
  return outFile;
}

/** 配置自检：列三家 key 就绪情况与默认音色，不发起合成 */
export async function checkConfig(cfg = {}) {
  const rows = Object.entries(PROVIDERS).map(([id, p]) => ({
    provider: id,
    label: p.label,
    keyEnv: p.keyEnv,
    ready: Boolean(process.env[p.keyEnv] || (cfg.apiKey && (cfg.provider || 'xiaomi') === id)),
    model: p.model,
    defaultVoice: p.defaultVoice,
  }));
  const active = cfg.provider || 'xiaomi';
  return {
    ok: rows.some((r) => r.ready),
    active,
    activeReady: rows.find((r) => r.provider === active)?.ready || false,
    mode: cfg.mode || 'preset',
    rows,
    hint: rows.every((r) => !r.ready) ? '三家都还没有 key：MIMO_API_KEY / DASHSCOPE_API_KEY / MINIMAX_API_KEY 任填一个即可' : '',
  };
}
