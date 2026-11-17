# dsh-plugin-ai-diary

给 **DeepSeek Harness（dsh）** 用的一个插件：把「AI 角色日记短剧」从选题到发布整条链子做成 18 个工具（16 个 `ai_diary_*` + 2 个 `pc_*`），画面由本地渲染引擎合成，配音与动态底板才可选调用外部接口；投稿、回评论、选素材都能在哔哩哔哩客户端里真机自动完成，不开浏览器。

## v0.8.1：设置页终于出现了，左侧栏也多了个入口

前几个版本「AI 日记工坊」死活不进设置页。真因不在槽位名、也不在 `dsh.client` 声明，而是**注册少了两样东西**。解开 `app.asar` 直接看官方 `@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js`，它的写法是：

```js
const NS = 'settings.plugins'
const inject = ['slots', 'locale']
function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugins',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
  }, PluginsSettingsSection))
}
exports.inject = inject
```

对照我们之前的写法，缺的就是 **`locale` 命名空间**（`ctx.locale.register` + 注册时带 `locale: NS` + `exports.inject` 含 `'locale'`）。补上之后设置页立刻出现。

这一版另外做了四件事：

| 改动 | 说明 |
|---|---|
| 修「渲染算力」三态被裁 | `自动` 原来被挤出容器右缘：文本区改为 `flex:1 1 200px`、控件区 `flexShrink:0` + 允许换行 |
| 新增 API Key 区 | 小米 MiMo / 阿里千问 / MiniMax / 火山 ARK / B 站 Cookie / GitHub Token，各带就绪状态点、掩码预览、单独保存；设了环境变量后自动只读 |
| 新增「立即出片」 | 面板上一键跑完整流程（选题→剧本→渲染→配音→投稿前停住），走 `SCH.runOnce`，长任务后台执行不阻塞请求 |
| 左侧栏入口 + 主面板 | 注册 `sidebar.panellist`（与「插件 / 自动化任务 / 更多」同组）与 `main` keyed 面板，点开直接在中间栏出片 |
| 插件图标 | `assets/icon.svg` + `package.json` 的 `icon` 字段，插件列表里不再是默认灰块 |


灵感来自 `dsh-ai-diary` 那种「静态立绘 + 代码动效」的做法，也接着 B 站上那条《【Day7】余额只剩一块钱，我问他是不是不要我了》的调子——但它不靠生成模型烧额度，靠模板 + 确定性绘制；真要动态底板时才走 Seedance / MiniMax H3。

## 安装（30 秒）

```bash
dsh plugin --profile <你的profile> add "<插件包路径>\dist\dsh-plugin-ai-diary-0.7.4.tgz"
```

桌面版（profile 被 Electron 独占）用一键脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

装完 `dsh --profile <profile> --dump-config` 里能看到 `ai-diary` 就成功了。详见 `INSTALL.md`。

## 0.7.8 更新了什么

**设置面板第 4 次不显示的真正根因修掉了。** 前几轮把「官方 settings wire 白名单」当成唯一原因，其实还有一道门：客户端插件必须在 `package.json` 的 `dsh.client` 里声明它要注入的宿主客户端包，`ctx.slots` 来自 `@deepseek-ai/dsh-client-ui-slots`。只写 `platform: "web"` 而不写 `inject`，加载器会连 `apply` 都不调，静默跳过——面板当然永远不出现。对照 `dsh-drawai`（同为 web 客户端插件、工作正常）的声明方式补上：

```json
"dsh": {
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-ui-slots"]
  }
}
```

两个 `inject` 不是一个东西：这里的数组写**包名**，`lib/client.js` 末尾的 `exports.inject = ['slots']` 写**服务名**，一一对应。

**GPU 编码 + CPU/GPU 开关。** 本机双显卡（NVIDIA MX250 2GB + Intel UHD），ffmpeg 侧可用 `h264_nvenc` / `h264_qsv` / `h264_amf`。新增 `render.accelerator`：`cpu` / `gpu` / `auto`（默认 auto，实测到硬件就用硬件）。

首帧探测会自动跑一次空编码确认哪条硬件路径真能用（本机 NVENC 探测失败、QSV 通过），结果缓存。同体积下实测：

| 配置 | 36 秒 1080p 耗时 | 码率 / 体积 |
|---|---|---|
| CPU 4 段（libx264 crf17） | 65.6s | 4687 kb/s / 21.1 MB |
| **GPU 4 段（QSV q15）** | **34.5s（1.9×）** | 4616 kb/s / 20.8 MB |

瓶颈始终在 Skia 逐帧绘制（纯 CPU），所以 GPU 模式下**照样并行绘制**，编码那一步交给显卡。质量档位是按「体积对齐 x264 crf17」调出来的，不是盲目追速度。

```powershell
node bin/ai-diary.mjs render --script out/day7.json --accelerator gpu   # 显卡编码
node bin/ai-diary.mjs render --script out/day7.json --accelerator cpu   # 纯 CPU
```

**H3 五档模型全开。** `ai_diary_hailuo` 的 `model` 从两档扩到五档，价格与分辨率都按官方价目表校验：

| 档位 | 分辨率 | 时长 | 参考图 | 输出价 |
|---|---|---|---|---|
| MiniMax-H3 | 768P / 2K | 4–15s | 支持 | ¥0.50 / ¥0.80 每秒 |
| MiniMax-H3-Highspeed | 480P / 768P | 4–15s | 支持 | ¥0.26 / ¥0.40 |
| MiniMax-H3-Lite | 480P / 768P | 4–15s | 不支持 | ¥0.16 / ¥0.26 |
| MiniMax-H3-Max | 480P / 768P | 5–15s | 支持（图文音） | ¥0.33 / ¥0.50 |
| MiniMax-H3-Regeneration | 2K（768P→2K） | — | 输入需视频 | ¥0.30 每秒 |

`models: true` 可以一次列出全部档位与价格；`H3-Regeneration` 走独立的 `/v2/video_regeneration`，只要 `source_video` 给一段可公网访问的 768P 成片，不需要 prompt。

**Seedream 图片模型接入。** 新增第 18 个工具 `ai_diary_seedream`：火山方舟 Ark 的 `/api/v3/images/generations`，`seedream-4.0`（支持参考图，角色一致性靠它）/ `seedream-3.0`，尺寸 1K/2K/4K 或具体像素，`n` 一次最多 4 张，本地参考图自动转 data URI。产物落 `assets/generated/`，`out` 可以直接覆盖某个立绘档位。需要 `ARK_API_KEY`（设置里 `keys.ark`）。

## 0.7.7 更新了什么

