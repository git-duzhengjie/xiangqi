#!/bin/bash
# =====================================================================
#  build_ios.sh -- Build Pikafish as iOS static libraries
#
#  MUST run on macOS with Xcode command line tools.
#
#  Usage:
#      chmod +x build_ios.sh
#      ./build_ios.sh
#
#  Output:
#      build/ios/libpikafish-device.a   (arm64, real device)
#      build/ios/libpikafish-sim.a      (arm64, simulator)
#
#  IMPORTANT LESSONS BAKED IN (a previous version silently produced a
#  119K broken archive because of these):
#    1. Background jobs + bare `wait` do NOT propagate failures, and
#       `set -e` does not catch them. Every compile is now checked and
#       the script aborts on the first error, printing the compiler log.
#    2. Source list is enumerated EXPLICITLY, mirroring the verified
#       Android script. A blind `find` over the tree pulls in files
#       that must not be compiled.
#    3. Flags mirror the verified Android arm64 build exactly.
#    4. Archive size is asserted at the end, so a truncated build can
#       never be reported as success again.
#
#  ASCII-only output on purpose (CI log encoding safety).
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/engine-src/src"
JNIDIR="$ROOT/native/android/jni"      # engine_main.cpp lives here, reused by iOS
OUT="$ROOT/build/ios"

MIN_IOS=12.0
# Minimum acceptable archive size. A correct build is ~2MB+; the broken
# run produced 119K, so 1MB is a safe floor.
MIN_SIZE_BYTES=1000000

mkdir -p "$OUT"

# ---------- preflight ----------
if [ ! -d "$SRC" ]; then
    echo "ERROR: engine source not found at $SRC"
    echo "Run scripts/fetch-engine.ps1 (or git clone Pikafish) first."
    exit 1
fi
if [ ! -f "$JNIDIR/engine_main.cpp" ]; then
    echo "ERROR: $JNIDIR/engine_main.cpp not found"
    exit 1
fi

