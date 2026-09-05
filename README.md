# 中国象棋 · Xiangqi

> 基于 uniapp 的单机中国象棋手机游戏，AI 采用专业开源引擎 **Pikafish**（皮卡鱼）。

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

---

## 特性

- **专业引擎棋力** —— 内置 Pikafish（NNUE 神经网络），当前最强开源中国象棋引擎
- **纯离线单机** —— 引擎完整运行在本地，无需联网，无广告无内购
- **7 档难度** —— 从「入门」到「棋神」，含低难度拟人化处理
- **完整规则** —— 马腿、象眼、炮翻山、兵过河、白脸将、困毙判负
- **中文记谱** —— 自动生成「炮二平五」式棋谱，支持悔棋与引擎提示
- **原生渲染** —— canvas 绘制棋盘，含楚河汉界与九宫斜线

---

## 平台支持

| 平台 | 状态 | 说明 |
|------|------|------|
| Android arm64-v8a | ✅ 已编译验证 | 主要目标平台 |
| Android x86_64 | ✅ 已编译验证 | 模拟器调试 |
| Android armeabi-v7a | ❌ 不支持 | 见下方说明 |
| iOS arm64 | ⚠️ 源码就绪 | 需在 macOS 上编译 |
| 小程序 / H5 | ❌ 不支持 | 原生插件依赖 |

> **为什么不支持 32 位 ARM？**
> 中国象棋棋盘为 9×10 = 90 格，Bitboard 需要 128 位整数（`unsigned __int128`），
> 而 32 位 ARM 无此类型。Pikafish 官方同样不提供 32 位构建。
> 影响可忽略：Google Play 早已强制 64 位，2019 年后机型基本均为 arm64。

---

## 项目结构

```
xiangqi/
├── app/                          # uniapp 前端工程
│   ├── pages/
│   │   ├── index/index.vue       # 首页（难度选择）
│   │   └── game/                 # 对局页（组件/脚本/样式分离）
│   │       ├── game.vue
│   │       ├── game.js
│   │       └── game.css
│   ├── utils/
│   │   ├── constants.js          # 坐标系、FEN、UCI 互转、难度表
│   │   ├── rules.js              # 象棋规则引擎（走法/将军/绝杀/记谱）
│   │   └── engine.js             # Pikafish 封装（Promise + 拟人化）
│   ├── nativeplugins/
│   │   └── XiangqiEngine/        # 原生插件（需先构建，见下文）
│   ├── manifest.json
│   └── pages.json
│
├── native/
│   ├── android/
│   │   ├── jni/
│   │   │   ├── pikafish_jni.cpp  # JNI 桥接（管道重定向 UCI）
│   │   │   └── engine_main.cpp   # 引擎入口（替代原 main.cpp）
│   │   ├── java/                 # PikafishBridge / XiangqiEngineModule
│   │   └── build_so.ps1          # Android 编译脚本
│   └── ios/
│       ├── PikafishBridge.h/.mm  # iOS 桥接层
│       ├── XiangqiEngineModule.h/.m
│       └── build_ios.sh          # iOS 编译脚本（macOS 执行）
│
├── scripts/
│   └── fetch-engine.ps1          # 拉取引擎源码与权重
│
├── tests/
│   ├── test_rules.mjs            # 规则引擎单测（28 项）
│   └── test_sim.mjs              # 端到端模拟对局
│
└── LICENSE                       # GPL-3.0
```

---

## 快速开始

> **只有 Windows 电脑？** 看 [无 Mac 开发指南](docs/%E6%97%A0Mac%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97.md) ——
> 用 GitHub Actions 的 macOS 机器编 iOS 库（公开仓库免费），本地只需 HBuilderX。

### 方式 A：用 CI 构建（推荐，无需本地 NDK / Xcode）

| 工作流 | 产物 | 运行环境 |
|--------|------|---------|
| **Build Android Engine** | `libpikafish.so` 双 ABI + 已组装插件包 | Linux |
| **Build iOS Engine** | `XiangqiEngine.framework` + 静态库 | macOS |

仓库 → **Actions** → 选对应工作流 → **Run workflow**，完成后下载产物即可。

CI 已内置两道校验：ELF 架构正确性、JNI 符号完整导出（后者漏了会在运行时才报
`UnsatisfiedLinkError`，极难排查）。

### 方式 B：本地构建

#### 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 18 | 运行测试脚本 |
| HBuilderX | 最新版 | uniapp 打包 |
| Android NDK | **r27c+** | 编译引擎（官方要求） |
| Android SDK | API 34 | 打包 |
| Xcode | ≥ 14 | iOS 编译（仅 macOS） |

### 第 1 步：拉取引擎源码与权重

