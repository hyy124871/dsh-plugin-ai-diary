---
name: ai-diary
description: 用 ai_diary_* 与 pc_* 十七个工具把「AI 角色日记」竖屏短剧从选题做到 B 站投稿：选题 → 剧本 → 本地渲染出片 → 三家 TTS 配音 → MiniMax H3 生成动态底板 → 自动选素材 → 走哔哩哔哩客户端上传/填表/评论（内置电脑操控引擎，不用浏览器）。
whenToUse: 用户要做 AI 角色日记/竖屏短剧、批量出片、给片子配音，或提到 AI 日记工坊、ai_diary_* 工具、MiniMax H3、千问 TTS、发到 B 站时。
---

# AI 日记工坊

## 这套工具在做什么

一条片子拆成六段，主体全在本地完成（配音与 H3 底板是可选的外部接口）：

1. `ai_diary_topics` —— 选题（内置原创题材库，默认避开做过的）
2. `ai_diary_plan` —— 题材编译成剧本 JSON（每镜时长、分镜时间点、片长都算好）
3. `ai_diary_render` —— 剧本 JSON 渲染成 9:16 MP4（Skia 逐帧 + ffmpeg），默认出 1080×1920（逻辑布局 720×1280、1.5× 超采样，字号与坐标不用改）；`--scale 1` 回 720p 换速度，`--scale 2` 出 1440×2560；可 `--look` 换立绘模样
4. `ai_diary_voice` —— 逐镜配音：小米 MiMo / 千问 Qwen-TTS / MiniMax T2A 三选一，按镜头时长对齐后混流
5. `ai_diary_hailuo` —— MiniMax H3 生成 4–15 秒动态底板视频（异步任务，默认 dry_run 不扣费）
6. `ai_diary_assets` —— 素材自检：缺哪些立绘/背景、给补图提示词
7. `ai_diary_pick` —— 自动选素材：按情绪挑立绘、按模板挑底板与背景，并给封面候选
8. `ai_diary_post` —— 真投稿编排：先自检成片规格（分辨率/竖屏比例/时长/体积，不合格先提醒）→ 唤起客户端 → 创作中心 → 点上传 → 原生文件框粘路径 → 等上传完成 → 填封面/标题/声明/分区/标签/简介 → 停在「立即投稿」前给你截图
9. `ai_diary_comments` —— 评论自动回复：`action=auth` 只验 Cookie；`action=auto` 按规则回复（`mode=api` 走评论接口 / `gui` 截图点按钮 / `hybrid` 默认，接口失败才回退一次；`send` 默认 false 只出计划）；`action=watch` 挂一段时间反复扫；`scan` / `calibrate` 是 GUI 侧读页面。规则写法三选一：子串 `"催更"`、关键词数组 `["催更","更新"]`、正则 `"/感谢|谢谢/"`，`"*"` 兜底；规则可带 `replies` 文案池，回复时避开最近 20 条用过的句子；`recent_hours`（默认 72）只回这段时间内的新评论，`0`=不限。接口路线需要 Cookie：设置里 `keys.bili` 填 `SESSDATA=…; bili_jct=…; buvid3=…`（或环境变量 `BILI_COOKIE`）。每条只回一次（接口按 rpid、GUI 按文本指纹，账本记 499 条），平台约 30 秒 1 条，单轮默认最多 3 条
10. `pc_see` / `pc_act` —— 通用电脑操控：文本优先观察窗口（`windows`/`tree`/`find`/`text`/`shot`），动作串一次多步（`focus`/`click`/`move`/`scroll`/`key`/`paste`/`wait` 等）
11. `ai_diary_publish` —— 轻量发布辅助：文案进剪贴板 + 带视频拉起客户端（默认 dry_run，不点投稿）
12. `ai_diary_local` —— 本机 ComfyUI 出图：探活 / 列底模 / 按提示词生成，不耗生成额度
13. `ai_diary_motion` —— 角色动态素材：收短片 / 列清单 / 转 9:16 动态底板
14. `ai_diary_update` —— 联网查 GitHub Releases、下载、按 profile 安装（不会静默装）
15. `ai_diary_settings` —— 读写插件设置：`status` 一屏体检（环境/账号/发布/内容/定时）；`get` 看配置；`set` 改 API Key、配音服务商与音色、ComfyUI 地址、发布策略
16. `ai_diary_schedule` —— 定时自动出片：`status` / `enable` / `disable` / `set` / `run-now`

