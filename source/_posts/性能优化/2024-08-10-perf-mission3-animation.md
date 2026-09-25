---
permalink: 2024/08/10/perf-mission3-animation/
title: Unity 性能优化(三):动画模块耗时治理(Mecanim + Legacy)
date: 2024-08-10 20:00:00
updated: 2024-08-10 20:00:00
tags:
  - Unity
  - 性能优化
  - Mecanim
  - Legacy动画
  - Animator
categories:
  - [Unity, 性能优化]
comments: true
---

> 这是性能优化系列的第三篇,主线是 Mission 3:动画模块。Unity 项目里动画几乎无处不在——主角、NPC、UI、特效、场景物体都在动。动画的耗时大头在 CPU 端,Profiler 里看到的 `PreLateUpdate.DirectorUpdateAnimationBegin/End` 就是 Mecanim 的工作函数。这篇把 Mecanim 和 Legacy 两套动画系统的耗时点和优化方案都梳理一遍。

## 一、Mecanim 动画系统概述

Mecanim 是 Unity 主推的动画系统,适合人形动画。它提供了:

- **Avatar + Muscles**:人体骨骼映射和肌肉调节
- **Animator Controller**:可视化状态机
- **Transition**:状态转换条件
- **Blend Tree**:混合树,用于 8 方向移动等

Mecanim 的主要耗时函数:

```
PreLateUpdate.DirectorUpdateAnimationBegin
PreLateUpdate.DirectorUpdateAnimationEnd
  ├─ Animator.ApplyOnAnimatorMove
  ├─ Animator.WriteJob          ← 骨骼 Transform 回写
  ├─ Animator.ApplyBuiltinRootMotion
  └─ Animator.Initialize        ← GameObject 激活时触发
```

**关键认知**:动画系统顶层函数自身耗时占比不高,**优化重点是子堆栈**。

<!-- more -->

## 二、Mecanim 五大优化点

### 2.1 Active Animator 数量

**Active Animator** 指场景中会触发 `Animator.ApplyOnAnimatorMove` 调用的 Animator 对象。数量越多,耗时越高。

**优化手段**:设置 Culling Mode。

| Culling Mode | 行为 | 适用 |
|---|---|---|
| **Always Animate** | 永远更新(无视可见性) | UI 动画(必须) |
| **Cull Update Transform** | 不可见时停 Retarget/IK/Write Transform,但保留状态机和根运动 | 一般角色 |
| **Cull Completely** | 不可见时全部停 | 远景 NPC |

> **坑**:UI 动画的 Animator 一定要用 `Always Animate`,否则表现会出错(UI 元素可能"看不见"但实际在视野里)。

### 2.2 Optimize Game Objects

骨骼较多的模型勾选 `Optimize Game Objects` 后,原本在主线程运行的 `MeshSkinning.CalcMatrices` 会**转移到子线程运行**,显著降低主线程压力。

具体表现:勾选后,骨骼节点的 Transform **不再回传到 C# 端**——主线程不用同步这些 Transform,耗时函数 `Animator.WriteJob` 占比会下降。

**判断标准**:如果 Profiler 里 `Animator.WriteJob` 占比高,先检查模型的 Optimize Game Objects 是否勾选。

### 2.3 Apply Root Motion

只有**动画播放时会产生位移**的对象才需要勾选 Apply Root Motion。

| 情况 | 是否勾选 |
|---|---|
| 角色走动、跑步(有位移) | 勾 |
| 角色攻击、待机(原地) | 不勾(节省耗时) |
| UI 动画 | 不勾 |

关闭它能直接省掉 `Animator.ApplyBuiltinRootMotion` 的耗时。

### 2.4 Compute Skinning(谨慎)

Compute Skinning(2019.3 前叫 GPU Skinning)看似用 GPU 算蒙皮能省 CPU,但实测勾选后**整体性能反而下降**,不建议开启。

> 这个选项在不同硬件表现差异大,如果一定要测试,务必在目标设备上跑真实场景看数据。

### 2.5 Animator.Initialize 高频调用

`Animator.Initialize` 在 **GameObject 被 Active 或 Instantiate** 时触发,耗时较高。

