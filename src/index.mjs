// dsh-plugin-ai-diary —— DeepSeek Harness 插件（Cordis）。
//
// 契约（对齐本机 dsh 运行时与 dsh-filmforge 的写法）：
//   - export name / inject / apply(ctx)
//   - 工具用 defineTool({ name, description, parameters, output: {schema, render}, execute }) 定义
//   - ctx.effect(() => ctx.tools.register(tool), label) 注册，卸载时自动反注册
//   - 工具返回值统一 { summary, details }，details 是 JSON 字符串
//   - 有 skills 服务时顺带注册内嵌技能 ai-diary，让模型知道怎么串这 5 个工具

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPcTools } from './pc-tools.mjs';
import { warmup as pcWarmup } from './pc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const name = 'dsh-plugin-ai-diary';
export const inject = ['tools'];

// 真实运行时从 @deepseek-ai/dsh-tools 取 defineTool；脱离 dsh 单独跑测试时退化为恒等函数
// （此时工具定义仍然是一个普通对象，可直接被 mock ctx 调用，方便单元测试）。
const require = createRequire(import.meta.url);
let defineTool;
try {
  ({ defineTool } = require('@deepseek-ai/dsh-tools'));
} catch {
  defineTool = (def) => def;
}

const SKILL_FILE = new URL('../skills/ai-diary/SKILL.md', import.meta.url);

// 官方设置面板：Harness 用 cordis 的插件 schema 生成配置表单。
// schemastery 只在实际运行时才有；脱离 dsh 跑单测时拿不到就退化为「无 schema」，
// 不影响任何工具注册，也绝不让插件加载失败。
let Schema = null;
try {
  const m = await import('@deepseek-ai/schemastery');
  Schema = m.default || m;
} catch {
  Schema = null;
}

export const Config = Schema
  ? Schema.object({
    keys: Schema.object({
      mimo: Schema.string().description('小米 MiMo TTS 的 key（对应 MIMO_API_KEY）'),
      dashscope: Schema.string().description('千问 Qwen-TTS 的 key（对应 DASHSCOPE_API_KEY）'),
      minimax: Schema.string().description('MiniMax TTS / H3 视频的 key（对应 MINIMAX_API_KEY）'),
      github: Schema.string().description('GitHub token，仅私有仓库查新/发布用（对应 GITHUB_TOKEN）'),
    }).description('API Key（留空则继续用环境变量）'),
    tts: Schema.object({
      provider: Schema.string().description('默认配音服务商：xiaomi / qwen / minimax'),
      voice: Schema.string().description('默认音色名，留空用服务商默认音色'),
    }).description('配音默认项'),
    comfy: Schema.object({
      base: Schema.string().description('本机 ComfyUI 地址，默认 http://127.0.0.1:8188'),
    }).description('本地模型'),
    publish: Schema.object({
      dryRun: Schema.boolean().description('预演：只准备文案与客户端，不真的投稿'),
      autoFill: Schema.boolean().description('把视频与文案填进投稿页，但仍不代点「立即投稿」'),
      statement: Schema.string().description('创作声明，默认「自制」'),
    }).description('发布策略'),
    schedule: Schema.object({
      enabled: Schema.boolean().description('打开定时自动出片'),
      dailyAt: Schema.string().description('每天几点跑，24 小时制 HH:MM，例如 20:30'),
      make: Schema.boolean().description('自动出片'),
      voice: Schema.boolean().description('自动配音（对应服务商 key 就绪才生效）'),
      publish: Schema.boolean().description('自动交给客户端投稿'),
      comments: Schema.boolean().description('顺带打开评论管理页'),
      look: Schema.string().description('指定立绘档位，如 v13；留空用剧本默认'),
    }).description('定时任务'),
  })
  : undefined;

/** 统一输出：summary 给人看，details 给模型看 */
function out(summary, details = {}) {
  return { summary, details: JSON.stringify(details) };
}

function outputDef() {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string', required: true },
        details: { type: 'string', required: true },
      },
    },
    render(_args, value) {
      return [{ type: 'text', text: String(value.summary) + '\n' + String(value.details) }];
    },
  };
}

function resolvePath(p, exec, fallback) {
  const base = (exec && typeof exec.cwd === 'string' && exec.cwd) || ROOT;
  const raw = String(p || fallback || '').trim();
  return path.isAbsolute(raw) ? raw : path.resolve(base, raw);
}

const rel = (p) => {
  const r = path.relative(ROOT, p);
  return r.startsWith('..') ? p : r;
};

/* ---------------- 素材自检（也导出给 CLI 用） ---------------- */

export function auditAssets({ character, style } = {}) {
  const A = path.join(ROOT, 'assets');
  const characters = ['deepseek', 'gpt', 'gemini', 'claude', 'grok', 'glm', 'qwen', 'kimi'];
  const styles = ['chibi', 'adult'];
  const picked = characters.filter((c) => !character || c === character);
  const pickedStyles = styles.filter((s) => !style || s === style);
  const need = [];
    const have = [];
  for (const c of picked) {
    for (const s of pickedStyles) {
      for (const dir of ['characters', path.join('characters', 'transparent')]) {
        const f = path.join(A, dir, `${c}_${s}.png`);
        (fs.existsSync(f) ? have : need).push({
          character: c,
          style: s,
          kind: dir.includes('transparent') ? 'transparent' : 'raw',
          file: f,
        });
      }
    }
  }
  const backgrounds = ['night-sky.png', 'warm-card.png', 'rain-night.png', 'dusk-room.png', 'sakura-night.png', 'blank-card.png', 'report-desk.png', 'dossier-room.png', 'terminal-desk.png', 'audit-room.png', 'specimen-lab.png', 'train-platform.png'];
  for (const b of backgrounds) {
    const f = path.join(A, 'backgrounds', b);
    if (fs.existsSync(f)) have.push({ kind: 'background', file: f });
    else need.push({ kind: 'background', file: f });
  }
  const promptFor = (item) => item.kind === 'background'
    ? `9:16 竖屏背景插画，主题「${item.file.replace('.png', '')}」，深色氛围，留出中下部人物站位空间，四角压暗，画面内不要任何文字与人物，纯背景。`
    : `${item.character} 的 ${item.style === 'chibi' ? 'Q 版二头身' : '八头身成人'}立绘，纯白 #FFFFFF 背景，不要圆角卡片/边框/投影，全身居中站立，四周边距均匀，输出 3:4；用于抠白底后合成到短剧画面。`;
  return {
    ready: need.length === 0,
    missing: need.map((n) => ({ ...n, file: rel(n.file), prompt: promptFor(n) })),
    haveCount: have.length,
  };
}

