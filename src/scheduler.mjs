// 定时任务：到点自己选题 → 编剧本 → 渲染出片 →（可选）配音 →（可选）挂进客户端投稿 →（可选）开评论页。
//
// 设计上的硬约束：
//   - 默认关闭，必须显式 enabled=true 且有 dailyAt 才会跑；不点开就完全不动。
//   - 一天只跑一次（记 lastRun 日期），同一分钟窗口外不补跑。
//   - 不覆盖已有成片：文件名带时间戳，落在 out/scheduled/。
//   - 「发布」这一步默认只做到「客户端里视频已选好、文案已在剪贴板」，不替你点「立即投稿」；
//     要真点进去必须 settings.publish.autoPost=true（对外不可逆，默认 false）。
//   - 任何一步失败都记进 runs 里并继续，不把宿主拖死。

import fs from 'node:fs';
import path from 'node:path';
import { loadSettings, saveSettings, applyEnv } from './settings.mjs';

const TICK_MS = 30_000;
let busy = false;
let timer = null;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minuteOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 到点没到点：只在 dailyAt 那一分钟内为真，避免睡过头后半夜补跑 */
export function due(settings, now = new Date()) {
  const sc = settings.schedule || {};
  if (!sc.enabled) return false;
  const target = minuteOfDay(sc.dailyAt);
  if (target === null) return false;
  if ((sc.lastRun || '') === todayKey(now)) return false;
  return now.getHours() * 60 + now.getMinutes() === target;
}

/**
 * 跑一次完整流程。
 * @param {string} root 插件根目录
 * @param {object} opts { reason, overrides, onLog }
 */
