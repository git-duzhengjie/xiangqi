//
//  XiangqiEngineModule.m
//  uniapp 原生插件模块（iOS）
//
//  暴露给 JS 的方法与 Android 侧保持完全一致：
//    initEngine / onOutput / send / setOptions / go / stop / newGame / dispose
//
//  本文件为 Pikafish(GPLv3) 的配套代码，以 GPLv3 提供。
//

#import "XiangqiEngineModule.h"
#import "PikafishBridge.h"

@interface XiangqiEngineModule ()
@property (nonatomic, copy) UniModuleKeepAliveCallback outputCallback;
@property (nonatomic, copy) UniModuleKeepAliveCallback bestMoveCallback;
@property (nonatomic, assign) BOOL inited;
@property (nonatomic, assign) BOOL readerRunning;
@end

@implementation XiangqiEngineModule

// 导出方法给 JS
UNI_EXPORT_METHOD(@selector(initEngine:))
UNI_EXPORT_METHOD(@selector(onOutput:))
UNI_EXPORT_METHOD(@selector(send:))
UNI_EXPORT_METHOD(@selector(setOptions:callback:))
UNI_EXPORT_METHOD(@selector(go:callback:))
UNI_EXPORT_METHOD(@selector(stop))
UNI_EXPORT_METHOD(@selector(newGame))
UNI_EXPORT_METHOD(@selector(dispose))

#pragma mark - 初始化

- (void)initEngine:(UniModuleKeepAliveCallback)callback {
    if (self.inited) {
        if (callback) callback(@{@"success": @YES, @"message": @"already initialized"}, NO);
        return;
    }

    // pikafish.nnue 作为 bundle 资源打包，读取其路径
    NSString *nnuePath = [[NSBundle mainBundle] pathForResource:@"pikafish" ofType:@"nnue"];
    if (nnuePath == nil) {
        // 兼容放在 framework bundle 内的情况
        NSBundle *fb = [NSBundle bundleForClass:[self class]];
        nnuePath = [fb pathForResource:@"pikafish" ofType:@"nnue"];
    }
    if (nnuePath == nil) {
        if (callback) callback(@{@"success": @NO, @"error": @"pikafish.nnue 未找到（请确认已加入 Bundle Resources）"}, NO);
        return;
    }

    BOOL ok = [PikafishBridge initEngineWithNnuePath:nnuePath];
    if (!ok) {
        if (callback) callback(@{@"success": @NO, @"error": @"引擎初始化失败"}, NO);
        return;
    }
    self.inited = YES;

    [self startReaderThread];

    [PikafishBridge send:@"uci"];
    [PikafishBridge send:[NSString stringWithFormat:@"setoption name EvalFile value %@", nnuePath]];
    [PikafishBridge send:@"isready"];

    if (callback) callback(@{@"success": @YES, @"nnuePath": nnuePath}, NO);
}

#pragma mark - 输出读取线程

- (void)startReaderThread {
    if (self.readerRunning) return;
    self.readerRunning = YES;

    __weak typeof(self) weakSelf = self;
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        while (weakSelf.readerRunning) {
            NSString *line = [PikafishBridge readLine];
            if (line == nil) break;
            dispatch_async(dispatch_get_main_queue(), ^{
                [weakSelf dispatchLine:line];
            });
        }
        weakSelf.readerRunning = NO;
    });
}

- (void)dispatchLine:(NSString *)line {
    if (self.outputCallback) {
        self.outputCallback(@{@"type": @"output", @"line": line}, YES);
    }

    if ([line hasPrefix:@"bestmove"]) {
        NSArray<NSString *> *parts =
            [line componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        NSMutableArray *tokens = [NSMutableArray array];
        for (NSString *t in parts) { if (t.length > 0) [tokens addObject:t]; }

        NSString *best = tokens.count > 1 ? tokens[1] : @"";
        NSString *ponder = nil;
        for (NSUInteger i = 0; i + 1 < tokens.count; i++) {
            if ([tokens[i] isEqualToString:@"ponder"]) { ponder = tokens[i+1]; break; }
        }

        UniModuleKeepAliveCallback cb = self.bestMoveCallback;
        self.bestMoveCallback = nil;
        if (cb) {
            NSMutableDictionary *res = [NSMutableDictionary dictionary];
            res[@"success"] = @(best.length > 0 && ![best isEqualToString:@"(none)"]);
            res[@"bestmove"] = best;
            if (ponder) res[@"ponder"] = ponder;
            cb(res, NO);
        }
    }
}

- (void)onOutput:(UniModuleKeepAliveCallback)callback {
    self.outputCallback = callback;
}

#pragma mark - UCI 命令

- (void)send:(NSString *)cmd {
    if (!self.inited || cmd == nil) return;
    [PikafishBridge send:cmd];
}

- (void)setOptions:(NSDictionary *)opts callback:(UniModuleKeepAliveCallback)callback {
    if (!self.inited) {
        if (callback) callback(@{@"success": @NO, @"error": @"engine not initialized"}, NO);
        return;
    }
    NSNumber *threads = opts[@"threads"];
    if (threads) [PikafishBridge send:[NSString stringWithFormat:@"setoption name Threads value %@", threads]];
    NSNumber *hash = opts[@"hash"];
    if (hash) [PikafishBridge send:[NSString stringWithFormat:@"setoption name Hash value %@", hash]];
    NSNumber *multiPv = opts[@"multiPv"];
    if (multiPv) [PikafishBridge send:[NSString stringWithFormat:@"setoption name MultiPV value %@", multiPv]];

    if (callback) callback(@{@"success": @YES}, NO);
}

- (void)go:(NSDictionary *)params callback:(UniModuleKeepAliveCallback)callback {
    if (!self.inited) {
        if (callback) callback(@{@"success": @NO, @"error": @"engine not initialized"}, NO);
        return;
    }
    self.bestMoveCallback = callback;

    NSString *fen = params[@"fen"];
    NSString *moves = params[@"moves"];

    NSMutableString *pos = [NSMutableString stringWithString:@"position "];
    if (fen.length > 0) {
        [pos appendFormat:@"fen %@", fen];
    } else {
        [pos appendString:@"startpos"];
    }
    if (moves.length > 0) {
        [pos appendFormat:@" moves %@", moves];
    }
    [PikafishBridge send:pos];

    NSNumber *depth = params[@"depth"];
    NSNumber *movetime = params[@"movetime"];
    NSMutableString *go = [NSMutableString stringWithString:@"go"];
    if (depth && depth.intValue > 0) [go appendFormat:@" depth %@", depth];
    if (movetime && movetime.intValue > 0) [go appendFormat:@" movetime %@", movetime];
    if ([go isEqualToString:@"go"]) [go appendString:@" movetime 1000"];
    [PikafishBridge send:go];
}

- (void)stop {
    if (!self.inited) return;
    [PikafishBridge send:@"stop"];
}

- (void)newGame {
    if (!self.inited) return;
    [PikafishBridge send:@"ucinewgame"];
    [PikafishBridge send:@"isready"];
}

- (void)dispose {
    if (self.inited) [PikafishBridge send:@"quit"];
    self.readerRunning = NO;
    self.outputCallback = nil;
    self.bestMoveCallback = nil;
}

@end