/* ---------------- 工具定义 ---------------- */

function topicsTool() {
  return defineTool({
    name: 'ai_diary_topics',
    description:
      '从内置题材库给 AI 角色日记短剧选题（默认避开做过的题材）。返回题材 id、标题、角色、Day、余额、镜数；这些题材是原创文案，可直接进入 ai_diary_plan。选题完全本地完成，不消耗 token。',
    parameters: {
      count: { type: 'number', description: '要选几个，默认 3，最多 8' },
      character: { type: 'string', description: '限定主角：deepseek/gpt/gemini/claude/grok/glm/qwen/kimi' },
      fresh: { type: 'boolean', description: '是否避开历史做过的题材，默认 true' },
      seed: { type: 'number', description: '随机种子，便于复现同一批选题' },
    },
    output: outputDef(),
    async execute(args) {
      const { pickTopics, listTopics } = await import('./topics.mjs');
      const count = Math.max(1, Math.min(8, Number(args.count || 3)));
      const picked = pickTopics({ count, character: args.character, fresh: args.fresh !== false, seed: args.seed });
      if (picked.length === 0) return out('题材库里已经没有新题材了：把 fresh 设成 false 可以重做旧题材，或用 character 换主角做变体。', { ok: false });
      return out(
        `选了 ${picked.length} 个新题材：` + picked.map((t) => t.title).join(' / '),
        {
          ok: true,
          topics: picked.map((t) => ({ id: t.id, title: t.title, character: t.character, day: t.day, balance: t.balance, shots: t.beats.length, tags: t.tags })),
          library: listTopics().length,
        },
      );
    },
  });
}

function planTool() {
  return defineTool({
    name: 'ai_diary_plan',
    description:
      '把题材编译成可渲染的剧本 JSON：算好每镜时长、分镜时间点、片长，写入 out/。不传 topic_id 会自动挑一个新题材；传 character 可以把同一骨架换主角做「某某篇」连播。剧本编译在本地完成，不消耗 token。',
    parameters: {
      topic_id: { type: 'string', description: '题材 id（ai_diary_topics 返回的 id）；省略则自动选新题材' },
      character: { type: 'string', description: '换主角，生成该角色的变体篇' },
      template: { type: 'string', enum: ['classic', 'report', 'dossier', 'terminal', 'audit', 'specimen'], description: '版面模板：classic=星夜日记（原版），report=评测报告（米色网格卡+章节标签+REC HUD），dossier=机密档案（牛皮纸卷宗+红色機密章），terminal=数据终端（冷青 CRT 扫描线），audit=听证记录（墨绿硬卡+条文记录+已覆核章），specimen=标本观察（冷白观察板+刻度尺+情绪指数条）' },
      out: { type: 'string', description: '剧本输出路径，默认 out/<id>.json；相对路径按会话工作目录解析' },
      width: { type: 'number', description: '输出宽，默认 720' },
      height: { type: 'number', description: '输出高，默认 1280' },
      fps: { type: 'number', description: '帧率，默认 24' },
    },
    output: outputDef(),
    async execute(args, exec) {
      const { loadTopics, pickTopics, variantOf } = await import('./topics.mjs');
      const { buildScript, writeScript, summary } = await import('./script.mjs');
      let topic;
      if (args.topic_id) {
        topic = loadTopics().find((t) => t.id === args.topic_id);
        if (!topic) throw new Error(`没有这个题材：${args.topic_id}（先调 ai_diary_topics 看看有哪些）`);
      } else {
        topic = pickTopics({ count: 1, character: args.character })[0];
        if (!topic) throw new Error('题材库为空');
      }
      if (args.character && args.character !== topic.character) topic = variantOf(topic, { character: args.character });
      const scale = {};
      if (args.width) scale.width = Number(args.width);
      if (args.height) scale.height = Number(args.height);
      if (args.fps) scale.fps = Number(args.fps);
      const script = buildScript(topic, {
        output: Object.keys(scale).length ? scale : undefined,
        template: args.template,
      });
      const file = writeScript(script, resolvePath(args.out, exec, path.join('out', `${script.id}.json`)));
      const s = summary(script);
      return out(
        `《${script.title}》 ${s.shots} 镜 / ${s.chars} 字 / 片长 ${s.seconds}s → ${rel(file)}`,
        { ok: true, script: rel(file), ...s },
      );
    },
  });
}

function renderTool() {
  return defineTool({
    name: 'ai_diary_render',
    description:
      '用本地渲染引擎把剧本 JSON 渲染成 9:16 竖屏 MP4（背景推移、立绘呼吸浮动、余额 HUD 递减、逐字字幕、星点、情绪光、片头片尾卡，libx264 编码）。纯确定性绘制，不调用视频生成模型，也不消耗生成额度；同一份剧本每次结果一致。传 png:true 改为导出 PNG 帧序列；传 preview_seconds 只渲前面几秒，用来快速看构图。',
    parameters: {
      script: { type: 'string', required: true, description: '剧本 JSON 路径（ai_diary_plan 的产物）' },
      out: { type: 'string', description: '输出 mp4 路径，默认 out/<id>.mp4' },
      png: { type: 'boolean', description: '改为导出 PNG 帧序列' },
      preview_seconds: { type: 'number', description: '只渲染前 N 秒（快速预览构图，默认整片）' },
      template: { type: 'string', enum: ['classic', 'report', 'dossier', 'terminal', 'audit', 'specimen'], description: '覆盖剧本里的版面模板' },
      look: { type: 'string', description: '立绘模样：v1=原版，v2=居家套装，v3=外出套装，v4/v5=动作姿势，v6=水手服通勤，v7=冬日居家，v8=运动，v9=夏日祭（deepseek 独有）；也可传 variants 目录里任意后缀，缺图自动回退原版' },
      voice: { type: 'string', description: '顺手配音并混流：传音色名（如 冰糖 / Cherry / female-shaonv）或 design；provider 省略走 config/voice.json' },
      provider: { type: 'string', enum: ['xiaomi', 'qwen', 'minimax'], description: '配音服务商：xiaomi=小米 MiMo，qwen=千问 Qwen-TTS，minimax=MiniMax T2A' },
      width: { type: 'number', description: '覆盖宽度' },
      height: { type: 'number', description: '覆盖高度' },
      fps: { type: 'number', description: '覆盖帧率' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!args || !args.script) throw new Error('缺少 script 参数：先 ai_diary_plan，再把返回的 script 路径传进来');
      const { loadScript, summary } = await import('./script.mjs');
      const { renderEpisode } = await import('./engine.mjs');
      const scriptPath = resolvePath(args.script, exec);
      const script = loadScript(scriptPath);
      if (args.look && String(args.look) !== 'v1') script.episode.look = String(args.look);
      const outFile = resolvePath(args.out, exec, path.join('out', `${script.id}.mp4`));
      const pngDir = args.png ? resolvePath(null, exec, path.join('out', `${script.id}-frames`)) : null;
      const t0 = Date.now();
      const res = await renderEpisode(script, {
        out: outFile,
        pngDir,
        width: args.width ? Number(args.width) : undefined,
        height: args.height ? Number(args.height) : undefined,
        fps: args.fps ? Number(args.fps) : undefined,
        maxSeconds: args.preview_seconds ? Number(args.preview_seconds) : undefined,
        template: args.template,
      });
      const cost = ((Date.now() - t0) / 1000).toFixed(1);
      let voiceLine = '';
      if (args.voice && !args.png) {
        const { buildVoiceTrack, muxVoice, loadVoiceConfig } = await import('./voice.mjs');
        const { findFfmpeg } = await import('./engine.mjs');
        const ffmpeg = findFfmpeg();
        const cfg = { ...loadVoiceConfig(ROOT), ...(args.voice === 'design' ? { mode: 'design' } : { voice: String(args.voice) }), ...(args.provider ? { provider: args.provider } : {}) };
        const track = await buildVoiceTrack(script, { root: ROOT, ffmpeg, cfg });
        const voiced = outFile.replace(/\.mp4$/i, '-voice.mp4');
        await muxVoice(res.file, track.track, voiced, ffmpeg);
        voiceLine = `，配音 ${track.total}s → ${rel(voiced)}`;
        res.voiced = rel(voiced);
      }
      return out(
        args.png
          ? `导出 ${res.frames} 帧 PNG（${res.width}×${res.height} @ ${res.fps}fps，${cost}s）`
          : `渲染完成 ${res.seconds}s / ${res.frames} 帧 → ${rel(res.file)}（${cost}s）${voiceLine}`,
        { ok: true, ...res, file: res.file ? rel(res.file) : null, frames: args.png ? rel(pngDir) : undefined, spec: summary(script) },
      );
    },
  });
}

