# dsh-plugin-ai-diary

给 **DeepSeek Harness（dsh）** 用的一个插件：把「AI 角色日记短剧」从选题到发布整条链子做成 17 个工具（15 个 `ai_diary_*` + 2 个 `pc_*`），画面由本地渲染引擎合成，配音与动态底板才可选调用外部接口；投稿、回评论、选素材都能在哔哩哔哩客户端里真机自动完成，不开浏览器。

灵感来自 `dsh-ai-diary` 那种「静态立绘 + 代码动效」的做法，也接着 B 站上那条《【Day7】余额只剩一块钱，我问他是不是不要我了》的调子——但它不靠生成模型烧额度，靠模板 + 确定性绘制；真要动态底板时才走 Seedance / MiniMax H3。

## 安装（30 秒）

```bash
dsh plugin --profile <你的profile> add "<插件包路径>\dist\dsh-plugin-ai-diary-0.6.0.tgz"
```

桌面版（profile 被 Electron 独占）用一键脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

装完 `dsh --profile <profile> --dump-config` 里能看到 `ai-diary` 就成功了。详见 `INSTALL.md`。

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
| `ai_diary_comments` | 打开「互动管理 → 评论管理」并截图，可带 `reply` 填回复框（`send:false` 不发） | 否 |
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
- 素材授权沿用原项目：社区二创立绘仅个人非商用，商单前别混用。

MIT。
