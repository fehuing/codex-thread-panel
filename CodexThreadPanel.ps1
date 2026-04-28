param(
  [switch]$NoGui,
  [switch]$Console,
  [switch]$Maximize
)

$ErrorActionPreference = "Stop"

function Get-CodexHome {
  if ($env:CODEX_HOME -and (Test-Path -LiteralPath $env:CODEX_HOME)) {
    return $env:CODEX_HOME
  }

  return (Join-Path $HOME ".codex")
}

function New-SharedReadStream {
  param([Parameter(Mandatory = $true)][string]$Path)

  $share = [System.IO.FileShare]([int][System.IO.FileShare]::ReadWrite -bor [int][System.IO.FileShare]::Delete)
  return [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
}

function Read-FileLinesShared {
  param([Parameter(Mandatory = $true)][string]$Path)

  $lines = New-Object System.Collections.Generic.List[string]
  if (-not (Test-Path -LiteralPath $Path)) {
    return $lines.ToArray()
  }

  $stream = $null
  $reader = $null
  try {
    $stream = New-SharedReadStream -Path $Path
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.UTF8Encoding]::new($false), $true)
    while (-not $reader.EndOfStream) {
      $lines.Add($reader.ReadLine())
    }
  } catch {
    return $lines.ToArray()
  } finally {
    if ($reader) { $reader.Dispose() }
    elseif ($stream) { $stream.Dispose() }
  }

  return $lines
}

function Get-LastMatchingLineShared {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Needle
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $last = $null
  $stream = $null
  $reader = $null
  try {
    $stream = New-SharedReadStream -Path $Path
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.UTF8Encoding]::new($false), $true)
    while (-not $reader.EndOfStream) {
      $line = $reader.ReadLine()
      if ($line -and $line.Contains($Needle)) {
        $last = $line
      }
    }
  } catch {
    return $null
  } finally {
    if ($reader) { $reader.Dispose() }
    elseif ($stream) { $stream.Dispose() }
  }

  return $last
}

function ConvertFrom-JsonLine {
  param([string]$Line)

  if ([string]::IsNullOrWhiteSpace($Line)) {
    return $null
  }

  try {
    return ($Line | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function ConvertTo-LocalDateTime {
  param($Value)

  if ($null -eq $Value -or "$Value" -eq "") {
    return $null
  }

  try {
    if ($Value -is [datetime]) {
      return $Value.ToLocalTime()
    }

    $text = "$Value"
    if ($text -match "^\d+$") {
      $number = [int64]$text
      if ($number -gt 999999999999) {
        return [DateTimeOffset]::FromUnixTimeMilliseconds($number).LocalDateTime
      }

      return [DateTimeOffset]::FromUnixTimeSeconds($number).LocalDateTime
    }

    return ([DateTimeOffset]::Parse($text)).LocalDateTime
  } catch {
    return $null
  }
}

function ConvertTo-DisplayTime {
  param($DateTime)

  if ($null -eq $DateTime) {
    return ""
  }

  return ([datetime]$DateTime).ToString("yyyy-MM-dd HH:mm")
}

function ConvertTo-SingleLine {
  param([string]$Text)

  if ($null -eq $Text) {
    return ""
  }

  return (($Text -replace "[\r\n\t]+", " ") -replace "\s{2,}", " ").Trim()
}

function Normalize-CodexPath {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ""
  }

  if ($Path.StartsWith("\\?\UNC\")) {
    return ("\\" + $Path.Substring(8))
  }

  if ($Path.StartsWith("\\?\")) {
    return $Path.Substring(4)
  }

  return $Path
}

function Get-ProjectName {
  param([string]$Path)

  $Path = Normalize-CodexPath $Path

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return "(unknown project)"
  }

  $trimmed = $Path.TrimEnd("\", "/")
  $leaf = Split-Path -Path $trimmed -Leaf
  if ([string]::IsNullOrWhiteSpace($leaf)) {
    return $Path
  }

  return $leaf
}

function New-ThreadRecord {
  param(
    [string]$Id,
    [string]$ThreadName,
    $UpdatedDate,
    [string]$Cwd,
    [bool]$Archived,
    [string]$Model,
    [string]$ReasoningEffort,
    [int64]$TokensUsed,
    [string]$SourceFile,
    [string]$Source
  )

  $ThreadName = ConvertTo-SingleLine $ThreadName
  $Cwd = Normalize-CodexPath $Cwd

  if ([string]::IsNullOrWhiteSpace($ThreadName)) {
    $ThreadName = "Untitled thread"
  }

  [pscustomobject]@{
    Id              = $Id
    ThreadName      = $ThreadName
    UpdatedDate     = $UpdatedDate
    UpdatedText     = ConvertTo-DisplayTime $UpdatedDate
    Cwd             = $Cwd
    Project         = Get-ProjectName $Cwd
    Archived        = $Archived
    Model           = $Model
    ReasoningEffort = $ReasoningEffort
    TokensUsed      = $TokensUsed
    SourceFile      = $SourceFile
    Source          = $Source
  }
}

function Get-CodexThreadsFromSqlite {
  param([string]$CodexHome)

  $dbPath = Join-Path $CodexHome "state_5.sqlite"
  $sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
  if (-not $sqlite -or -not (Test-Path -LiteralPath $dbPath)) {
    return @()
  }

  $query = @"
select
  id,
  title,
  cwd,
  archived,
  rollout_path,
  tokens_used,
  model,
  reasoning_effort,
  updated_at_ms,
  updated_at
from threads
order by coalesce(updated_at_ms, updated_at * 1000) desc, id desc;
"@

  try {
    $json = & $sqlite.Source -json $dbPath $query 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) {
      return @()
    }

    $rows = ($json -join "`n") | ConvertFrom-Json
    if ($null -eq $rows) {
      return @()
    }

    return @($rows | ForEach-Object {
      $updated = $null
      if ($_.updated_at_ms) {
        $updated = ConvertTo-LocalDateTime $_.updated_at_ms
      } elseif ($_.updated_at) {
        $updated = ConvertTo-LocalDateTime $_.updated_at
      }

      New-ThreadRecord `
        -Id $_.id `
        -ThreadName $_.title `
        -UpdatedDate $updated `
        -Cwd $_.cwd `
        -Archived ([bool]$_.archived) `
        -Model $_.model `
        -ReasoningEffort $_.reasoning_effort `
        -TokensUsed ([int64]($_.tokens_used -as [int64])) `
        -SourceFile $_.rollout_path `
        -Source "sqlite"
    })
  } catch {
    return @()
  }
}

function Get-SessionMetaLine {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $stream = $null
  $reader = $null
  try {
    $stream = New-SharedReadStream -Path $Path
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.UTF8Encoding]::new($false), $true)
    $maxLines = 50
    $lineNumber = 0
    while (-not $reader.EndOfStream -and $lineNumber -lt $maxLines) {
      $line = $reader.ReadLine()
      if ($line -and $line.Contains('"session_meta"')) {
        return $line
      }
      $lineNumber++
    }
  } catch {
    return $null
  } finally {
    if ($reader) { $reader.Dispose() }
    elseif ($stream) { $stream.Dispose() }
  }

  return $null
}

function Get-SessionMetaRecords {
  param([string]$CodexHome)

  $roots = @(
    [pscustomobject]@{ Path = (Join-Path $CodexHome "sessions"); Archived = $false },
    [pscustomobject]@{ Path = (Join-Path $CodexHome "archived_sessions"); Archived = $true }
  )

  $records = New-Object System.Collections.Generic.List[object]
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root.Path)) {
      continue
    }

    $files = Get-ChildItem -LiteralPath $root.Path -Recurse -File -Filter "*.jsonl" -ErrorAction SilentlyContinue
    foreach ($file in $files) {
      $line = Get-SessionMetaLine -Path $file.FullName
      $obj = ConvertFrom-JsonLine -Line $line
      if ($null -eq $obj -or $null -eq $obj.payload -or [string]::IsNullOrWhiteSpace($obj.payload.id)) {
        continue
      }

      [void]$records.Add([pscustomobject]@{
        Id         = $obj.payload.id
        Cwd        = $obj.payload.cwd
        Timestamp  = ConvertTo-LocalDateTime $obj.payload.timestamp
        Archived   = [bool]$root.Archived
        SourceFile = $file.FullName
        Model      = $obj.payload.model
      })
    }
  }

  return $records.ToArray()
}

function Get-SessionIndexRecords {
  param([string]$CodexHome)

  $indexPath = Join-Path $CodexHome "session_index.jsonl"
  if (-not (Test-Path -LiteralPath $indexPath)) {
    return @()
  }

  $records = New-Object System.Collections.Generic.List[object]
  foreach ($line in (Read-FileLinesShared -Path $indexPath)) {
    $obj = ConvertFrom-JsonLine -Line $line
    if ($null -eq $obj -or [string]::IsNullOrWhiteSpace($obj.id)) {
      continue
    }

    [void]$records.Add([pscustomobject]@{
      Id         = $obj.id
      ThreadName = $obj.thread_name
      Updated    = ConvertTo-LocalDateTime $obj.updated_at
    })
  }

  return $records.ToArray()
}

