#!/bin/bash
# =====================================================================
#  build_ios.sh -- 编译 Pikafish 为 iOS 静态库 (libpikafish.a)
#
#  【必须在 macOS + Xcode 环境执行】
#  用法:
#     chmod +x build_ios.sh
#     ./build_ios.sh
#
#  产物:
#     build/ios/libpikafish-device.a    (arm64 真机)
#     build/ios/libpikafish-sim.a       (arm64 模拟器)
#
#  之后在 Xcode 中：
#     1. 新建 Cocoa Touch Framework 项目 XiangqiEngine
#     2. 加入 native/ios/*.h/.m/.mm 与本脚本产出的 .a
#     3. 把 pikafish.nnue 加入 Bundle Resources
#     4. Build Settings -> Other Linker Flags 添加 -lc++
#     5. 导出 XiangqiEngine.framework 放到
#        app/nativeplugins/XiangqiEngine/ios/
#
#  本脚本为 Pikafish(GPLv3) 配套代码，以 GPLv3 提供。
# =====================================================================
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/engine-src/src"
JNIDIR="$ROOT/native/android/jni"     # engine_main.cpp 在此，iOS 复用
OUT="$ROOT/build/ios"
mkdir -p "$OUT"

# ---- 编译参数（与 Android 侧保持一致的宏定义）----
#  IS_64BIT           : 启用 u128（象棋 90 格 Bitboard 必需）
#  USE_NEON=8         : arm64 NEON
#  NNUE_EMBEDDING_OFF : 权重外部加载
COMMON_FLAGS="-std=c++17 -O3 -DNDEBUG -DIS_64BIT -DUSE_NEON=8 -DUSE_POPCNT -DNNUE_EMBEDDING_OFF -I$SRC -I$SRC/external -fno-rtti"

# ---- 收集源文件（排除 main.cpp，改用 engine_main.cpp）----
SOURCES=$(find "$SRC" -name '*.cpp' ! -name 'main.cpp')
SOURCES="$SOURCES $JNIDIR/engine_main.cpp"

build_arch() {
    local ARCH=$1
    local SDK=$2
    local MIN=$3
    local TAG=$4

    echo "==> building $TAG ($ARCH / $SDK)"
    local OBJDIR="$OUT/obj-$TAG"
    rm -rf "$OBJDIR"; mkdir -p "$OBJDIR"

    local SYSROOT
    SYSROOT=$(xcrun --sdk "$SDK" --show-sdk-path)

    local TARGET_FLAG
    if [ "$SDK" = "iphonesimulator" ]; then
        TARGET_FLAG="-target ${ARCH}-apple-ios${MIN}-simulator"
    else
        TARGET_FLAG="-target ${ARCH}-apple-ios${MIN}"
    fi

    local i=0
    for f in $SOURCES; do
        i=$((i+1))
        local base
        base=$(basename "$f" .cpp)
        xcrun --sdk "$SDK" clang++ $COMMON_FLAGS $TARGET_FLAG \
            -isysroot "$SYSROOT" \
            -c "$f" -o "$OBJDIR/${i}_${base}.o" &
        # 限制并发
        while [ "$(jobs -r | wc -l)" -ge 8 ]; do sleep 0.2; done
    done
    wait

    xcrun --sdk "$SDK" ar rcs "$OUT/libpikafish-$TAG.a" "$OBJDIR"/*.o
    xcrun --sdk "$SDK" ranlib "$OUT/libpikafish-$TAG.a"
    echo "==> $OUT/libpikafish-$TAG.a  ($(du -h "$OUT/libpikafish-$TAG.a" | cut -f1))"
}

build_arch arm64 iphoneos 12.0 device
build_arch arm64 iphonesimulator 12.0 sim

echo ""
echo "BUILD_OK"
echo "产物:"
ls -lh "$OUT"/*.a
echo ""
echo "下一步：把 .a 与 native/ios/ 下的源码一起打进 XiangqiEngine.framework"
