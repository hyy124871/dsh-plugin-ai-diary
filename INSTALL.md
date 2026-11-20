# 安装说明 · dsh-plugin-ai-diary 0.7.4

「AI 日记工坊」是 **DeepSeek Harness（dsh）** 的插件：题材 → 剧本 → 16:9 横屏成片（可切竖屏）→ 哔哩哔哩客户端发布，整条链装成 17 个工具（15 个 ai_diary_* + 2 个 pc_*，含客户端投稿 / 评论 / 素材选配与一屏体检）。画面由本地渲染引擎（@napi-rs/canvas + ffmpeg）逐帧合成，**不烧视频生成额度**。

---

## 0. 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| 系统 | Windows 10/11（本包在 Win 上验证） | 脚本是 PowerShell |
| Node | ≥ 22（本机 v22.23.2 已通过） | dsh 自带 runtime，也可用系统 node |
| 磁盘 | 约 130 MB（含 62 MB 立绘、45 MB 动态底板） | 不装底板时引擎会自动退回静态底图 |
| ffmpeg | 有即可 | 优先用插件目录里的 `vendor\ffmpeg.exe`；没有则用系统 ffmpeg，或用环境变量 `DIARY_FFMPEG` 指过去 |
| dsh | 0.2.2-rc.3 及以上 | 低于 rc.2 的宿主缺少 `ctx.agents.list()`，会话会创建失败 |

> 桌面版 Harness 的 `desktop` profile **由 Electron 应用独占**，`dsh --profile desktop ...` 会被拒绝（提示 `managed exclusively by the Electron application`）。所以桌面版请按下面「方式 A / B」装，不要用官方 CLI 往 desktop 里 add。

---

## 1. 三种安装方式，任选一种

### 方式 A · 一键脚本（推荐，桌面版）

```powershell
cd "C:\Users\黄奕阳\DoubaoWork\chats\2026-11-13\new-chat-1\dsh-plugin-ai-diary"
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会：

1. 找 dsh 的 profile 目录（默认 `%USERPROFILE%\.dsh\profiles\desktop`）与自带 pnpm；
2. 备份现有 `package.json`（`package.json.bak-aidiary-<时间>`）；
3. 用 pnpm 把插件装进 profile（默认 `link:` 本目录，改包安装用 `-Mode tgz`）；
4. 把 `dsh-plugin-ai-diary` 写进 `dsh.profile.bundles`（已存在就跳过，`package.json` 保持无 BOM）；
5. 校验 `node_modules/dsh-plugin-ai-diary` 是否就位。

参数：

```powershell
.\install.ps1 -Mode tgz -PackagePath ".\dist\dsh-plugin-ai-diary-0.7.4.tgz"   # 用打包件装（234 MB，约 2 分钟）
.\install.ps1 -ProfileRoot "C:\Users\你\.dsh\profiles\web"                    # 装到别的 profile
.\install.ps1 -Uninstall                                                      # 卸掉
```

三种模式都实测过：link 约 5 秒、tgz 约 1 分 47 秒、卸载约 3 秒，卸完 `dsh.profile.bundles` 回到空数组。

装完**重启 DeepSeek Harness**（不是重开窗口，是退出应用再起），插件才会加载。

### 装完先体检（0.8.0）

```powershell
node bin\ai-diary.mjs status              # 一屏看清：环境 / 账号 / 发布 / 内容 / 定时
node bin\ai-diary.mjs status --online     # 顺带验 B 站登录态（回显昵称+UID）、ComfyUI、新版本
```

体检只读：不改设置、不动客户端、不发请求；哪个环节没配好，末行「下一步」会直接给出该跑的命令。`--json` 给脚本用，`--no-color` 去掉颜色。在会话里也可以让模型调 `ai_diary_settings { action: "status" }`。

**包里不带 ffmpeg**（100 MB，不塞进 tgz）。体检若报 `✗ ffmpeg 找不到`，一条命令补齐：

```powershell
node scripts\get-ffmpeg.mjs                       # 自动选源下载 → 解到 vendor\ → 跑 -version 验收
node scripts\get-ffmpeg.mjs --zip .\ffmpeg.zip    # 离线用已下好的包
$env:HTTPS_PROXY="http://127.0.0.1:7897"; node scripts\get-ffmpeg.mjs   # GitHub 直连被 reset 时
```

### 方式 B · 手动两条命令（桌面版）

在 profile 目录里用 harness 自带的 pnpm 装，再改一行清单：

```powershell
$prof = "$env:USERPROFILE\.dsh\profiles\desktop"
$pnpm = "D:\harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"

