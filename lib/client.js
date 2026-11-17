/**
 * dsh-plugin-ai-diary 客户端半（零构建，浏览器可加载）
 *
 * 为什么需要它：Harness 的 settings wire 只服务一份硬编码的命名空间白名单，
 * 第三方插件的命名空间不在里面 —— 所以官方设置面板永远看不到本插件的配置项。
 * 解法与 dsh-plugin-memory 一致：插件自己注册 `settings.section` 槽位，直连
 * 插件自建的 HTTP 路由 /api/ai-diary/config（GET 读 / POST 写或触发查新）。
 *
 * 面板内容：版本与更新状态、自动更新两个开关、成片规格（超采样/帧率/并行线程），
 * 以及「查新」「立即更新」两个按钮。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-ai-diary',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var CONFIG_URL = '/api/ai-diary/config'
    var NS = 'ai-diary'

    var S = {
      card: {
        border: '1px solid rgba(128,128,128,0.18)',
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 12,
        fontSize: 13,
      },
      head: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 },
      title: { fontSize: 14, fontWeight: 600 },
      ver: { fontSize: 11, opacity: 0.6 },
      sub: { fontSize: 11, opacity: 0.6, marginBottom: 10, lineHeight: 1.6 },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '9px 0',
        borderTop: '1px solid rgba(128,128,128,0.12)',
      },
      label: { fontSize: 13 },
      hint: { fontSize: 11, opacity: 0.55, marginTop: 3, lineHeight: 1.5 },
      num: {
        width: 84,
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.28)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 13,
        textAlign: 'right',
      },
      btn: {
        padding: '6px 12px',
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.3)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
      },
      btnMain: {
        padding: '6px 14px',
        borderRadius: 6,
        border: '1px solid rgba(127,224,207,0.5)',
        background: 'rgba(127,224,207,0.14)',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
      },
      note: { fontSize: 11, opacity: 0.7, marginTop: 8, lineHeight: 1.6, whiteSpace: 'pre-wrap' },
      missing: { fontSize: 12, opacity: 0.6 },
      sel: {
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid rgba(128,128,128,0.28)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 13,
      },
      seg: { display: 'inline-flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(128,128,128,0.28)' },
      segOn: { padding: '5px 12px', background: 'rgba(127,224,207,0.18)', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      segOff: { padding: '5px 12px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12, opacity: 0.65 },
    }

    function getJson(url, body) {
      var opt = body
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET' }
      return fetch(url, opt).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status)
          return j
        })
      })
    }

    function statusLine(cfg) {
      var st = (cfg && cfg.state) || {}
      var local = (cfg && cfg.version) || '—'
      var remote = st.latest || '—'
      if (st.hasUpdate) return '本地 ' + local + ' · 远端 ' + remote + '（有新版本）'
      if (st.ok === false) return '本地 ' + local + ' · 查新失败：' + (st.reason || '未知')
      return '本地 ' + local + ' · 远端 ' + remote + '（已最新）'
    }

    function AiDiarySection() {
      var loaded = React.useState(false)
      var cfg = loaded[0]
      var setCfg = loaded[1]
      var busyState = React.useState('')
      var busy = busyState[0]
      var setBusy = busyState[1]
      var noteState = React.useState('')
      var note = noteState[0]
      var setNote = noteState[1]

      React.useEffect(function () {
        var alive = true
        getJson(CONFIG_URL)
          .then(function (j) {
            if (alive) {
              setCfg(j)
              setNote('')
            }
          })
          .catch(function (e) {
            if (alive) setNote('读取失败：' + ((e && e.message) || e))
          })
        return function () {
          alive = false
        }
      }, [])

      function patch(obj, doneMsg) {
        setBusy('save')
        getJson(CONFIG_URL, { patch: obj })
          .then(function (j) {
            setCfg(j)
            setNote(doneMsg || '已保存')
          })
          .catch(function (e) {
            setNote('保存失败：' + ((e && e.message) || e))
          })
          .then(function () {
            setBusy('')
          })
      }

      function act(action) {
        setBusy(action)
        setNote(action === 'check' ? '正在查新…' : '正在下载并安装，约 1 分钟…')
        getJson(CONFIG_URL, { action: action })
          .then(function (j) {
            setCfg(j)
            if (action === 'check') {
              var c = j.check || {}
              setNote(c.hasUpdate ? '有新版本：' + c.current + ' → ' + c.latest : '已是最新（' + (c.current || j.version) + '）')
            } else {
              setNote(
                j.ok
                  ? '已装好 ' + (j.state && j.state.installedVersion ? j.state.installedVersion : j.latest) + '，完全退出 Harness 再启动生效'
                  : '自动更新没走完（' + (j.stage || '') + '）',
              )
            }
          })
          .catch(function (e) {
            setNote('操作失败：' + ((e && e.message) || e))
          })
          .then(function () {
            setBusy('')
          })
      }

      var upd = (cfg && cfg.update) || {}
      var ren = (cfg && cfg.render) || {}
      var vid = (cfg && cfg.video) || {}
      var img = (cfg && cfg.image) || {}
      var keys = (cfg && cfg.keys) || {}

      return h(
        'div',
        { style: S.card, 'data-dsh-ai-diary': 'section' },
        h('div', { style: S.head }, h('span', { style: S.title }, 'AI 日记工坊'), h('span', { style: S.ver }, 'v' + ((cfg && cfg.version) || '…'))),
        h('div', { style: S.sub }, '选题 → 剧本 → 1080p 渲染 → 配音 → 底板 → B 站投稿 → 评论回复。下方设置存在 ~/.ai-diary/settings.json。'),
        h('div', { style: { fontSize: 12, opacity: 0.8, marginBottom: 6 } }, cfg ? statusLine(cfg) : '读取中…'),

        // 自动更新
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, '启动时自动查新'),
            h('div', { style: S.hint }, '启动 8 秒后静默比对 GitHub Release，结果写进体检面板'),
          ),
          h('input', {
            type: 'checkbox',
            checked: upd.autoCheck !== false,
            disabled: busy !== '',
            onChange: function (e) {
              patch({ update: { autoCheck: e.target.checked } }, e.target.checked ? '已打开自动查新' : '已关闭自动查新')
            },
          }),
        ),
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, '查到新版自动安装'),
            h('div', { style: S.hint }, '自动下载 tgz、改依赖、跑 pnpm 装进本机 profile；装完要重启 Harness'),
          ),
          h('input', {
            type: 'checkbox',
            checked: upd.autoInstall !== false,
            disabled: busy !== '',
            onChange: function (e) {
              patch({ update: { autoInstall: e.target.checked } }, e.target.checked ? '已打开自动安装' : '已关闭自动安装（只查不装）')
            },
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, paddingTop: 10 } },
          h(
            'button',
            {
              style: S.btn,
              disabled: busy !== '',
              onClick: function () {
                act('check')
              },
            },
            busy === 'check' ? '查新中…' : '查新',
          ),
          h(
            'button',
            {
              style: S.btnMain,
              disabled: busy !== '',
              onClick: function () {
                act('update')
              },
            },
            busy === 'update' ? '安装中…' : '立即更新',
          ),
        ),

        // 算力：CPU / GPU / 自动
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, '渲染算力'),
            h('div', { style: S.hint }, 'CPU = 纯处理器（libx264，画质最好）；GPU = 显卡硬件编码（NVENC / QSV / AMF，快数倍）；自动 = 有显卡就用显卡'),
          ),
          h(
            'div',
            { style: S.seg },
            ['cpu', 'gpu', 'auto'].map(function (k) {
              var cur = String(ren.accelerator || 'auto').toLowerCase()
              return h(
                'button',
                {
                  key: k,
                  style: cur === k ? S.segOn : S.segOff,
                  disabled: busy !== '',
                  onClick: function () {
                    var names = { cpu: 'CPU（libx264）', gpu: 'GPU（硬件编码）', auto: '自动（有显卡就用）' }
                    patch({ render: { accelerator: k } }, '渲染算力已切到 ' + names[k])
                  },
                },
                k === 'cpu' ? 'CPU' : k === 'gpu' ? 'GPU' : '自动',
              )
            }),
          ),
        ),

        // 成片规格
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, '超采样倍数'),
            h('div', { style: S.hint }, '1.5 = 1080×1920（推荐）；1 = 720p；2 = 1440×2560（更慢更清）'),
          ),
          h('input', {
            style: S.num,
            type: 'number',
            step: '0.5',
            min: '1',
            max: '3',
            value: ren.scale == null ? 1.5 : ren.scale,
            disabled: busy !== '',
            onChange: function (e) {
              var v = Number(e.target.value)
              if (v >= 1 && v <= 3) patch({ render: { scale: v } }, '超采样已改为 ' + v + '×')
            },
          }),
        ),
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, '帧率'),
            h('div', { style: S.hint }, '24 是 B 站竖屏常规值；30 更顺但渲染更久'),
          ),
          h('input', {
            style: S.num,
            type: 'number',
            step: '1',
            min: '12',
            max: '60',
            value: ren.fps == null ? 24 : ren.fps,
            disabled: busy !== '',
            onChange: function (e) {
              var v = Number(e.target.value)
              if (v >= 12 && v <= 60) patch({ render: { fps: v } }, '帧率已改为 ' + v)
            },
          }),
        ),
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, '并行渲染线程'),
            h('div', { style: S.hint }, '按 CPU 核数分段并行，0 = 自动（最多 4 段）'),
          ),
          h('input', {
            style: S.num,
            type: 'number',
            step: '1',
            min: '0',
            max: '16',
            value: ren.workers == null ? 0 : ren.workers,
            disabled: busy !== '',
            onChange: function (e) {
              var v = Number(e.target.value)
              if (v >= 0 && v <= 16) patch({ render: { workers: v } }, v === 0 ? '并行渲染：自动' : '并行渲染：' + v + ' 段')
            },
          }),
        ),

        // H3 视频档位 + Seedream 图片型号
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, 'H3 视频档位'),
            h('div', { style: S.hint }, 'H3 = 768P/2K 画质优先｜Highspeed = 兼顾速度｜Lite = 最便宜｜Max = 图文音多素材｜Regeneration = 已有 768P 升 2K'),
          ),
          h(
            'select',
            {
              style: S.sel,
              value: vid.model || 'MiniMax-H3-Highspeed',
              disabled: busy !== '',
              onChange: function (e) {
                patch({ video: { model: e.target.value } }, 'H3 档位：' + e.target.value)
              },
            },
            ['MiniMax-H3', 'MiniMax-H3-Highspeed', 'MiniMax-H3-Lite', 'MiniMax-H3-Max', 'MiniMax-H3-Regeneration'].map(function (m) {
              return h('option', { key: m, value: m }, m)
            }),
          ),
        ),
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, 'H3 默认分辨率'),
            h('div', { style: S.hint }, 'H3 支持 768P / 2K；Highspeed、Lite、Max 支持 480P / 768P；Regeneration 固定 2K'),
          ),
          h(
            'select',
            {
              style: S.sel,
              value: vid.resolution || '768P',
              disabled: busy !== '',
              onChange: function (e) {
                patch({ video: { resolution: e.target.value } }, 'H3 分辨率：' + e.target.value)
              },
            },
            ['480P', '768P', '2K'].map(function (r) {
              return h('option', { key: r, value: r }, r)
            }),
          ),
        ),
        h(
          'div',
          { style: S.row },
          h(
            'div',
            null,
            h('div', { style: S.label }, 'Seedream 出图型号'),
            h('div', { style: S.hint }, 'seedream-4.0 支持参考图（角色一致性靠它）；尺寸 2K 默认。需要 ARK key：' + (keys.ark && keys.ark.ready ? '已就绪（' + (keys.ark.source === 'env' ? '环境变量' : '设置文件') + '）' : '未配置')),
          ),
          h(
            'select',
            {
              style: S.sel,
              value: img.model || 'seedream-4.0',
              disabled: busy !== '',
              onChange: function (e) {
                patch({ image: { model: e.target.value } }, '图片型号：' + e.target.value)
              },
            },
            ['seedream-4.0', 'seedream-3.0'].map(function (m) {
              return h('option', { key: m, value: m }, m)
            }),
          ),
        ),

        note ? h('div', { style: S.note }, note) : null,
      )
    }

    function apply(ctx) {
      try {
        // 用 ctx.effect 包一层：宿主插件重载时会自动 dispose 上一次注册，避免重复挂载。
        ctx.effect(function () {
          return ctx.slots.inject('settings.section', function () {
            return ctx.slots.register(
              {
                name: 'settings.section',
                id: 'ai-diary-settings',
                order: 90,
                label: function () {
                  return 'AI 日记工坊'
                },
              },
              AiDiarySection,
            )
          })
        })
      } catch (e) {
        /* 宿主没有 settings.section 槽位：不显示面板，工具与 CLI 照常可用 */
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.__test = { AiDiarySection: AiDiarySection, statusLine: statusLine, CONFIG_URL: CONFIG_URL, NS: NS }
    return module.exports
  },
})