**设置面板真的会出现了。** 之前「设置」页里怎么都看不见本插件，原因是 Harness 的 settings wire 只服务一份硬编码的命名空间白名单，第三方插件的命名空间不在里面——所以官方面板永远拿不到、也写不了本插件的配置。修法与 `dsh-plugin-memory` 一致：

- 插件自己注册 `settings.section` 槽位（`lib/client.js`，零构建，`require('react')`）；
- 服务端开一条自己的 HTTP 路由 `GET/POST /api/ai-diary/config`；
- 面板直连该路由，读配置、写配置、触发查新与更新。

面板里有：版本与「本地/远端」状态、启动自动查新、查到自动安装两个开关、超采样倍数、帧率、并行线程数，以及「查新」「立即更新」两个按钮。

**渲染提速：分段并行。** 整片按帧切成 N 段，各自用独立进程绘制 + 编码（x264），最后 ffmpeg 无损 concat 成一条。绘制是纯 CPU 串行，切段后才真正吃满多核。

实测（本机 8 逻辑核，1080×1920 @24fps，36 秒片 864 帧）：

| 方式 | 耗时 | 成片 |
|---|---|---|
| 单片 `--workers 1` | 87.3s | 1080×1920，24fps，4.95 Mbps |
| 4 段并行（默认） | **63.2s** | 同上，逐帧一致 |

默认「自动」= 核数一半、最多 4 段；`--workers 1` 关闭并行；设置面板里也能改。段太短（<48 帧）会自动退回单片，避免进程启动开销盖过收益。

## 0.7.6 更新了什么

**默认全自动。** 装上 0.7.6 之后不用再管更新这件事：

- `autoInstall` 默认改成 **true** —— 启动 8 秒后查到新版本就自己下载、自己装进本机 profile，你下次重启 Harness 就是新版。
- **失败冷却 6 小时**：自动装要是没成功（网络断、pnpm 报错），不会每次启动都拿坏包重试，只在 `update-state.json` 记一笔，6 小时后再说。
- 体检「版本」这一行现在**断网也能用**：联网时实时比对，断网时回落到上次查新结果，告诉你「上次查到有新版 X」。
- 有新版且 `autoInstall` 开着时，体检会多一行「自动更新：已开，下次启动会自动装」。
- CLI 帮助补上了 `update --action auto` 的说明。

## 0.7.5 更新了什么

**自动更新。** 以前查新要手打命令，现在三条路都通：

```powershell
node bin/ai-diary.mjs update --action auto     # 一条命令：查新 → 下载 → 装进本机 profile
node bin/ai-diary.mjs update --action check    # 只查，不动
node bin/ai-diary.mjs status --online          # 体检里看「版本」那一行
```

- 插件启动 8 秒后会**静默查一次新版本**（不阻塞、失败不报错），结果写进 `~/.ai-diary/update-state.json`，体检面板离线也能看到上次查到什么。
- `update --action auto` 会自己扫 `~/.dsh/profiles/*` 里装了本插件的 profile，把 tgz 落到 `~/.dsh/plugin-packages/`、备份 `package.json`、改依赖、跑 pnpm、顺手补 `vendor\ffmpeg.exe`——**装完完全退出 Harness 再启动才生效**。
- 设置面板多了「自动更新」组：`autoCheck`（默认开，只查）、`autoInstall`（默认关，查到就自动装）。
- 装失败会回滚到备份的 `package.json`，不会把 profile 弄坏。

**为什么 Harness 插件页不显示「可更新」**：那个页面只读 profile 里 `package.json` 的依赖，不会去 GitHub 查；本插件是本地 tgz 装的、不在 npm，所以永远不会有那个小红点。查新看这里：`ai_diary_update` / `status --online`。

## 0.7.4 更新了什么

**投稿前先自检成片规格。** `ai_diary_publish` 与 `ai_diary_post` 现在会把视频喂给 ffmpeg 读一遍，直接告诉你 `1080×1920 / 49.8s / 35MB`；不是 9:16、宽度不到 1080、时长太短、超过单文件上限，都会先列出来再继续 —— 别把旧 720p 的片子当新规格投出去，白掉一次推荐。顺带体检面板多了一行「成片规格」。

**评论：更像人在回。**
- `match` 支持三种写法：子串、**关键词数组**、`/正则/`（例如 `/感谢|谢谢/`）。
- 规则可以带 `replies` 文案池，每次从池里挑一句，并自动**避开最近 20 条用过的句子** —— 同一句连刷很像机器人。
- 新增时间窗口 `recentHours`（默认 72 小时）：只回最近冒出来的评论，不会把几个月前的旧评论翻出来互动。工具里传 `recent_hours` 可临时覆盖，`0` 表示不限。
- 去重账本从 199 条扩到 499 条，跨轮不会再重复回同一条（之前回过的 rpid 记住就不动）。

## 0.7.3 更新了什么

**成片升到 1080p，不是把 720p 拉大。** 渲染改成超采样：布局仍然按 720×1280 这套紧凑坐标写（字号、圆角、边距一个值都不用改），但画布按 1.5× 真实像素绘制，文字和立绘都是重新光栅化的 —— 素材本身就够（立绘 1536×1536、背景 2730×1536）。输出 1080×1920，`-crf 17 / preset medium / high profile`。

```powershell
node bin/ai-diary.mjs render --script out/day18-report.json          # 默认就出 1080×1920
node bin/ai-diary.mjs render --script out/x.json --scale 1           # 想快就看 720p
node bin/ai-diary.mjs render --script out/x.json --scale 2           # 1440×2560
```

实测 49.79 秒片：1080p 出 1195 帧、130 秒渲染（720p 时约 50 秒，2.6 倍）。设置面板里新增「成片规格」组（`render.scale` / `render.fps`），改一次全局生效；动态底板也默认按 1080×1920 生成，不再二次放大。

**一屏体检：`node bin/ai-diary.mjs status`。**

装完插件最烦的是「到底哪一步没配好」——现在一条命令全看清：

```
AI 日记工坊 0.8.0 · 体检
─────────────────────────────
✓ 9/12 通过，没有硬故障（未配置 2，注意 1）

[环境]  Node 22 / ffmpeg / 画布库 / 设置文件可写
[账号]  B 站登录态：SESSDATA+bili_jct 齐不齐、有没有 buvid3
[发布]  客户端路径在不在
[内容]  6 套模板 / 7 套底板 / 16 张立绘 + 88 张变体 / 6 段角色短片 / 13 条题材
[定时]  开没开、上次跑成什么样
[下一步] 一条条给出该跑哪个命令
```

