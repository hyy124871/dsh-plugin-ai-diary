// 插件设置：一处存放 API Key、发布策略、定时任务。
//
// 优先级：环境变量 > 设置文件 > 默认值。
//   环境变量沿用原来的名字（MIMO_API_KEY / DASHSCOPE_API_KEY / MINIMAX_API_KEY / GITHUB_TOKEN），
//   所以以前配好的环境变量不需要改；设置文件只是给不方便设环境变量的人一个入口。
//
// 设置文件默认落在 ~/.ai-diary/settings.json（重装插件不会丢），
// 家目录写不进去时退回 <插件根>/config/settings.json。
// 可用 AIDIARY_SETTINGS=<绝对路径> 指定别的位置。
//
// 安全边界：文件里存的是明文 key。仓库 .gitignore 已排除 config/settings.json。
// 对外展示一律走 mask()，不把完整 key 打回给模型或日志。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SECRETS = {
  mimo: 'MIMO_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  github: 'GITHUB_TOKEN',
  bili: 'BILI_COOKIE',
};

export const DEFAULTS = {
  keys: { mimo: '', dashscope: '', minimax: '', github: '', bili: '' },
  tts: { provider: 'xiaomi', voice: '' },
  comfy: { base: 'http://127.0.0.1:8188' },
  // 成片规格：逻辑布局固定 720×1280，scale 是超采样倍数 → 1.5 出 1080×1920
  // workers 是并行渲染段数，0 = 自动（核数一半，最多 4 段）
  render: { scale: 1.5, fps: 24, workers: 0 },
  // 自动更新：启动静默查新；autoInstall=true 查询到就自己装（装完要重启 Harness）
  update: { autoCheck: true, autoInstall: true },
  publish: { mode: 'client', dryRun: true, autoFill: false, autoSubmit: false, statement: '自制' },
  comments: {
    // api=走评论接口；gui=截图点按钮；hybrid=接口优先，接口挂了才点按钮
    mode: 'hybrid',
    rules: [],
    fallback: '',
    maxPerRun: 3,
    intervalMinutes: 5,
    // 平台约 30 秒只能发 1 条，不要调低这条线
    apiGapMs: 30_000,
    // 一轮最多扫几个稿件
    apiVideos: 3,
    // 只回最近 N 小时内冒出来的评论；0 = 不限（默认 72 小时，别把几个月前的旧评论翻出来互动）
    recentHours: 72,
    guiFallback: true,
    replied: [],
    watch: null,
  },
  schedule: {
    enabled: false,
    dailyAt: '20:30',
    count: 1,
    look: '',
    plate: '',
    template: '',
    make: true,
    voice: true,
    publish: true,
    comments: false,
    lastRun: null,
    lastResult: null,
    runs: [],
  },
};

function isPlain(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? merge(out[k], v) : v;
  }
  return out;
}

export function settingsPath(root) {
  if (process.env.AIDIARY_SETTINGS) return path.resolve(process.env.AIDIARY_SETTINGS);
  try {
    const home = path.join(os.homedir(), '.ai-diary');
    fs.mkdirSync(home, { recursive: true });
    return path.join(home, 'settings.json');
  } catch {
    return path.join(root, 'config', 'settings.json');
  }
}

export function loadSettings(root) {
  const file = settingsPath(root);
  let raw = {};
  try {
    if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    raw = {};
  }
  const s = merge(DEFAULTS, raw);
  s.__file = file;
  return s;
}

export function saveSettings(root, patch) {
  const file = settingsPath(root);
  const before = (() => {
    try {
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    } catch {
      return {};
    }
  })();
  const next = merge(merge(DEFAULTS, before), patch);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return { ...next, __file: file };
}

/** 把文件里的 key 灌进环境变量（已有的环境变量优先，绝不覆盖） */
export function applyEnv(settings) {
  const applied = [];
  for (const [field, envName] of Object.entries(SECRETS)) {
    const v = String((settings.keys && settings.keys[field]) || '').trim();
    if (v && !process.env[envName]) {
      process.env[envName] = v;
      applied.push(envName);
    }
  }
  return applied;
}

export function mask(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 8) return '■'.repeat(s.length);
  return s.slice(0, 4) + '■'.repeat(Math.min(12, s.length - 8)) + s.slice(-4);
}

/** 给模型/日志看的视图：key 打码，只报告是否可用、来自环境还是文件 */
export function publicView(settings) {
  const keys = {};
  for (const [field, envName] of Object.entries(SECRETS)) {
    const env = process.env[envName] || '';
    const file = String((settings.keys && settings.keys[field]) || '');
    const value = env || file;
    keys[field] = {
      env: envName,
      ready: Boolean(value),
      source: env ? 'env' : file ? 'file' : 'none',
      preview: mask(value),
    };
  }
  return {
    file: settings.__file,
    keys,
    tts: settings.tts,
    comfy: settings.comfy,
    publish: settings.publish,
    comments: {
      mode: settings.comments.mode,
      apiGapMs: settings.comments.apiGapMs,
      apiVideos: settings.comments.apiVideos,
      recentHours: settings.comments.recentHours,
      guiFallback: settings.comments.guiFallback,
      maxPerRun: settings.comments.maxPerRun,
      repliedCount: (settings.comments.replied || []).length,
    },
    schedule: { ...settings.schedule, runs: (settings.schedule.runs || []).slice(-7) },
  };
}
