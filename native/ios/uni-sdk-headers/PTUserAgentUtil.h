
#import <Foundation/Foundation.h>

@interface PTUserAgentUtil : NSObject

+ (NSString*)defaultUserAgent;
+ (void)defaultUserAgent:(void (^)(NSString * userAgent))block;
+ (NSString*)currentUserAgent;

+ (void)setUserAgent:(NSString*)value;

+ (void)setH5UserAgent;

+ (NSString*)userAgentAppendHtml5Plus:(NSString*)userAgent;
+ (NSString*)userAgentAppendStreamApp:(NSString*)userAgent;
+ (NSString*)userAgentAppendImmersed:(NSString*)userAgent;
@end