- 只读检查，不改设置、不动客户端、不发请求；加 `--online` 才会顺带验 B 站登录态（回显你的昵称与 UID）、探活 ComfyUI、查有没有新版本。
- `--json` 出结构化结果给脚本用，`--no-color` 去掉 ANSI（日志/CI 友好）。
- 同一套检查也进了工具：`ai_diary_settings { action: "status" }`，模型可以直接问「插件现在缺什么」。
- 中文标签按终端显示宽度补齐（CJK 算 2 格），所以列真的对得齐，不是靠猜空格。

**ffmpeg 一键补齐。** 体检暴露过一个真问题：tgz 里不含 `vendor\ffmpeg.exe`，只装包、机器上又没 ffmpeg 的人渲染不出来。现在 `node scripts/get-ffmpeg.mjs` 一条命令解决：

```powershell
node scripts\get-ffmpeg.mjs                  # 自动选源（GitHub BtbN / gyan.dev），下 202 MB 完整构建，解到 vendor\，跑 -version 验收
node scripts\get-ffmpeg.mjs --zip .\ffmpeg.zip   # 离线：拿已经下好的压缩包，不联网
$env:HTTPS_PROXY="http://127.0.0.1:7897"; node scripts\get-ffmpeg.mjs   # GitHub 直连被 reset 时
```

解出来 170 MB、`ffmpeg version N-128959-…`，实测在装好的 profile 里跑通，体检从 9/12 变成 10/12（剩下两项是 Cookie 与定时，属可选）。

## 0.7.1 更新了什么

**配 Cookie 不用再开浏览器了：扫码登录。**

- 新增 `scripts/qr-login.mjs`：走 B 站网页扫码登录的同一组公开接口（`/x/passport-login/web/qrcode/generate` 出码、`.../poll` 轮询），终端生成登录二维码 → 手机哔哩哔哩 App「扫一扫」→ 手机上点「确认登录」→ 脚本直接拿到 `SESSDATA` / `bili_jct` / `DedeUserID` 并写进 `keys.bili`。**不碰浏览器、不用 F12、不用关浏览器。**
- 顺带把客户端 Cookie 库里那条匿名 `buvid3` 带上——客户端这条路唯一有用的东西，扫码时少一层风控（`-412` 就是缺它）。
- 新增零依赖二维码编码 `src/qr.mjs`：byte 模式 / 纠错 L / 版本 1–10 / 固定 mask 0，外加灰度 PNG 编码。矩阵与 python `qrcode` 库逐模块比对 **0 差异**（可跑 `node scripts/qr-login.mjs --selftest` 复核）。
- 拿到 Cookie 后仍然先跑 `comments --action auth` 再 `--action auto`，别一上来就发。

## 0.7.0 更新了什么

评论回复换主路线：**走评论接口，不再靠截图点「发表回复」。**

- 新增 `ai_diary_comments action=auth`：只验 Cookie 能不能用（读登录态 + 自己最近稿件），不发任何回复。
- `action=auto` 支持 `mode`：
  - `api`：读自己最近稿件 → 拉评论（`/x/v2/reply/wbi/main`）→ 规则匹配 → `POST /x/v2/reply/add` 发送。全程不碰窗口、不截图。
  - `gui`：原来那套截图 + OCR 点按钮。
  - `hybrid`（默认）：接口优先；只有接口报 `-101`（登录失效）/`-412`（缺 buvid3 或被拦）/`25004`（风控）时才回退点按钮，且只回退一次。
- **回复语义是对的**：带上 `root`（根评论 rpid）与 `parent`（被回复评论 rpid），所以是真的"回复这条评论"，不会变成该稿件下的新评论。
- **限频按平台节拍**：默认 30 秒一条、单轮最多 3 条（`comments.apiGapMs` / `comments.maxPerRun`）。这是平台规则，快不了，也不要试着绕过。
- **去重**：以 `rpid:` 记账（比旧的文本指纹准，同一句话换个号发也不会重复回）；自己发的、楼里已经回过我的，都会跳过。
- **WBI 签名**：读稿件与读评论用的是要签名的接口（`w_rid` + `wts`，mixin key 由 `img_key`/`sub_key` 重排后截 32 位、MD5），每天轮换，所以每次运行现取，不长期缓存。
- **Cookie 怎么配**：设置里 `keys.bili` 填 `SESSDATA=…; bili_jct=…; buvid3=…`，或设环境变量 `BILI_COOKIE`。命令行也能写：`node bin/ai-diary.mjs settings --action set --bili "SESSDATA=…; bili_jct=…; buvid3=…"`。
  - **最省事：扫码登录，不碰浏览器** —— `node scripts/qr-login.mjs --write`。终端出登录二维码（`out/qr-login.png`，会自动打开），手机哔哩哔哩 App「扫一扫」→ 手机上点确认，脚本轮询到结果后把 `SESSDATA` / `bili_jct` / `DedeUserID` 直接写进设置。不用登录过网页版、不用 F12、不用关浏览器；二维码只有几分钟寿命，失效会自动换一张。
  - 手动：浏览器登录 bilibili.com → F12 → Application → Cookies → `https://www.bilibili.com` → 复制 `SESSDATA`、`bili_jct`、`buvid3`。`SESSDATA` 是 HttpOnly，只能在 Application 面板看，`document.cookie` 拿不到。
  - 自动：`node scripts/grab-cookie.mjs --browser edge --write`（读 Edge 的 cookie 库，DPAPI 还原密钥 + AES-256-GCM 解密，直接写进设置）。两个实测约束：**Edge 运行时会独占锁住 cookie 库，要先完全退出 Edge**；Chrome 新版是 v20(app_bound) 加密，读不了，会明确报错而不是吐乱码。
  - 哔哩哔哩客户端**不行**：它的 cookie 库里只有匿名 `buvid3`/`buvid4`，没有 `SESSDATA`/`bili_jct`——客户端登录走的是 App 凭据，不是网页 Cookie。
- **真机状态**：接口路径已联通并验证 —— 假 Cookie 会正确返回 `-101`；匿名读一条公开评论能解析出 rpid/作者/正文；稿件列表还带了一条创作中心备用通道。**真发需要你自己的 Cookie**，配好后先跑 `action=auth` 再 `action=auto`（不带 `send` 是预演）。
- **命令行**：`node bin/ai-diary.mjs comments --action auth`、`node bin/ai-diary.mjs comments --action auto --mode api|gui|hybrid --send true --max 3`。

## 0.6.0 更新了什么

