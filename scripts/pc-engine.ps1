param(
  [Parameter(Mandatory = $true)][string]$Request,
  [Parameter(Mandatory = $true)][string]$Response
)

# pc-engine.ps1 - the desktop engine behind dsh-pc-control.
# One process per tool call, but every action of that call runs inside it, so a batching
# model pays one interpreter start for N steps. Results go to a UTF-8 JSON file instead of
# stdout to keep Chinese text encoding out of the picture.
# This file is intentionally ASCII: only JSON payloads carry non-ASCII.

$ErrorActionPreference = 'Stop'

$script:ok = $true
$script:summary = ''
$script:lines = @()
$script:errorText = $null
$script:image = $null
$script:failsafe = $true
$script:allowWinKeys = $false
$script:shotWidth = 1024
$script:maxActions = 24
$script:stopFile = Join-Path $env:LOCALAPPDATA 'dsh-pc-control\STOP'
$script:expected = [long]0
$script:includeHidden = $false

function Write-Result {
  $payload = [ordered]@{
    ok      = [bool]$script:ok
    summary = [string]$script:summary
    lines   = @($script:lines)
    image   = $script:image
    error   = $(if ($script:errorText) { [string]$script:errorText } else { $null })
  }
  $json = $payload | ConvertTo-Json -Depth 8 -Compress
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Response, $json, $enc)
}

function Stop-WithError([string]$message) {
  $script:ok = $false
  $script:errorText = $message
  Write-Result
  exit 0
}

# ---------------------------------------------------------------- native helper

function Initialize-Native {
  $root = Join-Path $env:LOCALAPPDATA 'dsh-pc-control'
  $bin = Join-Path $root 'bin'
  if (-not (Test-Path -LiteralPath $bin)) { New-Item -ItemType Directory -Path $bin -Force | Out-Null }
  $cs = Join-Path $PSScriptRoot 'PcNative.cs'
  if (-not (Test-Path -LiteralPath $cs)) { throw 'PcNative.cs is missing next to pc-engine.ps1' }
  $hash = (Get-FileHash -LiteralPath $cs -Algorithm SHA256).Hash.Substring(0, 10)
  $dll = Join-Path $bin ("PcNative-$hash.dll")
  if (-not (Test-Path -LiteralPath $dll)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $tmp = Join-Path $bin ("PcNative-$hash.$PID.tmp.dll")
    if (Test-Path -LiteralPath $csc) {
      & $csc /nologo /target:library /r:System.Drawing.dll /out:$tmp $cs 2>&1 | Out-Null
    }
    if ((Test-Path -LiteralPath $tmp) -and ((Get-Item -LiteralPath $tmp).Length -gt 0)) {
      try { Move-Item -LiteralPath $tmp -Destination $dll -Force }
      catch { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } }
    }
  }
  if (Test-Path -LiteralPath $dll) { Add-Type -Path $dll; return }
  Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($cs, [System.Text.Encoding]::UTF8)) -ReferencedAssemblies System.Drawing
}

# ---------------------------------------------------------------- windows

function Get-ForegroundLong { return [PcNative]::Ptr([PcNative]::Foreground()) }

function Get-ActiveTitle { return [PcNative]::TitleOf([PcNative]::Foreground()) }

function Get-WindowRows {
  $rows = @()
  foreach ($line in [PcNative]::Windows([bool]$script:includeHidden)) {
    $f = $line -split "`t"
    if ($f.Count -lt 8) { continue }
    $vis = $true
    if ($f.Count -ge 9) { $vis = ($f[8] -eq '1') }
    $rows += [pscustomobject]@{
      hwnd  = [long]$f[0]
      pid   = [int]$f[1]
      min   = ($f[2] -eq '1')
      x     = [int]$f[3]
      y     = [int]$f[4]
      w     = [int]$f[5]
      h     = [int]$f[6]
      title = [string]$f[7]
      vis   = [bool]$vis
    }
  }
  return $rows
}