function Get-CodexThreads {
  $codexHome = Get-CodexHome
  $byId = @{}

  foreach ($thread in (Get-CodexThreadsFromSqlite -CodexHome $codexHome)) {
    if (-not [string]::IsNullOrWhiteSpace($thread.Id)) {
      $byId[$thread.Id] = $thread
    }
  }

  $metas = Get-SessionMetaRecords -CodexHome $codexHome
  $metaById = @{}
  foreach ($meta in $metas) {
    if ([string]::IsNullOrWhiteSpace($meta.Id)) {
      continue
    }

    if (-not $metaById.ContainsKey($meta.Id) -or ($meta.Timestamp -and $metaById[$meta.Id].Timestamp -lt $meta.Timestamp)) {
      $metaById[$meta.Id] = $meta
    }
  }

  foreach ($index in (Get-SessionIndexRecords -CodexHome $codexHome)) {
    $meta = $null
    if ($metaById.ContainsKey($index.Id)) {
      $meta = $metaById[$index.Id]
    }

    if ($byId.ContainsKey($index.Id)) {
      if (-not [string]::IsNullOrWhiteSpace($index.ThreadName)) {
        $byId[$index.Id].ThreadName = $index.ThreadName
      }
      if ($index.Updated) {
        $byId[$index.Id].UpdatedDate = $index.Updated
        $byId[$index.Id].UpdatedText = ConvertTo-DisplayTime $index.Updated
      }
      if ($meta -and [string]::IsNullOrWhiteSpace($byId[$index.Id].Cwd)) {
        $byId[$index.Id].Cwd = $meta.Cwd
        $byId[$index.Id].Project = Get-ProjectName $meta.Cwd
      }
      continue
    }

    $byId[$index.Id] = New-ThreadRecord `
      -Id $index.Id `
      -ThreadName $index.ThreadName `
      -UpdatedDate $index.Updated `
      -Cwd $(if ($meta) { $meta.Cwd } else { "" }) `
      -Archived $(if ($meta) { $meta.Archived } else { $false }) `
      -Model $(if ($meta) { $meta.Model } else { "" }) `
      -ReasoningEffort "" `
      -TokensUsed 0 `
      -SourceFile $(if ($meta) { $meta.SourceFile } else { "" }) `
      -Source "index"
  }

  foreach ($meta in $metas) {
    if ($byId.ContainsKey($meta.Id)) {
      if ([string]::IsNullOrWhiteSpace($byId[$meta.Id].Cwd)) {
        $byId[$meta.Id].Cwd = $meta.Cwd
        $byId[$meta.Id].Project = Get-ProjectName $meta.Cwd
      }
      if ([string]::IsNullOrWhiteSpace($byId[$meta.Id].SourceFile)) {
        $byId[$meta.Id].SourceFile = $meta.SourceFile
      }
      continue
    }

    $name = "Untitled thread"
    if ($meta.SourceFile) {
      $name = [System.IO.Path]::GetFileNameWithoutExtension($meta.SourceFile)
    }

    $byId[$meta.Id] = New-ThreadRecord `
      -Id $meta.Id `
      -ThreadName $name `
      -UpdatedDate $meta.Timestamp `
      -Cwd $meta.Cwd `
      -Archived $meta.Archived `
      -Model $meta.Model `
      -ReasoningEffort "" `
      -TokensUsed 0 `
      -SourceFile $meta.SourceFile `
      -Source "session"
  }

  return @($byId.Values | Sort-Object @{ Expression = { if ($_.UpdatedDate) { $_.UpdatedDate } else { [datetime]::MinValue } }; Descending = $true }, ThreadName)
}

function Get-CodexSessionFiles {
  param([string]$CodexHome)

  $roots = @(
    (Join-Path $CodexHome "sessions"),
    (Join-Path $CodexHome "archived_sessions")
  )

  $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  foreach ($root in $roots) {
    if (Test-Path -LiteralPath $root) {
      foreach ($file in (Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.jsonl" -ErrorAction SilentlyContinue)) {
        [void]$files.Add($file)
      }
    }
  }

  return @($files | Sort-Object LastWriteTime -Descending)
}

function Get-LatestRateLimit {
  $codexHome = Get-CodexHome
  $latest = $null

  foreach ($file in (Get-CodexSessionFiles -CodexHome $codexHome)) {
    $line = Get-LastMatchingLineShared -Path $file.FullName -Needle '"rate_limits"'
    if (-not $line) {
      continue
    }

    $obj = ConvertFrom-JsonLine -Line $line
    if ($null -eq $obj -or $null -eq $obj.payload -or $null -eq $obj.payload.rate_limits) {
      continue
    }

    $timestamp = ConvertTo-LocalDateTime $obj.timestamp
    $candidate = [pscustomobject]@{
      Timestamp = $timestamp
      File      = $file.FullName
      Raw       = $obj.payload.rate_limits
    }

    if ($null -eq $latest -or ($timestamp -and $latest.Timestamp -lt $timestamp)) {
      $latest = $candidate
    }

    if ($latest -and $file.LastWriteTime -lt (Get-Date).AddDays(-2)) {
      break
    }
  }

  return $latest
}

function ConvertTo-QuotaWindowName {
  param($WindowMinutes)

  switch ([int]$WindowMinutes) {
    300 { return "5h limit" }
    10080 { return "weekly limit" }
    default { return "$WindowMinutes min limit" }
  }
}

function ConvertTo-ResetInfo {
  param($EpochSeconds)

  if ($null -eq $EpochSeconds -or "$EpochSeconds" -eq "") {
    return "reset time unknown"
  }

  try {
    $reset = [DateTimeOffset]::FromUnixTimeSeconds([int64]$EpochSeconds).LocalDateTime
    $span = $reset - (Get-Date)
    if ($span.TotalSeconds -le 0) {
      return "reset time reached, waiting for Codex refresh"
    }

    if ($span.TotalDays -ge 1) {
      return ("resets in {0}d {1}h ({2})" -f [math]::Floor($span.TotalDays), $span.Hours, $reset.ToString("MM-dd HH:mm"))
    }

    if ($span.TotalHours -ge 1) {
      return ("resets in {0}h {1}m ({2})" -f [math]::Floor($span.TotalHours), $span.Minutes, $reset.ToString("HH:mm"))
    }

    return ("resets in {0}m {1}s ({2})" -f [math]::Max(0, $span.Minutes), [math]::Max(0, $span.Seconds), $reset.ToString("HH:mm"))
  } catch {
    return "reset time parse failed"
  }
}

function ConvertTo-SafePercent {
  param($Value)

  try {
    $number = [double]$Value
    if ($number -lt 0) { return 0 }
    if ($number -gt 100) { return 100 }
    return [int][math]::Round($number)
  } catch {
    return 0
  }
}

function Escape-ForSingleQuotedPowerShell {
  param([string]$Text)

  if ($null -eq $Text) {
    return ""
  }

  return $Text.Replace("'", "''")
}

function Get-PreferredShell {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }

  $powershell = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if ($powershell) {
    return $powershell.Source
  }

  return "powershell.exe"
}

function Start-CodexResume {
  param(
    [Parameter(Mandatory = $true)][string]$SessionId,
    [string]$Cwd
  )

  $commands = New-Object System.Collections.Generic.List[string]
  if (-not [string]::IsNullOrWhiteSpace($Cwd) -and (Test-Path -LiteralPath $Cwd)) {
    $commands.Add("Set-Location -LiteralPath '$(Escape-ForSingleQuotedPowerShell $Cwd)'")
  }
  $commands.Add("codex resume '$(Escape-ForSingleQuotedPowerShell $SessionId)'")

  Start-Process -FilePath (Get-PreferredShell) -ArgumentList @("-NoExit", "-Command", ($commands -join "; "))
}

function Start-CodexNewThread {
  param([Parameter(Mandatory = $true)][string]$Cwd)

  $commands = New-Object System.Collections.Generic.List[string]
  $commands.Add("Set-Location -LiteralPath '$(Escape-ForSingleQuotedPowerShell $Cwd)'")
  $commands.Add("codex -C '$(Escape-ForSingleQuotedPowerShell $Cwd)'")

  Start-Process -FilePath (Get-PreferredShell) -ArgumentList @("-NoExit", "-Command", ($commands -join "; "))
}

function Get-ConsoleWidthSafe {
  try {
    if ($Host.UI.RawUI.WindowSize.Width -gt 20) {
      return [int]$Host.UI.RawUI.WindowSize.Width
    }
  } catch {
  }

  return 100
}

function Get-ConsoleHeightSafe {
  try {
    if ($Host.UI.RawUI.WindowSize.Height -gt 10) {
      return [int]$Host.UI.RawUI.WindowSize.Height
    }
  } catch {
  }

  return 30
}

function Limit-Text {
  param(
    [string]$Text,
    [int]$MaxLength
  )

  if ($null -eq $Text) {
    return ""
  }

  if ($MaxLength -lt 4) {
    return ""
  }

  if ((Get-DisplayWidth $Text) -le $MaxLength) {
    return $Text
  }

  $target = $MaxLength - 3
  $width = 0
  $builder = New-Object System.Text.StringBuilder
  foreach ($ch in $Text.ToCharArray()) {
    $charWidth = 1
    if ([int][char]$ch -gt 127) {
      $charWidth = 2
    }
    if (($width + $charWidth) -gt $target) {
      break
    }
    [void]$builder.Append($ch)
    $width += $charWidth
  }

  return ($builder.ToString() + "...")
}

function Get-DisplayWidth {
  param([string]$Text)

  if ($null -eq $Text) {
    return 0
  }

  $width = 0
  foreach ($ch in $Text.ToCharArray()) {
    if ([int][char]$ch -gt 127) {
      $width += 2
    } else {
      $width += 1
    }
  }

  return $width
}

