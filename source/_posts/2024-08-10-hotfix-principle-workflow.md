---
title: Unity 热更新实战(二):客户端热更原理与打包/分发/加载流程
date: 2024-08-10 22:30:00
updated: 2024-08-10 22:30:00
tags:
  - Unity
  - 热更新
  - AssetBundle
  - 热更流程
  - 分包
categories:
  - [Unity, 热更新]
comments: true
---

> 这是热更实战系列的第二篇,主线是**热更新的工程化落地**:从整包更新机制、AB 资源分包、CDN 分发,到客户端的检查/下载/校验/加载流程。把代码热更(HybridCLR/Lua)之外的所有"工程性"问题讲清楚——DLL 怎么打、AB 怎么分发、客户端怎么检查版本、多线程下载怎么设计。

## 一、整包更新 vs 资源热更

手游的"热更"分两层:

| 类型 | 触发条件 | 处理方式 |
|---|---|---|
| **整包更新** | App 版本号 < 强制更新版本 | 跳转商店 / 在线下载 APK |
| **最小版本更新** | App 版本号 < 最小版本 | 弹窗建议,玩家可选 |
| **资源热更** | 资源版本不一致 | 下载 AB / DLL,无需重装 |
| **送审版本** | App 版本号 < 送审版本 | 客户端功能全开放(用于苹果上架审核) |

启动时按这个顺序检查:**应用版本 → 资源版本 → 进入游戏**。

<!-- more -->

## 二、整包更新机制

应用打包时在 cs 上写死 `appver` 应用版本号,后续整包版本比对都基于它。

启动检查流程:

```
启动 → 请求 applicationConfig.txt → 对比版本号
                                       ├─ appver < 强制版本 → 强制整包更新
                                       ├─ appver < 最小版本 → 建议更新(可选)
                                       ├─ appver < 送审版本 → 全功能开放
                                       └─ 否则 → 进入资源热更流程
```

整包更新支持两种方式:

1. **跳转应用商店**(iOS 必须,Android 可选)
2. **游戏内直接下载 APK + 安装**(仅 Android)

## 三、客户端热更的五大模块

完整的客户端热更机制通常包含五大模块:

| 模块 | 职责 |
|---|---|
| **ApplicationModule** | 启动更新 applicationConfig.txt,整包更新 |
| **ResPackModule** | 包模块管理、模块启用/禁用 |
| **DatabaseModule** | 热更数据库,存储包模块信息、资源更新信息 |
| **AssetsFileModule** | 文件管理器,判断/执行/验证更新(核心) |
| **HttpThreadRequest** | 多线程下载器,执行文件下载(支持多线程、限流) |

辅助模块还有 zip 压缩解压、CRC/MD5 校验等。

### 3.1 设计原则:表现与逻辑分离

- **XFrame 模块**:负责整个热更逻辑(检查、下载、校验)
- **UpdateScene**:负责表现逻辑(更新提示、进度条、错误对话框)

通过 `UpdateEventType` 枚举串联状态,各个模块执行结果通过事件回调表现层。

## 四、配置文件:三层结构

### 4.1 ApplicationConfig(版本清单)

```
Assets/DataConfig/applicationConfig.txt
```

包含版本号、各模块的清单信息。客户端启动时优先下载这个文件。

### 4.2 ResModuleConfig(资源模块清单)

每个模块一条配置:

| 字段 | 含义 |
|---|---|
| name | 资源模块清单名称(一组 AB 的合集) |
| type | 资源包类型(同类型互为变体,如 .cn / .en) |
| bUse | 资源启动标识(同类型已启用则禁用) |
| bBlock | 模块是否屏蔽 |
| Flag | 资源清单更新标记(串联热更流程) |
| bZip | 是否压缩 |

### 4.3 AssetItemInfo(资源条目信息)

每个 AB 一条:

| 字段 | 含义 |
|---|---|
| name | AssetBundle 名 |
| hash | AB 的 hash(比对是否需更新) |
| md5 | 资源 MD5(下载完整性校验) |
| size | 文件大小 |
| bZip | 是否在压缩包中(0/1) |

## 五、热更流程:状态机驱动

整个热更流程由 `UpdateEventType` 枚举串联:

```csharp
public enum UpdateEventType
{
    // 整包更新
    APP_VER_CHECK_BEGIN,             // 检查 app 版本
    APP_VER_CHECK_FINISH,            // 完成检查
    APP_VER_NEED_UPDATE,             // 强制整包更新
    APP_VER_NEED_MINTIP,             // 版本过低提示
    APP_VER_DOWN_APK,                // 下载 APK
    APP_VER_JUMP_STORE,              // 跳转商店
    APP_VER_INSTALL_APK,             // 安装 APK
    APP_VER_ERROR_CHECK/DOWN/INSTALL,

    // 资源更新
    ASSET_CHECK_BEGIN,               // 开始资源检查
    ASSET_CHECK_END,                 // 资源检查完成
    ASSET_CHECK_RESINFO,             // 比对启用资源模块信息
    ASSET_NEED_UPDATE,               // 有需要立即下载的资源
    ASSET_DOWNLOAD,                  // 下载资源
    ASSET_INSTALL,                   // 下载完成,解压、更新缓存
    ASSET_CHECK_FINISH,              // 检查流程完成
    ASSET_ERROR_CHECK/DOWN/INSTALL,

    // Game
    GAME_PRE_LOADER_BEGIN,           // 预加载流程
}
```

