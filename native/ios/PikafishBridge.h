//
//  PikafishBridge.h
//  Pikafish 引擎 iOS 桥接层接口
//  GPLv3
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface PikafishBridge : NSObject

/// 初始化引擎：建立管道、重定向标准流、启动引擎线程
/// @param nnuePath pikafish.nnue 的绝对路径（bundle 内资源路径）
+ (BOOL)initEngineWithNnuePath:(NSString *)nnuePath;

/// 发送一条 UCI 命令（内部自动补换行）
+ (void)send:(NSString *)cmd;

/// 阻塞读取一行引擎输出（必须在子线程调用），nil 表示流结束
+ (nullable NSString *)readLine;

/// 引擎是否已启动
+ (BOOL)isStarted;

@end

NS_ASSUME_NONNULL_END
