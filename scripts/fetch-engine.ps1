# =====================================================================
#  fetch-engine.ps1  --  Fetch Pikafish source and NNUE weights
#
#  Why this script:
#    Pikafish source carries full git history and the NNUE weight file
#    is a ~12MB binary. Neither belongs in this repo, so they are
#    fetched at build time instead.
#
#  Usage (run from repo root):
#      powershell -ExecutionPolicy Bypass -File scripts\fetch-engine.ps1
#
#  Produces:
#      engine-src/          Pikafish source tree
#      pikafish.nnue        NNUE network weights
#
#  NOTE: kept ASCII-only on purpose. Windows PowerShell 5.1 reads
#        UTF-8 files without BOM as the local ANSI codepage, which
#        corrupts non-ASCII string literals and breaks parsing.
# =====================================================================

$ErrorActionPreference = 'Stop'

$ROOT = Split-Path -Parent $PSScriptRoot
$ENGINE_DIR = Join-Path $ROOT 'engine-src'
$NNUE_PATH  = Join-Path $ROOT 'pikafish.nnue'

Write-Host '=== Pikafish engine fetch ===' -ForegroundColor Cyan

# ---------- 1) clone source ----------
if (Test-Path (Join-Path $ENGINE_DIR 'src')) {
    Write-Host '[1/2] source already present, skip' -ForegroundColor Yellow
} else {
    Write-Host '[1/2] cloning Pikafish source ...' -ForegroundColor Green
    git clone --depth 1 https://github.com/official-pikafish/Pikafish.git $ENGINE_DIR
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed, check network' }
}

# ---------- 2) download NNUE weights ----------
if (Test-Path $NNUE_PATH) {
    $sz = [math]::Round((Get-Item $NNUE_PATH).Length / 1MB, 2)
    Write-Host "[2/2] weights already present (${sz}MB), skip" -ForegroundColor Yellow
} else {
    Write-Host '[2/2] downloading NNUE weights (~49MB) ...' -ForegroundColor Green
    $url = 'https://github.com/official-pikafish/Networks/releases/latest/download/pikafish.nnue'
    try {
        Invoke-WebRequest -Uri $url -OutFile $NNUE_PATH -TimeoutSec 600
    } catch {
        throw "weight download failed: $($_.Exception.Message)"
    }
    $sz = [math]::Round((Get-Item $NNUE_PATH).Length / 1MB, 2)
    Write-Host "      done (${sz}MB)" -ForegroundColor Green
}

Write-Host ''
Write-Host 'FETCH_OK -- next steps:' -ForegroundColor Cyan
Write-Host '  Android: powershell -ExecutionPolicy Bypass -File native\android\build_so.ps1 -Abi arm64-v8a'
Write-Host '  iOS    : run native/ios/build_ios.sh on macOS'
