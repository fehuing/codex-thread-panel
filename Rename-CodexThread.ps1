param(
  [Parameter(Mandatory = $true)]
  [string]$ThreadId,

  [Parameter(Mandatory = $true)]
  [string]$CurrentTitle
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$indexPath = Join-Path $codexHome "session_index.jsonl"
$overridePath = Join-Path $codexHome "thread_title_overrides.json"

Add-Type -AssemblyName Microsoft.VisualBasic
$newTitle = [Microsoft.VisualBasic.Interaction]::InputBox("Enter new thread title", "Codex Thread Panel", $CurrentTitle)

if ([string]::IsNullOrWhiteSpace($newTitle)) {
  exit 0
}

if (-not (Test-Path -LiteralPath $indexPath)) {
  $indexPath = $null
}

$changed = $false

$overrides = @{}
if (Test-Path -LiteralPath $overridePath) {
  try {
    $rawOverrides = Get-Content -LiteralPath $overridePath -Encoding UTF8 -Raw | ConvertFrom-Json
    foreach ($property in $rawOverrides.PSObject.Properties) {
      $overrides[$property.Name] = [string]$property.Value
    }
  } catch {
    $overrides = @{}
  }
}

$overrides[$ThreadId] = $newTitle
$overrideJson = $overrides | ConvertTo-Json -Depth 5
Set-Content -LiteralPath $overridePath -Value $overrideJson -Encoding UTF8
$changed = $true

if ($indexPath) {
  $backupPath = "$indexPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
  Copy-Item -LiteralPath $indexPath -Destination $backupPath -Force

  $indexChanged = $false
  $lines = Get-Content -LiteralPath $indexPath -Encoding UTF8 | Where-Object { $_.Trim() }
  $next = foreach ($line in $lines) {
    try {
      $obj = $line | ConvertFrom-Json
      if ($obj.id -eq $ThreadId) {
        $obj.thread_name = $newTitle
        $indexChanged = $true
        $obj | ConvertTo-Json -Compress
      } else {
        $line
      }
    } catch {
      $line
    }
  }

  if ($indexChanged) {
    Set-Content -LiteralPath $indexPath -Value $next -Encoding UTF8
    $changed = $true
  }
}

if (-not $changed) {
  throw "Thread id not found or update failed: $ThreadId"
}
