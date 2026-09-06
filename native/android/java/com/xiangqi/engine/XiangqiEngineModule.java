package com.xiangqi.engine;

import android.content.Context;

import com.alibaba.fastjson.JSONObject;

import io.dcloud.feature.uniapp.annotation.UniJSMethod;
import io.dcloud.feature.uniapp.bridge.UniJSCallback;
import io.dcloud.feature.uniapp.common.UniModule;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * XiangqiEngineModule -- uniapp 原生插件（Android）
 *
 * 暴露给 JS 的方法：
 *   initEngine(options, callback)     初始化引擎
 *                                     options.nnuePath 可指定外部权重文件；
 *                                     不传则回退到 assets 内置权重。
 *   send(cmd)                         发送任意 UCI 命令
 *   setDifficulty(level)              设置难度
 *   go(fen, moves, opts, callback)    计算最佳着法
 *   stop()                            中断计算
 *   dispose()                         释放
 *
 * 引擎输出通过 keepAlive 的 callback 持续推给 JS。
 *
 * 本文件为 Pikafish(GPLv3) 的配套代码，以 GPLv3 提供。
 */
public class XiangqiEngineModule extends UniModule {

    private static final String NNUE_NAME = "pikafish.nnue";

    private final AtomicBoolean mInited = new AtomicBoolean(false);
    private final AtomicBoolean mReaderRunning = new AtomicBoolean(false);

    /** 持有 JS 回调，用于持续推送引擎输出 */
    private UniJSCallback mOutputCallback;
    /** 当前一次 go 的回调，收到 bestmove 后回调一次 */
    private UniJSCallback mBestMoveCallback;

    private Thread mReaderThread;

    // ------------------------------------------------------------
    //  初始化
    // ------------------------------------------------------------
    @UniJSMethod(uiThread = false)
    public void initEngine(JSONObject options, UniJSCallback callback) {
        JSONObject res = new JSONObject();

        if (!PikafishBridge.isLoaded()) {
            res.put("success", false);
            res.put("error", "libpikafish.so 加载失败: " + PikafishBridge.getLoadError());
            invoke(callback, res);
            return;
        }

        if (mInited.get()) {
            res.put("success", true);
            res.put("message", "already initialized");
            invoke(callback, res);
            return;
        }

        Context ctx = getAppContext();
        if (ctx == null) {
            res.put("success", false);
            res.put("error", "context is null");
            invoke(callback, res);
            return;
        }

        try {
            // 1) 解析权重文件路径
            //    优先用 JS 层传入的外部路径（运行时下载到本地的权重），
            //    没传或文件无效时回退到 assets 内置权重。
            //    这样做是因为官方权重在 2026-07 已涨到约 49MB，内置会超出
            //    HBuilderX 云打包 40MB 免费额度，故改为首次启动下载。
            File nnue = resolveNnue(ctx, options);
            if (nnue == null) {
                res.put("success", false);
                res.put("error", "nnue not available: 未传入有效 nnuePath，且 assets 内也没有内置权重");
                res.put("needDownload", true);
                invoke(callback, res);
                return;
            }

            // 2) 初始化 native 引擎
            boolean ok = PikafishBridge.nativeInit(nnue.getAbsolutePath());
            if (!ok) {
                res.put("success", false);
                res.put("error", "nativeInit failed");
                invoke(callback, res);
                return;
            }

            mInited.set(true);

            // 3) 启动输出读取线程
            startReaderThread();

            // 4) 先把初始化结果回给 JS，再发 UCI 命令。
            //
            //    顺序不能反。原先是先发 uci 再 invoke(callback)，而引擎收到
            //    uci 会立刻回吐上百行 "option name ..."，读取线程随即从一个
            //    裸 Java 线程高频调用 invokeAndKeepAlive 冲击 JS 桥；这股洪流
            //    会把后面这个尚未投递的 init 回调挤掉，JS 侧于是永远等不到
            //    initEngine 的结果，界面一直停在「引擎加载中：启动引擎」，
            //    最终只能等超时。先回调就不存在这个竞争。
            res.put("success", true);
            res.put("nnuePath", nnue.getAbsolutePath());
            res.put("nnueSize", nnue.length());
            invoke(callback, res);

            // 5) UCI 握手 + 指定权重文件（此时回调已安全送达）
            PikafishBridge.nativeSend("uci");
            PikafishBridge.nativeSend("setoption name EvalFile value " + nnue.getAbsolutePath());
            PikafishBridge.nativeSend("isready");

        } catch (Exception e) {
            res.put("success", false);
            res.put("error", "init exception: " + e.getMessage());
            invoke(callback, res);
        }
    }

