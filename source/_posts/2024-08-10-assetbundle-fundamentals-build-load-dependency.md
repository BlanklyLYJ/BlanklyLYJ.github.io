---
title: Unity AssetBundle 基础:打包、加载与依赖管理
date: 2024-08-10 22:00:00
updated: 2024-08-10 22:00:00
tags:
  - Unity
  - AssetBundle
  - 资源管理
  - 热更新
categories:
  - [Unity, 资源管理]
comments: true
---

> 这一篇把 AssetBundle 的概念、打包流程、压缩方式、加载 API 和依赖体系串成一个完整脉络,看完应该能回答三个问题:为什么要用 AB、怎么打 AB、怎么加载 AB 才不会丢资源。

## 一、为什么需要 AssetBundle

Unity 自带 `Resources` 目录可以做到运行时加载,但在中型项目里它几乎是反模式:

| 维度 | AssetBundle | Resources |
|---|---|---|
| 资源分布 | 多个 AB 包,按需切分 | 一个大包,启动时索引 |
| 存储位置 | 任意可写路径(便于热更) | 必须放 `Resources/` |
| 压缩方式 | LZMA / LZ4 / 不压缩可选 | 统一二进制 |
| 动态更新 | 支持,热更核心方案 | 打包后只读 |
| 启动开销 | 按需加载,启动快 | 启动时构建索引,资源越多越慢 |

AssetBundle 是 Unity 提供的资源压缩包格式,核心价值在于:

- **存储位置自定义**:可写入持久化路径,从而支持热更新
- **压缩方式灵活**:可在体积和加载速度之间权衡
- **动态加载/卸载**:即用即加载,降低运行时内存峰值
- **后期更新能力**:非核心资源走服务器,首包体积可控

<!-- more -->

## 二、AB 包的物理结构

AssetBundle 像一个传统的压缩包,由两部分组成:

- **包头(Header)**:包含标识符、压缩类型、内容清单(Manifest)。清单是一个以 Object name 为键的查找表,每个条目给出该 Object 在数据段的字节索引。Windows / OSX / iOS 上用红黑树实现,构建时间随包内资源数线性增长。
- **数据段(Data)**:实际资源字节流。

## 三、压缩方式对比

Build 时三种选择:

| 压缩方式 | 体积 | 解压速度 | 适用场景 |
|---|---|---|---|
| NoCompression | 最大 | 最快 | 调试,不建议生产 |
| LZMA | 最小 | 最慢(用任一资源需解整包) | 网络分发,下载后转 LZ4 |
| LZ4 | 略大 | 快(按需解压) | **推荐本地运行使用** |
| LZ4HC | 中等 | 快 | 高压缩比 LZ4 变体 |

实际项目常见组合:**远端用 LZMA 下载,本地解压为 LZ4 缓存**。

## 四、打包工具:AssetBundle Browser

Unity 官方插件 AssetBundle Browser 提供三个面板:

- **Configure**:查看当前 AB 包构成(大小、资源、依赖)
- **Build**:打包设置(Build 按钮直接出包)
- **Inspect**:查看已打好的 AB 包详情

Unity 2019 可在 Package Manager 直接安装;2020 之后需到 GitHub 下载压缩包,解压到工程 `Packages/` 目录下。

资源归属 AB 包的设置方式:在资源 Inspector 面板底部下拉选择所属 AB 包,或 New 新建一个。

## 五、加载 API 速查

```csharp
// 1. 同步加载 AB 包(注意:AB 包不能重复加载)
AssetBundle ab = AssetBundle.LoadFromFile(path);

// 2. 从 AB 包加载资源 —— 多种重载
T obj = ab.LoadAsset<T>(resName);                  // 泛型,推荐
Object obj = ab.LoadAsset(resName);                // 非泛型,需强转
Object obj = ab.LoadAsset(resName, typeof(T));     // 类型参数,防重名

// 3. 异步加载资源
T obj = await ab.LoadAssetAsync<T>(resName);
Object obj = await ab.LoadAssetAsync(resName, typeof(T));

// 4. 卸载 AB 包
ab.Unload(false);   // false:保留已加载资源;true:连同资源一起卸
AssetBundle.UnloadAllAssetBundles(false);
```

`Unload(false)` 与 `Unload(true)` 的取舍是 AB 系统的核心坑点之一:`false` 保留已实例化资源但释放 AB 内存,`true` 一刀切可能导致已实例化对象丢失引用。

## 六、依赖:为什么"资源不全"

AB 包之间天然存在依赖关系。典型场景:一个 UI 预制体被打入 `ui.bundle`,但它引用的贴图、材质被打入 `texture.bundle`。如果只加载 `ui.bundle`,这些引用会丢失。

Unity 的解决方式是**主包 Manifest**:

- 打包完成后自动生成一个主包(名称随平台变化:`StandaloneWindows` / `iOS` / `Android`)
- 主包内的 `AssetBundleManifest` 资源记录所有 AB 包的元信息:版本号、CRC、依赖链

```csharp
// 加载主包
AssetBundle mainAB = AssetBundle.LoadFromFile(basePath + mainABName);
// 提取 Manifest
AssetBundleManifest manifest = mainAB.LoadAsset<AssetBundleManifest>("AssetBundleManifest");
// 查询某 AB 包的所有依赖
string[] deps = manifest.GetAllDependencies(abName);
```

