// 本地模型接入：直接驱动本机的 ComfyUI（秋叶整合包 / 官方版都行）出图。
// 只要底模放在 ComfyUI/models/checkpoints 下，就能用 D 盘那些 .safetensors：
//   AWPainting / LandscapeBING / 动漫ReVAnimated / dark sushi mix / 室内现代风格 / majicMIX realistic
//
// 接口（ComfyUI 默认端口 8188）：
//   GET  /system_stats                 探活
//   GET  /object_info/CheckpointLoaderSimple   可用底模列表
//   POST /prompt {prompt, client_id}   提交工作流
//   GET  /history/{prompt_id}          取结果（outputs[节点].images[]）
//   GET  /view?filename=&subfolder=&type=output   下载图
//
// 纯本地调用，不出网、不消耗任何生成额度；缺底模或没启动只返回明确原因，不自动重试。

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BASE = 'http://127.0.0.1:8188';

/** 角色的“模型人设”与推荐底模（都是本机已有的那几个） */
export const STYLE_CKPT = {
  anime: '动漫ReVAnimated_v1.1.safetensors',
  anime2: '二次元：dark sushi mix 大颗寿司mix_brighterpruned.safetensors',
  paint: 'AWPainting_v1.2.safetensors',
  realistic: '写实：majicMIX realistic 麦橘写实_v7.safetensors',
  interior: '室内现代风格大模型（精）_V4.0.safetensors',
  landscape: 'LandscapeBING   v1.0_冰醋酸 百变景观v1.0_v1.0.safetensors',
};

export const STYLE_NOTES = {
  anime: '动漫赛璐璐，线条清楚，适合角色立绘与表情包',
  anime2: '偏明亮二次元，肤色通透，适合 Q 版与社媒封面',
  paint: '柔和厚涂，色彩层次多，适合氛围插画与片头卡',
  realistic: '真人写实，皮肤与布料到边，适合写实场景与产品图',
  interior: '室内空间与家具，构图稳，适合房间类背景',
  landscape: '风景与地景，适合空镜与动态底板静帧',
};

const baseUrl = (base) => String(base || DEFAULT_BASE).replace(/\/+$/, '');

async function getJSON(url, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const raw = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('返回非 JSON：' + raw.slice(0, 160));
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 探活：返回 {ok, base, reason?} */
export async function probe(base) {
  const b = baseUrl(base);
  try {
    const stats = await getJSON(`${b}/system_stats`, 4000);
    const dev = stats?.devices?.[0] || {};
    return {
      ok: true,
      base: b,
      device: dev.name || 'unknown',
      vramGB: dev.vram_total ? Number((dev.vram_total / 1024 ** 3).toFixed(1)) : null,
      comfyVersion: stats?.system?.comfyui_version || null,
    };
  } catch (e) {
    const reason = /abort|timeout/i.test(e.message)
      ? `4 秒内没有响应 ${b}`
      : `连不上 ${b}（${e.message}）`;
    return {
      ok: false,
      base: b,
      reason,
      hint: [
        'ComfyUI 秋叶版默认装在 D:\\ComfyUI-aki-v3.2\\ComfyUI-aki-v3.2，双击「A绘世启动器.exe」或跑 `python main.py --port 8188` 即可。',
        '启动后先用 `local --action probe` 确认 device 名称出现（有显卡就会显示你的卡）。',
      ].join(' '),
    };
  }
}

/** 服务端可见的底模（ComfyUI/models/checkpoints 下的相对名） */
export async function listServerCheckpoints(base) {
  const b = baseUrl(base);
  const info = await getJSON(`${b}/object_info/CheckpointLoaderSimple`);
  const req = info?.input?.required?.ckpt_name;
  const list = Array.isArray(req?.[0]) ? req[0] : [];
  return list.map(String);
}

/** 扫描本机磁盘上的 .safetensors（默认扫常见盘根 + ComfyUI 目录） */
export function scanDisk({ roots = ['C:\\', 'D:\\', 'E:\\'], maxDepth = 2 } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isFile() && /\.safetensors$/i.test(e.name)) {
        try {
          found.push({ file: p, name: e.name, sizeGB: Number((fs.statSync(p).size / 1024 ** 3).toFixed(2)) });
        } catch {
          /* 略过读不到的文件 */
        }
      } else if (e.isDirectory() && depth > 0 && !/^(Windows|Program Files|Program Files \(x86\)|$Recycle\.Bin|System Volume Information|node_modules)$/i.test(e.name)) {
        walk(p, depth - 1);
      }
    }
  };
  for (const r of roots) {
    if (fs.existsSync(r)) walk(r, maxDepth);
  }
  return found.sort((a, b) => b.sizeGB - a.sizeGB);
}