function Get-TitleFragments([string]$w) {
  # A window spec may carry several alternatives separated by '|' ("哔哩哔哩|bilibili"),
  # so one config works across client builds whose titles differ.
  $parts = @($w -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($parts.Count -eq 0) { $parts = @($w) }
  return $parts
}

function Resolve-Target([string]$window) {
  $w = ''
  if ($window) { $w = $window.Trim() }
  if (-not $w -or $w -eq 'active') {
    $h = [PcNative]::Foreground()
    $r = [PcNative]::Rect($h)
    return [pscustomobject]@{ hwnd = [long][PcNative]::Ptr($h); title = [PcNative]::TitleOf($h); rect = $r; min = $false; vis = $true }
  }
  $rows = @(Get-WindowRows)
  $frags = @(Get-TitleFragments $w)
  $lowers = @($frags | ForEach-Object { $_.ToLower() })
  $exact = @($rows | Where-Object { $lowers -contains $_.title.ToLower() })
  if ($exact.Count -ge 1) { $pick = $exact[0] }
  else {
    $fuzzy = @($rows | Where-Object {
      $t = $_.title.ToLower()
      $hit = $false
      foreach ($f in $lowers) { if ($t.Contains($f)) { $hit = $true } }
      $hit
    })
    if ($fuzzy.Count -eq 1) { $pick = $fuzzy[0] }
    elseif ($fuzzy.Count -gt 1) {
      # Several windows contain the fragment (a client often has both a main window and a
      # "xxx-浏览器窗口"): prefer visible, then the shortest title, which is the container.
      $pick = @($fuzzy | Sort-Object @{ Expression = { if ($_.vis) { 0 } else { 1 } } }, @{ Expression = { $_.title.Length } })[0]
    }
    else {
      $sample = ($rows | Select-Object -First 6 | ForEach-Object { $_.title }) -join ' | '
      $hint = if ($script:includeHidden) { '' } else { ' (tray/hidden windows not listed; pass includeHidden)' }
      throw ('NO_WINDOW: nothing matches "' + $w + '" among ' + $rows.Count + ' windows' + $hint + ': ' + $sample)
    }
  }
  return [pscustomobject]@{
    hwnd  = [long]$pick.hwnd
    title = [string]$pick.title
    rect  = @([int]$pick.x, [int]$pick.y, [int]$pick.w, [int]$pick.h)
    min   = [bool]$pick.min
    vis   = [bool]$pick.vis
  }
}

function Get-WindowElement($target) {
  $h = [IntPtr]::new([long]$target.hwnd)
  try { $el = [System.Windows.Automation.AutomationElement]::FromHandle($h) }
  catch { throw ('UIA_UNAVAILABLE: cannot read the accessibility tree of "' + $target.title + '"') }
  if (-not $el) { throw ('UIA_UNAVAILABLE: cannot read the accessibility tree of "' + $target.title + '"') }
  return $el
}

# ---------------------------------------------------------------- uia formatting

$script:noisyTypes = @('Pane', 'Custom', 'Group', 'Image', 'Separator', 'TitleBar', 'StatusBar', 'ScrollBar', 'Thumb', 'ToolTip', 'Window')

function Format-Control($e) {
  try {
    $c = $e.Current
    $type = $c.ControlType.ProgrammaticName -replace 'ControlType\.', ''
    $name = [string]$c.Name
    $id = [string]$c.AutomationId
    if (-not $name -and -not $id) { return $null }
    if (-not $name -and ($script:noisyTypes -contains $type)) { return $null }
    $line = $type
    if ($name) { $line += ' "' + ($name -replace '"', '''') + '"' }
    if ($id) { $line += ' id:' + $id }
    if ($type -in @('Edit', 'Document', 'ComboBox')) {
      try {
        $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $val = [string]$vp.Current.Value
        if ($val) {
          $val = $val -replace "`r?`n", ' '
          if ($val.Length -gt 40) { $val = $val.Substring(0, 40) + '...' }
          $line += ' ="' + ($val -replace '"', '''') + '"'
        }
      }
      catch { }
    }
    $r = $c.BoundingRectangle
    if ($r.Width -gt 1 -and $r.Height -gt 1) {
      $line += ' @' + [int]($r.X + $r.Width / 2) + ',' + [int]($r.Y + $r.Height / 2)
    }
    return $line
  }
  catch { return $null }
}

