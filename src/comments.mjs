// 评论自动回复：Electron 页面读不到 DOM 文字，所以走「截图 → 本机 OCR → 按界面文字定位」这条路。
//
// 定位不写死坐标：每条评论同一行会有一个「回复」文字（或锚点），发送时再找「发送」。
// 找不到「回复」/「发送」就停下来报告，不做盲点 —— 盲点会把回复贴到别人评论里。
//
// 安全阀：默认只扫描不发送（send=false）；发送要有规则命中、每条只回一次（用文本指纹去重）、
// 单次上限 maxPerRun、两次之间至少 8 秒。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { runEngine } from './pc.mjs';
import { loadBiliConfig, ensureClient, openCreator, openComments } from './bili.mjs';
import { loadSettings, saveSettings } from './settings.mjs';
import { decodePng, findBlueButton } from './png.mjs';
import * as A from './bili-api.mjs';

const OCR_SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'ocr.ps1');
const CROP_SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'crop.ps1');

const UI_NOISE = [
  /^评论管理$/, /^评论$/, /^全部评论$/, /^最新$/, /^最早$/, /^热门$/, /^回复$/, /^发送$/,
  /^点赞$/, /^置顶$/, /^删除$/, /^举报$/, /^更多$/, /^展开$/, /^收起$/, /^加载更多$/, /^查看更多$/,
  /^搜索$/, /^筛选$/, /^排序$/, /^全部$/, /^未读$/, /^已读$/, /^\d+$/, /^\d+\s*(分钟|小时|天)前$/,
  /^\d{1,2}[-/月]\d{1,2}/, /^[|·•\-—\s]+$/, /^回到主界面/, /^创作中心$/, /^互动管理$/, /^数据中心$/,
];

/** 去掉所有空白后的归一化文本，用来判噪声 */
function norm(text) {
  return String(text || '').replace(/[\s\u3000]/g, '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runOcr(imagePath, outPath) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OCR_SCRIPT, imagePath, outPath], {
      windowsHide: true,
    });
    let err = '';
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('error', reject);
    ps.on('close', () => {
      try {
        const j = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        resolve(j);
      } catch (e) {
        reject(new Error('OCR 结果读不出来：' + (err || e.message)));
      }
    });
  });
}

