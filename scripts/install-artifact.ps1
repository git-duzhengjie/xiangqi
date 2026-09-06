# =============================================================
#  install-artifact.ps1
#  Install CI build artifacts into app/nativeplugins/XiangqiEngine
#
#  NOTE: All output is in English on purpose. A .ps1 file saved as
#  UTF-8 without BOM is parsed as ANSI by Windows PowerShell 5.1,
#  which turns Chinese characters into garbage. Keeping it ASCII
#  makes the script safe on every machine.
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File scripts\install-artifact.ps1 -Zip <path-to-zip>
#    powershell -ExecutionPolicy Bypass -File scripts\install-artifact.ps1 -Verify
#
#  Handles both:
#    XiangqiEngine-android-release.zip / -full.zip   (Android)
#    XiangqiEngine-iOS.zip                           (iOS)
# =============================================================

[CmdletBinding()]
param(
    [string] $Zip,
    [switch] $Verify,
    [switch] $KeepTemp
)

$ErrorActionPreference = 'Stop'

# Repo root is derived from this script's location (scripts\..).
$ROOT   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PLUGIN = Join-Path $ROOT 'app\nativeplugins\XiangqiEngine'

# Use a global variable, not $script:. Say-Bad is called from inside
# Test-Plugin / Install-*, and assigning to $script:Fail there can bind to
# a different scope depending on how the file is dot-sourced, which made the
# exit code stay 0 even when [FAIL] lines were printed. $global: is
# unambiguous and keeps the script usable as a CI gate.
$global:Fail = 0

function Say-Ok   ($m) { Write-Host "  [ OK ] $m"   -ForegroundColor Green }
function Say-Bad  ($m) { Write-Host "  [FAIL] $m"   -ForegroundColor Red;    $global:Fail = 1 }
function Say-Warn ($m) { Write-Host "  [WARN] $m"   -ForegroundColor Yellow }

function Say-Info ($m) { Write-Host "  $m"          -ForegroundColor Gray }
function Head     ($m) { Write-Host ""; Write-Host "=== $m ===" -ForegroundColor Cyan }


# -------------------------------------------------------------
#  Verify the plugin directory is ready for HBuilderX cloud build
# -------------------------------------------------------------
function Test-Plugin {
    Head 'Verifying plugin directory'

    if (-not (Test-Path $PLUGIN)) {
        Say-Bad "plugin dir not found: $PLUGIN"
        return
    }
    Say-Info "path: $PLUGIN"

    # 1) directory name must equal the plugin id in package.json
    $pj = Join-Path $PLUGIN 'package.json'
    if (Test-Path $pj) {
        $meta = Get-Content $pj -Raw -Encoding UTF8 | ConvertFrom-Json
        $dirName = Split-Path $PLUGIN -Leaf
        if ($meta.id -eq $dirName) {
            Say-Ok "dir name matches plugin id: $dirName"
        } else {
            Say-Bad "dir name '$dirName' != package.json id '$($meta.id)' -- HBuilderX will not detect the plugin"
        }
    } else {
        Say-Bad 'package.json missing'
    }

    # 2) Android required files.
    #    pikafish.nnue is deliberately NOT required here. The official weights
    #    grew to ~49MB in 2026-07; bundling them would push the plugin to
    #    ~102MB, far past the 40MB free cloud-build quota. The app now
    #    downloads the weights on first launch (see app/utils/nnue.js).
    #    Cloud build only consumes compiled artifacts (integrateType=jar).
    #    It does NOT compile .java under android/src -- checking for those
    #    sources was a leftover from the old broken layout and produced
    #    false [FAIL] lines even on a perfectly good install.
    $android = @(
        'android\libs\arm64-v8a\libpikafish.so',
        'android\libs\xiangqi-engine.jar'
    )
    foreach ($f in $android) {
        $p = Join-Path $PLUGIN $f
        if (Test-Path $p) {
            $kb = [math]::Round((Get-Item $p).Length / 1KB, 1)
            Say-Ok "$f  ($kb KB)"
        } else {
            Say-Bad "missing: $f"
        }
    }

    # 3) iOS files: framework is only needed when building for iOS
    $iosFw = Join-Path $PLUGIN 'ios\XiangqiEngine.framework'
    if (Test-Path $iosFw) {
        # flat structure check: no Versions dir allowed
        if (Test-Path (Join-Path $iosFw 'Versions')) {
            Say-Bad 'ios framework has Versions/ (symlink layout) -- cloud build will fail on Windows'
        } else {
            Say-Ok 'ios framework uses flat layout'
        }
        # the binary must be a real file of a few MB, not a broken symlink
        $bin = Join-Path $iosFw 'XiangqiEngine'
        if (Test-Path $bin) {
            $mb = [math]::Round((Get-Item $bin).Length / 1MB, 2)
            if ($mb -lt 1) {
                Say-Bad "framework binary is only $mb MB -- symlink was flattened into a text stub"
            } else {
                Say-Ok "framework binary: $mb MB"
            }
        } else {
            Say-Bad 'framework binary missing'
        }
    } else {
        Say-Warn 'ios/XiangqiEngine.framework not installed (only needed for iOS builds)'
    }

    # 4) size vs the 40MB free quota of the cloud build service
    $bytes = (Get-ChildItem $PLUGIN -Recurse -File | Measure-Object Length -Sum).Sum
    $mb    = [math]::Round($bytes / 1MB, 2)
    Write-Host ""
    Say-Info "total size: $mb MB"
    if ($mb -gt 40) {
        Say-Bad "exceeds the 40MB free cloud-build quota"
    } else {
        Say-Ok "within the 40MB free quota"
    }

    # x86_64 is a simulator/emulator lib; drop it for release builds
    $x86 = Join-Path $PLUGIN 'android\libs\x86_64'
    if (Test-Path $x86) {
        Say-Warn 'x86_64 lib present (emulator only). Remove it for release to save ~2.4MB.'
    }
}


