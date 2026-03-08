Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root ".logs"
$stateDir = Join-Path $root ".state"
$logPath = Join-Path $logDir "bootstrap_install.log"
$statusPath = Join-Path $stateDir "bootstrap_status.json"
$venvPython = Join-Path $root ".venv\\Scripts\\python.exe"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
Set-Location $root

function Write-Log {
    param([string]$Message)
    $ts = (Get-Date).ToString("s")
    $line = "[$ts] $Message"
    $line | Tee-Object -FilePath $logPath -Append
}

function Set-Status {
    param(
        [string]$Status,
        [string]$Message
    )
    $payload = @{
        status = $Status
        message = $Message
        timestamp = (Get-Date).ToString("o")
    } | ConvertTo-Json
    Set-Content -Path $statusPath -Value $payload -Encoding UTF8
}

function Run-Step {
    param(
        [string]$Label,
        [scriptblock]$Command
    )
    Write-Log "START: $Label"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $Command *>> $logPath
    $ErrorActionPreference = $prev
    $code = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    if ($code -ne 0) {
        throw "Step failed: $Label (exit code: $code)"
    }
    Write-Log "DONE: $Label"
}

try {
    Set-Status -Status "running" -Message "bootstrap started"
    Write-Log "Bootstrap started in $root"

    Run-Step -Label "Check uv availability" -Command { uv --version }
    Run-Step -Label "Create virtual environment (.venv)" -Command { uv venv .venv --python 3.11 --clear }
    Run-Step -Label "Install base build tools" -Command { uv pip install --python $venvPython --upgrade pip setuptools wheel }
    Run-Step -Label "Install PyTorch CUDA (cu124)" -Command { uv pip install --python $venvPython --index-url https://download.pytorch.org/whl/cu124 torch torchvision torchaudio }
    Run-Step -Label "Install project dependencies" -Command { uv pip install --python $venvPython -r requirements.txt -r requirements-dev.txt }

    Set-Status -Status "success" -Message "bootstrap completed"
    Write-Log "Bootstrap completed successfully."
    exit 0
} catch {
    $err = $_.Exception.Message
    Set-Status -Status "failed" -Message $err
    Write-Log "Bootstrap failed: $err"
    exit 1
}
