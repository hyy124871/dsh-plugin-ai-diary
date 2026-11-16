param()
$root = Split-Path -Parent $PSScriptRoot
$raw = Join-Path $root 'work\characters-raw-ds'
$matte = Join-Path $root 'work\characters-matte-ds'
$variants = Join-Path $root 'assets\characters\transparent\variants'
New-Item -ItemType Directory -Force -Path $raw | Out-Null
New-Item -ItemType Directory -Force -Path $matte | Out-Null
Set-Location -LiteralPath $root

$map = @(
  @('deepseek_chibi_v6','https://aka.doubaocdn.com/s/R185YZRc37'),
  @('deepseek_chibi_v7','https://aka.doubaocdn.com/s/hl9ROCgtEe'),
  @('deepseek_chibi_v8','https://aka.doubaocdn.com/s/elFXkkQY5l'),
  @('deepseek_chibi_v9','https://aka.doubaocdn.com/s/2Fd5XPfLUs')
)

$log = Join-Path $root 'ds-poses.log'
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

& node (Join-Path $root 'tools\trim.mjs') $matte $variants *>> (Join-Path $root 'ds-poses-trim.log') 2>&1
'done' | Out-File -LiteralPath $log -Append -Encoding utf8
Get-Content -LiteralPath $log -Raw
