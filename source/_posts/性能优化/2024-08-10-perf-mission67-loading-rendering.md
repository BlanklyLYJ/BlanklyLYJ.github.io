---
permalink: 2024/08/10/perf-mission67-loading-rendering/
title: Unity 性能优化(六):加载优化与渲染模块 CPU/GPU 压力
date: 2024-08-10 21:30:00
updated: 2024-08-10 21:30:00
tags:
  - Unity
  - 性能优化
  - 加载优化
  - 渲染
  - DrawCall
  - 合批
  - Shader
categories:
  - [Unity, 性能优化]
comments: true
---

> 这是性能优化系列的最后一篇(也是最长的一篇),主线是 Mission 6 + Mission 7:加载优化 + 渲染模块 CPU/GPU 压力。加载卡顿、合批策略、剔除、Overdraw、Shader 复杂度、后处理——这些是渲染层面的常见战场,也是项目后期最容易出问题的地方。

## 一、加载优化:三个隐藏的耗时峰值

### 1.1 Shader 解析与编译

Shader 加载到内存触发 `Shader.Parse()`,实例化触发 `Shader.CreateGPUProgram()`。忽视 Shader 加载策略,会在游戏过程中产生明显的耗时峰值。

**优化策略**:

- **预热**:游戏开始时用 `ShaderVariantCollection` 把常用 Shader 变体预编译
- **按需加载**:不在场景切换瞬间加载所有 Shader
- **分帧**:Shader.Parse 拆到多帧,避免单帧峰值

### 1.2 Resources.UnloadUnusedAssets

Unity 遍历所有资源引用并卸载 Unused 对象的 API,场景切换时 Unity 自动调用,也可手动调用。

**耗时公式**:`(GameObject 数量 + Mono 对象数量) × Asset 数量`。

| 场景 | 建议 |
|---|---|
| 场景切换 | Unity 自动调用 |
| 不切场景 | 每 5-10 分钟手动调用一次 |
| 战斗中 | 不要调用(会卡顿) |

**优化**:

- 减少 Material 和粒子系统数量(降低 GameObject 数量)
- 提前卸载明确不再使用的资源(降低 Asset 数量)

### 1.3 异步加载优先级

`Application.backgroundLoadingPriority` 限制主线程的集成时间(单帧内异步操作最长时间)。

| 设置 | 单帧时间 |
|---|---|
| ThreadPriority.Low | 2ms |
| ThreadPriority.BelowNormal(默认) | 4ms |
| ThreadPriority.Normal | 10ms |
| ThreadPriority.High | 50ms |

**策略**:

- **战斗场景**:用 Low,不影响主线程性能
- **加载界面**:用 High,尽量缩短加载时间

<!-- more -->

## 二、渲染模块 CPU 压力:合批与剔除

CPU 端的渲染压力主要来自两个动作:**Batching(合批)** 和 **Culling(剔除)**。

### 2.1 四种合批方式对比

| 方式 | 原理 | 优点 | 缺点 | 适用 |
|---|---|---|---|---|
| **手动合并 Mesh** | 用 `Mesh.CombineMeshes` 合并 | 完全可控 | 无法单独剔除,内存翻倍 | 静态、相近物体 |
| **Static Batching** | 静态物体合并成大网格 | DC 间状态切换少 | 内存翻倍,不可改 Transform | 静态场景 |
| **Dynamic Batching** | 小网格 CPU 转换顶点后合并 | 无内存开销,适用运动物体 | 顶点数 ≤ 300,有 CPU 开销 | UI、粒子、Sprite |
| **GPU Instancing** | 一次 DC 渲染同 Mesh 多副本 | 无内存开销,无顶点限制 | 优先级低于 SRP/Static,需 Shader 支持 | 草海、树林、批量敌人 |
| **SRP Batcher** | 同 Shader 物体用 UniformBuffer 批量传参 | 降低 SetPass,支持动态物体 | 需 SRP 环境,Shader 要适配 | URP/HDRP 项目 |

**优先级**:SRP Batcher / Static Batching > GPU Instancing > Dynamic Batching。

### 2.2 Static Batching 详解

把场景中**不会移动**的游戏对象合并组成大网格,然后绘制。所有子模型顶点变换到世界空间,创建共享顶点和索引缓存。

- **效果**:DC 数量不减少,但 DC 间渲染状态切换大幅减少
- **使用**:Player Settings 开 Static Batching + Inspector 勾选 Static
- **运行时**:`StaticBatchingUtility.Combine(root)` 把运行时创建的对象静态合批
- **缺点**:相同 Mesh 的每个对象都复制一份插入大网格,**内存翻倍**

