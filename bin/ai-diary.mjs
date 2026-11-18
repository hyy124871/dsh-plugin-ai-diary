#!/usr/bin/env node
// 命令行入口：不装 dsh 也能单独跑
//   node bin/ai-diary.mjs topics --count 3
//   node bin/ai-diary.mjs plan --topic day7-balance
//   node bin/ai-diary.mjs render --script out/day7-balance.json
//   node bin/ai-diary.mjs render --script out/day7-balance.json --png
//   node bin/ai-diary.mjs assets
//   node bin/ai-diary.mjs publish --video out/day7-balance.mp4 --dry-run

import path from 'node:path';
import fs from 'node:fs';
const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags[k] = next; i++; } else flags[k] = true;
  }
}
const num = (v) => (v === undefined ? undefined : Number(v));

const mod = await import('../src/index.mjs');
const { auditAssets } = mod;

async function main() {
  if (!cmd || cmd === 'help') {
    console.log(`AI 日记工坊（dsh 插件）命令行

  topics   --count 3 [--character deepseek] [--seed 42] [--template report]
  status   [--online] [--json] [--no-color]      一屏体检：环境 / 密钥 / 账号 / 内容 / 定时（--online 顺带验登录态与联网）
  settings --action status|get|reset|set [--mimo k] [--qwen k] [--minimax k] [--bili "SESSDATA=…"] [--provider qwen] [--voice 冰糖]
  plan     [--topic day7-balance] [--character gpt] [--template dossier] [--out out/x.json]
  plan     --all [--template audit]              题材库一次性编译成剧本（省对话轮次）
  render   --script out/day7-balance.json [--out out/x.mp4] [--template terminal] [--plate report] [--look v2] [--voice 冰糖] [--png] [--scale 1.5=1080p] [--fps 24] [--workers 4] [--accelerator cpu|gpu|auto]
  voice    --check | --script out/x.json [--provider xiaomi|qwen|minimax] [--mode design] [--voice Cherry] [--mux out/x.mp4]
  video    --prompt "..." [--from out/x.png] [--last out/x2.png] [--duration 8] [--resolution 768P] [--model MiniMax-H3] [--out out/x.mp4] [--status task_id]
  template                                      列出全部版面模板
  plate    --from assets/backgrounds/report-desk.png --name report [--seconds 8]
  plates                                        列出已有动态底板
  assets   [--character deepseek]
  publish  --video out/x.mp4 [--title "..."] [--dry-run]
  pick     [--character deepseek] [--mood calm|panic|relief|excited] [--template audit] [--style chibi]
  post     --video out/x.mp4 [--title "..."] [--desc "..."] [--tags "AI日记,短剧"] [--cover out/x.png] [--statement 自制] [--skip-open] [--confirm]
  comments
  pc       --see windows|tree|find|shot [--window 片段] | --act "focus xx" "click 100 200" ["paste 文本"] [--dry-run]
  local    --action probe|models|styles [--base http://127.0.0.1:8188]
  local    --prompt "..." [--style anime|realistic|paint|interior|landscape] [--ckpt x.safetensors] [--width 768] [--height 1024] [--steps 28] [--seed 42] [--out out/local/x.png]
  motion                                         列出已收进插件的角色短片
  motion   --action import --from "X:\豆包 (2).mp4" --character deepseek [--name loop]
  motion   --action plate --character deepseek [--name ds-motion] [--seconds 8]
  update   --action check|download|apply|auto [--profile <dir>] [--repo owner/name]
           auto = 查新→下载→自动装进本机 profile（省略 --profile 就自己扫 ~/.dsh/profiles）

模板：classic 星夜日记 / report 评测报告 / dossier 机密档案 / terminal 数据终端 / audit 听证记录 / specimen 标本观察
动态底板：assets/plates/<模板>/ 帧目录存在时优先当背景层；Seedance / H3 成片用 plate --from 转一次即可接管
立绘：assets/characters/transparent/variants/<角色>_<风格>_v2|v3|v4|v5.png，渲染时 --look 或剧本 episode.look 指定
配音：三家任选 —— xiaomi（MIMO_API_KEY）/ qwen（DASHSCOPE_API_KEY）/ minimax（MINIMAX_API_KEY），voice --check 先验配置
视频：MiniMax H3 异步接口（--from 首帧 → 轮询 → 自动下载），没 key 时 video --dry-run 只打印将提交的 body

产物默认落在插件目录的 out/ 下。`);
    return;
  }

  if (cmd === 'status') {
    const { runDoctor, renderDoctor } = await import('../src/doctor.mjs');
    const rep = await runDoctor(undefined, { online: Boolean(flags.online) });
    if (flags.json) console.log(JSON.stringify(rep, null, 2));
    else console.log(renderDoctor(rep, { color: !flags['no-color'] }));
    process.exitCode = rep.ok ? 0 : 1;
    return;
  }

  if (cmd === 'topics') {
    const { pickTopics } = await import('../src/topics.mjs');
    const picked = pickTopics({ count: num(flags.count) || 3, character: flags.character, seed: num(flags.seed) });
    picked.forEach((t, i) => console.log(`${i + 1}. [${t.id}] ${t.title}  ·  ${t.character} · Day ${t.day} · ¥${t.balance} · ${t.beats.length} 镜`));
    return;
  }

  if (cmd === 'plan') {
    const { loadTopics, pickTopics, variantOf } = await import('../src/topics.mjs');
    const { buildScript, writeScript, summary } = await import('../src/script.mjs');
    // --all：一次把整题材库编译成剧本 JSON，只回一行摘要（省掉逐条对话轮次）
    if (flags.all) {
      const topics = loadTopics();
      const picked = flags.template ? topics.filter(t => (t.template || 'classic') === flags.template) : topics;
      let n = 0;
      for (const topic of picked) {
        const s = buildScript(topic, { template: flags.template || topic.template });
        const f = writeScript(s, path.join('out', `${s.id}.json`));
        const sum = summary(s);
        console.log(`${s.id}  ${sum.shots}镜 ${sum.seconds}s ${sum.character} → ${f}`);
        n++;
      }
      console.log(`共 ${n} 条剧本，已写入 out/（可直接 render，无需再逐条 plan）`);
      return;
    }
    let topic = flags.topic ? loadTopics().find(t => t.id === flags.topic) : pickTopics({ count: 1, character: flags.character })[0];
    if (!topic) throw new Error('没有找到题材：' + flags.topic);
    if (flags.character && flags.character !== topic.character) topic = variantOf(topic, { character: flags.character });
    const s = buildScript(topic, { template: flags.template });
    const f = writeScript(s, flags.out || path.join('out', `${s.id}.json`));
    const sum = summary(s);
    console.log(`已生成《${s.title}》 → ${f}`);
    console.log(`${sum.shots} 镜 · ${sum.chars} 字 · ${sum.seconds}s · 角色 ${sum.character}`);
    sum.shotSheet.forEach(b => console.log(`  ${String(b.shot).padStart(2, '0')} ${b.start.toFixed(2)}s (${b.dur.toFixed(2)}s) ${b.mood}  ${b.text}`));
    return;
  }

  if (cmd === 'render') {
    if (!flags.script) throw new Error('缺少 --script');
    const { loadScript } = await import('../src/script.mjs');
    const { renderEpisodeParallel } = await import('../src/parallel.mjs');
    const { loadSettings } = await import('../src/settings.mjs');
    const st = loadSettings(path.resolve('.'));
    const s = loadScript(flags.script);
    if (flags.look) s.episode.look = String(flags.look); // v2 / v3：换一套立绘模样
    const out = flags.out || path.join('out', `${s.id}.mp4`);
    const png = Boolean(flags.png);
    const t0 = Date.now();
    // --plate 既收底板名（ds-motion）也收路径；传名字时自动补 assets/plates/<名字>
    const plateArg = flags.plate ? String(flags.plate) : '';
    let platePath;
    if (plateArg) {
      const direct = path.resolve(plateArg);
      platePath = fs.existsSync(direct) ? direct : path.resolve(path.join('assets', 'plates', plateArg));
      if (!fs.existsSync(platePath)) {
        console.log(`[warn] 没有这个动态底板：${plateArg}（用 plates 命令看有哪些），本次回退模板背景`);
        platePath = undefined;
      }
    }
    const r = await renderEpisodeParallel(s, {
      out: path.resolve(out),
      pngDir: png ? path.resolve('out', `${s.id}-frames`) : null,
      fps: num(flags.fps) || Number(st.render?.fps) || undefined,
      scale: num(flags.scale) || Number(st.render?.scale) || undefined, // 默认 1.5 → 横屏 1920×1080 / 竖屏 1080×1920；1 → 720p；2 → 2.5K
      orientation: flags.orientation ? String(flags.orientation) : (st.render?.orientation || 'landscape'),
      workers: num(flags.workers),
      workerSetting: Number(st.render?.workers) || 0,
      accelerator: flags.accelerator ? String(flags.accelerator) : String(st.render?.accelerator || 'auto'),
      maxSeconds: num(flags.preview),
      template: flags.template,
      plate: platePath,
      onProgress: p => process.stdout.write(`\r渲染 ${(p * 100).toFixed(0)}%  `),
    });
    process.stdout.write('\n');
    console.log(
      png
        ? `已导出 ${r.frames} 帧 PNG（${r.width}×${r.height}）→ out/${s.id}-frames`
        : `完成 ${r.seconds}s / ${r.frames} 帧 / ${r.width}×${r.height} → ${out}（${((Date.now() - t0) / 1000).toFixed(1)}s，${r.segments || 1} 段并行）`,
    );

    // --voice：渲染完顺手配音并混流（小米 MiMo TTS，需要 MIMO_API_KEY）
    if (flags.voice && !png) {
      const { buildVoiceTrack, muxVoice, loadVoiceConfig } = await import('../src/voice.mjs');
      const { findFfmpeg } = await import('../src/engine.mjs');
      const { ROOT } = await import('../src/script.mjs');
      const ffmpeg = findFfmpeg();
      const cfg = loadVoiceConfig(ROOT);
      const meta = {
        ...(flags.provider ? { provider: flags.provider } : {}),
        ...(flags.voice && flags.voice !== true ? { voice: flags.voice } : {}),
      };
      const track = await buildVoiceTrack(s, { root: ROOT, ffmpeg, cfg: { ...cfg, ...meta }, onProgress: m => console.log('  ' + m) });
      const voiced = path.join(path.dirname(path.resolve(out)), `${path.basename(out, '.mp4')}-voice.mp4`);
      await muxVoice(path.resolve(out), track.track, voiced, ffmpeg);
      console.log(`配音完成 → ${voiced}（音轨 ${track.total}s）`);
    }
    return;
  }

  if (cmd === 'voice') {
    const { buildVoiceTrack, muxVoice, loadVoiceConfig, checkConfig, PROVIDERS, CHARACTER_VOICE_DESIGN } = await import('../src/voice.mjs');
    const { ROOT } = await import('../src/script.mjs');
    const { findFfmpeg } = await import('../src/engine.mjs');
    const cfg = loadVoiceConfig(ROOT);
    if (flags.provider) cfg.provider = flags.provider;
    if (flags.check || !flags.script) {
      const c = await checkConfig({ ...cfg, apiKey: flags.key });
      console.log(`当前 provider：${c.active}（${PROVIDERS[c.active].label}）· mode ${c.mode} · key ${c.activeReady ? '就绪' : '缺失'}`);
      c.rows.forEach(r => console.log(`  ${r.provider.padEnd(8)} ${r.label}  ${r.ready ? 'key ok' : '缺 ' + r.keyEnv}  · model ${r.model} · 默认音色 ${r.defaultVoice}`));
      if (c.hint) console.log('提示：' + c.hint);
      Object.entries(PROVIDERS).forEach(([id, p]) => console.log(`  ${id} 预置音色：${p.voices.join(' / ')}${p.note ? '   // ' + p.note : ''}`));
      console.log('音色设计：xiaomi mode=design 时按角色描述生成 8 种声线（' + Object.keys(CHARACTER_VOICE_DESIGN).join('、') + '）');
      return;
    }
    const { loadScript } = await import('../src/script.mjs');
    const s = loadScript(flags.script);
    const ffmpeg = findFfmpeg();
    const merged = {
      ...cfg,
      ...(flags.provider ? { provider: flags.provider } : {}),
      ...(flags.voice && flags.voice !== true ? { voice: flags.voice } : {}),
      ...(flags.mode ? { mode: flags.mode } : {}),
      ...(flags.key ? { apiKey: flags.key } : {}),
      ...(flags.endpoint ? { endpoint: flags.endpoint } : {}),
    };
    const track = await buildVoiceTrack(s, { root: ROOT, ffmpeg, cfg: merged, onProgress: m => console.log('  ' + m) });
    console.log(`音轨 ${track.total}s（${track.provider}）→ ${track.track}`);
    if (flags.mux) {
      const voiced = path.resolve(flags.out || path.join('out', `${s.id}-voice.mp4`));
      await muxVoice(path.resolve(flags.mux), track.track, voiced, ffmpeg);
      console.log(`已混流 → ${voiced}`);
    }
    return;
  }

  if (cmd === 'video') {
    const h = await import('../src/hailuo.mjs');
    if (flags.status) {
      const t = await h.queryTask(String(flags.status), { apiKey: flags.key });
      console.log(`任务 ${flags.status}：${t.status}${t.url ? ' → ' + t.url : ''}`);
      return;
    }
    if (!flags.prompt) throw new Error('缺少 --prompt');
    const body = h.buildPayload({
      prompt: String(flags.prompt),
      firstFrameUrl: flags.from ? h.toDataUri(String(flags.from)) : undefined,
      lastFrameUrl: flags.last ? h.toDataUri(String(flags.last)) : undefined,
      duration: num(flags.duration) || 8,
      resolution: flags.resolution || '768P',
      model: flags.model || 'MiniMax-H3',
      ratio: flags.ratio,
    });
    if (flags['dry-run'] || !h.resolveKey({ apiKey: flags.key })) {
      console.log('将要提交的 body（未发送）：');
      console.log(JSON.stringify({ ...body, content: body.content.map(c => (c.image_url ? { ...c, image_url: { url: String(c.image_url.url).slice(0, 60) + '…' } } : c)) }, null, 2));
      if (!h.resolveKey({ apiKey: flags.key })) console.log('提示：缺 MINIMAX_API_KEY，设好环境变量再去掉 --dry-run 才会真的生成');
      return;
    }
    const { taskId } = await h.createTask(body, { apiKey: flags.key });
    console.log(`已提交任务 ${taskId}，轮询中（10s 一次）…`);
    const t = await h.waitTask(taskId, {
      cfg: { apiKey: flags.key },
      interval: 10000,
      onTick: s => console.log(`  status=${s.status}`),
    });
    const out = path.resolve(flags.out || path.join('out', `h3-${taskId}.mp4`));
    const d = await h.download(t.url, out);
    console.log(`成片 ${(d.bytes / 1024 / 1024).toFixed(1)}MB → ${d.file}`);
    return;
  }

  if (cmd === 'template' || cmd === 'templates') {
    const { TEMPLATES } = await import('../src/templates.mjs');
    Object.values(TEMPLATES).forEach((t) => console.log(`${t.id.padEnd(9)} ${t.label}  ·  底板 ${t.bg}`));
    return;
  }

  if (cmd === 'plate') {
    if (!flags.from) throw new Error('缺少 --from <静帧或视频>');
    const { buildPlateFrames } = await import('../src/plate.mjs');
    const { findFfmpeg } = await import('../src/engine.mjs');
    const from = path.resolve(flags.from);
    const name = flags.name || path.basename(from, path.extname(from)).replace(/-(desk|room)/, '');
    const dir = path.resolve(flags.nameDir || path.join('assets', 'plates', name));
    const meta = buildPlateFrames({
      from,
      dir,
      ffmpeg: findFfmpeg(),
      width: num(flags.width) || 1080,
      height: num(flags.height) || 1920,
      seconds: num(flags.seconds) || 8,
      fps: num(flags.fps) || 12,
    });
    console.log(`动态底板 ${name}：${meta.frames} 帧 / ${meta.seconds}s / ${meta.fps}fps → ${dir}`);
    return;
  }

  if (cmd === 'plates') {
    const dir = path.resolve('assets', 'plates');
    const names = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory() && fs.existsSync(path.join(dir, f, 'meta.json')))
      : [];
    if (!names.length) { console.log('还没有动态底板。用 plate 命令从静帧/视频生成。'); return; }
    names.sort().forEach((n) => {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, n, 'meta.json'), 'utf8'));
      console.log(`${n.padEnd(10)} ${String(meta.frames).padStart(3)} 帧 · ${meta.seconds}s · ${meta.fps}fps · 源 ${meta.source}`);
    });
    return;
  }

  if (cmd === 'local') {
    const L = await import('../src/local.mjs');
    const action = String(flags.action || (flags.prompt ? 'gen' : 'probe'));
    if (action === 'styles') {
      Object.keys(L.STYLE_NOTES).forEach((k) => console.log(`${k.padEnd(10)} ${L.STYLE_CKPT[k]}\n           ${L.STYLE_NOTES[k]}`));
      return;
    }
    if (action === 'probe') {
      const p = await L.probe(flags.base);
      if (!p.ok) { console.log('ComfyUI 没起来：' + p.reason); console.log(p.hint); process.exitCode = 2; return; }
      console.log(`ComfyUI 在线：${p.device}${p.vramGB ? ` / ${p.vramGB}GB` : ''} · ${p.base}`);
      return;
    }
    if (action === 'models') {
      const p = await L.probe(flags.base);
      if (p.ok) {
        try {
          const s = await L.listServerCheckpoints(p.base);
          console.log(`服务端底模 ${s.length} 个：`); s.forEach((n) => console.log('  ' + n));
        } catch (e) { console.log('读底模列表失败：' + e.message); }
      } else console.log('服务端：' + p.reason);
      const disk = L.scanDisk({ roots: ['D:\\', 'E:\\', 'C:\\'], maxDepth: 2 });
      console.log(`\n本机 .safetensors ${disk.length} 个：`);
      disk.forEach((d) => console.log(`  ${d.sizeGB.toString().padStart(5)}GB  ${d.name}`));
      return;
    }
    if (!flags.prompt) throw new Error('local --action gen 需要 --prompt');
    const outFile = path.resolve(flags.out || path.join('out', 'local', `${Date.now()}-${flags.style || 'gen'}.png`));
    const r = await L.txt2img({
      base: flags.base,
      ckpt: flags.ckpt,
      style: flags.style,
      positive: flags.prompt,
      negative: flags.negative || 'lowres, bad anatomy, bad hands, extra digits, watermark, text, signature, jpeg artifacts, blurry',
      width: num(flags.width) || 768,
      height: num(flags.height) || 1024,
      steps: num(flags.steps) || 28,
      seed: num(flags.seed) || 0,
      outFile,
    });
    if (!r.ok) { console.log('没出图：' + r.reason); if (r.hint) console.log(r.hint); if (r.available) console.log('服务端现有：' + r.available.join(' / ')); process.exitCode = 3; return; }
    console.log(`出图完成 ${r.seconds}s · ${r.ckpt} → ${r.file}`);
    return;
  }

  if (cmd === 'comments') {
    const C = await import('../src/comments.mjs');
    const action = String(flags.action || 'scan');
    if (action === 'calibrate') {
      const r = await C.calibrate(path.resolve('.'));
      console.log(r.hint);
      console.log('截图 ' + r.shot);
      console.log('样例 ' + JSON.stringify(r.sample.slice(0, 6), null, 2));
      return;
    }
    if (action === 'auth') {
      const r = await C.checkAuth(path.resolve('.'));
      console.log(r.ok ? `Cookie 可用：${r.uname}（mid ${r.mid}），读到 ${r.videos.length} 个稿件` : `Cookie 不可用：${r.error}`);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (action === 'auto') {
      const r = await C.autoReply(path.resolve('.'), {
        send: flags.send === 'true',
        maxPerRun: flags.max ? Number(flags.max) : undefined,
        fallback: flags.fallback,
        mode: flags.mode,
      });
      const via = r.via === 'api' ? '接口' : r.via === 'hybrid' ? '接口+回退' : '点按钮';
      if (r.ok === false) console.log('没发成：' + r.error);
      else console.log(r.send ? `已发送 ${r.sent} 条（走${via}）` : `预演：计划 ${r.planned} 条（走${via}）`);
      if (r.note) console.log(r.note);
      console.log(JSON.stringify(r.plan || r.results || r, null, 2));
      return;
    }
    if (action === 'watch') {
      const r = await C.watch(path.resolve('.'), {
        minutes: flags.minutes ? Number(flags.minutes) : undefined,
        intervalMinutes: flags.interval ? Number(flags.interval) : undefined,
        send: flags.send === 'true',
      });
      console.log(`挂机 ${r.minutes} 分钟，${r.rounds} 轮，回复 ${r.sent} 条`);
      return;
    }
    const r = await C.scan(path.resolve('.'), { saveShot: true });
    console.log(`读到 ${r.comments.length} 条评论：`);
    for (const c of r.comments) console.log('  · ' + c.text);
    console.log('「回复」入口 ' + r.anchors.replyLabels + ' 个；截图 ' + r.page.shot);
    return;
  }

  if (cmd === 'settings') {
    const S = await import('../src/settings.mjs');
    const action = String(flags.action || 'get');
    if (action === 'status') {
      const { runDoctor, renderDoctor } = await import('../src/doctor.mjs');
      const rep = await runDoctor(undefined, { online: Boolean(flags.online) });
      console.log(flags.json ? JSON.stringify(rep, null, 2) : renderDoctor(rep, { color: !flags['no-color'] }));
      return;
    }
    if (action === 'reset') {
      const next = S.saveSettings(path.resolve('.'), S.DEFAULTS);
      console.log('已恢复默认设置 → ' + next.__file);
      return;
    }
    if (action === 'set') {
      // settings set --mimo <key> --provider qwen --voice 冰糖
      const patch = {};
      if (flags.mimo || flags.qwen || flags.minimax || flags.github || flags.bili) {
        patch.keys = {
          ...(flags.mimo ? { mimo: String(flags.mimo) } : {}),
          ...(flags.qwen ? { dashscope: String(flags.qwen) } : {}),
          ...(flags.minimax ? { minimax: String(flags.minimax) } : {}),
          ...(flags.github ? { github: String(flags.github) } : {}),
          ...(flags.bili ? { bili: String(flags.bili) } : {}),
        };
      }
      if (flags.provider || flags.voice) patch.tts = { ...(flags.provider ? { provider: String(flags.provider) } : {}), ...(flags.voice ? { voice: String(flags.voice) } : {}) };
      if (flags['dry-run']) patch.publish = { dryRun: String(flags['dry-run']) !== 'false' };
      const next = S.saveSettings(path.resolve('.'), patch);
      console.log('已保存 → ' + next.__file);
    }
    const view = S.publicView({ ...S.loadSettings(path.resolve('.')), __file: S.loadSettings(path.resolve('.')).__file });
    console.log(JSON.stringify(view, null, 2));
    return;
  }

  if (cmd === 'schedule') {
    const S = await import('../src/settings.mjs');
    const SCH = await import('../src/scheduler.mjs');
    const action = String(flags.action || 'status');
    const patch = {};
    if (flags.at) patch.dailyAt = String(flags.at);
    for (const k of ['make', 'voice', 'publish', 'comments']) if (flags[k] !== undefined) patch[k] = String(flags[k]) !== 'false';
    if (Object.keys(patch).length) S.saveSettings(path.resolve('.'), { schedule: patch });
    if (action === 'enable') S.saveSettings(path.resolve('.'), { schedule: { enabled: true } });
    if (action === 'disable') S.saveSettings(path.resolve('.'), { schedule: { enabled: false } });
    if (action === 'run-now') {
      S.applyEnv(S.loadSettings(path.resolve('.')));
      const r = await SCH.runOnce(path.resolve('.'), { reason: 'cli', onLog: (m) => console.log('  ' + m) });
      console.log(r.ok ? `完成：${r.steps.length} 步` : `失败：${r.error}`);
      if (r.video) console.log('成片 ' + r.video);
      for (const w of r.warnings || []) console.log('  [warn] ' + w);
      return;
    }
    console.log(JSON.stringify(SCH.status(path.resolve('.')), null, 2));
    return;
  }

  if (cmd === 'update') {
    const U = await import('../src/update.mjs');
    const action = String(flags.action || 'check');
    if (action === 'auto') {
      const r = await U.autoUpdate(path.resolve('.'), { profile: flags.profile, repo: flags.repo });
      if (r.stage === 'up-to-date') { console.log(`已是最新版 ${r.current}，没有动作`); return; }
      if (!r.ok) { console.log(`自动更新没走完（${r.stage}）：${r.reason || ''}`); process.exitCode = 4; return; }
      const okList = (r.targets || []).filter((t) => t.ok).map((t) => t.profile);
      console.log(`已更新 ${r.current} → ${r.latest}，装到 ${okList.length} 个 profile：`);
      for (const p of okList) console.log('  · ' + p);
      for (const t of (r.targets || []).filter((x) => !x.ok)) console.log('  ✗ ' + t.profile + '：' + t.error);
      console.log('完全退出 Harness 再启动生效');
      return;
    }
    const c = await U.checkUpdate(path.resolve('.'), { repo: flags.repo });
    if (!c.ok) { console.log('查新失败：' + c.reason); if (c.hint) console.log(c.hint); process.exitCode = 4; return; }
    console.log(`本地 ${c.current} · 远端 ${c.latest}${c.hasUpdate ? '（有新版）' : '（已最新）'} · ${c.repo}`);
    if (c.release) console.log(`release ${c.release.tag} @ ${c.release.publishedAt}  ${c.release.url}`);
    if (!c.hasUpdate && action === 'check') return;
    if (!c.asset) { console.log('release 里没有 .tgz 资源'); return; }
    const d = await U.downloadUpdate(path.resolve('.'), c.asset);
    console.log(`已下载 ${d.file} ${(d.bytes / 1024 / 1024).toFixed(1)}MB sha256=${d.sha256.slice(0, 12)}…${d.digestOk === false ? '  ⚠ 与 release 记录不一致' : ''}`);
    if (action === 'apply') {
      if (!flags.profile) throw new Error('update --action apply 需要 --profile');
      const { execFileSync } = await import('node:child_process');
      execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.resolve('install.ps1'), '-Mode', 'tgz', '-PackagePath', d.file, '-ProfileRoot', path.resolve(flags.profile)], { stdio: 'inherit' });
      console.log('安装完成，退出 Harness 再启动生效');
      return;
    }
    console.log('装上它：powershell -ExecutionPolicy Bypass -File install.ps1 -Mode tgz -PackagePath "' + d.file + '" -ProfileRoot "<your profile>"');
    return;
  }

  if (cmd === 'motion') {
    const M = await import('../src/motion.mjs');
    const { findFfmpeg } = await import('../src/engine.mjs');
    const action = String(flags.action || (flags.from ? 'import' : flags.plate ? 'plate' : 'list'));
    if (action === 'import') {
      if (!flags.from) throw new Error('motion --action import 需要 --from <mp4>');
      if (!flags.character) throw new Error('motion --action import 需要 --character');
      const rec = M.importClip({ root: path.resolve('.'), from: path.resolve(flags.from), character: flags.character, name: flags.name, ffmpeg: findFfmpeg() });
      console.log(`已收进插件：${rec.key} · ${rec.seconds}s · ${rec.width || '?'}×${rec.height || '?'} · ${(rec.bytes / 1024 / 1024).toFixed(1)}MB`);
      return;
    }
    if (action === 'plate') {
      const { clips } = M.listClips(path.resolve('.'));
      const clip = flags.clip ? clips.find((c) => c.key === flags.clip) : clips.find((c) => c.character === flags.character);
      if (!clip) throw new Error('没找到短片，先 `motion` 看列表');
      const { buildPlateFrames } = await import('../src/plate.mjs');
      const name = flags.name || `${clip.key}-motion`;
      const dir = path.resolve(path.join('assets', 'plates', name));
      const meta = buildPlateFrames({ from: clip.file, dir, ffmpeg: findFfmpeg(), seconds: num(flags.seconds) || 8, width: num(flags.width) || 1080, height: num(flags.height) || 1920 });
      console.log(`底板 ${name}：${meta.frames} 帧 / ${meta.seconds}s → ${dir}`);
      return;
    }
    const { clips, missing } = M.listClips(path.resolve('.'));
    if (!clips.length) { console.log('还没有角色短片。用 motion --action import --from x.mp4 --character deepseek 收一条。'); return; }
    clips.forEach((c) => console.log(`${c.key.padEnd(14)} ${String(c.seconds || '?').padStart(5)}s ${c.width || '?'}×${c.height || '?'}  ${(c.bytes / 1024 / 1024).toFixed(1)}MB  ${c.note || ''}`));
    if (missing.length) console.log('还缺：' + missing.join(' / '));
    return;
  }

  if (cmd === 'plates') {
    const dir = path.resolve('assets', 'plates');
    const names = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory() && fs.existsSync(path.join(dir, f, 'meta.json')))
      : [];
    if (!names.length) { console.log('还没有动态底板。用 plate 命令从静帧/视频生成。'); return; }
    names.sort().forEach((n) => {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, n, 'meta.json'), 'utf8'));
      console.log(`${n.padEnd(10)} ${String(meta.frames).padStart(3)} 帧 · ${meta.seconds}s · ${meta.fps}fps · 源 ${meta.source}`);
    });
    return;
  }

  if (cmd === 'assets') {
    const a = auditAssets({ character: flags.character });
    console.log(a.ready ? `素材齐全：${a.haveCount} 个文件` : `缺 ${a.missing.length} 个素材`);
    a.missing.slice(0, 6).forEach(m => console.log(`  - ${m.file}\n    prompt: ${m.prompt}`));
    return;
  }

  if (cmd === 'publish') {
    if (!flags.video) throw new Error('缺少 --video');
    const { publish } = await import('../src/publish.mjs');
    const { loadScript, publishMeta } = await import('../src/script.mjs');
    let auto = null;
    try { auto = publishMeta(loadScript(flags.video.replace(/\.mp4$/, '.json'))); } catch { /* 没剧本就用参数 */ }
    const meta = {
      title: flags.title || auto?.title || '',
      desc: flags.desc || auto?.desc || '',
      tags: flags.tags ? String(flags.tags).split(',') : (auto?.tags || []),
    };
    const r = await publish({
      mode: flags.browser ? 'browser' : 'client',
      video: path.resolve(flags.video), title: meta.title, desc: meta.desc, tags: meta.tags,
      dryRun: flags['dry-run'] !== 'false',
    });
    console.log(r.message);
    if (r.needsLogin) process.exitCode = 2;
    return;
  }

  if (cmd === 'pick') {
    const p = await import('../src/pick.mjs');
    const r = p.pickMaterials({
      root: path.resolve('.'),
      character: flags.character || 'deepseek',
      template: flags.template || 'classic',
      mood: flags.mood || 'calm',
      style: flags.style || 'chibi',
    });
    console.log(`look=${r.look} plate=${r.plate || 'none'} background=${r.background}`);
    r.reason.forEach((s) => console.log('  · ' + s));
    if (flags.covers !== 'false') {
      p.pickCover(path.resolve('.'), flags.template || 'classic').slice(0, 5).forEach((c) => console.log('  封面候选 ' + c));
    }
    return;
  }

  if (cmd === 'post') {
    if (!flags.video) throw new Error('缺少 --video');
    const b = await import('../src/bili.mjs');
    const cfg = b.loadBiliConfig(path.resolve('.'));
    const video = path.resolve(flags.video);
    console.log('客户端：' + cfg.client.exe);
    const launched = await b.ensureClient(cfg);
    console.log(launched.launched ? '已启动客户端' : '客户端在运行');
    if (!flags['skip-open']) {
      const o = await b.openCreator(cfg);
      console.log(o.opened ? '已打开创作中心投稿页' : '复用已开的创作中心');
    }
    const up = await b.uploadVideo(cfg, video, cfg.client.creatorWindow);
    console.log(`已选视频 ${up.sizeMb}MB，等待 ${Math.round(up.waitMs / 1000)}s`);
    const filled = await b.fillForm(cfg, cfg.client.creatorWindow, {
      title: flags.title,
      statement: flags.statement || '自制',
      tags: flags.tags ? String(flags.tags).split(',').map((s) => s.trim()).filter(Boolean) : [],
      coverPath: flags.cover ? path.resolve(flags.cover) : undefined,
      desc: flags.desc,
    });
    filled.notes.forEach((n) => console.log('  ! ' + n));
    console.log('表单截图：' + filled.shot);
    const sub = await b.submit(cfg, cfg.client.creatorWindow, Boolean(flags.confirm));
    console.log(sub.clicked ? '已点「立即投稿」，截图：' + sub.shot : `停在「立即投稿」前（位置 ${sub.at.join(',')}），截图：${sub.shot}`);
    return;
  }

  if (cmd === 'comments') {
    const b = await import('../src/bili.mjs');
    const cfg = b.loadBiliConfig(path.resolve('.'));
    await b.ensureClient(cfg);
    const page = await b.openComments(cfg);
    console.log('评论管理页截图：' + page.shot);
    console.log('读这张图，按坐标用 pc_act / node bin/ai-diary.mjs 的 pc 子命令回复');
    return;
  }

  if (cmd === 'pc') {
    const { runEngine } = await import('../src/pc.mjs');
    const sub = flags.see ? 'see' : flags.act ? 'act' : null;
    if (!sub) throw new Error('pc 子命令：--see windows|tree|find|shot 或 --act "focus xx" "click 100 200"');
    if (sub === 'see') {
      const { shotsDir } = await import('../src/pc.mjs');
      const payload = { op: 'see', what: flags.see, window: flags.window || '', query: flags.query || '', width: 1280, grid: Boolean(flags.grid), options: { timeoutMs: 45000 } };
      if (flags.see === 'shot') {
        fs.mkdirSync(shotsDir(), { recursive: true });
        payload.out = path.join(shotsDir(), 'cli-' + Date.now() + '.png');
      }
      const r = await runEngine(payload, { timeoutMs: 45000 });
      if (payload.out && r.image) console.log('截图：' + r.image.path + `（${r.image.width}x${r.image.height} scale=${r.image.scale}）`);
      else console.log((r.lines || []).join('\n') || r.error);
      return;
    }
    const r = await runEngine({ op: 'act', actions: flags.act.length ? flags.act : [], dryRun: Boolean(flags['dry-run']), options: { timeoutMs: 45000, maxActions: 24, failsafe: true } }, { timeoutMs: 45000 });
    console.log((r.lines || []).join('\n') || r.error);
    return;
  }

  throw new Error('未知命令：' + cmd);
}

main().catch(e => { console.error('出错：' + e.message); process.exitCode = 1; });
