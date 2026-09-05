// 编译校验专用桩类 —— 详见 com/alibaba/fastjson/JSONObject.java 顶部说明
package android.content;

import android.content.res.AssetManager;
import java.io.File;

/**
 * Android Context 桩，仅保留插件用到的方法。
 * CI 环境没有 android.jar，故用桩替代。
 */
public class Context {
    public Context getApplicationContext() {
        return null;
    }

    public File getFilesDir() {
        return null;
    }

    public AssetManager getAssets() {
        return null;
    }
}
