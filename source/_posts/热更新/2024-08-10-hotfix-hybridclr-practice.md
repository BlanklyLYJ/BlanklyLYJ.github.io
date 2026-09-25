---
permalink: 2024/08/10/hotfix-hybridclr-practice/
title: Unity 热更新实战(一):HybridCLR 接入与 DHE 差分混合执行
date: 2024-08-10 22:00:00
updated: 2024-08-10 22:00:00
tags:
  - Unity
  - 热更新
  - HybridCLR
  - IL2CPP
  - DHE
categories:
  - [Unity, 热更新]
comments: true
---

> 这是热更实战系列的第一篇,重在**怎么把 HybridCLR 跑起来**。对比类的内容(三种热更方案对比)已经在另一篇里写过,这里专注实操:从 Unity 项目接入 HybridCLR、生成热更 DLL、加载入口、补充元数据,到 DHE 差分混合执行原理。看完能直接动手集成。

## 一、为什么要选 HybridCLR(实操视角)

HybridCLR 扩充了 IL2CPP 的代码,把它从**纯 AOT runtime** 变成 **AOT + Interpreter 混合 runtime**。这意味着基于 IL2CPP 打包的游戏不仅能在 Android 平台,也能在 **iOS、Console 等限制 JIT 的平台** 高效地以混合模式执行,从底层原生支持热更。

实操层面几个关键好处:

- **零学习成本**:热更代码和 AOT 代码无缝工作,可以随意写继承、反射、多线程(volatile、ThreadStatic、Task、async),不需要额外写适配器
- **执行高效**:寄存器解释器,所有指标都大幅优于其他热更方案
- **内存高效**:热更脚本中定义的类和普通 C# 类占用一样内存
- **泛型完美支持**:AOT 泛型问题导致的 il2cpp 不兼容库,现在能在 il2cpp 下运行
- **低拒审风险**:底层是解释执行,符合 App Store/Google Play 要求,且和 il2cpp 高度集成,比 Lua 方案还安全

<!-- more -->

## 二、HybridCLR 工作原理

HybridCLR 从 Mono 的 mixed mode execution 技术得到启发,为 Unity 的 il2cpp runtime **额外提供了 interpreter 模块**。具体做了这些工作:

1. 实现了高效的元数据(dll)解析库
2. 改造了元数据管理模块,实现元数据动态注册
3. 实现了 IL 指令集到自定义寄存器指令集的 compiler
4. 实现了高效的寄存器解释器
5. 提供大量 instinct 函数提升解释器性能

一句话理解:**il2cpp 相当于 Mono 的 AOT 模块,HybridCLR 相当于 Mono 的 Interpreter 模块,两者合一成为完整 Mono**。

## 三、环境与依赖准备

### 3.1 Unity / IDE

| 工具 | 版本 |
|---|---|
| Unity | 安装 **Windows/Mac Build Support(IL2CPP)** |
| Visual Studio | 2019+,需包含 **使用 Unity 的游戏开发** 和 **使用 C++ 的游戏开发** 组件 |
| Rider | 可用,但部分项目特性兼容性需测试 |
| macOS(若打包 iOS) | macOS >= 12,Xcode >= 13 |

### 3.2 Unity 项目内准备

创建 `Assets/HotUpdate` 目录,所有热更文件放这。在该目录右键 Create → Assembly Definition,创建名为 `HotUpdate` 的程序集。

**两个选项**:

| 选项 | 行为 |
|---|---|
| **关闭 Auto Reference** | 推荐(Assembly-CSharp 作 AOT 时),避免误引用热更程序集导致打包失败 |
| **开启 Auto Reference** | 默认值,会自动引用所有 assembly 包括热更 |

> 如果选 Assembly-CSharp 作为热更程序集,要仔细划分,不然一次热更把不必要的也全更新了。

## 四、安装与配置 HybridCLR

### 4.1 安装包

主菜单 Windows → Package Manager → Add package from git URL:

```
https://gitee.com/focus-creative-games/hybridclr_unity.git
# 或
https://github.com/focus-creative-games/hybridclr_unity.git
```

打开菜单 HybridCLR → Installer...,点击安装按钮,耐心等待约 30s,看到"安装成功"日志即可。

### 4.2 配置 Hot Update Assemblies

打开菜单 HybridCLR → Settings,在 **Hot Update Assemblies** 配置项中添加 `HotUpdate` 程序集。

