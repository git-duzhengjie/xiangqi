# 无 Mac 电脑开发指南

> 面向**只有 Windows 电脑**的开发者，完成 Android + iOS 双端打包。

核心思路：**把需要 Mac 的工作交给 GitHub Actions 的 macOS 机器，把打包交给 DCloud 云端。**
您本地只需要 HBuilderX。

---

## 结论速览

| 环节 | 需要 Mac？ | 解决方案 | 费用 |
|------|-----------|---------|------|
| 编译 Android `.so` | ❌ | GitHub Actions（Linux） | 免费 |
| 编译 iOS `.a` / framework | ✅ 原本需要 | **GitHub Actions（macOS runner）** | 免费 |
| Android 云打包 | ❌ | HBuilderX 云打包 | 免费（<40MB） |
| iOS 云打包 | ❌ | HBuilderX 云打包 | 免费（<40MB） |
| iOS 证书申请 | ❌ | Windows 上用 OpenSSL 生成 CSR | 需 Apple 开发者账号 $99/年 |
| iOS 真机安装 | ❌ | TestFlight 或 Ad Hoc | 免费 |

**为什么 macOS runner 免费？** GitHub 官方文档明确说明：

> GitHub Actions usage is **free** for **public repositories** that use standard GitHub-hosted runners.

本仓库是公开仓库，因此 macOS runner 不限分钟数、完全免费。
（私有仓库则 macOS 按 **10 倍** 费率计费，务必注意。）

---

## 一、Android 全流程（最简单，全程 Windows）

### 1. 用 CI 编译引擎库

不必本地装 NDK。打开仓库 → **Actions** → **Build Android Engine** → **Run workflow**。

约 10–20 分钟后，在运行结果页下载产物：

- `XiangqiEngine-plugin-android` → 内含两个 zip
  - `XiangqiEngine-android-full.zip`（含 x86_64 模拟器库，约 26MB）
  - `XiangqiEngine-android-release.zip`（**仅 arm64，约 4.2MB，正式发布用**）

CI 已自动做了两项校验，失败会直接红灯：
- ELF 架构是否正确（AArch64 / x86-64）
- 4 个 JNI 符号是否完整导出（漏导出会在运行时才报 `UnsatisfiedLinkError`，极难排查）

### 2. 放入项目

解压后把 `XiangqiEngine/` 整个目录放到：

```
app/nativeplugins/XiangqiEngine/
```

### 3. HBuilderX 配置插件

1. HBuilderX 打开 `app/` 目录
2. 双击 `manifest.json` → 左侧 **App 原生插件配置**
3. 点 **选择本地插件** → 勾选 `XiangqiEngine`

### 4. 云打包

菜单 **发行** → **原生App-云打包**：

- Android 包名：自定义，如 `com.yourname.xiangqi`
- 证书：首次可选「使用DCloud老版证书」快速测试；正式发布需自有证书
- 打包类型：**正式包**（或先打自定义调试基座验证）

> **提示**：「制作自定义调试基座」走的也是云端，同样免费，不需要本地 Android 环境。

### 5. 体积控制

云打包免费额度为 **40MB**，超出后 40–100MB 每次 10 元。

| 配置 | 体积 |
|------|------|
| 完整包（双 ABI） | 约 6.6MB |
| **正式包（仅 arm64）** | **约 4.2MB** ✅ |

发布前请确认：
- 删除 `android/libs/x86_64/`（模拟器调试用，正式包不需要）
- NNUE 权重不入包，App 首次启动时下载（官方权重已涨至约 49MB）

---

## 二、iOS 全流程（关键：借 CI 的 Mac）

### 1. 用 CI 编译 framework

Actions → **Build iOS Engine** → **Run workflow**。

CI 在 macOS runner 上完成原本需要 Xcode 手工做的全部事：
- 编译真机 arm64 与模拟器静态库
- 组装 `XiangqiEngine.framework`（含 Info.plist、modulemap、Headers）
- 不嵌入 `pikafish.nnue`（权重改为运行时下载）
- 校验架构与符号

下载产物 `XiangqiEngine-iOS.zip`。

### 2. ⚠️ Windows 解压 framework 的坑

**这是最容易踩的问题。**

DCloud 官方明确说明：Windows 上提交含 `.framework` 的 iOS 本地插件云打包**会失败**，
因为 framework 内部的**软链接**在 Windows 解压后会变成普通文本文件而失效。

本项目的 framework 特意采用了 **iOS 扁平结构**（不含 `Versions/Current` 软链接），
规避了这个问题。但仍需注意：

- ✅ 用 **7-Zip** 或 Windows 自带解压，**不要**用某些会破坏权限的工具
- ✅ 解压后确认 `XiangqiEngine.framework/XiangqiEngine` 是**二进制文件**（约 14MB），
  而不是几十字节的文本文件
- ❌ 如果它变成了小文本文件，说明软链接被破坏，需换解压工具重试

验证命令（Windows PowerShell）：

