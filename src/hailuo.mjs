// MiniMax H3 视频生成（异步任务：创建 → 轮询 → 下载）
// 文档 https://platform.minimaxi.com/docs/guides/video-generation
//   POST /v2/video_generation          body {model, content:[...], duration, resolution, ratio?}
//   GET  /v2/query/video_generation/{task_id}  → task.status / task.content.url
// 模型：MiniMax-H3（768P/2K，4–15s，支持首尾帧与多模态参考）；MiniMax-H3-Max（480P/768P，5–15s，仅 T2V/I2V）

import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://api.minimax.cn';

/**
 * H3 系列全档模型（价格取自官方价目表，单位 ¥/秒输出）。
 * tier 只是给人看的档位说明；reference = 是否支持多模态参考图。
 */
export const MODELS = {
  'MiniMax-H3': {
    resolutions: ['768P', '2K'],
    duration: [4, 15],
    reference: true,
    tier: '旗舰 · 画质优先',
    price: { '768P': 0.50, '2K': 0.80 },
  },
  'MiniMax-H3-Highspeed': {
    resolutions: ['480P', '768P'],
    duration: [4, 15],
    reference: true,
    tier: '旗舰 · 兼顾速度',
    price: { '480P': 0.26, '768P': 0.40 },
  },
  'MiniMax-H3-Lite': {
    resolutions: ['480P', '768P'],
    duration: [4, 15],
    reference: false,
    tier: '旗舰 · 低成本批量',
    price: { '480P': 0.16, '768P': 0.26 },
  },
  'MiniMax-H3-Max': {
    resolutions: ['480P', '768P'],
    duration: [5, 15],
    reference: true,
    tier: '扩展 · 图文音多素材',
    price: { '480P': 0.33, '768P': 0.50 },
  },
  'MiniMax-H3-Regeneration': {
    resolutions: ['2K'],
    duration: [4, 15],
    reference: true,
    regen: true,
    tier: '再生 · 768P 视频升 2K',
    price: { '2K': 0.30 },
  },
};

/** H3 档位速查表，给 status / 工具说明用 */
export function modelTable() {
  return Object.entries(MODELS).map(([name, s]) => ({
    name,
    tier: s.tier,
    resolutions: s.resolutions,
    duration: `${s.duration[0]}–${s.duration[1]}s`,
    reference: s.reference,
    price: Object.entries(s.price).map(([r, p]) => `${r} ¥${p.toFixed(2)}/s`).join(' · '),
    regen: Boolean(s.regen),
  }));
}

export const MOOD_PROMPTS = {
  drift: '镜头极缓慢向前推进（dolly-in），整体氛围稳定，没有人物进出画面，只有轻微的光线流动与尘埃浮动。',
  push: '镜头缓慢横向平移（truck right）后再轻微下摇，保持空间纵深与材质细节。',
};

export function resolveKey(cfg = {}) {
  return process.env.MINIMAX_API_KEY || cfg.apiKey || '';
}

/** 校验参数，返回可提交的 body；不做网络请求 */
export function buildPayload({ prompt, firstFrameUrl, lastFrameUrl, refImageUrls = [], duration = 8, resolution = '768P', model = 'MiniMax-H3', ratio, sourceVideoUrl }) {
  const spec = MODELS[model];
  if (!spec) throw new Error(`未知模型 ${model}，可选 ${Object.keys(MODELS).join(' / ')}`);
  if (spec.regen) return buildRegenPayload({ sourceVideoUrl, resolution, model });
  if (!prompt || !prompt.trim()) throw new Error('prompt 不能为空');
  if (prompt.length > 7000) throw new Error(`提示词 ${prompt.length} 字，上限 7000`);
  const dur = Number(duration);
  if (!Number.isInteger(dur) || dur < spec.duration[0] || dur > spec.duration[1]) {
    throw new Error(`${model} 时长必须是 ${spec.duration[0]}–${spec.duration[1]} 的整数秒，收到 ${duration}`);
  }
  if (!spec.resolutions.includes(resolution)) throw new Error(`${model} 分辨率只支持 ${spec.resolutions.join(' / ')}，收到 ${resolution}`);

  const content = [{ type: 'text', text: prompt.trim() }];
  if (firstFrameUrl) content.push({ type: 'image_url', image_url: { url: firstFrameUrl }, role: 'first_frame' });
  if (lastFrameUrl) content.push({ type: 'image_url', image_url: { url: lastFrameUrl }, role: 'last_frame' });
  for (const u of refImageUrls) content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' });
  if (!spec.reference && refImageUrls.length) throw new Error(`${model} 不支持 reference_image`);

  const body = { model, content, duration: dur, resolution };
  // 图生视频时宽高比由首帧决定（ratio 恒 adaptive）；纯文生视频必须显式给 ratio
  if (firstFrameUrl || lastFrameUrl) body.ratio = 'adaptive';
  else body.ratio = ratio || '9:16';
  return body;
}

