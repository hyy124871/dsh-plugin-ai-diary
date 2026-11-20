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
  deepseek: 'DEEPSEEK_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  ark: 'ARK_API_KEY',
  github: 'GITHUB_TOKEN',
  bili: 'BILI_COOKIE',
};

export const DEFAULTS = {
  // 总开关：默认关闭。关着时定时出片、定时发布、自动回评论都不跑，只在面板里手动点才动
  enabled: false,
  keys: { mimo: '', dashscope: '', deepseek: '', minimax: '', ark: '', github: '', bili: '' },
  tts: { provider: 'xiaomi', model: '', voice: '' },
  comfy: { base: 'http://127.0.0.1:8188' },
  // 成片规格：orientation=landscape 出 16:9（逻辑 1280×720，1.5× 超采样 → 1920×1080）；
  // portrait 回竖屏 9:16（逻辑 720×1280 → 1080×1920）
  // workers 是并行渲染段数，0 = 自动（核数一半，最多 4 段）
  // accelerator：cpu=libx264（画质最好）| gpu=硬件编码（NVENC/QSV/AMF，快数倍）| auto=有硬件就用
  render: { orientation: 'landscape', scale: 1.5, fps: 24, workers: 0, accelerator: 'auto' },
  // 图片模型：Seedream（火山方舟）。5.5 是 2026-10 新发布的一代，原生 RGBA、百轮编辑
  image: { model: 'seedream-5.5', size: '2K' },
  // H3 默认档位：日常出片用 Highspeed，追求画质手动切 H3 + 2K
  video: { model: 'MiniMax-H3-Highspeed', resolution: '768P' },
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
    // 定时发布：到点把「成片库」里 ready 的最新一集发出去；空 = 不单独定时发布
    publishAt: '',
    count: 1,
    look: '',
    plate: '',
    template: '',
    make: true,
    voice: true,
    publish: true,
    comments: false,
    lastRun: null,
    lastPublishRun: null,
    lastResult: null,
    runs: [],
  },
  // 工作室：自主选材 + 文本模型
  studio: {
    // 不套 data/topics.json 的固定题材，改读评论区自己选题
    freePlan: true,
    // 选材时刷新一次 B 站评论（需要 Cookie）
    refreshComments: true,
    // 出片成功后自动进成片库（关掉就只能手工登记）
    autoRegister: true,
  },
  // 写台词用的文本模型：dashscope（千问）/ ark（豆包）/ off（只用本地拼装）
  // economy=true：只有「写台词」这一步调模型，同一批评论当天只问一次；抓评论、回评论、发布都不花 token
  text: { provider: 'dashscope', model: 'qwen-plus', economy: true },
  // B 站登录态：扫码成功或手动验证后记一条，面板据此显示昵称/剩余天数/到期预警。
  // expiresAt 是「最后一次验证成功 + 180 天」的估算（SESSDATA 服务端有效期网页端约半年），
  // 每次保活成功都会顺延，等于把会话一直续着。
  biliSession: { ok: false, uname: '', mid: 0, lastOkAt: null, expiresAt: null, checkedAt: null, failReason: '' },
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
    // AIDIARY_HOME 让测试/多实例指到自己的目录，别再写进真实家目录
    const home = path.resolve(process.env.AIDIARY_HOME || path.join(os.homedir(), '.ai-diary'));
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
  // 0.9.5 起默认生图换成 Seedream 5.5：老配置里写死 4.0 的直接顶上去（4.0 方舟已标注即将下线）
  if (s.image && s.image.model === 'seedream-4.0') {
    s.image.model = 'seedream-5.5';
    try {
      saveSettings(root, { image: { model: 'seedream-5.5' } });
    } catch {
      /* 写不进去就只在内存里升级 */
    }
  }
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

/**
 * 更新前给设置文件拍一张快照：key、模型、音色、定时全在里面。
 * 落成 settings.<tag>.backup.json，不动原文件。
 */
export function backupSettings(root, tag = 'update') {
  const file = settingsPath(root);
  try {
    if (!fs.existsSync(file)) return null;
    const out = path.join(path.dirname(file), `settings.${tag}.backup.json`);
    fs.copyFileSync(file, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * 更新后自愈：当前设置里 key（或模型、音色）被清空了，就从最近的备份回填。
 * 返回真正补回来的字段，方便面板/日志显示「已从备份恢复 3 个 key」。
 */
export function healSettings(root, bakFile) {
  const file = settingsPath(root);
  const read = (p) => {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch {
      return {};
    }
  };
  const bak = read(bakFile || path.join(path.dirname(file), 'settings.update.backup.json'));
  const cur = read(file);
  if (!bak || !Object.keys(bak).length) return { healed: [], keys: 0 };

  const patch = {};
  const healed = [];
  const curKeys = { ...(cur.keys || {}) };
  const bakKeys = bak.keys || {};
  let n = 0;
  for (const [field, v] of Object.entries(bakKeys)) {
    const want = String(v || '').trim();
    if (want && !String(curKeys[field] || '').trim()) {
      curKeys[field] = want;
      n += 1;
      healed.push('keys.' + field);
    }
  }
  if (n) patch.keys = curKeys;

  // 模型/音色也一起兜：被重置成默认时回填用户选过的
  for (const sec of ['tts', 'image', 'video']) {
    const b = isPlain(bak[sec]) ? bak[sec] : null;
    const c = isPlain(cur[sec]) ? cur[sec] : {};
    if (!b) continue;
    const secPatch = {};
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined || v === '') continue;
      if (!c[k]) {
        secPatch[k] = v;
        healed.push(sec + '.' + k);
      }
    }
    if (Object.keys(secPatch).length) patch[sec] = merge(c, secPatch);
  }

  if (!Object.keys(patch).length) return { healed: [], keys: 0 };
  saveSettings(root, patch);
  return { healed, keys: n };
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
    enabled: Boolean(settings.enabled),
    file: settings.__file,
    keys,
    tts: settings.tts,
    comfy: settings.comfy,
    render: settings.render,
    image: settings.image,
    video: settings.video,
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
    studio: settings.studio,
    text: settings.text,
  };
}