function Get-TreeLines($root, [int]$max) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue([pscustomobject]@{ E = $root; D = 0 })
  $out = @()
  while ($queue.Count -gt 0 -and $out.Count -lt $max) {
    $item = $queue.Dequeue()
    try {
      $c = $item.E.Current
      if (-not $c.IsOffscreen) {
        $line = Format-Control $item.E
        if ($line) { $out += $line }
        if ($item.D -lt 6 -and $out.Count -lt $max) {
          $child = $walker.GetFirstChild($item.E)
          while ($child -and $out.Count -lt $max) {
            $queue.Enqueue([pscustomobject]@{ E = $child; D = $item.D + 1 })
            $child = $walker.GetNextSibling($child)
          }
        }
      }
    }
    catch { }
  }
  return $out
}

function Find-Controls($root, [string]$query, [int]$max) {
  $q = $query.Trim().ToLower()
  if (-not $q) { throw 'find needs a query' }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue([pscustomobject]@{ E = $root; D = 0 })
  $hits = @()
  $scanned = 0
  while ($queue.Count -gt 0 -and $hits.Count -lt $max -and $scanned -lt 4000) {
    $item = $queue.Dequeue()
    $scanned++
    try {
      $c = $item.E.Current
      $name = [string]$c.Name
      $id = [string]$c.AutomationId
      $hit = $false
      if (-not $c.IsOffscreen) {
        if ($name -and $name.ToLower().Contains($q)) { $hit = $true }
        elseif ($id -and $id.ToLower().Contains($q)) { $hit = $true }
      }
      if ($hit) {
        $line = Format-Control $item.E
        if ($line) {
          $hits += [pscustomobject]@{
            Element = $item.E
            Line    = $line
            Name    = $name
            Exact   = ($name -eq $query)
          }
        }
      }
      if ($item.D -lt 8 -and $hits.Count -lt $max) {
        $child = $walker.GetFirstChild($item.E)
        while ($child) {
          $queue.Enqueue([pscustomobject]@{ E = $child; D = $item.D + 1 })
          $child = $walker.GetNextSibling($child)
        }
      }
    }
    catch { }
  }
  return $hits
}

function Invoke-Control($e) {
  try { $p = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $p.Invoke(); return 'invoke' } catch { }
  try { $p = $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); $p.Select(); return 'select' } catch { }
  try { $p = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $p.Toggle(); return 'toggle' } catch { }
  try { $p = $e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); $p.Expand(); return 'expand' } catch { }
  $r = $e.Current.BoundingRectangle
  if ($r.Width -le 1 -or $r.Height -le 1) { throw 'CONTROL_NOT_CLICKABLE: no on-screen area' }
  $cx = [int]($r.X + $r.Width / 2)
  $cy = [int]($r.Y + $r.Height / 2)
  [void][PcNative]::Move($cx, $cy)
  Start-Sleep -Milliseconds 45
  [PcNative]::Click('left', 1)
  return ('click@' + $cx + ',' + $cy)
}

# ---------------------------------------------------------------- keyboard

$script:vkNames = @{
  'enter' = 0x0D; 'return' = 0x0D; 'tab' = 0x09; 'esc' = 0x1B; 'escape' = 0x1B; 'space' = 0x20;
  'backspace' = 0x08; 'bs' = 0x08; 'delete' = 0x2E; 'del' = 0x2E; 'up' = 0x26; 'down' = 0x28;
  'left' = 0x25; 'right' = 0x27; 'home' = 0x24; 'end' = 0x23; 'pgup' = 0x21; 'pgdn' = 0x22;
  'pageup' = 0x21; 'pagedown' = 0x22; 'insert' = 0x2D; 'ins' = 0x2D;
  'ctrl' = 0x11; 'control' = 0x11; 'shift' = 0x10; 'alt' = 0x12; 'win' = 0x5B; 'meta' = 0x5B
}

