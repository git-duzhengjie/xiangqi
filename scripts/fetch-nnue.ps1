# =============================================================
#  fetch-nnue.ps1 -- 把 NNUE 权重放进插件的 android/assets
#
#  为什么需要这个脚本：
#    权重 49MB，被 .gitignore 排除在仓库之外（避免仓库体积失控），
#    所以换机器、重新 clone、或误删之后，插件目录里不会有它，
#    打出来的包会没有引擎权重。此脚本负责把它补齐。
#
#  用法：
#    powershell -ExecutionPolicy Bypass -File scripts\fetch-nnue.ps1
#
#  优先用本地已有副本，没有才联网下载，避免重复拉 49MB。
# =============================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$EXPECT_SIZE = 51585654
$EXPECT_HASH = '3CD15292BF8C979884262F57FC723959FC0DEA43B4D8D544F88DB5CEB2479E24'
$CDN = 'https://myassis-1251246038.cos.ap-guangzhou.myqcloud.com/myassis-1251246038/engines/pikafish-20260906.nnue'

$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root 'app\nativeplugins\XiangqiEngine\android\assets\pikafish.nnue'

function Test-Nnue ($p) {
    if (-not (Test-Path $p)) { return $false }
    if ((Get-Item $p).Length -ne $EXPECT_SIZE) { return $false }
    return (Get-FileHash $p -Algorithm SHA256).Hash -eq $EXPECT_HASH
}

Write-Host ''
Write-Host 'NNUE weights -> plugin assets' -ForegroundColor Cyan
Write-Host '=============================================='

if (Test-Nnue $dest) {
    Write-Host '  [OK]   already in place and verified' -ForegroundColor Green
    Write-Host ''
    exit 0
}

New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null

# 1) 先找本机已有的副本，省一次 49MB 下载
$local = @(
    (Join-Path $env:USERPROFILE 'Downloads\pikafish.nnue')
) | Where-Object { Test-Path $_ } | Where-Object {
    (Get-Item $_).Length -eq $EXPECT_SIZE
} | Select-Object -First 1

if ($local) {
    Write-Host "  [..]   copying from $local"
    Copy-Item $local $dest -Force
} else {
    Write-Host "  [..]   downloading from CDN"
    Invoke-WebRequest -Uri $CDN -OutFile $dest -TimeoutSec 900
}

# 2) 必须校验：宁可这里失败，也不要让坏文件混进安装包
if (Test-Nnue $dest) {
    Write-Host ('  [OK]   verified: ' + (Get-Item $dest).Length + ' bytes') -ForegroundColor Green
    Write-Host ''
    exit 0
} else {
    Write-Host '  [FAIL] size or hash mismatch -- file removed' -ForegroundColor Red
    Remove-Item $dest -Force -ErrorAction SilentlyContinue
    Write-Host ''
    exit 1
}
