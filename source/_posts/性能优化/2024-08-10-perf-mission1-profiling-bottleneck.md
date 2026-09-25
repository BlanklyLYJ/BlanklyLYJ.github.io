---
permalink: 2024/08/10/perf-mission1-profiling-bottleneck/
title: Unity 性能优化(一):定位瓶颈与性能排查工具链
date: 2024-08-10 19:00:00
updated: 2024-08-10 19:00:00
tags:
  - Unity
  - 性能优化
  - Profiler
  - 性能分析
categories:
  - [Unity, 性能优化]
comments: true
---

> 这是 Unity 性能优化系列的第一篇,主线是 Mission 1 的内容:在动手优化之前,先搞清楚瓶颈在哪里、用什么工具去测、阈值是多少。优化不是猜,是先测量再动手。没有 Profiler 数据的优化都是耍流氓。

## 一、性能优化的"推荐值":先知道目标在哪

### 1.1 帧率与帧耗时

手游想要稳定在 30 帧,单帧耗时需要控制在 **33ms** 以内;60 帧则需要控制在 **16ms** 以内。这两个数字是优化前的第一道红线。

实际项目里,我们更关注 **峰值耗时** 而不是平均值。一帧卡到 80ms 就足以让玩家感觉到掉帧,即使后面 100 帧都是 10ms。

### 1.2 内存阈值(PSS 与 Reserved Total)

闪退大多和内存峰值有关。UWA 给的经验值是:

| 设备总内存 | PSS 推荐上限 | Reserved Total 推荐上限 |
|---|---|---|
| 2GB | 1GB 以下 | 700MB 以下 |
| 3GB | 1.5GB 以下 | 1GB 以下 |

PSS 内存大约高于 Reserved Total 200-300MB 左右(差额来自显卡、系统服务等)。Reserved Total 的大头在两块:**资源内存**(纹理、网格、AB 包)和 **Mono 堆内存**。Lua 项目还要单独关注 Lua 内存。

只有当 PSS 内存峰值控制在硬件总内存的 **0.5-0.6 倍以下** 时,闪退风险才较低。

### 1.3 渲染模块

GPU 压力受帧率、分辨率、三角形面片数、后处理、Shader 复杂度、Overdraw 等多方面影响。需要针对不同档位机型做差异化适配:高端机画质好、低端机流畅。

<!-- more -->

## 二、Unity Profiler:主力排查工具

### 2.1 三种分析模式

| 模式 | 特点 | 适用场景 |
|---|---|---|
| **目标平台(Player)** | 数据准确,但需要 Build | 推荐做最终验证 |
| **PlayMode** | 数据不准确,但方便 | 快速验证可定位的问题 |
| **EditMode** | 只检测编辑器自身 | 排查编辑器扩展问题 |

**重要**:PlayMode 的 Profiler 数据包含编辑器自身开销,不能作为性能结论的依据。最终结论一定要在真机上跑。

### 2.2 Profiler 的模块划分

Profiler 把单帧拆成多个模块,每个模块对应一类工作:

- **CPU Usage**:最常用,定位耗时函数
- **Rendering**:渲染相关(Batches、SetPass、Triangles)
- **Memory**:内存分布(系统总览,精确数据要用 Memory Profiler 包)
- **GarbageCollector**:GC 触发情况
- **Audio / Video / Physics / UI / GI / VSync**:各专项模块

### 2.3 CPU Usage 的两种视图

**Hierarchy**(层级视图):按调用栈和 Profiler Marker 把样本分组,适合定位"哪个函数慢"。

| 字段 | 含义 |
|---|---|
| Total | 该函数及子函数的总耗时百分比 |
| Self | 除去子函数的自身耗时百分比 |
| Calls | 此帧调用次数 |
| GC Alloc | 此帧产生的 GC 内存分配 |
| Time ms | 总耗时(毫秒) |
| Self ms | 自身耗时(毫秒) |

**Timeline**(时间线视图):看线程之间的关系,适合定位主线程在哪里等待子线程或 GPU。

排查 CPU 瓶颈的核心方法:

1. 切到 Hierarchy,按 **GC Alloc** 列排序,定位每帧分配
2. 再按 **Self ms** 排序,定位真正耗时函数
3. 看 Timeline 中主线程有没有"等待 GPU"的长条

### 2.4 Rendering 模块关键字段