$script:modKeys = @('ctrl', 'control', 'shift', 'alt', 'win', 'meta')

function Get-KeyVk([string]$key) {
  $k = $key.Trim().ToLower()
  if ($script:vkNames.ContainsKey($k)) { return @($script:vkNames[$k], 0) }
  if ($k -match '^f([1-9]|1[0-9]|2[0-4])$') { return @((0x70 + [int]$k.Substring(1) - 1), 0) }
  if ($k.Length -eq 1) {
    $r = [PcNative]::VkForChar([char]$k)
    if ($r[0] -lt 0) { throw ('BAD_KEY: cannot type "' + $key + '" on this layout') }
    return @([int]$r[0], [int]$r[1])
  }
  throw ('BAD_KEY: unknown key "' + $key + '"')
}

function Send-Combo([string]$combo) {
  $parts = @($combo -split '\+' | Where-Object { $_.Trim() -ne '' })
  if ($parts.Count -eq 0) { throw 'BAD_KEY: empty key combo' }
  $mods = @()
  $main = $null
  foreach ($p in $parts) {
    $k = $p.Trim().ToLower()
    if ($script:modKeys -contains $k) { $mods += $k } else { $main = $p.Trim() }
  }
  if (-not $main) { throw ('BAD_KEY: combo needs a non-modifier key (' + $combo + ')') }
  if (-not $script:allowWinKeys -and (($mods -contains 'win') -or ($mods -contains 'meta'))) {
    throw 'WINKY_DISABLED: Win-key combos are disabled in this plugin (Win+L locks the session)'
  }
  $downs = @()
  foreach ($m in $mods) {
    switch ($m) {
      'ctrl' { $downs += 0x11 }
      'control' { $downs += 0x11 }
      'shift' { $downs += 0x10 }
      'alt' { $downs += 0x12 }
      'win' { $downs += 0x5B }
      'meta' { $downs += 0x5B }
    }
  }
  $vk = Get-KeyVk $main
  if ((([int]$vk[1]) -band 1) -ne 0 -and -not ($downs -contains 0x10)) { $downs += 0x10 }
  foreach ($v in $downs) { [PcNative]::KeyDownVk([int]$v); Start-Sleep -Milliseconds 10 }
  [PcNative]::TapVk([int]$vk[0], 0)
  [array]::Reverse($downs)
  foreach ($v in $downs) { [PcNative]::KeyUpVk([int]$v); Start-Sleep -Milliseconds 10 }
  return 'ok'
}

function Send-Text([string]$text, [bool]$forcePaste) {
  # Default path is SendInput + KEYEVENTF_UNICODE, which bypasses the IME: plain virtual-key
  # taps let an active Chinese IME rewrite "ok" into CJK text.
  if (-not $forcePaste) {
    if ([PcNative]::TypeText($text)) { return 'type' }
  }
  $old = $null
  try { $old = Get-Clipboard -Raw -ErrorAction Stop } catch { }
  Set-Clipboard -Value $text
  Start-Sleep -Milliseconds 60
  [void](Send-Combo 'ctrl+v')
  Start-Sleep -Milliseconds 220
  if ($null -ne $old) { try { Set-Clipboard -Value $old } catch { } }
  return 'paste'
}

# ---------------------------------------------------------------- guards