```powershell
Get-Item .\XiangqiEngine.framework\XiangqiEngine | Select-Object Length
# 期望：Length 约 14000000（14MB 左右）
# 如果只有几十字节 → 软链接已损坏
```

### 3. 放入项目

```
app/nativeplugins/XiangqiEngine/ios/XiangqiEngine.framework
```

`package.json` 已配置好 `embedFrameworks`，无需改动。

### 4. 申请 iOS 证书（Windows 上完成）

需要 **Apple 开发者账号（$99/年）**。这是 Apple 的硬性要求，无法绕过。

传统做法是在 Mac 的「钥匙串访问」里生成 CSR，但 Windows 上用 OpenSSL 同样可以：

```bash
# 1) 生成私钥
openssl genrsa -out ios_dev.key 2048

# 2) 生成 CSR（Common Name 与邮箱填您的信息）
openssl req -new -key ios_dev.key -out ios_dev.csr \
  -subj "/emailAddress=your@email.com/CN=Your Name/C=CN"
```

3) 登录 [developer.apple.com](https://developer.apple.com/account/resources/certificates) →
   Certificates → `+` → 选择 **iOS Distribution** → 上传 `ios_dev.csr` → 下载 `ios_distribution.cer`

4) 转换为 HBuilderX 需要的 `.p12`：

```bash
# cer 转 pem
openssl x509 -inform DER -in ios_distribution.cer -out ios_dist.pem

# 合成 p12（会要求设置密码，务必记住，云打包时要填）
openssl pkcs12 -export -inkey ios_dev.key -in ios_dist.pem -out ios_dist.p12
```

5) 在 Apple 后台创建 **App ID** 与 **Provisioning Profile**（`.mobileprovision`），下载备用

> **Windows 上的 OpenSSL**：Git for Windows 自带（`C:\Program Files\Git\usr\bin\openssl.exe`），
> 或用 `winget install ShiningLight.OpenSSL`。

### 5. iOS 云打包

**发行** → **原生App-云打包** → iOS：

- 证书文件：上一步的 `.p12`
- 证书密码：设置的密码
- profile 文件：`.mobileprovision`
- Bundle ID：与 App ID 一致

### 6. 装到 iPhone 上

无 Mac 也能安装：

| 方式 | 说明 |
|------|------|
| **TestFlight**（推荐） | 上传到 App Store Connect，通过 TestFlight 邀请测试。Windows 上可用 [Transporter 网页版](https://appstoreconnect.apple.com) 或第三方工具上传 |
| **Ad Hoc** | 打包时选 Ad Hoc，profile 中登记设备 UDID，用爱思助手等工具安装 ipa |

---

## 三、常见问题

### Q：提示「原生插件不可用」

说明运行在**标准基座**上。原生插件必须用自定义基座或正式包。
回到 HBuilderX：运行 → 运行到手机 → **制作自定义调试基座**，完成后
运行 → **运行时是否使用自定义基座** 选「是」。

### Q：Android 报 `UnsatisfiedLinkError`

JNI 符号名与 Java 类的**包名/类名/方法名**必须严格对应。
若您改了 `PikafishBridge` 的包名或类名，必须同步修改
`native/android/jni/pikafish_jni.cpp` 中的导出函数名，
否则运行时才会暴露。CI 的符号校验步骤可提前拦住这类问题。

### Q：引擎不走棋 / 一直「思考中」

排查顺序：
1. 首次进入对局页是否弹出“下载引擎数据”弹窗并完成下载（约 49MB）
2. 下载失败时会自动尝试 2 个国内镜像，均失败才报错
3. 查看日志中 `initEngine` 的返回：若 `needDownload` 为 true 则权重不可用

### Q：为什么不支持 32 位 ARM（armeabi-v7a）？

中国象棋棋盘 9×10 = 90 格，Bitboard 需 128 位整数（`unsigned __int128`），
32 位 ARM 无此类型，Pikafish 官方同样不提供 32 位构建。
影响可忽略：Google Play 早已强制 64 位，2019 年后机型基本均为 arm64。

### Q：能否完全不用 GitHub Actions？

Android 可以（本地装 NDK r27+，跑 `native/android/build_so.ps1`）。
**iOS 不行** —— 编译 iOS 二进制必须有 macOS + Xcode，这是 Apple 的工具链限制。
除 CI 外的替代方案只有：借用他人 Mac、租云端 Mac（如 MacinCloud）、或黑苹果。
CI 方案是唯一免费且合规的路径。

---

## 四、GPLv3 合规提醒

本项目内置 Pikafish（GPLv3），因传染性要求整体以 GPLv3 开源。分发时须：

1. 提供完整源码获取途径（本仓库地址）
2. 保留 Pikafish 原始版权与许可声明
3. 随二进制附带 `LICENSE`
4. 衍生作品同样以 GPLv3 发布

> **App Store 风险**：GPLv3 与 App Store 分发条款存在已知冲突（VLC 曾因此下架）。
> 整体开源可缓解，但上架前建议自行评估或咨询法务。
