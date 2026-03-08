Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$statusPath = Join-Path $root ".state\\bootstrap_status.json"
$logPath = Join-Path $root ".logs\\bootstrap_install.log"

Write-Output "== Bootstrap status file =="
if (Test-Path $statusPath) {
    Get-Content $statusPath
} else {
    Write-Output "No status file found at $statusPath"
}

Write-Output ""
Write-Output "== Background process lookup =="
$job = Get-Job -Name "nmims_bootstrap" -ErrorAction SilentlyContinue
if ($job) {
    Write-Output "Job name: $($job.Name)"
    Write-Output "Job state: $($job.State)"
} else {
    Write-Output "No active nmims_bootstrap job in this shell session."
    Write-Output "If install was launched via detached process, rely on status file + logs."
}

Write-Output ""
Write-Output "== Install log tail =="
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 40
} else {
    Write-Output "No log file found at $logPath"
}
