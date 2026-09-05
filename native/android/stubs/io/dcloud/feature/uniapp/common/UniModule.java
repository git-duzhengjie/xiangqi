// 编译校验专用桩类 —— 详见 com/alibaba/fastjson/JSONObject.java 顶部说明
package io.dcloud.feature.uniapp.common;

import io.dcloud.feature.uniapp.UniSDKInstance;

/**
 * uni-app 原生插件 Module 基类桩。
 * 真实类来自 uniapp-v8-release.aar（DCloud 官方网盘分发，未上 maven）。
 *
 * 关键点：mUniSDKInstance 是 protected 字段，插件通过它拿 Context。
 */
public class UniModule {
    protected UniSDKInstance mUniSDKInstance;
}
