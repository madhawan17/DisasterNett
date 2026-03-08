Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $root ".venv\\Scripts\\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Error "Virtual environment python not found at $venvPython"
    exit 1
}

$script = @'
import json
import sys

import torch

payload = {
    "torch_version": torch.__version__,
    "cuda_available": torch.cuda.is_available(),
}

if not torch.cuda.is_available():
    print(json.dumps(payload, indent=2))
    sys.exit(2)

device_name = torch.cuda.get_device_name(0)
x = torch.rand((1024, 1024), device="cuda")
y = torch.rand((1024, 1024), device="cuda")
z = (x @ y).mean().item()

payload["device_name"] = device_name
payload["matmul_mean"] = z

print(json.dumps(payload, indent=2))
'@

& $venvPython -c $script
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Error "GPU validation failed with exit code $code"
    exit $code
}

Write-Output "GPU validation passed."
