# harness 故障修复记录（2026-11-14）

## 现象
- 点「新会话 / 新建会话」没有任何反应，会话列表也看不到之前的会话。
- 磁盘上能查到一连串刚创建的空会话（只有一行 header），说明请求发出去了但服务端没建成功。

## 定位过程
1. 用调试端口连进 harness 前端（`DeepSeek Harness.exe --remote-debugging-port=9333`，CDP 直接 `Runtime.evaluate`），
   抓到点击「新建会话」时的真实返回：

```
POST /api/session/create → 200
{"result":{"ok":false,"error":{"code":"gateway/internal",
 "message":"failed to create session: TypeError: ctx.agents.roots is not a function"}}}
```

2. 全量检索 profile 里的插件源码，命中 `dsh-plugin-memory@0.17.9`：
   它在会话创建回调里直接调用 `ctx.agents.roots()`，没有任何兜底。
3. 新版 dsh（0.2.2-rc.2 起）把 `ctx.agents.roots()` 换成了 `ctx.agents.list()`，
   所以 0.17.9 在 0.2.2-rc.3 宿主上一调用就抛 TypeError，会话创建整体失败。

## 修复
1. `dsh-plugin-memory` 0.17.9 → **0.19.5**（该版本源码里已注明适配 0.2.2-rc.2 的 `agents.list`）。
2. `@deepseek-ai/dsh-tool-subagent` / `@deepseek-ai/dsh-subagent-codex` 0.2.2-rc.1 → **0.2.2-rc.3**，
   与宿主运行时同版本，消除启动日志里 4 行 "incompatible with dsh 0.2.2-rc.3" 的禁用告警（子智能体能力恢复）。
3. `~/.dsh/profiles/node_modules`（9/24 遗留的整套 0.1.5-rc.3，无清单文件）改名为
   `node_modules.legacy-0.1.5`，避免旧版本在解析路径上盖住 0.2.2-rc.3。
4. `dsh-plugin-ai-diary` 重新以 `link:` 装回 desktop profile，其 `@deepseek-ai/dsh-tools` 对齐到 0.2.2-rc.3。

## 验证
- 修复后同一接口：`{"ok":true,"value":{"sessionId":"...","agentPreset":"standard"}}`，控制台无报错，界面出现新会话输入框。
- 重启宿主 stderr 只剩 `desktop-product-telemetry` 的 `serviceVersion` 缺值（手动以 `ELECTRON_RUN_AS_NODE` 拉起时才会出现，
  正常从桌面应用启动时由宿主注入），无插件加载错误。
- 旧会话仍在：`~/.dsh/sessions/<workspace>/session-*` 未被改动，`storages/workspace.json` 索引完好。

## 回滚点
- `~/.dsh/profiles/desktop/package.json.bak-mem`、`pnpm-lock.yaml.bak-mem`（改内存插件前）
- `~/.dsh/profiles/desktop/package.json.bak-aidiary`（最初装插件前）
- `~/.dsh/profiles/node_modules.legacy-0.1.5`（改名前的旧包树）

## 备注
- 桌面 profile 由 Electron 应用独占管理，CLI 的 `dsh --profile desktop ...` 一律报
  `profile "desktop" is managed exclusively by the Electron application`，只能改 profile 文件 + 用它自带的 pnpm 装。
- 写 profile 的 `package.json` 必须 **无 BOM**，否则宿主启动直接报
  `Unexpected token '', "{... is not valid JSON`（本次踩过一次，已修）。
