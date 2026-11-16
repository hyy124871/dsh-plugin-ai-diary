# 把 dsh-plugin-ai-diary 发布到 GitHub（建仓 + 推源码 + 建 Release + 上传 tgz）
#
# 用法：
#   $env:GITHUB_TOKEN = "ghp_xxx"      # 需要 repo 权限的 token
#   powershell -ExecutionPolicy Bypass -File .\publish-github.ps1 -Repo "dsh-plugin-ai-diary" [-Private] [-Owner "你的账号"]
#
# 说明：
#   - 源码用 git 推（仓库里不含 vendor/ffmpeg.exe、dist/、work/、out/、assets/plates/，见 .gitignore）
#   - 223MB 的 tgz 不进 git，作为 Release 资源上传（GitHub 单资源上限 2GB）
#   - 成功后会把 owner/name 写进 config/update.json，插件即可联网查新
#   - 没装 git 时脚本会停下并给出 winget 安装命令，不会擅自安装系统软件

param(
  [string]$Repo = "dsh-plugin-ai-diary",
  [string]$Owner = "",
  [switch]$Private,
  [string]$Description = "AI 角色日记短剧流水线：选题→剧本→本地渲染→配音→B 站客户端投稿（DeepSeek Harness 插件）",
  [string]$Token = $env:GITHUB_TOKEN
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

if (-not $Token) { throw "缺少 token：设置 `$env:GITHUB_TOKEN（需 repo 权限），或传 -Token。" }

$ApiHeaders = @{
  Authorization = "Bearer $Token"
  Accept        = "application/vnd.github+json"
  'User-Agent'  = "dsh-plugin-ai-diary-publisher"
}

function Api($Method, $Url, $Body = $null) {
  if ($Body) {
    $json = $Body | ConvertTo-Json -Depth 6 -Compress
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $ApiHeaders -ContentType 'application/json; charset=utf-8' -Body $json
  }
  return Invoke-RestMethod -Method $Method -Uri $Url -Headers $ApiHeaders
}

$me = Api 'GET' 'https://api.github.com/user'
$login = if ($Owner) { $Owner } else { $me.login }
Write-Host "账号：$login"

$slug = "$login/$Repo"

# 1) 建仓（已存在就复用）
$exists = $true
try { Api 'GET' "https://api.github.com/repos/$slug" | Out-Null } catch { $exists = $false }

if (-not $exists) {
  $payload = @{ name = $Repo; description = $Description; private = [bool]$Private; has_issues = $true; has_wiki = $false; auto_init = $false }
  $created = Api 'POST' 'https://api.github.com/user/repos' $payload
  Write-Host "已建仓：$($created.html_url)"
} else {
  Write-Host "仓库已存在，直接推：https://github.com/$slug"
}

# 2) 推源码
$gitExe = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $gitExe) {
  # 没装独立 git 时，复用 GitHub Desktop 自带的 git
  $desk = Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\GitHubDesktop" -Recurse -Filter "git.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\cmd\\git\.exe$' } | Select-Object -First 1
  if ($desk) { $gitExe = $desk.FullName; Write-Host "用 GitHub Desktop 自带的 git：$gitExe" }
}
if (-not $gitExe) {
  Write-Host ""
  Write-Host "没有检测到 git。先装它（只装 git，不动别的）：" -ForegroundColor Yellow
  Write-Host "  winget install --id Git.Git -e --source winget"
  Write-Host "装完重跑本脚本即可。tgz 会成为 Release 资源，不需要 git 也能上传。"
  exit 2
}
function Git { & $gitExe @args }

if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
  Git init | Out-Null
  Git checkout -b main 2>$null | Out-Null
}
Git add -A
$staged = (Git diff --cached --name-only | Measure-Object -Line).Lines
if ($staged -gt 0) {
  Git -c user.name="$login" -c user.email="$login@users.noreply.github.com" commit -m "release: v$((Get-Content package.json -Raw | ConvertFrom-Json).version)" | Out-Null
}
if ((Git remote) -contains "origin") { Git remote set-url origin "https://x-access-token:$Token@github.com/$slug.git" } else { Git remote add origin "https://x-access-token:$Token@github.com/$slug.git" }
Git push -u origin main --force | Out-Null
Write-Host "源码已推送"

# 3) 打包并建 Release
$version = (Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'dist') | Out-Null
& npm pack --pack-destination dist | Out-Null
$tgz = Get-ChildItem -LiteralPath (Join-Path $Root 'dist') -Filter "dsh-plugin-ai-diary-$version.tgz" | Select-Object -First 1
if (-not $tgz) { throw "打包失败：dist 里没有 $version 的 tgz" }
Write-Host ("tarball {0:N1} MB" -f ($tgz.Length / 1MB))

$tag = "v$version"
$release = $null
try { $release = Api 'GET' "https://api.github.com/repos/$slug/releases/tags/$tag" } catch { $release = $null }
if (-not $release) {
  $release = Api 'POST' "https://api.github.com/repos/$slug/releases" @{
    tag_name         = $tag
    name             = "AI 日记工坊 $version"
    body             = "见 README.md 与 PROJECT-INTRO.md。安装：dsh plugin --profile <profile> add dsh-plugin-ai-diary-$version.tgz"
    draft            = $false
    prerelease       = $false
    generate_release_notes = $false
  }
  Write-Host "已建 Release $tag"
} else {
  Write-Host "Release $tag 已存在，追加资源"
}

# 4) 上传 tgz（uploads.github.com）
$uploadUrl = "https://uploads.github.com/repos/$slug/releases/$($release.id)/assets?name=$($tgz.Name)"
$bytes = [IO.File]::ReadAllBytes($tgz.FullName)
$resp = Invoke-RestMethod -Method POST -Uri $uploadUrl -Headers (@{
  Authorization          = "Bearer $Token"
  Accept                 = "application/vnd.github+json"
  'Content-Type'         = 'application/gzip'
  'User-Agent'           = 'dsh-plugin-ai-diary-publisher'
}) -Body $bytes
Write-Host "资源已上传：$($resp.browser_download_url)"

# 5) 写回更新源
$cfgPath = Join-Path $Root 'config\update.json'
$cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
$cfg.repo = $slug
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
Write-Host "config/update.json 已指向 $slug —— 插件现在可以 `update` 查新了"
Write-Host ""
Write-Host "完成：https://github.com/$slug"
