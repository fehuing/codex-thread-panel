param(
  [Parameter(Mandatory = $true)]
  [string]$ScriptPath,

  [string]$Title = "Codex Thread"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Launch script not found: $ScriptPath"
}

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = @(
  "-NoExit",
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $ScriptPath
)

Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Normal