function Pad-DisplayText {
  param(
    [string]$Text,
    [int]$Width
  )

  if ($null -eq $Text) {
    $Text = ""
  }

  $displayWidth = Get-DisplayWidth $Text
  if ($displayWidth -lt $Width) {
    return ($Text + (" " * ($Width - $displayWidth)))
  }

  return $Text
}

function Get-ProjectChoices {
  $items = New-Object System.Collections.Generic.List[object]
  [void]$items.Add([pscustomobject]@{
    Index = 0
    Label = "All projects"
    Cwd   = ""
    Count = $script:AllThreads.Count
  })

  $groups = $script:AllThreads |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.Cwd) } |
    Group-Object Cwd |
    Sort-Object -Property @{ Expression = "Count"; Descending = $true }, Name

  $index = 1
  foreach ($group in $groups) {
    [void]$items.Add([pscustomobject]@{
      Index = $index
      Label = "$(Get-ProjectName $group.Name) - $($group.Name)"
      Cwd   = $group.Name
      Count = $group.Count
    })
    $index++
  }

  return $items.ToArray()
}

function Get-ConsoleFilteredThreads {
  param(
    [string]$ProjectCwd,
    [string]$Search,
    [bool]$IncludeArchived
  )

  $filtered = $script:AllThreads | Where-Object {
    if (-not $IncludeArchived -and $_.Archived) { return $false }
    if ($ProjectCwd -and $_.Cwd -ne $ProjectCwd) { return $false }
    if ($Search) {
      $haystack = "$($_.ThreadName)`n$($_.Cwd)`n$($_.Id)`n$($_.Model)"
      if ($haystack.IndexOf($Search, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        return $false
      }
    }
    return $true
  }

  return @($filtered | Sort-Object @{ Expression = { if ($_.UpdatedDate) { $_.UpdatedDate } else { [datetime]::MinValue } }; Descending = $true })
}

function Get-QuotaConsoleText {
  if ($null -eq $script:LatestQuota -or $null -eq $script:LatestQuota.Raw) {
    return @(
      "Quota: not found yet. Start or resume a Codex thread to refresh it.",
      "Now: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
    )
  }

  $rate = $script:LatestQuota.Raw
  $primaryUsed = ConvertTo-SafePercent $rate.primary.used_percent
  $secondaryUsed = ConvertTo-SafePercent $rate.secondary.used_percent
  $primaryName = ConvertTo-QuotaWindowName $rate.primary.window_minutes
  $secondaryName = ConvertTo-QuotaWindowName $rate.secondary.window_minutes

  return @(
    "Plan: $($rate.plan_type) | Last quota event: $(ConvertTo-DisplayTime $script:LatestQuota.Timestamp)",
    "${primaryName}: $primaryUsed% | $(ConvertTo-ResetInfo $rate.primary.resets_at)",
    "${secondaryName}: $secondaryUsed% | $(ConvertTo-ResetInfo $rate.secondary.resets_at)",
    "Now: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
  )
}

function Show-CodexConsolePage {
  param(
    [object[]]$Threads,
    [int]$Page,
    [int]$PageSize,
    [string]$ProjectCwd,
    [string]$Search,
    [bool]$IncludeArchived
  )

  $width = Get-ConsoleWidthSafe
  $line = "-" * ([Math]::Min($width, 120))
  Clear-Host
  Write-Host "Codex Thread Panel - Console"
  Write-Host $line
  foreach ($quotaLine in (Get-QuotaConsoleText)) {
    Write-Host (Limit-Text $quotaLine ($width - 1))
  }
  Write-Host $line

  $projectText = "All projects"
  if ($ProjectCwd) {
    $projectText = $ProjectCwd
  }
  if ([string]::IsNullOrWhiteSpace($Search)) {
    $searchText = "(none)"
  } else {
    $searchText = $Search
  }

  Write-Host ("Project: {0}" -f (Limit-Text $projectText ($width - 10)))
  Write-Host ("Search: {0} | Archived: {1}" -f (Limit-Text $searchText 50), $(if ($IncludeArchived) { "shown" } else { "hidden" }))
  Write-Host $line

  $total = $Threads.Count
  $totalPages = [Math]::Max(1, [int][Math]::Ceiling($total / [double]$PageSize))
  if ($Page -lt 0) { $Page = 0 }
  if ($Page -ge $totalPages) { $Page = $totalPages - 1 }

  $start = $Page * $PageSize
  $end = [Math]::Min($start + $PageSize - 1, $total - 1)
  Write-Host ("Threads: {0} | Page: {1}/{2}" -f $total, ($Page + 1), $totalPages)
  Write-Host ""

  if ($total -eq 0) {
    Write-Host "No threads match the current filters."
  } else {
    for ($i = $start; $i -le $end; $i++) {
      $thread = $Threads[$i]
      $localIndex = ($i - $start + 1)
      if ($thread.Archived) {
        $archiveMark = "A"
      } else {
        $archiveMark = " "
      }
      $titleMax = [Math]::Min(52, [Math]::Max(20, [int](($width - 32) / 2)))
      $title = Limit-Text $thread.ThreadName $titleMax
      $cwd = Limit-Text $thread.Cwd ($width - 8)
      Write-Host ("[{0,2}] {1} {2} {3}" -f $localIndex, $thread.UpdatedText, $archiveMark, $title)
      Write-Host ("     {0}" -f $cwd)
    }
  }

  Write-Host ""
  Write-Host $line
  Write-Host "Commands: number=open | Enter=next | b=prev | p=projects | s=search | a=archive toggle"
  Write-Host "          n=new thread | f=open folder | r=refresh | q=quit"

  return [pscustomobject]@{
    Page       = $Page
    TotalPages = $totalPages
    Start      = $start
    End        = $end
  }
}

function Select-ConsoleProject {
  $choices = Get-ProjectChoices
  Clear-Host
  Write-Host "Project Filter"
  Write-Host ("-" * 80)
  foreach ($choice in $choices) {
    Write-Host ("[{0,2}] {1} ({2})" -f $choice.Index, (Limit-Text $choice.Label 68), $choice.Count)
  }
  Write-Host ""
  $inputValue = Read-Host "Choose project number, or blank for all"
  if ([string]::IsNullOrWhiteSpace($inputValue)) {
    return ""
  }

  $number = 0
  if (-not [int]::TryParse($inputValue, [ref]$number)) {
    return $null
  }

  $selected = $choices | Where-Object { $_.Index -eq $number } | Select-Object -First 1
  if ($selected) {
    return $selected.Cwd
  }

  return $null
}

function Get-ConsoleProjectOrPrompt {
  param([string]$ProjectCwd)

  if ($ProjectCwd -and (Test-Path -LiteralPath $ProjectCwd)) {
    return $ProjectCwd
  }

  $path = Read-Host "Project path"
  if ([string]::IsNullOrWhiteSpace($path)) {
    return $null
  }

  if (-not (Test-Path -LiteralPath $path)) {
    Write-Host "Path does not exist: $path"
    [void](Read-Host "Press Enter to continue")
    return $null
  }

  return $path
}

function Write-ConsoleAt {
  param(
    [int]$X,
    [int]$Y,
    [string]$Text,
    [int]$Width,
    [System.ConsoleColor]$Foreground = [System.ConsoleColor]::Gray,
    [System.ConsoleColor]$Background = [System.ConsoleColor]::Black
  )

  if ($Width -le 0 -or $Y -lt 0 -or $X -lt 0) {
    return
  }

  $consoleWidth = Get-ConsoleWidthSafe
  $consoleHeight = Get-ConsoleHeightSafe
  if ($X -ge $consoleWidth -or $Y -ge $consoleHeight) {
    return
  }

  $safeWidth = [Math]::Min($Width, $consoleWidth - $X)
  $textValue = Limit-Text (ConvertTo-SingleLine $Text) $safeWidth
  $textValue = Pad-DisplayText $textValue $safeWidth

  try {
    [Console]::SetCursorPosition($X, $Y)
    $oldFg = [Console]::ForegroundColor
    $oldBg = [Console]::BackgroundColor
    [Console]::ForegroundColor = $Foreground
    [Console]::BackgroundColor = $Background
    [Console]::Write($textValue)
    [Console]::ForegroundColor = $oldFg
    [Console]::BackgroundColor = $oldBg
  } catch {
  }
}

function Draw-ConsolePanel {
  param(
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height,
    [string]$Title
  )

  if ($Width -lt 4 -or $Height -lt 3) {
    return
  }

  $top = "+" + ("-" * ($Width - 2)) + "+"
  $mid = "|" + (" " * ($Width - 2)) + "|"
  Write-ConsoleAt -X $X -Y $Y -Text $top -Width $Width -Foreground DarkGray
  for ($row = 1; $row -lt ($Height - 1); $row++) {
    Write-ConsoleAt -X $X -Y ($Y + $row) -Text $mid -Width $Width -Foreground DarkGray
  }
  Write-ConsoleAt -X $X -Y ($Y + $Height - 1) -Text $top -Width $Width -Foreground DarkGray

  if (-not [string]::IsNullOrWhiteSpace($Title)) {
    Write-ConsoleAt -X ($X + 2) -Y $Y -Text " $Title " -Width ([Math]::Min($Title.Length + 2, $Width - 4)) -Foreground White
  }
}

function Write-PanelLine {
  param(
    [int]$X,
    [int]$Y,
    [int]$Width,
    [string]$Text,
    [System.ConsoleColor]$Foreground = [System.ConsoleColor]::Gray,
    [System.ConsoleColor]$Background = [System.ConsoleColor]::Black
  )

  Write-ConsoleAt -X ($X + 1) -Y $Y -Text $Text -Width ($Width - 2) -Foreground $Foreground -Background $Background
}

function Get-DashboardProjectGroups {
  param(
    [bool]$IncludeArchived,
    [string]$Search
  )

  $filtered = $script:AllThreads | Where-Object {
    if (-not $IncludeArchived -and $_.Archived) { return $false }
    if ($Search) {
      $haystack = "$($_.ThreadName)`n$($_.Cwd)`n$($_.Id)`n$($_.Model)"
      if ($haystack.IndexOf($Search, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        return $false
      }
    }
    return $true
  }

  $groups = $filtered |
    Group-Object Cwd |
    ForEach-Object {
      $threads = @($_.Group | Sort-Object @{ Expression = { if ($_.UpdatedDate) { $_.UpdatedDate } else { [datetime]::MinValue } }; Descending = $true })
      $latest = $null
      if ($threads.Count -gt 0) {
        $latest = $threads[0].UpdatedDate
      }
      [pscustomobject]@{
        Cwd     = $_.Name
        Name    = Get-ProjectName $_.Name
        Count   = $threads.Count
        Latest  = $latest
        Threads = $threads
      }
    }

  return @($groups | Sort-Object @{ Expression = { if ($_.Latest) { $_.Latest } else { [datetime]::MinValue } }; Descending = $true }, Name)
}

function Get-DashboardNodes {
  param(
    [hashtable]$ExpandedProjects,
    [bool]$IncludeArchived,
    [string]$Search
  )

  $nodes = New-Object System.Collections.Generic.List[object]
  foreach ($project in (Get-DashboardProjectGroups -IncludeArchived $IncludeArchived -Search $Search)) {
    $expanded = $false
    if ($ExpandedProjects.ContainsKey($project.Cwd)) {
      $expanded = [bool]$ExpandedProjects[$project.Cwd]
    }

    [void]$nodes.Add([pscustomobject]@{
      Type     = "project"
      Cwd      = $project.Cwd
      Project  = $project
      Thread   = $null
      Expanded = $expanded
    })

    if ($expanded) {
      foreach ($thread in $project.Threads) {
        [void]$nodes.Add([pscustomobject]@{
          Type     = "thread"
          Cwd      = $project.Cwd
          Project  = $project
          Thread   = $thread
          Expanded = $false
        })
      }
    }
  }

  return $nodes.ToArray()
}

function Get-DashboardStats {
  param(
    [object[]]$Nodes,
    [bool]$IncludeArchived,
    [string]$Search
  )

  $projectCount = @($script:AllThreads | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Cwd) } | Group-Object Cwd).Count
  $activeCount = @($script:AllThreads | Where-Object { -not $_.Archived }).Count
  $archivedCount = @($script:AllThreads | Where-Object { $_.Archived }).Count
  $visibleThreadCount = @($Nodes | Where-Object { $_.Type -eq "thread" }).Count
  $visibleProjectCount = @($Nodes | Where-Object { $_.Type -eq "project" }).Count

  [pscustomobject]@{
    TotalThreads   = $script:AllThreads.Count
    ActiveThreads  = $activeCount
    Archived       = $archivedCount
    Projects       = $projectCount
    VisibleThreads = $visibleThreadCount
    VisibleProjects = $visibleProjectCount
    IncludeArchived = $IncludeArchived
    Search          = $Search
  }
}

