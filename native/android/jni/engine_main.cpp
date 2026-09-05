// ============================================================
//  engine_main.cpp
//  Pikafish 引擎入口（替代原始 main.cpp）
//
//  说明：原始 main.cpp 的入口函数名为 main()，编译为 .so 时
//  会与宿主 App 的入口语义冲突，且无法被 JNI 调用。
//  这里提供同等逻辑的 pikafish_main()，供 pikafish_jni.cpp 调用。
//  原始 main.cpp 在构建脚本中被排除，不参与编译。
//
//  本文件为 Pikafish(GPLv3) 的衍生代码，随项目一并以 GPLv3 提供。
// ============================================================

#include <iostream>
#include <memory>
#include <utility>

#include "attacks.h"
#include "misc.h"
#include "position.h"
#include "tune.h"
#include "uci.h"

using namespace Stockfish;

// 供 JNI / iOS 桥接层调用的引擎入口
extern "C" int pikafish_main(int argc, char* argv[]) {
    std::cout << engine_info() << std::endl;

    Attacks::init();
    Position::init();

    auto cli = CommandLine(argc, argv);
    auto uci = std::make_unique<UCIEngine>(std::move(cli));

    Tune::init(uci->engine_options());

    uci->loop();   // UCI 主循环：从 stdin 读命令，向 stdout 写结果

    return 0;
}