设置面板与配置文件：Harness 官方设置面板读插件导出的 `Config`（schemastery）；配置落在 `~/.ai-diary/settings.json`，环境变量（`MIMO_API_KEY` / `DASHSCOPE_API_KEY` / `MINIMAX_API_KEY` / `GITHUB_TOKEN`）优先。定时默认关闭，一天只跑一次，到点自动出片并把文案填进客户端，仍停在「立即投稿」前。

体检：拿不准「到底哪没配好」就调 `ai_diary_settings { action: "status" }`（只读，不发送任何操作），它按 环境 / 账号 / 发布 / 内容 / 定时 五组给状态与下一步命令；加 `online: true` 顺带验 B 站登录态（回昵称与 UID）、ComfyUI 与版本。命令行等价于 `node bin/ai-diary.mjs status [--online] [--json]`。

## 标准流程

```
ai_diary_topics { count: 3 }
  → 挑一个 id
ai_diary_plan { topic_id: "day7-balance" }
  → 拿到 out/day7-balance.json
ai_diary_render { script: "out/day7-balance.json" }
  → 拿到 out/day7-balance.mp4
ai_diary_publish { video: "out/day7-balance.mp4", dry_run: true }
```

想先看构图再整片渲染：`ai_diary_render { script, preview_seconds: 8, out: "out/preview.mp4" }`，8 秒几秒钟就出。

## 模板（版面风格）

六套皮肤，渲染引擎逐帧绘制，不用生成模型：

| id | 版面 |
|---|---|
| `classic` | 星夜日记（原版）：星空底、居中立绘、顶部 DAY/余额 HUD |
| `report` | 评测报告：米色网格报告卡 + 右上「01 基本資訊」章节标签 + 左下 REC HUD + 右側立绘 |
| `dossier` | 机密档案：牛皮纸卷宗 + 档案 tab + 红色「機密」印章 + 竖排档案号 |
| `terminal` | 数据终端：冷青 CRT 面板 + 扫描线 + 逐行点亮的日志 + 额度条 |
| `audit` | 听证记录：米白硬卡 + 墨绿条文头「聽證記錄 / AUDIT HEARING」+ 案號/被聽證/剩餘額度 + 三条条文 + 签名线 + 旋转「已覆核」绿章 + 右上 01 開庭→04 覆核章节 + 左下 HEARING HUD |
| `specimen` | 标本观察：暗色玻璃观察板 + 左侧 16 格刻度尺 + 標本觀察記錄 + SPECIMEN No.XX + 樣本/培養天數/剩餘培養液 + 4 格情緒指數条 + 呼吸圆环 + OBSERVING·LAB 2F |

五套纸面模板自带专属底板（`report-desk.png` / `dossier-room.png` / `terminal-desk.png` / `audit-room.png` / `specimen-lab.png`），画面上还有光晕呼吸、尘埃上浮、纸卡轻浮与缓慢推近，全部由引擎确定性绘制。

```
ai_diary_plan { topic_id: "day23-audit" }                   // 题材自带模板
ai_diary_plan { topic_id: "day7-balance", template: "specimen" }   // 改模板，底板跟着换
ai_diary_render { script: "out/day18-report.json", template: "terminal" }  // 渲染时覆盖
```

已有题材里写死的 `night`/`warm` 等旧背景槽位，在上述纸面模板下会被模板专属底板接管，不会退回星空。


## 什么时候该换角色 / 做连播

同一个题材骨架，换主角就是一篇新片：

```
ai_diary_plan { topic_id: "day7-balance", character: "gpt" }   // 输出 day7-balance--gpt.json
```

八个角色都用同一句台词会很像批量内容，建议一次连播只换 2–3 个角色，并在 B 站分 P 或做成合集。

## 素材

`ai_diary_assets` 会列出缺哪些立绘/背景，并给出可直接拿去生图的提示词。缺图不会报错，引擎会退化为纯渐变背景，只是画面偏空。补图后同名覆盖 `assets/` 下对应文件即可，不需要改代码。