- **自动投稿（真点按钮）**：设置里的 `publish.autoSubmit` 打开后，填完标题/声明/标签就自己点「立即投稿」；定时任务里同样按这个开关走。默认关，关着还是停在按钮前等你点——投稿是对外不可逆动作，所以默认不代点。
- **评论自动回复 `ai_diary_comments`**：改成 `action` 用法 —— `calibrate`（打开评论管理页并回传截图 + 本机 OCR 结果）、`scan`（列出当前能读到的评论）、`auto`（按规则匹配并回复，`send` 默认 false 只出计划）、`watch`（挂一段时间，每 N 分钟扫一次）。
  - 规则形如 `[{"match":"催更","reply":"今晚就更～"}]`，`match` 写 `*` 是兜底；`fallback` 支持 `{comment}` 占位。
  - 每条只回一次：按评论文本指纹（sha1 前 12 位）记账，已回记录落在 `~/.ai-diary/settings.json` 的 `comments.replied`。
  - 限速：单轮默认最多 3 条（上限 10），两条之间至少 8 秒；`watch` 默认 30 分钟、5 分钟一轮，日志写 `comments.watch`。
- **怎么"看见"评论区**：客户端是 Electron，DOM 读不到文字，所以走「截图 → Windows 自带 OCR（`scripts/ocr.ps1`）→ 按界面文字定位」。小字认不准时会先 `scripts/crop.ps1` 把局部放大 3 倍再 OCR。
- **不盲点**：进评论页是「点『互动管理』→ 认到『评论管理』→ 点 → 校验页面出现『评论管理/全部评论』」，任一步认不到就停下并给截图路径；点「回复」前会先把那一行放大认字，认不到就跳过；一旦出现「删除提醒」弹窗立刻点「取消」并终止本次自动回复。
- **窗口置顶**：Windows 前台锁会拦掉 `SetForegroundWindow`，所以截图前会自动把客户端窗口顶到最前（必要时用 Alt+Tab 轮转并校验），否则截到的是压在上面的别的窗口。
- **真机状态（重要）**：评论页导航、扫描、出计划、按行定位「回复」都已在真机跑通；点「发表回复」那一下还没跑通——客户端把按钮画成灰色小字，OCR 认不稳，流程会在填入前停下并提示你，不会乱点。这一版不宣称"全自动发评论成功"。
- **命令行**：`node bin/ai-diary.mjs comments --action scan|calibrate|auto|watch`（`--send true` / `--max` / `--minutes` / `--interval`）。
- 工具数仍是 17 个，本次只扩参数与动作。

## 0.5.0 更新了什么

- **官方设置里的插件配置**：插件导出一份 `Config`（cordis / schemastery）声明 —— 四个 API Key、默认配音服务商与音色、ComfyUI 地址、发布策略、定时任务开关。Harness 的插件设置面板按这份 schema 生成表单项；同一份配置也能用 `ai_diary_settings` 工具读写（`get` / `set` / `reset`）。
- **设置落盘**：`~/.ai-diary/settings.json`（重装插件不丢；`AIDIARY_SETTINGS=<绝对路径>` 可换位置）。**环境变量优先**：`MIMO_API_KEY` / `DASHSCOPE_API_KEY` / `MINIMAX_API_KEY` / `GITHUB_TOKEN` 照旧可用，设了就压过文件里的值。
- **定时自动出片 `ai_diary_schedule`**：到点自己选题 → 编剧本 → 本地渲染出片 →（对应服务商 key 就绪才）配音 → 把成片交给哔哩哔哩客户端并填好标题/标签/声明，**停在「立即投稿」前不代点**；`comments:true` 顺带打开评论管理页。
  - 默认关闭，必须显式 `enable` 才动；一天只跑一次；只在设定那一分钟内触发，睡过头不半夜补跑；插件卸载定时器跟着停。
  - 成片落在 `out/scheduled/<剧本id>-<时间戳>.mp4`，不覆盖已有文件；执行结果记进设置文件的 `schedule.runs`（保留最近 7 条）。
- **命令行同步**：`node bin/ai-diary.mjs settings` 看配置，`settings --action set --mimo <key> --provider qwen` 写 key；`node bin/ai-diary.mjs schedule --action status|enable|disable|run-now --at 20:30`。
- **工具 15 → 17**。

## 0.4.4 更新了什么

- **联网自更新 `ai_diary_update`**：查 GitHub Releases（`action:check`，只读）→ 下载 tgz（`action:download`，校验 sha256）→ 按 profile 安装（`action:apply`）。更新源写在 `config/update.json` 的 `repo`；公开仓库不需要 token，私有仓库设 `GITHUB_TOKEN`。**不会静默安装**：不传 profile 就只下载并给出命令。
- **新增 `PROJECT-INTRO.md` 介绍文档**：定位、能力矩阵、工具职责、快速开始、素材体系、架构、边界与 Roadmap。
- **新增 `publish-github.ps1`**：一条命令完成建仓 + 推源码 + 建 Release + 上传 tgz + 回写更新源；`.gitignore` 把 `vendor/`、`dist/`、`work/`、`out/`、`assets/plates/` 排除在外（223MB 的包只走 Release，不进 git）。
- **工具 14 → 15**。

## 0.4.3 更新了什么

- **新增本地模型接入 `ai_diary_local`**：直连本机 ComfyUI（秋叶整合包也行），用 D 盘那 6 个 `.safetensors` 出图 —— 动漫 ReVAnimated、dark sushi、AWPainting、majicMIX 写实、室内风格、LandscapeBING。`action:probe` 探活、`action:models` 列服务端底模与本机文件、`action:gen` 按提示词出图落盘。纯本地跑，不联网、不消耗生成额度；ComfyUI 没起来只返回启动方法，不重试。
- **新增角色短片 `ai_diary_motion`**：把 Seedance 生成的 5 秒角色短片收进插件（`action:import`）、列清单（`action:list`）、转 9:16 动态底板（`action:plate`）。已收 6 条：deepseek / gpt / gemini / claude / grok / glm，各 5.06s / 720×720；qwen、kimi 还缺。
- **工具 12 → 14**；安装后校验脚本断言 14 工具 / 88 立绘 / 6 条短片。

## 0.4.2 更新了什么

- **补齐角色动态提示词**：PROMPTS-VIDEO.md 新增第 7 节，8 个角色各一条 5 秒 9:16 图生视频提示词（首帧用 _chibi_v16.png），含各角色可辨识的动态细节与公共约束；第 8 节记录 2026-11-16 的额度实测结果。

## 0.4.1 更新了什么