function Render-DashboardTree {
  param(
    [object[]]$Nodes,
    [int]$SelectedIndex,
    [int]$ScrollTop,
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height,
    [bool]$IncludeArchived,
    [string]$Search
  )

  Draw-ConsolePanel -X $X -Y $Y -Width $Width -Height $Height -Title "Projects / Threads"
  $filterLine = "Archived: "
  if ($IncludeArchived) { $filterLine += "shown" } else { $filterLine += "hidden" }
  if ($Search) { $filterLine += " | Search: $Search" }
  Write-PanelLine -X $X -Y ($Y + 1) -Width $Width -Text $filterLine -Foreground DarkGray

  $listY = $Y + 2
  $listHeight = $Height - 3
  if ($Nodes.Count -eq 0) {
    Write-PanelLine -X $X -Y $listY -Width $Width -Text "No projects or threads match the current filters." -Foreground Yellow
    return
  }

  $endIndex = [Math]::Min($Nodes.Count - 1, $ScrollTop + $listHeight - 1)
  $row = 0
  for ($i = $ScrollTop; $i -le $endIndex; $i++) {
    $node = $Nodes[$i]
    $isSelected = ($i -eq $SelectedIndex)
    $fg = [System.ConsoleColor]::Gray
    $bg = [System.ConsoleColor]::Black
    if ($isSelected) {
      $fg = [System.ConsoleColor]::Black
      $bg = [System.ConsoleColor]::Gray
    }

    if ($node.Type -eq "project") {
      if ($node.Expanded) { $mark = "[-]" } else { $mark = "[+]" }
      $latestText = ConvertTo-DisplayTime $node.Project.Latest
      $text = (" {0} {1} ({2}) {3}" -f $mark, $node.Project.Name, $node.Project.Count, $latestText)
      Write-PanelLine -X $X -Y ($listY + $row) -Width $Width -Text $text -Foreground $fg -Background $bg
    } else {
      $thread = $node.Thread
      if ($thread.Archived) { $arch = "A" } else { $arch = " " }
      $titleMax = [Math]::Max(12, $Width - 31)
      $title = Limit-Text $thread.ThreadName $titleMax
      $timeText = $thread.UpdatedText
      if ($timeText -and $timeText.Length -gt 5) {
        $timeText = $timeText.Substring(5)
      }
      $text = ("     {0} {1} {2}" -f $arch, $timeText, $title)
      Write-PanelLine -X $X -Y ($listY + $row) -Width $Width -Text $text -Foreground $fg -Background $bg
    }
    $row++
  }

  if ($ScrollTop -gt 0) {
    Write-PanelLine -X $X -Y ($Y + 1) -Width $Width -Text "^ more above" -Foreground DarkYellow
  }
  if ($endIndex -lt ($Nodes.Count - 1)) {
    Write-PanelLine -X $X -Y ($Y + $Height - 2) -Width $Width -Text "v more below" -Foreground DarkYellow
  }
}