# -------------------------------------------------------------
#  Install an Android artifact zip
#  CI produces:
#    XiangqiEngine-android-release.zip -> unzips to 'XiangqiEngine-release/'
#    XiangqiEngine-android-full.zip    -> unzips to 'XiangqiEngine/'
#  The '-release' suffix MUST be renamed, otherwise HBuilderX cannot
#  match the directory name against the plugin id.
# -------------------------------------------------------------
function Install-Android ($tmp) {
    # locate the directory that actually holds package.json
    $pkg = Get-ChildItem $tmp -Recurse -Filter 'package.json' |
           Where-Object { $_.FullName -notmatch 'node_modules' } |
           Select-Object -First 1
    if (-not $pkg) { Say-Bad 'package.json not found inside the zip'; return }

    $src = $pkg.Directory.FullName
    Say-Info "source dir in zip: $(Split-Path $src -Leaf)"

    if ((Split-Path $src -Leaf) -ne 'XiangqiEngine') {
        Say-Warn "renaming '$(Split-Path $src -Leaf)' -> 'XiangqiEngine' (required by HBuilderX)"
    }

    # keep the existing ios/ folder: the Android zip does not contain it
    $iosBak = $null
    $iosDir = Join-Path $PLUGIN 'ios'
    if (Test-Path $iosDir) {
        $iosBak = Join-Path $env:TEMP ("ios-keep-" + [guid]::NewGuid().ToString('N').Substring(0,8))
        Copy-Item $iosDir $iosBak -Recurse -Force
        Say-Info 'existing ios/ folder preserved'
    }

    if (Test-Path $PLUGIN) { Remove-Item $PLUGIN -Recurse -Force }
    New-Item -ItemType Directory -Path $PLUGIN -Force | Out-Null
    Copy-Item (Join-Path $src '*') $PLUGIN -Recurse -Force

    if ($iosBak) {
        if (Test-Path (Join-Path $PLUGIN 'ios')) { Remove-Item (Join-Path $PLUGIN 'ios') -Recurse -Force }
        Copy-Item $iosBak (Join-Path $PLUGIN 'ios') -Recurse -Force
        Remove-Item $iosBak -Recurse -Force
        Say-Ok 'ios/ folder restored'
    }
    Say-Ok 'Android artifact installed'
}

