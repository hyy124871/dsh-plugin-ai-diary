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

    function statusLine(cfg) {
      var st = (cfg && cfg.state) || {}
      var local = (cfg && cfg.version) || '—'
      var remote = st.latest || '—'
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
        setNote(action === 'check' ? '正在查新…' : action === 'update' ? '正在下载并安装，约 1 分钟…' : '已交给后台，正在选题并渲染…')
        getJson(CONFIG_URL, { action: action })
          .then(function (j) {
            setCfg(j)
            if (action === 'check') {
              var c = j.check || {}
              setNote(c.hasUpdate ? '有新版本：' + c.current + ' → ' + c.latest : '已是最新（' + (c.current || j.version) + '）')
            } else if (action === 'update') {
              setNote(
                j.ok
                  ? '已装好 ' + (j.state && j.state.installedVersion ? j.state.installedVersion : j.latest) + '，完全退出 Harness 再启动生效'
                  : '自动更新没走完（' + (j.stage || '') + '）',
              )
            } else {
              setNote('已开始出片：选题 → 剧本 → 渲染 → 配音，通常 2–5 分钟；成片在 ~\\.ai-diary\\out')
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
        h(AiDiarySection, {}),
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
