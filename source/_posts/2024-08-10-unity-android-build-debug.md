---
title: Unity Android 构建与调试(APK 签名 / IL2CPP / HybridCLR / CICD)
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - Unity
  - Android
  - IL2CPP
  - HybridCLR
  - CICD
  - 调试
categories:
  - [Unity, Android 与构建]
comments: true
---

> 这一章把 Unity 在 Android 平台发布相关的知识整合到一起:从 APK 签名、Android Studio 配置、Google 登录接入,到 IL2CPP 与 Mono 的差别、HybridCLR 热更、GitLab CI/CD 自动构建、Logcat 调试、闪退问题定位。看完能解释"为什么我的 Release 包打不开"和"线上闪退怎么定位"。

## 一、Unity 与 Android 集成基础

### 1.1 Android Studio 与 SDK

Unity 打 Android 包需要:
- **JDK**:Java Development Kit(8 / 11 / 17,看 Unity 版本)
- **Android SDK**:Platform、Build Tools
- **NDK**:C++ 编译(IL2CPP 需要)
- **Gradle**:构建系统

Unity Hub 默认会装好这些,但偶尔要手动指定路径(Preferences → External Tools)。

### 1.2 Manifest 与 Unity

`AndroidManifest.xml` 是 Android 应用的元信息清单,定义:
- 包名 / 版本号 / 权限
- 入口 Activity
- 屏幕方向、主题等

Unity 默认会生成 Manifest(在 `Plugins/Android/AndroidManifest.xml`),也可以放自定义的覆盖:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.company.game">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <application android:label="@string/app_name" android:icon="@drawable/app_icon">
        <activity android:name="com.unity3d.player.UnityPlayerActivity"
                  android:label="@string/app_name"
                  android:screenOrientation="landscape">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

### 1.3 Unity 与 Java 互调

```csharp
// Unity 调 Java
using (AndroidJavaClass jc = new AndroidJavaClass("com.company.game.Utils"))
using (AndroidJavaObject jo = jc.CallStatic<AndroidJavaObject>("getInstance"))
{
    jo.Call("showToast", "Hello from Unity");
}

// Java 调 Unity(从 Java 代码)
// UnityPlayer.UnitySendMessage("GameManager", "OnJavaCallback", "data");
```

