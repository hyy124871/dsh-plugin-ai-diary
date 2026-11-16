// 两个桌面工具：pc_see（文本优先地看）与 pc_act（一次调用多步动作）。
// 省 token 的设计照搬 dsh-pc-control：动作合并成一条字符串、默认只出文本、截图按需。
import path from 'node:path';
import { existsSync } from 'node:fs';
import { runEngine, pruneShots, shotsDir, readShot, stopFilePath } from './pc.mjs';

export function createPcTools({ defineTool, out, outputDef, cfg }) {
  const engineOpts = () => ({ timeoutMs: cfg.timeoutMs || 30000, maxActions: cfg.maxActions || 24, failsafe: cfg.failsafe !== false, allowWinKeys: false });

  async function saveShot(ctx, image) {
    try {
      const attachments = typeof ctx?.get === 'function' ? ctx.get('attachments') : undefined;
      if (!attachments || typeof attachments.saveImage !== 'function') return { ref: null, why: '当前部署没有附件服务，图在磁盘：' + image.path };
      const ref = await attachments.saveImage({ data: await readShot(image), mediaType: 'image/png', name: 'pc-shot.png' });
      return { ref: ref && typeof ref.attachmentId === 'string' ? ref : null, why: '附件服务返回异常' };
    } catch (e) {
      return { ref: null, why: '保存截图失败：' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  function seeTool() {
    return defineTool({
      name: 'pc_see',
      description:
        '看桌面，文本优先几乎不耗视觉 token。what=windows 列窗口；tree 列指定窗口的控件与真实像素坐标；find 按名字找控件；' +
        'shot 才出图（最贵，Electron 页面只能这样看）。坐标拿来喂 pc_act。',
      parameters: {
        what: { type: 'string', enum: ['windows', 'tree', 'find', 'shot'], description: '看什么', required: true },
        window: { type: 'string', description: '窗口标题片段；省略=当前活动窗口（windows 时可当过滤词）' },
        query: { type: 'string', description: 'find 的控件名/automationId 片段' },
        limit: { type: 'integer', description: '最多返回几条（windows 40 / tree 60 / find 20）' },
        width: { type: 'integer', description: 'shot 宽度，默认 1024；0=原始分辨率' },
        grid: { type: 'boolean', description: 'shot 叠加真实坐标网格' },
      },
      output: outputDef(),
      async execute(args, exec) {
        const what = String(args.what || 'windows');
        const payload = {
          op: 'see', what,
          window: args.window || '',
          query: args.query || '',
          limit: Number(args.limit) || 0,
          width: Number(args.width) || 0,
          grid: Boolean(args.grid),
          options: engineOpts(),
        };
        if (what === 'shot') {
          payload.out = path.join(shotsDir(), 'shot-' + Date.now() + '.png');
          void pruneShots(cfg.shotTtlMinutes || 30);
        }
        let r;
        try {
          r = await runEngine(payload, engineOpts());
        } catch (e) {
          return out('失败', { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        if (!r.ok) return out('失败', { ok: false, error: r.error || 'unknown' });
        const lines = Array.isArray(r.lines) ? r.lines : [];
        if (what === 'shot') {
          if (!r.image) return out('截图失败', { ok: false, error: '引擎没有返回图片' });
          const saved = await saveShot(exec, r.image);
          return out(`截图 ${r.image.width}x${r.image.height}`, {
            ok: true, image: r.image.path, scale: r.image.scale, origin: r.image.origin,
            tie: '真实坐标 = 图上像素 × scale + origin', ...(saved.ref ? { attachment: saved.ref.attachmentId } : { why: saved.why }),
          });
        }
        return out(`${lines.length} 条`, { ok: true, what, lines });
      },
    });
  }

  function actTool() {
    return defineTool({
      name: 'pc_act',
      description:
        '批量操作鼠标键盘，一次调用按顺序跑完多条动作（省往返）。动作串：move x y｜click [x y] [right] [n]｜dclick [x y]｜' +
        'drag x1 y1 x2 y2｜scroll 档数 [x y]｜type 文本｜paste 文本｜key ctrl+s｜focus 标题片段｜hit "控件名"（UIA 语义点击）｜' +
        'wait 秒｜stop｜resume。坐标从 pc_see 来。dryRun=true 只预演。',
      parameters: {
        actions: { type: 'array', items: { type: 'string' }, required: true, description: `动作串数组，最多 ${cfg.maxActions || 24} 条` },
        dryRun: { type: 'boolean', description: 'true=只回报将要做什么' },
      },
      output: outputDef(),
      isConcurrencySafe: () => false,
      async execute(args) {
        const raw = Array.isArray(args.actions) ? args.actions.map(String) : [];
        if (!raw.length) return out('失败', { ok: false, error: 'actions 不能为空' });
        const limit = cfg.maxActions || 24;
        if (raw.length > limit) return out('失败', { ok: false, error: `一次最多 ${limit} 步，这次 ${raw.length} 步` });
        if (existsSync(stopFilePath()) && !raw.some((a) => /^\s*resume\b/i.test(a))) {
          return out('冻结中', { ok: false, error: '急停文件存在，先 resume 或删掉 ' + stopFilePath() });
        }
        let r;
        try {
          r = await runEngine({ op: 'act', actions: raw, dryRun: Boolean(args.dryRun), options: engineOpts() }, engineOpts());
        } catch (e) {
          return out('失败', { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        if (!r.ok) return out('动作中断', { ok: false, error: r.error, lines: r.lines || [] });
        return out(args.dryRun ? `预演 ${(r.lines || []).length} 步` : `完成 ${(r.lines || []).length} 步`, { ok: true, lines: r.lines || [] });
      },
    });
  }

  return [seeTool(), actTool()];
}
