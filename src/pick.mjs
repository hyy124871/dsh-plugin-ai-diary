// 素材选取器：按题材/情绪/角色，从现有图库里挑立绘模样、底板、背景、封面候选。
// 纯本地规则，零 token：模型不必挨个试文件，先问它要一套。
import fs from 'node:fs';
import path from 'node:path';

const VARIANTS = 'assets/characters/transparent/variants';
const PLATES = 'assets/plates';
const BACKGROUNDS = 'assets/backgrounds';

// 情绪 → 模样优先级（只在角色真有这张时才选中）
const MOOD_LOOKS = {
  calm: ['v7', 'v2', 'v6', 'v3', 'v1'],
  panic: ['v3', 'v4', 'v8', 'v5', 'v1'],
  relief: ['v5', 'v9', 'v2', 'v1'],
  excited: ['v8', 'v9', 'v4', 'v5', 'v1'],
};

// 题材模板 → 底板名（没有底板就退回静态背景）
const TEMPLATE_PLATES = {
  chat: [],
  classic: ['platform', 'night'],
  report: ['report'],
  dossier: ['dossier'],
  terminal: ['terminal'],
  audit: ['audit'],
  specimen: ['specimen'],
};

const TEMPLATE_BG = {
  chat: 'ember-room.png',
  classic: 'night-sky.png',
  report: 'report-desk.png',
  dossier: 'dossier-room.png',
  terminal: 'terminal-desk.png',
  audit: 'audit-room.png',
  specimen: 'specimen-lab.png',
};

export function listLooks(root, character) {
  const dir = path.join(root, VARIANTS);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(character + '_')) continue;
    const m = name.match(/_(chibi|adult)_(v[0-9]+)\.png$/);
    if (m) out.push({ style: m[1], look: m[2], file: path.join(dir, name) });
  }
  return out;
}

export function listPlates(root) {
  const dir = path.join(root, PLATES);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => {
    const meta = path.join(dir, n, 'meta.json');
    return fs.existsSync(meta);
  });
}

export function listBackgrounds(root) {
  const dir = path.join(root, BACKGROUNDS);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.png'));
}

/**
 * @param {{root:string, character?:string, template?:string, mood?:string, style?:string}} input
 */
export function pickMaterials({ root, character = 'deepseek', template = 'chat', mood = 'calm', style = 'chibi' } = {}) {
  const looks = listLooks(root, character).filter((l) => l.style === style);
  const plates = listPlates(root);
  const backgrounds = listBackgrounds(root);
  const mk = MOOD_LOOKS[mood] || MOOD_LOOKS.calm;
  const order = (l) => {
    const i = mk.indexOf(l.look);
    return i < 0 ? 99 : i;
  };
  const ranked = looks.slice().sort((a, b) => order(a) - order(b));
  const chosen = ranked.find((l) => order(l) < 99) || null;
  const plateCandidates = (TEMPLATE_PLATES[template] || []).filter((p) => plates.includes(p));
  const plate = plateCandidates[0] || null;
  const bgFile = TEMPLATE_BG[template] || 'night-sky.png';
  const bg = backgrounds.includes(bgFile) ? bgFile : backgrounds[0] || null;

  const why = [];
  why.push(`情绪 ${mood} → 模样优先 ${mk.join('>')}`);
  why.push(chosen ? `选中 ${chosen.look}（${character} 有这张）` : `没有匹配的模样，回退 v1 原版`);
  why.push(plate ? `模板 ${template} 有动态底板 ${plate}` : `模板 ${template} 没有动态底板，退回静态背景 ${bg}`);
  if (looks.length > 1) why.push(`该角色共 ${looks.length} 套 ${style} 模样可选`);

  return {
    character,
    style,
    mood,
    template,
    look: chosen ? chosen.look : 'v1',
    lookFile: chosen ? path.relative(root, chosen.file) : null,
    plate,
    background: bg,
    alternatives: ranked.slice(0, 4).map((l) => l.look),
    reason: why,
    ready: Boolean(chosen) && (Boolean(plate) || Boolean(bg)),
  };
}

/** 封面候选：优先找已渲染的抽帧图，其次用该模板的静态底图 */
export function pickCover(root, template = 'chat', outDir = 'out/check') {
  const candidates = [];
  const dir = path.join(root, outDir);
  if (fs.existsSync(dir)) {
    for (const n of fs.readdirSync(dir)) {
      if (n.toLowerCase().endsWith('.png')) candidates.push(path.relative(root, path.join(dir, n)));
    }
  }
  const bg = TEMPLATE_BG[template] || 'night-sky.png';
  const bgPath = path.join(root, BACKGROUNDS, bg);
  if (fs.existsSync(bgPath)) candidates.push(path.relative(root, bgPath));
  return candidates;
}
