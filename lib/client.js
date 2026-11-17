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
        minimax: { name: 'MiniMax', hint: 'T2A 配音 + H3 视频共用' },
        ark: { name: '火山方舟 ARK', hint: 'Seedream 出图必填' },
        bili: { name: 'B 站 Cookie', hint: 'SESSDATA=…; bili_jct=…; buvid3=…' },
        github: { name: 'GitHub Token', hint: '拉 Release 查新与自更新' },
      }
      var keyOrder = ['mimo', 'dashscope', 'minimax', 'ark', 'bili', 'github']

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
              hint: '4.0 支持参考图（角色一致性靠它）；需要 ARK key：' + (keys.ark && keys.ark.ready ? '已就绪' : '未配置'),
            },
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
        }
      }, [])

      var studio = (cfg && cfg.studio) || {}
      var assets = studio.assets || { kinds: {}, characters: [], plates: [], backgrounds: [] }
      var films = studio.films || { items: [], total: 0, nextEpisode: 1 }
      var publishLog = studio.publish || []
      var cache = studio.comments || null
      var schedule = studio.schedule || {}
      var textCfg = (cfg && cfg.text) || {}
      var pubCfg = (cfg && cfg.publish) || {}

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
            ),
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
              hint: 'dashscope 用千问（DASHSCOPE_API_KEY）；ark 用豆包（需填接入点 id）；off 只用本地拼装',
            },
              h(
                'select',
                {
                  style: S.sel,
                  value: textCfg.provider || 'dashscope',
                  onChange: function (e) {
                    patch({ text: { provider: e.target.value } })
                  },
                },
                h('option', { value: 'dashscope' }, 'dashscope（千问）'),
                h('option', { value: 'ark' }, 'ark（豆包）'),
                h('option', { value: 'off' }, 'off（不联网）'),
              ),
              h('input', {
                style: Object.assign({}, S.input, { flex: '0 1 150px' }),
                placeholder: 'qwen-plus',
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
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.__test = { AiDiarySection: AiDiarySection, AiDiaryPanel: AiDiaryPanel, CONFIG_URL: CONFIG_URL, NS: NS }
    return module.exports
  },
})
