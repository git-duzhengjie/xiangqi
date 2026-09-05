package com.xiangqi.engine;

/**
 * PikafishBridge -- libpikafish.so 的 JNI 声明层
 *
 * 【重要】本类的包名+类名+方法名必须与 native/android/jni/pikafish_jni.cpp
 * 中的导出符号严格对应：
 *   Java_com_xiangqi_engine_PikafishBridge_nativeInit
 *   Java_com_xiangqi_engine_PikafishBridge_nativeSend
 *   Java_com_xiangqi_engine_PikafishBridge_nativeReadLine
 * 修改包名/类名需同步修改 C++ 侧函数名，否则运行时报
 * UnsatisfiedLinkError。
 *
 * 本文件为 Pikafish(GPLv3) 的配套桥接代码，以 GPLv3 提供。
 */
public final class PikafishBridge {

    private static boolean sLoaded = false;
    private static String sLoadError = null;

    static {
        try {
            System.loadLibrary("pikafish");
            sLoaded = true;
        } catch (Throwable t) {
            sLoaded = false;
            sLoadError = t.getMessage();
        }
    }

    private PikafishBridge() {}

    /** .so 是否加载成功 */
    public static boolean isLoaded() {
        return sLoaded;
    }

    public static String getLoadError() {
        return sLoadError;
    }

    /**
     * 初始化引擎：建立管道、重定向 stdin/stdout、启动引擎线程
     * @param nnuePath pikafish.nnue 的绝对路径
     * @return 是否成功
     */
    public static native boolean nativeInit(String nnuePath);

    /** 发送一条 UCI 命令（内部自动补换行） */
    public static native void nativeSend(String cmd);

    /**
     * 阻塞读取引擎输出的一行。
     * 【必须在子线程调用】，否则会卡死 UI。
     * @return 一行输出；null 表示流结束
     */
    public static native String nativeReadLine();
}