加载流程必须**先加载依赖、再加载目标包**,否则引用断裂。

## 七、平台路径与主包名

跨平台需要根据宏切换基础路径和主包名:

```csharp
private string BasePath =>
#if UNITY_EDITOR || UNITY_STANDALONE
    Application.dataPath + "/StreamingAssets/";
#elif UNITY_IPHONE
    Application.dataPath + "/Raw/";
#elif UNITY_ANDROID
    Application.dataPath + "!/assets/";
#endif

private string MainABName =>
#if UNITY_EDITOR || UNITY_STANDALONE
    "StandaloneWindows";
#elif UNITY_IPHONE
    "iOS";
#elif UNITY_ANDROID
    "Android";
#endif
```

## 八、最小可用 AB 加载器

下面是一个完整的、带缓存与依赖处理的最小加载器,可以作为入门模板:

```csharp
public class ABManager : MonoSingleton<ABManager>
{
    private Dictionary<string, AssetBundle> _cache;
    private AssetBundle _mainAB;
    private AssetBundleManifest _manifest;

    protected override void Init()
    {
        _cache = new Dictionary<string, AssetBundle>();
    }

    private AssetBundle LoadABPackage(string abName)
    {
        // 懒加载主包
        if (_mainAB == null)
        {
            _mainAB = AssetBundle.LoadFromFile(BasePath + MainABName);
            _manifest = _mainAB.LoadAsset<AssetBundleManifest>("AssetBundleManifest");
        }

        // 先把所有依赖加载进缓存
        foreach (var dep in _manifest.GetAllDependencies(abName))
        {
            if (!_cache.ContainsKey(dep))
                _cache[dep] = AssetBundle.LoadFromFile(BasePath + dep);
        }

        // 目标包本身
        if (_cache.TryGetValue(abName, out var cached)) return cached;
        var ab = AssetBundle.LoadFromFile(BasePath + abName);
        _cache[abName] = ab;
        return ab;
    }

    // 泛型同步加载
    public T Load<T>(string abName, string resName) where T : Object
        => LoadABPackage(abName).LoadAsset<T>(resName);

    // 异步加载(协程回调)
    public void LoadAsync<T>(string abName, string resName, Action<T> cb) where T : Object
        => StartCoroutine(CoLoad(abName, resName, cb));

    private IEnumerator CoLoad<T>(string abName, string resName, Action<T> cb) where T : Object
    {
        var req = LoadABPackage(abName).LoadAssetAsync<T>(resName);
        yield return req;
        cb?.Invoke(req.asset as T);
    }

    public void Unload(string abName)
    {
        if (_cache.TryGetValue(abName, out var ab))
        {
            ab.Unload(false);
            _cache.Remove(abName);
        }
    }

    public void UnloadAll()
    {
        AssetBundle.UnloadAllAssetBundles(false);
        _cache.Clear();
        _mainAB = null;
        _manifest = null;
    }
}
```

注意几点:

1. **缓存字典**解决"AB 包不能重复加载"的限制
2. **懒加载主包**:第一次加载任何资源时才解析 Manifest
3. **多套重载**:为兼容 Lua 等对泛型支持差的语言,提供 `Load(abName, resName, Type)` 重载
4. **异步回调用 `Action<T>`**:协程 + 委托的组合比 `Task` 更易与现有逻辑衔接

## 九、AB 与热更新

热更逻辑的基石是 AB 与资源清单。典型清单字段:

| 列 | 含义 |
|---|---|
| AB 资源在 StreamingAssets 下的相对路径 | 定位 |
| Hash 值 | 版本对比 |
| MD5 | 完整性校验 |
| 文件大小 | 断点续传 |
| 是否在压缩包内 | 决定下载策略 |

启动时拿远端清单与本地清单对比 hash,不一致的资源走下载流程,这就是热更的最小可行实现。

## 十、小结

| 概念 | 关键点 |
|---|---|
| AB 包结构 | Header + Data,红黑树索引 |
| 压缩 | 远端 LZMA、本地 LZ4 |
| 主包 Manifest | 包含所有 AB 的依赖元信息 |
| 加载顺序 | 先依赖、后目标 |
| 缓存 | 必须缓存,AB 不能重复 LoadFromFile |
| Unload(false) | 释放 AB 内存,保留已加载资源 |

下一篇会进入工程化层面:Loader / Module / Pool 三件套如何组织出一个可上线的 AB 框架。

## 参考

- [Unity Manual: AssetBundles](https://docs.unity3d.com/Manual/AssetBundlesIntro.html)
- [AssetBundles-Browser (GitHub)](https://github.com/Unity-Technologies/AssetBundles-Browser)
- [Unity 文档:AssetBundle Manifest](https://docs.unity3d.com/ScriptReference/AssetBundleManifest.html)

---

下一篇:[AssetBundle 框架设计:Loader / Module / Pool 三件套](#) — 整合自 AssetBundleModule、AssetBundleLoader、AssetBundleInfo、AssetPool、AssetLocalHelper 等框架层笔记。