# -------------------------------------------------------------
#  Install an iOS artifact zip
#  CI zips the artifact *contents* (no top-level folder):
#    XiangqiEngine.framework/ , IOS_*.md
#  Only the framework goes into the plugin's ios/ folder. NNUE weights are
#  downloaded by the app at first launch, not bundled (see app/utils/nnue.js).
#  The .a files are intermediate outputs and are NOT needed.
# -------------------------------------------------------------
function Install-Ios ($tmp) {
    $fw = Get-ChildItem $tmp -Recurse -Directory -Filter 'XiangqiEngine.framework' | Select-Object -First 1
    if (-not $fw) { Say-Bad 'XiangqiEngine.framework not found inside the zip'; return }

    $iosDir = Join-Path $PLUGIN 'ios'
    if (-not (Test-Path $iosDir)) { New-Item -ItemType Directory -Path $iosDir -Force | Out-Null }

    $dst = Join-Path $iosDir 'XiangqiEngine.framework'
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    Copy-Item $fw.FullName $dst -Recurse -Force
    Say-Ok 'XiangqiEngine.framework installed'

    # nnue is no longer shipped inside the plugin: the official weights grew to
    # ~49MB in 2026-07 and package.json's resources list is now empty. If an old
    # artifact still carries one, skip it instead of bloating the plugin.
    $nnue = Get-ChildItem $tmp -Recurse -File -Filter 'pikafish.nnue' | Select-Object -First 1
    if ($nnue) {
        Say-Info 'skipped pikafish.nnue - weights are downloaded at runtime now'
    }

    $a = Get-ChildItem $tmp -Recurse -File -Filter '*.a'
    if ($a) { Say-Info "skipped $($a.Count) intermediate .a file(s) - not needed by the plugin" }
}


# -------------------------------------------------------------
#  Main
# -------------------------------------------------------------
Write-Host ""
Write-Host "XiangqiEngine CI artifact installer" -ForegroundColor White
Say-Info "repo root: $ROOT"

if ($Verify -and -not $Zip) {
    Test-Plugin
    Write-Host ""
    if ($global:Fail -eq 0) {
        Write-Host "RESULT: plugin dir is ready for cloud build" -ForegroundColor Green
    } else {
        Write-Host "RESULT: problems found, see [FAIL] above" -ForegroundColor Red
    }
    exit $global:Fail
}

if (-not $Zip) {
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  install artifact : -Zip <path-to-zip>"
    Write-Host "  verify only      : -Verify"
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\install-artifact.ps1 -Zip $env:USERPROFILE\Downloads\XiangqiEngine-android-release.zip'
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\install-artifact.ps1 -Verify'
    exit 1
}

if (-not (Test-Path $Zip)) { Say-Bad "zip not found: $Zip"; exit 1 }

$zipItem = Get-Item $Zip
Head 'Artifact'
Say-Info "file: $($zipItem.Name)"
Say-Info "size: $([math]::Round($zipItem.Length / 1MB, 2)) MB"

# GitHub always wraps artifacts in an outer zip when downloading from the
# web UI, so the file may be a zip containing another zip. Handle both.
$tmp = Join-Path $env:TEMP ("xq-artifact-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
    Expand-Archive -LiteralPath $zipItem.FullName -DestinationPath $tmp -Force

    $inner = Get-ChildItem $tmp -Recurse -File -Filter '*.zip'
    if ($inner) {
        Say-Info "found $($inner.Count) nested zip (GitHub web download wrapper), extracting"
        foreach ($z in $inner) {
            Expand-Archive -LiteralPath $z.FullName -DestinationPath (Join-Path $tmp $z.BaseName) -Force
        }
    }

    # Decide the artifact type from what is actually inside, not the file name.
    $hasFw   = (Get-ChildItem $tmp -Recurse -Directory -Filter 'XiangqiEngine.framework' | Select-Object -First 1) -ne $null
    $hasSo   = (Get-ChildItem $tmp -Recurse -File -Filter 'libpikafish.so'              | Select-Object -First 1) -ne $null

    Head 'Installing'
    if ($hasSo) {
        Say-Info 'detected: Android artifact'
        Install-Android $tmp
    } elseif ($hasFw) {
        Say-Info 'detected: iOS artifact'
        Install-Ios $tmp
    } else {
        Say-Bad 'unrecognised artifact: neither libpikafish.so nor XiangqiEngine.framework found'
    }
}
finally {
    if ($KeepTemp) {
        Say-Info "temp kept at: $tmp"
    } else {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Test-Plugin

Write-Host ""
if ($global:Fail -eq 0) {
    Write-Host "RESULT: done. Open the app/ folder in HBuilderX and run cloud build." -ForegroundColor Green
} else {
    Write-Host "RESULT: problems found, see [FAIL] above" -ForegroundColor Red
}
exit $global:Fail
