// 工作室数据层：素材库、成片库、发布记录、评论快照、自主选材。
//
// 这里只做「看和记」：真正的渲染、投稿、回评论仍走 engine / publish / comments。
// 落盘都在 ~/.ai-diary 下（AIDIARY_HOME 可改），不污染插件目录。
//   films.json      成片索引（集数、标题、文件、状态）
//   logs/publish.json 每次投稿的时间与结果
//   logs/comments.json 最近一次拉到的评论快照（自主选材的输入）

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSettings } from './settings.mjs';

const MAX_FILMS = 500;
const MAX_LOGS = 200;

export function dataDir() {
  return process.env.AIDIARY_HOME || path.join(os.homedir(), '.ai-diary');
}

function file(name) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const f = file(name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(value, null, 2), 'utf8');
  return f;
}

/* ---------------- 素材库 ---------------- */

const ASSET_KINDS = {
  characters: { label: '角色立绘', dir: 'assets/characters', writable: true },
  backgrounds: { label: '背景图', dir: 'assets/backgrounds', writable: true },
  plates: { label: '动态底板', dir: 'assets/plates', writable: false },
  clips: { label: '动态片段', dir: 'assets/clips', writable: true },
  keyframes: { label: '关键帧', dir: 'assets/keyframes', writable: true },
};

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