export async function runOnce(root, opts = {}) {
  if (busy) return { ok: false, skipped: 'already-running' };
  busy = true;
  const onLog = opts.onLog || (() => {});
  const startedAt = new Date();
  const steps = [];
  const warnings = [];
  let video = null;
  let script = null;

  try {
    const settings = loadSettings(root);
    applyEnv(settings);
    // 总开关默认关：定时/自动跑要它开着，面板上手动点「立即出片」不受限
    if (opts.reason === 'schedule' && settings.enabled !== true) {
      return { ok: false, skipped: '插件总开关是关的（对话框左上角或面板里打开后再走定时）' };
    }
    const sc = { ...settings.schedule, ...(opts.overrides || {}) };

    const topics = await import('./topics.mjs');
    const scriptMod = await import('./script.mjs');
    const engine = await import('./engine.mjs');
    const studio = await import('./studio.mjs');

    // 选材：默认走「自主选材」——读最近的评论，让模型自己决定这一集讲什么，
    // 不再从 data/topics.json 里抽固定题材。studio.freePlan=false 才退回题材库。
    let picked = null;
    let planHow = 'template';
    let planWhy = '';
    if (settings.studio && settings.studio.freePlan !== false) {
      if (settings.studio.refreshComments !== false) {
        try {
          const fresh = await studio.fetchFromBili(root);
          if (!fresh.ok) warnings.push('评论没拉到：' + fresh.reason);
        } catch (e) {
          warnings.push('刷新评论失败：' + e.message);
        }
      }
      const plan = await studio.planTopic(root, { useModel: true });
      if (plan.error) warnings.push('自主选材降级为本地拼装：' + plan.error);
      picked = plan.topic;
      planHow = plan.how;
      planWhy = plan.why || '';
    } else {
      picked = topics.pickTopics({ count: 1, fresh: true })[0];
    }
    if (!picked) throw new Error('没有可用的题材，无法选题');
    steps.push(`选题 ${picked.id}（${picked.title}）· ${planHow}`);
    if (planWhy) steps.push('来源：' + planWhy);
    onLog(`选题 ${picked.id}（${planHow}）`);

    script = scriptMod.buildScript(picked, {});
    if (sc.look) script.episode.look = String(sc.look).replace(/^v/, 'v');
    const outDir = path.join(root, 'out', 'scheduled');
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, `${script.id}-${stamp(startedAt)}`);
    scriptMod.writeScript(script, base + '.json');
    const sum = scriptMod.summary(script);
    steps.push(`剧本 ${sum.shots} 镜 / ${sum.seconds}s / ${sum.character}`);

    if (sc.make !== false) {
      const out = base + '.mp4';
      const r = await engine.renderEpisode(script, {
        out,
        template: sc.template || undefined,
        plate: sc.plate ? path.resolve(root, sc.plate) : undefined,
        onProgress: () => {},
      });
      video = out;
      steps.push(`成片 ${path.basename(out)}（${r.seconds}s / ${r.frames} 帧）`);
      onLog(`成片 ${out}`);

      // 进成片库：面板的「成片管理」靠这份索引数集数
      if (settings.studio && settings.studio.autoRegister !== false) {
        try {
          const film = studio.addFilm(root, {
            title: script.title,
            file: out,
            seconds: r.seconds,
            character: script.episode.character,
            createdAt: startedAt.toISOString(),
            source: opts.reason === 'schedule' ? 'schedule' : 'panel',
          });
          steps.push(`已入成片库：第 ${film.episode} 集`);
        } catch (e) {
          warnings.push('登记成片失败：' + e.message);
        }
      }
    }

    // 配音：只在 key 就绪时做，缺 key 不阻断出片
    if (video && sc.voice !== false && (settings.tts && settings.tts.provider)) {
      try {
        const voice = await import('./voice.mjs');
        const cfg = voice.loadVoiceConfig(root);
        const key = voice.resolveApiKey({ ...cfg, provider: settings.tts.provider });
        if (!key) {
          warnings.push('跳过配音：对应服务商的 key 没配');
        } else {
          const ffmpeg = engine.findFfmpeg();
          const track = await voice.buildVoiceTrack(script, {
            root,
            ffmpeg,
            cfg: { ...cfg, provider: settings.tts.provider, voice: settings.tts.voice || undefined },
            onProgress: () => {},
          });
          const merged = await voice.muxVoice(video, track.track, base + '-voice.mp4', ffmpeg);
          video = merged && typeof merged === 'string' ? merged : base + '-voice.mp4';
          steps.push(`配音完成 ${path.basename(video)}`);
        }
      } catch (e) {
        warnings.push('配音失败：' + e.message);
      }
    }

    // 发布：默认只做到「客户端已就绪 + 文案进剪贴板」
    let published = null;
    let submitted = false;
    const pubMeta = scriptMod.publishMeta(script);
    // 演练模式必须在整条发布链路上生效：填表、点投稿都不能做，
    // 否则「打开演练」只是少复制一段文案，照样会把片子发出去。
    const dryMode = settings.publish.dryRun !== false;
    if (video && sc.publish) {
      try {
        const pub = await import('./publish.mjs');
        published = await pub.publishViaClient({
          video,
          title: pubMeta.title,
          desc: pubMeta.desc,
          tags: pubMeta.tags,
          dryRun: dryMode,
        });
        steps.push(published.ok ? '已把成片交给客户端（等你在客户端点投稿）' : '客户端没找到，仅出片');
        if (!published.ok) warnings.push(published.message || '客户端不可用');

        if (published.ok && dryMode) {
          steps.push('演练模式：只把成片交给客户端，不自动填表、不点投稿');
        } else if (published.ok && settings.publish.autoFill) {
          const bili = await import('./bili.mjs');
          const cfg = bili.loadBiliConfig(root);
          await bili.ensureClient(cfg);
          await bili.openCreator(cfg);
          await bili.uploadVideo(cfg, video, cfg.client.creatorWindow);
          await bili.fillForm(cfg, cfg.client.creatorWindow, {
            title: pubMeta.title,
            statement: settings.publish.statement || '自制',
            tags: pubMeta.tags,
          });
          steps.push('已把视频与文案填进投稿页');

          if (settings.publish.autoSubmit) {
            const r = await bili.submit(cfg, cfg.client.creatorWindow, true);
            if (r.clicked) {
              submitted = true;
              steps.push('已点「立即投稿」');
            } else {
              warnings.push('点「立即投稿」没成功：' + (r.error || '按钮没点到'));
            }
          } else {
            steps.push('停在「立即投稿」前（autoSubmit 未开）');
          }
        }
      } catch (e) {
        warnings.push('发布失败：' + e.message);
      }

      // 记账：面板「发布与评论」靠这条显示最近一次发布时间
      try {
        studio.logPublish(root, {
          title: pubMeta.title,
          ok: submitted || Boolean(published && published.ok),
          submitted,
          dryRun: settings.publish.dryRun !== false,
          video: video ? path.basename(video) : null,
          source: opts.reason || 'manual',
          error: published && !published.ok ? published.message || '客户端不可用' : undefined,
        });
      } catch {
        /* 记账失败不影响出片 */
      }
    }

    // 评论：打开评论页，可选在一段时间内自动回复
    if (sc.comments) {
      try {
        const bili = await import('./bili.mjs');
        const cfg = bili.loadBiliConfig(root);
        await bili.ensureClient(cfg);
        const commentsMod = await import('./comments.mjs');

        const watchMinutes = Number(sc.commentsMinutes ?? settings.comments.watchMinutes ?? 0);
        if (watchMinutes > 0) {
          const w = await commentsMod.watch(root, {
            minutes: watchMinutes,
            intervalMinutes: Number(sc.commentsInterval ?? settings.comments.intervalMinutes ?? 5),
            // 自动回复只认 comments.autoReply：原来这里跟着 autoSubmit 走，
            // 用户为了发视频打开自动投稿，评论也会被自动发出去
            send: settings.comments.autoReply === true,
            maxPerRun: Number(settings.comments.maxPerRun ?? 3),
            rules: settings.comments.rules,
            fallback: settings.comments.fallback,
          });
          steps.push(`评论挂机 ${w.minutes} 分钟：${w.rounds} 轮，回复 ${w.sent} 条`);
        } else {
          const r = await bili.openComments(cfg);
          steps.push(r && (r.opened || r.ok) ? '已打开评论管理页' : '评论页未打开（锚点可能没配）');
        }
      } catch (e) {
        warnings.push('评论页失败：' + e.message);
      }
    }

    const result = {
      ok: true,
      at: startedAt.toISOString(),
      reason: opts.reason || 'manual',
      script: script.id,
      video,
      steps,
      warnings,
    };
    record(root, result);
    return result;
  } catch (e) {
    const result = {
      ok: false,
      at: startedAt.toISOString(),
      reason: opts.reason || 'manual',
      error: e.message,
      steps,
      warnings,
    };
    record(root, result);
    return result;
  } finally {
    busy = false;
  }
}