背景槽位：`night-sky.png`（星空）、`warm-card.png`（暖米色卡片）、`rain-night.png`（雨夜街道）、`dusk-room.png`（黄昏房间）、`sakura-night.png`（夜樱）、`blank-card.png`（空白卡片）、`report-desk.png`（评测报告桌）、`dossier-room.png`（档案室）、`terminal-desk.png`（数据终端）、`audit-room.png`（听证室）、`specimen-lab.png`（标本观察室）、`train-platform.png`（深夜月台）。

## 动态底板

`assets/plates/<模板名>/` 里是 12fps JPEG 帧目录 + `meta.json`（默认 96 帧 / 8 秒 / 720×1280），存在时自动接管背景层，播完无缝循环。退路是逐级的：动态底板 → 静态底图 → 纯渐变。

要升级画面，把一段 9:16 视频（或一张静帧）转成底板即可，**不用改代码**：

```
node bin/ai-diary.mjs plate --from out/seedance-report.mp4 --name report
node bin/ai-diary.mjs plates                                          // 看现有底板
node bin/ai-diary.mjs render --script out/day18-report.json --plate report   // 临时换底板
```

静帧来源会被程序化地推近 + 加颗粒 + 光照微颤（零额度）；视频来源直接按 12fps 抽帧裁成 720×1280。生成模型额度不可用时就先用静帧版，额度恢复后同名覆盖即完成升级。

## 立绘模样（look）

每个角色有多套透明立绘，渲染时按 `--look` / `episode.look` 指定，缺图自动回退原版：

| look | 内容 | 数量 |
|---|---|---|
| `v1`（默认） | 原版基础立绘 | 8 |
| `v2` | 居家 / 生活套装 | 8 |
| `v3` | 外出 / 正式套装 | 8 |
| `v4` | 动作姿势 A（坐、伸懒腰、猫伸展、撑斧、抬手指、合扇、抱笛等） | 8 |
| `v5` | 动作姿势 B（蹲捡、端茶行礼、快步、跳跃欢呼、啃吸管、踮脚、遮阳、戴耳机等） | 8 |
| `v6` | 水手服通勤（托特包 + 合拢长柄伞，斜眼撇嘴） | 仅 deepseek |
| `v7` | 冬日居家（鳞纹家居服抱鲸鱼玩偶，困眼） | 仅 deepseek |
| `v8` | 运动装（运动水壶喝水 + 护膝，跑完喘气） | 仅 deepseek |
| `v9` | 夏日祭（鳞纹浴衣 + 鲸鱼纸灯笼 + 木履，抬头笑） | 仅 deepseek |
| `v10` | 挥手打招呼（一手背身后，重心压在一条腿上） | 8（deepseek 起为 v10–v15） |
| `v11` | 抬手拢发侧目（嘴角带点小得意） | 8 |
| `v12` | 双手举高跳跃欢呼（仅 deepseek） | 仅 deepseek |
| `v13` | 半蹲撑地托腮歪头（仅 deepseek） | 仅 deepseek |
| `v14` | 叉腰前倾得意（仅 deepseek） | 仅 deepseek |
| `v15` | 高脚凳托腮晃腿（仅 deepseek） | 仅 deepseek |
| `v16` | 剪刀手 + 叉腰眨眼 | 8 |
| `v17` | 双手捧脸颊大笑 | 8 |
| `v18` | 坐地前伸腿、双手撑在身后 | 8 |
| `v19` | 伸手指向你（递物）| 8 |

**v4/v5 已换成 2026-11 重出的姿势**（原来那两套动作图被覆盖，旧图备份在 `work/variants-backup-poses/`）。v10 起是这轮新加的姿势档：`v10` 挥手、`v11` 拢发全角色都有；deepseek 额外多出 `v12`–`v15`（跳跃、蹲姿托腮、叉腰、高脚凳），总计 8 张。第二批 `v16`–`v19`（剪刀手 / 捧脸 / 坐地撑手 / 递物）八个角色都有。除 `v6`–`v9` 与 `v12`–`v15` 外，其他档位八个角色都能用；传不存在的后缀会回退原版，不报错。

```
ai_diary_render { script: "out/day23-audit.json", look: "v4" }
```

## 配音（三家 TTS）