/**
 * 视频再生成：把已有的 768P 成片升到 2K，不重新生成长度、不改镜头。
 * 注意：这是与 video_generation 并列的独立接口，body 只吃源视频地址。
 */
export function buildRegenPayload({ sourceVideoUrl, resolution = '2K', model = 'MiniMax-H3-Regeneration' }) {
  if (!sourceVideoUrl) throw new Error('H3-Regeneration 需要一段已生成的 768P 视频地址（sourceVideoUrl）');
  if (!/^https?:\/\//i.test(sourceVideoUrl)) throw new Error('sourceVideoUrl 必须是可公网访问的 https 地址（本地文件请先上传）');
  return { model, video_url: sourceVideoUrl, resolution };
}

export async function createTask(body, cfg = {}) {
  const key = resolveKey(cfg);
  if (!key) throw new Error('缺少 MINIMAX_API_KEY：MiniMax H3 需要你自己申请 key（环境变量或 config/video.json）');
  const endpoint = body && MODELS[body.model]?.regen ? '/v2/video_regeneration' : '/v2/video_generation';
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`创建视频任务失败 HTTP ${res.status}: ${raw.slice(0, 400)}`);
  let json;
  try { json = JSON.parse(raw); } catch { throw new Error('创建视频任务返回非 JSON：' + raw.slice(0, 200)); }
  const taskId = json.task_id || json?.task?.id;
  if (!taskId) throw new Error('返回里没有 task_id：' + raw.slice(0, 300));
  const kind = endpoint.includes('regeneration') ? 'video_regeneration' : 'video_generation';
  return { taskId, kind, raw: json };
}

export async function queryTask(taskId, cfg = {}, kind = 'video_generation') {
  const key = resolveKey(cfg);
  if (!key) throw new Error('缺少 MINIMAX_API_KEY');
  const res = await fetch(`${BASE}/v2/query/${kind}/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`查询任务失败 HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const json = JSON.parse(raw);
  const task = json.task || json;
  return { status: task.status, url: task?.content?.url || '', error: task?.error || null, raw: json };
}

export async function waitTask(taskId, { cfg = {}, kind = 'video_generation', interval = 10000, timeout = 45 * 60 * 1000, onTick } = {}) {
  const start = Date.now();
  while (true) {
    const t = await queryTask(taskId, cfg, kind);
    onTick?.(t);
    if (t.status === 'succeeded') return t;
    if (t.status === 'failed' || t.status === 'cancelled') throw new Error(`视频任务未成功：${t.status} ${JSON.stringify(t.error || {})}`);
    if (Date.now() - start > timeout) throw new Error(`轮询超时（${Math.round(timeout / 60000)} 分钟），任务 ${taskId} 仍在 ${t.status}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

export async function download(url, outFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载成片失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return { file: outFile, bytes: buf.length };
}

/** 本地图片 → data URI（文档推荐公网 URL，本地小图用 data URI 兜底） */
export function toDataUri(file) {
  if (/^https?:\/\//i.test(file)) return file;
  const ext = path.extname(file).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const buf = fs.readFileSync(file);
  if (buf.length > 30 * 1024 * 1024) throw new Error('单张图片超过 30MB 上限');
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}
