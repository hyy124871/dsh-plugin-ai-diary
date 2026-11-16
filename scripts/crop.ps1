param(
  [Parameter(Mandatory=$true)][string]$InPath,
  [Parameter(Mandatory=$true)][string]$OutPath,
  [Parameter(Mandatory=$true)][int]$X,
  [Parameter(Mandatory=$true)][int]$Y,
  [Parameter(Mandatory=$true)][int]$W,
  [Parameter(Mandatory=$true)][int]$H,
  [double]$Scale = 2
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile($InPath)
try {
  $x = [Math]::Max(0, [Math]::Min($X, $src.Width - 2))
  $y = [Math]::Max(0, [Math]::Min($Y, $src.Height - 2))
  $w = [Math]::Min($W, $src.Width - $x)
  $h = [Math]::Min($H, $src.Height - $y)

  $dw = [int]($w * $Scale)
  $dh = [int]($h * $Scale)
  $bmp = New-Object System.Drawing.Bitmap($dw, $dh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)), (New-Object System.Drawing.Rectangle($x, $y, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("ok {0}x{1} scale={2} from=({3},{4},{5},{6})" -f $dw, $dh, $Scale, $x, $y, $w, $h)
}
finally {
  $src.Dispose()
}