**反面案例**:战斗中频繁 `SetActive(true/false)` 切换角色。

```csharp
// 错误做法:频繁 SetActive
hero.gameObject.SetActive(false);
// 过会儿
hero.gameObject.SetActive(true);  // 触发 Animator.Initialize
```

**正确做法**:不用 SetActive,而是 **Disable Animator 组件 + 把对象移出视野**。

```csharp
// 推荐做法
heroAnimator.enabled = false;
heroTransform.position = OffscreenPos;
// 需要时
heroAnimator.enabled = true;
heroTransform.position = BattlePos;
```

## 三、Legacy 动画系统

Legacy 是 Unity 的老动画系统,目前还有它的舞台:**简单 UI 动画**。Legacy 性能开销比 Mecanim 小,但功能弱(无状态机)。

主要耗时函数:`PreLateUpdate.LegacyAnimationUpdate`。

### 3.1 Animation.Sample 调用次数

- **Animation.Sample 调用次数** = 场景中实际在更新的 Animation 对象数量
- **Animation.Update 调用次数** = 场景中存在的所有 Animation 对象数量

优化目标:**减少 Sample 的调用次数**(让不需要播放的 Animation 停掉)。

### 3.2 三个优化点

**CullingType 设置**:

| 模式 | 行为 |
|---|---|
| Always Animate | 总是更新 |
| Based On Renderers | 视锥体外完全不更新 |

**避免 SetActive 触发 Rebuild**:

`SetActive(true/false)` 会触发 `Animation.RebuildInternalState`,比 Mecanim 还敏感。推荐:

- 把对象移到视锥体外
- 再 Disable 动画组件
- (前提:逻辑和表现一致,移出视野不会影响游戏)

**避免重复 AddClip**:

`AddClip` 重复执行会触发 `Animation.RebuildInternalState`,需要做判断:

```csharp
// 错误:每帧都加
anim.AddClip(clip, "idle");

// 正确:判断是否已存在
if (anim.GetClip("idle") == null)
{
    anim.AddClip(clip, "idle");
}
```

## 四、Spine 动画优化(2D 项目专项)

2D 项目用 Spine 的多,Spine 优化有几个套路:

| 步骤 | 优化 | 效果 |
|---|---|---|
| 1 | JSON 转 skel(二进制) | 加载快数倍,GC 降一个数量级 |
| 2 | 贴图改非方形、非 2 的幂次,用 ASTC | 内存再降 |
| 3 | skel 的 Stream 读取改指针移动 | 加载再快一倍 |
| 4 | 重新导出,删除非必要数据,字符串移到头部用 index 索引,合并 timeline | skel 再小 50-70% |
| 5 | 跳过 animation 解析,首次使用时再解析(惰性) | 大幅减少初始耗时 |

第 5 步尤其关键——分析显示 **80%+ 的加载消耗来自 animation**,而大多数 animation 不会同时被使用。Lazy 解析能让加载从几百毫秒降到几十毫秒。

## 五、动画模块优化决策清单

实战排查顺序:

- [ ] Mecanim 角色的 Culling Mode 是否设为 Cull Update Transform
- [ ] UI Animator 是否设为 Always Animate(必须)
- [ ] 骨骼多的人物是否勾选 Optimize Game Objects
- [ ] 不需要位移的角色是否关闭 Apply Root Motion
- [ ] 战斗中是否避免对 Animator GameObject 频繁 SetActive
- [ ] Legacy 动画的 CullingType 是否设为 Based On Renderers
- [ ] AddClip 是否做了去重判断
- [ ] Spine 是否转 skel + 惰性加载 animation

## 六、收尾

动画模块的优化思路很清晰:**减少不必要的更新 + 把骨骼计算推到子线程 + 避免触发 Initialize**。

实战中最容易踩的坑有两个:

1. **UI Animator 用了 Cull Update Transform**,导致 UI 动画表现错乱
2. **战斗中频繁 SetActive 角色**,每次激活都触发 Animator.Initialize,卡顿明显

下一篇讲 **物理模块耗时**,PhysX 那一块的坑同样不少。
