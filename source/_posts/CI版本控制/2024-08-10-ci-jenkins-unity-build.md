---
title: Jenkins 自动化打包:Unity iOS / Android 全流程
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - Jenkins
  - Unity
  - CI
  - 打包
  - 工程化
categories:
  - [工程化, CI]
comments: true
---

> 这一篇把《Jenkins 安装》《Jenkins 打包细则》《本地打包》三篇笔记整合,讲清 Jenkins 搭建、Unity 命令行打包参数、Android / iOS 出包流程以及踩坑记录。

## 一、为什么用 Jenkins

手打出包有几个痛点:
- 美术 / 策划改完资源要找程序打包,程序被打断
- 出包前要 AB 包、改版本号、签名、上传,步骤多容易漏
- 多分支并行(测试服 / 体验服 / 正式服)容易出包错版本
- 出包记录没法追溯,出问题不知道是谁打的

Jenkins 这种 CI 工具的价值就是:**把出包流程脚本化,任何人点一下按钮就能出包,所有产物有记录、可追溯**。

<!-- more -->

## 二、环境准备

### JDK 11

Jenkins 必须依赖 JDK,推荐 JDK 11:

```
C:\Program Files\Java\jdk-11\
```

配置 `JAVA_HOME` 环境变量,Jenkins 启动时会读。

### Jenkins 安装(Windows)

