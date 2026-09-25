---
permalink: 2024/08/10/sdk-ios-android-apk-signing/
title: iOS / Android 平台须知与 APK / IPA 签名
date: 2024-08-11 01:00:00
updated: 2024-08-11 01:00:00
tags:
  - iOS
  - Android
  - 签名
  - APK
  - Objective-C
  - SDK
categories:
  - [SDK, 平台]
comments: true
---

> 这一篇把《iOS 开发须知》《Google Play 注册流程》《SDK 遇到的问题》三篇整合,聚焦"平台差异":iOS 开发的 OC 基础、Info.plist、Xcode 配置;Android 的 Gradle、APK 签名、V1/V2/V3、Google Play 注册流程。

## 一、为什么平台知识容易踩坑

游戏开发大部分时间是 Unity / Unreal 引擎的事,但出包、上架、接 SDK 必然要落到原生平台。这一层有几个常见痛点:

- iOS 的 OC 语法、Info.plist、Keychain、签名体系
- Android 的 Gradle 版本、混淆、签名版本、权限
- 两端审核规则不同,经常因为小事被拒

这篇把这些"必须知道但容易忽略"的知识集中讲一遍。

<!-- more -->

## 二、iOS 开发须知

### Objective-C 速查

Unity 接 iOS SDK,绕不开 OC。它和 C# / Java 风格差异大,但本质不复杂。

```objc
// 类声明
@interface MyVC : UIViewController
@property (nonatomic, strong) NSString *name;
- (void)sayHello;
@end

@implementation MyVC
- (void)sayHello {
    NSLog(@"Hello, %@", self.name);
}
@end

// 调用方法(发消息)
MyVC *vc = [[MyVC alloc] init];
vc.name = @"tayler";
[vc sayHello];
```

关键符号:
- `[]` 是消息发送,不是数组下标
- `@property` 自动生成 getter / setter
- `@interface` / `@implementation` 类似 C++ 的 .h 和 .cpp
- `NSString` 前面必须有 `@`(字面量)
- ARC(自动引用计数)默认开启,不用手动 `retain` / `release`

### Info.plist:必须知道的字段

`Info.plist` 是 iOS App 的"身份证",Unity 导出 Xcode 工程时会生成,但 SDK 接入常常要改:

| 字段 | 作用 |
|---|---|
| `CFBundleVersion` | Build 号,每次提交必须递增 |
| `CFBundleShortVersionString` | 用户可见版本号(如 1.0.0) |
| `CFBundleIdentifier` | Bundle ID,与 Apple Developer 一致 |
| `NSCameraUsageDescription` | 相机权限说明(不填崩溃) |
| `NSPhotoLibraryUsageDescription` | 相册权限说明 |
| `NSMicrophoneUsageDescription` | 麦克风权限说明 |
| `LSApplicationQueriesSchemes` | 允许查询的其他 App Scheme(微信 / QQ) |
| `FacebookAppID` | Facebook SDK 用 |
| `UILaunchStoryboardName` | 启动屏 |

读取版本号:

```objc
NSString *versionStr = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleVersion"];
```

### Unity 改 Info.plist(PostProcessBuild)

```csharp
using UnityEditor;
using UnityEditor.iOS.Xcode;
using System.IO;

public class iOSPostProcess
{
    [PostProcessBuild]
    public static void OnPostprocessBuild(BuildTarget target, string path)
    {
        if (target != BuildTarget.iOS) return;

        string plistPath = path + "/Info.plist";
        PlistDocument plist = new PlistDocument();
        plist.ReadFromFile(plistPath);

        PlistElementArray schemes = plist.root.CreateArray("LSApplicationQueriesSchemes");
        schemes.AddString("weixin");
        schemes.AddString("mqq");

        plist.root.SetString("NSCameraUsageDescription", "需要相机权限用于拍照");

        plist.WriteToFile(plistPath);
    }
}
```

### Xcode 工程修改(代码层)

`.xcframework` 必须**走代码** `AddFileToEmbedFrameworks`,手动拖入会丢 embed 设置:

