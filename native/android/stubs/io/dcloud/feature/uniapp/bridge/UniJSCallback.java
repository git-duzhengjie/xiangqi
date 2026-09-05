// 编译校验专用桩类 —— 详见 com/alibaba/fastjson/JSONObject.java 顶部说明
package io.dcloud.feature.uniapp.bridge;

/**
 * JS 回调桩。
 *   invoke              回调一次后失效
 *   invokeAndKeepAlive  回调后保持有效，用于持续推送引擎输出
 */
public interface UniJSCallback {
    void invoke(Object data);
    void invokeAndKeepAlive(Object data);
}
