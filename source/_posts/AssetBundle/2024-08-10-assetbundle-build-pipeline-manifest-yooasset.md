---
permalink: 2024/08/10/assetbundle-build-pipeline-manifest-yooasset/
title: AssetBundle 打包管线、资源清单与 Yooasset 方案
date: 2024-08-10 23:00:00
updated: 2024-08-10 23:00:00
tags:
  - Unity
  - AssetBundle
  - 打包管线
  - 资源清单
  - Yooasset
categories:
  - [Unity, 资源管理]
comments: true
---

> 这一篇讲两件事:一是自己搭一套 AB 打包管线要解决哪些问题(资源收集、变体、分包、清单生成),二是 Yooasset 这类第三方方案为什么值得引入。

## 一、Unity 工程目录速览

理解打包管线之前,先看清 Unity 工程目录的角色分工:

| 目录 | 作用 |
|---|---|
| `Assets/` | 实际资源、代码、配置、库,只有放这里才会被 Unity 处理 |
| `Library/` | Unity 转化后的中间产物 |
| `Packages/` | Unity 2018+ 的包管理目录 |
| `ProjectSettings/` | 项目设定 |

AssetBundle 在打包阶段从 `Assets/` 收集资源,生成可分发的压缩包。

<!-- more -->

## 二、自定义打包管线

简单工程用 AssetBundle Browser 拖一下就能打。但中大型项目通常要自定义管线,解决:

- **资源命名规则**:按业务模块而非目录组织 AB
- **变体管理**:多语言、多画质(高清/标清)
- **分包策略**:基础包 + 子包,首次安装最小化
- **依赖文件自定义**:替代默认 `AssetBundleManifest`

### 核心数据结构

```
resbundle.bundle   资源名称 | 所属 AB | 编辑器路径 | 所属大包
applicationConfig  应用版本号 | 资源版本号 | 包体启用情况 | AB 路径 | hash | md5
apk_assetbundlesInfo  AB 路径 | hash | md5 | 大小 | 是否压缩
StreamingAssets.txt  依赖(Dependencies)
apkInitModules  预装模块配置
buildCofig  打包配置
```

`resbundle.bundle` 是核心:用资源名映射到 AB,替代默认 Manifest 的查找表。第三列编辑器路径专门给 Editor 模式用,这样在编辑器里直接读原始资源,无需打 AB。

### 收集器:AssetBundleFilter

```csharp
class AssetBundleFilter {
    string   directory;   // 拖拽文件夹路径
    string   assetbundle; // AB 文件名与对应路径
    string   pattern;     // 筛选文件后缀
    string   module;      // base / 分包名
    BuildOption buildOption;  // EachFile / EachFolder / WholeFolder
    bool     bExportResIndex; // 是否导出到资源映射
}
```

三种 `BuildOption`:

| 选项 | 行为 |
|---|---|
| `EachFile` | 每个文件单独成 AB |
| `EachFolder` | 每个文件夹单独成 AB(递归子目录) |
| `WholeFolder` | 整个文件夹打成一包 |

### 打包流程

```csharp
private static void _onBuildUpdate(string packType)
{
    // 第一步:收集资源信息
    AssetBundleCollect.OnCollect();

    // 第二步:生成资源清单 resbundle.bundle
    _onGenGameResInfo();

    // 第三步:根据配置生成清单、日志
    // 第四步:生成应用版本文件路径
}
```

详细步骤:

1. **创建收集器**:通过 `AssetCollector.CreateAndCollect` 遍历主路径,识别变体目录 `VAR_xxx`
2. **构建 BuildAssetInfo 列表**:记录每个文件的 AB 名、包含文件、变体、模块
3. **特殊处理**:特效分级需打到同一包;别名资源在 `.bundle` 后追加变体名
4. **合并相同 AB 的资源路径**:把分散的 `assetNames` 聚合
5. **调用 BuildScript**:走 SBP(Scriptable Build Pipeline)

```csharp
List<AssetBundleBuild> list = new List<AssetBundleBuild>();
foreach (var v in _buildDict.Values)
    list.AddRange(v.Values.ToArray());

BuildScript.BuildAssetBundles(list.ToArray(), target, option);
```

### SBP 与 Cache 服务器

Scriptable Build Pipeline(SPB)是 Unity 推荐的新打包管线,支持:

- 增量构建:依赖 hash 缓存
- 分布式:Cache 服务器协作构建
- 可定制:任务链可插入自定义 Task

```csharp
ReturnCode exitCode = ContentPipeline.BuildAssetBundles(
    parameters, content, out results, AssetBundleCompatible());

taskList = AssetBundleCompatible();
exitCode = BuildTasksRunner.RunProfiled(taskList, buildContext);
```

打包完成后,管线还要做几件附加工作:

- 生成自定义依赖文件
- 生成大包资源清单到 `Assets/DataConfig/ModuleInfoFile/`
- 输出 `applicationConfig.txt`(版本信息)

## 三、变体与多语言

变体机制是 AB 的高级特性。比如同一张图有中英两版:

```
localize-cn/hero.png
localize-en/hero.png
```

通过 `VAR_` 别名机制,把它们打成 `localize-cn.bundle` 和 `localize-en.bundle`,主包引用资源时只看名称。