- **立绘 56 → 88 张**：8 个角色各再加 4 张新姿势 —— `v16` 剪刀手叉腰眨眼、`v17` 双手捧脸大笑、`v18` 坐地前伸腿撑手、`v19` 伸手指向你。全部以原版 chibi 立绘作参考锁身份（发色、兽耳/角/尾/翼、服装与饰品一律不动），只换动作；已抠透明 + 裁空边 + 缩到 1200px 高。
- 现在每个角色可选 `v2`–`v5`、`v10`、`v11`、`v16`–`v19`；deepseek 另有 `v6`–`v9`（换装套）与 `v12`–`v15`（跳跃 / 蹲姿托腮 / 叉腰 / 高脚凳）。
- 立绘总量 94.4MB（88 张，平均约 1.1MB/张）。

## 0.4.0 更新了什么

- **融合 `dsh-pc-control` 电脑操控引擎**：插件内置 `scripts/pc-engine.ps1`（P/Invoke 底层，24.8KB）与 `scripts/PcNative.cs`，新增 `pc_see` / `pc_act` 两个工具。文本优先观察（`windows` / `tree` / `find` / `text`），只有 `shot` 才出图；动作串一次多步（`focus` / `click` / `move` / `scroll` / `key` / `paste` / `wait` / `stop`），14 步 dry-run 自检通过。工作目录在 `%LOCALAPPDATA%\dsh-plugin-ai-diary\pc`，截图 30 分钟自动清理。
- **真·客户端投稿 `ai_diary_post`**：不用浏览器，直接操作哔哩哔哩客户端 —— 拉起客户端 → 点左侧栏上传图标打开创作中心 → 点「上传视频」→ 原生文件对话框里 `paste` 绝对路径 + 回车 → 轮询等待「上传完成」→ 自动填封面/标题/创作声明/分区/标签/简介 → 停在「立即投稿」前回传截图。锚点全在 `config/bili.json`，客户端改版只改配置不改代码。
- **评论回复 `ai_diary_comments`**：打开「互动管理 → 评论管理」并截图，可带 `reply` 填进回复框；`send:false` 默认不点发送。
- **素材自动选配 `ai_diary_pick`**：情绪 → 立绘模样（`MOOD_LOOKS`）、模板 → 动态底板与背景（`TEMPLATE_PLATES` / `TEMPLATE_BG`），并给出封面候选；`ready:false` 时说明还缺哪张图。
- **立绘 36 → 56 张，v4/v5 换代**：8 个角色各重出 4 张新姿势（参考原版 chibi 立绘锁身份，只换动作），其中 2 张覆盖旧的 `v4`/`v5`，另 2 张新开 `v10` 挥手打招呼 / `v11` 抬手拢发。deepseek 再多 4 张：`v12` 双手举高跳跃、`v13` 半蹲撑地托腮、`v14` 叉腰前倾得意、`v15` 高脚凳托腮晃腿，共 8 套。旧图备份在 `work/variants-backup-poses/`。
- **体积治理**：变体立绘统一缩到 1200px 高（引擎实际只用到约 1060px），56 张从 147.7MB 压到 57.1MB，透明通道保留。
- **工具 7 → 12**；`load-test.mjs` 断言 12 个工具全部注册通过。

## 0.3.1 更新了什么

- **deepseek 单独加到 9 套模样**：在 v2–v5 之外新增 v6 水手服通勤（托特包 + 合拢长柄伞）、v7 冬日居家（鳞纹家居服抱鲸鱼玩偶）、v8 运动装（水壶喝水 + 护膝）、v9 夏日祭（浴衣 + 鲸鱼纸灯笼 + 木履）。四张都经过「纯白底 → 抠透明 → 裁空边」，落在 `assets/characters/transparent/variants/`，现共 36 张变体立绘。
- **`look` 取消固定枚举**：原来只认 `v1..v5`，现在传任意后缀都行，前端只做存在性检查，缺图回退原版 —— 以后往 `variants/` 里丢一张 `<角色>_<chibi|adult>_<后缀>.png` 就能直接用，不用改代码。
- v9 初版画面左上多出一盏没人提的悬空纸灯笼，已单独修掉重抠，成片里只剩她手里那盏。

## 0.3.0 更新了什么

- **立绘扩容到 32 张**：8 个角色各 4 套（v2 居家 / v3 外出 / v4 姿势 A / v5 姿势 B），全部经 MediaKit 抠透明 + 裁空边，落在 `assets/characters/transparent/variants/`；渲染时 `--look v2|v3|v4|v5`（或剧本 `episode.look`）直接切，缺图自动回退原版。
- **真视频底板**：`audit` / `specimen` 两套底板改为从用户自生成视频（听证室 / 标本室运镜）抽帧重建，各 96 帧 / 8s / 12fps；成片里能看到真实的镜头移动与光斑。
- **配音接三家**：`ai_diary_voice` 现在支持 `xiaomi`（小米 MiMo）/ `qwen`（千问 Qwen-TTS，`qwen3-tts-flash`）/ `minimax`（T2A `v1/t2a_v2`，hex 音频），接口形态见下表；八角色在三家各配一色，逐镜按镜头时长对齐后混流。
- **MiniMax H3 视频接口**：新增 `ai_diary_hailuo`（创建任务 → 10s 轮询 → 下载 `task.content.url`），支持文生 / 首帧 / 首尾帧 / 多模态参考，默认 `dry_run` 不扣费。
- **工具 6 → 7**，模板 6 套、题材 13 条不变；`render --look`、`render --voice --provider`、CLI 新增 `video` 子命令。
- **打包**：`dist/dsh-plugin-ai-diary-0.3.0.tgz`（含新底板、32 张立绘、voice/hailuo 模块、config 样例）。

## 0.2.0 更新了什么

- **模板 4 → 6**：新增 `audit`（聽證記錄：墨绿条文头 + 条文 + 旋转「已覆核」章 + 開庭/陳述/對質/覆核章节 + HEARING HUD）与 `specimen`（暗色玻璃观察板 + 16 格刻度尺 + 情緒指數条 + 呼吸圆环 + 温湿度 HUD）。
- **空镜 9 → 12 张**：新增听证室、标本观察室、深夜月台（Seedream 5.0 flash 生成，均 1080×1920，右侧留白给立绘）。
- **动态底板 3 → 6 套**：audit / specimen / platform 由静帧程序化推近 + 颗粒 + 光照微颤，各 96 帧 / 8s / 12fps。
- **题材 11 → 13 条**：day23-audit、day28-specimen。
- **成片质量**：libx264 CRF 20 → 18，同片体积 +15% 左右，暗部噪点明显收敛。
- **token**：`plan --all` 一条命令编译整库 13 条剧本，只回一行一题材的摘要，省掉 13 轮对话。
- **安装**：`npm pack` 打包件 + `INSTALL.md` + `install.ps1`（link / tgz / 卸载三种模式实测通过）。
- **提示词包**：`PROMPTS-VIDEO.md` 里有 6 套模板的 Seedance 2.5 底板视频提示词（含通用约束、首帧重生 Prompt、验收表）。

