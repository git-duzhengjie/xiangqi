package android.os;

/**
 * 编译桩：仅用于本地 javac 校验，不参与打包。
 * 真实实现由 Android SDK 提供。
 */
public class Handler {
    public Handler() { }
    public Handler(Looper looper) { }
    public boolean post(Runnable r) { return true; }
}