function Assert-Safe([bool]$dry) {
  if (-not $dry -and $script:failsafe) {
    $p = [PcNative]::Cursor()
    if ($p[0] -le 2 -and $p[1] -le 2) {
      throw 'EMERGENCY_STOP: the physical cursor is parked in the top-left corner; move it away'
    }
  }
  if (Test-Path -LiteralPath $script:stopFile) {
    throw 'STOP_ACTIVE: the emergency stop file exists (run "resume" to clear it)'
  }
}

function Assert-Foreground {
  $fg = Get-ForegroundLong
  if ($fg -ne $script:expected) {
    throw ('FOREGROUND_CHANGED: focus is on "' + (Get-ActiveTitle) + '"; typing refused')
  }
}

# ---------------------------------------------------------------- actions

function Get-Numbers([string]$s) {
  $nums = @()
  foreach ($t in @($s -split '\s+' | Where-Object { $_ -ne '' })) {
    $n = 0
    if ([int]::TryParse($t, [ref]$n)) { $nums += $n }
  }
  return $nums
}

function Get-BareText([string]$s) {
  $t = $s.Trim()
  if ($t.Length -ge 2) {
    $first = $t.Substring(0, 1)
    if (($first -eq '"' -or $first -eq "'") -and $t.Substring($t.Length - 1, 1) -eq $first) {
      $t = $t.Substring(1, $t.Length - 2)
    }
  }
  return $t
}