详见 [Unity 调用 Java 代码](https://www.cnblogs.com/cyct/p/java.html)。

<!-- more -->

## 二、APK 签名

### 2.1 Keystore 生成

```bash
keytool -genkey -v -keystore user.keystore -alias mykey -keyalg RSA -keysize 2048 -validity 36500
```

参数说明:
- `-keystore`:keystore 文件路径
- `-alias`:别名(后续签名引用)
- `-keyalg RSA`:RSA 算法
- `-keysize 2048`:密钥长度
- `-validity 36500`:有效期(100 年,够用)

### 2.2 在 Unity 中使用

Player Settings → Android → Publishing Settings:
- Project Keystore → Browse → 选 .keystore 文件
- 输入密码
- Project Key → 选 alias
- 输入 alias 密码

签名后 APK 才能上架 Google Play / 国内商店。

### 2.3 查看签名信息

```bash
keytool -keystore user.keystore -list -v
```

输出包括:
- 别名
- 创建日期
- Entry type
- Certificate fingerprints(MD5 / SHA1 / SHA256),Google 登录等需要 SHA1

### 2.4 Google 登录的 SHA1

Google 登录需要在 Google Cloud Console 配置 OAuth Client,填入 APK 签名的 SHA1。debug 和 release 用的 SHA1 不同,要分别配置:

```bash
# debug keystore 默认在 ~/.android/debug.keystore
keytool -keystore debug.keystore -list -v -storepass android
```

详见 [Unity 接入 Google 登录](https://blog.csdn.net/qq_39940718/article/details/130029503)。

## 三、Mono vs IL2CPP

### 3.1 两种 Scripting Backend

| 维度 | Mono | IL2CPP |
|---|---|---|
| 实现 | JIT(Desktop / Android)+ Full AOT(iOS,受限) | IL → C++ → 编译成本地代码 |
| 启动速度 | 快 | 略慢(首次编译) |
| 运行速度 | 中等 | 较快(2-3 倍) |
| 包体 | 小 | 大(C++ 代码) |
| 热更新 | 友好(可加载 DLL) | 不友好 |
| iOS 支持 | 不支持(必须 IL2CPP) | 支持 |
| 反编译 | 容易 | 困难 |
| 内存 | 较多(GC) | 较少 |

Unity 2019+ iOS 强制 IL2CPP,Android 默认 Mono 但推荐 IL2CPP(性能 + 防反编译)。

### 3.2 IL2CPP 的"代价"

- 编译慢(C++ 编译)
- 包体增加(每个平台一份 native lib)
- 调试难(C# 异常栈可能丢失)
- 增量编译支持差

### 3.3 性能对比

```text
.NET Core   比 C++ 慢 2 倍
Mono        比 .NET Core 慢 3 倍
IL2CPP      比 Mono 快 2-3 倍,与 .NET Core 相当,比 C++ 慢 2 倍
Burst       比 C++ 更快(限制场景)
```

### 3.4 AAB vs APK

| 维度 | APK | AAB(Android App Bundle) |
|------|-----|------|
| 文件 | 单个安装包 | 上传 Google Play 的中间格式 |
| 大小 | 全设备一份 | Google Play 按设备生成优化 APK |
| 资源 | 全部打包 | 按密度 / ABI 切分 |
| 上架 | 国内商店 | Google Play 2021 起强制 |

**AAB 好处**:
- 用户下载的 APK 只含他设备需要的部分(不下载其他 ABI 的 .so、其他分辨率的图)
- 通常节省 30-50% 下载体积
- Dynamic Feature 模块化按需下载

**Unity 切换**:Player Settings → Android → Build → 选 `.aab` 或 `.apk`。

国内商店(华为 / 小米 / 应用宝 / vivo / oppo)目前仍以 APK 为主,出包时要分别构建。

### 3.5 ABI Split:ARM64 / ARMv7 / x86

| ABI | 用途 |
|-----|------|
| `arm64-v8a`(ARM64) | **必须**,现代 Android(2019+)主力 |
| `armeabi-v7a`(ARMv7) | 老 32 位设备,可选 |
| `x86` / `x86_64` | 模拟器调试用 |

**Google Play 2019 起强制 64 位**,`arm64-v8a` 必须勾。同时勾 `armeabi-v7a` 会增加包体(每个 native 库都要双份)。

```csharp
// 只 arm64(最小包)
PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;

// arm64 + armv7(兼容老设备)
PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64 | AndroidArchitecture.ARMv7;
```

**用 AAB 时不用操心 ABI**:Google Play 自动按设备切分,用户只下载匹配的 .so。出 APK 时才需要在脚本里指定。

### 3.6 ProGuard / R8:Java 代码混淆

IL2CPP 已经把 C# 编译成 native,但接入的原生 SDK(广告 / 推送 / Google 登录)仍含 Java 代码。Release 包建议开混淆,防反编译 + 减小 Java 体积。

Player Settings → Android → Publishing Settings → **Minify**:
- `None`:不混淆(debug 用)
- `Gradle (ProGuard)`:经典混淆器
- `Gradle (R8)`:Google 新一代(默认推荐)

自定义规则 `proguard-user.txt`(放 `Assets/Plugins/Android/`):

```text
-keep class com.company.game.** { *; }   # 保留自己写的类
-dontwarn com.google.android.gms.**      # 不警告 Google Play Services 缺失类
-keep class com.unity3d.** { *; }         # 保留 Unity Java 桥
```

> 混淆后 Native SDK 反射调用的类(如某些广告 SDK)容易跑崩,**Release 测试必须开混淆跑一遍**再上架。

## 四、HybridCLR:零成本热更新

### 4.1 痛点

IL2CPP 不能热更(全 AOT)。其他热更方案(xLua / toLua / ILRuntime)要么学习成本高,要么性能差。

### 4.2 HybridCLR 思路

把 IL2CPP 改成"AOT + 解释"混合:
- AOT 部分:引擎核心代码,IL2CPP 编译成 native
- 解释部分:业务代码,运行时解释执行 IL

业务代码用纯 C# 写,不需要 Lua。性能接近 IL2CPP AOT。

### 4.3 集成流程

```text
1. 安装 HybridCLR Unity Package
2. Player Settings → 启用 IL2CPP
3. HybridCLR Installer(自动下载源码编译)
4. HybridCLR Settings:配置 AOT 程序集列表
5. 编译时:补充元数据(AOT 程序集的 dll)
6. 加载热更 dll:Assembly.Load(dllBytes)
7. 调用热更代码:Type.GetMethod / Activator.CreateInstance
```

详见 [HybridCLR 详解](https://blog.csdn.net/q764424567/article/details/124835067)。

### 4.4 HybridCLR vs toLua

| 维度 | HybridCLR | toLua / xLua |
|---|---|---|
| 语言 | C# | Lua |
| 学习成本 | 低 | 中 |
| 性能 | 接近 IL2CPP AOT | 中等(Lua 解释器) |
| 调试 | C# 标准 | Lua 调试器弱 |
| 生态 | 新(2021+) | 成熟 |
| 出包 | 复杂(首次设置) | 简单 |

新项目优先 HybridCLR。

## 五、自动构建

### 5.1 BuildPlayer API

```csharp
[MenuItem("Build/Android Release")]
public static void BuildAndroid()
{
    string[] scenes = EditorBuildSettings.scenes
        .Where(s => s.enabled)
        .Select(s => s.path)
        .ToArray();

    var options = new BuildPlayerOptions
    {
        scenes = scenes,
        locationPathName = "Builds/Android/release.aab",
        target = BuildTarget.Android,
        options = BuildOptions.None
    };

    // 设置 keystore
    PlayerSettings.Android.useCustomKeystore = true;
    PlayerSettings.Android.keystoreName = "user.keystore";
    PlayerSettings.Android.keystorePass = "xxx";
    PlayerSettings.Android.keyaliasName = "mykey";
    PlayerSettings.Android.keyaliasPass = "xxx";

    // IL2CPP
    PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
    PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;

    BuildPipeline.BuildPlayer(options);
}
```

详见 [Unity 自动构建](http://t.csdnimg.cn/Ehw0c)。

### 5.2 命令行构建

```bash
Unity.exe -batchmode -quit \
    -projectPath . \
    -executeMethod BuildMenu.BuildAndroid \
    -logFile build.log
```

无界面跑 Unity,适合 CI。

### 5.3 GitLab CI/CD

`.gitlab-ci.yml`:

```yaml
stages:
  - build

unity-android:
  stage: build
  image: unityci/editor:2022.3.10f1-android-2.0.0
  script:
    - /opt/Unity/Editor/Unity -batchmode -quit -projectPath . -executeMethod BuildMenu.BuildAndroid -logFile build.log
    - cp Builds/Android/release.aab $CI_PROJECT_DIR/
  artifacts:
    paths:
      - release.aab
  only:
    - main
```

Unity 官方有 docker 镜像 `unityci/editor`,跑 CI 时按 tag 触发构建。

详见 [GitLab CI/CD Unity](http://t.csdnimg.cn/HPwMz)。

## 六、Android 真机调试

### 6.1 Logcat

```bash
# 连接设备
adb devices

# 实时看日志
adb logcat

# 过滤 Unity
adb logcat -s Unity ActivityManager PackageManager

# 保存日志
adb logcat -v time > game.log
```

### 6.2 Unity 真机调试

```text
1. Build Settings 勾选 Development Build
2. 勾选 Script Debugging
3. Build & Run(连 USB)
4. Unity → Window → General → Debugger
5. 选中设备上的 Player → 双击 attach
```

可以打断点、查看变量。

### 6.3 Android Studio 调试

```text
1. Build & Run 后,Unity 启动 Android 进程
2. Android Studio → Run → Attach to Process
3. 选 com.company.game 进程
```

详见 [Unity Android 真机断点调试](https://gwb.tencent.com/community/detail/120287)。

## 七、闪退问题定位

### 7.1 闪退错误信号

```text
FATAL SIGNAL 11 (SIGSEGV) at 0x00000008
```

SIGSEGV = 内存访问错误(空指针 / 越界)。

### 7.2 还原错误栈

闪退日志里的 `#00 pc 006d4960 /data/app/.../libunity.so` 是 PC(程序计数器)地址,**用 addr2line 还原成函数名**:

```bash
arm-linux-androideabi-addr2line -f -C -e libunity.sym.so 0043a05c 006d4c0c
```

输出:

```text
UnityEngine_Player_get_position
Player_Update
```

需要 Symbols:
- Unity 的 `libunity.so` 符号表在 Unity 安装目录的 PlaybackEngines 下
- IL2CPP 的 `libil2cpp.so` 符号表在每次打包后生成(`Temp/StagingArea/libs/`)

### 7.3 自动拷贝 IL2CPP 符号

```csharp
[PostProcessBuild]
public static void OnPostprocessBuild(BuildTarget target, string path)
{
    if (target != BuildTarget.Android) return;

    var backend = PlayerSettings.GetScriptingBackend(BuildTargetGroup.Android);
    if (backend != ScriptingImplementation.IL2CPP) return;

    string symbolsDir = Path.GetDirectoryName(path) + "/" +
                        Path.GetFileNameWithoutExtension(path) + "_IL2CPPSymbols";
    Directory.CreateDirectory(symbolsDir);

    string sourceArm = Application.dataPath + "/../Temp/StagingArea/libs/armeabi-v7a/libil2cpp.so.debug";
    if (File.Exists(sourceArm))
    {
        Directory.CreateDirectory(symbolsDir + "/armeabi-v7a/");
        File.Copy(sourceArm, symbolsDir + "/armeabi-v7a/libil2cpp.so.debug");
    }
}
```

详见 [Unity Android 闪退定位](https://blog.csdn.net/jacklin_001/article/details/104654192)。

### 7.4 QA 提交闪退日志

QA 测试闪退时,可以让他们跑一个 bat 提取日志:

```bat
@echo off
set adb="%~dp0\adb.exe"
%adb% logcat -v time -d > crash_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%.log
```

放在桌面快捷方式,闪退后双击就能拿到完整 logcat。

### 7.5 应用层异常上报

```csharp
void Awake()
{
    Application.logMessageReceived += OnLogMessage;
}

void OnLogMessage(string condition, string stackTrace, LogType type)
{
    if (type == LogType.Exception || type == LogType.Error)
    {
        // 上报到 Fabric / Bugly / Sentry
        BugReporter.Report(condition + "\n" + stackTrace);
    }
}
```

部分闪退会先在 Unity 层抛异常,这里能拦截上报。

## 八、SRDebugger:运行时调试

### 8.1 SRDebugger 是什么

第三方库,运行时显示调试面板:
- FPS / Memory 实时图
- 所有 GameObject 树
- Console 日志(带过滤)
- 任意字段监控
- 一键触发方法

### 8.2 集成

```text
1. Asset Store / GitHub 下载 SRDebugger
2. Import
3. SRDebugger Init 自动挂载
4. 运行后默认按三指点击屏幕打开 / 或快捷键
```

代码控制:

```csharp
using SRF.Service;

// 监控变量
SRDebug.Instance.AddValue("Player HP", () => player.hp);
SRDebug.Instance.AddValue("Enemy Count", () => enemies.Count);

// 添加按钮
SRDebug.Instance.AddOption(new SROptions.Option("Full Heal", () => player.hp = 100));

// 主动打开
SRDebug.Instance.Show();
```

详见 [Unity 插件 SRDebugger](https://blog.csdn.net/qq_33677553/article/details/122240170)。

## 九、微信小游戏适配

### 9.1 中文字无法显示

发布到微信小游戏后,动态字体(默认 ttf)在某些场景下不工作。解决:
1. 把字体内置成静态字体(`Font.FontData`,预生成所有字符位图)
2. 用 TextMeshPro 配合自建 TMP_FontAsset(把所有用到的字符预烘焙)
3. 小游戏内置字体库,运行时加载

详见 [Unity 微信小游戏中文字](https://blog.csdn.net/linxinfa/article/details/123681974)。

### 9.2 平台宏

```csharp
#if UNITY_WEIXINMINIGAME
    // 微信小游戏专属代码
#elif UNITY_ANDROID
    // Android
#elif UNITY_IOS
    // iOS
#endif
```

## 十、构建清单

发布 Android 前的 Checklist:

```text
[ ] Player Settings:
    - Company / Product Name
    - Version / Bundle Version Code
    - Default Icon
    - Minimum API Level
    - Target Architectures(arm64 必须,armv7 可选)
    - Scripting Backend(IL2CPP)
    - API Compatibility Level
    - Strip Engine Code(开)
    - Managed Stripping Level(High)
[ ] Keystore 配置正确
[ ] Internet / 权限申请
[ ] SDK 接入完毕(广告 / 内购 / 推送)
[ ] Google 登录 SHA1 配置
[ ] Manifest 自定义项
[ ] 资源压缩(Texture / Audio)
[ ] 签名验证
[ ] 多设备测试(小米 / 华为 / 鸿蒙 / vivo / oppo)
[ ] 闪退日志采集(Bugly / Fabric)
```

## 参考

- [Mono vs IL2CPP](https://zhuanlan.zhihu.com/p/352463394)
- [HybridCLR 官方文档](https://hybridclr.doc.code-philosophy.com/)
- [Unity 自动构建详解](http://t.csdnimg.cn/Ehw0c)
- [Unity Android 真机调试](https://gwb.tencent.com/community/detail/120287)
- [Unity Android 闪退定位](https://blog.csdn.net/jacklin_001/article/details/104654192)

---

下一篇:[Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/) — 整合快捷键、撕纸效果、空格换行、MVC/MVP、qFramework、UIToolkit、SLG 项目经验等。

## 系列目录

1. [Unity 生命周期、MonoBehaviour 与场景管理](/2024/08/10/unity-lifecycle-mono-scene/)
2. [Unity UGUI 基础组件](/2024/08/10/unity-ugui-basics/)
3. [Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/)
4. [Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/)
5. [Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/)
6. [Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/)
7. [Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. Unity Android 构建与调试(本篇)
10. [Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/)