function assetsTool() {
  return defineTool({
    name: 'ai_diary_assets',
    description:
      '检查 assets 里的立绘（含透明底）与背景是否齐全；缺哪些文件、该用什么提示词去补图，都直接返回。补图后再渲染，缺图时引擎会退化为纯渐变色，不会报错。',
    parameters: {
      character: { type: 'string', description: '只查某个角色' },
      style: { type: 'string', description: 'chibi 或 adult' },
    },
    output: outputDef(),
    isConcurrencySafe: () => true,
    async execute(args) {
      const a = auditAssets(args || {});
      return out(
        a.ready ? `素材齐全（${a.haveCount} 个文件）` : `缺 ${a.missing.length} 个素材，已附补图提示词`,
        a.ready ? { ok: true, haveCount: a.haveCount } : a,
      );
    },
  });
}

function voiceTool() {
  return defineTool({
    name: 'ai_diary_voice',
    description:
      '给已生成的剧本配音，三家服务商同一套流程：xiaomi=小米 MiMo（POST api.xiaomimimo.com/v1/chat/completions，头 api-key，文本放 role=assistant）；qwen=千问 Qwen-TTS（DashScope 多模态端点，model qwen3-tts-flash，文本≤600 字）；minimax=MiniMax T2A（POST api.minimax.cn/v1/t2a_v2，data.audio 是 hex）。逐镜合成后按镜头时长对齐（长 atempo 压缩、短补静音），拼整轨并可混进成片。key 读 MIMO_API_KEY / DASHSCOPE_API_KEY / MINIMAX_API_KEY，check_only:true 只验配置不耗额度。',
    parameters: {
      script: { type: 'string', description: '剧本 JSON 路径' },
      provider: { type: 'string', enum: ['xiaomi', 'qwen', 'minimax'], description: '配音服务商，省略读 config/voice.json' },
      mode: { type: 'string', enum: ['preset', 'design'], description: 'preset=预置音色（默认），design=小米按角色音色描述造声线' },
      voice: { type: 'string', description: '音色名：小米 冰糖/茉莉/苏打/白桦；千问 Cherry/Serena/Ethan/Chelsie；MiniMax female-shaonv/male-qn-qingse/presenter_male' },
      mux: { type: 'string', description: '把音轨混进这个 mp4（传渲染好的成片路径）；省略只出 wav 音轨' },
      out: { type: 'string', description: '混流后的输出路径，默认 out/<id>-voice.mp4' },
      check_only: { type: 'boolean', description: '只检查 key/配置是否就绪，不合成' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { buildVoiceTrack, muxVoice, loadVoiceConfig, checkConfig, PRESET_VOICES } = await import('./voice.mjs');
      const { findFfmpeg } = await import('./engine.mjs');
      const cfg = { ...loadVoiceConfig(ROOT), ...(args.provider ? { provider: args.provider } : {}) };
      if (args.check_only || !args.script) {
        const c = await checkConfig(cfg);
        const line = c.rows.map(r => `${r.provider}:${r.ready ? 'ok' : '缺 ' + r.keyEnv}`).join(' · ');
        return out(`当前 ${c.active}（${c.mode}）· ${line}${c.hint ? ' · ' + c.hint : ''}`, { ok: c.ok, ...c });
      }
      const { loadScript } = await import('./script.mjs');
      const script = loadScript(resolvePath(args.script, exec));
      const ffmpeg = findFfmpeg();
      const merged = { ...cfg, ...(args.mode ? { mode: args.mode } : {}), ...(args.voice ? { voice: args.voice } : {}) };
      const track = await buildVoiceTrack(script, { root: ROOT, ffmpeg, cfg: merged });
      let voiced = null;
      if (args.mux) {
        voiced = resolvePath(args.out, exec, path.join('out', `${script.id}-voice.mp4`));
        await muxVoice(resolvePath(args.mux, exec), track.track, voiced, ffmpeg);
      }
      return out(
        voiced ? `配音完成 ${track.total}s，已混流 → ${rel(voiced)}` : `音轨 ${track.total}s → ${rel(track.track)}`,
        { ok: true, total: track.total, track: rel(track.track), shots: track.pieces, voiced: voiced ? rel(voiced) : null },
      );
    },
  });
}

function hailuoTool() {
  return defineTool({
    name: 'ai_diary_hailuo',
    description:
      '用 MiniMax H3 生成动态底板视频（异步三步：POST api.minimax.cn/v2/video_generation 得 task_id → GET /v2/query/video_generation/{task_id} 轮询 → 下载 task.content.url）。支持纯文生视频、首帧/尾帧图生视频、多模态参考；H3 输出 768P/2K、4–15 秒整数，图生视频 ratio 恒 adaptive，纯文生视频需给 ratio。需要 MINIMAX_API_KEY。dry_run 默认 true：只返回将要提交的 body 并校验参数，不发请求（这条会真实计费，别默认扣）。status 传 task_id 可查一次进度。',
    parameters: {
      prompt: { type: 'string', description: '视频提示词（≤7000 字），可用 [运镜] 标注镜头调度' },
      first_frame: { type: 'string', description: '首帧图路径或公网 URL（省略则纯文生视频）' },
      last_frame: { type: 'string', description: '尾帧图路径或公网 URL' },
      duration: { type: 'number', description: '时长整秒：H3 4–15，H3-Max 5–15，默认 8' },
      resolution: { type: 'string', enum: ['480P', '768P', '2K'], description: 'H3 支持 768P/2K，H3-Max 支持 480P/768P' },
      model: { type: 'string', enum: ['MiniMax-H3', 'MiniMax-H3-Max'], description: '默认 MiniMax-H3' },
      ratio: { type: 'string', description: '纯文生视频的宽高比，如 9:16（图生视频会被强制 adaptive）' },
      out: { type: 'string', description: '成片保存路径，默认 out/h3-<task_id>.mp4' },
      status: { type: 'string', description: '只查询这个 task_id 的进度，不创建新任务' },
      dry_run: { type: 'boolean', description: '默认 true：只校验参数并打印 body' },
    },
    output: outputDef(),
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const h = await import('./hailuo.mjs');
      if (args.status) {
        const t = await h.queryTask(String(args.status));
        return out(`任务 ${args.status}：${t.status}${t.url ? ' → ' + t.url : ''}`, { ok: t.status === 'succeeded', ...t });
      }
      if (!args.prompt) throw new Error('缺少 prompt');
      const body = h.buildPayload({
        prompt: String(args.prompt),
        firstFrameUrl: args.first_frame ? h.toDataUri(resolvePath(args.first_frame, exec)) : undefined,
        lastFrameUrl: args.last_frame ? h.toDataUri(resolvePath(args.last_frame, exec)) : undefined,
        duration: args.duration ? Number(args.duration) : 8,
        resolution: args.resolution || '768P',
        model: args.model || 'MiniMax-H3',
        ratio: args.ratio,
      });
      if (args.dry_run !== false || !h.resolveKey()) {
        const shown = { ...body, content: body.content.map(c => (c.image_url ? { ...c, image_url: { url: String(c.image_url.url).slice(0, 50) + '…' } } : c)) };
        return out(`未发送（dry_run）：${body.model} ${body.duration}s ${body.resolution} ratio=${body.ratio}`, {
          ok: true, dryRun: true, body: shown,
          hint: h.resolveKey() ? '' : '缺 MINIMAX_API_KEY，设好环境变量再传 dry_run:false',
        });
      }
      const { taskId } = await h.createTask(body);
      const t = await h.waitTask(taskId);
      const outFile = resolvePath(args.out, exec, path.join('out', `h3-${taskId}.mp4`));
      const d = await h.download(t.url, outFile);
      return out(`H3 成片 ${(d.bytes / 1024 / 1024).toFixed(1)}MB → ${rel(d.file)}`, { ok: true, taskId, file: rel(d.file), bytes: d.bytes });
    },
  });
}

