//
//  H5PUIFeatureError.h
//  libNativeUI
//
//  Created by X on 15/7/27.
//  Copyright (c) 2015年 DCloud. All rights reserved.
//

#import <Foundation/Foundation.h>

@interface H5PUIUserTip : NSObject
+ (void)showFeatureNotFound:(NSString*)name;
+ (void)showFeatureNotPermission:(NSString*)name;
+ (void)showFeatureNotSupport:(NSString*)name;
@end
