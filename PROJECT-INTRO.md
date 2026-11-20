# AI 日记工坊 · dsh-plugin-ai-diary

在 DeepSeek Harness 里，把一个题材做成一条可以发布的短剧。

给一句话，它写成剧本、分成镜头、逐帧画出画面、配上字幕与配音，最后在哔哩哔哩客户端里把稿子投出去。画面由本地引擎合成，同一份剧本每次出片都一致；配音、动态底板、生图、生视频这些需要外部算力的事，才去调对应接口。

---

## 1. 四件事

**写。** 内置题材库给出一句话的选题，编译成一份剧本 JSON：每镜说什么、停多久、余额怎么递减、字幕何时出现，都在里面。也可以自己手写一份，六行就够。

**画。** 本地渲染引擎逐帧合成画面：背景缓慢推移、立绘呼吸浮动、字幕逐字打出、HUD 随剧情递减。七套版式各有各的纸面与配色，默认是一张米色纸页的对话卡。

**配。** 需要人声时，接小米 MiMo、千问 Qwen-TTS 或 MiniMax T2A；需要动态底板时，把静帧或短片转成帧目录，运行时按时间取帧；需要新立绘或新背景时，走本机 ComfyUI 或 Seedream。

**发。** 投稿走哔哩哔哩客户端本身：唤起窗口、进创作中心、点上传、粘路径、等上传、填封面标题声明分区标签、停在「立即投稿」前交给你。回评论走评论接口，失败时回退到界面操作。

---

## 2. 七套版式

| 模板 | 观感 | 适合 |
|---|---|---|
| `chat` | 米色纸页采访稿，网格、裁切标、竖排刊名与印章 | 默认；日常独白、对话体 |
| `classic` | 暗色舞台，立绘居中，HUD 与余额条 | 情绪最重的一集 |
| `report` | 评测报告卡，栏线分明 | 复盘、总结 |
| `dossier` | 牛皮纸档案袋，编号与骑缝章 | 调查、揭秘 |
| `terminal` | 深色终端，等宽字与光标 | 系统日志、故障 |
| `audit` | 听证记录，双栏问答 | 对峙、审问 |
| `specimen` | 标本记录，冷色玻璃与刻度 | 观察、实验 |

默认输出 1920×1080 横屏；设置 `render.orientation = "portrait"` 回到 1080×1920 竖屏。立绘有 88 张姿势变体，`--look v2…v19` 逐档切换。

---

## 3. 工具

**创作**

| 工具 | 用途 |
|---|---|
| `ai_diary_topics` | 从题材库选题，默认避开做过的 |
| `ai_diary_plan` | 编译成可渲染的剧本 JSON |
| `ai_diary_render` | 渲染成片，可换模板、立绘、底板，只渲前 N 秒 |
| `ai_diary_voice` | 三家 TTS 配音并对齐混流 |
| `ai_diary_assets` | 素材自检：缺哪张、该按什么提示词补 |
| `ai_diary_pick` | 按情绪挑立绘、按模板挑底板、给封面候选 |

**生成**

| 工具 | 用途 |
|---|---|
| `ai_diary_hailuo` | MiniMax H3 生成动态底板，异步任务，默认演练 |
| `ai_diary_seedream` | 火山方舟 Seedream 出图，可带参考图锁角色 |
| `ai_diary_local` | 本机 ComfyUI 出图，探活、列底模、六种风格 |
| `ai_diary_motion` | 角色短片归档、列清单、转动态底板 |

**发布**

| 工具 | 用途 |
|---|---|
| `ai_diary_post` | 客户端真投稿编排，停在「立即投稿」前 |
| `ai_diary_publish` | 轻量辅助：文案进剪贴板，带视频拉起客户端 |
| `ai_diary_comments` | 评论回复，接口优先，界面兜底，默认不发送 |

**运维**

| 工具 | 用途 |
|---|---|
| `ai_diary_settings` | 读写设置，`status` 一屏体检环境、账号、发布、内容、定时 |
| `ai_diary_schedule` | 定时出片：启用、停用、改时间、立即跑一次 |
| `ai_diary_update` | 查 GitHub Releases、下载、按 profile 安装 |
| `pc_see` / `pc_act` | 桌面观察与多步操作，投稿与回评的底座 |

---

## 4. 开始

```powershell
dsh plugin --profile <你的profile> add "<包路径>\dist\dsh-plugin-ai-diary-1.0.0.tgz"

node bin/ai-diary.mjs topics --count 3
node bin/ai-diary.mjs plan --topic day7-balance
node bin/ai-diary.mjs render --script out\day7-balance.json --out out\day7-balance.mp4
```

先看构图，再渲整片：

```powershell
node bin/ai-diary.mjs render --script out\day7-balance.json --preview 8 --out out\preview.mp4
```

加人声：

```powershell
node bin/ai-diary.mjs render --script out\day7-balance.json --voice 冰糖 --provider xiaomi
```

---

## 5. 设置与定时

面板里的设置写入 `~/.ai-diary/settings.json`；环境变量 `MIMO_API_KEY`、`DASHSCOPE_API_KEY`、`MINIMAX_API_KEY`、`ARK_API_KEY`、`GITHUB_TOKEN` 优先。

定时任务默认关闭。打开后每天在指定时刻跑一次：出片、有 key 就配音、填充投稿表单，停在「立即投稿」前。`publish = true` 时才会真的提交，是否自动点最后一下由 `autoSubmit` 决定。

B 站登录态：面板显示昵称、UID、Cookie 配置、剩余天数与预计到期日；每 6 小时自动验一次并顺延，7 天内转黄色提示，失效转红色。

---

## 6. 边界

- 引擎能把整段视频转成动态底板，不能把视频里的透明角色单独抠出来叠到立绘位。
- 角色短片是 1:1 的，转横屏底板会裁放放大，更适合当封面或片尾素材。
- 投稿编排默认停在「立即投稿」前；评论默认只出计划不发送。
- 客户端界面锚点写在 `config/bili.json`，客户端改版后改配置即可。
- 本地模型只接 ComfyUI 的文生图标准节点；视频类本地节点尚未接入。
- 三家 TTS 都需要自备 key；无 key 时只能离线自检。

---

## 7. 许可

MIT。立绘、背景与短片为本项目自产，可随插件分发；第三方素材请自行确认授权。
