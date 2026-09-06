// 编译校验专用桩类 —— 详见 com/alibaba/fastjson/JSONObject.java 顶部说明
package io.dcloud.feature.uniapp.common;

/**
 * uni-app 原生插件 Module 基类桩。
 * 真实实现来自 uniapp-v8-release.aar（DCloud 官方随包分发，未上 maven）。
 *
 * ⚠️ 这里【故意不声明】mUniSDKInstance 字段。
 *
 * 原先桩类里写了 `protected UniSDKInstance mUniSDKInstance;`，于是业务代码
 * 里 `mUniSDKInstance.getContext()` 本地编译畅通无阻，装到真机却直接抛：
 *
 *   java.lang.NoSuchFieldError: No instance field mUniSDKInstance
 *     of type Lio/dcloud/feature/uniapp/UniSDKInstance;
 *     in class Lcom/xiangqi/engine/XiangqiEngineModule;
 *
 * 说明该字段并不在真实 UniModule 基类上。桩类比真实 SDK 多给了一个字段，
 * 等于替编译器背书了一个运行时不存在的东西 —— 校验反而成了自我欺骗，
 * 白白多耗了三轮排查。
 *
 * 结论：桩类只能比真实 SDK「少」，绝不能「多」。业务侧请用反射获取
 * Context（见 XiangqiEngineModule.getAppContext）。
 */
public class UniModule {
}
