// B 站客户端自动化（真 GUI，不用浏览器）：
//   客户端是 Electron，UIA 只暴露 "Chrome Legacy Window"，所以页面内一律「截图定位 + 坐标点击」；
//   系统对话框（打开/选择文件）是原生的，UIA 可见，直接 hit 控件名 + 粘贴路径。
// 坐标全部来自 config/bili.json 的比例锚点（相对截图宽高），换分辨率只改配置不改代码。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runEngine, shotsDir, warmup } from './pc.mjs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadBiliConfig(root) {
  const base = root || ROOT;
  const file = path.join(base, 'config', 'bili.json');
  const defaults = {
    client: {
      exe: process.env.DIARY_BILI_CLIENT || 'C:\\Program Files\\bilibili\\哔哩哔哩.exe',
      // 用 | 分隔多个候选，客户端换版本改标题也不会失配（引擎按片段模糊匹配）
      mainWindow: '哔哩哔哩|bilibili|Bilibili',
      creatorWindow: '浏览器窗口|创作中心|投稿管理',
      railUploadIcon: [0.032, 0.757],
    },
    creator: {
      uploadVideoButton: [0.653, 0.868],
      coverRecommended1: [0.397, 0.357],
      addCoverButton: [0.331, 0.868],
      titleField: [0.55, 0.48],
      statementSelect: [0.33, 0.563],
      statementOptionFirst: [0.33, 0.646],
      tagsInput: [0.55, 0.745],
      descTextarea: [0.6, 0.44],
      submitButton: [0.895, 0.83],
    },
    waits: { afterLaunchMs: 15000, afterCreatorOpenMs: 6000, afterDialogEnterMs: 4000, afterFillMs: 800 },
    upload: { msPerMb: 9000, minWaitMs: 20000 },
  };
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...defaults,
      ...cfg,
      client: { ...defaults.client, ...(cfg.client || {}) },
      creator: { ...defaults.creator, ...(cfg.creator || {}) },
      waits: { ...defaults.waits, ...(cfg.waits || {}) },
      upload: { ...defaults.upload, ...(cfg.upload || {}) },
    };
  } catch {
    return defaults;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function engineOpts(cfg) {
  return { timeoutMs: 45000, maxActions: 24, failsafe: Boolean(cfg.failsafe), allowWinKeys: false };
}

function fragsOf(spec) {
  return String(spec || '').split('|').map((s) => s.trim()).filter(Boolean);
}

function lineHas(line, spec) {
  const t = String(line).toLowerCase();
  return fragsOf(spec).some((f) => t.includes(f.toLowerCase()));
}

export function parseWindowLine(line) {
  const m = /^(\d+)\s+"(.+)"\s+(\d+)x(\d+)(?:\s+p(\d+))?(\s+\(min\))?(\s+\(hidden\))?$/.exec(String(line).trim());
  if (!m) return null;
  return {
    no: Number(m[1]),
    title: m[2],
    w: Number(m[3]),
    h: Number(m[4]),
    pid: m[5] ? Number(m[5]) : 0,
    min: Boolean(m[6]),
    hidden: Boolean(m[7]),
  };
}

async function seeWindows(cfg, includeHidden = false) {
  const opts = engineOpts(cfg);
  const r = await runEngine({ op: 'see', what: 'windows', includeHidden, options: opts }, opts);
  if (!r.ok) throw new Error('列窗口失败：' + (r.error || 'unknown'));
  return r.lines || [];
}

// 主窗口：优先可见、标题最短的那条（"哔哩哔哩" 比 "哔哩哔哩-浏览器窗口" 短）
function pickClientRow(rows, cfg) {
  const mainHits = rows.filter((r) => lineHas(r.title, cfg.client.mainWindow));
  const notCreator = mainHits.filter((r) => !lineHas(r.title, cfg.client.creatorWindow));
  const pool = notCreator.length ? notCreator : mainHits;
  if (!pool.length) return null;
  const shown = pool.filter((r) => !r.hidden && !r.min);
  return (shown.length ? shown : pool).slice().sort((a, b) => a.title.length - b.title.length)[0];
}

// 客户端缩在托盘时，focus 会把隐藏窗口 ShowWindow 唤回来（引擎侧 Activate 已处理）
async function wakeClient(cfg, title) {
  try {
    await act(cfg, [`focus ${title}`, 'wait 1']);
  } catch {
    /* 唤不出来就交给后面的截图报真实原因 */
  }
  await sleep(800);
}

async function waitForClient(cfg, timeoutMs) {
  const deadline = Date.now() + Math.max(15000, Number(timeoutMs) || cfg.waits.afterLaunchMs || 15000);
  while (Date.now() < deadline) {
    const rows = (await seeWindows(cfg, true)).map(parseWindowLine).filter(Boolean);
    const row = pickClientRow(rows, cfg);
    if (row) {
      if (row.hidden || row.min) await wakeClient(cfg, row.title);
      return row;
    }
    await sleep(2500);
  }
  return null;
}

export async function clientRunning(cfg) {
  try {
    const rows = (await seeWindows(cfg, true)).map(parseWindowLine).filter(Boolean);
    return Boolean(pickClientRow(rows, cfg));
  } catch {
    return false;
  }
}

export async function ensureClient(cfg) {
  const rows = (await seeWindows(cfg, true)).map(parseWindowLine).filter(Boolean);
  const cur = pickClientRow(rows, cfg);
  if (cur) {
    if (cur.hidden || cur.min) await wakeClient(cfg, cur.title);
    return { launched: false, woken: Boolean(cur.hidden || cur.min), title: cur.title };
  }
  if (!cfg.client.exe || !fs.existsSync(cfg.client.exe)) {
    throw new Error('找不到哔哩哔哩客户端：' + cfg.client.exe + '（用 DIARY_BILI_CLIENT 指定路径）');
  }
  spawn(cfg.client.exe, [], { detached: true, stdio: 'ignore' }).unref();
  const w = await waitForClient(cfg, cfg.waits.windowWaitMs);
  if (!w) {
    const sec = Math.round(Math.max(15000, Number(cfg.waits.windowWaitMs) || cfg.waits.afterLaunchMs || 15000) / 1000);
    throw new Error('客户端已启动，但 ' + sec + ' 秒内没出现「' + cfg.client.mainWindow + '」窗口（可能停在托盘或登录页），把客户端窗口点开后重试');
  }
  return { launched: true, woken: Boolean(w.hidden || w.min), title: w.title };
}

async function shot(cfg, windowName) {
  // 最小化的窗口截不到图：先 focus 把它拉回来（顺手确保键盘/鼠标落在正确窗口）
  try {
    await act(cfg, [`focus ${windowName}`, 'wait 0.6']);
  } catch {
    /* focus 失败时仍尝试截图，让引擎给出真实原因 */
  }
  const out = path.join(shotsDir(), `bili-${Date.now()}.png`);
  const r = await runEngine({ op: 'see', what: 'shot', window: windowName, width: 1280, out, includeHidden: true, options: engineOpts(cfg) }, engineOpts(cfg));
  if (!r.ok) throw new Error('截图失败：' + (r.error || 'unknown'));
  if (!r.image) throw new Error('截图失败：引擎没有返回图片');
  return r.image;
}

async function act(cfg, actions, dryRun = false) {
  return runEngine({ op: 'act', actions, dryRun, includeHidden: true, options: engineOpts(cfg) }, engineOpts(cfg));
}

// 截图比例 → 真实屏幕坐标
function realPoint(image, [fx, fy]) {
  const x = Math.round(image.width * fx);
  const y = Math.round(image.height * fy);
  const scale = Number(image.scale) || 1;
  const origin = Array.isArray(image.origin) ? image.origin : [0, 0];
  return [Math.round(x * scale + origin[0]), Math.round(y * scale + origin[1])];
}

export async function openCreator(cfg) {
  const before = await seeWindows(cfg, true);
  if (before.some((l) => lineHas(l, cfg.client.creatorWindow))) {
    return { opened: false, window: cfg.client.creatorWindow };
  }
  const main = await shot(cfg, cfg.client.mainWindow);
  const [x, y] = realPoint(main, cfg.client.railUploadIcon);
  const r = await act(cfg, [`focus ${cfg.client.mainWindow}`, `click ${x} ${y}`, 'wait 2']);
  if (!r.ok) throw new Error('点投稿入口失败：' + r.error);
  await sleep(cfg.waits.afterCreatorOpenMs);
  const after = await seeWindows(cfg, true);
  if (!after.some((l) => lineHas(l, cfg.client.creatorWindow))) {
    throw new Error('点了投稿入口，但没有出现「' + cfg.client.creatorWindow + '」窗口（现有窗口：' + after.slice(0, 6).join(' | ') + '）');
  }
  return { opened: true, window: cfg.client.creatorWindow };
}

// 选文件：点页面按钮 → 原生「打开」对话框 → hit 文件名 → 粘贴路径 → 回车
export async function pickFile(cfg, windowName, buttonAnchor, filePath) {
  const img = await shot(cfg, windowName);
  const [x, y] = realPoint(img, buttonAnchor);
  const click = await act(cfg, [`focus ${windowName}`, `click ${x} ${y}`, 'wait 3']);
  if (!click.ok) throw new Error('点「上传视频」失败：' + click.error);
  const hit = await act(cfg, ['focus 打开', 'hit 文件名(N):', `paste ${filePath}`, 'key enter', 'wait 2']);
  if (!hit.ok) throw new Error('文件对话框操作失败：' + hit.error);
  await sleep(cfg.waits.afterDialogEnterMs);
  return { ok: true };
}

export async function uploadVideo(cfg, videoPath, windowName) {
  const size = fs.statSync(videoPath).size;
  const waitMs = Math.max(cfg.upload.minWaitMs, Math.round((size / 1024 / 1024) * cfg.upload.msPerMb));
  await pickFile(cfg, windowName || cfg.client.creatorWindow, cfg.creator.uploadVideoButton, videoPath);
  await sleep(waitMs);
  return { waitMs, sizeMb: +(size / 1024 / 1024).toFixed(1) };
}

// 点字段 → 粘贴
async function fillField(cfg, windowName, anchor, value) {
  const img = await shot(cfg, windowName);
  const [x, y] = realPoint(img, anchor);
  const r = await act(cfg, [`focus ${windowName}`, `click ${x} ${y}`, 'key ctrl+a', `paste ${value}`, 'wait 0.3']);
  return r.ok ? null : `填字段失败：${r.error}`;
}

/**
 * 填表单：标题 → 创作声明 → 标签 →（可选）封面 →（可选）简介。
 * 每一步都用当前截图比例换算，页面滚动后锚点仍然有效（锚点是相对当前画面的比例）。
 */
export async function fillForm(cfg, windowName, { title, statement, tags, coverPath, desc, cover }) {
  const notes = [];
  if (title) {
    const err = await fillField(cfg, windowName, cfg.creator.titleField, title);
    if (err) notes.push(err);
  }
  if (statement) {
    const img = await shot(cfg, windowName);
    const [sx, sy] = realPoint(img, cfg.creator.statementSelect);
    const [ox, oy] = realPoint(img, cfg.creator.statementOptionFirst);
    const r = await act(cfg, [`focus ${windowName}`, `click ${sx} ${sy}`, 'wait 0.8', `click ${ox} ${oy}`, 'wait 0.5']);
    if (!r.ok) notes.push('创作声明选择失败：' + r.error);
  }
  if (Array.isArray(tags) && tags.length) {
    const img = await shot(cfg, windowName);
    const [tx, ty] = realPoint(img, cfg.creator.tagsInput);
    const steps = [`focus ${windowName}`, `click ${tx} ${ty}`];
    for (const t of tags.slice(0, 10)) steps.push(`paste ${t}`, 'key enter', 'wait 0.3');
    const r = await act(cfg, steps);
    if (!r.ok) notes.push('标签填写失败：' + r.error);
  }
  if (coverPath) {
    try {
      await pickFile(cfg, windowName, cfg.creator.addCoverButton, coverPath);
    } catch (e) {
      notes.push('封面图选择失败：' + (e instanceof Error ? e.message : String(e)));
    }
  } else if (cover !== false) {
    const img = await shot(cfg, windowName);
    const [cx, cy] = realPoint(img, cfg.creator.coverRecommended1);
    const r = await act(cfg, [`focus ${windowName}`, `click ${cx} ${cy}`, 'wait 0.8']);
    if (!r.ok) notes.push('选推荐封面失败：' + r.error);
  }
  if (desc) {
    // 简介在表单更下方：先滚一屏再点，避免点在标签/分区上
    const scroll = Number(cfg.creator.descScroll) || 0;
    if (scroll) {
      const pre = await shot(cfg, windowName);
      const [sx, sy] = realPoint(pre, [0.55, 0.5]);
      await act(cfg, [`focus ${windowName}`, `move ${sx} ${sy}`, `scroll ${scroll}`, 'wait 1']);
    }
    const err = await fillField(cfg, windowName, cfg.creator.descTextarea, desc);
    if (err) notes.push('简介填写失败：' + err);
    if (scroll) {
      const back = await shot(cfg, windowName);
      const [bx, by] = realPoint(back, [0.55, 0.5]);
      await act(cfg, [`focus ${windowName}`, `move ${bx} ${by}`, `scroll ${-scroll}`, 'wait 1']);
    }
  }
  await sleep(cfg.waits.afterFillMs);
  const final = await shot(cfg, windowName);
  return { notes, shot: final.path };
}

/** 最后一步：点「立即投稿」。confirm=false 时只回报位置，不点。 */
export async function submit(cfg, windowName, confirm) {
  const img = await shot(cfg, windowName);
  const [x, y] = realPoint(img, cfg.creator.submitButton);
  if (!confirm) return { clicked: false, at: [x, y], shot: img.path };
  const r = await act(cfg, [`focus ${windowName}`, `click ${x} ${y}`, 'wait 4']);
  await sleep(2000);
  const after = await shot(cfg, windowName);
  return { clicked: r.ok, at: [x, y], error: r.error || null, shot: after.path };
}

/** 评论页：创作中心 → 互动管理 → 评论管理，返回截图给模型读 */
export async function openComments(cfg) {
  const img = await shot(cfg, cfg.client.creatorWindow);
  const [x, y] = realPoint(img, [0.075, 0.37]); // 左侧「互动管理」
  const r = await act(cfg, [`focus ${cfg.client.creatorWindow}`, `click ${x} ${y}`, 'wait 1.5']);
  if (!r.ok) throw new Error('打开互动管理失败：' + r.error);
  const sub = await shot(cfg, cfg.client.creatorWindow);
  const [sx, sy] = realPoint(sub, [0.11, 0.41]); // 展开后的「评论管理」首项
  await act(cfg, [`focus ${cfg.client.creatorWindow}`, `click ${sx} ${sy}`, 'wait 2']);
  const page = await shot(cfg, cfg.client.creatorWindow);
  return { shot: page.path, window: cfg.client.creatorWindow };
}

export async function warm(cfg) {
  return warmup(engineOpts(cfg));
}