启动后通过 Update 帧推进入流程,每完成一步 → 状态变化 → 回调到事件处理 → 决定下一步。

## 六、资源热更的核心逻辑

### 6.1 检查更新

1. 启动后请求远端 CDN 的 `applicationConfig.txt`
2. 对比清单中的版本号(强更/最小版本)
3. 进入资源热更检查
4. **逐模块**比对资源清单 hash 与数据库中记录
5. hash 不一致的模块 → 记录到更新列表

### 6.2 比对策略

```
对每个启用的模块:
    比对模块清单的 assetbundleInfo 是否变动
    ├─ 模块整体不在客户端 → 下载整个模块 zip
    └─ 模块部分变动 → 比对资源清单
        ├─ 资源在 zip 包内 → 下载 zip 包
        └─ 不在 zip 内 → 单独下载 assetbundle
```

这种"模块 zip + 单独 AB"的混合方式,**既能兼容跨版本更新,又能减少 zip 复杂度,还能控制热更资源大小**。

### 6.3 资源下载后

- 校验 MD5 完整性
- 解压(如在 zip 中)
- 记录到数据库(文件名、最后修改时间)
- 重新加载资源映射

## 七、多线程下载器:HttpThreadRequest

下载器设计要点:

1. **至少两个线程**:下载线程(N 个,可配置 + 限流) + 写入线程(只能 1 个,避免写冲突)
2. **API 选择**:`UnityWebRequest` 和 `HttpWebRequest` 实测差不多,可任选
3. **限流位置**:在下载后 `ReadStream` 缓存数据读取速度控制
4. **失败重试**:每个资源下载 2 次,超过则提示下载失败

```csharp
// 下载器创建
public HttpThreadRequest(
    Action<FileDownloadCallback> callback,  // 文件下载完成回调
    string rootPath,                         // 文件存放根目录
    string urlBase,                          // URL 基址
    int maxThreadCount                       // 最大线程数
);
```

下载线程负责 HTTP 请求,完成后挂起;写入线程串行写入磁盘 + 验证 MD5。

## 八、资源加载:别名机制

客户端资源以**分模块**管理,模块在 AB 打包面板配置 `module` 名称。

针对多语言、画质分级,引入 **AssetBundle Variant** 机制:以文件夹 `VAR_xxx` 标识子模块。

### 8.1 别名加载流程

```csharp
// 业务层只关心资源名
string resName = "ui/login_panel";

// 别名转换
if (_assetHelper.IsAssetBundleModule())
{
    resName = _assetFileMgr.CheckAssetBundleName(resName);
    // → "ui/login_panel.cn" 或 "ui/login_panel.en"
}

// 真正加载
_loadAssetbundle(resName, callback, method, loadType);
```

### 8.2 AB 依赖管理

加载某个 AB 时,**所有依赖 AB 都要先加载完毕**。

```csharp
// 加载依赖
_onDepABLoadComplete() → _loadDepABCount++
// 当 _loadDepABCount == 依赖信息中记录的 DepABCount
// → 触发 _allABLoaderComplete()
// → 通知资源管理器加载资源,触发回调
```

### 8.3 同步异步转换

同一资源先异步请求,在异步完成前来了同步请求:

```csharp
// 异步转同步
if (method == ResourceLoadMethod.Sync)
{
    AssetBundleLoader taskLoader = _loadingABTaskDict[assetbundleName];
    AssetBundleLoader abloader = _createABLoader(assetbundleName);
    // 通知旧加载器停止
    taskLoader.LoadState = ResourceLoadState.None;
    abloader.abRequest = taskLoader.abRequest;
    _loadingABTaskDict[assetbundleName] = abloader;
}
```

确保同一资源的 Loader 是同一个,加载完成时所有上层回调都能正确触发。

### 8.4 引用计数

```csharp
// 加载完成 + 需要缓存
if (bCacheABInfo && !_abInfoDict.ContainsKey(name))
{
    abiInfo.Retain();  // 引用计数 +1
    _abInfoDict[name] = abiInfo;
}
```

引用归零时自动卸载,避免内存泄漏。

## 九、分包机制

### 9.1 分包配置

| 配置项 | 作用 |
|---|---|
| **预装** | 是否预先下载此模块(不勾则不进入 APK 包) |
| **启用** | 强制启用此模块,禁用同类型其他模块 |
| **屏蔽** | 模块不加载 |
| **压缩** | 是否打成 zip(分包常用) |
| **下载标记** | 立即更新 / 边玩边玩 |

