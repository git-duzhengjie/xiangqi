//
//  UniPluginProtocol.h
//  libWeex
//
//  Created by 4Ndf on 2018/11/30.
//  Copyright © 2018年 DCloud. All rights reserved.
//
#import <UIKit/UIApplication.h>
@protocol UniPluginProtocol <NSObject>

@optional

-(void)onCreateUniPlugin NS_SWIFT_NAME(onCreate());

- (BOOL)application:(UIApplication *_Nullable)application didFinishLaunchingWithOptions:(NSDictionary<UIApplicationLaunchOptionsKey, id> *_Nullable)launchOptions NS_SWIFT_NAME(applicationDidFinishLaunchingWithOptions(_:_:));
- (void)didRegisterForRemoteNotificationsWithDeviceToken:(NSData *_Nullable)deviceToken NS_SWIFT_NAME(didRegisterForRemoteNotifications(_:));
- (void)didFailToRegisterForRemoteNotificationsWithError:(NSError *_Nullable)error NS_SWIFT_NAME(didFailToRegisterForRemoteNotifications(_:));
- (void)didReceiveRemoteNotification:(NSDictionary *_Nullable)userInfo NS_SWIFT_NAME(didReceiveRemoteNotification(_:));
- (void)didReceiveLocalNotification:(UILocalNotification *_Nullable)notification NS_SWIFT_NAME(didReceiveLocalNotification(_:));
- (BOOL)application:(UIApplication *_Nullable)application handleOpenURL:(NSURL *_Nullable)url NS_SWIFT_NAME(applicationHandleOpenURL(_:_:));
- (BOOL)application:(UIApplication *_Nullable)app openURL:(NSURL *_Nonnull)url options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *_Nullable)options NS_AVAILABLE_IOS(9_0) NS_SWIFT_NAME(applicationOpenURLOptions(_:_:_:));

- (void)applicationWillResignActive:(UIApplication *_Nullable)application NS_SWIFT_NAME(applicationWillResignActive(_:));
- (void)applicationDidBecomeActive:(UIApplication *_Nullable)application NS_SWIFT_NAME(applicationDidBecomeActive(_:));
- (void)applicationDidEnterBackground:(UIApplication *_Nullable)application NS_SWIFT_NAME(applicationDidEnterBackground(_:));
- (void)applicationWillEnterForeground:(UIApplication *_Nullable)application NS_SWIFT_NAME(applicationWillEnterForeground(_:));

- (void)applicationMain:(int)argc argv:(char * _Nullable [_Nonnull])argv NS_SWIFT_NAME(applicationMain(_:_:));

- (BOOL)application:(UIApplication *_Nullable)application continueUserActivity:(NSUserActivity *_Nullable)userActivity restorationHandler:(void(^_Nullable)(NSArray * __nullable restorableObjects))restorationHandler API_AVAILABLE(ios(8.0)) NS_SWIFT_NAME(applicationContinueUserActivityRestorationHandler(_:_:_:));

@end

