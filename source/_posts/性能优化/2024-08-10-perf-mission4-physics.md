---
title: Unity 性能优化(四):物理模块耗时治理(PhysX)
date: 2024-08-10 20:30:00
updated: 2024-08-10 20:30:00
tags:
  - Unity
  - 性能优化
  - 物理
  - PhysX
  - Raycast
categories:
  - [Unity, 性能优化]
comments: true
---

> 这是性能优化系列的第四篇,主线是 Mission 4:物理模块。Unity 内置 3D 物理用的是 Nvidia PhysX,2D 用的是 Box2D。物理模块的耗时大头都在 CPU 端,Profiler 里看到的 `FixedUpdate.PhysicsFixedUpdate` → `Physics.Processing` → `Physics.Simulate` 是主要耗时函数。这篇梳理物理模块的耗时点和优化套路。

## 一、物理引擎的两个流派

| 流派 | 代表 | 特点 |
|---|---|---|
| **面向对象** | Unity 3D(PhysX)、Unity 2D(Box2D) | GameObject + Component 模型 |
| **面向数据(DOTS)** | Unity Physics、Havok Physics | ECS,大批量粒子级物理 |

传统 PhysX 已经够用,DOTS 物理适合**极端场景**(几万个动态物体,如大规模战斗)。

## 二、物理耗时的影响因素

主要耗时函数 `Physics.Processing` 和 `Physics.Simulate`,耗时受这几个因素影响:

1. **调用次数**:单帧物理更新次数,受 Time 设置影响
2. **场景中物理对象数量**:Rigidbody、Collider
3. **碰撞对数量**:Contacts
4. **射线检测次数**:Raycast / Overlap

### 2.1 Maximum Allowed Timestep 和 Fixed Timestep

Time 设置里的两个关键参数:

| 参数 | 作用 | 影响 |
|---|---|---|
| **Maximum Allowed Timestep** | 单帧物理最大调用次数上限 | 越小,卡顿时物理损失越大,但单帧物理耗时上限低 |
| **Fixed Timestep** | FixedUpdate 间隔(默认 0.02s) | 越大,每秒物理次数越少 |

**关键现象**:游戏卡顿时,物理函数调用次数会**暴增**(为了追上帧时间),导致雪崩式卡顿。Maximum Allowed Timestep 就是用来限制这个的。

### 2.2 Physics.Simulate 的两种模式

- **Auto Simulation**(默认开启):Unity 自动调用 Physics.Simulate
- **手动模拟**:`Physics.autoSimulation = false` 后,脚本里手动 `Physics.Simulate(dt)`

手动模拟适合**可预测场景**(回放、确定性物理)。不需要物理模拟时直接关 Auto Simulation,能省一大笔耗时。

<!-- more -->

## 三、Auto Sync Transform:看不见的开销

默认关闭。关闭时,Transform 属性变化**不会立即同步到物理世界**,而是累积,在 FixedUpdate 模拟前批量同步。

| 设置 | 行为 | 性能 |
|---|---|---|
| 关闭(默认) | 累积同步,在物理模拟前统一处理 | 快 |
| 开启 | Transform 每次变化都强制物理同步 | 慢 |

**坑**:关闭 Auto Simulation 时如果还要用射线检测,需要开启 Auto Sync Transform,否则射线检测结果不准、UI 事件不响应。

## 四、堆内存:被忽视的 GC 来源

物理模块也会产生 GC:

- **OnTriggerEnter / OnCollisionEnter**:回调会创建 Collision 实例,分配到堆
- **Raycast / Overlap**:多返回值的版本会分配数组到堆

```csharp
// GC 高:返回数组
Collider[] hits = Physics.OverlapSphere(pos, radius);

// GC 低:预分配数组
Collider[] hits = new Collider[16];
int count = Physics.OverlapSphereNonAlloc(pos, radius, hits);

// 射线:Raycast 不分配,但 RaycastHit 是 struct(无 GC)
// RaycastHitAll 返回数组,有 GC
```

**铁律**:热路径上的物理检测一律用 **NonAlloc 版本**。

## 五、Collider:形状决定开销

| Collider | 开销 | 适用 |
|---|---|---|
| Box / Sphere / Capsule | 低 | 优先选择 |
| Mesh Collider | 高 | 复杂形状才用 |

**Mesh Collider 优化建议**:

- 尽量用多个简单 Collider 组合替代 Mesh Collider
- 一定要用时,Player Settings 开启 **Prebake Collision Meshes** 预烘焙
- 不要对动态物体用 Mesh Collider(性能爆炸)

## 六、Rigidbody:三种状态

| 类型 | 行为 | 开销 |
|---|---|---|
| **普通 Rigidbody** | 完全由物理引擎控制,响应重力和力 | 高 |
| **Kinematic(Is Kinematic = true)** | 摆脱物理引擎,由脚本控制 | 低 |
| **静态(无 Rigidbody,只有 Collider)** | 不动,作环境 | 最低 |

**关键建议**:

1. Rigidbody 会接管 Transform,**不要直接改 Transform**(会导致物理世界重新计算)
2. 用 `MovePosition` 或 `AddForce` 等 API 移动
3. 在 FixedUpdate 里移动,不在 Update 里
4. Kinematic 开销比普通 Rigidbody 小,可以动态切换 Is Kinematic 来开关物理

## 七、Trigger 优化:能用 C# 替代就用 C#

Trigger 触发的检测可以用 **Collider.Bounds + C# 逻辑** 替代,绕开物理引擎:

```csharp
// 用 C# 判断 Bounds 是否相交,替代 OnTriggerEnter
if (myCollider.bounds.Intersects(otherCollider.bounds))
{
    // 处理碰撞
}
```

这种方式在简单矩形检测场景下比 Trigger 性能更好。

## 八、Physics Layer:碰撞矩阵别全开

Project Settings → Physics → Layer Collision Matrix,**取消不必要的层间碰撞**,避免多余的 Contacts。

```
Player × Player      → 关(玩家互不撞)
Player × Enemy       → 开
Enemy × Enemy        → 关(敌人互不撞)
Bullet × Bullet      → 关
UI × Anything        → 关
```

矩阵里每勾掉一格,对应的碰撞对都被剔除,Contacts 数量直接降。

## 九、射线检测优化

### 9.1 RaycastCommand:Job 化异步射线检测

场景中碰撞体多时,射线检测耗时会暴涨。Unity 提供了 **RaycastCommand** 把射线检测 Job 化,扔到子线程执行,减少主线程耗时。

```csharp
// 主线程版本:阻塞
foreach (var ray in rays)
{
    Physics.Raycast(ray.origin, ray.dir, out hit);
}

// Job 版本:异步
var commands = new NativeArray<RaycastCommand>(rayCount, Allocator.TempJob);
var results = new NativeArray<RaycastHit>(rayCount, Allocator.TempJob);
// 填充 commands
RaycastCommand.ScheduleBatch(commands, results, 1).Complete();
```

适合**每帧大量射线检测**的场景(如 RPG 的多角色命中检测)。

### 9.2 关闭不必要的 Raycast Target

UI 模块同样有 Raycast 开销。UGUI 的 Graphic Raycaster 会遍历所有 `RaycastTarget = true` 的组件做射线检测。

不需要接收事件的 Image、Text,**关闭 Raycast Target** 即可省下检测开销。

## 十、物理优化决策清单

- [ ] Maximum Allowed Timestep 是否合理(防止卡顿雪崩)
- [ ] 不需要物理时是否关闭 Auto Simulation
- [ ] Auto Sync Transform 是否只在需要时开启
- [ ] Mesh Collider 是否最小化使用
- [ ] 热路径射线检测是否用 NonAlloc
- [ ] Rigidbody 是否用 MovePosition / AddForce 而非直接改 Transform
- [ ] Physics Layer 矩阵是否精简(关掉无关碰撞对)
- [ ] 简单 Trigger 是否能用 C# Bounds 替代
- [ ] 大量射线检测是否用 RaycastCommand Job 化
- [ ] UI 不需要点击的组件 Raycast Target 是否关闭

## 十一、收尾

物理模块优化的核心思路:**减少物理引擎的工作量**——少 Collider、少 Contacts、少射线检测、必要时整个关掉物理模拟。

实战中最容易踩的坑:**热路径上用 RaycastAll / OverlapSphere 返回数组造成 GC**,改 NonAlloc 版本能直接消除。

下一篇讲 **UI 热点函数和 DrawCall 优化**,UI 那块既有 CPU 重建又有 DC 合批,坑特别多。