切语言流程:

1. 重启游戏
2. 根据语言加载 `base + localize-en` 两个包
3. 资源清单仍用主包路径
4. 查询资源时检测到需要 `localize-en`,从分包读取替代

这样业务代码不需要拼接语言后缀,资源也不冗余。

```csharp
// 切换语言时缓存别名
CheckEnablePackAssetVariant(currentLang);
```

## 四、资源清单:热更的基石

资源清单是热更系统的核心,通常分几个层次:

### apk_assetbundlesInfo.txt —— 热更对比

```
第一列: AB 资源在 StreamingAssets/平台 下的相对路径
第二列: AB 的 hash(版本对比)
第三列: MD5(完整性校验)
第四列: 文件大小(断点续传)
第五列: 是否在压缩包中(决定下载策略)
```

启动时拿远端版本对比,不一致的资源判断 `bZip`:

- `bZip = false`:直接下载 AB
- `bZip = true`:跳过单包下载,等批量更新包

### resBundle.txt —— 资源映射

```
第一列: 资源名称(逻辑名)
第二列: 对应的 assetbundleName
第三列: 非 AB 模式下的绝对路径
第四列: 所属包体(分包/别名)
```

这一份是寻址基础。编辑器模式直接读第三列,AB 模式走第二列。

### StreamingAssets.txt —— 依赖

游戏启动时把依赖加载到内存 Map:

```csharp
_assetHelper.LoadAllAssetDependenInfo();
```

之后任何 AB 加载请求都先查这个 Map,得到依赖列表。

## 五、AB 模式切换

开发期常常需要在"直接读 Resources / AssetDatabase"和"AB 模式"间切换:

```csharp
public bool IsAssetBundleModule()
{
    // 通过宏或编辑器菜单控制
    return _useAB;
}
```

业务层接口统一,内部根据 `IsAssetBundleModule()` 决定走 AssetDatabase 还是 AB。这是减少打 AB 调试痛苦的关键设计:**调试期不开 AB,集成测试再切**。

## 六、Yooasset:第三方方案

自己造一套上述管线代价不小,社区成熟方案 Yooasset 提供了完整闭环:

- **资源收集**:基于配置的收集规则
- **打包**:支持 SBP,内置变体、分包
- **运行时**:加载、引用计数、版本管理
- **热更**:增量下载、断点续传、本地校验
- **调试工具**:资源查看、引用链追踪

### Yooasset 的核心抽象

Yooasset 把资源系统拆成几个概念:

| 概念 | 含义 |
|---|---|
| Package | 资源包,对应一组 AB |
| Collection | 收集规则,定义哪些资源进哪个包 |
| Manifest | 资源清单,运行时寻址 |
| Handle | 加载句柄,封装引用计数 |
| Operation | 异步操作,统一抽象 |

### Yooasset vs 自研

| 维度 | Yooasset | 自研 |
|---|---|---|
| 接入成本 | 低,文档完善 | 高,需要全栈能力 |
| 定制性 | 中,需 fork 改 | 高,完全自主 |
| 维护 | 社区维护 | 团队自己背 |
| Bug 风险 | 社区发现快 | 团队摸索 |

中小项目建议直接用 Yooasset;有特殊定制需求(比如 SLG 的分包策略、特殊变体逻辑)再考虑自研。

### 与 nginx 配合做热更模拟

Yooasset 文档推荐用 nginx 做本地静态资源服务器,模拟 CDN:

```nginx
server {
    listen 8080;
    root /path/to/yooasset/output;
    location / {
        autoindex on;
    }
}
```

客户端指向 `http://localhost:8080` 即可完成完整的下载、版本对比、热更流程。

## 七、打包期与运行期的契约

打包管线输出的清单必须与运行时框架严格对齐:

- 字段顺序、分隔符、编码(utf-8)统一
- 资源名约定:全小写、不带扩展名,或保留扩展名,二选一
- 路径分隔符:跨平台用 `/`
- 变体命名:统一前缀(`VAR_` 或 `.` 后缀)

破坏契约的典型表现:**编辑器跑得好好的,真机一加载就丢资源**。

## 八、小结

| 模块 | 关键 |
|---|---|
| 收集器 | 规则化资源到 AB 的映射 |
| 变体 | `VAR_` 别名机制实现多语言/多画质 |
| 分包 | 基础包 + 子包,首包最小化 |
| 清单 | 寻址、热更、依赖三件套 |
| SBP | 增量构建、Cache 服务器 |
| Yooasset | 一站式方案,中小项目首选 |

打包管线的复杂度集中在"非功能性需求":变体、分包、热更、调试支持。业务功能可以一周写完,这些基础设施往往要迭代几个月。能用 Yooasset 就别自研,把精力留给业务。

## 参考

- [Yooasset 官方文档](https://www.yooasset.com/docs/Introduce)
- [Unity Scriptable Build Pipeline](https://docs.unity3d.com/Packages/com.unity.scriptablebuildpipeline@latest)
- [Unity AssetBundle Variants](https://docs.unity3d.com/Manual/AssetBundles-Variants.html)

---

下一篇:[luban 导表体系:从配置到代码生成](#) — 整合自 luban 基础介绍、导表支持、源码分析、二进制读取笔记。
