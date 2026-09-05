# CI 产物下载后怎么处理

> 一句话：**下载 zip → 跑一条命令 → HBuilderX 云打包**。
> 手动摆放极易踩坑（见文末「四个坑」），建议直接用脚本。

---

## 一、先搞清楚下载到的是什么

从 GitHub 拿产物有两个入口，**下载到的东西不一样**：

| 入口 | 得到的文件 | 特点 |
|------|-----------|------|
| Actions 页面 → 某次运行 → Artifacts | `XiangqiEngine-plugin-android.zip` | **外层多套了一层 zip**（GitHub 网页下载的固有行为），里面才是真正的包 |
| Releases 页面（打 tag 触发） | `XiangqiEngine-android-release.zip` 等 | 直接就是目标包，没有外层包裹 |

安装脚本对两种情况**都能处理**，会自动识别并拆掉外层包裹，不用您手工先解一层。

### 三个产物包的用途

| 包名 | 内容 | 用在什么时候 |
|------|------|-------------|
| `XiangqiEngine-android-release.zip` | 仅 arm64-v8a | **正式发布**用这个，约 4.2MB |
| `XiangqiEngine-android-full.zip` | arm64-v8a + x86_64 | 需要跑**模拟器**调试时用，约 6.6MB |
| `XiangqiEngine-iOS.zip` | framework + 集成说明 | 打 iOS 包时用 |

---

## 二、一条命令装好（推荐）

```powershell
cd D:\projects\xiangqi

# Android
powershell -ExecutionPolicy Bypass -File scripts\install-artifact.ps1 `
  -Zip $env:USERPROFILE\Downloads\XiangqiEngine-android-release.zip

# iOS（如果要打 iOS 包）
powershell -ExecutionPolicy Bypass -File scripts\install-artifact.ps1 `
  -Zip $env:USERPROFILE\Downloads\XiangqiEngine-iOS.zip
```

脚本会自动完成：

1. 拆掉 GitHub 网页下载的外层 zip
2. 根据内容判断是 Android 还是 iOS 产物（不看文件名，防改名后认错）
3. **把 `XiangqiEngine-release` 改名为 `XiangqiEngine`** ← 关键，见坑 ①
4. 装 Android 时**保住已有的 `ios/` 目录**，反之亦然，不会互相覆盖
5. 跳过没用的中间产物 `.a` 文件
6. 装完自动跑一遍完整校验

装完看到这行就算成功：

```
RESULT: done. Open the app/ folder in HBuilderX and run cloud build.
```

### 只想检查当前状态，不装东西

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-artifact.ps1 -Verify
```

退出码 `0` = 可以打包，`1` = 有问题（可用于 CI 门禁）。

---

## 三、装完之后：HBuilderX 云打包

1. HBuilderX 打开 **`D:\projects\xiangqi\app`** 目录（注意是 `app`，不是仓库根）
2. 菜单 **发行 → 原生App-云打包**
3. 勾选 **「使用自定义基座」**（原生插件必须走这一步，标准基座里没有我们的插件）
4. Android 选「使用云端证书」即可；iOS 需要证书，见 [无Mac开发指南](%E6%97%A0Mac%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97.md)
5. 点「打包」

> **体积提醒**：云打包免费额度 **40MB**。
> 正式包约 4.2MB、完整包约 6.6MB，离额度还很远。
>
> **为什么这么小**：约 49MB 的 NNUE 权重不再打进包里，改为 App 首次启动时下载
> （见 `app/utils/nnue.js`）。官方权重 2026-07 从 12MB 涨到 49MB，若内置，
> 插件包会达 102MB 直接超额，而且官方每更新一次权重就得重新发版。
> 但如果哪天超了，先删 `android/src/main/jniLibs/x86_64/`（模拟器才用得到）。

---

## 四、四个坑（手动摆放时特别容易中）

### ① 目录名必须叫 `XiangqiEngine`，不能带 `-release`

`XiangqiEngine-android-release.zip` 解压出来的顶层目录叫 **`XiangqiEngine-release`**。

HBuilderX 是拿**目录名**去匹配 `package.json` 里的 `id` 字段的，两者不一致就完全识别不到插件 —— 而且报错信息只会说「插件不存在」，不会告诉你是名字对不上。

```
app/nativeplugins/
├── XiangqiEngine-release/   ✗ 识别不到
└── XiangqiEngine/           ✓ 必须是这个名字
```

### ② Android 包和 iOS 包要合并，不是二选一

两个 zip 装的是**同一个插件目录的不同部分**：

```
XiangqiEngine/
├── package.json          ← Android 包提供
├── android/              ← Android 包提供
└── ios/                  ← iOS 包提供
    └── XiangqiEngine.framework
