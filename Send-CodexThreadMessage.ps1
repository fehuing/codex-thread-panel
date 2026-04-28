param(
  [string]$ThreadId,
  [string]$Query,
  [string]$Prompt,
  [string]$PromptFile,
  [string]$Permission = "2",
  [ValidateSet("launch", "queue")]
  [string]$Mode = "launch",
  [string]$From = "manual",
  [switch]$Stdin
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$bridgeScript = Join-Path $PSScriptRoot "CodexThreadBridge.js"
if (-not (Test-Path -LiteralPath $bridgeScript)) {
  throw "CodexThreadBridge.js not found: $bridgeScript"
}

if (-not $ThreadId -and -not $Query) {
  throw "Use -ThreadId or -Query to select a target thread."
}

if (-not $PromptFile) {
  if ($Stdin) {
    $Prompt = [Console]::In.ReadToEnd()
  }

  if ([string]::IsNullOrWhiteSpace($Prompt)) {
    Add-Type -AssemblyName Microsoft.VisualBasic
    $Prompt = [Microsoft.VisualBasic.Interaction]::InputBox("Enter prompt to send", "Codex Thread Bridge", "")
  }

  if ([string]::IsNullOrWhiteSpace($Prompt)) {
    exit 0
  }

  $tempDir = Join-Path $env:TEMP "codex-thread-panel"
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $PromptFile = Join-Path $tempDir ("message-{0}.txt" -f ([Guid]::NewGuid().ToString("N")))
  Set-Content -LiteralPath $PromptFile -Value $Prompt -Encoding UTF8
}

$argsList = @($bridgeScript, "send")
if ($ThreadId) {
  $argsList += @("--thread-id", $ThreadId)
} else {
  $argsList += @("--query", $Query)
}
$argsList += @("--prompt-file", $PromptFile)
$argsList += @("--permission", $Permission)
$argsList += @("--mode", $Mode)
$argsList += @("--from", $From)

& node @argsList
exit $LASTEXITCODE