    /**
     * 解析最终使用的权重文件。
     *
     * 优先级：
     *   1. options.nnuePath 指向的外部文件（JS 层运行时下载得到）
     *   2. assets 内置的 pikafish.nnue（开发阶段或小权重时才会打进去）
     *   3. 都没有则返回 null，由调用方告知 JS 层需要下载
     *
     * @return 可用的权重文件；无可用权重时返回 null
     */
    private File resolveNnue(Context ctx, JSONObject options) {
        // ---- 1) 外部路径 ----
        if (options != null) {
            // 注意：这里的 JSONObject 是 com.alibaba.fastjson.JSONObject，
            // 它只有 getString(key)，没有 Android org.json 里的
            // optString(key, fallback)；写成 optString 会直接编译失败，
            // 导致整个插件类无法生成、requireNativePlugin 拿到 null。
            String p = options.getString("nnuePath");
            if (p != null && p.length() > 0) {
                // uni-app 侧可能传 file:// 前缀或 _doc/ 等逻辑路径，
                // 这里只接受已转成系统绝对路径的形式。
                if (p.startsWith("file://")) {
                    p = p.substring(7);
                }
                File ext = new File(p);
                // 权重至少数 MB，用 1MB 做下限可拦住“下载中断产生的碎片文件”，
                // 避免把残文件交给引擎导致 exit(EXIT_FAILURE) 直接闪退。
                if (ext.exists() && ext.isFile() && ext.length() > 1024L * 1024L) {
                    return ext;
                }
            }
        }

        // ---- 2) assets 内置 ----
        try {
            return extractNnue(ctx);
        } catch (IOException e) {
            // assets 里没打包权重时会走到这里，属于预期情况，不当作错误
            return null;
        }
    }