function Render-DashboardTreeRow {
  param(
    [object[]]$Nodes,
    [int]$Index,
    [int]$SelectedIndex,
    [int]$ScrollTop,
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  $listY = $Y + 2
  $listHeight = $Height - 3
  $row = $Index - $ScrollTop
  if ($row -lt 0 -or $row -ge $listHeight) {
    return
  }

  if ($Index -lt 0 -or $Index -ge $Nodes.Count) {
    Write-PanelLine -X $X -Y ($listY + $row) -Width $Width -Text "" -Foreground Gray -Background Black
    return
  }

  $node = $Nodes[$Index]
  $isSelected = ($Index -eq $SelectedIndex)
  $fg = [System.ConsoleColor]::Gray
  $bg = [System.ConsoleColor]::Black
  if ($isSelected) {
    $fg = [System.ConsoleColor]::Black
    $bg = [System.ConsoleColor]::Gray
  }

  if ($node.Type -eq "project") {
    if ($node.Expanded) { $mark = "[-]" } else { $mark = "[+]" }
    $latestText = ConvertTo-DisplayTime $node.Project.Latest
    $text = (" {0} {1} ({2}) {3}" -f $mark, $node.Project.Name, $node.Project.Count, $latestText)
  } else {
    $thread = $node.Thread
    if ($thread.Archived) { $arch = "A" } else { $arch = " " }
    $titleMax = [Math]::Max(12, $Width - 31)
    $title = Limit-Text $thread.ThreadName $titleMax
    $timeText = $thread.UpdatedText
    if ($timeText -and $timeText.Length -gt 5) {
      $timeText = $timeText.Substring(5)
    }
    $text = ("     {0} {1} {2}" -f $arch, $timeText, $title)
  }

  Write-PanelLine -X $X -Y ($listY + $row) -Width $Width -Text $text -Foreground $fg -Background $bg
}

function Render-DashboardDetails {
  param(
    [object]$Node,
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  Draw-ConsolePanel -X $X -Y $Y -Width $Width -Height $Height -Title "Selection"
  Write-DashboardDetailsContent -Node $Node -X $X -Y $Y -Width $Width -Height $Height
}

function Get-DashboardDetailLines {
  param([object]$Node)

  if ($null -eq $Node) {
    return @("No selection.")
  }

  if ($Node.Type -eq "project") {
    $project = $Node.Project
    $expandedText = "collapsed"
    if ($Node.Expanded) { $expandedText = "expanded" }
    $lines = @(
      "Type: project",
      "Name: $($project.Name)",
      "Threads: $($project.Count)",
      "State: $expandedText",
      "Latest: $(ConvertTo-DisplayTime $project.Latest)",
      "Path: $($project.Cwd)",
      "Enter/Right: expand | Left: collapse",
      "N: new Codex thread here | F: open folder"
    )
  } else {
    $thread = $Node.Thread
    $archiveText = "no"
    if ($thread.Archived) { $archiveText = "yes" }
    $lines = @(
      "Type: thread",
      "Title: $($thread.ThreadName)",
      "Updated: $($thread.UpdatedText)",
      "Project: $($thread.Project)",
      "Model: $($thread.Model)",
      "Tokens: $($thread.TokensUsed)",
      "Archived: $archiveText",
      "Id: $($thread.Id)",
      "Path: $($thread.Cwd)",
      "Enter/O: open this thread"
    )
  }

  return $lines
}

function Write-DashboardDetailsContent {
  param(
    [object]$Node,
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  $lines = Get-DashboardDetailLines -Node $Node
  $maxLines = $Height - 2
  for ($i = 0; $i -lt $maxLines; $i++) {
    if ($i -lt $lines.Count) {
      $foreground = [System.ConsoleColor]::Gray
      if ($null -eq $Node) {
        $foreground = [System.ConsoleColor]::Yellow
      }
      Write-PanelLine -X $X -Y ($Y + 1 + $i) -Width $Width -Text $lines[$i] -Foreground $foreground
    } else {
      Write-PanelLine -X $X -Y ($Y + 1 + $i) -Width $Width -Text ""
    }
  }
}

function Render-DashboardStats {
  param(
    [object]$Stats,
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  Draw-ConsolePanel -X $X -Y $Y -Width $Width -Height $Height -Title "Workspace"
  $archivedText = "hidden"
  if ($Stats.IncludeArchived) { $archivedText = "shown" }
  if ($Stats.Search) { $searchText = $Stats.Search } else { $searchText = "(none)" }
  $lines = @(
    "CodexHome: $(Get-CodexHome)",
    "Projects: $($Stats.Projects)",
    "Threads: $($Stats.TotalThreads) total | $($Stats.ActiveThreads) active | $($Stats.Archived) archived",
    "Visible: $($Stats.VisibleProjects) projects | $($Stats.VisibleThreads) expanded threads",
    "Archive filter: $archivedText",
    "Search: $searchText"
  )

  $maxLines = $Height - 2
  for ($i = 0; $i -lt [Math]::Min($lines.Count, $maxLines); $i++) {
    Write-PanelLine -X $X -Y ($Y + 1 + $i) -Width $Width -Text $lines[$i]
  }
}

function Render-DashboardKeys {
  param(
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  Draw-ConsolePanel -X $X -Y $Y -Width $Width -Height $Height -Title "Keys"
  $lines = @(
    "Up/Down: move selection",
    "Enter/Right: expand project or open thread",
    "Left: collapse project / jump to parent",
    "O: open selected thread",
    "N: new thread in selected project",
    "F: open selected project folder",
    "S: search | A: archive toggle",
    "R: refresh data | Q: quit"
  )

  $maxLines = $Height - 2
  for ($i = 0; $i -lt [Math]::Min($lines.Count, $maxLines); $i++) {
    Write-PanelLine -X $X -Y ($Y + 1 + $i) -Width $Width -Text $lines[$i]
  }
}

function Render-DashboardQuota {
  param(
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  Draw-ConsolePanel -X $X -Y $Y -Width $Width -Height $Height -Title "Quota"
  Write-DashboardQuotaContent -X $X -Y $Y -Width $Width -Height $Height
}

function Write-DashboardQuotaContent {
  param(
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height
  )

  $lines = Get-QuotaConsoleText
  $maxLines = $Height - 2
  for ($i = 0; $i -lt $maxLines; $i++) {
    if ($i -lt $lines.Count) {
      Write-PanelLine -X $X -Y ($Y + 1 + $i) -Width $Width -Text $lines[$i] -Foreground Cyan
    } else {
      Write-PanelLine -X $X -Y ($Y + 1 + $i) -Width $Width -Text ""
    }
  }
}

function Get-DashboardLayout {
  $width = Get-ConsoleWidthSafe
  $height = Get-ConsoleHeightSafe
  $leftWidth = [Math]::Min(58, [Math]::Max(38, [int]($width * 0.43)))
  $rightX = $leftWidth
  $rightWidth = $width - $leftWidth
  $panelTop = 1
  $panelHeight = $height - 3
  $detailsHeight = 12
  $statsHeight = 8
  $quotaHeight = 6
  $keysY = $panelTop + $detailsHeight + $statsHeight
  $quotaY = $height - $quotaHeight - 1
  $keysHeight = [Math]::Max(5, $quotaY - $keysY)

  return [pscustomobject]@{
    Width         = $width
    Height        = $height
    LeftWidth     = $leftWidth
    RightX        = $rightX
    RightWidth    = $rightWidth
    PanelTop      = $panelTop
    PanelHeight   = $panelHeight
    DetailsHeight = $detailsHeight
    StatsHeight   = $statsHeight
    KeysY         = $keysY
    KeysHeight    = $keysHeight
    QuotaY        = $quotaY
    QuotaHeight   = $quotaHeight
  }
}

function Update-DashboardQuotaOnly {
  $layout = Get-DashboardLayout
  if ($layout.Width -lt 92 -or $layout.Height -lt 26) {
    return
  }

  Write-DashboardQuotaContent -X $layout.RightX -Y $layout.QuotaY -Width $layout.RightWidth -Height $layout.QuotaHeight
}

function Render-CodexDashboard {
  param(
    [object[]]$Nodes,
    [int]$SelectedIndex,
    [int]$ScrollTop,
    [bool]$IncludeArchived,
    [string]$Search,
    [string]$Status
  )

  $layout = Get-DashboardLayout
  $width = $layout.Width
  $height = $layout.Height

  if ($width -lt 92 -or $height -lt 26) {
    Clear-Host
    Write-Host "Codex Thread Panel requires a larger console."
    Write-Host "Recommended minimum: 92 columns x 26 rows."
    Write-Host "Current: $width columns x $height rows."
    Write-Host "Resize the terminal, then press any key. Q exits."
    return
  }

  try {
    [Console]::CursorVisible = $false
  } catch {
  }
  Clear-Host

  Write-ConsoleAt -X 0 -Y 0 -Text "Codex Thread Panel" -Width $width -Foreground White

  Render-DashboardTree -Nodes $Nodes -SelectedIndex $SelectedIndex -ScrollTop $ScrollTop -X 0 -Y $layout.PanelTop -Width $layout.LeftWidth -Height $layout.PanelHeight -IncludeArchived $IncludeArchived -Search $Search

  $selectedNode = $null
  if ($Nodes.Count -gt 0 -and $SelectedIndex -ge 0 -and $SelectedIndex -lt $Nodes.Count) {
    $selectedNode = $Nodes[$SelectedIndex]
  }

  Render-DashboardDetails -Node $selectedNode -X $layout.RightX -Y $layout.PanelTop -Width $layout.RightWidth -Height $layout.DetailsHeight
  $stats = Get-DashboardStats -Nodes $Nodes -IncludeArchived $IncludeArchived -Search $Search
  Render-DashboardStats -Stats $stats -X $layout.RightX -Y ($layout.PanelTop + $layout.DetailsHeight) -Width $layout.RightWidth -Height $layout.StatsHeight
  Render-DashboardKeys -X $layout.RightX -Y $layout.KeysY -Width $layout.RightWidth -Height $layout.KeysHeight
  Render-DashboardQuota -X $layout.RightX -Y $layout.QuotaY -Width $layout.RightWidth -Height $layout.QuotaHeight

  if ([string]::IsNullOrWhiteSpace($Status)) {
    $Status = "Ready"
  }
  Write-ConsoleAt -X 0 -Y ($height - 1) -Text $Status -Width $width -Foreground DarkGray
}

function Get-DashboardTreeVisibleRows {
  $layout = Get-DashboardLayout
  return [Math]::Max(1, $layout.PanelHeight - 3)
}

function Update-DashboardStatusLine {
  param([string]$Status)

  $layout = Get-DashboardLayout
  if ([string]::IsNullOrWhiteSpace($Status)) {
    $Status = "Ready"
  }
  Write-ConsoleAt -X 0 -Y ($layout.Height - 1) -Text $Status -Width $layout.Width -Foreground DarkGray
}

function Update-DashboardSelectionOnly {
  param(
    [object[]]$Nodes,
    [int]$OldIndex,
    [int]$NewIndex,
    [int]$ScrollTop,
    [bool]$IncludeArchived,
    [string]$Search,
    [string]$Status
  )

  $layout = Get-DashboardLayout
  if ($layout.Width -lt 92 -or $layout.Height -lt 26) {
    return
  }

  Render-DashboardTreeRow -Nodes $Nodes -Index $OldIndex -SelectedIndex $NewIndex -ScrollTop $ScrollTop -X 0 -Y $layout.PanelTop -Width $layout.LeftWidth -Height $layout.PanelHeight
  if ($NewIndex -ne $OldIndex) {
    Render-DashboardTreeRow -Nodes $Nodes -Index $NewIndex -SelectedIndex $NewIndex -ScrollTop $ScrollTop -X 0 -Y $layout.PanelTop -Width $layout.LeftWidth -Height $layout.PanelHeight
  }

  $selectedNode = $null
  if ($Nodes.Count -gt 0 -and $NewIndex -ge 0 -and $NewIndex -lt $Nodes.Count) {
    $selectedNode = $Nodes[$NewIndex]
  }

  Write-DashboardDetailsContent -Node $selectedNode -X $layout.RightX -Y $layout.PanelTop -Width $layout.RightWidth -Height $layout.DetailsHeight
  Update-DashboardStatusLine -Status $Status
}

function Get-NodeProjectCwd {
  param([object]$Node)

  if ($null -eq $Node) {
    return ""
  }

  if ($Node.Type -eq "project") {
    return $Node.Cwd
  }

  if ($Node.Thread) {
    return $Node.Thread.Cwd
  }

  return ""
}

function Ensure-SelectionVisible {
  param(
    [int]$SelectedIndex,
    [int]$ScrollTop,
    [int]$VisibleRows,
    [int]$NodeCount
  )

  if ($NodeCount -le 0) {
    return 0
  }

  if ($SelectedIndex -lt 0) {
    $SelectedIndex = 0
  }
  if ($SelectedIndex -ge $NodeCount) {
    $SelectedIndex = $NodeCount - 1
  }

  if ($SelectedIndex -lt $ScrollTop) {
    return $SelectedIndex
  }
  if ($SelectedIndex -ge ($ScrollTop + $VisibleRows)) {
    return [Math]::Max(0, $SelectedIndex - $VisibleRows + 1)
  }

  return $ScrollTop
}

function Maximize-ConsoleWindow {
  try {
    if (-not ([System.Management.Automation.PSTypeName]"CodexPanel.NativeConsoleWindow").Type) {
      Add-Type -Namespace CodexPanel -Name NativeConsoleWindow -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern System.IntPtr GetConsoleWindow();

[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
"@
    }

    $handle = [CodexPanel.NativeConsoleWindow]::GetConsoleWindow()
    if ($handle -ne [IntPtr]::Zero) {
      [void][CodexPanel.NativeConsoleWindow]::ShowWindow($handle, 3)
    }
  } catch {
  }
}

function Start-CodexConsole {
  if ($Maximize) {
    Maximize-ConsoleWindow
  }

  $search = ""
  $includeArchived = $false
  $selectedIndex = 0
  $scrollTop = 0
  $status = "Enter expands a project. Enter on a thread opens it in a new PowerShell."
  $expanded = @{}
  $nextQuotaScan = (Get-Date)
  $nextQuotaPaint = (Get-Date)
  $dirty = $true
  $lastWidth = 0
  $lastHeight = 0
  $nodes = @()

  while ($true) {
    $now = Get-Date
    $width = Get-ConsoleWidthSafe
    $height = Get-ConsoleHeightSafe
    if ($width -ne $lastWidth -or $height -ne $lastHeight) {
      $dirty = $true
      $lastWidth = $width
      $lastHeight = $height
    }

    if ($now -ge $nextQuotaScan) {
      $script:LatestQuota = Get-LatestRateLimit
      $nextQuotaScan = (Get-Date).AddSeconds(10)
      if (-not $dirty) {
        Update-DashboardQuotaOnly
      }
    }

    if ($dirty) {
      $nodes = Get-DashboardNodes -ExpandedProjects $expanded -IncludeArchived $includeArchived -Search $search
      if ($selectedIndex -ge $nodes.Count) { $selectedIndex = [Math]::Max(0, $nodes.Count - 1) }
      if ($selectedIndex -lt 0) { $selectedIndex = 0 }

      $visibleRows = Get-DashboardTreeVisibleRows
      $scrollTop = Ensure-SelectionVisible -SelectedIndex $selectedIndex -ScrollTop $scrollTop -VisibleRows $visibleRows -NodeCount $nodes.Count
      Render-CodexDashboard -Nodes $nodes -SelectedIndex $selectedIndex -ScrollTop $scrollTop -IncludeArchived $includeArchived -Search $search -Status $status
      $dirty = $false
      $nextQuotaPaint = (Get-Date).AddSeconds(1)
    } elseif ((Get-Date) -ge $nextQuotaPaint) {
      Update-DashboardQuotaOnly
      $nextQuotaPaint = (Get-Date).AddSeconds(1)
    }

    $key = $null
    $deadline = (Get-Date).AddMilliseconds(200)
    while ((Get-Date) -lt $deadline) {
      try {
        if ([Console]::KeyAvailable) {
          $key = [Console]::ReadKey($true)
          break
        }
      } catch {
        $key = $null
        break
      }
      Start-Sleep -Milliseconds 50
    }

    if ($null -eq $key) {
      continue
    }

    $node = $null
    if ($nodes.Count -gt 0 -and $selectedIndex -lt $nodes.Count) {
      $node = $nodes[$selectedIndex]
    }

    switch ($key.Key) {
      "Q" {
        try { [Console]::CursorVisible = $true } catch {}
        Clear-Host
        return
      }
      "UpArrow" {
        if ($selectedIndex -gt 0) {
          $oldIndex = $selectedIndex
          $selectedIndex--
          $newScrollTop = Ensure-SelectionVisible -SelectedIndex $selectedIndex -ScrollTop $scrollTop -VisibleRows (Get-DashboardTreeVisibleRows) -NodeCount $nodes.Count
          if ($newScrollTop -ne $scrollTop) {
            $scrollTop = $newScrollTop
            $dirty = $true
          } else {
            Update-DashboardSelectionOnly -Nodes $nodes -OldIndex $oldIndex -NewIndex $selectedIndex -ScrollTop $scrollTop -IncludeArchived $includeArchived -Search $search -Status $status
          }
        }
      }
      "DownArrow" {
        if ($selectedIndex -lt ($nodes.Count - 1)) {
          $oldIndex = $selectedIndex
          $selectedIndex++
          $newScrollTop = Ensure-SelectionVisible -SelectedIndex $selectedIndex -ScrollTop $scrollTop -VisibleRows (Get-DashboardTreeVisibleRows) -NodeCount $nodes.Count
          if ($newScrollTop -ne $scrollTop) {
            $scrollTop = $newScrollTop
            $dirty = $true
          } else {
            Update-DashboardSelectionOnly -Nodes $nodes -OldIndex $oldIndex -NewIndex $selectedIndex -ScrollTop $scrollTop -IncludeArchived $includeArchived -Search $search -Status $status
          }
        }
      }
      "RightArrow" {
        if ($node -and $node.Type -eq "project") {
          $expanded[$node.Cwd] = $true
          $status = "Expanded project: $($node.Project.Name)"
          $dirty = $true
        }
      }
      "LeftArrow" {
        if ($node -and $node.Type -eq "project") {
          $expanded[$node.Cwd] = $false
          $status = "Collapsed project: $($node.Project.Name)"
          $dirty = $true
        } elseif ($node -and $node.Type -eq "thread") {
          for ($i = $selectedIndex; $i -ge 0; $i--) {
            if ($nodes[$i].Type -eq "project" -and $nodes[$i].Cwd -eq $node.Cwd) {
              $selectedIndex = $i
              break
            }
          }
          $dirty = $true
        }
      }
      "Enter" {
        if ($node -and $node.Type -eq "project") {
          $current = $false
          if ($expanded.ContainsKey($node.Cwd)) { $current = [bool]$expanded[$node.Cwd] }
          $expanded[$node.Cwd] = -not $current
          if ($expanded[$node.Cwd]) {
            $status = "Expanded project: $($node.Project.Name)"
          } else {
            $status = "Collapsed project: $($node.Project.Name)"
          }
          $dirty = $true
        } elseif ($node -and $node.Type -eq "thread") {
          Start-CodexResume -SessionId $node.Thread.Id -Cwd $node.Thread.Cwd
          $status = "Opened thread: $($node.Thread.ThreadName)"
          $dirty = $true
        }
      }
      "O" {
        if ($node -and $node.Type -eq "thread") {
          Start-CodexResume -SessionId $node.Thread.Id -Cwd $node.Thread.Cwd
          $status = "Opened thread: $($node.Thread.ThreadName)"
        } else {
          $status = "Select a thread first."
        }
        $dirty = $true
      }
      "N" {
        $cwd = Get-NodeProjectCwd $node
        if ([string]::IsNullOrWhiteSpace($cwd) -or -not (Test-Path -LiteralPath $cwd)) {
          try { [Console]::CursorVisible = $true } catch {}
          Write-ConsoleAt -X 0 -Y ((Get-ConsoleHeightSafe) - 1) -Text "Project path: " -Width (Get-ConsoleWidthSafe) -Foreground Yellow
          $cwd = Read-Host
          try { [Console]::CursorVisible = $false } catch {}
        }
        if ($cwd -and (Test-Path -LiteralPath $cwd)) {
          Start-CodexNewThread -Cwd $cwd
          $status = "Started new Codex thread in: $cwd"
        } else {
          $status = "No valid project path selected."
        }
        $dirty = $true
      }
      "F" {
        $cwd = Get-NodeProjectCwd $node
        if ($cwd -and (Test-Path -LiteralPath $cwd)) {
          Start-Process explorer.exe -ArgumentList @($cwd)
          $status = "Opened folder: $cwd"
        } else {
          $status = "No valid project folder for this selection."
        }
        $dirty = $true
      }
      "S" {
        try { [Console]::CursorVisible = $true } catch {}
        Write-ConsoleAt -X 0 -Y ((Get-ConsoleHeightSafe) - 1) -Text "Search text, blank clears: " -Width (Get-ConsoleWidthSafe) -Foreground Yellow
        $search = Read-Host
        try { [Console]::CursorVisible = $false } catch {}
        $selectedIndex = 0
        $scrollTop = 0
        if ($search) { $status = "Search applied: $search" } else { $status = "Search cleared." }
        $dirty = $true
      }
      "A" {
        $includeArchived = -not $includeArchived
        $selectedIndex = 0
        $scrollTop = 0
        if ($includeArchived) { $status = "Archived threads are shown." } else { $status = "Archived threads are hidden." }
        $dirty = $true
      }
      "R" {
        $script:AllThreads = @(Get-CodexThreads)
        $script:LatestQuota = Get-LatestRateLimit
        $nextQuotaScan = (Get-Date).AddSeconds(10)
        $selectedIndex = 0
        $scrollTop = 0
        $status = "Refreshed data."
        $dirty = $true
      }
      default {
        $status = "Unhandled key: $($key.Key). Use arrows, Enter, O, N, F, S, A, R, Q."
        $dirty = $true
      }
    }
  }
}

$script:AllThreads = @(Get-CodexThreads)
$script:LatestQuota = Get-LatestRateLimit

if ($Console) {
  Start-CodexConsole
  return
}

if ($NoGui) {
  $projectCount = @($script:AllThreads | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Cwd) } | Group-Object Cwd).Count
  Write-Output "CodexHome: $(Get-CodexHome)"
  Write-Output "Threads: $($script:AllThreads.Count)"
  Write-Output "Projects: $projectCount"
  if ($script:LatestQuota) {
    $rate = $script:LatestQuota.Raw
    Write-Output "QuotaTimestamp: $($script:LatestQuota.Timestamp)"
    Write-Output "PlanType: $($rate.plan_type)"
    Write-Output "Primary: $($rate.primary.used_percent)% / $($rate.primary.window_minutes)min"
    Write-Output "Secondary: $($rate.secondary.used_percent)% / $($rate.secondary.window_minutes)min"
  } else {
    Write-Output "Quota: not found"
  }
  return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$fontMain = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$fontTitle = New-Object System.Drawing.Font("Microsoft YaHei UI", 11, [System.Drawing.FontStyle]::Bold)

$form = New-Object System.Windows.Forms.Form
$form.Text = "Codex Thread Panel"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(1220, 760)
$form.MinimumSize = New-Object System.Drawing.Size(980, 620)
$form.Font = $fontMain

$quotaPanel = New-Object System.Windows.Forms.Panel
$quotaPanel.Dock = "Top"
$quotaPanel.Height = 96
$quotaPanel.Padding = New-Object System.Windows.Forms.Padding(12, 10, 12, 8)
$quotaPanel.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)
$form.Controls.Add($quotaPanel)

$quotaTitle = New-Object System.Windows.Forms.Label
$quotaTitle.Text = "Quota"
$quotaTitle.Font = $fontTitle
$quotaTitle.AutoSize = $true
$quotaTitle.Location = New-Object System.Drawing.Point(12, 10)
$quotaPanel.Controls.Add($quotaTitle)

$planLabel = New-Object System.Windows.Forms.Label
$planLabel.Text = "Plan: -"
$planLabel.AutoSize = $true
$planLabel.Location = New-Object System.Drawing.Point(104, 13)
$quotaPanel.Controls.Add($planLabel)

$quotaUpdatedLabel = New-Object System.Windows.Forms.Label
$quotaUpdatedLabel.Text = "Last update: -"
$quotaUpdatedLabel.AutoSize = $true
$quotaUpdatedLabel.Location = New-Object System.Drawing.Point(230, 13)
$quotaPanel.Controls.Add($quotaUpdatedLabel)

$primaryLabel = New-Object System.Windows.Forms.Label
$primaryLabel.Text = "5h limit: -"
$primaryLabel.AutoSize = $true
$primaryLabel.Location = New-Object System.Drawing.Point(12, 44)
$quotaPanel.Controls.Add($primaryLabel)

$primaryProgress = New-Object System.Windows.Forms.ProgressBar
$primaryProgress.Location = New-Object System.Drawing.Point(150, 42)
$primaryProgress.Size = New-Object System.Drawing.Size(260, 20)
$primaryProgress.Minimum = 0
$primaryProgress.Maximum = 100
$quotaPanel.Controls.Add($primaryProgress)

$primaryResetLabel = New-Object System.Windows.Forms.Label
$primaryResetLabel.Text = "-"
$primaryResetLabel.AutoSize = $true
$primaryResetLabel.Location = New-Object System.Drawing.Point(420, 44)
$quotaPanel.Controls.Add($primaryResetLabel)

$secondaryLabel = New-Object System.Windows.Forms.Label
$secondaryLabel.Text = "weekly limit: -"
$secondaryLabel.AutoSize = $true
$secondaryLabel.Location = New-Object System.Drawing.Point(12, 70)
$quotaPanel.Controls.Add($secondaryLabel)

$secondaryProgress = New-Object System.Windows.Forms.ProgressBar
$secondaryProgress.Location = New-Object System.Drawing.Point(150, 68)
$secondaryProgress.Size = New-Object System.Drawing.Size(260, 20)
$secondaryProgress.Minimum = 0
$secondaryProgress.Maximum = 100
$quotaPanel.Controls.Add($secondaryProgress)

$secondaryResetLabel = New-Object System.Windows.Forms.Label
$secondaryResetLabel.Text = "-"
$secondaryResetLabel.AutoSize = $true
$secondaryResetLabel.Location = New-Object System.Drawing.Point(420, 70)
$quotaPanel.Controls.Add($secondaryResetLabel)

$toolbar = New-Object System.Windows.Forms.Panel
$toolbar.Dock = "Top"
$toolbar.Height = 48
$toolbar.Padding = New-Object System.Windows.Forms.Padding(12, 8, 12, 8)
$form.Controls.Add($toolbar)

$searchLabel = New-Object System.Windows.Forms.Label
$searchLabel.Text = "Search"
$searchLabel.AutoSize = $true
$searchLabel.Location = New-Object System.Drawing.Point(12, 15)
$toolbar.Controls.Add($searchLabel)

$searchBox = New-Object System.Windows.Forms.TextBox
$searchBox.Location = New-Object System.Drawing.Point(52, 11)
$searchBox.Size = New-Object System.Drawing.Size(270, 24)
$toolbar.Controls.Add($searchBox)

$includeArchivedCheck = New-Object System.Windows.Forms.CheckBox
$includeArchivedCheck.Text = "Include archived"
$includeArchivedCheck.AutoSize = $true
$includeArchivedCheck.Location = New-Object System.Drawing.Point(335, 13)
$toolbar.Controls.Add($includeArchivedCheck)

$refreshButton = New-Object System.Windows.Forms.Button
$refreshButton.Text = "Refresh"
$refreshButton.Location = New-Object System.Drawing.Point(430, 9)
$refreshButton.Size = New-Object System.Drawing.Size(80, 28)
$toolbar.Controls.Add($refreshButton)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Text = "Open thread"
$openButton.Location = New-Object System.Drawing.Point(520, 9)
$openButton.Size = New-Object System.Drawing.Size(92, 28)
$toolbar.Controls.Add($openButton)

$newThreadButton = New-Object System.Windows.Forms.Button
$newThreadButton.Text = "New project thread"
$newThreadButton.Location = New-Object System.Drawing.Point(622, 9)
$newThreadButton.Size = New-Object System.Drawing.Size(112, 28)
$toolbar.Controls.Add($newThreadButton)

$openFolderButton = New-Object System.Windows.Forms.Button
$openFolderButton.Text = "Open folder"
$openFolderButton.Location = New-Object System.Drawing.Point(744, 9)
$openFolderButton.Size = New-Object System.Drawing.Size(112, 28)
$toolbar.Controls.Add($openFolderButton)

$split = New-Object System.Windows.Forms.SplitContainer
$split.Dock = "Fill"
$split.SplitterDistance = 350
$split.Panel1MinSize = 260
# SplitContainer has a small design-time width before the form is laid out.
# Keep the initial minimum safe, then apply the real minimum after Show.
$split.Panel2MinSize = 100
$form.Controls.Add($split)

$projectList = New-Object System.Windows.Forms.ListBox
$projectList.Dock = "Fill"
$projectList.DisplayMember = "Label"
$projectList.ValueMember = "Cwd"
$split.Panel1.Controls.Add($projectList)

$projectHeader = New-Object System.Windows.Forms.Label
$projectHeader.Text = "Projects"
$projectHeader.Dock = "Top"
$projectHeader.Height = 28
$projectHeader.Font = $fontTitle
$split.Panel1.Controls.Add($projectHeader)
$projectHeader.BringToFront()

$grid = New-Object System.Windows.Forms.DataGridView
$grid.Dock = "Fill"
$grid.ReadOnly = $true
$grid.AllowUserToAddRows = $false
$grid.AllowUserToDeleteRows = $false
$grid.AllowUserToResizeRows = $false
$grid.RowHeadersVisible = $false
$grid.SelectionMode = "FullRowSelect"
$grid.MultiSelect = $false
$grid.AutoSizeRowsMode = "None"
$grid.BackgroundColor = [System.Drawing.Color]::White
$split.Panel2.Controls.Add($grid)

$statusBar = New-Object System.Windows.Forms.StatusStrip
$statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusLabel.Text = "Ready"
[void]$statusBar.Items.Add($statusLabel)
$form.Controls.Add($statusBar)

function New-ThreadDataTable {
  param([object[]]$Threads)

  $table = New-Object System.Data.DataTable
  [void]$table.Columns.Add("Updated", [string])
  [void]$table.Columns.Add("Thread", [string])
  [void]$table.Columns.Add("Project", [string])
  [void]$table.Columns.Add("Cwd", [string])
  [void]$table.Columns.Add("Model", [string])
  [void]$table.Columns.Add("Tokens", [string])
  [void]$table.Columns.Add("Archived", [string])
  [void]$table.Columns.Add("IdShort", [string])
  [void]$table.Columns.Add("Id", [string])
  [void]$table.Columns.Add("SourceFile", [string])

  foreach ($thread in $Threads) {
    $row = $table.NewRow()
    $row["Updated"] = $thread.UpdatedText
    $row["Thread"] = $thread.ThreadName
    $row["Project"] = $thread.Project
    $row["Cwd"] = $thread.Cwd
    $row["Model"] = if ($thread.Model) { $thread.Model } else { "" }
    $row["Tokens"] = if ($thread.TokensUsed -gt 0) { "{0:N0}" -f $thread.TokensUsed } else { "" }
    $row["Archived"] = if ($thread.Archived) { "yes" } else { "" }
    $row["IdShort"] = if ($thread.Id -and $thread.Id.Length -gt 8) { $thread.Id.Substring(0, 8) } else { $thread.Id }
    $row["Id"] = $thread.Id
    $row["SourceFile"] = $thread.SourceFile
    [void]$table.Rows.Add($row)
  }

  return $table
}

function Set-GridColumnLayout {
  if (-not $grid.Columns -or $grid.Columns.Count -eq 0) {
    return
  }

  $grid.Columns["Updated"].Width = 130
  $grid.Columns["Thread"].Width = 290
  $grid.Columns["Project"].Width = 130
  $grid.Columns["Cwd"].Width = 260
  $grid.Columns["Model"].Width = 120
  $grid.Columns["Tokens"].Width = 90
  $grid.Columns["Archived"].Width = 65
  $grid.Columns["IdShort"].Width = 85
  $grid.Columns["Id"].Visible = $false
  $grid.Columns["SourceFile"].Visible = $false
}

function Get-SelectedProjectCwd {
  if ($null -eq $projectList.SelectedItem) {
    return ""
  }

  return [string]$projectList.SelectedItem.Cwd
}

function Get-SelectedGridThread {
  if ($null -eq $grid.CurrentRow -or $grid.CurrentRow.Index -lt 0) {
    return $null
  }

  $id = [string]$grid.CurrentRow.Cells["Id"].Value
  if ([string]::IsNullOrWhiteSpace($id)) {
    return $null
  }

  return ($script:AllThreads | Where-Object { $_.Id -eq $id } | Select-Object -First 1)
}

function Update-ProjectList {
  $selected = Get-SelectedProjectCwd
  $items = New-Object System.Collections.Generic.List[object]
  $items.Add([pscustomobject]@{ Label = "All projects ($($script:AllThreads.Count))"; Cwd = "" })

  $groups = $script:AllThreads |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.Cwd) } |
    Group-Object Cwd |
    Sort-Object -Property @{ Expression = "Count"; Descending = $true }, Name

  foreach ($group in $groups) {
    $projectName = Get-ProjectName $group.Name
    $items.Add([pscustomobject]@{
      Label = "$projectName ($($group.Count))  $($group.Name)"
      Cwd   = $group.Name
    })
  }

  $projectList.DataSource = $null
  $projectList.DataSource = $items
  $projectList.DisplayMember = "Label"
  $projectList.ValueMember = "Cwd"

  $restore = $items | Where-Object { $_.Cwd -eq $selected } | Select-Object -First 1
  if ($restore) {
    $projectList.SelectedItem = $restore
  } elseif ($items.Count -gt 0) {
    $projectList.SelectedIndex = 0
  }
}

function Update-ThreadGrid {
  $projectCwd = Get-SelectedProjectCwd
  $query = $searchBox.Text.Trim()
  $includeArchived = $includeArchivedCheck.Checked

  $filtered = $script:AllThreads | Where-Object {
    if (-not $includeArchived -and $_.Archived) { return $false }
    if ($projectCwd -and $_.Cwd -ne $projectCwd) { return $false }
    if ($query) {
      $haystack = "$($_.ThreadName)`n$($_.Cwd)`n$($_.Id)`n$($_.Model)"
      if ($haystack.IndexOf($query, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        return $false
      }
    }
    return $true
  }

  $filtered = @($filtered | Sort-Object @{ Expression = { if ($_.UpdatedDate) { $_.UpdatedDate } else { [datetime]::MinValue } }; Descending = $true })
  $grid.DataSource = New-ThreadDataTable -Threads $filtered
  Set-GridColumnLayout
  $statusLabel.Text = "Showing $($filtered.Count) / $($script:AllThreads.Count) threads"
}

function Refresh-AllData {
  $statusLabel.Text = "Refreshing..."
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  try {
    $script:AllThreads = @(Get-CodexThreads)
    $script:LatestQuota = Get-LatestRateLimit
    Update-ProjectList
    Update-ThreadGrid
    Update-QuotaUi
  } finally {
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
}

function Update-QuotaUi {
  if ($null -eq $script:LatestQuota -or $null -eq $script:LatestQuota.Raw) {
    $planLabel.Text = "Plan: -"
    $quotaUpdatedLabel.Text = "Last update: quota record not found"
    $primaryLabel.Text = "5h limit: -"
    $secondaryLabel.Text = "weekly limit: -"
    $primaryProgress.Value = 0
    $secondaryProgress.Value = 0
    $primaryResetLabel.Text = "-"
    $secondaryResetLabel.Text = "-"
    return
  }

  $rate = $script:LatestQuota.Raw
  $planLabel.Text = "Plan: $($rate.plan_type)"
  $quotaUpdatedLabel.Text = "Last update: $(ConvertTo-DisplayTime $script:LatestQuota.Timestamp)"

  $primaryUsed = ConvertTo-SafePercent $rate.primary.used_percent
  $secondaryUsed = ConvertTo-SafePercent $rate.secondary.used_percent
  $primaryName = ConvertTo-QuotaWindowName $rate.primary.window_minutes
  $secondaryName = ConvertTo-QuotaWindowName $rate.secondary.window_minutes

  $primaryLabel.Text = "${primaryName}: $primaryUsed%"
  $secondaryLabel.Text = "${secondaryName}: $secondaryUsed%"
  $primaryProgress.Value = $primaryUsed
  $secondaryProgress.Value = $secondaryUsed
  $primaryResetLabel.Text = ConvertTo-ResetInfo $rate.primary.resets_at
  $secondaryResetLabel.Text = ConvertTo-ResetInfo $rate.secondary.resets_at
}

function Invoke-OpenSelectedThread {
  $thread = Get-SelectedGridThread
  if ($null -eq $thread) {
    [System.Windows.Forms.MessageBox]::Show("Select a thread first.", "Codex Thread Panel") | Out-Null
    return
  }

  Start-CodexResume -SessionId $thread.Id -Cwd $thread.Cwd
}

function Invoke-NewThreadForSelectedProject {
  $cwd = Get-SelectedProjectCwd
  if ([string]::IsNullOrWhiteSpace($cwd)) {
    $thread = Get-SelectedGridThread
    if ($thread) {
      $cwd = $thread.Cwd
    }
  }

  if ([string]::IsNullOrWhiteSpace($cwd) -or -not (Test-Path -LiteralPath $cwd)) {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Select a project directory for Codex"
    if ($dialog.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) {
      return
    }
    $cwd = $dialog.SelectedPath
  }

  Start-CodexNewThread -Cwd $cwd
}

function Invoke-OpenSelectedProjectFolder {
  $cwd = Get-SelectedProjectCwd
  if ([string]::IsNullOrWhiteSpace($cwd)) {
    $thread = Get-SelectedGridThread
    if ($thread) {
      $cwd = $thread.Cwd
    }
  }

  if ([string]::IsNullOrWhiteSpace($cwd) -or -not (Test-Path -LiteralPath $cwd)) {
    [System.Windows.Forms.MessageBox]::Show("No project folder is available.", "Codex Thread Panel") | Out-Null
    return
  }

  Start-Process explorer.exe -ArgumentList @($cwd)
}

$searchBox.Add_TextChanged({ Update-ThreadGrid })
$includeArchivedCheck.Add_CheckedChanged({ Update-ThreadGrid })
$projectList.Add_SelectedIndexChanged({ Update-ThreadGrid })
$refreshButton.Add_Click({ Refresh-AllData })
$openButton.Add_Click({ Invoke-OpenSelectedThread })
$newThreadButton.Add_Click({ Invoke-NewThreadForSelectedProject })
$openFolderButton.Add_Click({ Invoke-OpenSelectedProjectFolder })
$grid.Add_CellDoubleClick({ Invoke-OpenSelectedThread })

$form.Add_Shown({
  try {
    $split.Panel2MinSize = 500
    if ($split.Width -gt 900) {
      $split.SplitterDistance = [Math]::Min(350, $split.Width - $split.Panel2MinSize)
    }
  } catch {
    # Keep the safe startup layout if the host reports an unusual window size.
  }
})

$quotaTimer = New-Object System.Windows.Forms.Timer
$quotaTimer.Interval = 1000
$script:NextQuotaScanAt = [datetime]::MinValue
$quotaTimer.Add_Tick({
  if ((Get-Date) -ge $script:NextQuotaScanAt) {
    $script:LatestQuota = Get-LatestRateLimit
    $script:NextQuotaScanAt = (Get-Date).AddSeconds(10)
  }
  Update-QuotaUi
})

Update-ProjectList
Update-ThreadGrid
Update-QuotaUi
$quotaTimer.Start()

[void][System.Windows.Forms.Application]::Run($form)
