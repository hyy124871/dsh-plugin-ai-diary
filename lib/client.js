/**
 * dsh-plugin-ai-diary 客户端半（零构建，浏览器可加载）
 *
 * 三处注册，全部按官方 @deepseek-ai/dsh-client-ui-settings-plugins 与 ui-sidebar 的契约写：
 *   1. settings.section —— 设置页左侧导航里的「AI 日记工坊」整页（locale 命名空间 + inject 面）
 *   2. sidebar.panellist —— 主界面左侧栏「插件 / 自动化任务 / 更多」那一组里的入口
 *   3. main（keyed）—— 点开入口后中间主面板里显示的工坊首页，可以直接一键出片
 *
 * 数据通道：官方 settings wire 只服务硬编码白名单，第三方命名空间读不到，所以自己开
 * HTTP 路由 /api/ai-diary/config（GET 读、POST 写 patch / 触发查新 / 更新 / 出片）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-ai-diary',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var CONFIG_URL = '/api/ai-diary/config'
    var NS = 'ai-diary'
    var BRAND = '#4d6bfe'
    var MUTED = 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.78))'
    var LINE = 'var(--dsw-alias-border-l3, rgba(128,128,128,0.22))'
    var LINE_SOFT = 'var(--dsw-alias-border-l2, rgba(128,128,128,0.12))'
    var SURFACE = 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08))'

    var DICT = {
      zh: {
        nav: 'AI 日记工坊',
        sideNav: 'AI 日记工坊',
        title: 'AI 日记工坊',
        intro: '选题 → 剧本 → 1080p 渲染 → 配音 → 动态底板 → 投稿 → 评论回复',
        run: '立即出片',
        running: '出片中…',
      },
      en: {
        nav: 'AI Diary Workshop',
        sideNav: 'AI Diary Workshop',
        title: 'AI Diary Workshop',
        intro: 'Topics → script → 1080p render → voice → plates → upload → reply',
        run: 'Produce now',
        running: 'Rendering…',
      },
    }

    var S = {
      page: { maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14 },
      head: { display: 'flex', alignItems: 'center', gap: 10 },
      mark: { width: 30, height: 30, borderRadius: 8, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
      h1: { fontSize: 17, fontWeight: 600, margin: 0 },
      ver: { fontSize: 11, padding: '1px 8px', borderRadius: 999, border: '1px solid ' + LINE, color: MUTED, lineHeight: '16px' },
      intro: { fontSize: 12.5, lineHeight: 1.7, color: MUTED, margin: '2px 0 0' },
      status: { fontSize: 12, padding: '8px 12px', borderRadius: 9, background: SURFACE, lineHeight: 1.6 },
      card: {
        border: '1px solid ' + LINE,
        borderRadius: 13,
        padding: '13px 16px 15px',
        display: 'flex',
        flexDirection: 'column',
      },
      cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
      cardTitle: { fontSize: 13, fontWeight: 600 },
      cardSub: { fontSize: 11.5, color: MUTED },
      row: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid ' + LINE_SOFT },
      rowFirst: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '2px 0 8px' },
      rowText: { flex: '1 1 200px', minWidth: 0 },
      label: { fontSize: 13, lineHeight: 1.5 },
      hint: { fontSize: 11.5, lineHeight: 1.6, marginTop: 2, color: MUTED },
      ctl: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
      num: {
        width: 78,
        padding: '4px 8px',
        borderRadius: 7,
        border: '1px solid ' + LINE,
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        textAlign: 'right',
        flexShrink: 0,
      },
      sel: {
        maxWidth: 220,
        padding: '5px 8px',
        borderRadius: 7,
        border: '1px solid ' + LINE,
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        flexShrink: 0,
      },
      seg: { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid ' + LINE, flexShrink: 0 },
      segOn: { padding: '5px 13px', background: 'rgba(77,107,254,0.16)', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12.5, fontWeight: 500 },
      segOff: { padding: '5px 13px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12.5, color: MUTED },
      btn: {
        padding: '6px 13px',
        borderRadius: 8,
        border: '1px solid ' + LINE,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12.5,
        flexShrink: 0,
      },
      btnMain: {
        padding: '7px 16px',
        borderRadius: 8,
        border: '1px solid rgba(77,107,254,0.55)',
        background: 'rgba(77,107,254,0.14)',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12.5,
        fontWeight: 600,
        flexShrink: 0,
      },
      input: {
        flex: '1 1 170px',
        minWidth: 130,
        padding: '5px 9px',
        borderRadius: 7,
        border: '1px solid ' + LINE,
        background: 'transparent',
        color: 'inherit',
        fontSize: 12,
        fontFamily: 'var(--ds-font-family-code, monospace)',
      },
      dot: { width: 7, height: 7, borderRadius: 4, flex: 'none', display: 'inline-block' },
      keyHead: { display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 150px', minWidth: 0 },
      keyName: { fontSize: 12.5 },
      keyNote: { fontSize: 11, color: MUTED, marginTop: 2 },
      note: { fontSize: 11.5, lineHeight: 1.6, marginTop: 8, color: MUTED, whiteSpace: 'pre-wrap' },
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

    /** 动作的中文名，失败提示里用 */
    var ACTION_LABEL = {
      produce: '出片',
      publishNow: '发布',
      refreshComments: '刷新评论',
      addAsset: '导入素材',
      removeFilm: '移除成片',
      planPreview: '预览选题',
      check: '查新',
    }

    /** 2026-11-17 20:30 这种；也吃 unix 秒（B 站 ctime 就是秒） */
    function formatWhen(v) {
      if (!v) return ''
      var d
      if (typeof v === 'number' || /^\d+$/.test(String(v))) {
        var n = Number(v)
        d = new Date(n > 1e12 ? n : n * 1000)
      } else {
        d = new Date(v)
      }
      if (isNaN(d.getTime())) return String(v)
      function p(x) {
        return (x < 10 ? '0' : '') + x
      }
      return (
        d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
      )
    }

    function formatBytes(n) {
      var v = Number(n || 0)
      if (!v) return ''
      var u = ['B', 'KB', 'MB', 'GB']
      var i = 0
      while (v >= 1024 && i < u.length - 1) {
        v /= 1024
        i += 1
      }
      return v.toFixed(i ? 1 : 0) + ' ' + u[i]
    }

    function statusLine(cfg) {
      var st = (cfg && cfg.state) || {}
      var local = (cfg && cfg.version) || '—'
      // 缓存与本地实际版本对不上时服务端会给 stale，此时不能拿它当“远端最新”
      var remote = st.latest || '—'
      if (st.stale) return '本地 ' + local + ' · 尚未查新（上次结果已过期，点「检查更新」）'
      if (st.hasUpdate) return '本地 ' + local + ' · 远端 ' + remote + '（有新版本）'
      if (st.ok === false) return '本地 ' + local + ' · 查新失败：' + (st.reason || '未知')
      return '本地 ' + local + ' · 远端 ' + remote + '（已最新）'
    }

    /** 卡片：统一的分区外观，避免每处重复写边框和标题样式 */
    function Card(props) {
      return h(
        'section',
        { style: S.card },
        h(
          'div',
          { style: S.cardHead },
          h('span', { style: S.cardTitle }, props.title),
          props.sub ? h('span', { style: S.cardSub }, props.sub) : null,
        ),
        props.children,
      )
    }

    /** 一行设置：左文本可换行、右控件永不收缩 —— 之前「自动」被挤出可见区就是少了 flexShrink */
    function Row(props) {
      return h(
        'div',
        { style: props.first ? S.rowFirst : S.row },
        h(
          'div',
          { style: S.rowText },
          h('div', { style: S.label }, props.label),
          props.hint ? h('div', { style: S.hint }, props.hint) : null,
        ),
        h('div', { style: S.ctl }, props.children),
      )
    }

    function Mark(props) {
      var size = props.size || 30
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', style: S.mark, 'aria-hidden': 'true' },
        h('rect', { x: 0.5, y: 0.5, width: 23, height: 23, rx: 6, fill: BRAND, opacity: 0.14 }),
        h('rect', { x: 1.5, y: 1.5, width: 21, height: 21, rx: 5.5, fill: BRAND, opacity: 0.92 }),
        h('rect', { x: 5.5, y: 6.2, width: 9, height: 1.9, rx: 0.95, fill: '#fff', opacity: 0.95 }),
        h('rect', { x: 5.5, y: 9.6, width: 6.4, height: 1.9, rx: 0.95, fill: '#fff', opacity: 0.55 }),
        h('path', { d: 'M13.4 14.6 L18.6 17 L13.4 19.4 Z', fill: '#fff' }),
      )
    }

    /** 单条 API Key：状态点 + 掩码提示 + 输入框 + 保存 */
    function KeyRow(props) {
      var entry = props.entry || {}
      var draft = React.useState('')
      var val = draft[0]
      var setVal = draft[1]
      var ready = Boolean(entry.ready)
      var source = entry.source === 'env' ? '环境变量' : entry.source === 'file' ? '已保存' : '未配置'
      return h(
        'div',
        { style: S.row },
        h(
          'div',
          { style: S.rowText },
          h(
            'div',
            { style: S.keyHead },
            h('span', { style: Object.assign({}, S.dot, { background: ready ? '#3ecf8e' : '#d0d0d0' }) }),
            h('span', { style: S.keyName }, props.label),
            h('span', { style: S.hint }, ready ? source : '未配置'),
          ),
          h('div', { style: S.keyNote }, entry.ready && entry.preview ? entry.preview : props.hint),
        ),
        h('input', {
          style: S.input,
          type: 'password',
          placeholder: ready ? '已配置，填新值可覆盖' : props.placeholder || '粘贴后点保存',
          value: val,
          disabled: props.disabled || entry.source === 'env',
          onChange: function (e) {
            setVal(e.target.value)
          },
        }),
        h(
          'button',
          {
            style: S.btn,
            disabled: props.disabled || entry.source === 'env' || val === '',
            onClick: function () {
              props.onSave(val)
              setVal('')
            },
          },
          '保存',
        ),
      )
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
            if (!alive) return
            setCfg(j)
            setNote('')
            // 缓存过期就静默查一次新，免得面板拿旧结果当“远端最新”（每 10 分钟最多一次）
            var st = (j && j.state) || {}
            if (st.stale || st.ok === undefined) silentCheck()
          })
          .catch(function (e) {
            if (alive) setNote('读取失败：' + ((e && e.message) || e))
          })
        return function () {
          alive = false
        }
      }, [])

      /** 打开面板时静默查新：拿到真实的远端版本，失败也不打扰用户 */
      function silentCheck() {
        try {
          var last = Number(window.sessionStorage.getItem('aiDiaryCheckedAt') || 0)
          if (Date.now() - last < 10 * 60 * 1000) return
          window.sessionStorage.setItem('aiDiaryCheckedAt', String(Date.now()))
        } catch (e) {}
        getJson(CONFIG_URL, { action: 'check' }).then(function (j) {
          setCfg(j)
          var c = j.check || {}
          if (c.ok === false) setNote('查新失败：' + (c.reason || '未知'))
        }).catch(function () {})
      }

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

      // 更新是后台跑的：这里只轮询 update-state.json 里的 stage，不再干等一个长请求
      function pollUpdate(tries) {
        var n = tries || 0
        setTimeout(function () {
          getJson(CONFIG_URL)
            .then(function (j) {
              setCfg(j)
              var st = (j && j.state) || {}
              var stage = String(st.stage || '')
              if (stage === 'installed' || stage === 'up-to-date') {
                setBusy('')
                setNote('已装好 ' + (st.installedVersion || st.latest || '') + '，完全退出 Harness 再启动生效')
                return
              }
              if (stage === 'failed' || stage === 'install-failed') {
                setBusy('')
                setNote('更新失败：' + (st.error || '未知原因'))
                return
              }
              var label = { starting: '准备中', download: '下载中', 'download-done': '下载完成', install: '安装中' }[stage] || '处理中'
              var mode = st.mode ? ' · ' + ({ delta: '增量包', code: '代码包', full: '完整包' }[st.mode] || st.mode) : ''
              var how = st.via ? ' · ' + st.via : ''
              setNote(label + '…' + mode + how)
              if (n < 420) pollUpdate(n + 1)
              else {
                setBusy('')
                setNote('仍在后台跑，过一会回来看状态')
              }
            })
            .catch(function () {
              if (n < 420) pollUpdate(n + 1)
              else setBusy('')
            })
        }, 2000)
      }

      function act(action) {
        setBusy(action)
        if (action === 'check') setNote('正在查新…')
        else if (action === 'update') setNote('已开始下载安装，最多几分钟；装完提示重启')
        else setNote('已交给后台，正在选题并渲染…')
        getJson(CONFIG_URL, { action: action })
          .then(function (j) {
            setCfg(j)
            if (action === 'check') {
              var c = j.check || {}
              setNote(c.hasUpdate ? '有新版本：' + c.current + ' → ' + c.latest : '已是最新（' + (c.current || j.version) + '）')
              setBusy('')
            } else if (action === 'update') {
              pollUpdate(0)
            } else {
              setNote('已开始出片：选题 → 剧本 → 渲染 → 配音，通常 2–5 分钟；成片在 ~\\.ai-diary\\out')
              setBusy('')
            }
          })
          .catch(function (e) {
            setNote('操作失败：' + ((e && e.message) || e))
            setBusy('')
          })
      }

      var upd = (cfg && cfg.update) || {}
      var ren = (cfg && cfg.render) || {}
      var vid = (cfg && cfg.video) || {}
      var img = (cfg && cfg.image) || {}
      var keys = (cfg && cfg.keys) || {}
      var accel = String(ren.accelerator || 'auto').toLowerCase()
      var accelNames = { cpu: 'CPU（libx264）', gpu: 'GPU（硬件编码）', auto: '自动（有显卡就用）' }
      var keyLabels = {
        mimo: { name: '小米 MiMo', hint: '希捷/雷军系 TTS，音色稳、便宜' },
        dashscope: { name: '阿里千问 DashScope', hint: 'Qwen-TTS，多音色可选' },
        deepseek: { name: 'DeepSeek', hint: '写台词用，deepseek-chat / deepseek-reasoner' },
        minimax: { name: 'MiniMax', hint: 'T2A 配音 + H3 视频共用' },
        ark: { name: '火山方舟 ARK', hint: 'Seedream 出图必填' },
        bili: { name: 'B 站 Cookie', hint: 'SESSDATA=…; bili_jct=…; buvid3=…' },
        github: { name: 'GitHub Token', hint: '拉 Release 查新与自更新' },
      }
      var keyOrder = ['mimo', 'dashscope', 'deepseek', 'minimax', 'ark', 'bili', 'github']

      return h(
        'div',
        { style: S.page, 'data-dsh-ai-diary': 'section' },

        // 头部
        h(
          'div',
          null,
          h(
            'div',
            { style: S.head },
            h(Mark, { size: 30 }),
            h('h2', { style: S.h1 }, 'AI 日记工坊'),
            h('span', { style: S.ver }, 'v' + ((cfg && cfg.version) || '…')),
          ),
          h('div', { style: S.intro }, '选题 → 剧本 → 1080p 渲染 → 配音 → 动态底板 → 投稿 → 评论回复。设置存在 ~/.ai-diary/settings.json。'),
        ),
        h('div', { style: S.status }, cfg ? statusLine(cfg) : '读取中…'),

        // 一、出片
        h(
          Card,
          { title: '出片', sub: '按当前设置跑一遍完整流程' },
          h(
            Row,
            {
              first: true,
              label: '立即出片',
              hint: '选题 → 编剧本 → 本地 1080p 渲染 →（有 key 才）配音 → 交给投稿流程停在「立即投稿」前',
            },
            h(
              'button',
              {
                style: S.btnMain,
                disabled: busy !== '',
                onClick: function () {
                  act('produce')
                },
              },
              busy === 'produce' ? '已启动' : '立即出片',
            ),
          ),
          h(
            Row,
            {
              label: '渲染算力',
              hint: 'CPU = 纯处理器（libx264，画质最好）；GPU = 显卡硬件编码（NVENC / QSV / AMF，快约 1.9×）；自动 = 有显卡就用显卡',
            },
            h(
              'div',
              { style: S.seg },
              ['cpu', 'gpu', 'auto'].map(function (k) {
                return h(
                  'button',
                  {
                    key: k,
                    style: accel === k ? S.segOn : S.segOff,
                    disabled: busy !== '',
                    onClick: function () {
                      patch({ render: { accelerator: k } }, '渲染算力已切到 ' + accelNames[k])
                    },
                  },
                  k === 'cpu' ? 'CPU' : k === 'gpu' ? 'GPU' : '自动',
                )
              }),
            ),
          ),
          h(
            Row,
            {
              label: '超采样倍数',
              hint: '1.5 = 1080×1920（推荐）；1 = 720p；2 = 1440×2560（更慢更清）',
            },
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
            Row,
            { label: '帧率', hint: '24 是 B 站竖屏常规值；30 更顺但渲染更久' },
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
            Row,
            { label: '并行渲染线程', hint: '按 CPU 核数分段并行，0 = 自动（最多 4 段）；GPU 编码时同样并行绘制' },
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
        ),

        // 二、模型
        h(
          Card,
          { title: '模型', sub: 'H3 视频底板 · Seedream 出图' },
          h(
            Row,
            {
              first: true,
              label: 'H3 视频档位',
              hint: 'H3 = 768P/2K 画质优先｜Highspeed = 兼顾速度｜Lite = 最便宜｜Max = 多素材｜Regeneration = 已有 768P 升 2K',
            },
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
            Row,
            { label: 'H3 默认分辨率', hint: 'H3 支持 768P / 2K；Highspeed、Lite、Max 支持 480P / 768P；Regeneration 固定 2K' },
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
            Row,
            {
              label: 'Seedream 出图型号',
              hint: '5.5 是新一代：原生 RGBA 透明底、最多百轮编辑，参考图也照旧支持；需要 ARK key：' + (keys.ark && keys.ark.ready ? '已就绪' : '未配置'),
            },
            h(
              'select',
              {
                style: S.sel,
                value: img.model || 'seedream-5.5',
                disabled: busy !== '',
                onChange: function (e) {
                  patch({ image: { model: e.target.value } }, '图片型号：' + e.target.value)
                },
              },
              (function () {
                var list = (cfg && cfg.models && cfg.models.image) || []
                var names = list.length
                  ? list.map(function (m) {
                      return m.name
                    })
                  : ['seedream-5.5', 'seedream-5.0-pro', 'seedream-5.0-flash', 'seedream-4.0', 'seedream-3.0']
                return names.map(function (m) {
                  return h('option', { key: m, value: m }, m)
                })
              })(),
            ),
          ),
        ),

        // 三、API Key
        h(
          Card,
          { title: 'API Key', sub: '本地保存，也可以用环境变量覆盖' },
          h(
            'div',
            { style: Object.assign({}, S.hint, { margin: '2px 0 6px' }) },
            '环境变量优先（MIMO_API_KEY / DASHSCOPE_API_KEY / MINIMAX_API_KEY / ARK_API_KEY / BILI_COOKIE / GITHUB_TOKEN），设为环境变量后这里会变成只读。',
          ),
          keyOrder.map(function (f) {
            if (!keys[f]) return null
            return h(KeyRow, {
              key: f,
              label: (keyLabels[f] && keyLabels[f].name) || f,
              hint: (keyLabels[f] && keyLabels[f].hint) || '',
              placeholder: f === 'bili' ? 'SESSDATA=…; bili_jct=…' : '粘贴 key',
              entry: keys[f],
              disabled: busy !== '',
              onSave: function (v) {
                var o = {}
                o[f] = v
                patch({ keys: o }, (keyLabels[f] && keyLabels[f].name) + ' 已保存')
              },
            })
          }),
        ),

        // 四、更新
        h(
          Card,
          { title: '更新', sub: 'GitHub Release' },
          h(
            Row,
            { first: true, label: '启动时自动查新', hint: '启动 8 秒后静默比对 GitHub Release，结果写进体检面板' },
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
            Row,
            { label: '查到新版自动安装', hint: '自动下载 tgz、改依赖、装进本机 profile；装完要重启 Harness' },
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
        ),

        note ? h('div', { style: S.note }, note) : null,
      )
    }

    /** 主面板：点左侧栏入口后占满中间栏，内容与设置区块一致，外加返回会话的提示 */
    /** 小统计片：素材库里每类多少件 */
    function Chip(props) {
      var k = props.kind || {}
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            padding: '9px 13px',
            borderRadius: 11,
            border: '1px solid ' + LINE,
            background: SURFACE,
            minWidth: 96,
            flex: '1 1 96px',
          },
        },
        h('span', { style: { fontSize: 11.5, color: MUTED } }, props.label),
        h('span', { style: { fontSize: 15, fontWeight: 600 } }, String(k.count || 0)),
        h('span', { style: { fontSize: 10.5, color: MUTED } }, props.sub || ''),
      )
    }

    /** 扁平小标签（如角色样式 chibi/adult） */
    function Tag(props) {
      return h(
        'span',
        {
          style: {
            fontSize: 10.5,
            padding: '1px 7px',
            borderRadius: 999,
            border: '1px solid ' + LINE,
            color: MUTED,
            flexShrink: 0,
          },
        },
        props.text,
      )
    }

    /**
     * 工作室主面板：左侧栏「AI 日记工坊」点进来的就是这一屏。
     * 四块 —— 素材库 / 成片 / 发布与评论 / 自动化（含定时出片与定时发布、自主选材）。
     * 设置页那一屏（AiDiarySection）保留 API Key、更新、渲染等配置，这里只管日常使用。
     */
    function AiDiaryStudio() {
      var loadState = React.useState(null)
      var cfg = loadState[0]
      var setCfg = loadState[1]
      var tabState = React.useState('assets')
      var tab = tabState[0]
      var setTab = tabState[1]
      var busyState = React.useState('')
      var busy = busyState[0]
      var setBusy = busyState[1]
      var noteState = React.useState('')
      var note = noteState[0]
      var setNote = noteState[1]
      var planState = React.useState(null)
      var plan = planState[0]
      var setPlan = planState[1]

      // B 站扫码登录
      var qrState = React.useState(null)
      var qr = qrState[0]
      var setQr = qrState[1]
      var qrMsgState = React.useState('')
      var qrMsg = qrMsgState[0]
      var setQrMsg = qrMsgState[1]
      var qrTimer = React.useRef(null)

      // 素材库「增加素材」表单
      var formKind = React.useState('characters')
      var kind = formKind[0]
      var setKind = formKind[1]
      var formName = React.useState('')
      var name = formName[0]
      var setName = formName[1]
      var formSrc = React.useState('')
      var src = formSrc[0]
      var setSrc = formSrc[1]

      function ok(j) {
        setCfg(j)
        setNote('')
        return j
      }
      function fail(what) {
        return function (e) {
          setNote(what + '失败：' + ((e && e.message) || e))
        }
      }

      /** 写设置：只传要改的那几个字段，服务端深合并（必须包在 {patch} 里） */
      function patch(body) {
        setBusy('saving')
        return getJson(CONFIG_URL, { patch: body })
          .then(ok)
          .catch(fail('保存'))
          .then(function () {
            setBusy('')
          })
      }

      /** 动一个后台动作（出片、发布、刷新评论、加素材、删成片、预览选材） */
      function act(action, extra) {
        setBusy(action)
        return getJson(CONFIG_URL, Object.assign({ action: action }, extra || {}))
          .then(ok)
          .catch(fail(ACTION_LABEL[action] || action))
          .then(function () {
            setBusy('')
          })
      }

      React.useEffect(function () {
        var alive = true
        getJson(CONFIG_URL)
          .then(function (j) {
            if (alive) setCfg(j)
          })
          .catch(function (e) {
            if (alive) setNote('读取面板失败：' + e.message)
          })
        return function () {
          alive = false
          if (qrTimer.current) clearTimeout(qrTimer.current)
        }
      }, [])

      /** 轮询扫码状态：未扫/已扫待确认继续等，成功就落库 */
      function pollQrAgain(key) {
        if (qrTimer.current) clearTimeout(qrTimer.current)
        qrTimer.current = setTimeout(function () {
          getJson(CONFIG_URL, { action: 'biliQrPoll', key: key })
            .then(function (j) {
              var p = (j && j.poll) || {}
              if (p.status === 'ok') {
                setQr(null)
                setQrMsg('登录成功：' + (p.uname || 'Cookie 已保存到设置里'))
                setCfg(j)
                return
              }
              if (p.status === 'expired') {
                setQr(null)
                setQrMsg('二维码过期了，再点一次「扫码登录」')
                return
              }
              if (p.status === 'error') {
                setQr(null)
                setQrMsg('扫码失败：' + (p.reason || '未知'))
                return
              }
              setQrMsg(p.status === 'scan' ? '已扫码，请在手机上点「确认登录」' : '等扫码…')
              pollQrAgain(key)
            })
            .catch(function (e) {
              setQrMsg('轮询失败：' + e.message)
            })
        }, 1600)
      }

      function startQrLogin() {
        setQrMsg('正在取二维码…')
        setBusy('biliQrStart')
        getJson(CONFIG_URL, { action: 'biliQrStart' })
          .then(function (j) {
            var q = (j && j.qr) || {}
            if (q.ok) {
              setQr({ key: q.key, image: q.image })
              setQrMsg('用手机哔哩哔哩 App 扫一扫，然后在手机上确认')
              pollQrAgain(q.key)
            } else {
              setQrMsg('取二维码失败：' + (q.reason || '接口没返回'))
            }
          })
          .catch(fail('扫码登录'))
          .then(function () {
            setBusy('')
          })
      }

      var studio = (cfg && cfg.studio) || {}
      var assets = studio.assets || { kinds: {}, characters: [], plates: [], backgrounds: [] }
      var films = studio.films || { items: [], total: 0, nextEpisode: 1 }
      var publishLog = studio.publish || []
      var cache = studio.comments || null
      var schedule = studio.schedule || {}
      var textCfg = (cfg && cfg.text) || {}
      var pubCfg = (cfg && cfg.publish) || {}
      var enabled = Boolean(cfg && cfg.enabled)
      var imgModelOpts = (cfg && cfg.models && cfg.models.image) || []
      var ttsProvOpts = (cfg && cfg.models && cfg.models.tts) || []
      var imgCfg = (cfg && cfg.image) || {}
      var ttsCfg = (cfg && cfg.tts) || {}

      var TABS = [
        ['assets', '素材库'],
        ['films', '成片管理'],
        ['publish', '发布与评论'],
        ['auto', '自动化'],
      ]

      /* ---------- 素材库 ---------- */
      function assetsTab() {
        var kinds = assets.kinds || {}
        var order = ['characters', 'backgrounds', 'plates', 'clips', 'keyframes']
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h(
            'div',
            { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
            order.map(function (k) {
              if (!kinds[k]) return null
              return h(Chip, { key: k, kind: kinds[k], label: kinds[k].label, sub: k === 'characters' ? assets.characters.length + ' 个角色' : '' })
            }),
          ),
          h(
            Card,
            { title: '角色立绘', sub: (assets.characters || []).length + ' 个角色可用' },
            (assets.characters || []).length
              ? (assets.characters || []).map(function (c) {
                  return h(
                    'div',
                    { key: c.id, style: S.row },
                    h(
                      'div',
                      { style: S.rowText },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                        h('span', { style: S.label }, c.id),
                        (c.styles || []).map(function (s) {
                          return h(Tag, { key: s, text: s })
                        }),
                      ),
                      h('div', { style: S.hint }, c.looks + ' 套模样 · 共 ' + c.count + ' 张'),
                    ),
                    h('span', { style: S.cardSub }, '可换装'),
                  )
                })
              : h('div', { style: S.note }, 'assets/characters/transparent/variants 下还没有立绘'),
          ),
          h(
            Card,
            { title: '动态底板', sub: (assets.plates || []).length + ' 组序列帧' },
            h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 6 } },
              (assets.plates || []).slice(0, 12).map(function (p) {
                return h(
                  'span',
                  { key: p.id, style: { display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 11.5 } },
                  h(Tag, { text: p.id }),
                  h('span', { style: { color: MUTED } }, p.frames + ' 帧'),
                )
              }),
            ),
          ),
          h(
            Card,
            { title: '背景图', sub: (assets.backgrounds || []).length + ' 张' },
            (assets.backgrounds || []).length
              ? h(
                  'div',
                  { style: { display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 6 } },
                  (assets.backgrounds || []).slice(0, 10).map(function (b) {
                    return h(Tag, { key: b.name, text: b.name.replace(/\.(png|jpg|jpeg|webp)$/i, '') })
                  }),
                )
              : h('div', { style: S.note }, '还没有背景图'),
          ),
          h(
            Card,
            { title: '增加素材', sub: '自己补立绘 / 背景 / 片段' },
            h(
              'div',
              { style: S.rowFirst },
              h(
                'div',
                { style: S.rowText },
                h('div', { style: S.label }, '素材类型与名称'),
                h('div', { style: S.hint }, '角色名写成 deepseek_chibi_v12：角色id_风格_版本，选材才认得'),
              ),
              h(
                'div',
                { style: S.ctl },
                h(
                  'select',
                  {
                    style: S.sel,
                    value: kind,
                    onChange: function (e) {
                      setKind(e.target.value)
                    },
                  },
                  [
                    ['characters', '角色立绘'],
                    ['backgrounds', '背景图'],
                    ['clips', '动态片段'],
                    ['keyframes', '关键帧'],
                  ].map(function (p) {
                    return h('option', { key: p[0], value: p[0] }, p[1])
                  }),
                ),
                h('input', {
                  style: Object.assign({}, S.input, { flex: '1 1 150px' }),
                  placeholder: kind === 'characters' ? 'deepseek_chibi_v12' : '名字（不带后缀）',
                  value: name,
                  onChange: function (e) {
                    setName(e.target.value)
                  },
                }),
              ),
            ),
            h(
              'div',
              { style: S.row },
              h(
                'div',
                { style: S.rowText },
                h('div', { style: S.hint }, '本地文件的绝对路径，或 http(s) 图片链接'),
              ),
              h('div', { style: S.ctl },
                h('input', {
                  style: Object.assign({}, S.input, { flex: '1 1 240px' }),
                  placeholder: 'E:\\图\\deepseek_v12.png 或 https://…',
                  value: src,
                  onChange: function (e) {
                    setSrc(e.target.value)
                  },
                }),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'flex-end', paddingTop: 8 } },
              h(
                'button',
                {
                  style: S.btnMain,
                  disabled: busy !== '' || name === '' || src === '' || kind === 'plates',
                  onClick: function () {
                    act('addAsset', { kind: kind, name: name, source: src }).then(function (j) {
                      if (j && j.ok) {
                        setName('')
                        setSrc('')
                      }
                    })
                  },
                },
                busy === 'addAsset' ? '导入中…' : '添加到素材库',
              ),
            ),
          ),
        )
      }

      /* ---------- 成片管理 ---------- */
      function filmsTab() {
        var items = films.items || []
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h(
            Card,
            {
              title: '成片库',
              sub: '共 ' + (films.total || items.length) + ' 集 · 下一集编号 ' + (films.nextEpisode || '—'),
            },
            h(
              'div',
              { style: { display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 } },
              h(
                'button',
                {
                  style: S.btnMain,
                  disabled: busy !== '',
                  onClick: function () {
                    act('publishNow')
                  },
                },
                busy === 'publishNow' ? '发布中…' : '发布最新一集',
              ),
              h(
                'button',
                {
                  style: S.btn,
                  disabled: busy !== '',
                  onClick: function () {
                    act('produce')
                  },
                },
                busy === 'produce' ? '出片中…' : '现在做一集新的',
              ),
              h(
                'button',
                {
                  style: S.btn,
                  disabled: busy !== '',
                  onClick: function () {
                    patch({})
                  },
                },
                '刷新列表',
              ),
            ),
          ),
          items.length
            ? h(
                Card,
                { title: '已完成的片子', sub: '点「发布」把该集送进客户端投稿页' },
                items.slice(0, 24).map(function (it) {
                  var state = it.status === 'published' ? '已发布' : it.exists === false ? '文件缺失' : '待发布'
                  return h(
                    'div',
                    { key: it.id, style: S.row },
                    h(
                      'div',
                      { style: S.rowText },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
                        h('span', { style: Object.assign({}, S.label, { fontWeight: 600 }) }, '第 ' + it.episode + ' 集'),
                        h('span', { style: S.label }, it.title || ''),
                        h(Tag, { text: state }),
                      ),
                      h(
                        'div',
                        { style: S.hint },
                        [formatBytes(it.bytes), it.seconds ? it.seconds + ' 秒' : '', it.createdAt ? formatWhen(it.createdAt) : '']
                          .filter(Boolean)
                          .join(' · ') +
                          (it.file ? ' · ' + it.file : ''),
                      ),
                    ),
                    h(
                      'div',
                      { style: S.ctl },
                      h(
                        'button',
                        {
                          style: S.btn,
                          disabled: busy !== '' || it.exists === false,
                          onClick: function () {
                            act('publishNow')
                          },
                        },
                        '发布',
                      ),
                      h(
                        'button',
                        {
                          style: S.btn,
                          disabled: busy !== '',
                          onClick: function () {
                            act('removeFilm', { id: it.id, deleteFile: false })
                          },
                        },
                        '移出列表',
                      ),
                    ),
                  )
                }),
              )
            : h(Card, { title: '还没有成片', sub: '点「现在做一集新的」跑一遍完整流程' }),
        )
      }

      /* ---------- 发布与评论 ---------- */
      function publishTab() {
        var latest = cache && cache.latestVideo
        var comments = (cache && cache.comments) || []
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h(
            Card,
            {
              title: '最新一次发布',
              sub: latest ? formatWhen(latest.created) : '还没拿到 B 站数据',
            },
            h(
              'div',
              { style: { paddingTop: 4 } },
              latest
                ? h(
                    'div',
                    null,
                    h('div', { style: S.label }, latest.title),
                    h(
                      'div',
                      { style: S.hint },
                      'BV ' + (latest.bvid || '—') + ' · 播放 ' + (latest.view || 0) + ' · 发布于 ' + formatWhen(latest.created),
                    ),
                  )
                : h('div', { style: S.note }, cache && !cache.ok ? cache.reason || '没拉到数据' : '点「刷新评论」从 B 站拉一次（需要 Cookie）'),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8, paddingTop: 8, flexWrap: 'wrap' } },
              h(
                'button',
                {
                  style: S.btnMain,
                  disabled: busy !== '',
                  onClick: function () {
                    act('refreshComments')
                  },
                },
                busy === 'refreshComments' ? '拉取中…' : '刷新评论',
              ),
              h(
                'button',
                { style: S.btn, disabled: busy !== '', onClick: function () { act('publishNow') } },
                '发布最新一集',
              ),
              h(
                'button',
                { style: S.btn, disabled: busy !== '', onClick: startQrLogin },
                busy === 'biliQrStart' ? '取码中…' : '扫码登录 B 站',
              ),
            ),
            qr
              ? h(
                  'div',
                  { style: { display: 'flex', gap: 14, alignItems: 'flex-start', paddingTop: 12, flexWrap: 'wrap' } },
                  h('img', {
                    src: qr.image,
                    width: 132,
                    height: 132,
                    alt: 'B 站登录二维码',
                    style: { borderRadius: 8, border: '1px solid ' + LINE, background: '#fff', flexShrink: 0 },
                  }),
                  h('div', { style: { fontSize: 12.5, lineHeight: 1.9, color: MUTED, flex: '1 1 140px', minWidth: 0 } }, qrMsg),
                )
              : qrMsg
                ? h('div', { style: S.note }, qrMsg)
                : null,
          ),
          h(
            Card,
            { title: '评论', sub: comments.length + ' 条（最近先显示）' },
            comments.length
              ? comments.slice(0, 18).map(function (c) {
                  return h(
                    'div',
                    { key: c.rpid, style: S.row },
                    h(
                      'div',
                      { style: S.rowText },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                        h('span', { style: Object.assign({}, S.label, { fontWeight: 600 }) }, c.uname || '匿名'),
                        c.like ? h(Tag, { text: '赞 ' + c.like }) : null,
                        h('span', { style: S.hint }, c.ctime ? formatWhen(c.ctime) : ''),
                      ),
                      h('div', { style: { fontSize: 12.5, lineHeight: 1.7, marginTop: 3 } }, String(c.text || '')),
                    ),
                  )
                })
              : h('div', { style: S.note }, '评论区还是空的。配好 B 站 Cookie 后点「刷新评论」；自主选材会拿这些评论当下一集的素材。'),
          ),
          h(
            Card,
            { title: '发布记录', sub: publishLog.length + ' 条' },
            publishLog.length
              ? publishLog.slice(0, 10).map(function (p, i) {
                  return h(
                    'div',
                    { key: i, style: i === 0 ? S.rowFirst : S.row },
                    h(
                      'div',
                      { style: S.rowText },
                      h('div', { style: S.label }, p.title || '（无标题）'),
                      h(
                        'div',
                        { style: S.hint },
                        [formatWhen(p.at), p.episode ? '第 ' + p.episode + ' 集' : '', p.submitted ? '已点投稿' : p.dryRun ? '演练' : '已填入待投']
                          .filter(Boolean)
                          .join(' · '),
                      ),
                    ),
                    h(Tag, { text: p.ok ? 'ok' : '失败' }),
                  )
                })
              : h('div', { style: S.note }, '还没有发布记录。第一次发布后这里会按时间倒序列出。'),
          ),
        )
      }

      /* ---------- 自动化 ---------- */
      function autoTab() {
        var sc = schedule || {}
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h(
            Card,
            { title: '定时出片', sub: sc.enabled ? '下次到点自动做一集' : '已关闭' },
            h(Row, {
              first: true,
              label: '每天几点做',
              hint: '到点自动跑「选题 → 渲染 → 配音 → 发布」全套；一天一次',
            },
              h(
                'div',
                { style: S.seg },
                h(
                  'button',
                  {
                    style: sc.enabled ? S.segOn : S.segOff,
                    onClick: function () {
                      patch({ schedule: { enabled: true } })
                    },
                  },
                  '开',
                ),
                h(
                  'button',
                  {
                    style: sc.enabled ? S.segOff : S.segOn,
                    onClick: function () {
                      patch({ schedule: { enabled: false } })
                    },
                  },
                  '关',
                ),
              ),
              h('input', {
                style: Object.assign({}, S.num, { width: 92, textAlign: 'center' }),
                type: 'time',
                value: sc.dailyAt || '20:30',
                onChange: function (e) {
                  patch({ schedule: { dailyAt: e.target.value } })
                },
              }),
            ),
            h(Row, {
              label: '上次运行',
              hint: sc.lastRun ? '结果：' + ((sc.lastResult && sc.lastResult.ok) ? '成功' : '失败') : '还没跑过',
            }, h('span', { style: S.cardSub }, sc.lastRun ? formatWhen(sc.lastRun) : '—')),
          ),
          h(
            Card,
            { title: '定时发布', sub: sc.publishAt ? '每天 ' + sc.publishAt : '未开启' },
            h(Row, {
              first: true,
              label: '每天几点发',
              hint: '到点把「成片库」里最新一条待发布的发出去；留空 = 不定时发布',
            },
              h('input', {
                style: Object.assign({}, S.num, { width: 92, textAlign: 'center' }),
                type: 'time',
                value: sc.publishAt || '',
                onChange: function (e) {
                  patch({ schedule: { publishAt: e.target.value } })
                },
              }),
              h(
                'button',
                {
                  style: S.btn,
                  onClick: function () {
                    patch({ schedule: { publishAt: '' } })
                  },
                },
                '清除',
              ),
            ),
            h(Row, { label: '上次发布', hint: sc.lastPublishRun ? '已按定时发布跑过' : '还没跑过' },
              h('span', { style: S.cardSub }, sc.lastPublishRun ? formatWhen(sc.lastPublishRun) : '—'),
            ),
          ),
          h(
            Card,
            { title: 'DeepSeek 自主选材', sub: (schedule.studio && schedule.studio.freePlan === false) ? '用固定题材库' : '读评论区自己决定' },
            h(Row, {
              first: true,
              label: '不用刻板模板',
              hint: '开：拿最近的评论喂给模型，让它自己写这一集；关：从 data/topics.json 抽',
            },
              h(
                'div',
                { style: S.seg },
                h(
                  'button',
                  {
                    style: (schedule.studio && schedule.studio.freePlan !== false) ? S.segOn : S.segOff,
                    onClick: function () {
                      patch({ studio: { freePlan: true } })
                    },
                  },
                  '自主',
                ),
                h(
                  'button',
                  {
                    style: (schedule.studio && schedule.studio.freePlan === false) ? S.segOn : S.segOff,
                    onClick: function () {
                      patch({ studio: { freePlan: false } })
                    },
                  },
                  '题材库',
                ),
              ),
            ),
            h(Row, {
              label: '选材前刷新评论',
              hint: '开着才能从评论区取材；需要 B 站 Cookie',
            },
              h(
                'div',
                { style: S.seg },
                h(
                  'button',
                  {
                    style: (schedule.studio && schedule.studio.refreshComments !== false) ? S.segOn : S.segOff,
                    onClick: function () {
                      patch({ studio: { refreshComments: true } })
                    },
                  },
                  '开',
                ),
                h(
                  'button',
                  {
                    style: (schedule.studio && schedule.studio.refreshComments === false) ? S.segOn : S.segOff,
                    onClick: function () {
                      patch({ studio: { refreshComments: false } })
                    },
                  },
                  '关',
                ),
              ),
            ),
            h(Row, {
              label: '写台词的模型',
              hint: 'deepseek 官方直连（DEEPSEEK_API_KEY）；dashscope 用千问（DASHSCOPE_API_KEY）；ark 用豆包（需填接入点 id）；off 只用本地拼装',
            },
              h(
                'select',
                {
                  style: S.sel,
                  value: textCfg.provider || 'dashscope',
                  onChange: function (e) {
                    // 型号是全局一个字段，换家必须清空，否则 qwen-plus 会打到 DeepSeek 上
                    patch({ text: { provider: e.target.value, model: '' } })
                  },
                },
                h('option', { value: 'deepseek' }, 'deepseek（官方）'),
                h('option', { value: 'dashscope' }, 'dashscope（千问）'),
                h('option', { value: 'ark' }, 'ark（豆包）'),
                h('option', { value: 'off' }, 'off（不联网）'),
              ),
              h('input', {
                style: Object.assign({}, S.input, { flex: '0 1 150px' }),
                placeholder: textModelPlaceholder(textCfg.provider || 'dashscope'),
                value: textCfg.model || '',
                onChange: function (e) {
                  patch({ text: { model: e.target.value } })
                },
              }),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8, paddingTop: 8, flexWrap: 'wrap' } },
              h(
                'button',
                {
                  style: S.btnMain,
                  disabled: busy !== '',
                  onClick: function () {
                    setBusy('planPreview')
                    setPlan(null)
                    getJson(CONFIG_URL, { action: 'planPreview', useModel: (textCfg.provider || 'dashscope') !== 'off' })
                      .then(function (j) {
                        ok(j)
                        setPlan((j && j.plan) || null)
                      })
                      .catch(fail('预览选题'))
                      .then(function () {
                        setBusy('')
                      })
                  },
                },
                busy === 'planPreview' ? '想题中…' : '看这一集会说什么',
              ),
            ),
            plan
              ? h(
                  'div',
                  { style: { marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + LINE_SOFT } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' } },
                    h('span', { style: Object.assign({}, S.label, { fontWeight: 600 }) }, (plan.topic && plan.topic.title) || '—'),
                    h(Tag, { text: plan.how === 'model' ? '模型写的' : '本地拼装' }),
                  ),
                  plan.why ? h('div', { style: S.hint }, '取材：' + plan.why) : null,
                  plan.error ? h('div', { style: S.hint }, '降级原因：' + plan.error) : null,
                  h(
                    'div',
                    { style: { marginTop: 6 } },
                    ((plan.topic && plan.topic.beats) || []).map(function (b, i) {
                      return h(
                        'div',
                        { key: i, style: { display: 'flex', gap: 8, padding: '4px 0', borderTop: i ? '1px solid ' + LINE_SOFT : 'none' } },
                        h(Tag, { text: b.mood }),
                        h('span', { style: { fontSize: 12.5, lineHeight: 1.7 } }, b.text),
                      )
                    }),
                  ),
                )
              : null,
          ),
          h(
            Card,
            { title: '发布策略', sub: pubCfg.autoSubmit ? '自动点「立即投稿」' : '只填表不提交' },
            h(Row, {
              first: true,
              label: '演练模式（不真的发）',
              hint: '开着只把文案和视频塞进客户端，不点投稿',
            },
              h(
                'div',
                { style: S.seg },
                h('button', { style: pubCfg.dryRun !== false ? S.segOn : S.segOff, onClick: function () { patch({ publish: { dryRun: true } }) } }, '开'),
                h('button', { style: pubCfg.dryRun === false ? S.segOn : S.segOff, onClick: function () { patch({ publish: { dryRun: false } }) } }, '关'),
              ),
            ),
            h(Row, { label: '自动填表', hint: '标题/声明/标签自动填进投稿页' },
              h(
                'div',
                { style: S.seg },
                h('button', { style: pubCfg.autoFill ? S.segOn : S.segOff, onClick: function () { patch({ publish: { autoFill: true } }) } }, '开'),
                h('button', { style: pubCfg.autoFill ? S.segOff : S.segOn, onClick: function () { patch({ publish: { autoFill: false } }) } }, '关'),
              ),
            ),
            h(Row, { label: '自动点「立即投稿」', hint: '关着就停在提交前，留给你最后看一眼' },
              h(
                'div',
                { style: S.seg },
                h('button', { style: pubCfg.autoSubmit ? S.segOn : S.segOff, onClick: function () { patch({ publish: { autoSubmit: true } }) } }, '开'),
                h('button', { style: pubCfg.autoSubmit ? S.segOff : S.segOn, onClick: function () { patch({ publish: { autoSubmit: false } }) } }, '关'),
              ),
            ),
          ),
          h(
            Card,
            { title: '生图与配音模型', sub: (imgCfg.model || '未设') + ' · ' + (ttsCfg.provider || 'xiaomi') + (ttsCfg.model ? ' / ' + ttsCfg.model : '') },
            h(Row, {
              first: true,
              label: '生图模型（Seedream）',
              hint: '5.5 是最新一代：原生 RGBA 透明底、百轮编辑、文字更准；5.0 flash 与 pro 同级但更快更便宜',
            },
              h(
                'select',
                {
                  style: S.sel,
                  value: imgCfg.model || 'seedream-5.5',
                  onChange: function (e) {
                    patch({ image: { model: e.target.value } })
                  },
                },
                imgModelOpts.length
                  ? imgModelOpts.map(function (m) {
                      return h('option', { key: m.name, value: m.name }, m.name)
                    })
                  : [h('option', { key: 'seedream-5.5', value: 'seedream-5.5' }, 'seedream-5.5')],
              ),
            ),
            h(Row, {
              label: '配音服务商',
              hint: '小米 MiMo / 千问 Qwen-TTS / MiniMax T2A；换谁就要配谁的 key',
            },
              h(
                'select',
                {
                  style: S.sel,
                  value: ttsCfg.provider || 'xiaomi',
                  onChange: function (e) {
                    var p = e.target.value
                    var first = (ttsProvOpts.find(function (x) {
                      return x.provider === p
                    }) || {}).models
                    patch({ tts: { provider: p, model: first && first[0] ? first[0].id : '' } })
                  },
                },
                ttsProvOpts.length
                  ? ttsProvOpts.map(function (p) {
                      return h('option', { key: p.provider, value: p.provider }, p.label + '（' + p.keyEnv + '）')
                    })
                  : [h('option', { key: 'xiaomi', value: 'xiaomi' }, '小米 MiMo')],
              ),
            ),
            h(Row, {
              label: '配音模型',
              hint: '千问可选 flash / flash-realtime；MiniMax 可选 2.8 高清或极速、02 高清或极速',
            },
              h(
                'select',
                {
                  style: S.sel,
                  value: ttsCfg.model || '',
                  onChange: function (e) {
                    patch({ tts: { model: e.target.value } })
                  },
                },
                h('option', { key: '', value: '' }, '（服务商默认）'),
                ((ttsProvOpts.find(function (p) {
                  return p.provider === (ttsCfg.provider || 'xiaomi')
                }) || {}).models || []).map(function (m) {
                  return h('option', { key: m.id, value: m.id }, m.id)
                }),
              ),
            ),
            h(Row, {
              label: '音色',
              hint: '留空就按角色自动分配（八个角色各一色）',
            },
              h('input', {
                style: S.input,
                placeholder: ttsCfg.provider === 'qwen' ? 'Cherry / Serena / Ethan …' : ttsCfg.provider === 'minimax' ? 'female-shaonv …' : '冰糖 / 茉莉 …',
                defaultValue: ttsCfg.voice || '',
                onBlur: function (e) {
                  patch({ tts: { voice: e.target.value.trim() } })
                },
              }),
            ),
          ),
        )
      }

      var body = tab === 'assets' ? assetsTab() : tab === 'films' ? filmsTab() : tab === 'publish' ? publishTab() : autoTab()

      return h(
        'div',
        { style: S.page },
        h(
          'div',
          { style: S.head },
          h(Mark, {}),
          h(
            'div',
            { style: { flex: '1 1 auto', minWidth: 0 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('h1', { style: S.h1 }, 'AI 日记工坊'),
              h('span', { style: S.ver }, 'v' + ((cfg && cfg.version) || '—')),
            ),
            h('div', { style: S.intro }, '素材库 · 成片 · 发布与评论 · 自主选材与定时'),
          ),
          h(
            'button',
            {
              style: Object.assign({}, S.btn, {
                borderColor: enabled ? 'rgba(77,107,254,0.55)' : LINE,
                background: enabled ? 'rgba(77,107,254,0.12)' : 'transparent',
                color: enabled ? 'inherit' : MUTED,
              }),
              disabled: busy !== '',
              title: enabled ? '定时出片 / 定时发布 / 自动回评论会按设置跑' : '关着时只在你手动点的时候才动',
              onClick: function () {
                patch({ enabled: !enabled })
              },
            },
            enabled ? '已启用' : '已关闭',
          ),
          h(
            'button',
            {
              style: S.btn,
              disabled: busy !== '',
              onClick: function () {
                setBusy('check')
                getJson(CONFIG_URL, { action: 'check' })
                  .then(ok)
                  .catch(fail('查新'))
                  .then(function () {
                    setBusy('')
                  })
              },
            },
            busy === 'check' ? '查新中…' : '检查更新',
          ),
          h(
            'button',
            {
              style: S.btnMain,
              disabled: busy !== '',
              onClick: function () {
                act('produce')
              },
            },
            busy === 'produce' ? '出片中…' : '立即出片',
          ),
        ),
        h('div', { style: S.status }, statusLine(cfg)),
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          TABS.map(function (p) {
            return h(
              'button',
              {
                key: p[0],
                style: Object.assign({}, tab === p[0] ? S.segOn : S.segOff, {
                  border: '1px solid ' + LINE,
                  borderRadius: 9,
                  padding: '6px 14px',
                }),
                onClick: function () {
                  setTab(p[0])
                },
              },
              p[1],
            )
          }),
        ),
        body,
        note ? h('div', { style: Object.assign({}, S.note, { color: '#e57373' }) }, note) : null,
      )
    }

    /* ============ 对话框左上角的插件小挂件 ============ */

    /** 一行选项：左边标签、右边当前值（仿官方模型面板的「标签 …… 值 ›」） */
    /* 挂件和浮层分在两个槽位，靠这个小 store 对话（chip 只负责露脸，卡片在 shell.overlay 里画） */
    var chipState = { open: false, left: 16, top: 120, section: '', cfg: null, hero: false }
    /** 写台词模型输入框的占位文案：跟着服务商变，免得填错家 */
    function textModelPlaceholder(p) {
      if (p === 'deepseek') return 'deepseek-chat（默认）'
      if (p === 'ark') return '接入点 id，如 ep-2026…'
      if (p === 'off') return '不用填'
      return 'qwen-plus（默认）'
    }
    var chipSubs = []
    function chipPatch(patch) {
      chipState = Object.assign({}, chipState, patch)
      chipSubs.slice().forEach(function (fn) {
        try {
          fn()
        } catch (e) {}
      })
    }
    function chipSubscribe(fn) {
      chipSubs.push(fn)
      return function () {
        chipSubs = chipSubs.filter(function (x) {
          return x !== fn
        })
      }
    }
    function useChip() {
      var s = React.useState(chipState)
      var set = s[1]
      React.useEffect(function () {
        return chipSubscribe(function () {
          set(chipState)
        })
      }, [])
      return s[0]
    }

    function MenuLine(props) {
      return h(
        'button',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            width: '100%',
            padding: '11px 16px',
            border: 'none',
            borderTop: props.first ? 'none' : '1px solid ' + LINE_SOFT,
            background: 'transparent',
            color: 'inherit',
            cursor: props.onClick ? 'pointer' : 'default',
            textAlign: 'left',
            font: 'inherit',
          },
          onClick: props.onClick,
        },
        h('span', { style: { fontSize: 13 } }, props.label),
        h(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
          props.value ? h('span', { style: { fontSize: 12.5, color: MUTED, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, props.value) : null,
          props.children || null,
        ),
      )
    }

    /** 开关本体：34×19 的小胶囊 */
    function Switch(props) {
      var on = Boolean(props.on)
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            position: 'relative',
            width: 34,
            height: 19,
            borderRadius: 10,
            background: on ? BRAND : 'rgba(128,128,128,0.32)',
            flexShrink: 0,
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: on ? 17 : 2,
            width: 15,
            height: 15,
            borderRadius: 8,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          },
        }),
      )
    }

    /**
     * 挂在对话框输入框左上角的小挂件（槽位 conversation.input.left）。
     * 点开是一张卡片：总开关 + 生图模型 + 配音模型，仿官方模型面板的样子。
     * 默认关闭——关着时定时出片、定时发布、自动回评论都不跑。
     */
    function PluginChip() {
      var st = React.useState(null)
      var cfg = st[0]
      var setCfg = st[1]
      var op = React.useState(false)
      var open = op[0]
      var setOpen = op[1]
      var sec = React.useState('')
      var section = sec[0]
      var setSection = sec[1]
      var anchorState = React.useState({ left: 16, bottom: 120 })
      var anchor = anchorState[0]
      var setAnchor = anchorState[1]
      var anchorRef = React.useRef(null)

      React.useEffect(function () {
        var alive = true
        getJson(CONFIG_URL)
          .then(function (j) {
            if (!alive) return
            setCfg(j)
            chipPatch({ cfg: j })
          })
          .catch(function () {})
        return function () {
          alive = false
        }
      }, [])

      // 点一下只是告诉浮层「开/关 + 卡片画在哪」，真正的卡片由 DiaryPopover 画
      function toggle() {
        var el = anchorRef.current
        var patch = { open: !chipState.open, section: '' }
        if (el && el.getBoundingClientRect) {
          var r = el.getBoundingClientRect()
          patch.left = Math.max(8, r.left)
          patch.top = Math.max(8, r.bottom + 8)
        }
        chipPatch(patch)
      }

      var chipS = useChip()
      var live = chipS.cfg || cfg
      var enabled = Boolean(live && live.enabled)
      var img = (cfg && cfg.image) || {}
      var tts = (cfg && cfg.tts) || {}
      var imgModels = ((cfg && cfg.models && cfg.models.image) || []).map(function (m) {
        return { value: m.name, label: m.name + '（' + (m.id || '') + '）' }
      })
      var ttsProviders = (cfg && cfg.models && cfg.models.tts) || []
      var ttsFlat = []
      ttsProviders.forEach(function (p) {
        ;(p.models || []).forEach(function (m) {
          ttsFlat.push({
            provider: p.provider,
            label: p.label + ' · ' + m.id,
            value: p.provider,
            model: m.id,
            keyEnv: p.keyEnv,
            ready: Boolean(cfg && cfg.keys && cfg.keys[p.provider === 'qwen' ? 'dashscope' : p.provider === 'minimax' ? 'minimax' : 'mimo'] && cfg.keys[p.provider === 'qwen' ? 'dashscope' : p.provider === 'minimax' ? 'minimax' : 'mimo'].ready),
          })
        })
      })
      var curTts = tts.provider || 'xiaomi'
      var curTtsLabel = curTts + (tts.model ? ' · ' + tts.model : '')

      var panelStyle = {
        position: 'fixed',
        left: Math.min(anchor.left, Math.max(8, (window.innerWidth || 1200) - 300)),
        bottom: anchor.bottom,
        width: 286,
        maxHeight: 420,
        overflow: 'auto',
        borderRadius: 14,
        border: '1px solid ' + LINE,
        background: 'var(--dsw-alias-bg-base, #fff)',
        boxShadow: '0 12px 30px rgba(0,0,0,0.16)',
        zIndex: 2147482001,
        padding: '4px 0',
      }

      var chip = h(
        'button',
        {
          ref: anchorRef,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 28,
            padding: '0 8px',
            borderRadius: 8,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 13,
            flexShrink: 0,
          },
          title: 'AI 日记工坊：' + (enabled ? '已启用' : '已关闭（默认关）'),
          onMouseEnter: function (e) {
            e.currentTarget.style.background = 'rgba(128,128,128,0.14)'
          },
          onMouseLeave: function (e) {
            e.currentTarget.style.background = 'transparent'
          },
          onClick: function (e) {
            e.preventDefault()
            e.stopPropagation()
            toggle()
          },
        },
        h(
          'svg',
          { width: 15, height: 15, viewBox: '0 0 16 16', style: { flexShrink: 0, opacity: 0.8 } },
          h('rect', { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
          h('line', { x1: 5, y1: 6.2, x2: 11, y2: 6.2, stroke: 'currentColor', strokeWidth: 1.2 }),
          h('line', { x1: 5, y1: 9.4, x2: 11, y2: 9.4, stroke: 'currentColor', strokeWidth: 1.2 }),
        ),
        'AI 日记',
        h('span', { style: { fontSize: 10, opacity: 0.55, lineHeight: 1 } }, '﹀'),
      )

      // 挂件只负责露脸；下面的旧实现（body / portal）已搬到 DiaryPopover，留着不影响
      return chip

      var body
      if (section === 'image') {
        body = [
          h(MenuLine, {
            key: 'h',
            first: true,
            label: '‹  生图模型',
            value: '',
            onClick: function () {
              setSection('')
            },
          }),
          imgModels.map(function (m) {
            return h(MenuLine, {
              key: m.value,
              label: m.value,
              value: m.value === img.model ? '✓' : '',
              onClick: function () {
                save({ image: { model: m.value } })
                setSection('')
              },
            })
          }),
          h(
            'div',
            { key: 'n', style: { padding: '8px 16px 12px', fontSize: 11.5, lineHeight: 1.7, color: MUTED, borderTop: '1px solid ' + LINE_SOFT } },
            '需要 ARK_API_KEY（火山方舟）。5.5 是最新一代，原生 RGBA 透明底，适合做立绘素材。',
          ),
        ]
      } else if (section === 'tts') {
        body = [
          h(MenuLine, {
            key: 'h',
            first: true,
            label: '‹  配音模型',
            value: '',
            onClick: function () {
              setSection('')
            },
          }),
          ttsFlat.map(function (t, i) {
            var cur = curTts === t.provider && String(tts.model || '') === t.model
            return h(MenuLine, {
              key: i,
              label: t.label + (t.ready ? '' : '（无 key）'),
              value: cur ? '✓' : '',
              onClick: function () {
                save({ tts: { provider: t.provider, model: t.model } })
                setSection('')
              },
            })
          }),
          h(
            'div',
            { key: 'n', style: { padding: '8px 16px 12px', fontSize: 11.5, lineHeight: 1.7, color: MUTED, borderTop: '1px solid ' + LINE_SOFT } },
            '小米用 MIMO_API_KEY，千问用 DASHSCOPE_API_KEY，MiniMax 用 MINIMAX_API_KEY。',
          ),
        ]
      } else {
        body = [
          h(MenuLine, {
            key: 'en',
            first: true,
            label: '启用插件',
            onClick: function () {
              save({ enabled: !enabled })
            },
          }, h(Switch, { on: enabled })),
          h(MenuLine, {
            key: 'im',
            label: '生图模型',
            value: img.model || '未设置',
            onClick: function () {
              setSection('image')
            },
          }, h('span', { style: { fontSize: 12, color: MUTED } }, '›')),
          h(MenuLine, {
            key: 'tt',
            label: '配音模型',
            value: curTtsLabel,
            onClick: function () {
              setSection('tts')
            },
          }, h('span', { style: { fontSize: 12, color: MUTED } }, '›')),
          h(
            'div',
            {
              key: 'note',
              style: { padding: '9px 16px 12px', fontSize: 11.5, lineHeight: 1.7, color: MUTED, borderTop: '1px solid ' + LINE_SOFT },
            },
            enabled ? '定时出片 / 定时发布 / 自动回评论会按设置跑' : '关着时只在你手动点的时候才动，定时任务不跑',
          ),
        ]
      }

      // 浮层必须 portal 到 document.body：composer 是停靠容器，自带裁切/变换，
      // 留在原地会把 fixed 卡片一起裁掉（官方槽位契约原话）
      var overlay = React.createPortal
        ? React.createPortal(
            h(
              'span',
              null,
              h('span', {
                style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2147482000, background: 'transparent' },
                onClick: function (e) {
                  e.stopPropagation()
                  setOpen(false)
                },
              }),
              h(
                'div',
                {
                  style: panelStyle,
                  onClick: function (e) {
                    e.stopPropagation()
                  },
                },
                body,
              ),
            ),
            document.body,
          )
        : null

      return h('span', { style: { display: 'inline-flex' } }, chip, overlay)
    }

    /**
     * 卡片本体，注册在 shell.overlay（frame 级帧层，不会被 composer 的裁切/变换吃掉）。
     * 位置跟着 chip 那次点击的坐标走；点空白处关闭。
     */
    function DiaryPopover() {
      var chip = useChip()
      if (!chip.open) return null

      var cfg = chip.cfg || {}
      var enabled = Boolean(cfg.enabled)
      var img = cfg.image || {}
      var tts = cfg.tts || {}
      var section = chip.section || ''
      var imgModels = (cfg.models && cfg.models.image) || []
      var ttsFlat = []
      ;((cfg.models && cfg.models.tts) || []).forEach(function (p) {
        ;(p.models || []).forEach(function (m) {
          var keyField = p.provider === 'qwen' ? 'dashscope' : p.provider === 'minimax' ? 'minimax' : 'mimo'
          ttsFlat.push({
            provider: p.provider,
            label: p.label + ' · ' + m.id,
            model: m.id,
            ready: Boolean(cfg.keys && cfg.keys[keyField] && cfg.keys[keyField].ready),
          })
        })
      })
      var curTts = tts.provider || 'xiaomi'

      function save(body) {
        getJson(CONFIG_URL, { patch: body })
          .then(function (j) {
            chipPatch({ cfg: j })
          })
          .catch(function () {})
      }
      function close() {
        chipPatch({ open: false, section: '' })
      }
      function go(sec) {
        chipPatch({ section: sec })
      }

      var rows
      if (section === 'image') {
        rows = [
          h(MenuLine, {
            key: 'h',
            first: true,
            label: '‹  生图模型',
            onClick: function () {
              go('')
            },
          }),
        ].concat(
          imgModels.map(function (m) {
            return h(MenuLine, {
              key: m.name,
              label: m.name,
              value: m.name === img.model ? '✓' : '',
              onClick: function () {
                save({ image: { model: m.name } })
                go('')
              },
            })
          }),
        )
        rows.push(
          h(
            'div',
            { key: 'n', style: { padding: '8px 16px 12px', fontSize: 11.5, lineHeight: 1.7, color: MUTED, borderTop: '1px solid ' + LINE_SOFT } },
            '需要 ARK_API_KEY（火山方舟）。5.5 是最新一代，原生 RGBA 透明底，适合做立绘素材。',
          ),
        )
      } else if (section === 'tts') {
        rows = [
          h(MenuLine, {
            key: 'h',
            first: true,
            label: '‹  配音模型',
            onClick: function () {
              go('')
            },
          }),
        ].concat(
          ttsFlat.map(function (t, i) {
            var cur = curTts === t.provider && String(tts.model || '') === t.model
            return h(MenuLine, {
              key: String(i),
              label: t.label + (t.ready ? '' : '（无 key）'),
              value: cur ? '✓' : '',
              onClick: function () {
                save({ tts: { provider: t.provider, model: t.model } })
                go('')
              },
            })
          }),
        )
        rows.push(
          h(
            'div',
            { key: 'n', style: { padding: '8px 16px 12px', fontSize: 11.5, lineHeight: 1.7, color: MUTED, borderTop: '1px solid ' + LINE_SOFT } },
            '小米用 MIMO_API_KEY，千问用 DASHSCOPE_API_KEY，MiniMax 用 MINIMAX_API_KEY。',
          ),
        )
      } else {
        rows = [
          h(
            MenuLine,
            {
              key: 'en',
              first: true,
              label: '启用插件',
              onClick: function () {
                save({ enabled: !enabled })
              },
            },
            h(Switch, { on: enabled }),
          ),
          h(
            MenuLine,
            {
              key: 'im',
              label: '生图模型',
              value: img.model || '未设置',
              onClick: function () {
                go('image')
              },
            },
            h('span', { style: { fontSize: 12, color: MUTED } }, '›'),
          ),
          h(
            MenuLine,
            {
              key: 'tt',
              label: '配音模型',
              value: curTts + (tts.model ? ' · ' + tts.model : ''),
              onClick: function () {
                go('tts')
              },
            },
            h('span', { style: { fontSize: 12, color: MUTED } }, '›'),
          ),
          h(
            'div',
            { key: 'note', style: { padding: '9px 16px 12px', fontSize: 11.5, lineHeight: 1.7, color: MUTED, borderTop: '1px solid ' + LINE_SOFT } },
            enabled ? '定时出片 / 定时发布 / 自动回评论会按设置跑' : '关着时只在你手动点的时候才动，定时任务不跑',
          ),
        ]
      }

      var winW = window.innerWidth || 1200
      var winH = window.innerHeight || 800
      var left = Math.min(Math.max(8, chip.left), Math.max(8, winW - 298))
      var top = Math.min(Math.max(8, chip.top), Math.max(8, winH - 220))
      return h(
        'span',
        null,
        h('span', {
          style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2147482000, background: 'transparent' },
          onClick: function (e) {
            e.stopPropagation()
            close()
          },
        }),
        h(
          'div',
          {
            style: {
              position: 'fixed',
              left: left,
              top: top,
              width: 286,
              maxHeight: Math.max(160, Math.min(420, winH - top - 16)),
              overflow: 'auto',
              borderRadius: 14,
              border: '1px solid ' + LINE,
              background: 'var(--dsw-alias-bg-base, #fff)',
              boxShadow: '0 12px 30px rgba(0,0,0,0.16)',
              zIndex: 2147482001,
              padding: '4px 0',
            },
            onClick: function (e) {
              e.stopPropagation()
            },
          },
          rows,
        ),
      )
    }

    function AiDiaryPanel() {
      return h(
        'div',
        {
          style: {
            height: '100%',
            overflow: 'auto',
            boxSizing: 'border-box',
            padding: '28px 30px 48px',
            display: 'flex',
            justifyContent: 'center',
          },
        },
        h(AiDiaryStudio, {}),
      )
    }

    /** 左侧栏入口图标（官方 sidebar.panellist 会把组件渲染进 panelGlyph） */
    function SideIcon(props) {
      var size = (props && props.size) || 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        h('rect', { x: 1.5, y: 1.5, width: 21, height: 21, rx: 5.5, fill: BRAND, opacity: 0.92 }),
        h('rect', { x: 5.5, y: 6.2, width: 9, height: 1.9, rx: 0.95, fill: '#fff', opacity: 0.95 }),
        h('rect', { x: 5.5, y: 9.6, width: 6.4, height: 1.9, rx: 0.95, fill: '#fff', opacity: 0.55 }),
        h('path', { d: 'M13.4 14.6 L18.6 17 L13.4 19.4 Z', fill: '#fff' }),
      )
    }

    function apply(ctx) {
      // 文案命名空间：官方区块都这么做，缺了它设置外壳不会收进导航
      var t = function (k) {
        var d = DICT.zh
        return (d && d[k]) || k
      }
      try {
        if (ctx.locale) {
          ctx.effect(function () {
            return ctx.locale.register(NS, DICT)
          }, 'ai-diary: locale')
          t = ctx.locale.bind(NS)
        }
      } catch (e) {
        /* 没有 locale 服务时退回内置中文 */
      }

      // 1) 设置页整页
      try {
        ctx.effect(function () {
          return ctx.slots.inject('settings.section', function () {
            return ctx.slots.register(
              {
                name: 'settings.section',
                id: 'ai-diary',
                order: 90,
                label: function () {
                  return t('nav')
                },
                locale: NS,
                inject: function () {
                  return {}
                },
              },
              AiDiarySection,
            )
          })
        }, 'ai-diary: settings section')
      } catch (e) {}

      // 2) 左侧栏入口（与「插件 / 自动化任务 / 更多」同一组）
      try {
        ctx.effect(function () {
          return ctx.slots.inject('sidebar.panellist', function () {
            return ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: 'ai-diary',
                order: 40,
                label: function () {
                  return t('sideNav')
                },
                locale: NS,
              },
              SideIcon,
            )
          })
        }, 'ai-diary: sidebar entry')
      } catch (e) {}

      // 3) 入口点开后的主面板（keyed 槽位，key 与上面的 id 对齐，layout 才认）
      try {
        ctx.effect(function () {
          return ctx.slots.inject('main', function () {
            return ctx.slots.register(
              {
                name: 'main',
                key: 'ai-diary',
                locale: NS,
              },
              AiDiaryPanel,
            )
          })
        }, 'ai-diary: main panel')
      } catch (e) {}

      // 4) 挂件：挂在「插件制作 / 标准模式」那一排的右端（conversation.hero.options
      //    是 right-aligned、排在 workspace 与 preset 之后的 list 槽位）
      try {
        ctx.effect(function () {
          return ctx.slots.inject('conversation.hero.options', function () {
            return ctx.slots.register(
              {
                name: 'conversation.hero.options',
                id: 'ai-diary',
                order: 40,
              },
              PluginChip,
            )
          })
        }, 'ai-diary: composer chip')
      } catch (e) {}

      // 5) 卡片本体：放 frame 级 overlay 槽位，不会被 composer 裁掉，也不需要 createPortal
      try {
        ctx.effect(function () {
          return ctx.slots.inject('shell.overlay', function () {
            return ctx.slots.register(
              {
                name: 'shell.overlay',
                id: 'ai-diary-menu',
                order: 900,
              },
              DiaryPopover,
            )
          })
        }, 'ai-diary: chip menu')
      } catch (e) {}
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.__test = { AiDiarySection: AiDiarySection, AiDiaryPanel: AiDiaryPanel, CONFIG_URL: CONFIG_URL, NS: NS }
    return module.exports
  },
})
