---
title: AssetBundle 框架设计:Loader / Module / Pool 三件套
date: 2024-08-10 22:30:00
updated: 2024-08-10 22:30:00
tags:
  - Unity
  - AssetBundle
  - 框架设计
  - 对象池
  - 引用计数
categories:
  - [Unity, 资源管理]
comments: true
---

> 入门级 ABManager 只能解决"加载资源"问题,真正上线还得回答:异步加载如何排队?依赖包如何引用计数?GameObject 实例化后谁负责回收?这一篇把模块化 AB 框架的几块拼图(Loader / Module / Pool / Info / Helper)串成一个完整设计。

## 一、为什么不能停在 ABManager

入门版 `ABManager` 解决了基础加载,但工程中至少还有这些缺口:

- **重复实例化**:同一个 prefab 被多次加载,没有复用机制
- **生命周期不可控**:谁加载、谁释放、何时释放没有契约
- **异步协程爆炸**:大量资源异步加载,协程回调层层嵌套
- **依赖包引用计数**:目标包卸载了,依赖包还在内存里
- **跨平台路径管理**:编辑器模式、AB 模式切换不灵活

一个完整的 AB 框架通常拆成几个角色:Module(总管)、Loader(单次加载任务)、Info(资源信息载体)、Pool(实例对象池)、Helper(本地路径与清单解析)。

<!-- more -->

## 二、整体分层

```
┌─────────────────────────────────────────────┐
│           AssetBundleModule (总管)            │
│  - 帧推:轮询异步队列、检查超时回收            │
│  - 持有 Loader 队列与 Info 缓存               │
└──────────────────┬──────────────────────────┘
                   │
   ┌───────────────┼───────────────┐
   ▼               ▼               ▼
AssetLocalHelper  ABLoader       ABInfo
(路径/清单/依赖)  (加载任务)     (引用计数/资源字典)
                                  │
                                  ▼
                             AssetPool
                             (实例对象池)
```

## 三、AssetBundleModule:总管

模块基类继承自项目的统一 Module 抽象,核心生命周期方法:

```csharp
class AssetBundleModule
{
    protected override void OnInit()
    {
        // 绑定 IAssetBundleService 为单例
        // 创建加载辅助单例
        // 初始化 AB 加载缓存列表
        // 设置 AB 配置
    }

    protected override void OnStart()
    {
        // 加载所有资源的映射(resBundle.txt)
        // 清空异步加载队列
        // 初始化异步加载队列管理器
    }

    protected override void OnUpdate(float deltaTime)
    {
        // 1. 遍历异步加载请求,完成的回收
        // 2. 检查长时间未使用的 AB 包,降级或回收
        // 3. 检查是否可以降级的资源
    }
}
```

帧推是模块的心脏。每帧做三件事:**推进异步队列、回收闲置资源、降级资源引用**。

降级策略:某个 AB 长时间没人用,先降低优先级,继续空闲则真正卸载,通过 `_abLastUsedTimeSort` 排序后逐个处理。

## 四、AssetBundleLoader:加载任务

每个加载请求封装成一个 Loader 对象,状态机推进:

```csharp
class AssetBundleLoader
{
    public void StartLoad();

    public void OnSelfABLoadComplete(AssetBundle ab = null);

    private void _loadDepAssetBundle();      // 加载依赖
    private void _loadSelfAssetBundle();     // 加载自身
    private void _loadAssetBundleSync();     // 同步路径

    private void _onDepABLoadComplete(AssetBundleInfo depInfo);
    private void _allABLoaderComplete();     // 所有 AB 加载完成
}
```

加载顺序明确:**依赖先行,自身跟进,全部完成才回调上层**。这避免了"自身加载完了,依赖还没好,资源引用断裂"的尴尬。

Loader 与 Module 解耦的关键:Loader 只关心自己这一次加载,完成即通知 Module;Module 维护 Loader 队列。

## 五、AssetBundleInfo:引用计数与资源字典

`AssetBundleInfo` 是一个 AB 包加载后的"运行时元信息",职责包括:

| 职责 | 字段/方法 |
|---|---|
| 是否在用 | `IsUnused` / `UpdateLastUsedTime` |
| 引用计数 | `Retain()` / `Release()` |
| 加载资源 | `LoadAsset` / `LoadGameObject` / `LoadAllAsset` |
| 卸载资源 | `UnLoadeAsset` / `Dispose` |
| 依赖管理 | `AddDependency(depInfo)` |
| 弱引用 | `_retainOwner(owner)` 关联到 GameObject |

引用计数是 AB 系统的灵魂:**谁 Retain 谁负责 Release**,否则内存泄漏。

```csharp
// 引用计数 +1
public override void Retain() { _refCount++; UpdateLastUsedTime(); }

// 引用计数 -1,降到 0 时实际卸载
public override void Release()
{
    if (--_refCount <= 0)
        _unloadAssetBundle();
}
```

资源加载完成后的回调分发也需要小心:

```csharp
private void _loadAssetCallBack(string assetName, Object asset, int ticket)
{
    // ticket 防止过期回调(已经 unload 又被旧请求触发)
    if (ticket != _currentTicket) return;
    // 加入资源字典
    _addToAssetMap(asset);
    // 通知上层
    _callback?.Invoke(asset);
}
```

弱引用 Owner 的设计:`LoadAssetByOwner(assetName, owner, ...)` 把资源生命周期绑定到某个 GameObject,owner 销毁时引用计数 -1。这适合"特效挂在角色身上,角色死了特效资源也释放"的场景。

## 六、AssetPool:实例对象池

`AssetBundleInfo` 管的是**资源引用**,`AssetPool` 管的是**实例化出来的 GameObject**。资源池化让频繁创建销毁的对象(子弹、特效、UI 控件)避免反复 Instantiate。

