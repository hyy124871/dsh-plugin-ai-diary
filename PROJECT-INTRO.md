# AI 日记工坊 · dsh-plugin-ai-diary

> 给 **DeepSeek Harness（dsh）** 写的插件：把「AI 角色日记短剧」从选题、分镜、渲染、配音，一路做到**哔哩哔哩客户端真机投稿与回评**，不开浏览器、不点错按钮。
> 画面由插件自带的本地渲染引擎确定性合成；需要外部算力时才调视频/配音接口，也可以完全走本机 ComfyUI 模型。

---

## 1. 它是干什么的

一句话：**输入一个题材，产出一条 9:16 竖屏短剧 MP4，并能直接投到 B 站。**

它不是「调 API 生成视频」的封装，而是一条**闭环流水线**：

```
题材库 → 剧本 JSON（镜数/时长/字幕/余额曲线）
      → 本地渲染引擎出片（背景推移 + 立绘呼吸浮动 + HUD 递减 + 逐字字幕）
      → 可选配音混流（小米 / 千问 / MiniMax 三家 TTS）
      → 可选动态底板（静态图或视频 → 帧目录 plate）
      → 客户端投稿 / 评论回复 / 素材选配（PowerShell + P/Invoke 桌面引擎）
```

整条链路**不依赖任何生成额度**也能出片——这是它和"直接调文生视频"最本质的区别。

---

## 2. 能力一览

| 能力 | 实现方式 | 要不要额度 |
|---|---|---|
| 选题、编译剧本 | 内置题材库 + 确定性地编译成 JSON | 否 |
| 成片渲染 | 自带引擎绘制（libx264 / 逐帧合成） | 否 |
| 立绘换装 | 88 张透明 PNG，`--look v2…v19` 切档 | 否 |
| 动态底板 | 静帧/视频 → 帧目录，运行时按时间取帧 | 否 |
| 配音 | 小米 MiMo / 千问 Qwen-TTS / MiniMax T2A | 要 key |
| 文生视频 | MiniMax H3 异步接口 | 要 key |
| 本地出图 | 直连本机 ComfyUI（SD 1.5/SDXL 底模） | 否（本地算力） |
| 客户端投稿 | 抬客户端 → 上传 → 填表 → 停在「立即投稿」前 | 否 |
| 回评论 / 选素材 | 电网桌面引擎操作客户端 UI | 否 |
| 联网自更新 | 查 GitHub Releases → 下载 → 校验 → 安装 | 否 |

---

## 3. 十七个工具

**创作链**

- `ai_diary_topics` — 从题材库选题（默认避开做过的）
- `ai_diary_plan` — 编译成可渲染剧本 JSON
- `ai_diary_render` — 渲染 9:16 MP4，可配音、换立绘、换底板、只渲前 N 秒
- `ai_diary_voice` — 三家 TTS 配音与混流
- `ai_diary_assets` — 素材自检，缺什么、该按什么 prompt 补
- `ai_diary_pick` — 按情绪挑立绘、按模板挑底板、给封面候选

**生成链**

- `ai_diary_hailuo` — MiniMax H3 视频生成（异步，默认 dry-run）
- `ai_diary_local` — 本机 ComfyUI 出图（探活 / 底模 / 六种风格 / 生成）
- `ai_diary_motion` — 角色短片归档、列清单、转动态底板

**发布链**

- `ai_diary_publish` — 客户端或浏览器两套发布路径（默认 dry-run，不替你点发布）
- `ai_diary_post` — 客户端真投稿编排，停在「立即投稿」前
- `ai_diary_comments` — 打开评论管理，可预填回复（默认不发送）

**桌面与运维**

- `pc_see` / `pc_act` — 桌面观察（文本优先）与多步动作串
- `ai_diary_update` — GitHub Releases 联网自更新

---

## 4. 快速开始

```powershell
# 1. 安装
dsh plugin --profile <你的profile> add .\dist\dsh-plugin-ai-diary-0.5.0.tgz

# 2. 选题 → 剧本 → 出片（全程不消耗额度）
node bin/ai-diary.mjs topics --count 3
node bin/ai-diary.mjs plan --topic day7-balance
node bin/ai-diary.mjs render --script out\day7-balance.json --out out\day7-balance.mp4

# 3. 想看构图先渲 8 秒
node bin/ai-diary.mjs render --script out\day7-balance.json --preview 8 --out out\preview.mp4
```

配音（任选一家，配好 key 就行）：

```powershell
$env:MIMO_API_KEY = "..."      # 小米 MiMo
$env:DASHSCOPE_API_KEY = "..." # 千问
$env:MINIMAX_API_KEY = "..."   # MiniMax
node bin/ai-diary.mjs render --script out\day7-balance.json --voice 冰糖 --provider xiaomi
```

