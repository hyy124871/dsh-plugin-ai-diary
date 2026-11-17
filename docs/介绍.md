# AI 日记工坊 · 介绍

> DeepSeek Harness 插件 `dsh-plugin-ai-diary` — 把「AI 角色日记短剧」从选题一路做到 B 站投稿、评论回复，全部在你这台机器上跑完。

---

## 一句话

你给它一个题材，它给你一条能投稿的竖屏片子：**选题 → 剧本 → 1080p 渲染 → 配音 → 动态底板 → 选素材 → 投稿 → 回评论**。
画面不是靠生成模型烧额度，而是本地 Skia 逐帧画出来的 —— 同一套模板，出片成本只有电费和几分钟时间。

## 为什么自己做渲染

用生成模型做整片，一条 50 秒的 9:16 视频要反复抽卡、修图、对齐字幕，额度烧完还可能跑偏。
这套插件反过来：**画布是确定的**。立绘、纸张卡片、终端界面、字幕条都由代码按坐标画，改一个参数就能重出一版；只有你真需要「动起来的背景」时，才去调 MiniMax H3 或 Seedance 生成 4–15 秒底板。

结果就是：一条 49.79 秒的片子，**1080×1920 / 1195 帧 / 约 130 秒**渲染完成，35MB 直接可投。

## 十七个工具

| 工具 | 干什么 |
|---|---|
| `ai_diary_topics` | 选题：内置题材库，默认避开做过的 |
| `ai_diary_plan` | 题材编译成剧本 JSON（每镜时长、分镜时间点、片长都算好） |
| `ai_diary_render` | 剧本渲染成 9:16 MP4，默认 **1080×1920** |
| `ai_diary_voice` | 逐镜配音：小米 MiMo / 千问 Qwen-TTS / MiniMax T2A 三选一，按镜头时长对齐后混流 |
| `ai_diary_hailuo` | MiniMax H3 生成 4–15 秒动态底板（异步任务，默认 dry_run 不扣费） |
| `ai_diary_assets` | 素材自检：缺哪些立绘/背景，给补图提示词 |
| `ai_diary_pick` | 自动选素材：按情绪挑立绘、按模板挑底板，并给封面候选 |
| `ai_diary_post` | 真投稿：唤起客户端 → 上传 → 填表 → 停在「立即投稿」前 |
| `ai_diary_comments` | 评论自动回复：接口优先、GUI 兜底 |
| `ai_diary_publish` | 轻量发布：文案进剪贴板 + 带视频拉起客户端 |
| `ai_diary_local` | 本机 ComfyUI 出图（不耗生成额度） |
| `ai_diary_motion` | 角色动态素材：收短片 / 转 9:16 动态底板 |
| `ai_diary_update` | 联网查 GitHub Releases、下载、按 profile 安装 |
| `ai_diary_settings` | 读写插件设置：API Key、配音服务商、ComfyUI 地址、发布策略、成片规格 |
| `ai_diary_schedule` | 定时自动出片 |
| `pc_see` / `pc_act` | 通用电脑操控：文本优先观察窗口 + 动作串一次多步 |

## 安装

### 方式 A：一对一键脚本（推荐，桌面版 profile 被 Electron 独占时用这个）

```powershell
cd <插件目录>
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Mode tgz -PackagePath ".\dist\dsh-plugin-ai-diary-0.7.4.tgz" -ProfileRoot "<你的 profile>"
```

装完**完全退出 Harness 再起**，`ai_diary_*` 才会出现。

### 方式 B：命令行

```bash
dsh plugin --profile <你的profile> add "<插件包路径>/dsh-plugin-ai-diary-0.7.4.tgz"
```

### 装完先体检

```powershell
node bin/ai-diary.mjs status
```

一屏看完环境 / 账号 / 发布 / 内容 / 定时五组状态；哪项红，下一行就告诉你怎么补：

```text
AI 日记工坊 0.7.4 · 体检
✓ 11/13 通过，没有硬故障（未配置 2，注意 0）

[内容]
  ✓ 立绘              16 张基础 + 88 张变体
  ✓ 成片规格          1080×1920 @24fps（超采样 1.5×）
```

## 版本

| 版本 | 内容 |
|---|---|
| **0.7.4** | 投稿前成片规格自检（`ai_diary_post` / `ai_diary_publish`）；评论支持关键词数组与 `/正则/`、规则文案池、避开最近 20 句、72 小时时间窗、去重账本 499 条 |
| **0.7.3** | 成片升 **1080p**（1.5× 超采样，不是拉伸）：输出 1080×1920、`crf 17 / preset medium / high profile`；设置面板新增「成片规格」；底板默认 1080×1920；一屏体检 `status` |
| 0.7.1 | 扫码登录素材、`get-ffmpeg` 一键补 ffmpeg |
| 0.7.0 / 0.6.0 | 定时出片、评论 OCR 自动回复、投稿编排、窗口置顶与不盲点保护 |

## 三个最常问的

**要钱吗？** 渲染、配音对齐、投稿编排、评论回复都在本地，不花额度。只有主动用 H3 底板或外部 TTS 时才产生接口费用（`hailuo` 默认 `dry_run` 不会扣）。

**能全自动投稿吗？** 会替你上传、填表、选封面，但「立即投稿」那一下默认留给你按（`confirm: true` 才真点）。对外不可逆的动作交给人才安全。

**评论会不会回错人？** 不会盲点。找不到「回复」/「发送」就停下来报告；每条按 rpid（接口）或文本指纹（GUI）只回一次；单轮最多 3 条、间隔 ≥8 秒，接近平台节奏。

## 目录

```text
bin/ai-diary.mjs        CLI 入口（status / render / plate / publish / comments …）
src/engine.mjs          渲染引擎（Skia 逐帧 + ffmpeg 编码）
src/comments.mjs        评论：OCR 定位 + 规则匹配 + 账本去重
src/publish.mjs         发布：客户端拉起、文案落盘、成片规格自检
src/doctor.mjs          体检面板
src/settings.mjs        设置读写（~/.ai-diary/settings.json）
src/index.mjs           17 个工具的定义与参数
skills/ai-diary/        给 Harness 用的技能说明
assets/                 立绘 / 背景 / 底板
scripts/                get-ffmpeg、qr-login 等辅助脚本
```

---

MIT License · 仓库：<https://github.com/hyy124871/dsh-plugin-ai-diary>
