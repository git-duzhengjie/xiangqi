//
//  DCUniBridge.h
//  libPDRCore
//
//  Created by DCloud-iOS-XHY on 2023/3/28.
//  Copyright © 2023 DCloud. All rights reserved.
//
/**
  用于暴露 swift 库中需要调用基础库中的方法
 **/

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
NS_ASSUME_NONNULL_BEGIN

@interface DCUniBridge : NSObject

+ (NSString *)getAppId;

+ (NSString *)getDataPath;

+ (BOOL)isUniMp;

+ (NSString *)getAppName;

+ (NSString *)getAppTheme;

+ (NSString *)getAppVersion;

+ (NSString *)getAppVersionCode;

+ (NSString *)getOsLanguage;

+ (NSString *)getAppWgtVersion;

+ (NSDictionary *)getUniMPData;

+ (NSString *)getInnerVersion;

+ (NSDictionary *)getSystemSetting;

+ (NSDictionary *)getAppAuthorizeSetting;

+ (NSString *)getRuntimeVersion;

+ (NSString *)getCompileVersion;

+ (NSNumber *)getStatusBarHeight;

+ (NSDictionary *)getSafeAreaInsets;

+ (NSDictionary *)getWindowInfo;

+ (NSString *)getCookieString:(NSURL *)url;

+ (void)lockScreen;

+ (void)unlockScreen;

+ (void)setFullScreen:(BOOL)fullScreen;

+ (void)setHomeIndicatorAutoHidden:(BOOL)isHidden;

+ (void)setTempOrientation:(UIInterfaceOrientationMask)temp;

+ (BOOL)configSupportOrientation:(UIInterfaceOrientation)orientation;

+ (void)setDeviceInterfaceOrientation:(UIInterfaceOrientation)toOrientation;

+ (UIInterfaceOrientationMask)getSupportOrientation;

- (void)loadImage:(NSString *)url complete:(void(^)(UIImage * __nullable,NSData * __nullable))complete;

/// 获取应用运行目录
+ (NSString *)getWorkRootPath;


+ (BOOL)isBaseIpa;

+ (void)registerHookClass:(NSString * __nullable)classname;

+ (NSString *)getGgbsForIos15;

+ (BOOL)isRoot;

+ (NSString*)getChannel;

+ (void)setPrivacyAgree:(BOOL)isAgree;

+ (BOOL)isPrivacyAgree;

+ (NSNumber *)onPrivacyAgreeChange:(void(^)(BOOL))callback;

+ (void)offPrivacyAgreeChange:(NSNumber *)callbackId;

@end

NS_ASSUME_NONNULL_END