# 1) 装（link 装本目录；换成 tgz 路径就是包安装）
node $pnpm --dir $prof add "link:C:\Users\黄奕阳\DoubaoWork\chats\2026-11-13\new-chat-1\dsh-plugin-ai-diary"

# 2) 把 "dsh-plugin-ai-diary" 加进 $prof\package.json 的 dsh.profile.bundles 数组（无 BOM 保存）
notepad "$prof\package.json"
```

然后退出并重启 DeepSeek Harness。

### 方式 C · 官方 CLI（非 desktop profile）

自己新建的 profile / `web` / `tui` 可以直接用官方命令：

```powershell
& "D:\harness\DeepSeek Harness.exe" plugin --profile web add "C:\...\dist\dsh-plugin-ai-diary-0.4.1.tgz"
```

装完 `& "D:\harness\DeepSeek Harness.exe" --profile web --dump-config`，输出里能看到 `ai-diary` 即为成功。

---

## 2. 装完怎么验

```powershell
cd "C:\Users\黄奕阳\DoubaoWork\chats\2026-11-13\new-chat-1\dsh-plugin-ai-diary"

node load-test.mjs                 # 应打印 ALL 12 TOOLS OK：topics/plan/render/voice/assets/hailuo/publish/pick/post/comments/pc_see/pc_act
node bin/ai-diary.mjs topics --count 3      # 题材库可读
node bin/ai-diary.mjs template              # 7 套模板（默认 chat 对话卡）
node bin/ai-diary.mjs plates                # 6 套动态底板
node bin/ai-diary.mjs plan --all            # 13 条剧本一次性编译（约 1 秒）
node bin/ai-diary.mjs render --preview 7 --script out\day23-audit.json --out out\test.mp4
```

`render --preview 7` 是 7 秒试片，本机约 10–14 秒出片；整片 45–50 秒约 70–80 秒。

---

## 3. 在 Harness 里怎么用

重启后在会话里说人话就行，背后是 12 个工具：

| 工具 | 用途 |
|---|---|
| `ai_diary_topics` | 列题材（13 条，带角色/Day/余额/模板） |
| `ai_diary_plan` | 题材 → 剧本 JSON（分镜时长全本地算，几乎不耗 token） |
| `ai_diary_render` | 剧本 → 16:9 横屏 MP4（可切竖屏）/ PNG 帧序列（`preview_seconds` 出试片） |
| `ai_diary_voice` | 逐镜配音（小米 MiMo / 千问 Qwen-TTS / MiniMax T2A 三选一），按镜头时长对齐后混流 |
| `ai_diary_hailuo` | MiniMax H3 生成 4–15s 动态底板视频，默认 dry_run 不扣费 |
| `ai_diary_assets` | 体检立绘/背景，缺什么给什么生图提示词 |
| `ai_diary_publish` | 文案进剪贴板 + sidecar + 带视频启动哔哩哔哩客户端，停在「投稿」前，最后一步人来点 |
| `ai_diary_pick` | 情绪 → 立绘模样、模板 → 底板/背景，给封面候选 |
| `ai_diary_post` | 客户端真投稿：上传 → 等「上传完成」→ 填封面/标题/声明/分区/标签/简介 → 停在「立即投稿」前 |
| `ai_diary_comments` | 打开「互动管理 → 评论管理」，可带 `reply` 填回复框（`send:false` 不发） |
| `ai_diary_update` | GitHub Releases 联网查新 / 下载 / 安装 |
| `ai_diary_settings` | 插件设置：API Key、默认配音、ComfyUI 地址、发布策略（key 打码显示） |
| `ai_diary_schedule` | 定时自动出片：status / enable / disable / set / run-now（默认关闭） |
| `ai_diary_settings` | 插件设置：API Key、默认配音、ComfyUI 地址、发布策略（key 打码显示） |
| `ai_diary_schedule` | 定时自动出片：status / enable / disable / set / run-now（默认关闭） |
| `ai_diary_local` | 本机 ComfyUI 出图（探活 / 底模 / 生成） |
| `ai_diary_motion` | 角色短片归档与 video→plate |
| `pc_see` | 观察窗口：`windows` / `tree` / `find` / `text` / `shot`（文本优先，能不出图就不出图） |
| `pc_act` | 动作串：`focus` / `click` / `move` / `scroll` / `key` / `paste` / `wait`，一次多步 |

常用句式：

- 「做一个 Day7 余额只剩一块钱的，用听证记录模板」
- 「第 18 条题材渲染整片，模板换成标本观察」
- 「把这条 7 秒试片发布到 B 站，用客户端」

---

## 4. 资源与路径

| 路径 | 内容 |
|---|---|
| `assets/characters/` | 8 个角色的立绘（deepseek / gpt / claude / gemini / grok / glm / qwen / kimi） |
| `assets/backgrounds/` | 12 张 1080×1920 空镜 |
| `assets/plates/<名字>/` | 动态底板帧目录（`f_0001.jpg…` + `meta.json`，12fps / 96 帧 / 8s） |
| `data/topics.json` | 题材库（13 条） |
| `out/` | 剧本 JSON 与成片 |
| `vendor/ffmpeg.exe` | 内置 ffmpeg（仅目录版包含，tgz 里没有） |

环境变量：`DIARY_FFMPEG`（ffmpeg 路径）、`DIARY_BILI_CLIENT`（哔哩哔哩客户端路径，默认 `C:\Program Files\bilibili\哔哩哔哩.exe`）。

补素材不用改代码：同名覆盖 `assets/` 下的文件即可；新底板用 `node bin/ai-diary.mjs plate --from <静帧或视频> --name <名字>`。

---

## 5. 卸载 / 回滚

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

等价手动做法：从 profile 的 `dsh.profile.bundles` 删掉 `dsh-plugin-ai-diary`，删掉 `dependencies` 里对应的那一项，再 `node $pnpm --dir $prof remove dsh-plugin-ai-diary`，然后重启。

---

## 6. 已知坑（都踩过）

1. **profile `package.json` 必须无 BOM**：带 BOM 宿主直接报 `Unexpected token`。`install.ps1` 用 `UTF8Encoding($false)` 写，脚本改也请照做。
2. **`dsh-plugin-memory` 要 ≥ 0.19.5**：0.17.9 会调 `ctx.agents.roots()`，dsh 0.2.2-rc.2 起改成 `agents.list()`，症状是「新建会话没反应、旧会话消失」。不是本插件的问题，但会看着像。
3. **desktop profile 的 CLI 独占**：`dsh --profile desktop` 一律拒绝，按方式 A/B 装。
4. **首次渲染慢一点**：第一次会加载 canvas 与解码底板，之后同长度稳定在 10–14 秒 / 7 秒片。
5. **发布最后一步留给人**：客户端会带视频打开并填好文案，投稿按钮不代点——发布是不可逆动作。
6. **tgz 装完要配 ffmpeg**：打包件不带 `vendor/ffmpeg.exe`（105 MB）。三条出路：把 ffmpeg 加进 PATH、把 `vendor\ffmpeg.exe` 拷进 `<profile>\node_modules\dsh-plugin-ai-diary\vendor\`、或设 `DIARY_FFMPEG` 指向现有 ffmpeg。找不到时渲染会明确报「找不到 ffmpeg」，不会静默出错。


---

## 7. 配音与 H3 视频的 key（可选，不配也能出片）

三家的 key 都不进包，自己申请后写环境变量，或填进 `config/voice.json` / `config/video.json` 的 `apiKey`：

```powershell
setx MIMO_API_KEY "你的小米 MiMo key"          # ai_diary_voice provider=xiaomi
setx DASHSCOPE_API_KEY "你的百炼 key"          # provider=qwen（qwen3-tts-flash）
setx MINIMAX_API_KEY "你的 MiniMax key"        # provider=minimax（T2A）+ ai_diary_hailuo（H3）
```

改完要重开终端（`setx` 只对新进程生效）。验配置：

```powershell
node bin\ai-diary.mjs voice --check            # 列三家 key 就绪状态与默认音色
node bin\ai-diary.mjs voice --check --provider qwen
```

不配 key 也能做的：选题、剧本、渲染、PNG 导出、素材体检、B 站文案 sidecar；配音与 H3 会直接报「缺少 XXX_API_KEY」，不会假装成功。

## 8. 立绘变体（每角色 10 套起，deepseek 14 套）

```
assets/characters/transparent/variants/<角色>_chibi_v2|v3|v4|v5|v10|v11.png   (deepseek 另有 v6–v9、v12–v15)
```

渲染时 `--look v4` / `--look v10`（挥手打招呼）/ `v11`（抬手拢发）/ `v6`–`v9`（水手服、冬日居家、运动、夏日祭，仅 deepseek）/ `v12`–`v15`（跳跃、蹲姿托腮、叉腰、高脚凳，仅 deepseek），或剧本里写 `"episode": { "look": "v13" }`。

注意 `--look` 收的是**后缀**（`v4`），不是整文件名；`look` 不再是固定枚举，文件名不存在时自动回退原版立绘，不报错。v4/v5 已于 0.4.0 换成重出的姿势，旧图备份在 `work/variants-backup-poses/`。全部变体统一缩到 1200px 高（引擎实际用到约 1060px），透明通道保留。

## 9. 客户端投稿/评论自动化（0.4.0 新增）

依赖本机装了哔哩哔哩客户端（默认 `C:\Program Files\bilibili\哔哩哔哩.exe`，可用 `DIARY_BILI_CLIENT` 覆盖），且客户端**已登录**。

```powershell
node bin\ai-diary.mjs pick                                    # 看素材选配结果
node bin\ai-diary.mjs post --video out\day28-specimen-v5.mp4 --title "标题" --tags "AI日记,AI角色" --skip-open
node bin\ai-diary.mjs comments --reply "谢谢！"               # 打开评论管理并填回复框，不点发送
node bin\ai-diary.mjs pc --see windows                        # 先看有哪些窗口
node bin\ai-diary.mjs pc --act "focus 浏览器窗口" "wait 1"
```

- `post` 默认只准备、不提交：填完表停在「立即投稿」按钮前，回传截图与按钮坐标；加 `--confirm` 才会点下去。
- 客户端 UI 改版时，改 `config/bili.json` 里的比例锚点即可（`railUploadIcon`、`uploadVideoButton`、`titleField`、`tagsInput`、`coverRecommended1`、`statementSelect`、`submitButton`…），锚点是相对窗口截图的 0–1 比例。
- 上传等待按体积估算（默认 9 秒/MB，最少 20 秒），文件大就把 `config/bili.json` 的 `waits.upload.msPerMb` 调大。
- 已知限制：Electron 客户端不暴露控件树，只能用「截图 + 坐标点击」；窗口最小化时截图会报 `WINDOW_MINIMIZED`，工具已自动先 `focus` 恢复。创作声明下拉的选项锚点尚未在真机验证，`post` 会跳过它并在结果里提示。

### 评论走接口：先扫码拿 Cookie（0.7.1）

评论回复的主路线是评论接口（`comments --action auto --mode api`），接口要网页登录态，所以得先配 `SESSDATA` + `bili_jct`。**不用开浏览器**：

```powershell
node scripts\qr-login.mjs --write          # 出二维码 → 手机哔哩哔哩 App 扫 → 自动写进设置
node bin\ai-diary.mjs comments --action auth   # 先验登录态，不发任何回复
node bin\ai-diary.mjs comments --action auto --mode api --send true --max 3
```

- 二维码落在 `out\qr-login.png` 并自动打开；不想弹窗就加 `--no-open`。几分钟内没扫会失效，脚本自动换一张。
- 默认 30 秒一条、单轮最多 3 条（`comments.apiGapMs` / `maxPerRun`），这是平台限频，别调低。
- 客户端本身给不了登录态（库里只有匿名 `buvid3`/`buvid4`），但它那条 `buvid3` 会被扫码脚本顺手带上，能少一层风控。

