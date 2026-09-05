// ============================================================
//  编译校验专用桩类（stub）—— 不参与打包，仅供 CI 做 javac 类型检查
//
//  背景：
//    uni-app 原生插件依赖的 Android SDK（DCloud 官方仅通过网盘分发，
//    未上传 maven），CI 环境拿不到 uniapp-v8-release.aar，
//    因此无法用真实 SDK 编译插件源码。
//
//  后果（已实际踩坑）：
//    XiangqiEngineModule.java 里曾误用 fastjson 不存在的
//    options.optString(key, fallback)（那是 Android org.json 的 API），
//    这是编译期错误，但因为「云打包才编译、本地无任何检查」，
//    错误一路溜到真机上，表现为 requireNativePlugin 返回 null、
//    提示「原生插件未加载」，排查成本极高。
//
//  方案：
//    用最小桩类复刻插件用到的 SDK / fastjson / Android API 签名，
//    让 CI 能用纯 javac 编译插件源码，把 API 误用挡在提交阶段。
//
//  ⚠️ 约束：
//    1. 本目录仅用于编译校验，绝不能打进插件包（package.json 不引用）。
//    2. 桩方法签名必须与真实 SDK 严格一致，否则校验会失真。
//       fastjson 签名依据官方 1.2.83 源码 JSONObject.java 核对。
//    3. 新增用到的 SDK API 时，需同步在此补桩，否则 CI 会编译失败。
// ============================================================

package com.alibaba.fastjson;

import java.util.HashMap;

/**
 * fastjson JSONObject 桩类。
 * 签名对照 fastjson 1.2.83 官方源码，仅保留插件用到的方法。
 *
 * 特别注意：真实 fastjson 只有 getString(String)，
 * 没有 optString(String, String)，不要在此添加不存在的方法，
 * 否则会把真实的编译错误掩盖掉。
 */
public class JSONObject extends HashMap<String, Object> {

    public JSONObject() {
        super();
    }

    /** 对应真实签名：public String getString(String key) */
    public String getString(String key) {
        return null;
    }

    /** 对应真实签名：public Integer getInteger(String key) */
    public Integer getInteger(String key) {
        return null;
    }

    /** 对应真实签名：public Boolean getBoolean(String key) */
    public Boolean getBoolean(String key) {
        return null;
    }

    /** 对应真实签名：public Long getLong(String key) */
    public Long getLong(String key) {
        return null;
    }

    /** 对应真实签名：public JSONObject getJSONObject(String key) */
    public JSONObject getJSONObject(String key) {
        return null;
    }
}
