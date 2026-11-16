param()
$root = Split-Path -Parent $PSScriptRoot
$raw = Join-Path $root 'assets\characters\_raw3'
$matte = Join-Path $root 'assets\characters\_matte3'
$variants = Join-Path $root 'assets\characters\transparent\variants'
New-Item -ItemType Directory -Force -Path $raw | Out-Null
New-Item -ItemType Directory -Force -Path $matte | Out-Null
New-Item -ItemType Directory -Force -Path $variants | Out-Null
Set-Location -LiteralPath $root

$map = @(
  @('deepseek_chibi_v4','https://aka.doubaocdn.com/s/UOGtMdom9d'),
  @('deepseek_chibi_v5','https://aka.doubaocdn.com/s/XdWqEVxtzo'),
  @('gpt_chibi_v4','https://aka.doubaocdn.com/s/0OlNCuVUWW'),
  @('gpt_chibi_v5','https://aka.doubaocdn.com/s/uTpdk2meGM'),
  @('claude_chibi_v4','https://aka.doubaocdn.com/s/2DZsKsRQb3'),
  @('claude_chibi_v5','https://aka.doubaocdn.com/s/KJ4X8bmuFs'),
  @('gemini_chibi_v4','https://aka.doubaocdn.com/s/Isxqu8IxsQ'),
  @('gemini_chibi_v5','https://aka.doubaocdn.com/s/1OhfFHYY02'),
  @('grok_chibi_v4','https://aka.doubaocdn.com/s/nEXSgKngpC'),
  @('grok_chibi_v5','https://aka.doubaocdn.com/s/baN5EqrFcJ'),
  @('glm_chibi_v4','https://aka.doubaocdn.com/s/yRn1z9KJ8s'),
  @('glm_chibi_v5','https://aka.doubaocdn.com/s/oDqN3psbs9'),
  @('qwen_chibi_v4','https://aka.doubaocdn.com/s/3oPaLriXcH'),
  @('qwen_chibi_v5','https://aka.doubaocdn.com/s/xG5D4xT4mk'),
  @('kimi_chibi_v4','https://aka.doubaocdn.com/s/dVuyIb8H0X'),
  @('kimi_chibi_v5','https://aka.doubaocdn.com/s/ZMqlcLAR7H')
)

$log = Join-Path $root 'pose.log'
Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue | Out-Null

foreach ($p in $map) {
  $n = $p[0]
  $u = $p[1]
  $f = Join-Path $raw ($n + '.png')
  try { Invoke-WebRequest -Uri $u -OutFile $f -TimeoutSec 120 | Out-Null } catch { ('{0} get-fail' -f $n) | Out-File -LiteralPath $log -Append -Encoding utf8; continue }
  $json = (& mediakit-cli image remove-image-background --image-url $f --scene general --output-format png 2>$null | Out-String)
  try { $o = $json | ConvertFrom-Json } catch { ('{0} parse-fail' -f $n) | Out-File -LiteralPath $log -Append -Encoding utf8; continue }
  if (-not $o.image_url) { ('{0} no-url' -f $n) | Out-File -LiteralPath $log -Append -Encoding utf8; continue }
  $out = Join-Path $matte ($n + '.png')
  try {
    Invoke-WebRequest -Uri $o.image_url -OutFile $out -TimeoutSec 120 | Out-Null
    ('{0} ok' -f $n) | Out-File -LiteralPath $log -Append -Encoding utf8
  } catch {
    ('{0} dl-fail' -f $n) | Out-File -LiteralPath $log -Append -Encoding utf8
  }
}

& node (Join-Path $root 'tools\trim.mjs') $matte $variants *>> (Join-Path $root 'pose-trim.log') 2>&1
'done' | Out-File -LiteralPath $log -Append -Encoding utf8
Get-Content -LiteralPath $log -Raw
