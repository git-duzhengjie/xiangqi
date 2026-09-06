package android.os;

/**
 * 编译桩：仅用于本地 javac 校验，不参与打包。
 * 真实实现由 Android SDK 提供。
 */
public class Looper {
    public static Looper myLooper() { return null; }
    public static Looper getMainLooper() { return null; }
}