function Invoke-Step([string]$raw, [bool]$dry) {
  $text = $raw.Trim()
  if (-not $text) { throw 'EMPTY_ACTION' }
  $sp = $text.IndexOf(' ')
  if ($sp -lt 0) { $verb = $text.ToLower(); $rest = '' }
  else { $verb = $text.Substring(0, $sp).ToLower(); $rest = $text.Substring($sp + 1).Trim() }

  switch ($verb) {
    'move' {
      $n = @(Get-Numbers $rest)
      if ($n.Count -lt 2) { throw 'BAD_ARGS: move needs x y' }
      if (-not $dry) { Assert-Safe $dry; [void][PcNative]::Move([int]$n[0], [int]$n[1]) }
      return ('move @' + $n[0] + ',' + $n[1])
    }
    'click' {
      $button = 'left'
      $count = 1
      $nums = @()
      foreach ($t in @($rest -split '\s+' | Where-Object { $_ -ne '' })) {
        $k = $t.ToLower()
        if ($k -eq 'right' -or $k -eq 'left' -or $k -eq 'middle') { $button = $k; continue }
        $n = 0
        if ([int]::TryParse($k, [ref]$n)) { $nums += $n }
      }
      if ($nums.Count -ge 2) {
        if (-not $dry) { Assert-Safe $dry; [void][PcNative]::Move([int]$nums[0], [int]$nums[1]); Start-Sleep -Milliseconds 35 }
      }
      elseif ($nums.Count -eq 1) { $count = [Math]::Max(1, [int]$nums[0]) }
      if (-not $dry) { Assert-Safe $dry; [PcNative]::Click($button, $count) }
      $p = [PcNative]::Cursor()
      return ('click ' + $button + ' x' + $count + ' @' + $p[0] + ',' + $p[1])
    }
    'dclick' {
      $n = @(Get-Numbers $rest)
      if ($n.Count -ge 2) {
        if (-not $dry) { Assert-Safe $dry; [void][PcNative]::Move([int]$n[0], [int]$n[1]); Start-Sleep -Milliseconds 35 }
      }
      if (-not $dry) { Assert-Safe $dry; [PcNative]::Click('left', 2) }
      $p = [PcNative]::Cursor()
      return ('double-click @' + $p[0] + ',' + $p[1])
    }
    'drag' {
      $n = @(Get-Numbers $rest)
      if ($n.Count -lt 4) { throw 'BAD_ARGS: drag needs x1 y1 x2 y2' }
      if (-not $dry) {
        Assert-Safe $dry
        [void][PcNative]::Move([int]$n[0], [int]$n[1])
        Start-Sleep -Milliseconds 60
        [PcNative]::Down('left')
        Start-Sleep -Milliseconds 60
        $steps = 12
        for ($i = 1; $i -le $steps; $i++) {
          $x = [int]($n[0] + (($n[2] - $n[0]) * $i / $steps))
          $y = [int]($n[1] + (($n[3] - $n[1]) * $i / $steps))
          [void][PcNative]::Move($x, $y)
          Start-Sleep -Milliseconds 18
        }
        Start-Sleep -Milliseconds 40
        [PcNative]::Up('left')
      }
      return ('drag ' + $n[0] + ',' + $n[1] + ' -> ' + $n[2] + ',' + $n[3])
    }
    'scroll' {
      $n = @(Get-Numbers $rest)
      if ($n.Count -lt 1) { throw 'BAD_ARGS: scroll needs a notch count (positive = up)' }
      if ($n.Count -ge 3 -and -not $dry) { [void][PcNative]::Move([int]$n[1], [int]$n[2]); Start-Sleep -Milliseconds 30 }
      if (-not $dry) { Assert-Safe $dry; [PcNative]::Wheel([int]$n[0]) }
      return ('scroll ' + $n[0])
    }
    'type' {
      if (-not $dry) { Assert-Safe $dry; Assert-Foreground; [void](Send-Text (Get-BareText $rest) $false) }
      return ('type ' + (Get-BareText $rest).Length + ' chars')
    }
    'paste' {
      if (-not $dry) { Assert-Safe $dry; Assert-Foreground; [void](Send-Text (Get-BareText $rest) $true) }
      return ('paste ' + (Get-BareText $rest).Length + ' chars')
    }
    'key' {
      if (-not $dry) { Assert-Safe $dry; Assert-Foreground; [void](Send-Combo (Get-BareText $rest)) }
      return ('key ' + (Get-BareText $rest))
    }
    'focus' {
      $title = Get-BareText $rest
      if (-not $title) { throw 'BAD_ARGS: focus needs a window title fragment' }
      if ($dry) { return ('focus "' + $title + '"') }
      $t = Resolve-Target $title
      [void][PcNative]::Activate([IntPtr]::new([long]$t.hwnd))
      Start-Sleep -Milliseconds 120
      $script:expected = [PcNative]::Ptr([PcNative]::Foreground())
      return ('focus "' + $t.title + '"')
    }
    'hit' {
      $name = Get-BareText $rest
      if (-not $name) { throw 'BAD_ARGS: hit needs a control name' }
      $root = Get-WindowElement (Resolve-Target 'active')
      $hits = @(Find-Controls $root $name 8)
      if ($hits.Count -eq 0) { throw ('NO_CONTROL: nothing matches "' + $name + '" in the active window') }
      if ($hits.Count -gt 1) {
        $exact = @($hits | Where-Object { $_.Exact })
        if ($exact.Count -eq 1) { $hits = $exact }
        else {
          $preview = ($hits | Select-Object -First 3 | ForEach-Object { $_.Line }) -join ' | '
          throw ('AMBIGUOUS_CONTROL: ' + $hits.Count + ' controls match "' + $name + '": ' + $preview)
        }
      }
      if ($dry) { return ('hit ' + $hits[0].Line) }
      Assert-Safe $dry
      $how = Invoke-Control $hits[0].Element
      Start-Sleep -Milliseconds 120
      return ('hit ' + $how + ' ' + $hits[0].Line)
    }
    'wait' {
      $sec = 0.0
      if (-not [double]::TryParse($rest, [ref]$sec)) { throw 'BAD_ARGS: wait needs seconds' }
      if ($sec -gt 5) { $sec = 5 }
      if (-not $dry) { Start-Sleep -Milliseconds ([int]($sec * 1000)) }
      return ('wait ' + $sec + 's')
    }
    'stop' {
      if ($dry) { return 'stop (dry-run: no file written)' }
      $dir = Split-Path -Parent $script:stopFile
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      Set-Content -LiteralPath $script:stopFile -Value ('stopped at ' + (Get-Date).ToString('s')) -Encoding ASCII
      return 'stop: emergency stop file created'
    }
    'resume' {
      if ($dry) { return 'resume (dry-run: no file removed)' }
      if (Test-Path -LiteralPath $script:stopFile) { Remove-Item -LiteralPath $script:stopFile -Force }
      return 'resume: emergency stop cleared'
    }
    default {
      throw ('UNKNOWN_VERB: "' + $verb + '" (move|click|dclick|drag|scroll|type|paste|key|focus|hit|wait|stop|resume)')
    }
  }
}