```csharp
[PostProcessBuild]
public static void OnPostprocessBuild(BuildTarget target, string pathToBuiltProject)
{
    string projPath = pathToBuiltProject + "/Unity-iPhone.xcodeproj/project.pbxproj";
    PBXProject project = new PBXProject();
    project.ReadFromFile(projPath);

    string mainTarget = project.GetUnityMainTargetGuid();

    string xcPath = Path.Combine(pathToBuiltProject,
        "../Plugins/iOS/MTSDK/Facebook/FBSDKLoginKit.xcframework");

    string fileGuid = project.AddFile(mainTarget,
        project.AddFile(xcPath, "Frameworks/" + Path.GetFileName(xcPath)));

    project.AddFileToEmbedFrameworks(mainTarget, fileGuid);

    // Linker Flag
    project.AddBuildProperty(mainTarget, "OTHER_LDFLAGS", "-ObjC");

    project.WriteToFile(projPath);
}
```

### 签名:证书 + Profile

iOS 签名是新手最大的拦路虎,核心三件套:

| 文件 | 作用 | 获取 |
|---|---|---|
| `.cer` 开发者证书 | 标识开发者身份 | Keychain 生成 CSR → Apple 后台签发 |
| `.p12` 私钥 | 配合证书 | Keychain 导出 |
| `.mobileprovision` 描述文件 | 绑定 App ID + 设备 + 证书 | Apple 后台 |

发布到 App Store 必须用 **Distribution** 证书 + **App Store** Profile,Debug 用 Development 证书 + Development Profile。

### App Store 审核常见拒绝

- 缺权限说明(Info.plist 里的 Usage Description 文案要具体)
- 内购用了第三方支付(微信支付不允许用于虚拟商品)
- 测试账号没填(审核员登不进游戏)
- 引导用户升级 / 跳其他商店
- 涉及真实赌博 / 真实现金交易

## 三、Android 开发须知

### Gradle 版本问题

Unity 自带的 Gradle 版本常常跟不上 SDK 要求。报错:

```
Could not find method dependencyResolutionManagement() for arguments ...
```

原因:SDK 用了 Gradle 6.8+ 才有的 API,Unity 自带的是低版本。

**解决**:把 Gradle Wrapper 升级到 6.8+,具体做法:

1. Unity → Preferences → External Tools → 取消勾选"Custom Gradle"
2. 下载 [Gradle 6.8+](https://gradle.org/releases/)
3. 解压后路径填进 Unity
4. 或修改 `gradle/wrapper/gradle-wrapper.properties`:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-7.4-bin.zip
```

### Maven 镜像加速

国内访问 `maven.google.com` 慢,改用阿里云。`mainTemplate.gradle`(Unity 生成):

```gradle
allprojects {
    repositories {
        maven {
            url "https://maven.aliyun.com/nexus/content/groups/public"
        }
        google()
        jcenter()
    }
}
```

注意放在 `google()` 前面,优先级高。

### APK 签名:V1 / V2 / V3

| 版本 | 引入 | 作用 | 兼容性 |
|---|---|---|---|
| V1(JAR signing) | 早期 | 基于 JAR,逐个文件签名 | 所有 Android 版本 |
| V2(APK Signature Scheme) | Android 7.0 | 整个 APK 签名,防篡改更强 | 7.0+ |
| V3 | Android 9.0 | 支持密钥轮换 | 9.0+ |

**Google Play 现在要求 V2 起步**,Unity Player Settings → Publishing Settings 勾选两个:

```
☑ Build System: Gradle
☑ Create symbols.zip
☑ Project (导出工程,可选)
☑ Custom Keystore
☑ V1 Signature
☑ V2 Signature
```

### Keystore 管理

```bash
# 生成 keystore
keytool -genkey -v \
    -keystore mygame.keystore \
    -alias mygame \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000

# 查看信息
keytool -list -v -keystore mygame.keystore

# 改密码
keytool -storepasswd -keystore mygame.keystore
```

**Keystore 丢了 = App 没法更新**,必须妥善备份,建议:

- 主 keystore 加密存密码管理器(1Password / KeePass)
- 文件本身放团队 NAS + 加密 U 盘
- 团队成员流动时及时更换(用 V3 密钥轮换)

### Google Play 个人开发者账号注册(2024 流程)

1. **准备 Google 账号** + 一次性 $25 注册费(需要 Visa / Master 信用卡)
2. **Play Console** 注册,**必须用真实身份**(企业要走 D-U-N-S 编号认证)
3. **个人账号现在要做身份验证**:上传身份证 / 护照,人脸识别
4. **测试轨道强制**:
   - 上传 APK / AAB 到"内部测试"
   - 至少 20 个测试用户(可选,但建议)
   - 14 天测试期才能上"生产"
5. **数据安全表**(Data Safety):声明收集了哪些数据、是否加密、是否分享给第三方
6. **隐私政策 URL** 必填,且要可访问

### 国内上架须知

- 安卓国内商店多:华为、小米、OPPO、vivo、应用宝、魅族、酷派……每家都要单独接 SDK + 单独审核
- **游戏版号**是硬门槛,没版号上不了付费
- 防沉迷接入:实名认证 + 时长限制
- 用户协议 + 隐私政策 + 第三方 SDK 列表必须齐全

## 四、跨平台差异速查

| 维度 | iOS | Android |
|---|---|---|
| 包格式 | `.ipa` | `.apk` / `.aab` |
| 包大小限制 | < 200MB(超了用 App Thinning) | APK < 100MB(超了用 AAB / OBB) |
| 签名 | 证书 + Profile | Keystore |
| 权限申请 | Info.plist 文案 | AndroidManifest.xml |
| 沙盒 | 严格,App 之间隔离 | 较松(Android 11+ 收紧) |
| 后台 | 严格,容易杀 | 看厂商,国产 ROM 激进 |
| 审核 | 严格,人工审核 24-72h | Google 自动 + 人工,1-3 天 |
| 分发渠道 | 仅 App Store | Google Play + 各家商店 + 直链 |

## 五、推送 / 通知

- **iOS**:APNs(Apple Push Notification service),需要证书 + device token
- **Android 海外**:FCM(Firebase Cloud Messaging),需要 Google Play Services
- **Android 国内**:各家推送(华为 Push / 小米 Push / OPPO Push / vivo Push),没有统一,要么接 5 家要么用个推 / 极光聚合

Unity 推送一般用 [OneSignal](https://onesignal.com/) 或 [Pushy](https://pushy.me/),底层封装 APNs / FCM。

## 六、踩坑汇总

| 现象 | 原因 | 解决 |
|---|---|---|
| iOS 提交报 ITMS-90683 | Info.plist 缺 Usage Description | 补文案 |
| iOS 启动崩溃 | 缺 Linker Flag `ObjC` | `OTHER_LDFLAGS` 加 `-ObjC` |
| Android 启动崩溃 | 缺权限 / ProGuard 混淆 | 加权限 + keep |
| Google Play 拒审 | 数据安全表填错 | 重新检查 SDK 收集项 |
| iOS 包打不出 | 证书 / Profile 不匹配 | 重新生成 Distribution Profile |
| iOS 包太大 | 通用包含多架构 | 用 App Thinning + Bitcode(已弃用,改 Asset Catalog) |

## 参考

- [Unity iOS 接 SDK 前要知道的 OC 知识](https://blog.csdn.net/linxinfa/article/details/107375140)
- [iOS Info.plist 详解](https://blog.csdn.net/linxinfa/article/details/107735015)
- [Google Play 个人开发者账号 2024 注册流程](https://zhuanlan.zhihu.com/p/697099494)
- [Android APK 签名 v1/v2/v3](https://source.android.com/security/apksigning)

---

至此,SDK 与平台接入的两篇就讲完了。下一篇回到主线:C# 内存管理与 GC。
