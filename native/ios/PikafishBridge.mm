//
//  PikafishBridge.mm
//  Pikafish 引擎 iOS 桥接层（Objective-C++）
//
//  设计与 Android 侧一致：
//    iOS 沙箱同样不允许 fork/exec 子进程，因此把 Pikafish 编译进
//    静态库，用 pipe() + dup2() 把 UCI 的 stdin/stdout 重定向到
//    内存管道，引擎主循环跑在独立 pthread。
//
//  本文件为 Pikafish(GPLv3) 的配套代码，以 GPLv3 提供。
//

#import "PikafishBridge.h"
#import <unistd.h>
#import <pthread.h>
#import <string>

// 引擎入口（native/android/jni/engine_main.cpp，iOS 复用同一文件）
extern "C" int pikafish_main(int argc, char* argv[]);

static int  gInPipe[2]  = {-1, -1};
static int  gOutPipe[2] = {-1, -1};
static int  gWriteFd    = -1;
static FILE* gReadStream = nullptr;
static bool gStarted = false;

static void* engineThreadMain(void*) {
    char  arg0[] = "pikafish";
    char* argv[] = {arg0, nullptr};
    pikafish_main(1, argv);
    return nullptr;
}

@implementation PikafishBridge

+ (BOOL)initEngineWithNnuePath:(NSString *)nnuePath {
    if (gStarted) return YES;

    if (pipe(gInPipe) != 0 || pipe(gOutPipe) != 0) {
        NSLog(@"[Pikafish] pipe() failed");
        return NO;
    }
    if (dup2(gInPipe[0], STDIN_FILENO) < 0 || dup2(gOutPipe[1], STDOUT_FILENO) < 0) {
        NSLog(@"[Pikafish] dup2() failed");
        return NO;
    }
    setvbuf(stdout, nullptr, _IOLBF, 4096);

    gWriteFd = gInPipe[1];
    gReadStream = fdopen(gOutPipe[0], "r");
    if (!gReadStream) {
        NSLog(@"[Pikafish] fdopen() failed");
        return NO;
    }

    // 切到权重所在目录，便于引擎按默认名加载
    if (nnuePath.length > 0) {
        NSString *dir = [nnuePath stringByDeletingLastPathComponent];
        chdir([dir UTF8String]);
    }

    pthread_t tid;
    if (pthread_create(&tid, nullptr, engineThreadMain, nullptr) != 0) {
        NSLog(@"[Pikafish] pthread_create failed");
        return NO;
    }
    pthread_detach(tid);
    gStarted = YES;
    return YES;
}

+ (void)send:(NSString *)cmd {
    if (gWriteFd < 0 || cmd == nil) return;
    std::string line([cmd UTF8String]);
    line.push_back('\n');
    write(gWriteFd, line.c_str(), line.size());
}

+ (NSString *)readLine {
    if (!gReadStream) return nil;
    char buf[8192];
    if (fgets(buf, sizeof(buf), gReadStream) == nullptr) return nil;
    size_t len = strlen(buf);
    while (len > 0 && (buf[len-1] == '\n' || buf[len-1] == '\r')) buf[--len] = '\0';
    return [NSString stringWithUTF8String:buf];
}

+ (BOOL)isStarted {
    return gStarted;
}

@end