# ---------------------------------------------------------------- see

function Do-See {
  param($req, [string]$what, [string]$window, [string]$query, [int]$limit, [int]$width)

  switch ($what) {
    'windows' {
      $max = if ($limit -gt 0) { $limit } else { 40 }
      $rows = @(Get-WindowRows)
      if ($window) {
        $frags = @(Get-TitleFragments $window.Trim())
        $lowers = @($frags | ForEach-Object { $_.ToLower() })
        $rows = @($rows | Where-Object {
          $t = $_.title.ToLower()
          $hit = $false
          foreach ($f in $lowers) { if ($t.Contains($f)) { $hit = $true } }
          $hit
        })
      }
      $dupes = @($rows | Group-Object title | Where-Object { $_.Count -gt 1 } | ForEach-Object { $_.Name })
      $out = @()
      $i = 0
      foreach ($r in $rows) {
        if ($i -ge $max) { break }
        $i++
        $line = $i.ToString() + ' "' + $r.title + '" ' + $r.w + 'x' + $r.h
        if ($dupes -contains $r.title) { $line += ' p' + $r.pid }
        if ($r.min) { $line += ' (min)' }
        if (-not $r.vis) { $line += ' (hidden)' }
        $out += $line
      }
      $script:lines = $out
      $script:summary = 'windows ' + $i + '/' + $rows.Count
      return
    }
    'tree' {
      $max = if ($limit -gt 0) { $limit } else { 60 }
      $t = Resolve-Target $window
      if ($t.min) { throw ('WINDOW_MINIMIZED: "' + $t.title + '" is minimized; restore it first') }
      $el = Get-WindowElement $t
      $controls = @(Get-TreeLines $el $max)
      $head = 'win "' + $t.title + '" ' + $t.rect[2] + 'x' + $t.rect[3] + ' @' + $t.rect[0] + ',' + $t.rect[1]
      if ((Get-ForegroundLong) -ne [long]$t.hwnd) { $head += ' !fg' }
      $script:lines = @($head) + $controls
      $script:summary = 'tree ' + $controls.Count + ' controls'
      return
    }
    'find' {
      $max = if ($limit -gt 0) { $limit } else { 20 }
      if (-not $query) { throw 'BAD_ARGS: find needs a query' }
      $t = Resolve-Target $window
      $el = Get-WindowElement $t
      $hits = @(Find-Controls $el $query $max)
      $script:lines = @($hits | ForEach-Object { $_.Line })
      $script:summary = 'find ' + $hits.Count + ' for "' + $query + '"'
      return
    }
    'shot' {
      $t = Resolve-Target $window
      # Tray / hidden / minimized: bring the window back first, then re-read its geometry
      # (the rect of a hidden window is stale or zero, so capturing it would fail).
      if ($t.min -or (-not $t.vis)) {
        [void][PcNative]::Activate([IntPtr]::new([long]$t.hwnd))
        Start-Sleep -Milliseconds 1200
        $t = Resolve-Target $t.title
        if ($t.min) {
          [void][PcNative]::Activate([IntPtr]::new([long]$t.hwnd))
          Start-Sleep -Milliseconds 600
        }
      }
      $outPath = [string]$req.out
      if (-not $outPath) { throw 'BAD_ARGS: shot needs an output path' }
      $targetWidth = if ($width -gt 0) { $width } else { $script:shotWidth }
      $r = $t.rect
      $grid = $false
      if ($null -ne $req.grid) { $grid = [bool]$req.grid }
      $meta = ([PcNative]::Capture([int]$r[0], [int]$r[1], [int]$r[2], [int]$r[3], [int]$targetWidth, $outPath, $grid)) -split "`t"
      $script:image = [ordered]@{
        path   = $outPath
        width  = [int]$meta[0]
        height = [int]$meta[1]
        scale  = [double]$meta[2]
        title  = $t.title
        origin = @([int]$r[0], [int]$r[1])
      }
      $fg = ((Get-ForegroundLong) -eq [long]$t.hwnd)
      $script:lines = @(('shot "' + $t.title + '" ' + $meta[0] + 'x' + $meta[1] + ' scale=' + $meta[2] + ' origin=' + $r[0] + ',' + $r[1] + $(if ($fg) { '' } else { ' occludedPossible' })))
      $script:summary = 'shot ' + $meta[0] + 'x' + $meta[1]
      return
    }
    default { throw ('BAD_WHAT: "' + $what + '" (windows|tree|find|shot)') }
  }
}

