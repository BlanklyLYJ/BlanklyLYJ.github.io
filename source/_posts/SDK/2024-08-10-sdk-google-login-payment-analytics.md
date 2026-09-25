---
permalink: 2024/08/10/sdk-google-login-payment-analytics/
title: SDK 与平台接入:Google 登录 / 支付 / 数数 / Crasheye
date: 2024-08-11 00:30:00
updated: 2024-08-11 00:30:00
tags:
  - SDK
  - Google
  - 登录
  - 支付
  - 数数科技
  - Crasheye
  - 工程化
categories:
  - [SDK, 平台]
comments: true
---

> 这一篇把《SDK 总览》《Google 登录》《Google 支付》《数数科技 SDK》《Crasheye》《SDK 遇到的问题》六篇笔记整合到一起,讲清楚游戏出海最常见的几类 SDK:账号(登录)、变现(支付)、运营(数据)、质量(崩溃)的接入要点。

## 一、SDK 接入全景

一款商业化游戏,SDK 接入通常覆盖四类:

| 类型 | 作用 | 国内典型 | 海外典型 |
|---|---|---|---|
| 账号 SDK | 登录、用户体系 | 微信 / QQ / 手机号 | Google Play / Apple / Facebook |
| 支付 SDK | 内购变现 | 微信支付 / 支付宝 | Google Billing / Apple IAP |
| 数据 / BI | 用户行为、埋点 | 数数科技 / TalkingData | Firebase / AppsFlyer |
| 监控 | 崩溃、性能 | Bugly / Crasheye | Crashlytics / Sentry |
| 广告 | 买量变现 | 穿山甲 / 优量汇 | AdMob / ironSource |
| 推送 | 触达 | 个推 / 极光 | FCM / APNs |

出海底配:**Google 登录 + Google Billing + 数数科技 + Crashlytics**,国内则是 **微信登录 + 微信 / 支付宝 + 数数科技 + Bugly**。下面挑海外最常见的几个讲。

<!-- more -->

## 二、Google 登录 SDK

### 前置:JDK / NDK / SDK 三件套

Unity 出安卓包必须先装:

- **JDK**:Java 开发包,Gradle 编译需要
- **NDK**:Native 开发包,C# IL2CPP 编译需要
- **Android SDK**:Android 平台 API + Build Tools

Unity Hub 自带 Module Installer,装 2019.4 / 2021.3 等版本时勾选 Android Build Support 即可,装不下来手动新建目录导入。

### Unity 端配置

1. **切换 Android 平台**:File → Build Settings → Switch Platform to Android
2. **Player Settings**:
   - `Company Name`:`com.yourcompany`
   - `Product Name`:`YourGame`
   - `Version` / `Bundle Version Code`:每次出包递增
   - `Scripting Backend`:IL2CPP(2021+ 推荐)
   - `Target Architectures`:ARM64 必勾(32 位 Google Play 已不接收)
3. **Keystore**:新建或选用已有 keystore,填密码、别名、别名密码,Keytool 命令:

```bash
keytool -genkey -v -keystore mygame.keystore -alias mygame -keyalg RSA -keysize 2048 -validity 10000
```

### 后台配置

1. **Google Play Console** 注册开发者账号($25 一次性费用)
2. **Firebase Console** 新建项目,关联 Google Play
3. 在 Firebase 启用 **Google Sign-In** 作为登录方式
4. 把 Firebase 配置文件 `google-services.json`(Android)/ `GoogleService-Info.plist`(iOS)放进 Unity

### Unity 集成

