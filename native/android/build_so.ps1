# =====================================================================
#  build_so.ps1  --  Build libpikafish.so for Android (arm64-v8a / armeabi-v7a / x86_64)
#
#  Output: build\<abi>\libpikafish.so
#  Note: Pikafish official Makefile needs sh/sed/tr which are unavailable
#        on Windows CMD, so we invoke NDK clang++ directly.
#        main.cpp is excluded; we use native\android\jni\engine_main.cpp.
#
#  Usage:  powershell -ExecutionPolicy Bypass -File build_so.ps1 -Abi arm64-v8a
# =====================================================================
param(
    [ValidateSet('arm64-v8a','armeabi-v7a','x86_64')]
    [string]$Abi = 'arm64-v8a'
)

$ErrorActionPreference = 'Continue'

$NDK  = 'D:\Android\ndk\27.1.12297006'
$TC   = Join-Path $NDK 'toolchains\llvm\prebuilt\windows-x86_64\bin'

# Derive the repo root from this script's own location instead of hard-coding
# an absolute path. The previous value 'D:\projects\xiangqi-app' broke when the
# repository was moved to D:\projects\xiangqi.
# This file lives at <root>\native\android\build_so.ps1, so go up two levels.
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$SRC  = Join-Path $ROOT 'engine-src\src'
$JNID = Join-Path $ROOT 'native\android\jni'

if (-not (Test-Path $SRC)) {
    Write-Host "ERROR: engine source not found at $SRC" -ForegroundColor Red
    Write-Host "Run scripts\fetch-engine.ps1 first." -ForegroundColor Yellow
    exit 1
}

# --- per-ABI toolchain & flags ---
switch ($Abi) {
    'arm64-v8a' {
        $CXX   = Join-Path $TC 'aarch64-linux-android29-clang++.cmd'
        $ARCHF = @('-DIS_64BIT','-DUSE_NEON=8','-DUSE_POPCNT')
    }
    'armeabi-v7a' {
        $CXX   = Join-Path $TC 'armv7a-linux-androideabi29-clang++.cmd'
        # 32-bit: no IS_64BIT, NEON level 7
        $ARCHF = @('-DUSE_NEON=7','-mfpu=neon')
    }
    'x86_64' {
        $CXX   = Join-Path $TC 'x86_64-linux-android29-clang++.cmd'
        # ZSTD_DISABLE_ASM: zstd's huf_decompress_amd64.S is hand-written assembly
        # and is not among the .cpp files this script collects, so disable the
        # asm path and use the C implementation instead (perf impact negligible).
        $ARCHF = @('-DIS_64BIT','-DUSE_SSE41','-DUSE_SSSE3','-DUSE_SSE2','-DUSE_POPCNT','-msse4.1','-mpopcnt','-DZSTD_DISABLE_ASM=1')
    }
}

$OBJ = Join-Path $ROOT "build\obj\$Abi"
$OUT = Join-Path $ROOT "build\$Abi"
$LOG = Join-Path $ROOT "build\build_$Abi.log"

New-Item -ItemType Directory -Force -Path $OBJ,$OUT | Out-Null
Get-ChildItem -Path $OBJ -Filter *.o -ErrorAction SilentlyContinue | Remove-Item -Force
"=== build $Abi start $(Get-Date -Format o) ===" | Set-Content -Encoding utf8 $LOG

if (-not (Test-Path $CXX)) {
    "TOOLCHAIN_NOT_FOUND: $CXX" | Add-Content $LOG
    Write-Output "TOOLCHAIN_NOT_FOUND"
    exit 1
}

$BASE = @('-std=c++17','-O3','-fPIC','-DNDEBUG','-DNNUE_EMBEDDING_OFF')
$INC  = @("-I$SRC", "-I$SRC\external")
$FLAGS = $BASE + $ARCHF + $INC