```

先装 Android 再装 iOS（或反过来），**两个都要装**才能同时打双端。
直接解压覆盖会把另一端的文件删掉，脚本已处理这点。

### ③ iOS framework 不能有 `Versions/` 目录

macOS 上的 framework 用软链接组织版本。这种结构在 Windows 上解压后，**软链接会退化成几十字节的文本文件**，云打包时链接失效直接报错。

CI 里的 `make_framework.sh` 已经产出**扁平结构**规避了这点。校验时可以自己确认：

```
ios/XiangqiEngine.framework/
├── XiangqiEngine      ← 必须是 14MB 左右的真二进制
├── Info.plist
└── Headers/
```

如果那个 `XiangqiEngine` 只有几十字节，说明链接被压坏了，重新下载。脚本会自动检查并报 `[FAIL]`。

### ④ iOS 包里无需关心 `.a` 与权重

CI 已不再把编译中间产物 `.a`（约 3MB）和 NNUE 权重（约 49MB）放进产物包：
插件只需 framework 本身，权重则由 App 首次启动时下载。
若您手上是旧产物包（里面还带着这些），安装脚本会自动跳过，不会白占体积。

---

## 五、想手动摆放的话

如果不想用脚本，按这个结构放（这也是校验脚本检查的清单）：

```
app/nativeplugins/XiangqiEngine/
├── package.json
├── android/src/main/
│   ├── jniLibs/arm64-v8a/libpikafish.so        必需
│   ├── jniLibs/x86_64/libpikafish.so           模拟器才要，正式包可删
│   └── java/com/xiangqi/engine/*.java          必需，2 个文件
└── ios/
    └── XiangqiEngine.framework/                打 iOS 包才需要
```

> 注意：**不需要**放 `pikafish.nnue`。权重由 App 首次启动时下载到
> 本地可写目录，放进插件只会白白消耗 49MB 额度。

摆完务必跑一次校验，别等云打包失败了才排查：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-artifact.ps1 -Verify
```

---

## 六、常见问题

**Q：插件目录已被 gitignore，会不会丢？**
A：会。它是构建产物，不入库。换机或重新 clone 后需要重新下载产物安装，这也正是这个脚本存在的意义。现在只有 6.6MB，下载很快。详见 [本地开发环境](%E6%9C%AC%E5%9C%B0%E5%BC%80%E5%8F%91%E7%8E%AF%E5%A2%83.md)。

**Q：权重不打进包，那用户首次用会怎样？**
A：进入对局页时会弹窗提示“需下载约 49MB 引擎数据，建议 Wi-Fi”，同意后显示进度，下好即缓存，后续启动直接复用。下载源有 3 个（GitHub + 2 个国内镜像）自动回退。

**Q：不想等 CI，能本地编 Android 的 .so 吗？**
A：可以，但要装 NDK：`powershell -File native\android\build_so.ps1 -Abi arm64-v8a`。
iOS 必须靠 CI（需要 macOS）。

**Q：CI 跑完但产物里没有 framework？**
A：说明 iOS 编译失败了。`build_ios.sh` 内置了符号校验和体积断言，去 Actions 日志里看 `校验产物架构` 那一步的输出。