> Mesh 重复率高的场景慎用 Static Batching(GPU Instancing 更合适)。

### 2.3 Dynamic Batching 详解

针对**小网格**(顶点数 ≤ 300、顶点属性 ≤ 900),CPU 转换顶点到世界空间,合并相同配置的顶点。

- **效果**:代价最小地合并 Mesh,降低 DC
- **优点**:无额外内存开销,可应用于运动物体,UI 容易满足条件
- **缺点**:CPU 持续计算开销,新一代 API(Metal/Vulkan)批次间消耗已很低,可能反而亏
- **开启**:Built-in 管线在 Player Settings 开启,URP 在 URP Asset 设置

### 2.4 GPU Instancing 详解

一次 DC 渲染同 Mesh 的多个副本(实例)。Unity 把所有符合要求对象的位置、缩放、UV、lightmapindex 等信息放入 ConstantBuffer,渲染时按 InstanceID 取出。

- **效果**:一个 DC 渲染同材质同 Mesh 的 N 个副本
- **使用**:材质界面勾选 `Enable GPU Instancing`,或脚本 `Graphics.DrawMeshInstanced`
- **限制**:同 Mesh + 同 Material + Shader 支持
- **变体添加**:用 `MaterialPropertyBlock` 设置 per-instance 属性(颜色等)不会打断 Instancing

```csharp
// 推荐:用 MaterialPropertyBlock 设置每个实例的差异属性
var block = new MaterialPropertyBlock();
block.SetColor("_Color", color);
renderer.SetPropertyBlock(block);

// 反例:用 renderer.material 会复制材质,打断 Instancing
renderer.material.SetColor("_Color", color);  // 错!
```

### 2.5 SRP Batcher 详解

URP/HDRP 专用,显著降低 CPU 端 DC 准备和调度耗时。对使用相同 Shader 变体的材质,SRP Batcher 用 UniformBuffer 一次性传递信息。

**原理**:

- 传统:每个新材质重新设置各种信息
- SRP Batcher:遇到新 Shader 才重新设置;Batch 内通过 memory copy 一次传 UniformBuffer,后续绑定+绘制即可

**优点**:

- DC 数量不减少,但 DC 间设置成本大幅下降
- 支持动态物体,支持范围比 Static Batching 广
- 材质多的情况也能适用
- 节省 UniformBuffer 写入操作

**缺点**:

- 需 SRP 环境(URP/HDRP/SRP),不支持 Built-in
- Shader 要兼容 SRP Batcher
- 不支持 MaterialPropertyBlock(用就打断)
- 要控制 Shader 变体数量(变体爆炸也会打断)

### 2.6 Culling(剔除)详解

剔除把不需要渲染的对象筛掉,减少传给 GPU 的数据量。Unity 原生支持 **视锥体剔除**。

**渲染相关问题**:

- 多相机 → 即使没渲染也执行 Culling → 总 Culling 耗时高
- 小物体多 → Culling 耗时高
- 多线程渲染 + Occlusion Culling → 通常 Culling 耗时也高

**优化工具**:

| 工具 | 用途 |
|---|---|
| **CullingGroup** | API,自定义包围球剔除(粒子系统按视锥剔除等) |
| **Occlusion Culling** | 遮挡剔除,被完全挡住的对象不渲染 |
| **LOD** | 远处用低精度模型 |
| **Culling Distance** | 自定义距离剔除 |

**粒子系统剔除**:程序化粒子系统可原生剔除;非程序化粒子用 CullingGroup + 包围球代理检测——可见则播放,不可见暂停隐藏。

## 三、渲染模块 GPU 压力:三角形/像素/Shader/后处理

GPU 瓶颈主要来自四个方面:**三角形面片数、渲染像素数(Overdraw)、Shader 复杂度、后处理**。

### 3.1 定位 GPU 瓶颈

- **iOS**:XCode Metal Frame Debugger
- **Android**:Mali Graphics Debugger / Snapdragon Profiler / RenderDoc
- **Unity Frame Debugger**:配合 Statistics 面板查找

**Profiler 判断**:CPU Usage 中 `Gfx.WaitForPresent / Gfx.WaitForPresentOnGfxThread` 占比最大 → CPU 在等 GPU → GPU 瓶颈。

### 3.2 三角形面片数

Frame Debugger + Statistics 面板查找面片数激增点。

**案例**:不透明物体模型 200 万面,因为阴影 + 深度法线,实际渲染涨到 800 万。`RenderSingleCamera` 渲染平面反射时,Tris 从 22k 涨到 3.7m。

