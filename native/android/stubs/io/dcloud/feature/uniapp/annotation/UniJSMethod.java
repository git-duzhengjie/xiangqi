// 编译校验专用桩类 —— 详见 com/alibaba/fastjson/JSONObject.java 顶部说明
package io.dcloud.feature.uniapp.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 导出方法给 JS 调用的注解桩。
 * uiThread = false 表示在非 UI 线程执行（引擎计算必须如此，否则卡界面）。
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface UniJSMethod {
    boolean uiThread() default true;
}
