//
//  PTPathUtil.h
//  DCUniBase
//
//  Created by lizhongyi on 2022/12/3.
//

@interface PTPathUtil : NSObject

/// @brief转化H5+路径到系统路径
+ (NSString *)absolutePath:(NSString *)relativePath;

/// 转化H5资源路径到系统路径
/// - Parameters:
///   - path: h5路径
///   - basePath: 指定的基础路径
+ (NSString*) h5Path2SysPath:(NSString*)path basePath:(NSString*)basePath;
@end