分包实现:

1. 包模块配置**预装取消勾选** → 不进入 APK
2. 下载标记选**边玩边下**
3. 是否开启 zip 压缩可选

### 9.2 边玩边下

`AssetsFileEnum` 定义资源更新类型:

```csharp
public enum AssetsFileEnum
{
    NONE = 0,
    ASSET_TYPE_NOW = 1,    // 立即更新
    ASSET_TYPE_PLAY = 2,   // 边玩边更新
    ASSET_TYPE_ALL = 3,    // 全部
}
```

资源使用时若分包未下载,通过 `CheckAndCacheAssetbundle` 检查并缓存——文件不是最新则强制异步下载,完成后才能继续加载。

## 十、热更自动出包工具

工程化项目热更出包要集成到 Jenkins/CI:

```
Jenkins(updateflag = true)
    ↓ 传递参数到打包脚本
    ↓ 开启 GAME_RUN_UPDATE 宏定义
    ↓
OneKeyGenResUpdateInfo:
    1. 备份旧版本号
    2. 获取预装模块信息
    3. 获取应用版本信息
    4. 获取热更目录
    5. 没预装的模块 + 勾 zip 的 → 打成 zip
    6. 预装模块通过新旧版本对比获取差异 → 打成 zip
    7. 写入 zip 文件信息到版本配置文件
    8. 备份版本信息文件
    9. 所有资源存放到热更生成目录
```

**全资源清单比对**机制:不论跨越多少版本,客户端都能通过一次更新到最新。

**相邻版本 zip 优化**:每次出包对比上一版资源清单,差异打成 zip。客户端检查时优先用 zip(跨多版本兼容),不在 zip 的资源单独下载——保持热更资源大小可控,又兼容跨版本。

## 十一、代码热更(Lua / C#)的运行时

### 11.1 Lua 项目热更(以 EN 项目为例)

`_runGame` 之后:

- 清除原网络连接
- 释放资源池、UI 图片管理、GPU 管理
- **释放旧 Lua 虚拟机 + 创建新虚拟机**
- `_env.DoString($"return require('main')")` 启动 Lua 入口
- 进入登入场景

> 注意:Lua 代码通常**不支持玩家在线实时热更**,要重新登入才生效(管理器文件做不到热更,除非支持数据平行转移,风险大)。资源只要不被常驻引用,支持在线热更——替换 AB 和清单即可。

### 11.2 在线 Lua 热更(进阶)

要做到在线热更,需要清理 `package.loaded` 和 `package.preload` 的脚本缓存:

```lua
package.loaded["modules.xxx"] = nil
package.preload["modules.xxx"] = nil
require("modules.xxx")  -- 重新加载
```

但管理器类、长生命周期对象的状态难处理,需要数据支持平行转移,风险高,通常不做。

### 11.3 C# 热更(HybridCLR)

C# 热更相对简单:

```csharp
byte[] dllBytes = DownloadDll("HotUpdate.dll");
Assembly ass = Assembly.Load(dllBytes);
// 启动入口
```

C# 类型系统统一,没有 Lua 那种状态恢复问题,但要重启游戏才能完全生效。

## 十二、热更流程决策清单

- [ ] applicationConfig.txt 是否能正确分发版本信息
- [ ] 整包更新策略(强更 / 最小版本 / 送审版本)是否清晰
- [ ] AB 模块划分是否合理(分包预装策略)
- [ ] 资源 hash + MD5 双重校验是否到位
- [ ] 多线程下载器是否有限流和重试
- [ ] AB 依赖管理(依赖先加载,引用计数)是否完备
- [ ] 同步/异步转换是否正确处理
- [ ] 别名机制(Variant)是否覆盖多语言/画质
- [ ] 分包边玩边下是否实现
- [ ] 跨多版本更新是否兼容(zip + 单独 AB)
- [ ] 代码热更(Lua/C#)是否需要重启
- [ ] CI 出包工具是否集成热更流程

## 十三、收尾

热更的"工程性"远比"代码热更本身"复杂——DLL 怎么解释执行是一回事,但**怎么把 DLL/AB 安全地分发到玩家手机、怎么校验、怎么兼容多版本、怎么分包**才是真正的工作量。

实战经验:

1. **优先把 applicationConfig 跑通**,版本号检查是基础
2. **AB 模块划分要早做**,后期改 AB 结构代价极大
3. **多线程下载 + 限流**是必须的,不然进度条会卡
4. **CI 集成**是团队协作的前提,手动出包容易漏步骤

代码热更方案选型(HybridCLR/Lua/ILRuntime)请参考已写的另一篇对比文。这两篇热更实战侧重于"怎么把方案跑起来"+"工程链路怎么搭",合起来覆盖热更的方方面面。
