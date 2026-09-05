#!/bin/bash
# =====================================================================
#  make_framework.sh -- Assemble XiangqiEngine.framework
#
#  Replaces the manual Xcode steps:
#    - create framework bundle layout
#    - compile ObjC/ObjC++ bridge sources
#    - link with libpikafish.a
#
#  NOTE: pikafish.nnue is NOT embedded anymore. The official weights grew to
#  ~49MB in 2026-07, which would blow past the 40MB free cloud-build quota,
#  so the app downloads them at first launch (see app/utils/nnue.js).
#
#  Run AFTER build_ios.sh. Requires macOS + Xcode CLT.
#
#  Output: build/ios/XiangqiEngine.framework
#
#  NOTE: ASCII-only output on purpose (CI log encoding safety).
# =====================================================================
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IOSDIR="$ROOT/native/ios"
OUT="$ROOT/build/ios"
FW="$OUT/XiangqiEngine.framework"

DEVICE_LIB="$OUT/libpikafish-device.a"

echo "=== assemble XiangqiEngine.framework ==="

# ---------- preflight ----------
if [ ! -f "$DEVICE_LIB" ]; then
    echo "ERROR: $DEVICE_LIB not found. Run build_ios.sh first."
    exit 1
fi

# ---------- framework layout (iOS uses flat structure) ----------
rm -rf "$FW"
mkdir -p "$FW/Headers"
mkdir -p "$FW/Modules"

SYSROOT=$(xcrun --sdk iphoneos --show-sdk-path)
# Must match build_ios.sh. iOS 13.0 is required by std::filesystem::path.
MIN_IOS=13.0

# ---------- compile bridge sources ----------
# DCUniModule.h comes from the uni-app SDK and is NOT available here,
# so XiangqiEngineModule.m cannot be compiled in CI. We compile the
# engine-facing bridge only; the uni-app module source is shipped as-is
# and gets compiled by DCloud's cloud build.
OBJDIR="$OUT/fw-obj"
rm -rf "$OBJDIR"; mkdir -p "$OBJDIR"

echo "--> compiling PikafishBridge.mm"
# Flags must match build_ios.sh: the bridge includes engine headers,
# so -DIS_64BIT is required here too (90-square board needs u128).
# -fno-rtti was dropped to stay consistent with the verified flag set.
xcrun --sdk iphoneos clang++ \
    -target arm64-apple-ios${MIN_IOS} \
    -isysroot "$SYSROOT" \
    -std=c++17 -O2 -DNDEBUG -fobjc-arc \
    -DIS_64BIT -DUSE_NEON=8 -DUSE_POPCNT -DNNUE_EMBEDDING_OFF \
    -I"$IOSDIR" -I"$ROOT/engine-src/src" \
    -c "$IOSDIR/PikafishBridge.mm" \
    -o "$OBJDIR/PikafishBridge.o" 2> "$OBJDIR/bridge.log" || {
        echo "COMPILE FAILED: PikafishBridge.mm"
        echo "---------------- compiler output ----------------"
        cat "$OBJDIR/bridge.log"
        echo "------------------------------------------------"
        exit 1
    }

if [ ! -f "$OBJDIR/PikafishBridge.o" ]; then
    echo "ERROR: PikafishBridge.o was not produced"
    exit 1
fi

# ---------- merge engine lib + bridge object ----------
echo "--> merging static libraries"
cp "$DEVICE_LIB" "$OUT/libXiangqiEngine.a"
xcrun --sdk iphoneos ar r "$OUT/libXiangqiEngine.a" "$OBJDIR/PikafishBridge.o"
xcrun --sdk iphoneos ranlib "$OUT/libXiangqiEngine.a"

# ---------- place binary + headers ----------
cp "$OUT/libXiangqiEngine.a" "$FW/XiangqiEngine"
cp "$IOSDIR/PikafishBridge.h" "$FW/Headers/"
cp "$IOSDIR/XiangqiEngineModule.h" "$FW/Headers/"

# NOTE: no pikafish.nnue here on purpose -- weights are downloaded at runtime.

# ---------- Info.plist ----------
cat > "$FW/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>XiangqiEngine</string>
    <key>CFBundleIdentifier</key>
    <string>com.xiangqi.engine</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>XiangqiEngine</string>
    <key>CFBundlePackageType</key>
    <string>FMWK</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>MinimumOSVersion</key>
    <key>MinimumOSVersion</key>
    <string>13.0</string>
</dict>
</plist>
PLIST

# ---------- module.modulemap ----------
cat > "$FW/Modules/module.modulemap" <<'MODMAP'
framework module XiangqiEngine {
    umbrella header "XiangqiEngineModule.h"
    export *
    module * { export * }
    link "c++"
}
MODMAP

# ---------- verify ----------
echo ""
echo "=== verify ==="
lipo -info "$FW/XiangqiEngine"

# Size assertion: a correct binary is ~2MB+. The earlier broken build
# produced a 119K archive, so guard against truncated output.
FW_SIZE=$(stat -f%z "$FW/XiangqiEngine")
echo "binary size: $((FW_SIZE/1024))K"
if [ "$FW_SIZE" -lt 1000000 ]; then
    echo "ERROR: framework binary is only $((FW_SIZE/1024))K, expected >= 1000K."
    echo "Most object files are likely missing. Aborting."
    exit 1
fi

for sym in PikafishBridge pikafish_main; do
    # Same pipefail + grep -q trap as in build_ios.sh: grep -q exits early,
    # nm dies with SIGPIPE, and a PRESENT symbol gets misreported as missing.
    # Capture output first, then count.
    FW_SYMS=$(nm "$FW/XiangqiEngine" 2>/dev/null || true)
    HITS=$(printf '%s\n' "$FW_SYMS" | grep -c "$sym" || true)
    if [ "$HITS" -gt 0 ]; then
        echo "symbol $sym: OK ($HITS match)"
    else
        echo "ERROR: symbol $sym missing"
        echo "--- defined text symbols (first 40) ---"
        printf '%s\n' "$FW_SYMS" | grep -E ' [TtSs] ' | head -40 || true
        exit 1
    fi
done

# NOTE: pikafish.nnue is deliberately absent from the framework.
# The app downloads the weights at first launch, so there is nothing
# to verify here.

echo ""
find "$FW" -type f | sed "s|$OUT/||"
echo ""
echo "FRAMEWORK_OK -> $FW"