**优化**:

- LOD:远处用低精度
- 遮挡剔除:挡住的物体不渲染
- 减少 Pass(每个 Pass 都加面片)
- 减少多相机(每个相机都重新渲染)

### 3.3 Overdraw

半透明渲染(特效、UI 重叠)是 Overdraw 重灾区。

**检测**:

- Built-in 管线:Scene 视图切 Overdraw 模式
- URP:无内置 Overdraw 视图,需工具或自定义
- UWA:全方位检测 Overdraw 高的特效

**优化**:

- 减少半透明物体使用
- 控制粒子数量和网格面积
- 减少 UI 重叠
- 特效不要一次大量产生,错峰显示

### 3.4 Shader 复杂度

用 Mali Offline Compiler 离线编译 Shader,看寄存器、指令、采样次数。

**Shader 编写铁律**:

- 不用 `if` / `discard`(影响 GPU 流水线)
- 减少反三角函数等复杂运算
- 避免类型转换
- 减少纹理采样次数
- 使用低精度浮点(position/depth 除外)
- 避免 spilling

### 3.5 后处理

| 开销 | 后处理 |
|---|---|
| **无开销**(必做) | Channel Mixer、Color Adjustments、Color Curves、Lift Gamma Gain、Shadows Midtones Highlights、Split Toning、White Balance |
| **较高开销** | ColorLookup、Tonemapping(ACES in LDR)、Bloom |

> 无开销的后处理无论是否勾选都在同一 DC 内处理(在 `ColorGradingLutPass.cs` 看到)。如果能用无开销后处理达到类似效果,优先用无开销。

**HDR 中 Tonemapping**:会在 ColorGradingLut 中烘焙到内置 Lut 图,后续 UberPost 不再做高开销计算。

## 四、CPU 通用耗时优化

### 4.1 隔帧创建 / 延迟加载

不要在一帧内集中做大量创建,分散到多帧:

```csharp
// 错:一帧创建 100 个对象
for (int i = 0; i < 100; i++)
    CreateObject(i);

// 对:分 10 帧创建
if (frameCount % 1 == 0 && createIndex < 100)
    CreateObject(createIndex++);
```

### 4.2 异步加载 / 动态加载

战斗中不要做 Resources.Load 这种同步加载,用 Addressables / AB 异步加载。

### 4.3 减少不必要的轮询

- 减少 AI 计算、物理计算、动画计算频率
- 减少 Resources.UnloadUnusedAssets 轮询
- 减少 Raycast 轮询

### 4.4 UI 重建 / Animator

- 不要反复触发 UI 重建
- 不要打断 UI 合批
- 减少 Animator 的 SetActive(详见第三篇动画优化)

## 五、缓存不命中(Cache Miss):隐藏的 CPU 杀手

CPU 高速缓存(Cache)未命中会导致:

1. **延迟增加**:从主存读数据,远慢于 Cache
2. **打断指令流**:CPU 等待数据
3. **增加功耗**:从主存读取代价更大
4. **降低并行能力**:多核同时 miss 会争抢内存带宽

DOTS(ECS + Burst + JobSystem)的核心优势之一就是**内存友好**:数据按组件连续存储,Cache 命中率高,适合大规模同质数据(几万个小兵、子弹等)。

## 六、渲染优化决策清单

- [ ] Shader 是否预热(ShaderVariantCollection)
- [ ] 静态场景是否用 Static Batching
- [ ] 草海/树林是否用 GPU Instancing
- [ ] URP 项目是否开启 SRP Batcher
- [ ] Shader 变体是否剔除
- [ ] 是否启用 Occlusion Culling
- [ ] 远景是否用 LOD
- [ ] 多相机是否最小化
- [ ] 后处理是否优先无开销选项
- [ ] Raycast 是否用 NonAlloc
- [ ] Resources.UnloadUnusedAssets 是否定期调用
- [ ] 战斗中是否有不必要的 Resources.Load

## 七、收尾

渲染模块的优化是 Unity 性能里最复杂的部分,涉及 CPU 准备、GPU 计算、内存布局三个层面。

实战经验:

1. **先用 Frame Debugger 看合批**,DC 数和 SetPass 数能砍一半
2. **再用 Profiler 定位 CPU 热点**,常见的是 Camera.Render 子函数
3. **最后看 GPU**,Overdraw 和 Shader 复杂度
4. **DOTS 在大规模同质数据上几乎必选**,比如 SLG 行军线、塔防小兵

性能优化是个迭代过程,改一项 → 测一项 → 再改下一项,数据驱动而不是凭感觉。