# ---------------------------------------------------------------- main

try {
  $req = ([System.IO.File]::ReadAllText($Request, [System.Text.Encoding]::UTF8)) | ConvertFrom-Json

  if ($req.options) {
    if ($null -ne $req.options.failsafe) { $script:failsafe = [bool]$req.options.failsafe }
    if ($null -ne $req.options.allowWinKeys) { $script:allowWinKeys = [bool]$req.options.allowWinKeys }
    if ($null -ne $req.options.shotWidth) { $script:shotWidth = [int]$req.options.shotWidth }
    if ($null -ne $req.options.maxActions) { $script:maxActions = [int]$req.options.maxActions }
  }
  if ($null -ne $req.includeHidden) { $script:includeHidden = [bool]$req.includeHidden }

  Add-Type -AssemblyName System.Drawing
  Initialize-Native
  [void][PcNative]::InitDpi()

  $op = [string]$req.op
  if ($op -eq 'warmup') {
    $script:summary = 'ready'
    $script:lines = @()
    Write-Result
    exit 0
  }

  if ($op -eq 'see') {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $limit = 0
    if ($req.limit) { $limit = [int]$req.limit }
    $width = 0
    if ($req.width) { $width = [int]$req.width }
    Do-See $req ([string]$req.what) ([string]$req.window) ([string]$req.query) $limit $width
    Write-Result
    exit 0
  }

  if ($op -eq 'act') {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $actions = @($req.actions)
    if ($actions.Count -eq 0) { throw 'BAD_ARGS: actions is empty' }
    if ($actions.Count -gt [Math]::Max(1, $script:maxActions)) {
      throw ('TOO_MANY: ' + $actions.Count + ' actions in one call, limit is ' + $script:maxActions)
    }
    $dry = [bool]$req.dryRun
    $script:expected = Get-ForegroundLong
    $out = @()
    $done = 0
    $failedAt = 0
    foreach ($a in $actions) {
      $done++
      try {
        $line = Invoke-Step ([string]$a) $dry
        $out += ($done.ToString() + '. ' + $line)
      }
      catch {
        $failedAt = $done
        $msg = $_.Exception.Message
        $out += ($done.ToString() + '. FAIL ' + $msg)
        break
      }
    }
    $script:lines = $out
    if ($failedAt -gt 0) {
      $script:summary = 'fail at step ' + $failedAt + ' of ' + $actions.Count
      $script:ok = $false
      $script:errorText = $script:lines[$script:lines.Count - 1]
    }
    else {
      $script:summary = $(if ($dry) { 'dry-run ' } else { 'ok ' }) + $done + '/' + $actions.Count
    }
    Write-Result
    exit 0
  }

  throw ('BAD_OP: "' + $op + '" (see|act|warmup)')
}
catch {
  Stop-WithError $_.Exception.Message
}
