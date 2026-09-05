//
//  UIViewController+DCExtend.h
//  libPDRCore
//
//  Created by XHY on 2019/12/27.
//  Copyright © 2019 DCloud. All rights reserved.
//
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface UIViewController (DCExtend)

// 获取当前显示的 UIViewController
+ (UIViewController *)dc_findCurrentShowingViewController;

@end

NS_ASSUME_NONNULL_END