引擎源码与 NNUE 权重（约 12MB）不入库，需先获取：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fetch-engine.ps1
```

产出 `engine-src/` 与 `pikafish.nnue`。

### 第 2 步：编译 Android 引擎库

编辑 `native/android/build_so.ps1`，把 `$NDK` 改成你的 NDK 路径，然后：

```powershell
powershell -ExecutionPolicy Bypass -File native\android\build_so.ps1 -Abi arm64-v8a
powershell -ExecutionPolicy Bypass -File native\android\build_so.ps1 -Abi x86_64
```

成功输出 `BUILD_OK arm64-v8a size=2.4MB`，产物在 `build/<abi>/libpikafish.so`。

### 第 3 步：组装原生插件

把产物与权重放进插件目录：

```
app/nativeplugins/XiangqiEngine/
└── android/src/main/
    ├── jniLibs/arm64-v8a/libpikafish.so
    ├── jniLibs/x86_64/libpikafish.so
    ├── assets/pikafish.nnue
    └── java/com/xiangqi/engine/*.java
```

### 第 4 步：打包运行

原生插件**无法在标准基座中使用**，必须制作自定义基座：

1. HBuilderX 打开 `app/` 目录
2. 菜单 → 运行 → 运行到手机 → **制作自定义调试基座**
3. 选择「传统打包」，勾选 Android
4. 打包完成后，运行 → 运行到手机 → **运行时选择自定义基座**

> 若提示「原生插件不可用」，说明仍在用标准基座，请回到第 4 步。

---

## iOS 构建

**必须在 macOS + Xcode 环境完成**（Windows 无法交叉编译 iOS）。

```bash
chmod +x native/ios/build_ios.sh
./native/ios/build_ios.sh
```

产出 `build/ios/libpikafish-device.a` 与 `libpikafish-sim.a`。之后在 Xcode 中：

1. 新建 Cocoa Touch Framework 项目 `XiangqiEngine`
2. 加入 `native/ios/` 下的 `.h/.m/.mm` 与上一步的 `.a`
3. 把 `pikafish.nnue` 加入 **Bundle Resources**
4. Build Settings → Other Linker Flags 添加 `-lc++`
5. 导出 `XiangqiEngine.framework` 至 `app/nativeplugins/XiangqiEngine/ios/`

---

## 技术实现要点

### 为什么不能「释放可执行文件 + 起子进程」

这是集成 UCI 引擎最常见的错误做法，在移动端不可行：

- **Android 10+** 强制 W^X（Write XOR Execute），禁止执行应用私有目录下的可执行文件
- **iOS 沙箱** 不允许 `fork`/`exec` 子进程

### 实际方案：静态库 + 管道重定向

```
JS 层 (engine.js)
   ↕ uni.requireNativePlugin
原生模块 (XiangqiEngineModule)
   ↕ JNI / ObjC
桥接层 (pikafish_jni.cpp / PikafishBridge.mm)
   ↕ pipe() + dup2()
Pikafish UCI 主循环（独立线程）
```

把引擎编译进 `.so`/`.a`，用 `pipe()` 创建内存管道，`dup2()` 将引擎的
`stdin`/`stdout` 重定向到管道两端，引擎主循环跑在独立线程，
上层通过 `send()` / `readLine()` 收发 UCI 协议消息。

### 关键编译参数

```
-DIS_64BIT           # 启用 u128，象棋 90 格 Bitboard 必需（缺失会编译失败）
-DUSE_NEON=8         # arm64 NEON 向量化
-DUSE_POPCNT         # 硬件 popcount
-DNNUE_EMBEDDING_OFF # 权重外部加载，不嵌入二进制
-DZSTD_DISABLE_ASM=1 # x86_64 专用：zstd 汇编文件不参与构建
```

### 低难度拟人化

Pikafish 沿用新版 Stockfish，**已移除 `Skill Level` 选项**。
仅靠限制搜索深度会导致「大部分走得极强、偶尔突然送子」，很不像人。

`engine.js` 的处理方式：低难度开启 `MultiPV` 取多个候选着法，
按难度概率随机选择次优着（入门 75%、简单 50%、普通 25%、困难 10%），
并用分值容差过滤掉会立即丢大子的走法。

---

## 测试

```bash
node tests/test_rules.mjs   # 规则引擎单测
node tests/test_sim.mjs     # 端到端模拟对局
```

已验证结果：

- **规则单测 28/28 通过**，含关键基准：开局红方合法走法数 = **44**（象棋界公认值）
- **端到端 20 局 / 5285 步**，UCI 往返、中文记谱、局面裁决零失败

---

## 开源许可

本项目采用 **GPL-3.0** 许可证。

内置的 [Pikafish](https://github.com/official-pikafish/Pikafish) 引擎同为 GPLv3。
根据 GPLv3 传染性要求，本应用整体以 GPLv3 开源。

**分发时的义务：**

1. 提供完整源码获取途径（本仓库地址）
2. 保留 Pikafish 原始版权与许可声明
3. 随二进制附带 `LICENSE` 文件
4. 衍生作品同样以 GPLv3 发布

> **App Store 提示**：GPLv3 与 App Store 分发条款存在已知冲突（VLC 曾因此下架）。
> 本项目整体开源可缓解该问题，但上架前建议自行评估或咨询法务。

---

## 致谢

- [Pikafish](https://github.com/official-pikafish/Pikafish) —— 最强开源中国象棋引擎
- [uni-app](https://uniapp.dcloud.net.cn/) —— 跨平台应用框架