async function foregroundTitle() {
  try {
    const r = await runEngine({ op: 'see', what: 'windows', options: { timeoutMs: 20000 } }, { timeoutMs: 20000 });
    const first = (r.lines || [])[0] || '';
    const m = first.match(/"([^"]+)"/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * 把目标窗口真正顶到最前。
 * Windows 有前台锁，SetForegroundWindow 常常被静默拦下，所以这里用 Alt+Tab 轮转 + 校验。
 */
async function bringToFront(win) {
  let fg = await foregroundTitle();
  if (fg.includes(win)) return true;

  try {
    await runEngine({ op: 'act', actions: [`focus ${win}`, 'wait 0.6'], options: { timeoutMs: 20000 } }, { timeoutMs: 20000 });
  } catch {
    /* 继续用 Alt+Tab 兜底 */
  }
  fg = await foregroundTitle();
  if (fg.includes(win)) return true;

  for (let i = 0; i < 5; i++) {
    await runEngine({ op: 'act', actions: ['key alt+tab', 'wait 1.2'], options: { timeoutMs: 20000 } }, { timeoutMs: 20000 });
    fg = await foregroundTitle();
    if (fg.includes(win)) return true;
  }
  return false;
}

async function shot(cfg, root) {
  const win = cfg.client.creatorWindow;
  const out = path.join(root, 'out', 'ocr', `shot-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) {
      await runEngine({ op: 'act', actions: ['key alt+tab', 'wait 1.2'], options: { timeoutMs: 20000 } }, { timeoutMs: 20000 });
    }
    try {
      await runEngine({ op: 'act', actions: [`focus ${win}`, 'wait 0.6'], options: { timeoutMs: 20000 } }, { timeoutMs: 20000 });
    } catch {
      /* 前台锁可能拦下，靠 alt+tab 与下面的截图校验兜底 */
    }
    const r = await runEngine({ op: 'see', what: 'shot', window: win, width: 1920, out, options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
    if (r.ok && r.image) {
      const note = (r.lines || []).join(' ');
      if (!/occluded/i.test(note)) return r.image;
    }
  }
  throw new Error(`「${win}」一直被别的窗口挡住，截不到它的画面；请手动把它切到最前（或最小化其它全屏窗口）后再跑`);
}

/** 图像像素 → 屏幕物理坐标（引擎返回 scale/origin） */
function toPhys(image, px, py) {
  const scale = Number(image.scale) || 1;
  const origin = Array.isArray(image.origin) ? image.origin : [0, 0];
  return [Math.round(origin[0] + px * scale), Math.round(origin[1] + py * scale)];
}

function isNoise(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  const n = norm(t);
  // 只有一个字、或“回 到 主 界 面”这种被 OCR 逐字拆开的标题
  if (n.length < 2) return true;
  const spaceRatio = (t.length - n.length) / Math.max(1, t.length);
  // 短标题常被 OCR 逐字拆开（「回 到 主 界 面」）；长句即便带空格也是真内容，不能误杀
  if (spaceRatio > 0.4 && n.length <= 8) return true;
  // 窗口标题类：含站点名/系统词
  if (/哔哩哔哩|弹幕视频网|Microsoft|豆包|Google Chrome/.test(n)) return true;
  return UI_NOISE.some((re) => re.test(t)) || UI_NOISE.some((re) => re.test(n));
}

function cleanComments(lines, image, extraNoise = []) {
  const items = [];
  for (const l of lines || []) {
    const t = String(l.text || '').trim();
    if (isNoise(t)) continue;
    if (extraNoise.some((n) => n && (t === n || t.includes(n)))) continue;
    // 太窄的多半是图标/按钮碎片
    if ((l.w || 0) < 12) continue;
    // 太长的多是标题栏或说明文字
    if (norm(t).length > 60) continue;
    items.push({ text: t, x: l.x, y: l.y, w: l.w, h: l.h, cx: l.x + l.w / 2, cy: l.y + l.h / 2 });
  }
  return items;
}

function findLabel(lines, label, nearY = null, { minY = 0, maxY = Infinity, maxX = Infinity, minX = 0 } = {}) {
  const want = norm(label);
  const hits = (lines || [])
    .map((l) => ({ line: l, t: norm(l.text) }))
    // 用“包含”而不是全等：OCR 常把「互动管理」和箭头/角标连成一行，甚至吃字
    .filter((h) => h.t && h.t.includes(want))
    // 行越长越可能是正文，优先短行（真正的菜单/按钮）
    .sort((a, b) => a.t.length - b.t.length)
    .map((h) => h.line);

  const pool = hits.filter((h) => {
    const cy = h.y + h.h / 2;
    const cx = h.x + h.w / 2;
    return cy >= minY && cy <= maxY && cx >= minX && cx <= maxX;
  });
  if (!pool.length) return null;
  if (nearY === null) return pool[0];

  let best = null;
  let bestD = Infinity;
  for (const h of pool) {
    const d = Math.abs(h.y + h.h / 2 - nearY);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return bestD <= 140 ? best : null;
}

/** 按候选标签依次尝试（OCR 会吃字，所以给一个短标签兜底） */
function findAnyLabel(lines, labels, nearY = null, opts = {}) {
  for (const l of labels) {
    const hit = findLabel(lines, l, nearY, opts);
    if (hit) return hit;
  }
  return null;
}

function fingerprint(text) {
  return crypto.createHash('sha1').update(String(text).replace(/\s+/g, '')).digest('hex').slice(0, 12);
}

async function cropOcr(cfg, root, image, box, tag) {
  const outPng = path.join(root, 'out', 'ocr', `crop-${tag}-${Date.now()}.png`);
  const outJson = path.join(root, 'out', 'ocr', `crop-${tag}-${Date.now()}.json`);
  const ok = await new Promise((resolve) => {
    const ps = spawn(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        CROP_SCRIPT,
        '-InPath',
        image.path,
        '-OutPath',
        outPng,
        '-X',
        String(box.x),
        '-Y',
        String(box.y),
        '-W',
        String(box.w),
        '-H',
        String(box.h),
        '-Scale',
        String(box.scale || 3),
      ],
      { windowsHide: true },
    );
    ps.on('error', () => resolve(false));
    ps.on('close', (code) => resolve(code === 0));
  });
  if (!ok) return null;
  const j = await runOcr(outPng, outJson);
  if (!j.ok) return null;
  // 把放大后的坐标换回原图坐标
  const scale = Number(box.scale || 3);
  const lines = (j.lines || []).map((l) => ({
    text: l.text,
    x: box.x + l.x / scale,
    y: box.y + l.y / scale,
    w: l.w / scale,
    h: l.h / scale,
  }));
  return { png: outPng, json: outJson, lines };
}

/** 按颜色找蓝色「发表回复」按钮（B 站是实心蓝底，比 OCR 稳） */
async function findBlue(cfg, root, image, box) {
  try {
    const png = decodePng(image.path);
    const hit = findBlueButton(png, box);
    return hit && hit.count > 400 ? hit : null;
  } catch {
    return null;
  }
}

/** 页面上出现了删除确认弹窗时，点「取消」并终止（绝不点「确定」） */async function guardDeleteDialog(cfg, root) {
  const image = await shot(cfg, root);
  const region = { x: Math.round(image.width * 0.28), y: Math.round(image.height * 0.3), w: Math.round(image.width * 0.44), h: Math.round(image.height * 0.35), scale: 2 };
  const c = await cropOcr(cfg, root, image, region, 'dlg');
  const txt = (c?.lines || []).map((l) => norm(l.text)).join('|');
  if (txt.includes('删除提醒') || txt.includes('无法恢复')) {
    const [cx, cy] = toPhys(image, image.width * 0.605, image.height * 0.583);
    await runEngine({ op: 'act', actions: [`focus ${cfg.client.creatorWindow}`, `click ${cx} ${cy}`, 'wait 1'], options: { timeoutMs: 30000 } }, { timeoutMs: 30000 });
    throw new Error('页面弹出「删除提醒」，已点取消并终止本次自动回复');
  }
}

async function ocrShot(cfg, root, tag = '') {
  const image = await shot(cfg, root);
  const ocrPath = path.join(root, 'out', 'ocr', `ocr-${tag}${Date.now()}.json`);
  const ocr = await runOcr(image.path, ocrPath);
  if (!ocr.ok) throw new Error('OCR 不可用：' + (ocr.error || '未知'));
  return { image, lines: ocr.lines || [], ocrJson: ocrPath };
}

/**
 * 回复框探测：在评论行下方裁一块放大 3 倍 OCR。
 * 只要能读到「回复 @某人」占位文字或「发表回复」按钮，就说明框已经打开。
 */
async function probeReplyBox(cfg, root, fx, fy, tag) {
  const image = await shot(cfg, root);
  const W = Number(image.width) || 1280;
  const H = Number(image.height) || 720;
  const ay = Math.round(fy * H);
  const region = {
    x: Math.round(W * 0.25),
    y: Math.max(0, ay + 8),
    w: Math.round(W * 0.62),
    h: Math.round(Math.max(120, Math.min(H - ay - 8, 300))),
    scale: 3,
  };
  const c = await cropOcr(cfg, root, image, region, tag);
  const lines = c?.lines || [];
  const ph = lines.find((l) => norm(l.text).includes('回复@') || norm(l.text).startsWith('回复')) || null;
  const btn = lines.find((l) => {
    const n = norm(l.text);
    return n.includes('发表') || n.includes('发送');
  }) || null;
  return { image, region, lines, placeholder: ph, button: btn, crop: c?.png || null };
}

/** 在回复框里输入并点「发表回复」，最后回读页面确认真的发出去了 */
async function sendOneReply(cfg, root, plan, text) {
  const probe0 = await probeReplyBox(cfg, root, plan.fx, plan.fy, 'probe0');
  if (!probe0.placeholder && !probe0.button) return { sent: false, error: '回复框没打开（没读到占位文字/发表按钮）', shot: probe0.image.path };

  // 点进输入区：优先点占位文字右下一点；没有占位就点框中间
  let pt;
  if (probe0.placeholder) {
    pt = toPhys(probe0.image, probe0.placeholder.x + 160, probe0.placeholder.y + 62);
  } else {
    pt = toPhys(probe0.image, Number(probe0.image.width) * 0.55, plan.fy * Number(probe0.image.height) + 90);
  }
  await runEngine({ op: 'act', actions: [`focus ${cfg.client.creatorWindow}`, `move ${pt[0]} ${pt[1]}`, 'wait 0.2', `click ${pt[0]} ${pt[1]}`, 'wait 0.6'], options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
  await runEngine({ op: 'act', actions: [`paste ${text}`, 'wait 0.9'], options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
  await sleep(700);

  // 回读：确认文字进了输入框（否则说明焦点没落在框里）
  const probe1 = await probeReplyBox(cfg, root, plan.fx, plan.fy, 'probe1');
  const marker = norm(text).slice(0, 5);
  const typed = (probe1.lines || []).some((l) => norm(l.text).includes(marker));
  if (!typed) {
    return { sent: false, error: '文字没进回复框（焦点未落在输入区）', shot: probe1.image.path };
  }
  // 按钮位置：先按蓝底找（最稳），找不到再退回 OCR 的「发表回复」文字框
  const blue = await findBlue(cfg, root, probe1.image, probe1.region);
  let target = null;
  if (blue) target = [blue.x, blue.y];
  else if (probe1.button) target = [probe1.button.x + probe1.button.w / 2, probe1.button.y + probe1.button.h / 2];
  if (!target) return { sent: false, error: '输入成功但没定位到「发表回复」按钮', shot: probe1.image.path };

  const [bx, by] = toPhys(probe1.image, target[0], target[1]);
  const r = await runEngine({ op: 'act', actions: [`move ${bx} ${by}`, 'wait 0.2', `click ${bx} ${by}`, 'wait 2.5'], options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
  if (!r.ok) return { sent: false, error: '点「发表回复」失败：' + (r.error || '未知'), shot: probe1.image.path };
  await sleep(1200);

  // 回读整页：按钮消失 + 框里文字还在页面上 = 发送成功
  const after = await ocrShot(cfg, root, 'after');
  const stillButton = (after.lines || []).some((l) => {
    const n = norm(l.text);
    return n.includes('发表回') || n.startsWith('发表');
  });
  const appeared = (after.lines || []).some((l) => norm(l.text).includes(marker));
  if (!stillButton && appeared) return { sent: true, shot: after.image.path };
  return { sent: false, error: stillButton ? '点了但按钮还在，可能没发出去' : '回读没找到刚发的内容', shot: after.image.path };
}

const PAGE_MARKERS = ['评论管理', '全部评论', '暂无评论', '还没有评论'];

function hasMarker(lines) {
  const all = (lines || []).map((l) => norm(l.text));
  return PAGE_MARKERS.some((m) => all.some((t) => t.includes(m)));
}

/** 每一步点完都确认还在评论管理页；页面被点跑偏就立刻停，绝不继续在陌生页面上点 */
async function assertCommentsPage(cfg, root, tag) {
  const s = await ocrShot(cfg, root, tag);
  if (!hasMarker(s.lines)) {
    throw new Error(`点击后页面跑偏（已不在评论管理页），已停止后续点击。截图：${s.image.path}`);
  }
  return s;
}

async function clickLine(cfg, image, line, root) {
  const fx = (line.x + line.w / 2) / (Number(image.width) || 1280);
  const fy = (line.y + line.h / 2) / (Number(image.height) || 720);
  // 点之前重新截一张干净的图：确认窗口真的在最前，否则点击会落到压在上面的别的窗口
  const fresh = root ? await shot(cfg, root, 'preClick') : image;
  const [px, py] = toPhys(fresh, fx * Number(fresh.width || 1280), fy * Number(fresh.height || 720));
  const r = await runEngine(
    { op: 'act', actions: [`move ${px} ${py}`, 'wait 0.2', `click ${px} ${py}`, 'wait 1.5'], options: { timeoutMs: 45000 } },
    { timeoutMs: 45000 },
  );
  if (!r.ok) throw new Error('点击失败：' + (r.error || '未知'));
  return [px, py];
}

/**
 * 安全开页：每一步点击后都 OCR 验证，不再盲点固定坐标。
 * 找不到「互动管理 / 评论管理」入口就停下抛错，并给出截图路径。
 */
export async function openCommentsVerified(root) {
  const cfg = loadBiliConfig(root);
  await ensureClient(cfg);
  await openCreator(cfg);

  let s = await ocrShot(cfg, root, 'p0');
  if (hasMarker(s.lines)) return { cfg, ...s, alreadyHere: true, steps: ['已在评论管理页'] };

  // 可能停在视频页/别处：先点左上角「回到主界面」回创作中心，再继续导航
  for (let i = 0; i < 2; i++) {
    const back = findAnyLabel(s.lines, ['回到主界面'], null, { maxX: Math.round((s.image.width || 1280) * 0.2), maxY: 80 });
    if (!back) break;
    await clickLine(cfg, s.image, back, root);
    await sleep(1500);
    s = await ocrShot(cfg, root, `back-${i}`);
    if (findAnyLabel(s.lines, ['互动管理'], null, { maxX: Math.round((s.image.width || 1280) * 0.3) })) break;
  }

  const steps = [];
  const navOpts = { maxX: Math.round((s.image.width || 1280) * 0.3) };

  // 「互动管理」是折叠开关：已经展开时再点会把它收起来，所以子菜单可见就直接点子菜单
  let cmNow = findAnyLabel(s.lines, ['评论管理'], null, navOpts);
  if (cmNow) {
    await clickLine(cfg, s.image, cmNow, root);
    steps.push('「评论管理」已可见，直接点它');
    s = await ocrShot(cfg, root, 'p1-direct');
    if (!hasMarker(s.lines)) throw new Error('点「评论管理」后页面没变化（没读到评论页标记），不再继续。截图：' + s.image.path);
    return { cfg, ...s, alreadyHere: false, steps };
  }

  const interact = findAnyLabel(s.lines, ['互动管理', '互动'], null, navOpts);
  if (!interact) {
    throw new Error('当前页找不到「互动管理」入口，停在原地不再盲点。截图：' + s.image.path);
  }
  await clickLine(cfg, s.image, interact, root);
  steps.push('点「互动管理」');

  // 展开动画/偶发点空都会导致读不到子菜单，所以最多点 3 次、每次轮询 5 张截图
  let cm = null;
  for (let attempt = 0; attempt < 3 && !cm; attempt++) {
    if (attempt > 0) {
      await clickLine(cfg, s.image, interact, root);
      steps.push(`再点一次「互动管理」（第 ${attempt + 1} 次）`);
    }
    for (let poll = 0; poll < 5 && !cm; poll++) {
      await sleep(900);
      s = await ocrShot(cfg, root, `p1-${attempt}-${poll}`);
      cm = findAnyLabel(s.lines, ['评论管理', '评论'], null, navOpts);
    }
  }
  if (!cm) {
    throw new Error('展开后找不到「评论管理」入口，停在原地不再盲点。截图：' + s.image.path);
  }
  await clickLine(cfg, s.image, cm, root);
  steps.push('点「评论管理」');

  s = await ocrShot(cfg, root, 'p2');
  if (!hasMarker(s.lines)) {
    throw new Error('点完仍不像评论页（没读到「评论管理/全部评论」），不再继续。截图：' + s.image.path);
  }
  return { cfg, ...s, alreadyHere: false, steps };
}

const NAV_WORDS = [
  '主站', '首页', '内容管理', '数据中心', '粉丝管理', '互动管理', '评论管理', '弹幕管理', '收益管理',
  '花生', 'updream', '创作成长', '任务中心', '创作学院', '全选', '举报', '删除', '最近发布', '点赞最多',
  '回复最多', '用户可见评论', '待精选评论', '视频评论', '专栏评论', '音频评论', '全部评论', '全部视频',
  '搜索视频评论', '投稿', '数据概览', '账号诊断', '稿件分析', '粉丝分析', '专栏数据', '回到主界面', '主站',
];

const TIME_RE = /20\d{2}\D{1,3}\d{1,2}\D{1,3}\d{1,2}\D{0,3}\d{1,2}[:：]\d{2}/;

function isNavWord(n) {
  return NAV_WORDS.includes(n);
}

/**
 * 评论区专用抽取：以「时间戳」行为每条评论的分隔锚点。
 * 时间戳那一行右侧就是该条的「回复」按钮，比找「回复」二字可靠（OCR 常把它糊掉）。
 */
function extractComments(lines, image) {
  const W = Number(image.width) || 1280;
  const xMin = W * 0.18;
  // 右侧是推荐视频卡片，别把卡片标题算进评论
  const xMax = W * 0.85;
  const anchors = [];
  for (const l of lines || []) {
    const n = norm(l.text);
    if (!TIME_RE.test(n)) continue;
    if ((l.w || 0) < 80) continue;
    if ((l.x + l.w / 2) < xMin) continue;
    anchors.push(l);
  }
  anchors.sort((a, b) => a.y - b.y);

  const out = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    // 第一条没有上界，只看时间戳上方 300px，避免把表头/导航算进来
    const prevY = i === 0 ? a.y - 300 : anchors[i - 1].y + anchors[i - 1].h;
    const parts = [];
    for (const l of lines || []) {
      const cyLine = l.y + l.h / 2;
      if (cyLine <= prevY + 2 || cyLine >= a.y - 2) continue;
      const cx = l.x + l.w / 2;
      if (cx < xMin || cx > xMax) continue;
      const t = String(l.text || '').trim();
      if (isNoise(t)) continue;
      const n = norm(t);
      if (!n || isNavWord(n)) continue;
      parts.push(n);
    }
    const text = parts.join('');
    if (norm(text).length < 3) continue;
    out.push({
      text,
      cy: a.y + a.h / 2,
      replyAt: { x: Math.round(a.x + a.w - 18), y: Math.round(a.y + a.h / 2) },
      time: norm(a.text).slice(0, 19),
    });
  }
  return out;
}

/** 只扫描：打开评论页 → 截图 → OCR → 返回可读评论与界面锚点，不发任何东西 */
export async function scan(root, { open = true, saveShot = false } = {}) {
  const settings = loadSettings(root);
  const ledger = settings.comments.replied || [];
  const ownReplies = ledger.map((r) => r.reply);

  let cfg;
  let image;
  let ocrPath;
  let uiLines;
  let steps = [];

  if (open) {
    const page = await openCommentsVerified(root);
    cfg = page.cfg;
    image = page.image;
    ocrPath = page.ocrJson;
    uiLines = page.lines;
    steps = page.steps;
  } else {
    cfg = loadBiliConfig(root);
    const r = await ocrShot(cfg, root, 'scan');
    image = r.image;
    ocrPath = r.ocrJson;
    uiLines = r.lines;
  }

  const comments = extractComments(uiLines, image);
  const sendAnchor = uiLines.find((l) => norm(l.text).includes('发送'));

  const page = {
    window: cfg.client.creatorWindow,
    shot: image.path,
    width: image.width,
    height: image.height,
    scale: image.scale,
    origin: image.origin,
    ocrJson: ocrPath,
  };
  return {
    ok: true,
    steps,
    page,
    comments: comments.map((c) => ({ text: c.text, y: Math.round(c.cy), replyAt: c.replyAt, time: c.time })),
    anchors: {
      replyLabels: comments.length,
      send: sendAnchor ? { x: sendAnchor.x, y: sendAnchor.y } : null,
    },
    text: comments.map((c) => c.text),
    keep: saveShot,
  };
}

/** 规则匹配：match 可以是 '*'、子串、子串数组，或 /正则/ 写法 */
function ruleMatched(match, text) {
  if (!match) return true;
  if (Array.isArray(match)) return match.some((m) => ruleMatched(m, text));
  const m = String(match).trim();
  if (m === '*') return true;
  if (m.length > 2 && m.startsWith('/') && m.lastIndexOf('/') > 0) {
    try {
      const body = m.slice(1, m.lastIndexOf('/'));
      const flags = m.slice(m.lastIndexOf('/') + 1) || 'i';
      return new RegExp(body, flags).test(text);
    } catch {
      return false;
    }
  }
  return text.includes(m);
}

/**
 * 挑回复：先按规则顺序匹配，命中后从 replies 池里挑一句。
 * usedReplies 传最近用过的文案，优先选没用过的 —— 同一句连刷很像机器人。
 */
export function pickRule(commentText, rules, fallback, usedReplies = []) {
  const t = String(commentText || '').replace(/\s+/g, ' ').trim();
  const fill = (s) => String(s).replace(/\{comment\}/g, t.slice(0, 16));
  for (const r of rules || []) {
    if (!ruleMatched(r.match, t)) continue;
    const pool = (Array.isArray(r.replies) ? r.replies : [r.reply]).map((x) => (x == null ? '' : String(x))).filter(Boolean);
    if (!pool.length) continue;
    const fresh = pool.filter((x) => !usedReplies.includes(fill(x)));
    const src = fresh.length ? fresh : pool;
    const pick = src[Math.floor(Math.random() * src.length)];
    return fill(pick);
  }
  return fallback ? fill(fallback) : null;
}

function apiCookieOf(root, opts = {}) {
  const settings = loadSettings(root);
  return String(opts.cookie || process.env.BILI_COOKIE || (settings.keys && settings.keys.bili) || '').trim();
}

/**
 * 走评论接口回复（稳定路线）：读自己最近稿件 → 拉评论 → 规则匹配 → /x/v2/reply/add。
 * 不碰窗口、不截图，一条回复只是一次 HTTPS 请求；成功与否看返回 code。
 * 平台约 30 秒 1 条，这里按 gapMs 排队，不尝试突破。
 */
export async function autoReplyViaApi(root, opts = {}) {
  const settings = loadSettings(root);
  const send = opts.send === true;
  const maxPerRun = Math.max(0, Math.min(10, Number(opts.maxPerRun ?? settings.comments.maxPerRun ?? 3)));
  const videosN = Math.max(1, Math.min(10, Number(opts.videos ?? settings.comments.apiVideos ?? 3)));
  const gapMs = Math.max(3000, Number(opts.gapMs ?? settings.comments.apiGapMs ?? 30000));
  const rules = opts.rules || settings.comments.rules || [];
  const fallbackReply = opts.fallback ?? settings.comments.fallback ?? '';
  const recentHours = Math.max(0, Number(opts.recentHours ?? settings.comments.recentHours ?? 0));
  // 最近用过的回复文案：挑新评论时避开，别在同一片下面连刷同一句
  const usedReplies = (settings.comments.replied || []).slice(-20).map((r) => r.reply).filter(Boolean);

  const raw = apiCookieOf(root, opts);
  if (!raw) {
    return {
      ok: false,
      via: 'api',
      code: 'no-cookie',
      error: '没配置评论接口 Cookie：需要 SESSDATA + bili_jct（建议再带 buvid3）。用 ai_diary_settings 写 keys.bili，或设环境变量 BILI_COOKIE。',
    };
  }
  const chk = A.checkCookie(raw);
  if (!chk.ok) {
    return { ok: false, via: 'api', code: 'no-cookie', error: `Cookie 缺 ${chk.missing.join(' + ')}，请补齐后再试` };
  }

  const nav = await A.getNav(raw);
  const videos = await A.listMyVideos(raw, nav.mid, { ps: videosN, keys: nav.keys });
  if (!videos.length) {
    return { ok: true, via: 'api', scanned: 0, planned: 0, sent: 0, send, mid: nav.mid, uname: nav.uname, note: '这个账号下没读到已发布的稿件' };
  }

  const done = new Set((settings.comments.replied || []).map((r) => r.fp));
  const plan = [];
  const scannedRows = [];
  const videoErrors = [];
  for (const v of videos) {
    let list = [];
    try {
      list = (await A.listComments(raw, v.aid, { keys: nav.keys })).list;
    } catch (e) {
      videoErrors.push({ video: v.title, error: e.message, code: e.code ?? null });
      continue;
    }
    for (const c of list) {
      scannedRows.push({ video: v.title, uname: c.uname, text: c.text.slice(0, 80) });
      if (A.answeredByMe(c, nav.mid)) continue;
      // 时间窗口：只回 N 小时内冒出来的评论，老评论不翻出来互动（0 = 不限）
      if (recentHours > 0 && c.ctime) {
        const ageHours = (Date.now() / 1000 - Number(c.ctime)) / 3600;
        if (ageHours > recentHours) {
          scannedRows[scannedRows.length - 1].skip = 'too-old';
          continue;
        }
      }
      const reply = pickRule(c.text, rules, fallbackReply, usedReplies);
      if (!reply) continue;
      if (!reply) continue;
      const fp = 'rpid:' + c.rpid;
      if (done.has(fp)) continue;
      plan.push({
        video: v.title,
        bvid: v.bvid,
        aid: v.aid,
        rpid: c.rpid,
        root: c.root || c.rpid,
        parent: c.rpid,
        uname: c.uname,
        comment: c.text,
        reply,
        fp,
        at: c.ctime ? new Date(c.ctime * 1000).toISOString() : null,
      });
      if (plan.length >= maxPerRun) break;
    }
    if (plan.length >= maxPerRun) break;
  }

  const base = {
    ok: true,
    via: 'api',
    mid: nav.mid,
    uname: nav.uname,
    videos: videos.map((v) => ({ title: v.title, bvid: v.bvid, aid: v.aid })),
    scanned: scannedRows.length,
    sample: scannedRows.slice(0, 12),
    planned: plan.length,
    send,
    gapMs,
    videoErrors: videoErrors.length ? videoErrors : null,
  };

  if (!plan.length) {
    return { ...base, sent: 0, note: '没有命中规则的新评论（我自己的、回过的、或没匹配上规则的都跳过）' };
  }
  if (!send) {
    return { ...base, sent: 0, plan, note: '预演：确认无误后加 send=true 才会真发' };
  }

  const results = [];
  let fatal = null;
  for (let i = 0; i < plan.length; i += 1) {
    const p = plan[i];
    try {
      const r = await A.addReply(raw, { oid: p.aid, message: p.reply, root: p.root, parent: p.parent, bvid: p.bvid });
      results.push({ video: p.video, comment: p.comment, reply: p.reply, rpid: p.rpid, sent: true, at: p.at, newRpid: r.rpid });
      const cur = loadSettings(root);
      const replied = (cur.comments.replied || []).slice(-499);
      replied.push({ fp: p.fp, comment: p.comment.slice(0, 60), reply: p.reply.slice(0, 60), at: new Date().toISOString(), via: 'api' });
      saveSettings(root, { comments: { replied } });
    } catch (e) {
      results.push({ video: p.video, comment: p.comment, reply: p.reply, rpid: p.rpid, sent: false, error: e.message, code: e.code ?? null });
      const code = String(e.code);
      // 登录态/风控类错误重试也没用，停下来并把原因交给上层决定是否回退 GUI
      if (['-101', '-111', '-412', '-352', '25004', 'not-login'].includes(code)) {
        fatal = { code: e.code, message: e.message };
        break;
      }
    }
    if (i < plan.length - 1) await sleep(gapMs);
  }

  return { ...base, sent: results.filter((r) => r.sent).length, results, fatal };
}

/**
 * 自动回复入口：按 comments.mode 决定走接口还是点按钮。
 *   hybrid（默认）：接口优先；接口没配 Cookie 或返回登录/风控错误时，回退 GUI 一次。
 *   api：只走接口，失败就直接返回原因。
 *   gui：保持原来的截图点按钮。
 */
export async function autoReply(root, opts = {}) {
  const settings = loadSettings(root);
  const mode = String(opts.mode || settings.comments.mode || 'hybrid');
  if (mode === 'gui') return guiAutoReply(root, opts);

  let apiErr = null;
  try {
    const r = await autoReplyViaApi(root, opts);
    if (r.ok) {
      const allowFallback = mode === 'hybrid' && settings.comments.guiFallback !== false;
      if (r.fatal && allowFallback && opts.send === true) {
        const g = await guiAutoReply(root, opts, `接口出错（${r.fatal.message}），已回退到点按钮，只回退这一次`);
        return { ...g, via: 'hybrid', apiResults: r.results, apiFatal: r.fatal };
      }
      return r;
    }
    if (r.code !== 'no-cookie' || mode === 'api') return r;
    apiErr = r.error;
  } catch (e) {
    apiErr = e.message;
    if (mode === 'api') return { ok: false, via: 'api', code: e.code ?? null, error: e.message };
    if (!['-101', '-111', '-412', '-352', '25004', 'not-login'].includes(String(e.code))) {
      // 网络类错误也允许回退一次，但如实记账
      apiErr = e.message;
    }
  }

  if (settings.comments.guiFallback === false) {
    return { ok: false, via: 'api', error: apiErr || '接口不可用，且已关闭 GUI 回退' };
  }
  const g = await guiAutoReply(root, opts, apiErr ? `接口不可用（${apiErr}），回退到点按钮，只回退这一次` : null);
  return { ...g, via: 'hybrid', apiError: apiErr };
}

/**
 * 验 Cookie：能取到登录态和自己的稿件，才说明接口这条路能发。
 * 不做任何回复动作，安全。
 */
export async function checkAuth(root, opts = {}) {
  const raw = apiCookieOf(root, opts);
  if (!raw) {
    return { ok: false, code: 'no-cookie', error: '没配置 Cookie：把 SESSDATA、bili_jct、buvid3 写进 keys.bili（或环境变量 BILI_COOKIE）' };
  }
  const chk = A.checkCookie(raw);
  if (!chk.ok) return { ok: false, code: 'no-cookie', error: `Cookie 缺 ${chk.missing.join(' + ')}` };
  try {
    const nav = await A.getNav(raw);
    const videos = await A.listMyVideos(raw, nav.mid, { ps: 5, keys: nav.keys });
    return {
      ok: true,
      mid: nav.mid,
      uname: nav.uname,
      hasBuvid: chk.hasBuvid,
      videos: videos.map((v) => ({ title: v.title, bvid: v.bvid, aid: v.aid })),
      note: chk.hasBuvid ? 'Cookie 可用，接口路线可以直接发' : 'Cookie 可用，但缺 buvid3，发送时容易被 -412 拦，建议补上',
    };
  } catch (e) {
    return { ok: false, code: e.code ?? null, error: e.message };
  }
}

/**
 * 自动回复（GUI 路线）。
 * @param {object} opts { send=false, rules=[], fallback='', maxPerRun=3, minGapMs=8000 }
 */
export async function guiAutoReply(root, opts = {}, note = null) {
  const send = opts.send === true;
  const maxPerRun = Math.max(0, Math.min(10, Number(opts.maxPerRun ?? 3)));
  const minGapMs = Math.max(3000, Number(opts.minGapMs ?? 8000));
  const settings = loadSettings(root);
  const merged = {
    rules: opts.rules || settings.comments.rules || [],
    fallback: opts.fallback ?? settings.comments.fallback ?? '',
  };

  const s = await scan(root);
  const cfg = loadBiliConfig(root);
  const comments = s.comments || [];

  const done = new Set((settings.comments.replied || []).map((r) => r.fp));
  const plan = [];
  for (const c of comments) {
    const reply = pickRule(c.text, merged.rules, merged.fallback);
    if (!reply) continue;
    const fp = fingerprint(c.text);
    if (done.has(fp)) continue;
    if (!c.replyAt) continue;
    plan.push({
      comment: c.text,
      reply,
      y: Math.round(c.y),
      // 记成相对坐标，后面截图尺寸变了也不会错位
      fx: c.replyAt.x / (s.page.width || 1280),
      fy: c.replyAt.y / (s.page.height || 720),
      fp,
    });
    if (plan.length >= maxPerRun) break;
  }

  if (!plan.length) {
    return { ok: true, via: 'gui', scanned: s.comments.length, planned: 0, sent: 0, send, shot: s.page.shot, note: note ? `${note}；没有命中规则的新评论，或页面上找不到「回复」入口` : '没有命中规则的新评论，或页面上找不到「回复」入口' };
  }
  if (!send) {
    return { ok: true, via: 'gui', scanned: s.comments.length, planned: plan.length, sent: 0, send: false, plan, shot: s.page.shot, note: note || '预演：确认无误后加 send=true 才会真发' };
  }

  const results = [];
  for (const p of plan) {
    try {
      await guardDeleteDialog(cfg, root);

      // 先把页面滚回顶部：评论区会滚动，旧坐标会指到别的行甚至别的视频
      await runEngine({ op: 'act', actions: [`focus ${cfg.client.creatorWindow}`, 'key ctrl+home', 'wait 1'], options: { timeoutMs: 30000 } }, { timeoutMs: 30000 });
      await sleep(600);

      // 用当前截图里真实存在的「回复」文字做定位，而不是只用计划里缓存的坐标
      const rowImg = await shot(cfg, root);
      const RW = Number(rowImg.width) || 1280;
      const RH = Number(rowImg.height) || 720;
      const ay0 = Math.round(p.fy * RH);
      const full = await runOcr(rowImg.path, path.join(root, 'out', 'ocr', `ocr-rowFind-${Date.now()}.json`));
      const candidates = (full.lines || [])
        .filter((l) => {
          const n = norm(l.text);
          return n.startsWith('回') && !/删|举|顶|赞|更多|评论管理/.test(n) && n.length <= 12;
        })
        .map((l) => ({ l, y: l.y + l.h / 2 }))
        .sort((a, b) => Math.abs(a.y - ay0) - Math.abs(b.y - ay0));
      if (!candidates.length || Math.abs(candidates[0].y - ay0) > 200) {
        results.push({ comment: p.comment, reply: p.reply, sent: false, error: '当前页面上没找到这条评论对应的「回复」按钮，跳过不点', shot: rowImg.path });
        continue;
      }
      const target = candidates[0].l;
      const ax = target.x + target.w / 2;
      const ay = target.y + target.h / 2;
      // 点之前再把这一行放大认一次，确认真的是回复而不是删除/举报
      const rowRegion = { x: Math.max(0, Math.round(ax - 120)), y: Math.max(0, Math.round(ay - 22)), w: 280, h: 46, scale: 3 };
      const rc = await cropOcr(cfg, root, rowImg, rowRegion, 'row2');
      const okRow = (rc?.lines || []).some((l) => {
        const n = norm(l.text);
        return n.startsWith('回') && !/删|举|顶|赞/.test(n);
      });
      if (!okRow) {
        results.push({ comment: p.comment, reply: p.reply, sent: false, error: '这一行放大后仍认不出「回复」，跳过不点', shot: rowImg.path });
        continue;
      }
      const [px, py] = toPhys(rowImg, ax, ay);
      await runEngine({ op: 'act', actions: [`focus ${cfg.client.creatorWindow}`, `move ${px} ${py}`, 'wait 0.2', `click ${px} ${py}`, 'wait 1'], options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
      await sleep(900);
      await assertCommentsPage(cfg, root, 'afterReplyClick');

      const out = await sendOneReply(cfg, root, p, p.reply);
      results.push({ comment: p.comment, reply: p.reply, sent: out.sent, error: out.error || null, shot: out.shot });
      if (out.sent) {
        const cur = loadSettings(root);
        const replied = (cur.comments.replied || []).slice(-499);
        replied.push({ fp: p.fp, comment: p.comment.slice(0, 60), reply: p.reply.slice(0, 60), at: new Date().toISOString() });
        saveSettings(root, { comments: { replied } });
      }
    } catch (e) {
      results.push({ comment: p.comment, reply: p.reply, sent: false, error: e.message });
      break;
    }
    await sleep(minGapMs);
  }

  const sentCount = results.filter((r) => r.sent).length;
  return { ok: true, via: 'gui', scanned: s.comments.length, planned: plan.length, sent: sentCount, send: true, results, shot: s.page.shot, note: note || null };
}

/** 挂一段时间：每 intervalMinutes 扫一次，共 minutes 分钟 */
export async function watch(root, opts = {}) {
  const minutes = Math.max(1, Math.min(24 * 60, Number(opts.minutes ?? 30)));
  const intervalMinutes = Math.max(1, Number(opts.intervalMinutes ?? 5));
  const deadline = Date.now() + minutes * 60_000;
  const log = [];
  let total = 0;
  let round = 0;

  while (Date.now() < deadline) {
    round += 1;
    try {
      const r = await autoReply(root, opts);
      total += r.sent || 0;
      log.push({ round, at: new Date().toISOString(), scanned: r.scanned, planned: r.planned, sent: r.sent, note: r.note || null, results: r.results || null });
    } catch (e) {
      log.push({ round, at: new Date().toISOString(), error: e.message });
    }
    const left = deadline - Date.now();
    if (left <= 0) break;
    await sleep(Math.min(intervalMinutes * 60_000, left));
  }

  const roundLog = log.slice(-20);
  saveSettings(root, { comments: { watch: { at: new Date().toISOString(), minutes, sent: total, rounds: round, log: roundLog } } });
  return { ok: true, minutes, intervalMinutes, rounds: round, sent: total, log: roundLog };
}

/** 校准：返回当前评论页的截图、OCR 行与找到的锚点，供人工确认坐标 */
export async function calibrate(root) {
  const s = await scan(root, { saveShot: true });
  return {
    ok: true,
    shot: s.page.shot,
    size: `${s.page.width}x${s.page.height}`,
    anchors: s.anchors,
    sample: s.comments.slice(0, 12),
    hint: s.anchors.replyLabels
      ? `页面上找到 ${s.anchors.replyLabels} 个「回复」入口，可按界面文字定位`
      : '页面上没找到「回复」文字，客户端可能用纯图标；此时只能用固定锚点（config/bili.json 的 comments）',
  };
}

/** 纯函数导出，便于离线单测（不碰客户端） */
export const _internals = { cleanComments, extractComments, findLabel, findAnyLabel, pickRule, fingerprint, isNoise, toPhys };