/** 把本机文件名匹配成服务端 ckpt_name（按文件名结尾匹配，大小写不敏感） */
export function matchCkpt(serverList, wanted) {
  if (!wanted) return null;
  const norm = (s) => String(s).replace(/\\/g, '/').toLowerCase();
  const w = norm(wanted);
  const hit = serverList.find((n) => norm(n) === w) || serverList.find((n) => norm(n).endsWith('/' + w)) || serverList.find((n) => norm(n).endsWith(w));
  return hit || null;
}

/** 标准 SD txt2img 工作流：加载底模 → 正负提示 → 空 latent → KSampler → VAE 解码 → 保存 */
export function buildWorkflow({ ckpt, positive, negative, width = 768, height = 1024, steps = 28, cfgScale = 6.5, sampler = 'dpmpp_2m', scheduler = 'karras', seed = 0, batch = 1 }) {
  if (!ckpt) throw new Error('缺少底模名 ckpt');
  if (!positive) throw new Error('缺少正向提示词 positive');
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: negative || '', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: Number(width), height: Number(height), batch_size: Number(batch) } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: Number(seed) || 0,
        steps: Number(steps),
        cfg: Number(cfgScale),
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'ai-diary' } },
  };
}

export async function submit(base, workflow, clientId = 'ai-diary') {
  const b = baseUrl(base);
  const res = await fetch(`${b}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`提交工作流失败 HTTP ${res.status}: ${raw.slice(0, 400)}`);
  const json = JSON.parse(raw);
  if (!json.prompt_id) throw new Error('返回里没有 prompt_id：' + raw.slice(0, 200));
  return json;
}

export async function waitPrompt(base, promptId, { interval = 1500, timeout = 300000 } = {}) {
  const b = baseUrl(base);
  const start = Date.now();
  while (true) {
    const hist = await getJSON(`${b}/history/${encodeURIComponent(promptId)}`, 10000).catch(() => ({}));
    const entry = hist?.[promptId];
    if (entry) {
      const status = entry.status || {};
      if (status.status_str === 'error' || status.completed === false && status.messages?.some?.(m => m?.[0] === 'execution_error')) {
        throw new Error('ComfyUI 执行失败：' + JSON.stringify(status.messages || status).slice(0, 400));
      }
      const outputs = entry.outputs || {};
      const imgs = [];
      for (const nodeId of Object.keys(outputs)) {
        for (const im of outputs[nodeId]?.images || []) imgs.push({ ...im, node: nodeId });
      }
      if (imgs.length) return { images: imgs, raw: entry };
    }
    if (Date.now() - start > timeout) throw new Error(`等待出图超时（${Math.round(timeout / 1000)}s），prompt_id=${promptId} 仍在队列`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** 从 /view 下载图片到本地 */
export async function fetchImage(base, img, outFile) {
  const b = baseUrl(base);
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
  const res = await fetch(`${b}/view?${q}`);
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return { file: outFile, bytes: buf.length };
}

/**
 * 一条龙出图：探活 → 校底模 → 提交 → 轮询 → 下载
 * 返回 { ok, file?, base, ckpt, seconds, promptId, reason? }
 */
export async function txt2img({ base, ckpt, style, positive, negative, width, height, steps, cfgScale, seed, outFile, timeout } = {}) {
  const p = await probe(base);
  if (!p.ok) return { ok: false, reason: p.reason, hint: p.hint };
  let server = [];
  try {
    server = await listServerCheckpoints(p.base);
  } catch (e) {
    return { ok: false, reason: '读不到底模列表：' + e.message, hint: '确认 ComfyUI 已完全启动（/object_info 能打开）' };
  }
  const want = ckpt || STYLE_CKPT[style] || server[0];
  const resolved = matchCkpt(server, want);
  if (!resolved) {
    return {
      ok: false,
      reason: `服务端没有这个底模：${want}`,
      available: server,
      hint: '把 .safetensors 放进 ComfyUI\\models\\checkpoints 再刷新；或用 action:models 看服务端现在认哪些。',
    };
  }
  const wf = buildWorkflow({ ckpt: resolved, positive, negative, width, height, steps, cfgScale, seed });
  const t0 = Date.now();
  const job = await submit(p.base, wf);
  const r = await waitPrompt(p.base, job.prompt_id, { timeout: timeout || 300000 });
  const file = await fetchImage(p.base, r.images[0], outFile);
  return {
    ok: true,
    file: file.file,
    bytes: file.bytes,
    base: p.base,
    ckpt: resolved,
    promptId: job.prompt_id,
    seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    device: p.device,
  };
}