function record(root, result) {
  try {
    const s = loadSettings(root);
    const runs = (s.schedule.runs || []).slice(-6);
    runs.push({ at: result.at, ok: result.ok, reason: result.reason, video: result.video || null, error: result.error || null, warnings: result.warnings || [] });
    saveSettings(root, {
      schedule: {
        lastRun: todayKey(new Date(result.at)),
        lastResult: { ok: result.ok, at: result.at, video: result.video || null, error: result.error || null },
        runs,
      },
    });
  } catch {
    /* 记账失败不影响主流程 */
  }
}

/** 定时发布：只在 publishAt 那一分钟内为真，一天一次 */
export function publishDue(settings, now = new Date()) {
  const sc = settings.schedule || {};
  const target = minuteOfDay(sc.publishAt);
  if (target === null) return false;
  if ((sc.lastPublishRun || '') === todayKey(now)) return false;
  return now.getHours() * 60 + now.getMinutes() === target;
}

/**
 * 把成片库里最新一条 ready 的片子发出去（定时发布和面板「立即发布」共用）。
 * 发布策略仍服从 settings.publish（dryRun / autoFill / autoSubmit），不自作主张点投稿。
 */
export async function publishLatest(root, { reason = 'schedule' } = {}) {
  const studio = await import('./studio.mjs');
  const settings = loadSettings(root);
  applyEnv(settings);

  const doc = studio.listFilms(root, { scan: false });
  const ready = doc.items
    .filter((i) => i.status === 'ready' && i.exists && i.file)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!ready.length) return { ok: false, skipped: '成片库里没有待发布的片子' };
  const film = ready[0];
  const video = path.resolve(root, film.file);
  const meta = {
    title: film.title,
    desc: `AI 角色日记 第 ${film.episode} 集。画面由本地渲染引擎生成，未使用视频生成模型。`,
    tags: ['AI', 'AI角色', 'DeepSeek', '竖屏短剧', 'AI日记'],
  };

  const steps = [];
  const warnings = [];
  let published = null;
  let submitted = false;
  // 和 runOnce 一样：演练模式下任何对外动作都不做
  const dryMode = settings.publish.dryRun !== false;
  try {
    const pub = await import('./publish.mjs');
    published = await pub.publishViaClient({ video, ...meta, dryRun: dryMode });
    steps.push(published.ok ? '已把成片交给客户端' : '客户端没找到，未发布');
    if (published.ok && dryMode) {
      steps.push('演练模式：只把成片交给客户端，不自动填表、不点投稿');
    } else if (published.ok && settings.publish.autoFill) {
      const bili = await import('./bili.mjs');
      const cfg = bili.loadBiliConfig(root);
      await bili.ensureClient(cfg);
      await bili.openCreator(cfg);
      await bili.uploadVideo(cfg, video, cfg.client.creatorWindow);
      await bili.fillForm(cfg, cfg.client.creatorWindow, {
        title: meta.title,
        statement: settings.publish.statement || '自制',
        tags: meta.tags,
      });
      steps.push('已把视频与文案填进投稿页');
      if (settings.publish.autoSubmit) {
        const r = await bili.submit(cfg, cfg.client.creatorWindow, true);
        if (r.clicked) {
          submitted = true;
          steps.push('已点「立即投稿」');
        } else {
          warnings.push('点「立即投稿」没成功：' + (r.error || '按钮没点到'));
        }
      }
    }
  } catch (e) {
    warnings.push('发布失败：' + e.message);
  }

  studio.logPublish(root, {
    title: meta.title,
    episode: film.episode,
    ok: submitted || Boolean(published && published.ok),
    submitted,
    dryRun: settings.publish.dryRun !== false,
    video: film.file,
    source: reason,
    error: published && !published.ok ? published.message || '客户端不可用' : undefined,
  });
  if (submitted) studio.updateFilm(root, film.id, { status: 'published', publishedAt: new Date().toISOString() });
  saveSettings(root, { schedule: { lastPublishRun: todayKey(new Date()) } });

  return { ok: true, episode: film.episode, title: meta.title, submitted, steps, warnings };
}

