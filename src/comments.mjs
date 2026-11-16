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
  const out = path.join(root, 'out', 'ocr', `shot-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const win = cfg.client.creatorWindow;
  const front = await bringToFront(win);
  if (!front) {
    throw new Error(`无法把「${win}」提到前台（可能被全屏窗口压住），请把哔哩哔哩客户端切到最前再试`);
  }
  const r = await runEngine({ op: 'see', what: 'shot', window: win, width: 1920, out, options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
  if (!r.ok || !r.image) throw new Error('截图失败：' + (r.error || '未知原因'));
  const note = (r.lines || []).join(' ');
  if (/occluded/i.test(note)) {
    throw new Error('目标窗口被别的窗口挡住，截到的是别的画面；请把哔哩哔哩窗口放到前台再试。截图：' + r.image.path);
  }
  return r.image;
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

function findLabel(lines, label, nearY = null, { minY = 0, maxX = Infinity, minX = 0 } = {}) {
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
    return cy >= minY && cx >= minX && cx <= maxX;
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

/** 页面上出现了删除确认弹窗时，点「取消」并终止（绝不点「确定」） */
async function guardDeleteDialog(cfg, root) {
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

const PAGE_MARKERS = ['评论管理', '全部评论', '暂无评论', '还没有评论'];

function hasMarker(lines) {
  const all = (lines || []).map((l) => norm(l.text));
  return PAGE_MARKERS.some((m) => all.some((t) => t.includes(m)));
}

async function clickLine(cfg, image, line) {
  const [x, y] = toPhys(image, line.x + line.w / 2, line.y + line.h / 2);
  const r = await runEngine(
    { op: 'act', actions: [`focus ${cfg.client.creatorWindow}`, `click ${x} ${y}`, 'wait 1.5'], options: { timeoutMs: 45000 } },
    { timeoutMs: 45000 },
  );
  if (!r.ok) throw new Error('点击失败：' + (r.error || '未知'));
  return [x, y];
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

  const steps = [];
  const navOpts = { maxX: Math.round((s.image.width || 1280) * 0.3) };
  const interact = findAnyLabel(s.lines, ['互动管理', '互动'], null, navOpts);
  if (!interact) {
    throw new Error('当前页找不到「互动管理」入口，停在原地不再盲点。截图：' + s.image.path);
  }
  await clickLine(cfg, s.image, interact);
  steps.push('点「互动管理」');

  s = await ocrShot(cfg, root, 'p1');
  let cm = findAnyLabel(s.lines, ['评论管理', '评论'], null, navOpts);
  if (!cm) {
    throw new Error('展开后找不到「评论管理」入口，停在原地不再盲点。截图：' + s.image.path);
  }
  await clickLine(cfg, s.image, cm);
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

function pickRule(commentText, rules, fallback) {
  const t = String(commentText || '');
  for (const r of rules || []) {
    const m = String(r.match || '*');
    if (m === '*' || t.includes(m)) {
      return (r.reply || fallback || '').replace(/\{comment\}/g, t.slice(0, 16));
    }
  }
  return fallback ? String(fallback).replace(/\{comment\}/g, t.slice(0, 16)) : null;
}

/**
 * 自动回复。
 * @param {object} opts { send=false, rules=[], fallback='', maxPerRun=3, minGapMs=8000 }
 */
export async function autoReply(root, opts = {}) {
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
    return { ok: true, scanned: s.comments.length, planned: 0, sent: 0, send, shot: s.page.shot, note: '没有命中规则的新评论，或页面上找不到「回复」入口' };
  }
  if (!send) {
    return { ok: true, scanned: s.comments.length, planned: plan.length, sent: 0, send: false, plan, shot: s.page.shot, note: '预演：确认无误后加 send=true 才会真发' };
  }

  const results = [];
  for (const p of plan) {
    try {
      await guardDeleteDialog(cfg, root);

      // 先把这一行放大认字：找到「回复」两个字再点，避免点到旁边的「删除」
      const rowImg = await shot(cfg, root);
      const RW = Number(rowImg.width) || 1280;
      const RH = Number(rowImg.height) || 720;
      const ax0 = Math.round(p.fx * RW);
      const ay0 = Math.round(p.fy * RH);
      const rowRegion = {
        x: Math.max(0, ax0 - 170),
        y: Math.max(0, ay0 - 26),
        w: Math.round(Math.min(RW - Math.max(0, ax0 - 170), 520)),
        h: 62,
        scale: 3,
      };
      const rc = await cropOcr(cfg, root, rowImg, rowRegion, 'row');
      // 灰色小字 OCR 常把「回复」认成「回 軀」之类，所以只认「以回开头且不是删除/举报/置顶」
      const replyLine = (rc?.lines || []).find((l) => {
        const n = norm(l.text);
        return n.startsWith('回') && !/删|举|顶|赞|更多|评论管理/.test(n);
      });
      if (!replyLine) {
        results.push({ comment: p.comment, reply: p.reply, sent: false, error: '这一行没认出「回复」按钮，跳过不点', shot: rowImg.path });
        continue;
      }
      const [ax, ay] = toPhys(rowImg, replyLine.x + replyLine.w / 2, replyLine.y + replyLine.h / 2);
      await runEngine({ op: 'act', actions: [`focus ${cfg.client.creatorWindow}`, `click ${ax} ${ay}`, 'wait 1'], options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
      await sleep(700);

      // 打开回复框后先认一下输入区：优先按「回复 @某人」占位文字定位，认不到再按锚点下方估
      const region = {
        x: Math.round(RW * 0.27),
        y: Math.max(0, ay0 + 14),
        w: Math.round(RW * 0.56),
        h: Math.round(Math.max(120, Math.min(RH - ay0 - 14, 260))),
        scale: 3,
      };
      const shot1 = await shot(cfg, root);
      const c1 = await cropOcr(cfg, root, shot1, region, 'box');
      const ph = (c1?.lines || []).find((l) => norm(l.text).includes('回复@')) || (c1?.lines || []).find((l) => norm(l.text).startsWith('回复'));
      let boxPt;
      if (ph) {
        boxPt = toPhys(shot1, ph.x + 120, ph.y + 55);
      } else {
        boxPt = toPhys(shot1, RW * 0.55, ay0 + 95);
      }
      await runEngine({ op: 'act', actions: [`click ${boxPt[0]} ${boxPt[1]}`, 'wait 0.6'], options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
      await runEngine({ op: 'act', actions: [`paste ${p.reply}`, 'wait 0.9'], options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
      await sleep(600);

      await guardDeleteDialog(cfg, root);
      const image2 = await shot(cfg, root);
      const c2 = await cropOcr(cfg, root, image2, region, 'send');
      const sendLine = (c2?.lines || []).find((l) => {
        const n = norm(l.text);
        return n.includes('发表回') || n.includes('发送') || n.includes('发表');
      });
      if (!sendLine) {
        results.push({ comment: p.comment, reply: p.reply, sent: false, error: '没找到「发表回复」按钮，已停在填入状态', shot: image2.path });
        break;
      }
      const [sx, sy] = toPhys(image2, sendLine.x + sendLine.w / 2, sendLine.y + sendLine.h / 2);
      const r = await runEngine({ op: 'act', actions: [`click ${sx} ${sy}`, 'wait 2.2'], options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
      results.push({ comment: p.comment, reply: p.reply, sent: r.ok, error: r.error || null });
      if (r.ok) {
        const cur = loadSettings(root);
        const replied = (cur.comments.replied || []).slice(-199);
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
  return { ok: true, scanned: s.comments.length, planned: plan.length, sent: sentCount, send: true, results, shot: s.page.shot };
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