1. 下载 [jenkins.io](https://www.jenkins.io/) 的 Windows 安装包
2. 安装时选择端口(默认 8080,可改 9090)
3. 安装完成后服务自启,浏览器访问 `http://localhost:9090/`
4. 首次启动会要求输入初始密码,密码在 `C:\Users\<用户>\.jenkins\secrets\initialAdminPassword`
5. 选择"安装推荐插件",耐心等待

### Windows 家庭版坑

家庭版 Windows 缺少本地策略组组件,装 Jenkins 服务时会失败。**用管理员身份运行下面这个 bat**,把策略组补上:

```bat
@echo off
pushd "%~dp0"
dir /b %SystemRoot%\servicing\Packages\Microsoft-Windows-GroupPolicy-ClientExtensions-Package~3*.mum >List.txt
dir /b %SystemRoot%\servicing\Packages\Microsoft-Windows-GroupPolicy-ClientTools-Package~3*.mum >>List.txt
for /f %%i in ('findstr /i . List.txt 2^>nul') do dism /online /norestart /add-package:"%SystemRoot%\servicing\Packages\%%i"
pause
```

装完 `cmd` 里跑 `secpol.msc` 打开策略组,把 Jenkins 服务的登录账号设为有密码的本地账户(不是开机 PIN,是账户密码)。

`services.msc` 查看服务运行状态,账号密码错了服务起不来。

## 三、Unity 出包:命令行参数全集

Unity 编辑器本质是个可执行文件,可以用命令行参数驱动,**不弹窗、不依赖 GUI**,这是 Jenkins 调用的核心。

### 最小打开命令

```bash
"F:\Unity\2019.4.12f1\Editor\Unity.exe" -projectPath "G:\UnityDemo\EveryThingDemo"
```

### 自动出包命令

```bash
"F:\Unity\2019.4.12f1\Editor\Unity.exe" \
    -projectPath "G:\UnityDemo\EveryThingDemo" \
    --version:%_version% \
    --reDialog:%_reDialog% \
    --window:%_window% \
    -executeMethod BuildEditor.%_target% \
    -quit -batchmode
```

`BuildEditor.Android` 是自己写的 Editor 类的静态方法,通过反射执行打包逻辑。

### 完整参数表

| 参数 | 作用 |
|---|---|
| `-batchmode` | 无 GUI 批处理模式,异常立即退出码 1 |
| `-quit` | 命令执行完退出(否则 Unity 留在编辑器界面) |
| `-projectPath <path>` | 打开指定项目 |
| `-logFile <path>` | 日志写到文件,排查问题用 |
| `-executeMethod <Class.Method>` | 启动后调用静态方法 |
| `-buildWindowsPlayer <path>` | 直接出 Windows 包 |
| `-buildOSXPlayer <path>` | 出 Mac 包 |
| `-importPackage <path>` | 导入 unitypackage,不弹对话框 |
| `-exportPackage <src> <out>` | 导出 unitypackage |
| `-createProject <path>` | 新建空项目 |
| `-nographics` | 不初始化显卡(服务器无 GPU 时用) |
| `-force-opengl` | 强制 OpenGL 渲染 |
| `-single-instance` | 只允许一个实例运行 |
| `-popupwindow` | 弹出窗口(无边框) |
| `-adapter N` | 指定显示器 |
| `-nolog` | 不产生 output_log.txt |
| `-assetServerUpdate <ip:port proj user pass>` | 强制更新 AssetServer 资源 |

### Editor 打包方法示例

```csharp
// Assets/Editor/BuildEditor.cs
public class BuildEditor
{
    public static void Android()
    {
        string[] scenes = Directory.GetFiles("Assets/Scenes", "*.unity")
                                   .Select(p => "Assets/Scenes/" + Path.GetFileName(p))
                                   .ToArray();

        BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = scenes,
            locationPathName = $"Build/Android/game_{PlayerSettings.bundleVersion}.apk",
            target = BuildTarget.Android,
            options = BuildOptions.None
        });
    }

    public static void iOS() { /* 类似,target = BuildTarget.iOS */ }
    public static void Windows() { /* ... */ }
}
```

## 四、Android 出包流程

### 前置:打 AssetBundle

打包前先打 AB(否则 APK 缺资源):

```
Tool → Package → AssetBundle
→ Copy Asset Bundles(把 AB 拷到 StreamingAssets)
```

Editor 工具里依次点击:1(选平台)→ 4(打 AB)→ 5(拷贝到 StreamingAssets)。

### Keystore 签名

Unity Player Settings → Android → Publishing Settings:

- `Keystore`:新建或选已有 `.keystore` 文件
- `Keystore password`:keystore 密码
- `Key Alias`:别名(`Alias`)
- `Key Alias password`:别名密码(可与 keystore 密码相同)

不签名出来的 APK 装不上正式机。

### Jenkins 任务配置

1. 新建 Freestyle 项目
2. 源码管理:Git / SVN 拉项目
3. 构建环境:设置 Unity 路径
4. Build Step:Execute Windows batch command

```bat
set _version=1.0.0
set _target=Android
set _reDialog=false
set _window=false

"F:\Unity\2019.4.12f1\Editor\Unity.exe" -projectPath "%WORKSPACE%" -executeMethod BuildEditor.%_target% -quit -batchmode -logFile build.log

:: 出包后归档
xcopy /Y Build\Android\*.apk %JENKINS_ARTIFACT%\
```

5. Post-build:Archive the artifacts(`Build/Android/*.apk`)

### 安卓包打不出来的常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `credentails must be tested to continue` | Jenkins 凭据没填好 | 系统配置里补 Credentials |
| Gradle 报 `dependencyResolutionManagement not found` | Gradle 版本 < 6.8 | 升级 Gradle Wrapper 到 6.8+ |
| Maven 仓库下载慢 / 失败 | 默认走 google maven | 镜像到阿里云 |
| OutOfMemory | Gradle JVM 堆不够 | gradle.properties 加 `org.gradle.jvmargs=-Xmx4096m` |

阿里云镜像(放在 mainTemplate.gradle 的 repositories 顶部):

```gradle
maven {
    url "https://maven.aliyun.com/nexus/content/groups/public"
}
```

## 五、iOS 出包流程

iOS 比 Android 多一步:**Unity 只导出 Xcode 工程,真正的 ipa 要用 Xcode 打**。

### Unity 端

```csharp
BuildPipeline.BuildPlayer(scenes, "Build/iOS", BuildTarget.iOS, BuildOptions.None);
```

### Xcode 端

Jenkins 配合 Xcode plugin 或 `xcodebuild`:

```bash
# 进入导出的 Xcode 工程
cd Build/iOS

# 清理
xcodebuild clean -project Unity-iPhone.xcodeproj -configuration Release

# 打包 archive
xcodebuild archive \
    -project Unity-iPhone.xcodeproj \
    -scheme Unity-iPhone \
    -archivePath build/Unity-iPhone.xcarchive

# 导出 ipa
xcodebuild -exportArchive \
    -archivePath build/Unity-iPhone.xcarchive \
    -exportPath build/ipa \
    -exportOptionsPlist exportOptions.plist
```

### Info.plist 修改

Unity 导出后,`Info.plist` 经常需要补字段(URL Scheme、权限说明、Facebook AppID 等),可用 Xcode 的 `PostProcessBuild`:

```csharp
[PostProcessBuild]
public static void OnPostprocessBuild(BuildTarget target, string pathToBuiltProject)
{
    string plistPath = pathToBuiltProject + "/Info.plist";
    PlistDocument plist = new PlistDocument();
    plist.ReadFromFile(plistPath);

    plist.root.SetString("NSCameraUsageDescription", "需要相机权限用于拍照");
    plist.root.SetString("FacebookAppID", "1234567890");

    plist.WriteToFile(plistPath);
}
```

### xcframework 接入

Facebook 等 SDK 现在用 `.xcframework`,**不能手动拖进 Xcode**(会丢 embed),必须走代码:

```csharp
string xcframeworkPath = Path.Combine(outputPath, "../Plugins/iOS/FBSDKLoginKit.xcframework");
string fileGuid = project.AddFile(targetGuid,
    project.AddFile(xcframeworkPath, "Frameworks/" + Path.GetFileName(xcframeworkPath)));
project.AddFileToEmbedFrameworks(targetGuid, fileGuid);
```

## 六、踩过的坑汇总

| 现象 | 解决 |
|---|---|
| Jenkins 服务起不来 | 账号密码错,`services.msc` 改登录账号 |
| Unity 卡住无输出 | 加 `-logFile build.log`,看日志 |
| Gradle 下载超时 | 阿里云镜像 + 升级 Gradle Wrapper |
| iOS 编译缺 embed | xcframework 必须走代码 `AddFileToEmbedFrameworks` |
| 安卓签名失败 | Keystore 路径含中文 / 密码错 |
| 出包后白屏 | AB 没拷进 StreamingAssets |
| Jenkins 出包比本地慢 | 服务账号没 GPU / 没缓存,预热一次 |

## 七、版本号管理

每条流水线产出的包,版本号要规范,推荐:

```
Major.Minor.Patch-Build
1.0.0-123
```

- Major:大版本(新功能 / 不兼容)
- Minor:小版本(新关卡 / 新角色)
- Patch:补丁(bug 修复)
- Build:Jenkins 构建号,自增

Jenkins 里用 `${BUILD_NUMBER}` 注入:

```bat
set _version=1.0.0-%BUILD_NUMBER%
```

## 参考

- [Unity 命令行参数官方文档](https://docs.unity3d.com/Manual/CommandLineArguments.html)
- [Jenkins 安装踩坑](http://t.csdnimg.cn/VIBxJ)
- [Unity Jenkins 自动打包](http://t.csdnimg.cn/vkiO5)

---

下一篇:[小工具集:网站搭建 / FTP / WOL 远程唤醒](2024-08-10-ci-tools-website-ftp-wol.md) — 整合自网站搭建、FTP、WOL 三篇笔记。