    /**
     * 从 assets 释放 pikafish.nnue 到 filesDir。
     * 已存在且大小一致则跳过，避免每次启动都拷贝数十 MB。
     */
    private File extractNnue(Context ctx) throws IOException {
        File out = new File(ctx.getFilesDir(), NNUE_NAME);

        long assetSize = -1;
        try {
            InputStream probe = ctx.getAssets().open(NNUE_NAME);
            assetSize = probe.available();
            probe.close();
        } catch (IOException ignored) {
        }

        if (out.exists() && assetSize > 0 && out.length() == assetSize) {
            return out; // 已释放过
        }

        InputStream in = ctx.getAssets().open(NNUE_NAME);
        OutputStream os = new FileOutputStream(out);
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            os.write(buf, 0, n);
        }
        os.flush();
        os.close();
        in.close();
        return out;
    }

    // ------------------------------------------------------------
    //  引擎输出读取线程
    // ------------------------------------------------------------
    private void startReaderThread() {
        if (mReaderRunning.get()) return;
        mReaderRunning.set(true);

        mReaderThread = new Thread(new Runnable() {
            @Override
            public void run() {
                while (mReaderRunning.get()) {
                    String line = PikafishBridge.nativeReadLine();
                    if (line == null) break;   // 流结束
                    dispatchLine(line);
                }
                mReaderRunning.set(false);
            }
        }, "pikafish-reader");
        mReaderThread.setDaemon(true);
        mReaderThread.start();
    }

    /**
     * 引擎启动时会一次性回吐上百行 "option name ..."，这些是 UCI 能力
     * 声明，JS 侧完全用不到。若逐行跨桥推送，会在初始化瞬间制造一波
     * 回调洪流，既拖慢启动，也容易把同期其它回调挤掉。直接在 Java 侧
     * 拦掉，只放行真正有用的输出。
     */
    private static boolean isNoiseLine(String line) {
        return line.startsWith("option name")
            || line.startsWith("id name")
            || line.startsWith("id author")
            || line.startsWith("Pikafish ");
    }

    /** 分发引擎输出：bestmove 单独回调，其余走 output 流 */
    private void dispatchLine(String line) {
        // 1) 推给通用输出监听（info/score 等）
        if (mOutputCallback != null && !isNoiseLine(line)) {
            JSONObject o = new JSONObject();
            o.put("type", "output");
            o.put("line", line);
            mOutputCallback.invokeAndKeepAlive(o);
        }

        // 2) bestmove 触发一次性回调
        if (line.startsWith("bestmove")) {
            String[] parts = line.trim().split("\\s+");
            String best = parts.length > 1 ? parts[1] : "";
            String ponder = null;
            for (int i = 0; i < parts.length - 1; i++) {
                if ("ponder".equals(parts[i])) { ponder = parts[i + 1]; break; }
            }
            UniJSCallback cb = mBestMoveCallback;
            mBestMoveCallback = null;
            if (cb != null) {
                JSONObject o = new JSONObject();
                o.put("success", !best.isEmpty() && !"(none)".equals(best));
                o.put("bestmove", best);
                if (ponder != null) o.put("ponder", ponder);
                cb.invoke(o);
            }
        }
    }

    /** 注册引擎输出监听（keepAlive） */
    @UniJSMethod(uiThread = false)
    public void onOutput(UniJSCallback callback) {
        mOutputCallback = callback;
    }

    // ------------------------------------------------------------
    //  UCI 命令
    // ------------------------------------------------------------
    @UniJSMethod(uiThread = false)
    public void send(String cmd) {
        if (!mInited.get() || cmd == null) return;
        PikafishBridge.nativeSend(cmd);
    }

    /**
     * 设置难度。
     * 注意：Pikafish 沿用新版 Stockfish，已移除 Skill Level 选项，
     * 因此难度通过 depth / movetime / MultiPV 组合来控制，
     * 低难度的"拟人化"由 JS 侧从 MultiPV 候选中随机挑选实现。
     */
    @UniJSMethod(uiThread = false)
    public void setOptions(JSONObject opts, UniJSCallback callback) {
        JSONObject res = new JSONObject();
        if (!mInited.get()) {
            res.put("success", false);
            res.put("error", "engine not initialized");
            invoke(callback, res);
            return;
        }
        if (opts != null) {
            Integer threads = opts.getInteger("threads");
            if (threads != null) {
                PikafishBridge.nativeSend("setoption name Threads value " + threads);
            }
            Integer hash = opts.getInteger("hash");
            if (hash != null) {
                PikafishBridge.nativeSend("setoption name Hash value " + hash);
            }
            Integer multiPv = opts.getInteger("multiPv");
            if (multiPv != null) {
                PikafishBridge.nativeSend("setoption name MultiPV value " + multiPv);
            }
        }
        res.put("success", true);
        invoke(callback, res);
    }

    /**
     * 让引擎计算最佳着法。
     * @param params { fen, moves(空格分隔的 UCI 着法), depth, movetime }
     */
    @UniJSMethod(uiThread = false)
    public void go(JSONObject params, UniJSCallback callback) {
        if (!mInited.get()) {
            JSONObject res = new JSONObject();
            res.put("success", false);
            res.put("error", "engine not initialized");
            invoke(callback, res);
            return;
        }

        mBestMoveCallback = callback;

        String fen = params != null ? params.getString("fen") : null;
        String moves = params != null ? params.getString("moves") : null;

        StringBuilder pos = new StringBuilder("position ");
        if (fen != null && !fen.isEmpty()) {
            pos.append("fen ").append(fen);
        } else {
            pos.append("startpos");
        }
        if (moves != null && !moves.trim().isEmpty()) {
            pos.append(" moves ").append(moves.trim());
        }
        PikafishBridge.nativeSend(pos.toString());

        Integer depth = params != null ? params.getInteger("depth") : null;
        Integer movetime = params != null ? params.getInteger("movetime") : null;

        StringBuilder go = new StringBuilder("go");
        if (depth != null && depth > 0) go.append(" depth ").append(depth);
        if (movetime != null && movetime > 0) go.append(" movetime ").append(movetime);
        if (go.length() == 2) go.append(" movetime 1000"); // 兜底
        PikafishBridge.nativeSend(go.toString());
    }

    /** 中断当前计算，引擎会立即吐出 bestmove */
    @UniJSMethod(uiThread = false)
    public void stop() {
        if (!mInited.get()) return;
        PikafishBridge.nativeSend("stop");
    }

    /** 新对局，清空置换表 */
    @UniJSMethod(uiThread = false)
    public void newGame() {
        if (!mInited.get()) return;
        PikafishBridge.nativeSend("ucinewgame");
        PikafishBridge.nativeSend("isready");
    }

    @UniJSMethod(uiThread = false)
    public void dispose() {
        if (mInited.get()) {
            PikafishBridge.nativeSend("quit");
        }
        mReaderRunning.set(false);
        mOutputCallback = null;
        mBestMoveCallback = null;
    }

    // ------------------------------------------------------------
    //  工具方法
    // ------------------------------------------------------------
    private Context getAppContext() {
        if (mUniSDKInstance != null && mUniSDKInstance.getContext() != null) {
            return mUniSDKInstance.getContext().getApplicationContext();
        }
        return null;
    }

    private void invoke(UniJSCallback cb, JSONObject data) {
        if (cb != null) cb.invoke(data);
    }
}