| 字段 | 含义 |
|---|---|
| Batches Count | 批次数,影响 CPU 端提交开销 |
| SetPass Calls Count | Shader Pass 切换次数,每次都消耗性能 |
| Triangles Count | 视锥体内三角形数 |
| Vertices Count | 视锥体内顶点数 |
| Used Texture Memory | 已用纹理内存 |

**经验**:SetPass Calls 比 DrawCall 数更值得关心。一个 Shader 多个 Pass,DC 数字可能不高但 SetPass 频繁切换,仍然卡。

<!-- more -->

## 三、Frame Debugger:看渲染怎么走的

Frame Debugger 可以**逐 DrawCall 单步执行**,看每个 DC 渲染了什么、为什么没合批。

核心用法:

1. Window → Analysis → Frame Debugger
2. 运行游戏后点 Enable
3. 逐条展开 DrawCall,看 GameObject、Material、Shader、Pass

排查"为什么没合批"的标准流程:点开被拆开的 DC,看右侧面板的 **Why this draw call is not batched with the previous one**,Frame Debugger 会给出原因(Material 不同、Pass 不同、跨 Canvas、Z 不为 0、有 Mask 等等)。

## 四、Mali Offline Compiler:测 Shader 复杂度

桌面平台 Shader 跑得飞起,移动端可能就跪了。Mali Offline Compiler 可以离线编译 Shader,给出 **寄存器使用、指令数、纹理采样次数** 等指标,结合高中低分档判断 Shader 是否过重。

使用流程:

1. Shader Inspector 点 **Compile and show code**
2. 运行时通过 Frame Debugger 找到关键 Shader 的关键字
3. 把编译产物保存为 `.frag` / `.vert`
4. 喂给 Mali Offline Compiler 看输出

写 Shader 的几条铁律:

- 尽量不用 `if` / `discard`,影响 GPU 流水线
- 减少反三角函数等复杂运算
- 避免类型转换(增加开销)
- 少用 32 位高精度浮点(`position` 和 `depth` 除外)
- 避免 spilling(寄存器溢出到内存)

## 五、XCode / 移动端专项工具

iOS 上用 **XCode Metal Frame Debugger** 采集单帧 GPU 耗时,能精确到每个 Pass。Android 上有 **Mali Graphics Debugger**、**Snapdragon Profiler**、**RenderDoc** 等。

排查移动端问题的核心思路:

- **CPU 卡顿**:Unity Profiler + 真机 IL2CPP 包
- **GPU 卡顿**:Gfx.WaitForPresent 在 CPU Usage 占比最大时,说明 CPU 在等 GPU → 受 GPU 限制
- **内存峰值**:Memory Profiler 包 + 真机进程内存监控
- **包体过大**:Build Report + Asset Bundle Report

## 六、判断瓶颈位置的决策树

```
Profiler 总耗时高?
├─ CPU 主线程高
│   ├─ Gfx.WaitForPresent 高 → GPU 瓶颈,转 GPU 排查
│   ├─ Camera.Render 高 → 渲染模块 CPU 端(合批/剔除/DrawCall)
│   ├─ 物理模块高 → Physics.Processing / Simulate
│   ├─ 动画模块高 → Animator.WriteJob / Animation.Sample
│   ├─ UI 模块高 → Canvas.SendWillRenderCanvases / BuildBatch
│   └─ GC Alloc 大 → 找每帧分配的位置
├─ GPU 耗时高
│   ├─ 三角形面片多 → LOD / 剔除 / 简化模型
│   ├─ 像素填充高 → Overdraw / 半透明粒子
│   └─ Shader 复杂 → Mali 离线编译检查
└─ 内存峰值高
    ├─ 资源内存 → 纹理压缩 / AB 引用计数
    ├─ Mono 堆 → GC Alloc / 泄漏
    └─ Gfx 内存 → Read/Write / Mipmap / 双份
```

## 七、收尾:工具用对,优化才有效

性能优化最容易犯的错误是"凭感觉优化"。没有 Profiler 数据就动手,十有八九是优化错地方。**先用对工具,再谈优化**:

- 真机 Player 模式跑 Profiler,拿真实数据
- Hierarchy 排 Self ms 和 GC Alloc,定位真正大头
- Frame Debugger 看渲染流程,定位合批问题
- Mali / XCode 看 GPU,定位 Shader / Overdraw 问题

下一篇讲 **内存问题与 Gfx 内存**,先把内存基线打下来,再谈 CPU / GPU 各模块优化。