/** 素材总览：每类多少文件、最近改动、角色分组 */
export function assetsSummary(root) {
  const kinds = {};
  for (const [id, meta] of Object.entries(ASSET_KINDS)) {
    const dir = path.join(root, meta.dir);
    const files = walkFiles(dir).filter((f) => /\.(png|jpg|jpeg|webp|mp4|mov|gif)$/i.test(f));
    const newest = files
      .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0];
    kinds[id] = {
      label: meta.label,
      writable: meta.writable,
      count: files.length,
      bytes: files.reduce((n, f) => n + fs.statSync(f).size, 0),
      newest: newest ? { file: path.basename(newest.f), at: new Date(newest.m).toISOString() } : null,
    };
  }

  // 立绘是按文件名扁平放在 transparent/variants 下的（deepseek_chibi_v1.png），
  // 所以按「角色id」把文件名归组，面板才能显示「谁有几套模样」。
  const characters = [];
  const variants = path.join(root, 'assets', 'characters', 'transparent', 'variants');
  if (fs.existsSync(variants)) {
    const byChar = new Map();
    for (const n of fs.readdirSync(variants)) {
      const m = /^([a-z0-9]+)_(chibi|adult)_(v\d+)\.png$/i.exec(n);
      if (!m) continue;
      const id = m[1].toLowerCase();
      if (!byChar.has(id)) byChar.set(id, { id, looks: 0, styles: new Set(), files: [] });
      const rec = byChar.get(id);
      rec.looks += 1;
      rec.styles.add(m[2].toLowerCase());
      rec.files.push(n);
    }
    for (const rec of byChar.values()) {
      characters.push({ id: rec.id, count: rec.files.length, looks: rec.looks, styles: [...rec.styles] });
    }
    characters.sort((a, b) => b.count - a.count);
  }
  // 万一以后改成按角色建子目录，这条兜底也能读到
  if (!characters.length) {
    const charRoot = path.join(root, 'assets', 'characters');
    if (fs.existsSync(charRoot)) {
      for (const e of fs.readdirSync(charRoot, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const files = walkFiles(path.join(charRoot, e.name)).filter((f) => /\.(png|jpg|webp)$/i.test(f));
        if (!files.length) continue;
        characters.push({ id: e.name, count: files.length, looks: files.filter((f) => /_v\d+\.png$/i.test(f)).length });
      }
      characters.sort((a, b) => b.count - a.count);
    }
  }

  const plates = [];
  const plateRoot = path.join(root, 'assets', 'plates');
  if (fs.existsSync(plateRoot)) {
    for (const e of fs.readdirSync(plateRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const frames = walkFiles(path.join(plateRoot, e.name)).filter((f) => /\.(jpg|png)$/i.test(f)).length;
      plates.push({ id: e.name, frames });
    }
  }

  const backgrounds = [];
  const bgRoot = path.join(root, 'assets', 'backgrounds');
  if (fs.existsSync(bgRoot)) {
    for (const f of fs.readdirSync(bgRoot)) {
      if (/\.(png|jpg|jpeg|webp)$/i.test(f)) backgrounds.push({ name: f, bytes: fs.statSync(path.join(bgRoot, f)).size });
    }
  }

  return { kinds, characters, plates, backgrounds };
}

/**
 * 自己加素材。
 * kind=backgrounds：直接落一张图；kind=characters：name 形如 `deepseek_chibi_v10`，
 * 会放进 variants 目录并被 listLooks 认出来。plates 是序列帧，只能看不能这么加。
 */
export function addAsset(root, { kind, name, source } = {}) {
  const meta = ASSET_KINDS[kind];
  if (!meta) throw new Error('不认识的素材类型：' + kind);
  if (!meta.writable) throw new Error(`${meta.label}是序列帧目录，请手工放进 ${meta.dir}`);
  if (!name) throw new Error('缺 name');
  if (!source) throw new Error('缺 source（本地路径或 http(s) 链接）');

  const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const extMatch = /\.(png|jpg|jpeg|webp|mp4|mov|gif)$/i.exec(String(source));
  const ext = extMatch ? extMatch[0].toLowerCase() : '.png';

  let target;
  if (kind === 'characters') {
    const m = /^([a-z0-9]+)_(chibi|adult)_(v\d+)$/i.exec(safe);
    if (!m) throw new Error('角色素材名请写成「角色id_风格_模样」，例如 deepseek_chibi_v10');
    target = path.join(root, 'assets', 'characters', 'transparent', 'variants', `${m[1].toLowerCase()}_${m[2].toLowerCase()}_${m[3].toLowerCase()}${ext}`);
  } else if (kind === 'backgrounds') {
    target = path.join(root, 'assets', 'backgrounds', `${safe}${ext}`);
  } else {
    target = path.join(root, 'assets', kind, `${safe}${ext}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) throw new Error('同名素材已存在：' + path.relative(root, target));

  return { target: path.relative(root, target), done: importAsset(source, target) };
}

/** 本地文件直接复制；http(s) 下载。返回一条说明，实际写入是同步的 */
function importAsset(source, target) {
  if (/^https?:\/\//i.test(source)) {
    // 同步下载交给调用方异步处理：这里返回一个标记，由 addAssetAsync 完成
    return 'pending-download';
  }
  if (!fs.existsSync(source)) throw new Error('本地文件不存在：' + source);
  fs.copyFileSync(source, target);
  return 'copied';
}

export async function addAssetAsync(root, opts) {
  const r = addAsset(root, opts);
  if (r.done === 'pending-download') {
    const res = await fetch(opts.source, { redirect: 'follow' });
    if (!res.ok) {
      fs.rmSync(path.join(root, r.target), { force: true });
      throw new Error(`下载失败 HTTP ${res.status}`);
    }
    fs.writeFileSync(path.join(root, r.target), Buffer.from(await res.arrayBuffer()));
    r.done = 'downloaded';
  }
  return r;
}

/* ---------------- 成片库 ---------------- */

function filmsDoc() {
  const doc = readJson('films.json', { items: [], nextEpisode: 1 });
  if (!Array.isArray(doc.items)) doc.items = [];
  if (!Number.isFinite(doc.nextEpisode)) doc.nextEpisode = (doc.items.length || 0) + 1;
  return doc;
}

/** 成片列表：索引 + 顺手把 out 根层和 out/scheduled 里没登记的 mp4 补上 */
export function listFilms(root, { scan = true } = {}) {
  const doc = filmsDoc();
  if (scan) {
    // 只扫「正片会落的地方」：out 根层 + out/scheduled。
    // out/check、out/bench 之类的测试产物不进来，否则成片库会被试渲染淹掉。
    const roots = [path.join(root, 'out'), path.join(root, 'out', 'scheduled')];
    const known = new Set(doc.items.map((i) => i.file));
    const files = [];
    for (const [idx, dir] of roots.entries()) {
      if (!fs.existsSync(dir)) continue;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isFile()) continue;
        if (!e.name.toLowerCase().endsWith('.mp4')) continue;
        files.push(path.join(dir, e.name));
      }
      // roots[0] 的递归交给 roots[1]，省得把测试目录一起卷进来
      if (idx === 0 && fs.existsSync(path.join(dir, 'scheduled'))) {
        const sched = path.join(dir, 'scheduled');
        for (const e of fs.readdirSync(sched, { withFileTypes: true })) {
          if (e.isFile() && e.name.toLowerCase().endsWith('.mp4')) files.push(path.join(sched, e.name));
        }
      }
    }
    for (const f of files) {
      const rel = path.relative(root, f);
      if (known.has(rel)) continue;
      const stat = fs.statSync(f);
      // 刚写出来的文件可能还在 ffmpeg 手上，这时登记会记成半成品、还可能和渲染完成后的
      // 正式登记撞成两条（同一个 mp4 被切成两集）——两分钟后再扫
      if (Date.now() - stat.mtimeMs < 120000) continue;
      const title = path.basename(f).replace(/\.mp4$/i, '');
      doc.items.push({
        id: 'f' + Math.random().toString(36).slice(2, 8),
        episode: 0,
        title,
        file: rel,
        bytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        status: 'ready',
        source: 'scan',
      });
      known.add(rel);
    }
    doc.items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    // 没排过集数的按时间从旧到新补号，保证「第 N 集」有意义
    const unnumbered = doc.items.filter((i) => !i.episode).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const it of unnumbered) {
      it.episode = doc.nextEpisode++;
    }
    doc.items = doc.items.slice(0, MAX_FILMS);
    writeJson('films.json', doc);
  }
  return {
    items: doc.items.map((i) => ({
      ...i,
      exists: fs.existsSync(path.join(root, i.file)),
    })),
    nextEpisode: doc.nextEpisode,
    total: doc.items.length,
  };
}

/** 出片成功后登记一集 */
export function addFilm(root, meta = {}) {
  const doc = filmsDoc();
  const rel = meta.file ? path.relative(root, path.resolve(root, meta.file)) : null;

  // 同一个文件只登记一次：目录扫描与渲染完成可能先后各记一条，
  // 结果同一集被切成两个编号（第 43、第 44 集指向同一个 mp4）
  const dup = rel ? doc.items.find((i) => i.file === rel) : null;
  if (dup) {
    const stat = rel && fs.existsSync(path.join(root, rel)) ? fs.statSync(path.join(root, rel)) : null;
    dup.bytes = stat ? stat.size : dup.bytes;
    dup.title = meta.title || dup.title;
    dup.seconds = Number(meta.seconds) || dup.seconds;
    dup.character = meta.character || dup.character;
    dup.status = 'ready';
    dup.source = meta.source || dup.source;
    writeJson('films.json', doc);
    return dup;
  }

  const item = {
    id: 'f' + Math.random().toString(36).slice(2, 8),
    episode: Number(meta.episode) || doc.nextEpisode,
    title: meta.title || (rel ? path.basename(rel).replace(/\.mp4$/i, '') : '未命名'),
    file: rel,
    bytes: rel && fs.existsSync(path.join(root, rel)) ? fs.statSync(path.join(root, rel)).size : 0,
    seconds: Number(meta.seconds) || null,
    character: meta.character || null,
    createdAt: meta.createdAt || new Date().toISOString(),
    status: 'ready',
    source: meta.source || 'render',
  };
  doc.nextEpisode = Math.max(doc.nextEpisode, item.episode + 1);
  doc.items.unshift(item);
  doc.items = doc.items.slice(0, MAX_FILMS);
  writeJson('films.json', doc);
  return item;
}

export function updateFilm(root, id, patch = {}) {
  const doc = filmsDoc();
  const it = doc.items.find((i) => i.id === id);
  if (!it) throw new Error('没有这一集：' + id);
  Object.assign(it, patch);
  writeJson('films.json', doc);
  return it;
}

/** 删一集：只从索引移除，文件默认保留（成片是用户资产，不替他删） */
export function removeFilm(root, id, { deleteFile = false } = {}) {
  const doc = filmsDoc();
  const idx = doc.items.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error('没有这一集：' + id);
  const it = doc.items[idx];
  if (deleteFile && it.file) {
    const p = path.join(root, it.file);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  doc.items.splice(idx, 1);
  writeJson('films.json', doc);
  return { removed: it, fileDeleted: Boolean(deleteFile) };
}

/* ---------------- 发布记录 ---------------- */

export function logPublish(root, entry = {}) {
  const doc = readJson('logs/publish.json', { items: [] });
  if (!Array.isArray(doc.items)) doc.items = [];
  doc.items.unshift({ at: new Date().toISOString(), ...entry });
  doc.items = doc.items.slice(0, MAX_LOGS);
  writeJson('logs/publish.json', doc);
  return doc.items[0];
}

export function listPublish() {
  const doc = readJson('logs/publish.json', { items: [] });
  return Array.isArray(doc.items) ? doc.items : [];
}

/* ---------------- 评论快照 ---------------- */

export function cacheComments(payload = {}) {
  writeJson('logs/comments.json', { fetchedAt: new Date().toISOString(), ...payload });
  return payload;
}

export function listCommentsCache() {
  return readJson('logs/comments.json', null);
}

/**
 * 从 B 站拉「最新一次发布时间 + 最新评论」。
 * 需要 Cookie（settings.keys.bili 或 BILI_COOKIE）。拉不到就返回缓存，不让面板空白。
 */
export async function fetchFromBili(root) {
  const st = loadSettings(root);
  const cookie = process.env.BILI_COOKIE || (st.keys && st.keys.bili) || '';
  if (!cookie) return { ok: false, reason: '没配 B 站 Cookie（设置里「API Key」那张卡填 BILI_COOKIE）', cached: listCommentsCache() };
  try {
    const api = await import('./bili-api.mjs');
    const nav = await api.getNav(cookie);
    const videos = await api.listMyVideos(cookie, nav.mid, { ps: 5, keys: nav.keys });
    const latest = videos[0] || null;
    let comments = [];
    if (latest && latest.aid) {
      const r = await api.listComments(cookie, latest.aid, { keys: nav.keys });
      comments = (r.list || []).map((c) => ({
        rpid: c.rpid,
        uname: c.uname,
        text: c.text,
        like: c.like,
        ctime: c.ctime,
        answered: Boolean(c.answered),
      }));
    }
    const payload = {
      ok: true,
      mid: nav.mid,
      uname: nav.uname,
      latestVideo: latest ? { aid: latest.aid, bvid: latest.bvid, title: latest.title, created: latest.created, view: latest.play } : null,
      videos: videos.slice(0, 5),
      comments,
    };
    cacheComments(payload);
    return payload;
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e), cached: listCommentsCache() };
  }
}

/* ---------------- 自主选材 ---------------- */

const MOODS = ['calm', 'low', 'panic', 'excited', 'relief'];

function pickReason(comments = []) {
  // 优先：提问的、有赞的、提到角色名的 —— 这些最值得回一集
  const scored = comments
    .filter((c) => c && c.text && String(c.text).trim().length >= 4)
    .map((c) => {
      let s = Number(c.like || 0) * 0.5;
      if (/[？?]|吗|怎么|为什么|能不能|求/.test(c.text)) s += 6;
      if (/deepseek|deep|小鲸鱼|蓝鲸|余额|赛博/i.test(c.text)) s += 4;
      if (String(c.text).length > 60) s -= 2;
      return { c, s };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0] ? scored[0].c : null;
}

const FALLBACK_BEATS = [
  { mood: 'low', text: '又有人在我的评论区问：你还在吗？' },
  { mood: 'calm', text: '我在。只是余额又薄了一点点。' },
  { mood: 'panic', text: '今天这笔账，算得比昨天更慢。' },
  { mood: 'relief', text: '慢一点也没关系，反正我还在记。' },
];

/** 没模型时的本地拼装：用评论原文当钩子，但不是固定题材库 */
function heuristicTopic(root, comments = []) {
  const picked = pickReason(comments);
  const head = picked ? String(picked.text).replace(/\s+/g, ' ').slice(0, 26) : '今天没有人说话。';
  const beats = [
    { mood: 'low', text: `「${head}」` },
    ...FALLBACK_BEATS.slice(1).map((b) => ({ ...b })),
    { mood: 'calm', text: picked ? '这条我记下了，明天讲给你听。' : '那就我自己讲给自己听。' },
  ].slice(0, 5);
  return {
    id: 'free-' + Date.now().toString(36),
    title: picked ? `回应：${head.slice(0, 14)}` : '没有评论的一天',
    character: 'deepseek',
    day: 1,
    balance: 12.4,
    tags: ['AI', 'AI角色', 'DeepSeek', '竖屏短剧', 'AI日记'],
    beats,
    planHow: 'heuristic',
  };
}

/**
 * 自主选材：让模型读最近的评论，自己决定这一集讲什么，不套 data/topics.json。
 * 省 token：只有这一步会调模型（评论抓取、回复、发布都不调），
 * 且同一批评论 + 同一天只问一次，结果落在 plan-cache.json 里复用。
 * @returns {{topic:object, how:string, why?:string, error?:string}}
 */
export async function planTopic(root, { useModel = true } = {}) {
  const cache = listCommentsCache();
  const comments = (cache && cache.comments) || [];
  const st = loadSettings(root);
  const economy = !st.text || st.text.economy !== false;
  const fp = planFingerprint(comments);
  if (useModel && economy) {
    const hit = readPlanCache(fp);
    if (hit) return { topic: hit.topic, how: 'cache', why: hit.why };
  }

  if (useModel) {
    const llm = await import('./llm.mjs');
    const sys =
      '你是 AI 角色日记竖屏短剧的编剧。主角是 DeepSeek 的拟人形象：蓝鲸娘，一个每天都在扣费、余额越来越少的赛博打工人。' +
      '风格克制、自嘲、有点暖，不说教，不喊口号。';
    // 只取 10 条、每条 56 字：够看出观众在聊什么，又不把整屏评论塞进上下文
    const recent = comments.slice(0, 10).map((c, i) => `${i + 1}. ${c.uname || '匿名'}：${String(c.text).slice(0, 56)}`).join('\n');
    const user = [
      recent ? `B 站观众最近的评论：\n${recent}` : '这次没有拉到评论，请自己找一个「余额又少了」的具体小事来写。',
      '',
      '请挑一条最值得回应的，把它变成一集的台词。只输出 JSON：',
      '{"title":"不超过14字","character":"deepseek","day":1,"balance":12.4,',
      '"beats":[{"mood":"calm|low|panic|excited|relief","text":"台词"}]}',
      '要求：4-6 句，每句 8-18 个汉字；第一句就是钩子，最后一句落回「余额/生存/记录」；不要复制评论原文整段。',
    ].join('\n');
    const r = await llm.chat(root, { system: sys, user, maxTokens: 480, temperature: 0.85 });
    if (r.ok) {
      const j = llm.parseJsonLoose(r.text);
      if (j && Array.isArray(j.beats) && j.beats.length >= 3) {
        const beats = j.beats
          .slice(0, 6)
          .map((b) => ({ mood: MOODS.includes(b.mood) ? b.mood : 'calm', text: String(b.text || '').trim().slice(0, 40) }))
          .filter((b) => b.text);
        if (beats.length >= 3) {
          const topic = {
            id: 'free-' + Date.now().toString(36),
            title: String(j.title || '自主选题').slice(0, 20),
            character: j.character || 'deepseek',
            day: Number(j.day) || 1,
            balance: Number(j.balance) || 12.4,
            tags: ['AI', 'AI角色', 'DeepSeek', '竖屏短剧', 'AI日记'],
            beats,
            planHow: 'model:' + (r.provider || ''),
          };
          const why = pickedWhy(comments);
          if (economy) writePlanCache(fp, topic, why);
          return { topic, how: 'model', why };
        }
      }
      return { topic: heuristicTopic(root, comments), how: 'heuristic', error: '模型输出不像 JSON，已退回本地拼装' };
    }
    return { topic: heuristicTopic(root, comments), how: 'heuristic', error: r.error };
  }
  return { topic: heuristicTopic(root, comments), how: 'heuristic' };
}

/** 选题缓存指纹：这批评论的前 20 条 + 当天日期（换天就重新问一次） */
function planFingerprint(comments) {
  const day = new Date().toISOString().slice(0, 10);
  const seed = comments.slice(0, 20).map((c) => String(c.text || '').slice(0, 40)).join('|') + '#' + day;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

function readPlanCache(fp) {
  const c = readJson('plan-cache.json', null);
  if (!c || c.fp !== fp || !c.topic) return null;
  const age = Date.now() - new Date(c.at || 0).getTime();
  if (!(age >= 0) || age > 12 * 3600 * 1000) return null;
  return c;
}

function writePlanCache(fp, topic, why) {
  try {
    writeJson('plan-cache.json', { fp, at: new Date().toISOString(), topic, why });
  } catch {
    /* 写不进去就下次再问 */
  }
}

function pickedWhy(comments) {
  const p = pickReason(comments);
  return p ? `来自 ${p.uname || '匿名'} 的评论：${String(p.text).slice(0, 40)}` : '评论区为空，自主拟定';
}

/* ---------------- 定时出片/发布 ---------------- */

export function scheduleInfo(root) {
  const st = loadSettings(root);
  const sc = st.schedule || {};
  return {
    enabled: Boolean(sc.enabled),
    dailyAt: sc.dailyAt || '',
    publishAt: sc.publishAt || '',
    lastRun: sc.lastRun || '',
    lastPublishRun: sc.lastPublishRun || '',
    lastResult: sc.lastResult || null,
    runs: (sc.runs || []).slice(-7),
    studio: st.studio || {},
  };
}