| provider | 接口 | key | 音色示例 |
|---|---|---|---|
| `xiaomi` | `POST https://api.xiaomimimo.com/v1/chat/completions`，头 `api-key`，文本必须放 `role: assistant` | `MIMO_API_KEY` | 冰糖 / 茉莉 / 苏打 / 白桦 |
| `qwen` | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`，model `qwen3-tts-flash`，`input{text,voice,language_type}`，单次 ≤600 字 | `DASHSCOPE_API_KEY` | Cherry / Serena / Ethan / Chelsie |
| `minimax` | `POST https://api.minimax.cn/v1/t2a_v2`，`voice_setting` + `audio_setting`，返回 `data.audio` 是 **hex** | `MINIMAX_API_KEY` | female-shaonv / male-qn-qingse / presenter_male |

逐镜合成 → 按镜头时长对齐（超长 atempo 提速上限 1.6×，不足 apad 补静音）→ 拼整轨 → 混流（视频流 copy 不重编码）。八角色在三家各配一色（见 `src/voice.mjs` 的 `CHARACTER_VOICES`）。

```
ai_diary_voice { script: "out/day23-audit.json", provider: "qwen", mux: "out/day23-audit.mp4" }
ai_diary_voice { check_only: true }    // 只看三家 key 是否就绪，不耗额度
```

## 动态视频底板（MiniMax H3）

`ai_diary_hailuo` 走异步三步：创建任务 → 每 10s 轮询 → 下载 `task.content.url`。

- 模型 `MiniMax-H3`（768P/2K，4–15 秒）/ `MiniMax-H3-Max`（480P/768P，5–15 秒，仅文生/图生）
- 图生视频 ratio 恒为 `adaptive`（由首帧决定）；纯文生视频必须显式给 ratio
- `first_frame` 可以给本地图片（转 data URI 兜底）或公网 URL
- **默认 `dry_run: true`**，只校验参数并打印将要提交的 body，不会扣费

```
ai_diary_hailuo { prompt: "听证室缓慢前推，尘埃浮动", first_frame: "assets/backgrounds/audit-room.png", duration: 8 }
```

拿到成片后转成底板：

```
node bin/ai-diary.mjs plate --from out/h3-xxx.mp4 --name audit --seconds 8
```

## 发布边界

- **推荐走 `ai_diary_post`（客户端 GUI 自动化）**：截图定位 + 真实坐标点击 + 原生文件对话框粘路径，全流程在哔哩哔哩客户端里完成，不开浏览器。默认 `confirm:false`，填完表单停在「立即投稿」按钮前，回传截图与坐标，由你点最后一下。
- 客户端 UI 改版时改 `config/bili.json` 里的比例锚点（`railUploadIcon`、`uploadVideoButton`、`titleField`、`tagsInput`、`coverRecommended1`、`submitButton` 等），不用动代码；锚点是相对截图的 0–1 比例，程序按截图缩放换算出真实屏幕坐标。
- 底线：`dry_run` / `confirm:false` 时绝不替你点「立即投稿」「发布」；投稿是对外不可逆动作。
- 备用：`ai_diary_publish` 只做「文案进剪贴板 + 带视频拉起客户端」；`mode:"browser"` 的 Chrome CDP 路径保留但默认不用（你明确要求用客户端）。
- 评论：主路线是 `ai_diary_comments --action auto --mode api`，直接走 B 站评论接口（读稿件/读评论带 WBI 签名，发回复带 `root`/`parent` 与 `csrf=bili_jct`），不截图、不点按钮，成功与否看返回 `code`。需要先配 Cookie（`keys.bili` 或 `BILI_COOKIE`），并先用 `action=auth` 验证。**配 Cookie 不用开浏览器**：`node scripts/qr-login.mjs --write` 出登录二维码，手机哔哩哔哩 App 扫码点确认后自动写进设置（走 B 站网页扫码登录的同一组接口，客户端库里那条匿名 `buvid3` 会顺手带上）。`mode=gui` 是原来的截图 + OCR 路线；`mode=hybrid`（默认）只在接口报 `-101/-412/25004` 时回退一次。删评论弹窗、行定位这些 GUI 细节只在 `gui` 模式才涉及。

## 成本

选题、剧本、渲染、发布都是本地执行，唯一的机器成本是 CPU 时间（45 秒片约 45 秒渲染）。素材补图才需要生成模型额度。