本地模型出图（不联网、不耗额度）：

```powershell
# 先起 ComfyUI（8188 端口），底模放 models\checkpoints
node bin/ai-diary.mjs local --action probe
node bin/ai-diary.mjs local --prompt "1girl, blue hair, maid, white background" --style anime --out out\local\a.png
```

联网自更新：

```powershell
node bin/ai-diary.mjs update                     # 查有没有新版
node bin/ai-diary.mjs update --action apply --profile "<profile 根目录>"
```

---

## 5. 素材体系

```
assets/
  backgrounds/          12 张 9:16 背景（听证室、标本室、档案室、星夜…）
  characters/
    transparent/        8 角色 × chibi/adult 原版立绘
      variants/         88 张姿势变体（v2–v5、v10、v11、v16–v19；deepseek 另有 v6–v9、v12–v15）
    motion/             6 条 Seedance 角色循环短片（5.06s / 720×720）
  plates/               动态底板帧目录（每套 96 帧 / 8s / 12fps）
```

- 立绘全部抠透明、裁空边、缩到 1200px 高（总量 94.4MB）
- 姿势变体生成时**锁身份只换动作**：发色、兽耳/角/尾/翼、瞳色、服装、饰品一律不动
- 缺哪张，`ai_diary_assets` 会直接告诉你文件名与生成 prompt

---

## 6. 架构

```
bin/ai-diary.mjs      命令行入口（不装 dsh 也能单独跑）
src/
  index.mjs           插件入口：17 个工具注册 + Config 设置 schema + 技能注册
  topics.mjs          题材库
  script.mjs          剧本编译
  engine.mjs          渲染引擎（canvas 逐帧合成 → ffmpeg 编码）
  templates.mjs       6 套版面模板
  plate.mjs           动态底板读取 / 构建
  voice.mjs           三家 TTS
  hailuo.mjs          MiniMax H3
  local.mjs           本机 ComfyUI 客户端
  motion.mjs          角色短片归档
  update.mjs          GitHub Releases 自更新
  bili.mjs / post    客户端投稿与评论（UI 锚点在 config/bili.json）
  pc.mjs / pc-tools  桌面引擎（scripts/pc-engine.ps1 + PcNative.cs）
skills/ai-diary/      给模型看的技能说明（工具怎么串）
config/               客户端锚点、TTS、视频、更新源配置
```

设计取舍：**画面确定性优先**。同一份剧本每次渲染结果一致（除随机星点种子），方便迭代文案而不是每次赌模型发挥。

---

## 7. 边界与已知限制

- 引擎只能把**整段视频**转成动态底板，**不能把视频里的透明角色单独抠出来叠到立绘位**。
- 角色短片是 1:1 的，转 9:16 底板会裁放放大，容易出现「两个自己」（实测），更适合当封面 / 片尾素材。
- 投稿编排默认 `confirm:false`，**永远不会替你点「立即投稿」**；评论默认 `send:false`。
- 客户端 UI 锚点写在 `config/bili.json`，B 站客户端改版后只改配置不改代码；创作声明下拉的锚点尚未真机验证。
- 本地模型只接 ComfyUI 的 txt2img 标准图；视频类本地节点（SVD/AnimateDiff）尚未接入。
- TTS 三家都需要自备 key；无 key 时只有离线自检。

---

## 8.1 设置与定时（0.5.0 新增）

- 设置面板：Harness 官方设置读插件导出的 `Config`（schemastery）；配置落 `~/.ai-diary/settings.json`，环境变量 `MIMO_API_KEY` / `DASHSCOPE_API_KEY` / `MINIMAX_API_KEY` / `GITHUB_TOKEN` 优先。
- 定时：`ai_diary_schedule { action: "enable", daily_at: "20:30" }` 打开，一天只跑一次，到点自动出片 → 有 key 才配音 → 填好投稿表单停在「立即投稿」前；默认关闭。

## 8. Roadmap

- [ ] 本地视频节点（SVD / AnimateDiff）接入，绕开公网额度
- [ ] 角色短片转 9:16 时改「贴合高度 + 补边」而不是裁放
- [ ] 投稿编排补齐创作声明、封面、分区的真机锚点
- [ ] 题材库扩充到 30 条以上
- [ ] 一键打包脚本（ffmpeg 自动下载，免得仓库塞 100MB 二进制）

---

## 9. 许可

MIT。素材（立绘、背景、短片）为本项目自产，可随插件分发；第三方素材请自行确认授权。