## 它解决什么

| 痛点 | 这个插件的做法 |
|---|---|
| 每条片子都要重新想题材 | 内置原创题材库 + 选题器，优先挑没做过的，可换角色做变体 |
| 视频生成按秒烧钱、还不可控 | 本地渲染引擎：剧本 JSON 进去，MP4 出来，成本是几秒 CPU |
| 一次生成要吐很多 token | 剧本是模板编译的，时长/字数/镜头表全是本地算的，几乎零 token |
| 手动上传 B 站 | 走本机「哔哩哔哩客户端」：文案自动进剪贴板 + 落 sidecar，带视频启动客户端，最后一步人来点 |

## 十五个工具

| 工具 | 干什么 | 耗不耗额度 |
|---|---|---|
| `ai_diary_topics` | 选题，给题材 id / 标题 / 角色 / Day / 余额 | 否 |
| `ai_diary_plan` | 题材 → 剧本 JSON（含每镜时长、分镜表、片长） | 否 |
| `ai_diary_render` | 剧本 JSON → 9:16 MP4 / PNG 帧序列，`look` 切立绘模样 | 否 |
| `ai_diary_voice` | 逐镜配音 + 按时长对齐 + 混流，三家 TTS 任选 | 是（TTS 计费） |
| `ai_diary_hailuo` | MiniMax H3 生成 4–15s 动态底板视频（异步任务） | 是（默认 dry_run 不扣） |
| `ai_diary_assets` | 检查立绘/透明底/背景，缺什么给什么补图提示词 | 否 |
| `ai_diary_publish` | 轻量版：文案进剪贴板 + 带视频启动客户端，停在「投稿」前 | 否 |
| `ai_diary_pick` | 情绪挑立绘、模板挑底板/背景，给封面候选与缺失说明 | 否 |
| `ai_diary_post` | 客户端真投稿：上传 → 等完成 → 填表 → 停在「立即投稿」前（`confirm:false` 不点） | 否 |
| `ai_diary_comments` | 评论自动回复：`auth` 验 Cookie；`auto` 走接口（`mode=api/hybrid`）或截图点按钮（`gui`），`send:false` 只出计划 | 是（要 B 站 Cookie） |
| `ai_diary_local` | 驱动本机 ComfyUI 出图：探活 / 列底模 / 六种风格 / 按提示词生成（D 盘 6 个 .safetensors 都能用） | 否（本地算力） |
| `ai_diary_motion` | 角色动态素材：收短片 / 列清单 / 转 9:16 动态底板（video→plate） | 否 |
| `ai_diary_update` | 联网查新 / 下载 / 按 profile 安装（GitHub Releases） | 否 |
| `ai_diary_settings` | 读写插件设置：API Key、默认配音、ComfyUI 地址、发布策略（key 打码） | 否 |
| `ai_diary_schedule` | 定时自动出片：status / enable / disable / set / run-now | 否 |
| `pc_see` | 电脑观察：`windows` / `tree` / `find` / `text` / `shot`，文本优先省 token | 否 |
| `pc_act` | 电脑动作串：`focus` / `click` / `move` / `scroll` / `key` / `paste` / `wait`，一次多步 | 否 |

## 本地模型（ComfyUI）与角色短片

不想消耗任何生成额度时，插件直接驱动本机 ComfyUI 出图：

```powershell
node bin/ai-diary.mjs local --action probe      # 探活：返回显卡名与显存
node bin/ai-diary.mjs local --action models     # 服务端认得的底模 + 本机 .safetensors
node bin/ai-diary.mjs local --prompt "1girl, blue hair, maid outfit, white background" `
  --style anime --width 768 --height 1024 --steps 28 --out out\local\ds.png
```

| style | 用的底模 | 适合 |
|---|---|---|
| `anime` | 动漫ReVAnimated_v1.1 | 角色立绘、表情包 |
| `anime2` | dark sushi mix | Q 版、社媒封面 |
| `paint` | AWPainting_v1.2 | 氛围插画、片头卡 |
| `realistic` | majicMIX realistic v7 | 写实场景、产品图 |
| `interior` | 室内现代风格 V4.0 | 房间类背景 |
| `landscape` | LandscapeBING | 空镜、底板静帧 |

前提：ComfyUI 已在 8188 端口跑起来（秋叶版在 `D:\ComfyUI-aki-v3.2\ComfyUI-aki-v3.2`，双击「A绘世启动器」或 `python main.py --port 8188`），底模放在它的 `models\checkpoints` 下。没起来时工具只返回启动方法，不会反复重试。

角色短片（Seedance 生成的 5 秒循环）：

```powershell
node bin/ai-diary.mjs motion                                         # 列已有短片
node bin/ai-diary.mjs motion --action import --from "X:\豆包 (8).mp4" --character qwen
node bin/ai-diary.mjs motion --action plate --character deepseek --name ds-motion --seconds 5
```

已收 6 条：deepseek / gpt / gemini / claude / grok / glm（各 5.06s · 720×720），`qwen`、`kimi` 还缺。
边界：引擎只能把整段短片转成动态底板，**不能把视频里的透明角色单独抠出来叠到立绘位**。另外这批角色短片是 1:1 的，转 9:16 底板会裁放放大，画面里会和立绘出现「两个自己」（已实测），所以它们更适合当封面 / 片尾 / 宣传素材，而不是当背景层。
- 修掉一个坑：ender --plate 以前只认路径，传底板名（如 --plate ds-motion）会静默回退模板背景；现在名字和路径都认，找不到会打印 warn 并明确说已回退。

## 配音：三家接口对照

| provider | 端点 / 模型 | 鉴权 | 音频取回 | 单次上限 |
|---|---|---|---|---|
| `xiaomi` | `POST https://api.xiaomimimo.com/v1/chat/completions`，`mimo-v2.5-tts`（`-voicedesign` 造声线） | 头 `api-key` | `choices[0].message.audio.data`（base64 wav） | 目标文本必须放 `role: assistant` |
| `qwen` | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`，`qwen3-tts-flash` | `Bearer $DASHSCOPE_API_KEY` | `output.audio.url`（24h）或 `output.audio.data`（base64） | 600 字 |
| `minimax` | `POST https://api.minimax.cn/v1/t2a_v2`，`speech-2.8-hd` / `-turbo` / `02-*` / `01-*` | `Bearer $MINIMAX_API_KEY` | `data.audio`（**hex 编码**） | 10000 字 |