# --- collect sources: (file, objPrefix) ---
$units = @()
Get-ChildItem "$SRC\*.cpp" | Where-Object { $_.Name -ne 'main.cpp' } |
    ForEach-Object { $units += [pscustomobject]@{ File=$_.FullName; Obj="eng_$($_.BaseName).o" } }
Get-ChildItem "$SRC\nnue\*.cpp" -ErrorAction SilentlyContinue |
    ForEach-Object { $units += [pscustomobject]@{ File=$_.FullName; Obj="nnue_$($_.BaseName).o" } }
Get-ChildItem "$SRC\nnue\features\*.cpp" -ErrorAction SilentlyContinue |
    ForEach-Object { $units += [pscustomobject]@{ File=$_.FullName; Obj="feat_$($_.BaseName).o" } }
Get-ChildItem "$SRC\external\common\*.cpp" -ErrorAction SilentlyContinue |
    ForEach-Object { $units += [pscustomobject]@{ File=$_.FullName; Obj="zc_$($_.BaseName).o" } }
Get-ChildItem "$SRC\external\decompress\*.cpp" -ErrorAction SilentlyContinue |
    ForEach-Object { $units += [pscustomobject]@{ File=$_.FullName; Obj="zd_$($_.BaseName).o" } }
Get-ChildItem "$JNID\*.cpp" -ErrorAction SilentlyContinue |
    ForEach-Object { $units += [pscustomobject]@{ File=$_.FullName; Obj="jni_$($_.BaseName).o" } }

"TOTAL_UNITS=$($units.Count)" | Add-Content $LOG

# --- compile in parallel batches ---
$fail = 0
$jobs = @()
$maxParallel = 8

foreach ($u in $units) {
    $objPath = Join-Path $OBJ $u.Obj
    $argList = $FLAGS + @('-c', $u.File, '-o', $objPath)
    $jobs += Start-Process -FilePath $CXX -ArgumentList $argList `
        -NoNewWindow -PassThru -RedirectStandardError "$objPath.err" -RedirectStandardOutput "$objPath.out"
    while (($jobs | Where-Object { -not $_.HasExited }).Count -ge $maxParallel) {
        Start-Sleep -Milliseconds 120
    }
}
$jobs | ForEach-Object { $_.WaitForExit() }

foreach ($u in $units) {
    $objPath = Join-Path $OBJ $u.Obj
    if (-not (Test-Path $objPath)) {
        $fail = 1
        "COMPILE_FAIL: $($u.File)" | Add-Content $LOG
        if (Test-Path "$objPath.err") { Get-Content "$objPath.err" | Add-Content $LOG }
    }
}
Get-ChildItem $OBJ -Include *.err,*.out -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force

if ($fail -eq 1) {
    "COMPILE_FAILED" | Add-Content $LOG
    Write-Output "COMPILE_FAILED"
    exit 1
}

# --- link shared library ---
$objs = (Get-ChildItem "$OBJ\*.o" | ForEach-Object { $_.FullName })
"LINKING $($objs.Count) objects" | Add-Content $LOG
$soPath = Join-Path $OUT 'libpikafish.so'
$linkArgs = @('-shared','-fPIC','-O3') + $objs + @('-o',$soPath,'-llog','-latomic','-static-libstdc++')
$p = Start-Process -FilePath $CXX -ArgumentList $linkArgs -NoNewWindow -PassThru `
        -RedirectStandardError "$OUT\link.err" -RedirectStandardOutput "$OUT\link.out"
$p.WaitForExit()
if (Test-Path "$OUT\link.err") { Get-Content "$OUT\link.err" | Add-Content $LOG }
Remove-Item "$OUT\link.err","$OUT\link.out" -Force -ErrorAction SilentlyContinue

if (Test-Path $soPath) {
    $sz = [math]::Round((Get-Item $soPath).Length / 1MB, 2)
    "BUILD_OK size=${sz}MB" | Add-Content $LOG
    Write-Output "BUILD_OK $Abi size=${sz}MB"
} else {
    "LINK_FAILED" | Add-Content $LOG
    Write-Output "LINK_FAILED"
    exit 1
}
