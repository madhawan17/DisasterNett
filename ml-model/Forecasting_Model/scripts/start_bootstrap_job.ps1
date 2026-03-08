Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\\bootstrap_env.ps1"

if (-not (Test-Path $script)) {
    throw "bootstrap_env.ps1 not found at $script"
}

Get-Job -Name "nmims_bootstrap" -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue

Start-Job -Name "nmims_bootstrap" -ScriptBlock {
    param($scriptPath, $workdir)
    Set-Location $workdir
    powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath
} -ArgumentList $script, $root | Out-Null

Write-Output "Started background job: nmims_bootstrap"
Write-Output "Use: Get-Job -Name nmims_bootstrap | Receive-Job -Keep"
