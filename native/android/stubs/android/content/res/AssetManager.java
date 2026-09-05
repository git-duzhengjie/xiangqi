// 编译校验专用桩类 —— 详见 com/alibaba/fastjson/JSONObject.java 顶部说明
package android.content.res;

import java.io.IOException;
import java.io.InputStream;

/**
 * AssetManager 桩：插件用 open() 读取 assets 内置权重。
 * 真实方法会抛 IOException，签名必须保留 throws，
 * 否则插件里的 try/catch 会被 javac 判为「捕获不可能抛出的异常」而报错。
 */
public class AssetManager {
    public InputStream open(String fileName) throws IOException {
        return null;
    }
}
