#install.ps1 — dsh-plugin-ai-diary 一键安装 / 卸载（Windows, PowerShell 7 或 5.1）
#
# 用法：
#   .\install.ps1                                   # 默认：link 装本目录到 desktop profile
#   .\install.ps1 -Mode tgz -PackagePath .\dsh-plugin-ai-diary-0.3.1.tgz
#   .\install.ps1 -ProfileRoot "$env:USERPROFILE\.dsh\profiles\web"
#   .\install.ps1 -Uninstall
#
# 说明：桌面版 Harness 的 desktop profile 由 Electron 应用独占，官方 dsh CLI 会被拒绝，
#       所以这里直接用 harness 自带的 pnpm 装包，再把插件名写进 profile 的 dsh.profile.bundles。

[CmdletBinding()]
param(
  [ValidateSet('link', 'tgz')][string]$Mode = 'link',
  [string]$PackagePath = '',
  [string]$ProfileRoot = '',
  [string]$HarnessRoot = 'D:\harness',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$PluginName = 'dsh-plugin-ai-diary'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ProfileRoot) { $ProfileRoot = Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }

function Say($msg) { Write-Host "[ai-diary] $msg" }

# ---------- 1. 环境检查 ----------
$profilePkg = Join-Path $ProfileRoot 'package.json'
if (-not (Test-Path -LiteralPath $profilePkg)) {
  throw "找不到 profile 清单：$profilePkg（先用 dsh --profile <名字> --help 确认 profile 是否已创建）"
}

$nodeCmd = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $nodeCmd) { throw 'PATH 里没有 node。装 Node 22+ 或把 dsh 自带 runtime 的 node 加进 PATH。' }
Say ("node = " + (& node --version))

$pnpmCandidates = @(
  (Join-Path $HarnessRoot 'resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'),
  (Join-Path $HarnessRoot 'resources\app.asar.unpacked\node_modules\pnpm\bin\pnpm.cjs')
)
$pnpm = $pnpmCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pnpm) {
  $cmd = (Get-Command pnpm -ErrorAction SilentlyContinue)
  if ($cmd) { $pnpm = 'CMD' } else { throw "找不到 pnpm：既没有 $($pnpmCandidates[0])，PATH 里也没有 pnpm。" }
}
Say ("pnpm = " + $pnpm)

function Invoke-Pnpm([string[]]$pnpmArgs) {
  if ($pnpm -eq 'CMD') {
    & pnpm @pnpmArgs
  } else {
    & node $pnpm --dir $ProfileRoot @pnpmArgs
  }
  if ($LASTEXITCODE -ne 0) { throw "pnpm 执行失败（退出码 $LASTEXITCODE）：pnpm $($pnpmArgs -join ' ')" }
}

# ---------- 2. 改写 bundles 的小工具（保持 JSON 合法、无 BOM） ----------
$helper = Join-Path $env:TEMP 'ai-diary-bundle-edit.mjs'
$helperCode = @'
import fs from 'node:fs';
const [file, name, action] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
j.dsh ??= {};
j.dsh.profile ??= {};
j.dsh.profile.bundles ??= [];
const has = j.dsh.profile.bundles.includes(name);
if (action === 'ensure' && !has) j.dsh.profile.bundles.push(name);
if (action === 'remove' && has) j.dsh.profile.bundles = j.dsh.profile.bundles.filter((x) => x !== name);
fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n', 'utf8');
console.log((action === 'ensure' ? 'bundles +' : 'bundles -') + name);
'@
[IO.File]::WriteAllText($helper, $helperCode, (New-Object Text.UTF8Encoding($false)))

function Edit-Bundle([string]$action) {
  & node $helper $profilePkg $PluginName $action
  if ($LASTEXITCODE -ne 0) { throw '写 profile 清单失败（检查 package.json 是否有 BOM 或语法问题）' }
}

# ---------- 3. 备份 ----------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $ProfileRoot "package.json.bak-aidiary-$stamp"
Copy-Item -LiteralPath $profilePkg -Destination $backup -Force
Say "已备份 profile 清单 → $backup"

# ---------- 4. 安装或卸载 ----------
if ($Uninstall) {
  Say '开始卸载…'
  Edit-Bundle 'remove'
  Invoke-Pnpm @('remove', $PluginName)
  $linkPath = Join-Path $ProfileRoot "node_modules\$PluginName"
  if (Test-Path -LiteralPath $linkPath) { Say "残留目录仍在：$linkPath（可手动删除）" }
  Say '卸载完成，重启 DeepSeek Harness 生效。'
  exit 0
}

$spec = if ($Mode -eq 'link') { "link:$Here" } else {
  $pkg = if ([IO.Path]::IsPathRooted($PackagePath)) { $PackagePath } else { Join-Path $Here $PackagePath }
  if (-not (Test-Path -LiteralPath $pkg)) { throw "找不到安装包：$pkg（先在插件目录执行 npm pack）" }
  Say ("安装包 = " + $pkg + " （" + [math]::Round((Get-Item -LiteralPath $pkg).Length / 1MB, 1) + " MB）")
  $pkg
}

Say "安装 $PluginName 到 $ProfileRoot"
Invoke-Pnpm @('add', $spec)

Edit-Bundle 'ensure'

# ---------- 5. 校验 ----------
$installed = Join-Path $ProfileRoot "node_modules\$PluginName"
if (-not (Test-Path -LiteralPath $installed)) { throw "装完但没找到 $installed，看看 pnpm 输出。" }
Say "已就位：$installed"

$loadTest = Join-Path $Here 'load-test.mjs'
if (Test-Path -LiteralPath $loadTest) {
  Say '跑一次工具注册自检…'
  & node $loadTest
}

Say ''
Say '完成。现在完全退出 DeepSeek Harness 再重新打开（不是只关窗口），插件才会加载。'
Say '验证：在会话里说「列一下 AI 日记的题材」，或跑 node bin/ai-diary.mjs topics --count 3'
Say '细节见 INSTALL.md；出问题先看 README 的「已知坑」。'
