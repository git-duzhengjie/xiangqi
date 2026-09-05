// 编译校验专用桩类 —— 详见 com/alibaba/fastjson/JSONObject.java 顶部说明
package io.dcloud.feature.uniapp;

import android.content.Context;

/**
 * uni-app SDK 实例桩。插件通过 getContext() 取 Android Context。
 */
public class UniSDKInstance {
    public Context getContext() {
        return null;
    }
}
