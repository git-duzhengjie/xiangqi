#!/bin/bash
# =====================================================================
#  make_framework.sh -- Assemble XiangqiEngine.framework
#
#  Replaces the manual Xcode steps:
#    - create framework bundle layout
#    - compile ObjC/ObjC++ bridge sources
#    - link with libpikafish.a
#    - embed pikafish.nnue as a bundle resource
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
NNUE="$ROOT/pikafish.nnue"

echo "=== assemble XiangqiEngine.framework ==="

# ---------- preflight ----------
if [ ! -f "$DEVICE_LIB" ]; then
    echo "ERROR: $DEVICE_LIB not found. Run build_ios.sh first."
    exit 1
fi
if [ ! -f "$NNUE" ]; then
    echo "ERROR: pikafish.nnue not found at repo root."
    exit 1
fi

# ---------- framework layout (iOS uses flat structure) ----------
rm -rf "$FW"
mkdir -p "$FW/Headers"
mkdir -p "$FW/Modules"

SYSROOT=$(xcrun --sdk iphoneos --show-sdk-path)
MIN_IOS=12.0

# ---------- compile bridge sources ----------
# DCUniModule.h comes from the uni-app SDK and is NOT available here,
# so XiangqiEngineModule.m cannot be compiled in CI. We compile the
# engine-facing bridge only; the uni-app module source is shipped as-is
# and gets compiled by DCloud's cloud build.
OBJDIR="$OUT/fw-obj"
rm -rf "$OBJDIR"; mkdir -p "$OBJDIR"

echo "--> compiling PikafishBridge.mm"
xcrun --sdk iphoneos clang++ \
    -target arm64-apple-ios${MIN_IOS} \
    -isysroot "$SYSROOT" \
    -std=c++17 -O2 -fobjc-arc -fno-rtti \
    -I"$IOSDIR" \
    -c "$IOSDIR/PikafishBridge.mm" \
    -o "$OBJDIR/PikafishBridge.o"

# ---------- merge engine lib + bridge object ----------
echo "--> merging static libraries"
cp "$DEVICE_LIB" "$OUT/libXiangqiEngine.a"
xcrun --sdk iphoneos ar r "$OUT/libXiangqiEngine.a" "$OBJDIR/PikafishBridge.o"
xcrun --sdk iphoneos ranlib "$OUT/libXiangqiEngine.a"

# ---------- place binary + headers ----------
cp "$OUT/libXiangqiEngine.a" "$FW/XiangqiEngine"
cp "$IOSDIR/PikafishBridge.h" "$FW/Headers/"
cp "$IOSDIR/XiangqiEngineModule.h" "$FW/Headers/"

# ---------- resource: NNUE weights ----------
cp "$NNUE" "$FW/pikafish.nnue"

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
    <string>12.0</string>
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
if nm "$FW/XiangqiEngine" 2>/dev/null | grep -q 'PikafishBridge'; then
    echo "symbol PikafishBridge: OK"
else
    echo "symbol PikafishBridge: MISSING"
    exit 1
fi
echo ""
find "$FW" -type f | sed "s|$OUT/||"
echo ""
echo "FRAMEWORK_OK -> $FW"