三家都走同一条管线：逐镜合成 → 对镜头时长做 `atempo`（≤1.6×）或 `apad` → 拼轨 → 混流（视频流 copy，画面不重编码）。

```bash
node bin/ai-diary.mjs voice --check                                  # 三家 key 就绪情况
node bin/ai-diary.mjs voice --script out/day23-audit.json --provider qwen --mux out/day23-audit.mp4
```

## MiniMax H3 生成动态底板

```bash
node bin/ai-diary.mjs video --prompt "听证室缓慢前推，尘埃浮动" --from out/check/look-audit.png --duration 8 --dry-run
```

- H3：`POST https://api.minimax.cn/v2/video_generation`，`content[]` 里 `type=text` + `image_url{role:first_frame|last_frame|reference_image}`；`duration` 4–15 整数、`resolution` 768P/2K；图生视频 `ratio` 恒 `adaptive`
- 轮询 `GET /v2/query/video_generation/{task_id}`，`task.status` 到 `succeeded` 后直接拿 `task.content.url` 下载
- 拿到 mp4 后 `plate --from out/h3-xxx.mp4 --name audit --seconds 8` 转成底板

## 六套模板（版面皮肤）

| id | 版面 | 专属底板 |
|---|---|---|
| `classic` | 星夜日记（原版）：星空底、居中立绘、顶部 DAY/余额 HUD | `night-sky.png` |
| `report` | 评测报告：米色网格报告卡 + 右上「01 基本資訊」章节标签 + 左下 `REC SUBJECT` HUD + 右侧立绘（对齐 B 站《倒反天罡，Claude 评测人类》那套报告卡视觉） | `report-desk.png` |
| `dossier` | 机密档案：牛皮纸卷宗 + 档案 tab + 红色「機密」印章 + 竖排档案号 | `dossier-room.png` |
| `terminal` | 数据终端：冷青 CRT 面板 + 扫描线 + 逐行点亮的日志 + 额度条 | `terminal-desk.png` |
| `audit` | 听证记录：米白硬卡 + 墨绿条文头「聽證記錄 / AUDIT HEARING」+ 案號/被聽證/剩餘額度 + 三条记录条文 + 签名线 + 旋转「已覆核」绿章 + 右上 01 開庭→02 陳述→03 對質→04 覆核 + 左下 HEARING HUD | `audit-room.png` |
| `specimen` | 标本观察：暗色玻璃观察板 + 左侧 16 格刻度尺 + 標本觀察記錄 + SPECIMEN No.XX + 樣本/培養天數/剩餘培養液 + 4 格情緒指數条 + 呼吸圆环观察窗 + OBSERVING·LAB 2F 温湿度 HUD | `specimen-lab.png` |

模板族共用同一套动效：背景缓推、光晕呼吸、尘埃上浮、纸卡轻浮、立绘呼吸浮动。全部引擎侧确定性绘制，不消耗生成额度。

```bash
node bin/ai-diary.mjs template                              # 列出模板
node bin/ai-diary.mjs plan --topic day23-audit              # 题材自带模板
node bin/ai-diary.mjs plan --topic day7-balance --template specimen
node bin/ai-diary.mjs plan --all                            # 全题材一次性编译成剧本（省对话轮次）
node bin/ai-diary.mjs render --script out/x.json --template terminal
```

`report`/`dossier`/`terminal`/`audit`/`specimen` 会自动接管底板，题材里写死的旧 `background`（night/warm/…）不会把它压回星空。

## 动态底板（背景层也能动）

静态底图 + 缓推只算「半动态」。底板是真正的逐帧背景：`assets/plates/<模板>/` 下存 `f_0001.jpg…` + `meta.json`（12fps / 96 帧 / 8 秒），引擎按时间取帧、播完自动无缝循环，再往上叠纸卡、立绘、字幕、HUD。

```bash
node bin/ai-diary.mjs plates                                  # 看已有底板
node bin/ai-diary.mjs plate --from assets/backgrounds/report-desk.png --name report
node bin/ai-diary.mjs plate --from out/seedance-report.mp4 --name report   # 视频直接转
node bin/ai-diary.mjs render --script out/day18-report.json --plate report  # 临时换底板
```

三种来源都走同一条命令：

| 来源 | 效果 |
|---|---|
| 静帧 PNG | 程序化动态：推近 + 颗粒 + 光照微颤（零额度，先把管线跑通） |
| 生成模型成片 MP4 | 真运镜；`plate --from` 转一次帧目录即接管，不用改代码。当前 `audit`（听证室）与 `specimen`（标本室）就是用户自生成的 720×1280 视频转来的 |
| MiniMax H3 成片 | `ai_diary_hailuo` 出片后同样走 `plate --from` |
| 任意 9:16 视频 | 同上，自动裁成 720×1280 |

**为什么用帧目录而不是 mp4 管道**：最初版本用 ffmpeg 管道逐帧读 RGBA，撞了三个坑——`Buffer.concat` 累积 354MB（O(n²)）、24fps 引擎重复请求 12fps 帧被误判成「往回跳」导致每帧重启解码、重启时旧进程 `close` 污染新进程状态。改成帧目录 + 小 LRU 缓存后这些都不存在，且背景层 1:1 blit 不再逐帧重采样。

实测（720×1280 / 12 秒 / 288 帧）：纯静态 13.3s，带动态底板 18.7s（约 15fps），50 秒整片一分钟出头出片。

## 渲染引擎做了什么

一帧一帧地画，不猜：

- **背景**：cover 铺满 + 缓慢推近（1.02→1.07 倍），人物站位不被切
- **立绘**：底部对齐、呼吸缩放 ±0.9%、缓慢浮动 ±3px、轻微摆身 ±0.35°
- **余额 HUD**：随「已显示字数 / 总字数」线性递减，¥ 数字 + 电量条同步缩，跌破 3 块时数字闪烁变橙
- **字幕**：按字数逐字出现，自动折行，双层描边压住背景
- **氛围**：星点（固定种子，可复现）、情绪色光、颗粒、暗角；模板族另加光晕呼吸与尘埃上浮
- **模板**：纸卡/印章/CRT 面板按模板绘制，章节标签、REC HUD、日志行随镜头推进更新
- **片头/片尾卡**：标题淡入淡出、结尾「未完待续」
- **编码**：PNG 帧流 → ffmpeg（libx264 / crf 20 / yuv420p / faststart），B 站直接可传

所有随机量用固定种子，同一份剧本每次渲染结果一致——这是它和生成模型最大的区别：**可复现、可 diff、可批量**。

