# =============================================================
#  fetch-nnue.ps1 -- 把 NNUE 权重放进插件（Android + iOS 双端）
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

# 两端各自的落点：
#   Android -> android/assets       ，云端打包写入 apk 的 assets 目录
#   iOS     -> ios/BundleResources  ，HBuilderX 3.2.0+ 官方方式，目录内文件
#                                     会被打进主 bundle，无需在 package.json
#                                     里配置 resources 字段
$targets = @(
    (Join-Path $root 'app\nativeplugins\XiangqiEngine\android\assets\pikafish.nnue'),
    (Join-Path $root 'app\nativeplugins\XiangqiEngine\ios\BundleResources\pikafish.nnue')
)

function Test-Nnue ($p) {
    if (-not (Test-Path $p)) { return $false }
    if ((Get-Item $p).Length -ne $EXPECT_SIZE) { return $false }
    return (Get-FileHash $p -Algorithm SHA256).Hash -eq $EXPECT_HASH
}

Write-Host ''
Write-Host 'NNUE weights -> plugin (Android + iOS)' -ForegroundColor Cyan
Write-Host '=============================================='

# 先准备一份可信的源文件，再分发到各平台目录，
# 这样即使两端都缺，也只需要下载一次。
$source = $null

foreach ($t in $targets) {
    if (Test-Nnue $t) { $source = $t; break }
}

if (-not $source) {
    # 本机其它位置的副本，省一次 49MB 下载
    $source = @(
        (Join-Path $env:USERPROFILE 'Downloads\pikafish.nnue')
    ) | Where-Object { Test-Path $_ } |
        Where-Object { (Get-Item $_).Length -eq $EXPECT_SIZE } |
        Select-Object -First 1
    if ($source) { Write-Host "  [..]   using local copy: $source" }
}

if (-not $source) {
    Write-Host '  [..]   downloading from CDN (49MB, once)'
    $tmp = Join-Path $env:TEMP ('nnue-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.bin')
    Invoke-WebRequest -Uri $CDN -OutFile $tmp -TimeoutSec 900
    if (-not (Test-Nnue $tmp)) {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        Write-Host '  [FAIL] downloaded file failed verification' -ForegroundColor Red
        Write-Host ''
        exit 1
    }
    $source = $tmp
}

$fail = 0
foreach ($t in $targets) {
    $label = if ($t -like '*android*') { 'android/assets      ' } else { 'ios/BundleResources ' }
    if (Test-Nnue $t) {
        Write-Host "  [OK]   $label already verified" -ForegroundColor Green
        continue
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $t -Parent) | Out-Null
    Copy-Item $source $t -Force
    # 必须复查：宁可这里失败，也不要让坏文件混进安装包
    if (Test-Nnue $t) {
        Write-Host "  [OK]   $label installed" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $label size or hash mismatch -- removed" -ForegroundColor Red
        Remove-Item $t -Force -ErrorAction SilentlyContinue
        $fail++
    }
}

if ($source -like "$env:TEMP*") { Remove-Item $source -Force -ErrorAction SilentlyContinue }

Write-Host ''
exit $fail