```csharp
class AssetPool
{
    public void Clear();                              // 清空
    public void RequestAsset(bool bAsync, Action<Object> cb, Type type = null);
    public void RecyleAsset(Object obj);              // 回收
    public bool calcActiveAvarageCount(float dt);     // 4 秒内正在使用数
    public void DeleteBySelf();                       // 定时清超时空闲
    public void ClearFree(int clearCount = 0);        // 清空闲资源
}
```

关键设计:

- **资源哈希 → 池 ID 映射**:`_assetInstantiate` 在实例化时把哈希和池 id 关联
- **平均使用量统计**:`calcActiveAvarageCount` 在 4 秒滑动窗口内算平均活跃数,决定池容量
- **定时清除**:`DeleteBySelf` 删除超过 4 秒仍存活于内存的实例

## 七、AssetPoolModule:池子管理

`AssetPoolModule` 管理多个 `AssetPool`,通过资源名称哈希做唯一池:

```csharp
class AssetPoolModule
{
    public void RequestAsset(string name, bool bAsync,
        Action<Object> cb, Type type = null);

    public void RecyleAsset(Object obj);
    public bool DeleteByOutSide(Object obj);          // 非池资源不回收
    public bool IsAssetExist(string name);

    private void _updateCalculate(float dt);          // 空闲监测
}
```

帧推逻辑:

```csharp
protected override void OnUpdate(float dt)
{
    // 刷新上次使用时间
    // AssetPool 超时销毁
    // 回收无用的 AssetPool
    _updateCalculate(dt);
}
```

## 八、AssetLocalHelper:路径与清单

Helper 抽象所有"路径解析、清单加载、依赖查询"的脏活:

```csharp
class AssetLocalHelper
{
    public bool IsAssetBundleModule();                // 是否 AB 模式
    public void LoadAllAssetDependenInfo();           // 加载依赖清单
    public string[] GetAssetBundleDepInfo(string ab); // 查依赖
    public void LoadGameBundleRes();                  // 加载资源映射
    public bool CheckAssetRes(string name);
    public string GetAssetPathByName(string name);
}
```

设计要点:**编辑器模式与 AB 模式共用同一套对外接口**,内部根据 `IsAssetBundleModule()` 切换。这样业务代码无需关心当前是不是 AB 模式。

## 九、异步加载队列:串行化外部请求

`AssetBundleASyncQueue` 把多个异步 Loader 排队,避免一拥而上:

```csharp
class AssetBundleASyncQueue
{
    public void SetContent(IAssetLocalHelper h, IAssetsFileService fm);
    public void StartABAsyncRead();
    public void Clear();
    public int GetLoaderCount();
    public void EnqueueLoader(AssetBundleLoader abl);

    public void Update(float dt);
    // 帧推:判断当前 Loader 是否加载完,完成或被同步打断则轮到下一个
}
```

为什么需要队列?Unity 异步加载有内部并发上限,大量并发请求会被排队到下一帧,反而比串行更慢。队列让"用户层异步"变成"内核层串行",减少争抢。

## 十、引用计数协议

整个框架的契约可以浓缩成四条:

1. **加载资源 → Retain**:谁请求谁 Retain
2. **使用完毕 → Release**:对应位置必须 Release
3. **依赖加载 → 自动 Retain**:目标包 Retain 时依赖包自动 Retain
4. **引用为 0 → Dispose**:释放 AB 内存,但已实例化对象保留(取决于 `Unload(false)`)

破坏任何一条都会导致泄漏或野引用。常见 bug:

- 用 `LoadAssetByOwner` 把资源绑到 UI 物体,UI 销毁用了 `DestroyImmediate` 跳过 OnDisable,引用计数没减
- 依赖包 Retain 漏掉,目标包 Unload 后依赖被释放,下次加载其它包引用同一依赖时崩溃
- 协程加载中收到 `UnloadAll`,Loader 还在跑,回调时 Info 已被释放

## 十一、使用分析:AssetBundleAnalysis

调试期挂一个分析器很有用:

```csharp
class AssetBundleAnalysisLoadInfo
{
    // 记录 AB 加载/卸载次数、使用时间
}

class AssetBundleAnalysis
{
    // 单例,汇总所有 AB 的使用统计
}
```

线上问题排查时,导出每个 AB 的加载次数、最后一次使用时间,容易找出"加载了从不卸载"或"频繁加载卸载"的元凶。

## 十二、设计要点回顾

| 组件 | 职责 | 关键点 |
|---|---|---|
| Module | 总管、帧推 | 异步队列、降级回收 |
| Loader | 单次加载任务 | 依赖先行 |
| Info | 引用计数 + 资源字典 | Retain/Release 协议 |
| Pool | GameObject 实例池 | 平均活跃数、定时清除 |
| Helper | 路径/清单/依赖 | 模式切换透明 |
| ASyncQueue | 异步串行化 | 避免并发争抢 |
| Analysis | 调试统计 | 找泄漏、找高频 |

这套设计的目标:**让业务代码只关心"拿资源",不关心"资源怎么来"**。所有引用计数、依赖链、池化逻辑都封装在框架层。

## 参考

- [Unity 内存管理:Resources.UnloadUnusedAssets](https://docs.unity3d.com/ScriptReference/Resources.UnloadUnusedAssets.html)
- [AssetBundle 加载顺序与依赖](https://docs.unity3d.com/Manual/AssetBundles-Native.html)

---

下一篇:[AssetBundle 打包管线与资源清单](#) — 整合自 EN资源打包AssetBundlePanel、资源清单、切换AB包开发模式等编辑器/打包相关笔记。