## 装进 dsh

```bash
# 方式一：本地目录（开发期推荐）
dsh plugin --profile web add /path/to/dsh-plugin-ai-diary

# 方式二：从仓库
dsh plugin --profile web add github:<owner>/dsh-plugin-ai-diary
```

包里的 `cordis.patch.yml` 只往插件列表追加一行 `ai-diary`，不动任何官方组件：

```yaml
- insert:
    - id: ai-diary
      name: dsh-plugin-ai-diary
```

装完重启 dsh，会话里直接说「用 ai_diary_topics 挑三个题材」即可。

## 不装 dsh 也能用（命令行）

```bash
cd dsh-plugin-ai-diary
npm install            # 装 @napi-rs/canvas
node bin/ai-diary.mjs topics --count 3
node bin/ai-diary.mjs plan --topic day7-balance
node bin/ai-diary.mjs render --script out/day7-balance.json
node bin/ai-diary.mjs publish --video out/day7-balance.mp4 --dry-run
```

产物在 `out/`。`npm run render:demo` 一条命令出样片。

## 发布到 B 站（默认走客户端，不碰浏览器）

设计成 **程序级半自动**：文案和启动交给程序，最后一下「投稿」留给人。

1. 找客户端：`C:\Program Files\bilibili\哔哩哔哩.exe`（`DIARY_BILI_CLIENT` 可覆盖）。
2. 把标题+简介+标签写进 Windows 剪贴板，同时落一份 `<视频名>.upload.txt` sidecar（客户端崩了文案也不丢）。
3. 带着视频路径启动客户端；已经在运行就只把文件丢给它，不开第二个实例。
4. 你在客户端里进「投稿 / 上传视频」→ 选 `day7-balance.mp4` → `Ctrl+V` 粘贴文案 → 自己点「投稿」。

**默认 `dry_run: true`，任何模式都不会替你点发布。** 发布是不可逆的对外动作。

`mode:"browser"`（CLI 加 `--browser`）保留老方案：Chrome CDP 接管创作中心的，自动填表挂文件；第一次要先用 `.chrome-profile` 那个窗口扫码登录。适合将来想做全自动时用。

> 为什么不做成客户端全自动点击：这需要模拟鼠标去点客户端 GUI。当前会话的桌面操控能力不可用（虚拟桌面初始化失败），而且替用户点「发布」本来就是不该自动做的一步。要做全自动，得先有可用的 GUI 自动化环境。


## ffmpeg

`vendor/ffmpeg.exe` 已经随包带了一份（Windows x64），所以开箱即用。其他平台按这个顺序找：

1. `DIARY_FFMPEG` 环境变量
2. `vendor/ffmpeg(.exe)`
3. PATH 里的 `ffmpeg`
4. `python -c "import imageio_ffmpeg"` 提供的二进制

都没有就 `pip install imageio-ffmpeg` 或自己放一个进 `vendor/`。

## 目录

```
src/index.mjs      dsh 插件入口：defineTool + ctx.tools.register（14 个工具）
src/topics.mjs     选题器（本地规则、去重、变体）
src/script.mjs     剧本模型：校验、时长、分镜表、发布文案
src/engine.mjs     渲染引擎（Skia 绘制 → ffmpeg 编码；含 look 立绘选择）
src/templates.mjs  六套版面皮肤（纸卡 / 印章 / CRT 面板 / 听证卡 / 标本板 / 尘埃）
src/plate.mjs      动态底板读取（帧目录 + LRU）与「静帧/视频 → 帧目录」构建
src/voice.mjs      三家 TTS 适配 + 逐镜对齐 + 拼轨 + 混流 + 配置自检
src/hailuo.mjs     MiniMax H3 视频任务（创建 / 轮询 / 下载 / data URI 兜底）
src/publish.mjs    发布：client 模式（找客户端/剪贴板/sidecar/带视频启动）+ browser 模式（CDP 填表）
bin/ai-diary.mjs   命令行（topics / plan / render / voice / video / template / plate / assets / publish）
config/            voice.json（三家 key 与音色）、video.json（H3 参数）
data/topics.json   原创题材库（13 个题材 × 6–9 句）
assets/            12 张背景位、6 套动态底板 + 1 套角色动态底板、88 张透明立绘、6 条角色短片（8 角色 × v2–v5 + v10/v11 + v16–v19，deepseek 另有 v6–v9 与 v12–v15）
test-voice.mjs     配音管线离线自检（假 wav 走对齐→拼轨→混流）
test-providers.mjs 三家 TTS 解析路径自检（本地假服务器，不耗额度）
vendor/ffmpeg.exe  随包 ffmpeg
out/               剧本 JSON、MP4、渲染日志、选题历史
```

## 已知边界

- 引擎只做「立绘 + 排版」这一类短剧，复杂的实拍感、多角色对打、运镜穿帮它做不了；那是生成模型的地盘。
- 生成模型额度受限时（`当前活动赠送额度不可用于创作场景`），底板退回程序化动态；额度恢复后用 `plate --from` 把 Seedance 成片转成帧目录，即完成升级，无需改代码。
- 表情差分目前靠情绪色光 + 浮动传达，没有逐表情换图（题材库里的 4 种 mood 只驱动色光与节奏）；换套装用 `--look`（v2–v5、v10、v11、v16–v19 全角色；v6–v9、v12–v15 仅 deepseek）。
- **三家 TTS 与 H3 都按官方文档实现，但本机至今没有任何一把 key**（`MIMO_API_KEY` / `DASHSCOPE_API_KEY` / `MINIMAX_API_KEY` 都未配置），所以只做过「接口形态 + 解析路径 + 音轨管线」的离线自检：`test-providers.mjs` 用本地假服务器验证 base64 / URL / hex 三种返回都能落地 wav，`test-voice.mjs` 验证 atempo/apad 与拼轨混流；真实合成尚未联调。
- H3 走的是异步计费接口，工具默认 `dry_run: true`，不传 `dry_run: false` 不会真的扣费。
- B 站接口随时会变；脚本跑失败会返回明确原因，不会假装成功。
- 评论接口这条路要你的 Cookie（`SESSDATA` / `bili_jct` / `buvid3`）。Cookie 等于登录态，别提交进仓库、别发群里；失效了会返回 `-101`，重新取一份就行。
- 评论有平台限频（约 30 秒 1 条）。这个节拍是平台定的，插件只排队不突破；硬绕会被风控（`25004`）甚至封号，不值得。
- 素材授权沿用原项目：社区二创立绘仅个人非商用，商单前别混用。

MIT。