export function tick(root, onLog) {
  const settings = loadSettings(root);
  // 总开关关着时，定时出片和定时发布都不动
  if (settings.enabled !== true) return null;
  // 定时发布先看：它只碰「成片库」，不重新渲染
  if (publishDue(settings)) {
    return publishLatest(root, { reason: 'schedule' }).catch(() => null);
  }
  if (!due(settings)) return null;
  return runOnce(root, { reason: 'schedule', onLog });
}

/** 挂到宿主生命周期上；返回 stop 便于测试 */
export function start(root, { onLog, intervalMs = TICK_MS } = {}) {
  if (timer) return { stop: stopScheduler };
  timer = setInterval(() => {
    const p = tick(root, onLog);
    if (p && typeof p.then === 'function') p.catch(() => {});
  }, intervalMs);
  if (timer.unref) timer.unref();
  return { stop: stopScheduler };
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function status(root) {
  const s = loadSettings(root);
  const target = minuteOfDay(s.schedule.dailyAt);
  return {
    enabled: Boolean(s.schedule.enabled),
    dailyAt: s.schedule.dailyAt,
    publishAt: s.schedule.publishAt || '',
    valid: target !== null,
    running: busy,
    lastRun: s.schedule.lastRun,
    lastPublishRun: s.schedule.lastPublishRun || null,
    lastResult: s.schedule.lastResult,
    runs: (s.schedule.runs || []).slice(-7),
    publish: s.publish,
  };
}