用官方 [Google Sign-In Unity 插件](https://github.com/googlesamples/google-signin-unity):

```csharp
using GoogleSignIn;

void Start()
{
    var cfg = new GoogleSignInConfiguration {
        WebClientId = "<你的 OAuth Client ID>",
        RequestIdToken = true
    };
    GoogleSignIn.Configuration = cfg;
}

public void SignIn()
{
    GoogleSignIn.DefaultInstance.SignIn().ContinueWith(task =>
    {
        if (task.IsFaulted) Debug.LogError("登录失败:" + task.Exception);
        else Debug.Log("登录成功:" + task.Result.UserId);
    });
}
```

### 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `OnAuthenticationFinished` 不执行 | Firebase Unity 版本与 native 不匹配 | 升级 EDM4U + Firebase Unity SDK |
| 签名后崩溃 | ProGuard 混淆掉了 Google 类 | 加 `-keep class com.google.** { *; }` |
| iOS 引用报错 | EDM4U CocoaPods 没装 | 装 CocoaPods + 重新 Resolve |

## 三、Google Billing(支付)

Google Play 内购走 **Google Play Billing Library**,Unity 有官方 [In-App Purchasing](https://docs.unity3d.com/Manual/UnityIAP.html) 封装,底层会调到 Billing。

### 商品类型

| 类型 | 说明 | 案例 |
|---|---|---|
| Consumable(消耗型) | 买了就用,可重复买 | 钻石、金币、体力 |
| Non-Consumable(非消耗) | 一次购买永久拥有 | 去广告、DLC |
| Subscription(订阅) | 周期扣费 | 月卡、赛季通行证 |

### 接入步骤

1. **Google Play Console → 创商品**:每个 SKU 配 ID、价格、说明
2. **Unity IAP 初始化**:

```csharp
using UnityEngine.Purchasing;

public class IAPManager : IStoreListener
{
    private IStoreController controller;

    public void Init()
    {
        var builder = ConfigurationBuilder.Instance(StandardPurchasingModule.Instance());
        builder.AddProduct("diamond_100", ProductType.Consumable);
        builder.AddProduct("no_ads",    ProductType.NonConsumable);
        builder.AddProduct("month_card", ProductType.Subscription);
        UnityPurchasing.Initialize(this, builder);
    }

    public void OnInitialized(IStoreController c, IExtensionProvider ext) {
        controller = c;
    }

    public void OnInitializeFailed(InitializationFailureReason r) { }
    public void OnInitializeFailed(InitializationFailureReason r, string msg) { }

    public PurchaseProcessingResult ProcessPurchase(PurchaseEventArgs e)
    {
        // 服务器校验
        VerifyReceipt(e.purchasedProduct.receipt, success => {
            if (success) {
                GrantItem(e.purchasedProduct.definition.id);
                controller.ConfirmPendingPurchase(e.purchasedProduct);
            }
        });
        return PurchaseProcessingResult.Pending;
    }

    public void OnPurchaseFailed(Product p, PurchaseFailureReason r) { }
}
```

3. **购买**:

```csharp
controller.InitiatePurchase("diamond_100");
```

### 服务器校验(必做)

**不校验 receipt 等于裸奔**,客户端可以伪造支付成功。流程:

1. 客户端拿到 Google 返回的 receipt(含 purchaseToken)
2. 上传自家服务端
3. 服务端调 Google Play Developer API:`purchases.products.verify`
4. 验通过才发钻石

```python
# 服务端伪代码
from googleapiclient.discovery import build

def verify(package, sku, token):
    service = build("androidpublisher", "v3", credentials=creds)
    resp = service.purchases().products().verify(
        packageName=package, productId=sku, token=token).execute()
    return resp["purchaseState"] == 0  # 0 = 已购买
```

### 沙盒测试

Google Play 提供**测试账号**(License Testing),不用真扣钱:
- Console → Setup → License Testing → 添加 Gmail
- 这些账号购买时弹"这是测试购买"

## 四、数数科技 SDK(TA)

[ThinkingData](https://docs.thinkingdata.cn/) 是国内游戏圈最常用的 BI 系统,功能类似 Firebase Analytics,但更贴近中国运营场景(精确到玩家 ID、支持实时大屏)。

### Unity 接入

1. 下载 Unity Package,导入
2. 初始化:

```csharp
using ThinkingSDK;

void Start()
{
    ThinkingSDKAPI.StartThinkingSDK(new ThinkingSDKStartConfig
    {
        appId = "YOUR_APP_ID",
        url   = "https://receiver.ta.thinkingdata.cn"
    });

    // 设置账号 ID(登录后)
    ThinkingSDKAPI.Login("user_123");

    // 用户属性
    ThinkingSDKAPI.UserSet(new Dictionary<string, object> {
        { "level", 10 },
        { "vip",   true }
    });

    // 事件埋点
    ThinkingSDKAPI.Track("level_complete", new Dictionary<string, object> {
        { "level_id", 5 },
        { "duration", 120 }
    });
}
```

### 数据模型:USER + EVENT

- **USER**:玩家属性(等级、VIP、注册时间),`UserSet` 覆盖、`UserSetOnce` 只设一次、`UserAdd` 累加
- **EVENT**:玩家行为(登录、充值、关卡完成),`Track` 上报

### 常见埋点

| 事件 | 触发 | 关键属性 |
|---|---|---|
| `login` | 登录成功 | channel, account_type |
| `tutorial_complete` | 完成新手 | step, duration |
| `level_start` / `level_complete` / `level_fail` | 关卡进 / 出 | level_id, duration |
| `purchase` | 充值成功 | amount, currency, sku |
| `ad_show` | 看广告 | placement, reward |

## 五、Crasheye 崩溃上报

Crasheye(现叫 Xigy)是国内常用的崩溃监控,接 Android / iOS 都简单。

### Android 接入

```java
// MainActivity.java
import com.unity3d.player.UnityPlayerActivity;
import com.xigy.crasheye.Crasheye;

public class MainActivity extends UnityPlayerActivity
{
    public String returnAppKey() {
        return "YOUR_APP_KEY";
    }
}
```

Unity C# 端调用(Unity 2019+ 支持直接调 Android,不用打 jar):

```csharp
void Start()
{
    AndroidJavaClass cls = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
    string appKey = cls.CallStatic<string>("returnAppKey");
    Crasheye.StartInitCrasheye(appKey);
}
```

### iOS 接入

```csharp
[PostProcessBuild]
public static void OnPostprocessBuild(BuildTarget target, string path)
{
    // 修改 Info.plist,加崩溃上报所需权限
    // 添加 -lc++ 等 Linker Flag
}
```

### 上报内容

崩溃上报主要看:
- **崩溃堆栈**(关键,符号化后定位到代码行)
- **设备信息**(机型、系统版本、内存)
- **App 版本**(定位回归问题)
- **用户标识**(关联具体玩家)

注意:**IL2CPP 出包后崩溃堆栈需要符号化**,要把打包时的符号文件(`.so` / `.dSYM`)归档保存,否则线上崩溃无法定位。

## 六、SDK 接入通用坑汇总

| 类型 | 现象 | 解决 |
|---|---|---|
| Gradle | `dependencyResolutionManagement not found` | Gradle 升到 6.8+ |
| Maven | `maven.google.com` 拉不动 | 换阿里云镜像 |
| iOS | `.xcframework` 手动拖入丢 embed | 走代码 `AddFileToEmbedFrameworks` |
| ProGuard | 反射调用被混淆 | `-keep` 保留 SDK 类 |
| Android | `OnAuthenticationFinished` 不回调 | 升级 EDM4U / Firebase Unity SDK |
| Unity | 出包白屏 | SDK 初始化顺序错,延迟 1 帧再调 |
| iOS | App Store 审核被拒 | 隐私说明文案没写、用了私有 API |
| 网络 | SDK 卡在初始化 | 海外 SDK 在国内访问慢,加超时 |

## 七、接入顺序建议

新项目接 SDK 不要一股脑全上,推荐顺序:

1. **第一波:登录** — 玩家能进游戏,这是基础
2. **第二波:埋点** — 数数科技,验证核心数据上报
3. **第三波:崩溃** — Crasheye / Bugly,早期发现崩溃
4. **第四波:支付** — 商业化前最后接,需要服务器配合
5. **第五波:广告** — 变现优化阶段

每接一个 SDK,**完整测试再接下一个**,否则多个 SDK 一起出问题就分不清是谁的锅。

## 参考

- [Google Sign-In Unity](https://github.com/googlesamples/google-signin-unity)
- [Unity IAP 文档](https://docs.unity3d.com/Manual/UnityIAP.html)
- [数数科技 Unity SDK](https://docs.thinkingdata.cn/ta-manual/v3.5/installation/installation_menu/client_sdk/unity_sdk_installation/unity_sdk_installation.html)
- [Google Play 开发者账号注册流程](https://zhuanlan.zhihu.com/p/697099494)

---

下一篇:[iOS / Android 平台须知与 APK 签名](2024-08-10-sdk-ios-android-apk-signing.md) — 整合自《iOS 开发须知》《Google Play 注册》等。