# ---------------------------------------------------------------------
#  Collect sources EXPLICITLY (mirrors native/android/build_so.ps1).
#  main.cpp is excluded on purpose: we provide our own entry point
#  pikafish_main() in engine_main.cpp so the upstream source stays
#  untouched.
# ---------------------------------------------------------------------
collect_sources() {
    local list=""
    local d

    # top level, excluding main.cpp
    for f in "$SRC"/*.cpp; do
        [ -e "$f" ] || continue
        case "$(basename "$f")" in
            main.cpp) continue ;;
        esac
        list="$list $f"
    done

    # nnue and nested dirs, plus bundled external deps
    for d in "$SRC/nnue" "$SRC/nnue/features" \
             "$SRC/external/common" "$SRC/external/decompress"; do
        [ -d "$d" ] || continue
        for f in "$d"/*.cpp; do
            [ -e "$f" ] || continue
            list="$list $f"
        done
    done

    # our own entry point
    list="$list $JNIDIR/engine_main.cpp"

    echo "$list"
}

SOURCES="$(collect_sources)"
SRC_COUNT=$(echo $SOURCES | wc -w | tr -d ' ')
echo "=== source files: $SRC_COUNT ==="
if [ "$SRC_COUNT" -lt 10 ]; then
    echo "ERROR: only $SRC_COUNT source files found, engine tree looks wrong."
    exit 1
fi

# ---------------------------------------------------------------------
#  Compile one architecture.
#
#  Flags mirror the verified Android arm64 build:
#      -std=c++17 -O3 -DNDEBUG -DNNUE_EMBEDDING_OFF
#      -DIS_64BIT -DUSE_NEON=8 -DUSE_POPCNT
#
#  -DIS_64BIT is mandatory: xiangqi has a 9x10 = 90 square board, so the
#  bitboard needs unsigned __int128. Without it compilation fails.
#
#  NOTE: -fno-rtti was used in an earlier version but is NOT part of the
#  verified Android flag set; dropped to stay consistent.
# ---------------------------------------------------------------------
build_arch() {
    local SDK=$1      # iphoneos | iphonesimulator
    local TAG=$2      # device | sim

    echo ""
    echo "=== building $TAG (arm64 / $SDK) ==="

    local SYSROOT
    SYSROOT=$(xcrun --sdk "$SDK" --show-sdk-path)

    local TARGET
    if [ "$SDK" = "iphonesimulator" ]; then
        TARGET="arm64-apple-ios${MIN_IOS}-simulator"
    else
        TARGET="arm64-apple-ios${MIN_IOS}"
    fi

    local BASE_FLAGS="-std=c++17 -O3 -DNDEBUG -DNNUE_EMBEDDING_OFF"
    # arm64 on both device and simulator -> NEON is available in both.
    local ARCH_FLAGS="-DIS_64BIT -DUSE_NEON=8 -DUSE_POPCNT"
    local INC="-I$SRC -I$SRC/external"

    local OBJDIR="$OUT/obj-$TAG"
    rm -rf "$OBJDIR"; mkdir -p "$OBJDIR"

    local NCPU
    NCPU=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)

    local i=0
    local pids=""
    local failed=0

    for f in $SOURCES; do
        i=$((i+1))
        local base
        base=$(basename "$f" .cpp)
        local obj="$OBJDIR/${i}_${base}.o"
        local log="$OBJDIR/${i}_${base}.log"

        # Compile in background but remember the log; failures are
        # detected after wait by checking for missing .o files.
        (
            if ! xcrun --sdk "$SDK" clang++ \
                    -target "$TARGET" -isysroot "$SYSROOT" \
                    $BASE_FLAGS $ARCH_FLAGS $INC \
                    -c "$f" -o "$obj" 2> "$log"; then
                # leave the .o absent to signal failure
                rm -f "$obj"
            fi
        ) &

        # throttle concurrency
        while [ "$(jobs -r | wc -l)" -ge "$NCPU" ]; do sleep 0.1; done
    done
    wait

    # ---- verify every translation unit produced an object ----
    echo "--> verifying object files"
    i=0
    for f in $SOURCES; do
        i=$((i+1))
        local base
        base=$(basename "$f" .cpp)
        local obj="$OBJDIR/${i}_${base}.o"
        local log="$OBJDIR/${i}_${base}.log"
        if [ ! -f "$obj" ]; then
            echo ""
            echo "COMPILE FAILED: $f"
            echo "---------------- compiler output ----------------"
            [ -f "$log" ] && cat "$log"
            echo "------------------------------------------------"
            failed=$((failed+1))
        fi
    done

    if [ "$failed" -gt 0 ]; then
        echo ""
        echo "ERROR: $failed of $SRC_COUNT translation units failed for $TAG."
        exit 1
    fi

    local OBJ_COUNT
    OBJ_COUNT=$(ls -1 "$OBJDIR"/*.o | wc -l | tr -d ' ')
    echo "--> compiled $OBJ_COUNT / $SRC_COUNT objects"
    if [ "$OBJ_COUNT" -ne "$SRC_COUNT" ]; then
        echo "ERROR: object count mismatch."
        exit 1
    fi

    # ---- archive ----
    local LIB="$OUT/libpikafish-$TAG.a"
    rm -f "$LIB"
    xcrun --sdk "$SDK" ar rcs "$LIB" "$OBJDIR"/*.o
    xcrun --sdk "$SDK" ranlib "$LIB"

    # ---- assert size ----
    local SZ
    SZ=$(stat -f%z "$LIB")
    echo "--> $LIB ($((SZ/1024))K)"
    if [ "$SZ" -lt "$MIN_SIZE_BYTES" ]; then
        echo "ERROR: archive is only $((SZ/1024))K, expected >= $((MIN_SIZE_BYTES/1024))K."
        echo "This indicates most objects were missing. Aborting."
        exit 1
    fi

    # ---- assert entry symbol ----
    if xcrun --sdk "$SDK" nm "$LIB" 2>/dev/null | grep -q 'pikafish_main'; then
        echo "--> symbol pikafish_main: OK"
    else
        echo "ERROR: symbol pikafish_main missing from $LIB"
        exit 1
    fi
}

build_arch iphoneos        device
build_arch iphonesimulator sim

echo ""
echo "BUILD_OK"
ls -lh "$OUT"/*.a
echo ""
echo "Next: run make_framework.sh to assemble XiangqiEngine.framework"
