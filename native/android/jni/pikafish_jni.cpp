// ============================================================
//  pikafish_jni.cpp
//  Pikafish 引擎 JNI 桥接层（Android）
//
//  设计要点：
//  1) Android 10+ 禁止执行私有目录下的可执行文件（W^X），
//     因此不能"释放 exe + fork 进程"，必须编译为 .so 用 JNI 直调。
//  2) Pikafish 本体是 UCI 协议程序，读写 stdin/stdout。
//     这里用 pipe() + dup2() 将标准流重定向到内存管道：
//         Java --send()--> [inPipe]  --> 引擎 stdin
//         Java <--readLine()-- [outPipe] <-- 引擎 stdout
//  3) 引擎主循环运行在独立 pthread，避免阻塞 UI 线程。
// ============================================================

#include <jni.h>
#include <unistd.h>
#include <pthread.h>
#include <string>
#include <cstdio>
#include <cstring>
#include <android/log.h>

#define LOG_TAG "PikafishJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// Pikafish 内部入口（来自 main.cpp 的重命名版本，见 engine_main.cpp）
//
// ⚠️ 必须带 extern "C"：engine_main.cpp 中该函数是以 extern "C" 定义的，
//    符号名为 pikafish_main；这里若只写 extern（C++ 链接），编译器会按
//    C++ 规则修饰成 _Z13pikafish_mainiPPc，与定义端对不上。
//    单独编译每个 .cpp 都不会报错，直到最后 -shared 链接才留下一个
//    未解析符号，而链接默认不报错、照样产出 .so，运行期才炸成
//    「dlopen failed: failed to link libpikafish.so」，极难排查。
//    工作流已加 -Wl,--no-undefined，此类问题今后会在链接期直接失败。
extern "C" int pikafish_main(int argc, char* argv[]);

namespace {

// inPipe:  [0] 引擎读端(=stdin)   [1] Java 写端
// outPipe: [0] Java 读端          [1] 引擎写端(=stdout)
int  inPipe[2]  = {-1, -1};
int  outPipe[2] = {-1, -1};
int  writeFd    = -1;   // Java 侧写入引擎
FILE* readStream = nullptr; // Java 侧读取引擎输出

pthread_t engineThread;
bool engineStarted = false;

// 引擎线程主体
void* engineThreadMain(void*) {
    LOGI("engine thread start");
    char  arg0[] = "pikafish";
    char* argv[] = {arg0, nullptr};
    int rc = pikafish_main(1, argv);
    LOGI("engine thread exit rc=%d", rc);
    return nullptr;
}

} // namespace

extern "C" {

// ---------------------------------------------------------
//  初始化：建立管道、重定向标准流、启动引擎线程
//  nnuePath: pikafish.nnue 的绝对路径（已从 assets 释放到 filesDir）
// ---------------------------------------------------------
JNIEXPORT jboolean JNICALL
Java_com_xiangqi_engine_PikafishBridge_nativeInit(
        JNIEnv* env, jclass, jstring nnuePath) {

    if (engineStarted) {
        LOGI("engine already started");
        return JNI_TRUE;
    }

    if (pipe(inPipe) != 0 || pipe(outPipe) != 0) {
        LOGE("pipe() failed: %s", strerror(errno));
        return JNI_FALSE;
    }

    // 把引擎的 stdin/stdout 换成管道
    if (dup2(inPipe[0],  STDIN_FILENO)  < 0 ||
        dup2(outPipe[1], STDOUT_FILENO) < 0) {
        LOGE("dup2() failed: %s", strerror(errno));
        return JNI_FALSE;
    }
    setvbuf(stdout, nullptr, _IOLBF, 4096); // 行缓冲，保证及时吐出

    writeFd    = inPipe[1];
    readStream = fdopen(outPipe[0], "r");
    if (!readStream) {
        LOGE("fdopen() failed");
        return JNI_FALSE;
    }

    // 切换工作目录到 nnue 所在目录，便于引擎按默认名加载权重
    if (nnuePath) {
        const char* p = env->GetStringUTFChars(nnuePath, nullptr);
        std::string full(p ? p : "");
        env->ReleaseStringUTFChars(nnuePath, p);
        size_t slash = full.find_last_of('/');
        if (slash != std::string::npos) {
            std::string dir = full.substr(0, slash);
            if (chdir(dir.c_str()) != 0)
                LOGE("chdir(%s) failed", dir.c_str());
            else
                LOGI("chdir -> %s", dir.c_str());
        }
    }

    if (pthread_create(&engineThread, nullptr, engineThreadMain, nullptr) != 0) {
        LOGE("pthread_create failed");
        return JNI_FALSE;
    }
    pthread_detach(engineThread);
    engineStarted = true;
    return JNI_TRUE;
}

// ---------------------------------------------------------
//  向引擎发送一条 UCI 命令（自动补换行）
// ---------------------------------------------------------
JNIEXPORT void JNICALL
Java_com_xiangqi_engine_PikafishBridge_nativeSend(
        JNIEnv* env, jclass, jstring cmd) {
    if (writeFd < 0 || !cmd) return;
    const char* c = env->GetStringUTFChars(cmd, nullptr);
    if (!c) return;
    std::string line(c);
    env->ReleaseStringUTFChars(cmd, c);
    line.push_back('\n');
    ssize_t n = write(writeFd, line.c_str(), line.size());
    if (n < 0) LOGE("write failed: %s", strerror(errno));
}

// ---------------------------------------------------------
//  阻塞读取引擎输出的一行（无数据时阻塞，需在子线程调用）
//  返回 null 表示流已结束
// ---------------------------------------------------------
JNIEXPORT jstring JNICALL
Java_com_xiangqi_engine_PikafishBridge_nativeReadLine(
        JNIEnv* env, jclass) {
    if (!readStream) return nullptr;
    char buf[8192];
    if (fgets(buf, sizeof(buf), readStream) == nullptr) return nullptr;
    // 去掉行尾换行
    size_t len = strlen(buf);
    while (len > 0 && (buf[len-1] == '\n' || buf[len-1] == '\r')) buf[--len] = '\0';
    return env->NewStringUTF(buf);
}

} // extern "C"