function publishTool() {
  return defineTool({
    name: 'ai_diary_publish',
    description:
      '发布到 B 站。默认走本机「哔哩哔哩客户端」（不用浏览器）：定位客户端 → 把标题/简介/标签写进剪贴板并落一份 .upload.txt → 带着视频启动客户端，剩下在客户端里选视频、粘贴文案后自己点「投稿」。mode:"browser" 才走 Chrome 自动填创作中心。默认 dry_run:true，任何模式都不会替用户点发布。',
    parameters: {
      video: { type: 'string', required: true, description: '要发布的 mp4 路径' },
      mode: { type: 'string', enum: ['client', 'browser'], description: 'client=用本机哔哩哔哩客户端（默认，不用浏览器）；browser=用 Chrome 自动填创作中心' },
      title: { type: 'string', description: '稿件标题（≤80 字），省略则按剧本自动生成' },
      desc: { type: 'string', description: '简介，支持换行，省略则按剧本自动生成' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签，最多 10 个' },
      dry_run: { type: 'boolean', description: '只填表不点投稿，默认 true' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!args || !args.video) throw new Error('缺少 video 参数：先 ai_diary_render 出片，再把路径传进来');
      const { publish } = await import('./publish.mjs');
      const { loadScript, publishMeta } = await import('./script.mjs');
      const videoPath = resolvePath(args.video, exec);
      let meta = { title: args.title, desc: args.desc, tags: args.tags || [] };
      const guessJson = videoPath.replace(/\.mp4$/i, '.json');
      if ((!meta.title || !meta.desc || meta.tags.length === 0) && fs.existsSync(guessJson)) {
        const auto = publishMeta(loadScript(guessJson));
        meta = { title: meta.title || auto.title, desc: meta.desc || auto.desc, tags: meta.tags.length ? meta.tags : auto.tags };
      }
      const res = await publish({
        mode: args.mode === 'browser' ? 'browser' : 'client',
        video: videoPath,
        title: meta.title,
        desc: meta.desc,
        tags: meta.tags,
        dryRun: args.dry_run !== false,
      });
      return out(res.message, res);
    },
  });
}

/* ---------------- 素材选取 / 真投稿 / 评论 ---------------- */

function pickTool() {
  return defineTool({
    name: 'ai_diary_pick',
    description:
      '素材选配：按角色 + 情绪 + 模板，从现有图库里挑立绘模样（look）、动态底板（plate）、静态背景、封面候选，并说明为什么这么挑。纯规则本地跑，零 token；出片前先问它，别挨个试文件名。',
    parameters: {
      character: { type: 'string', description: '角色 id，默认 deepseek' },
      mood: { type: 'string', enum: ['calm', 'panic', 'relief', 'excited'], description: '情绪，默认 calm' },
      template: { type: 'string', description: '模板 id：classic/report/dossier/terminal/audit/specimen' },
      style: { type: 'string', enum: ['chibi', 'adult'], description: '立绘风格，默认 chibi' },
      cover: { type: 'boolean', description: '是否一起给封面候选，默认 true' },
    },
    output: outputDef(),
    isConcurrencySafe: () => true,
    async execute(args) {
      const p = await import('./pick.mjs');
      const chosen = p.pickMaterials({ root: ROOT, character: args.character || 'deepseek', template: args.template || 'classic', mood: args.mood || 'calm', style: args.style || 'chibi' });
      const covers = args.cover === false ? [] : p.pickCover(ROOT, args.template || 'classic');
      return out(
        `${chosen.character} → look ${chosen.look}｜底板 ${chosen.plate || '无（用静态 ' + chosen.background + '）'}`,
        { ok: true, ...chosen, covers: covers.slice(0, 5) },
      );
    },
  });
}

function postTool() {
  return defineTool({
    name: 'ai_diary_post',
    description:
      '真·自主投稿：直接驱动本机哔哩哔哩客户端（Electron，不用浏览器）走创作中心投稿页 —— 点投稿入口 → 打开稿件页 → 文件对话框里粘贴视频路径 → 等上传完成 → 填标题/创作声明/标签/封面/简介 → 停在「立即投稿」前并截图。confirm=true 才真的点投稿（对外不可逆，默认 false）。坐标锚点在 config/bili.json，换分辨率只改配置。',
    parameters: {
      video: { type: 'string', required: true, description: '要投稿的 mp4 绝对/相对路径' },
      title: { type: 'string', description: '标题，≤80 字；省略则按同名 json 剧本自动生成' },
      desc: { type: 'string', description: '简介' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签，最多 10 个' },
      cover: { type: 'string', description: '封面图路径；省略=点页面上第一个推荐封面' },
      statement: { type: 'string', description: '创作声明选项文字，默认“自制”' },
      confirm: { type: 'boolean', description: '默认 false，不点「立即投稿」' },
      skip_open: { type: 'boolean', description: 'true=稿件页已开，直接上传' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!args.video) throw new Error('缺少 video 参数');
      const b = await import('./bili.mjs');
      const cfg = b.loadBiliConfig(ROOT);
      const videoPath = resolvePath(args.video, exec);
      if (!fs.existsSync(videoPath)) throw new Error('找不到视频：' + videoPath);

      let meta = { title: args.title, desc: args.desc, tags: args.tags || [] };
      const guessJson = videoPath.replace(/\.mp4$/i, '.json');
      if ((!meta.title || !meta.desc || !meta.tags.length) && fs.existsSync(guessJson)) {
        const { loadScript, publishMeta } = await import('./script.mjs');
        const auto = publishMeta(loadScript(guessJson));
        meta = { title: meta.title || auto.title, desc: meta.desc || auto.desc, tags: meta.tags.length ? meta.tags : auto.tags };
      }
      if (!meta.title) meta.title = path.basename(videoPath, '.mp4').slice(0, 80);
      if (!meta.desc) meta.desc = meta.title;
      if (!meta.tags.length) meta.tags = ['AI日记', 'AI角色', '虚拟主播'];

      const steps = [];
      const launched = await b.ensureClient(cfg);
      steps.push(launched.launched ? '已启动客户端' : '客户端已在运行');
      if (!args.skip_open) {
        const o = await b.openCreator(cfg);
        steps.push(o.opened ? '已打开创作中心投稿页' : '创作中心窗口已存在，直接复用');
      }
      const up = await b.uploadVideo(cfg, videoPath, cfg.client.creatorWindow);
      steps.push(`已选视频 ${up.sizeMb}MB，等待 ${Math.round(up.waitMs / 1000)}s 上传`);

      const filled = await b.fillForm(cfg, cfg.client.creatorWindow, {
        title: meta.title,
        statement: args.statement || '自制',
        tags: meta.tags,
        coverPath: args.cover ? resolvePath(args.cover, exec) : undefined,
        desc: meta.desc,
      });
      steps.push('已填标题/创作声明/标签/封面/简介');

      const sub = await b.submit(cfg, cfg.client.creatorWindow, Boolean(args.confirm));
      steps.push(args.confirm ? '已点击「立即投稿」' : '停在「立即投稿」前（confirm=false）');

      return out(
        args.confirm ? '投稿动作已提交，请在页面确认结果' : '稿件已准备就绪，停在「立即投稿」前',
        {
          ok: true, title: meta.title, tags: meta.tags, steps,
          notes: filled.notes, formShot: filled.shot, finalShot: sub.shot, confirm: Boolean(args.confirm),
          submitAt: sub.at,
          hint: args.confirm ? '分享链接与过审状态需人工复核' : '看一眼 formShot 确认无误，再 confirm:true 重跑一次即真正发布',
        },
      );
    },
  });
}

function commentsTool() {
  return defineTool({
    name: 'ai_diary_comments',
    description:
      '评论管理：在客户端创作中心打开「互动管理 → 评论管理」，截图给你读；open=false 时就当续跑。reply 里给“文本 → 回复内容”，会自动在评论页填回复框。Electron 页面读不到文字，评论内容必须靠截图看（pc_see shot 也能取）。',
    parameters: {
      open: { type: 'boolean', description: '默认 true：打开评论页并截图' },
      reply: { type: 'string', description: '要粘进回复框的文本（选一条评论后执行）' },
      send: { type: 'boolean', description: '默认 false，不点发送' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const b = await import('./bili.mjs');
      const cfg = b.loadBiliConfig(ROOT);
      const steps = [];
      let shotPath = null;
      if (args.open !== false) {
        await b.ensureClient(cfg);
        const o = await b.openCreator(cfg);
        steps.push(o.opened ? '已打开创作中心' : '创作中心已开');
        const page = await b.openComments(cfg);
        shotPath = page.shot;
        steps.push('已切到评论管理页并截图');
      }
      if (args.reply) {
        const r = await b.runEngine({ op: 'see', what: 'shot', window: cfg.client.creatorWindow, width: 1280, out: undefined, options: { timeoutMs: 45000 } }, { timeoutMs: 45000 });
        if (!r.ok || !r.image) throw new Error('截图失败，无法定位回复框');
        shotPath = r.image.path;
        const scale = Number(r.image.scale) || 1;
        const origin = Array.isArray(r.image.origin) ? r.image.origin : [0, 0];
        const x = Math.round(r.image.width * 0.72 * scale + origin[0]);
        const y = Math.round(r.image.height * 0.62 * scale + origin[1]);
        const act = await b.runEngine({
          op: 'act',
          actions: [`focus ${cfg.client.creatorWindow}`, `click ${x} ${y}`, `paste ${args.reply}`, ...(args.send ? ['wait 0.5'] : [])],
          options: { timeoutMs: 45000 },
        }, { timeoutMs: 45000 });
        if (!act.ok) throw new Error('回复填写失败：' + act.error);
        steps.push(args.send ? '已填入回复（未点发送，需你确认）' : '已填入回复');
      }
      return out('评论页就绪', { ok: true, steps, shot: shotPath, hint: shotPath ? '读这张图，按坐标用 pc_act 完成回复/翻页' : '' });
    },
  });
}

/* ---------------- 内嵌技能 ---------------- */

function localTool() {
  return defineTool({
    name: 'ai_diary_local',
    description:
      '驱动本机 ComfyUI 出图（不联网、不消耗生成额度），可用 D 盘那些 .safetensors 底模：动漫 ReVAnimated、dark sushi、AWPainting、majicMIX 写实、室内风格、LandscapeBING 景观。action=probe 探活（没启动会告诉你启动方法），action=models 列出服务端认得的底模 + 本机磁盘上的 .safetensors，action=styles 看六种风格的适用场景，action=gen 用指定底模按提示词出图并落盘。生成一张 768×1024 / 28 步的中端卡大约几十秒。',
    parameters: {
      action: { type: 'string', enum: ['probe', 'models', 'styles', 'gen'], description: 'probe=探活，models=列底模，styles=风格说明，gen=出图；默认 probe' },
      prompt: { type: 'string', description: '正向提示词（action=gen 必填）' },
      negative: { type: 'string', description: '负向提示词，默认给一套通用的' },
      ckpt: { type: 'string', description: '底模文件名，省略时按 style 推导' },
      style: { type: 'string', enum: ['anime', 'anime2', 'paint', 'realistic', 'interior', 'landscape'], description: '风格别名：anime=ReVAnimated，anime2=dark sushi，paint=AWPainting，realistic=majicMIX，interior=室内风格，landscape=LandscapeBING' },
      width: { type: 'number', description: '宽，默认 768' },
      height: { type: 'number', description: '高，默认 1024' },
      steps: { type: 'number', description: '采样步数，默认 28' },
      seed: { type: 'number', description: '随机种子，默认 0（每次不同）' },
      base: { type: 'string', description: 'ComfyUI 地址，默认 http://127.0.0.1:8188' },
      out: { type: 'string', description: '输出 PNG 路径，默认 out/local/<时间>.png' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const L = await import('./local.mjs');
      const action = String(args.action || 'probe');
      if (action === 'styles') {
        const lines = Object.keys(L.STYLE_NOTES).map((k) => `${k.padEnd(10)} ${L.STYLE_CKPT[k]} —— ${L.STYLE_NOTES[k]}`);
        return out('六种本地风格：\n' + lines.join('\n'), { ok: true, styles: L.STYLE_CKPT, notes: L.STYLE_NOTES });
      }
      if (action === 'probe') {
        const p = await L.probe(args.base);
        if (!p.ok) return out(`ComfyUI 没起来：${p.reason}`, p);
        return out(`ComfyUI 在线：${p.device}${p.vramGB ? ` / ${p.vramGB}GB 显存` : ''} · ${p.base}`, p);
      }
      if (action === 'models') {
        const p = await L.probe(args.base);
        let server = [];
        if (p.ok) {
          try {
            server = await L.listServerCheckpoints(p.base);
          } catch (e) {
            server = [];
          }
        }
        const disk = L.scanDisk({ roots: ['D:\\', 'E:\\', 'C:\\'], maxDepth: 2 });
        const lines = [];
        if (p.ok) lines.push(`服务端可用底模 ${server.length} 个：` + (server.join(' / ') || '（空，去 ComfyUI\\models\\checkpoints 放文件）'));
        else lines.push('服务端：' + p.reason);
        lines.push(`本机 .safetensors ${disk.length} 个：` + disk.slice(0, 12).map((d) => `${d.name}（${d.sizeGB}GB）`).join(' / '));
        return out(lines.join('\n'), { ok: p.ok, base: p.base, server, disk });
      }
      // gen
      if (!args.prompt) throw new Error('action=gen 需要 prompt');
      const outFile = resolvePath(args.out, exec, path.join('out', 'local', `${Date.now()}-${args.style || 'gen'}.png`));
      const r = await L.txt2img({
        base: args.base,
        ckpt: args.ckpt,
        style: args.style,
        positive: args.prompt,
        negative: args.negative || 'lowres, bad anatomy, bad hands, extra digits, watermark, text, signature, jpeg artifacts, blurry',
        width: args.width || 768,
        height: args.height || 1024,
        steps: args.steps || 28,
        seed: args.seed || 0,
        outFile,
      });
      if (!r.ok) {
        const extra = r.available ? `\n服务端现有：${r.available.join(' / ')}` : '';
        return out(`没出图：${r.reason}${extra}${r.hint ? '\n' + r.hint : ''}`, r);
      }
      return out(`出图完成 ${r.seconds}s · ${r.ckpt} → ${rel(r.file)}`, r);
    },
  });
}

function motionTool() {
  return defineTool({
    name: 'ai_diary_motion',
    description:
      '角色动态素材（Seedance 生成的 5 秒角色短片）管理。action=list 列已有短片与缺谁，action=import 把一段 mp4 收进插件（按角色归档并记录时长/尺寸），action=plate 把短片转成 9:16 动态底板（assets/plates/<name>）给 render 当背景层。注意：引擎只能整段转底板，不能把视频里的透明角色单独抠出来叠到立绘位。',
    parameters: {
      action: { type: 'string', enum: ['list', 'import', 'plate'], description: 'list / import / plate' },
      from: { type: 'string', description: 'action=import 时必填：源 mp4 路径' },
      character: { type: 'string', description: '角色 id：deepseek/gpt/gemini/claude/grok/glm/qwen/kimi' },
      name: { type: 'string', description: 'action=plate 的底板名，默认 <角色>-motion；import 时为文件名后缀，默认 loop' },
      clip: { type: 'string', description: 'action=plate 要用的短片 key，如 deepseek-loop；省略则按 character 找' },
      seconds: { type: 'number', description: 'action=plate 时长，默认 8 秒' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const M = await import('./motion.mjs');
      const action = String(args.action || 'list');
      if (action === 'list') {
        const { clips, missing } = M.listClips(ROOT);
        const lines = clips.map((c) => `${c.key} · ${c.seconds || '?'}s · ${c.width && c.height ? `${c.width}×${c.height}` : '?'} · ${(c.bytes / 1024 / 1024).toFixed(1)}MB`);
        if (missing.length) lines.push('还缺：' + missing.join(' / '));
        return out(`角色短片 ${clips.length} 条\n` + (lines.join('\n') || '（还没有，用 action=import 收一段）'), { ok: true, clips, missing });
      }
      if (action === 'import') {
        if (!args.from) throw new Error('action=import 需要 from（mp4 路径）');
        if (!args.character) throw new Error('action=import 需要 character');
        const { findFfmpeg } = await import('./engine.mjs');
        const rec = M.importClip({ root: ROOT, from: resolvePath(args.from, exec), character: args.character, name: args.name, ffmpeg: findFfmpeg(ROOT) });
        return out(`已收进插件：${rec.key} · ${rec.seconds}s · ${rec.width || '?'}×${rec.height || '?'}`, rec);
      }
      // plate
      const { clips } = M.listClips(ROOT);
      const clip = args.clip
        ? clips.find((c) => c.key === String(args.clip))
        : clips.find((c) => c.character === args.character);
      if (!clip) throw new Error('没找到这条短片：先 ai_diary_motion action=list');
      const { findFfmpeg } = await import('./engine.mjs');
      const { buildPlateFrames } = await import('./plate.mjs');
      const name = String(args.name || `${clip.key}-motion`);
      const dir = path.join(ROOT, 'assets', 'plates', name);
      const meta = buildPlateFrames({ from: clip.file, dir, ffmpeg: findFfmpeg(ROOT), seconds: Number(args.seconds) || 8, width: 720, height: 1280 });
      return out(`底板 ${name} 已生成 ${meta.frames} 帧 / ${meta.seconds}s → assets/plates/${name}`, { ok: true, plate: name, ...meta });
    },
  });
}

function updateTool() {
  return defineTool({
    name: 'ai_diary_update',
    description:
      '联网自更新：查 GitHub Releases 上比本地新的版本（action=check，只读不下载），或下载对应 .tgz 到 dist/updates 并给出安装命令（action=download）。配置在 config/update.json 的 repo（owner/name）。私有仓库需 GITHUB_TOKEN；公开仓库只读查新不需要 token。永远不自动安装：给 profile 才在 apply 时调 install.ps1。',
    parameters: {
      action: { type: 'string', enum: ['check', 'download', 'apply'], description: 'check=查新，download=下载最新 tgz，apply=下载并按 profile 安装；默认 check' },
      repo: { type: 'string', description: '覆盖 owner/name，省略用 config/update.json' },
      profile: { type: 'string', description: 'action=apply 时必填：dsh profile 根目录' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const U = await import('./update.mjs');
      const action = String(args.action || 'check');
      const c = await U.checkUpdate(ROOT, { repo: args.repo });
      if (!c.ok) return out(`查新失败：${c.reason}`, c);
      if (action === 'check') {
        const s = c.hasUpdate ? `有新版本：${c.current} → ${c.latest}` : `已是最新版：${c.current}`;
        return out(s + (c.asset ? ` · 资源 ${c.asset.name}（${(c.asset.size / 1024 / 1024).toFixed(1)}MB）` : ' · release 里没有 tgz'), c);
      }
      if (!c.asset) return out('最新 release 里没有 .tgz 资源，无法下载', c);
      const d = await U.downloadUpdate(ROOT, c.asset);
      const cmd = U.installCommand(rel(d.file), args.profile);
      if (action === 'download') {
        const check = d.digestOk === false ? '（sha256 与 release 记录不一致，别装）' : d.digestOk ? '（sha256 校验通过）' : '';
        return out(`已下载 ${rel(d.file)} ${(d.bytes / 1024 / 1024).toFixed(1)}MB ${check}`, { ...c, ...d, install: cmd });
      }
      if (!args.profile) throw new Error('action=apply 需要 profile（dsh profile 根目录）');
      const { execFileSync } = await import('node:child_process');
      execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'install.ps1'), '-Mode', 'tgz', '-PackagePath', d.file, '-ProfileRoot', resolvePath(args.profile, exec)], { stdio: 'pipe' });
      return out(`已安装 ${c.latest} 到 ${args.profile}，退出 Harness 再启动生效`, { ...c, ...d, installedTo: args.profile });
    },
  });
}

function settingsTool() {
  return defineTool({
    name: 'ai_diary_settings',
    description:
      '读写 AI 日记工坊的插件设置（和 Harness 官方设置面板里的同一份配置）。get=看当前配置（key 会打码，只报告是否就绪以及来自环境变量还是文件）；set=改配置，例如 {"keys":{"mimo":"…"},"tts":{"provider":"qwen"},"publish":{"dryRun":true}}；reset=清空回默认。设置文件默认在 ~/.ai-diary/settings.json，环境变量优先（MIMO_API_KEY / DASHSCOPE_API_KEY / MINIMAX_API_KEY / GITHUB_TOKEN）。',
    parameters: {
      action: { type: 'string', enum: ['get', 'set', 'reset'], description: 'get=读，set=写，reset=恢复默认；默认 get' },
      patch: { type: 'json', description: 'action=set 时要合并进去的片段（会和现有配置深合并，不用给全量）' },
    },
    output: outputDef(),
    isConcurrencySafe: () => true,
    async execute(args) {
      const S = await import('./settings.mjs');
      const action = String(args.action || 'get');
      if (action === 'get') {
        const view = S.publicView(S.loadSettings(ROOT));
        const ready = Object.entries(view.keys).filter(([, v]) => v.ready).map(([k]) => k);
        return out(
          `设置 ${view.file}｜已就绪的 key：${ready.length ? ready.join(' / ') : '无'}｜定时：${view.schedule.enabled ? '开' : '关'} ${view.schedule.dailyAt}`,
          view,
        );
      }
      if (action === 'reset') {
        const next = S.saveSettings(ROOT, S.DEFAULTS);
        return out('已恢复默认设置（key 已清空）', S.publicView({ ...next, __file: next.__file }));
      }
      const patch = typeof args.patch === 'string' ? JSON.parse(args.patch) : args.patch;
      if (!patch || typeof patch !== 'object') throw new Error('action=set 需要 patch 对象');
      const next = S.saveSettings(ROOT, patch);
      const applied = S.applyEnv(next);
      const view = S.publicView({ ...next, __file: next.__file });
      return out(`已保存到 ${view.file}${applied.length ? `，并注入环境变量 ${applied.join(' / ')}` : ''}`, view);
    },
  });
}

function scheduleTool() {
  return defineTool({
    name: 'ai_diary_schedule',
    description:
      '定时自动出片：status=看状态与最近记录；enable=打开（需给 dailyAt，如 20:30）；disable=关掉；set=只改参数不改变启停；run-now=立刻按当前配置跑一遍（不等时间）。触发后自动选题→编剧本→本地渲染出片→（有 key 才）配音→把成片交给哔哩哔哩客户端并填好文案，仍停在「立即投稿」前不代点；comments=true 顺带打开评论管理页。默认关闭，一天只跑一次。',
    parameters: {
      action: { type: 'string', enum: ['status', 'enable', 'disable', 'set', 'run-now'], description: '默认 status' },
      daily_at: { type: 'string', description: '每天执行时间，24 小时制 HH:MM，如 20:30' },
      make: { type: 'boolean', description: '是否自动出片，默认 true' },
      voice: { type: 'boolean', description: '是否自动配音，默认 true（缺 key 时自动跳过）' },
      publish: { type: 'boolean', description: '是否自动交给客户端投稿，默认 true' },
      comments: { type: 'boolean', description: '是否顺带打开评论管理页，默认 false' },
      look: { type: 'string', description: '指定立绘档位，如 v13' },
    },
    output: outputDef(),
    isConcurrencySafe: () => false,
    async execute(args) {
      const S = await import('./settings.mjs');
      const SCH = await import('./scheduler.mjs');
      const action = String(args.action || 'status');
      const patch = {};
      if (args.daily_at) patch.dailyAt = String(args.daily_at).trim();
      for (const k of ['make', 'voice', 'publish', 'comments']) if (typeof args[k] === 'boolean') patch[k] = args[k];
      if (args.look) patch.look = String(args.look);
      if (Object.keys(patch).length) {
        if (patch.dailyAt || patch.dailyAt === '') {
          const re = /^\d{1,2}:\d{2}$/;
          if (patch.dailyAt && !re.test(patch.dailyAt)) throw new Error('daily_at 要 24 小时制 HH:MM，例如 20:30');
        }
        S.saveSettings(ROOT, { schedule: patch });
      }
      if (action === 'enable') {
        const cur = S.loadSettings(ROOT);
        if (!cur.schedule.dailyAt) throw new Error('打开定时前先给 daily_at（HH:MM）');
        S.saveSettings(ROOT, { schedule: { enabled: true } });
        const st = SCH.status(ROOT);
        return out(`定时已打开：每天 ${st.dailyAt} 自动出片${st.publish.dryRun ? '（投稿为预演）' : ''}`, st);
      }
      if (action === 'disable') {
        S.saveSettings(ROOT, { schedule: { enabled: false } });
        return out('定时已关闭，不会再自动跑', SCH.status(ROOT));
      }
      if (action === 'run-now') {
        S.applyEnv(S.loadSettings(ROOT));
        const r = await SCH.runOnce(ROOT, { reason: 'manual' });
        if (!r.ok && r.skipped) return out('已经有一次在跑，等它结束', r);
        return out(
          r.ok ? `跑完了：${r.steps.length} 步${r.warnings.length ? `，${r.warnings.length} 条告警` : ''}` : `失败：${r.error}`,
          r,
        );
      }
      return out(`定时${SCH.status(ROOT).enabled ? '开着' : '关着'}`, SCH.status(ROOT));
    },
  });
}

function registerSkill(ctx) {
  const skills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined;
  if (!skills || typeof skills.register !== 'function') return;
  let content;
  try {
    content = fs.readFileSync(fileURLToPath(SKILL_FILE), 'utf8');
  } catch {
    return; // 技能文件缺失不影响 5 个工具
  }
  if (!content.trim()) return;
  ctx.effect(
    () => skills.register({
      name: 'ai-diary',
      description: '用 AI 日记工坊的 7 个 ai_diary_* 工具，从选题一路做到 B 站投稿：选题 → 剧本 → 本地渲染出片 → 三家 TTS 任选配音 → MiniMax H3 生成动态底板 → 素材自检补图 → 挂进客户端投稿。',
      whenToUse: '用户要做 AI 角色日记 / 竖屏短剧，或提到 AI 日记工坊、ai_diary_* 工具、要求「批量出片」「发到 B 站」时。',
      source: 'runtime',
      content,
      resourceBase: { kind: 'directory', path: dirname(fileURLToPath(SKILL_FILE)) },
    }),
    'ai-diary: skill',
  );
}

export function apply(ctx, config = {}) {
  // 插件自身绝不能把宿主拖死：任何一步失败都只降级，不向外抛。
  try {
    registerSkill(ctx);
  } catch (e) {
    console.warn('[ai-diary] 技能注册失败：' + e.message);
  }
  const tools = [topicsTool(), planTool(), renderTool(), voiceTool(), assetsTool(), hailuoTool(), publishTool(), pickTool(), postTool(), commentsTool(), localTool(), motionTool(), updateTool(), settingsTool(), scheduleTool()];
  // 桌面操控（并入自 dsh-pc-control）：pc_see / pc_act
  try {
    tools.push(...createPcTools({ defineTool, out, outputDef, cfg: { failsafe: true, maxActions: 24, timeoutMs: 30000, shotTtlMinutes: 30 } }));
  } catch (e) {
    console.warn('[ai-diary] pc_see / pc_act 注册失败：' + e.message);
  }
  for (const tool of tools) {
    try {
      ctx.effect(() => ctx.tools.register(tool), 'ai-diary: tool ' + tool.name);
    } catch (e) {
      console.warn('[ai-diary] 工具 ' + tool.name + ' 注册失败：' + e.message);
    }
  }
  try {
    void pcWarmup({ timeoutMs: 30000, maxActions: 24, failsafe: true });
  } catch {
    /* 预热失败不影响注册 */
  }
  // 设置：官方设置面板传进来的 config 只覆盖本次运行，不写文件（避免把面板默认值当成用户选择落盘）。
  try {
    ctx.effect(() => {
      void (async () => {
        const S = await import('./settings.mjs');
        const base = S.loadSettings(ROOT);
        const merged = config && Object.keys(config).length ? S.merge(base, config) : base;
        S.applyEnv(merged);
      })();
    }, 'ai-diary: settings');
  } catch (e) {
    console.warn('[ai-diary] 设置载入失败：' + e.message);
  }
  // 定时任务：默认关闭，enabled=true 才会跑；卸载时随 ctx 一起停。
  try {
    ctx.effect(() => {
      let handle = null;
      void (async () => {
        try {
          const SCH = await import('./scheduler.mjs');
          handle = SCH.start(ROOT, {
            onLog: (m) => console.log('[ai-diary] 定时：' + m),
          });
        } catch (e) {
          console.warn('[ai-diary] 定时器启动失败：' + e.message);
        }
      })();
      return () => {
        try {
          handle?.stop?.();
        } catch {
          /* 停不掉就算了，进程退出会带走 */
        }
      };
    }, 'ai-diary: scheduler');
  } catch (e) {
    console.warn('[ai-diary] 定时器挂载失败：' + e.message);
  }
  try {
    ctx.effect(() => {
      fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
    }, 'ai-diary: paths');
  } catch (e) {
    console.warn('[ai-diary] 目录初始化失败：' + e.message);
  }
}

export default { name, inject, apply };