> HybridCLR 执行时会**剔除热更程序集**。如果 Assembly-CSharp 是 AOT 程序集,但它引用了热更程序集,打包会报错——需要把 Assembly-CSharp 也设为热更程序集,或者干脆把热更代码全部移到 HotUpdate 程序集。

### 4.3 配置 PlayerSettings

| 设置 | 值 |
|---|---|
| Scripting Backend | **IL2CPP** |
| API Compatibility Level | .NET Framework(Unity 2021+) / .NET 4.x(Unity 2019-2020) |
| Use Incremental GC | 关闭(hybridclr < v4.0.0 版本必须) |

## 五、调用热更代码:四种方式

主工程**不能直接引用**热更代码。从主工程调用热更程序集中的代码,有四种方式。

### 5.1 反射调用(最简单)

```csharp
// 加载热更 dll
byte[] assemblyData = File.ReadAllBytes("HotUpdate.dll.bytes");
Assembly ass = Assembly.Load(assemblyData);

// 反射调用静态方法
Type entryType = ass.GetType("HotUpdateEntry");
MethodInfo method = entryType.GetMethod("Main");
method.Invoke(null, null);
```

> `Assembly.Load(byte[])` 内部会复制 assemblyData,调用完即可释放原字节数组。

### 5.2 反射 + Delegate(性能好)

```csharp
Type entryType = ass.GetType("HotUpdateEntry");
MethodInfo method = entryType.GetMethod("Main");
Action mainFunc = (Action)Delegate.CreateDelegate(typeof(Action), method);
mainFunc();
```

### 5.3 接口 + 实现(推荐)

AOT 中定义接口,热更中实现:

```csharp
// AOT 程序集
public interface IEntry
{
    void Start();
}

// 热更程序集
class HotUpdateEntry : IEntry
{
    public void Start()
    {
        UnityEngine.Debug.Log("hello, HybridCLR");
    }
}
```

调用:

```csharp
Type entryType = ass.GetType("HotUpdateEntry");
IEntry entry = (IEntry)Activator.CreateInstance(entryType);
entry.Start();
```

### 5.4 AddComponent / Prefab 还原(最自然)

```csharp
// AddComponent
Type type = ass.GetType("Rotate");
GameObject go = new GameObject("Test");
go.AddComponent(type);

// Prefab 还原
AssetBundle prefabAb = xxxxx;
GameObject testPrefab = Instantiate(prefabAb.LoadAsset<GameObject>("HotUpdatePrefab.prefab"));
```

> 挂在热更 Prefab 上的脚本,**一定要通过 AB 才能加载出来**。这种方式不需要任何反射,跟原生启动流程相同,**推荐用于初始化热更入口代码**。

## 六、补充元数据:解决泛型问题

### 6.1 AOT 泛型限制的本质

Mono 官方文档说:由于 Mono **无法从静态分析中确定哪种方法将实现接口**,所以完整 AOT 不支持通用接口实例化。

简单说:C# 泛型在运行时为每个类型参数组合创建新类型(具体化),这依赖运行时支持 + JIT。完整 AOT 编译器无法访问运行时类型信息,**只能悲观地为所有可能的实例化编译**,但泛型可以无限递归(`T[]`、`T[][]`、`T[][][]`...),编译器无法穷举。

### 6.2 补充元数据 API

HybridCLR 提供 `RuntimeApi.LoadMetadataForAOTAssembly` 给 AOT dll **补充元数据**,补充后 AOT 想怎么写泛型怎么写泛型。

```csharp
// 加载补充元数据 dll
HomologousImageMode mode = HomologousImageMode.SuperSet;
LoadMetadataErrorCode err = RuntimeApi.LoadMetadataForAOTAssembly(dllBytes, mode);
```

### 6.3 热更入口的标准流程

```csharp
// 1. 下载资源
//   - 资源文件、ab 包
//   - 热更新 dll
//   - AOT 泛型补充元数据 dll

// 2. 加载热更 dll
Assembly ass = Assembly.Load(hotUpdateDllBytes);

// 3. 补充 AOT 元数据
foreach (var aotDll in aotDlls)
{
    RuntimeApi.LoadMetadataForAOTAssembly(aotDll.bytes, HomologousImageMode.SuperSet);
}

// 4. 启动热更入口(反射 / Delegate / 接口 / Prefab 任选)
```

## 七、打包与测试流程

### 7.1 生成与拷贝

