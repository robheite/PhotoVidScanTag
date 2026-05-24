param(
  [int]$Port = 1420,
  [switch]$CleanupOnly
)

$ErrorActionPreference = "Stop"

function Get-ListeningPids {
  param([int]$ListeningPort)

  $matches = cmd /c "netstat -ano -p tcp | findstr :$ListeningPort"
  if (-not $matches) {
    return @()
  }

  return $matches |
    Select-String "LISTENING\s+(\d+)$" |
    ForEach-Object { [int]$_.Matches[0].Groups[1].Value } |
    Sort-Object -Unique
}

function Stop-ListeningProcesses {
  param([int]$ListeningPort)

  $pids = Get-ListeningPids -ListeningPort $ListeningPort
  foreach ($pid in $pids) {
    try {
      Stop-Process -Id $pid -Force -ErrorAction Stop
      Write-Host "Stopped process $pid on port $ListeningPort"
    } catch {
      Write-Warning ("Unable to stop process {0} on port {1}: {2}" -f $pid, $ListeningPort, $_.Exception.Message)
    }
  }
}

$repoRoot = Split-Path $PSScriptRoot -Parent
$vcvars = "I:\VStudio\18\Community\VC\Auxiliary\Build\vcvars64.bat"

Stop-ListeningProcesses -ListeningPort $Port

if ($CleanupOnly) {
  return
}

if (-not (Test-Path $vcvars)) {
  throw "Visual Studio vcvars64.bat was not found at $vcvars"
}

Push-Location $repoRoot
try {
  cmd /c """$vcvars"" && set PATH=%USERPROFILE%\.cargo\bin;%PATH% && npm run tauri dev"
} finally {
  Stop-ListeningProcesses -ListeningPort $Port
  Pop-Location
}