1. 运行菜单 **HybridCLR/Generate/All**(不可遗漏!)
2. 拷贝 `{proj}/HybridCLRData/HotUpdateDlls/StandaloneWindows64/HotUpdate.dll` 到 `Assets/StreamingAssets/HotUpdate.dll.bytes`(**注意 .bytes 后缀**)
3. 补充元数据 dll 也一并拷贝

### 7.2 测试热更生效

修改 `Assets/HotUpdate/Hello.cs` 的 `Run` 函数:

```csharp
// 原
Debug.Log("Hello, HybridCLR");
// 改为
Debug.Log("Hello, World");
```

操作步骤:

1. 运行菜单 **HybridCLR/CompileDll/ActiveBuildTarget** 重新编译热更代码
2. 拷贝新的 HotUpdate.dll 到打包输出目录的 `XXX_Data/StreamingAssets/HotUpdate.dll.bytes`
3. 重新运行,屏幕显示 "Hello, World",热更生效

## 八、DHE 差分混合执行(进阶)

### 8.1 DHE 是什么

Differential Hybrid Execution(DHE)是 HybridCLR 的**进阶技术**——可以对 AOT dll **任意增删改**,智能地让**变化或新增**的类和函数以 interpreter 模式运行,**未改动**的类和函数以 AOT 方式运行,性能基本达到原生 AOT 水平。

> 注意:DHE 只在付费版本中提供。

### 8.2 DHE 原理

1. 把标记为 DHE 的程序集**也打入主包**
2. 运行时加载最新的热更 dll
3. 调用某函数时,如果**未变化** → 直接调用原生 AOT 实现
4. 如果**已变化** → 解释方式执行最新代码

实践中两个版本往往不会改太多代码,DHE 基本能接近原生性能。

### 8.3 dhao 文件

dhao 文件是 DHE 的核心:

- 包含离线计算好的"最新热更 dll 中变化的类型和函数"信息
- 运行时根据 dhao 决定:**用最新解释版本,还是调用原始 AOT 函数**
- 通过对比最新热更 dll 与打包时生成的 AOT dll 离线计算
- 没有 dhao 文件,需要额外携带原始 AOT dll,且函数变化计算代价极高

### 8.4 DHE 优势

- 未变化部分性能与原生**完全相同**,较纯解释版本提升 **3-30 倍甚至更高**
- 任意变更代码,对代码基本无入侵
- 工作流简单,不需要手动标注变化函数,工具全自动化
- 项目改造成本比纯热更版本更低
- 原生代码全部在包体中,**iOS 拒审风险大幅降低**

### 8.5 DHE 不支持的特性

- 加载 DHE 热更代码前不能执行 DHE 对应 AOT assembly 中任何代码(所以 DHE 不支持 mscorlib 等基础库差分)
- 不支持 `[InitializeOnLoadMethod]`、Script Execution Order settings
- 不支持 DHE 脚本挂在随包资源中(包括 Resources)
- 不能在 DHE 程序集中通过热更新增 extern 函数

## 九、实战接入清单

- [ ] Unity 安装 IL2CPP Build Support
- [ ] IDE 安装 C++ 工具链
- [ ] 创建 HotUpdate 程序集(关闭 Auto Reference)
- [ ] 通过 Package Manager 安装 HybridCLR
- [ ] HybridCLR/Installer 安装
- [ ] Hot Update Assemblies 配置 HotUpdate 程序集
- [ ] PlayerSettings:Scripting Backend = IL2CPP
- [ ] HybridCLR/Generate/All
- [ ] 拷贝 HotUpdate.dll 到 StreamingAssets(加 .bytes)
- [ ] 拷贝 AOT 补充元数据 dll
- [ ] 实现热更入口加载逻辑(反射 / Delegate / 接口 / Prefab)
- [ ] 实现 AOT 元数据补充(RuntimeApi.LoadMetadataForAOTAssembly)
- [ ] 资源服务器准备(dll + ab 分发)

## 十、收尾

HybridCLR 的实操链路相比 Lua 方案最大优势是**没有跨语言桥接成本**:不用生成 wrap 代码、不用写适配器、热更代码直接和 AOT 共享类型系统。

实战中最容易踩的坑:

1. **忘记 HybridCLR/Generate/All**,直接打包会失败
2. **补充元数据 dll 没拷全**,运行时泛型方法报错
3. **热更 Prefab 脚本不通过 AB 加载**,导致脚本丢失

下一篇讲 **injectFix / DHE / EN 热更策略** 的实战对比,以及客户端热更原理 + 打包/分发/加载流程。
