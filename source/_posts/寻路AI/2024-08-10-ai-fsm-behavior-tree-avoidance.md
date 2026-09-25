---
title: 游戏 AI 决策:FSM 有限状态机与行为树,以及空间数据结构
date: 2024-08-10 22:30:00
updated: 2024-08-10 22:30:00
tags:
  - AI
  - FSM
  - 行为树
  - RVO
  - 空间数据结构
  - 四叉树
categories:
  - [算法, 寻路]
comments: true
---

> 这一篇把游戏 AI 决策层(FSM / 行为树)和动态避障(RVO/ORCA)、空间数据结构(四叉树 / 八叉树 / BVH / BSP / k-d 树)打包讲清楚。这两块都属于"AI 系统"范畴:决策决定 NPC **想干什么**,避障决定**怎么走才不撞**,空间数据结构则是上面两层性能保障的底座。

## 一、FSM:有限状态机

### 核心思想

NPC 在任意时刻处于**某一个**状态,事件触发后切换到另一个状态。状态数有限、当前状态唯一,所以叫"有限状态机"。

经典三件套:

- **State(状态)**:定义在该状态下 NPC 的行为。
- **Context(上下文)**:持有当前状态,把请求转发给状态对象。
- **Transition(转移)**:在状态的 Handle 里根据条件切换状态。

### C# 状态模式实现

```csharp
public interface IState
{
    void Handle(Context context);
}

public class StateA : IState
{
    public void Handle(Context context)
    {
        Console.WriteLine("当前状态:StateA");
        if (/* 某些条件 */)
        {
            context.CurrentState = new StateB();
        }
    }
}

public class StateB : IState
{
    public void Handle(Context context)
    {
        Console.WriteLine("当前状态:StateB");
        if (/* 某些条件 */)
        {
            context.CurrentState = new StateA();
        }
    }
}

public class Context
{
    public IState CurrentState { get; set; }

    public Context(IState initialState)
    {
        CurrentState = initialState;
    }

    public void Request()
    {
        CurrentState.Handle(this);
    }
}
```

使用方式:

```csharp
var context = new Context(new StateA());
context.Request();   // StateA 处理,可能切到 StateB
context.Request();   // StateB 处理
```

### 优缺点

- 优点:结构清晰、易维护、状态切换显式可见。
- 缺点:状态一多,转移逻辑指数级膨胀。每帧 `new StateB()` 还有 GC 压力,工程上通常用**状态对象池 / Flyweight 模式**复用单例。

<!-- more -->

FSM 适合简单 NPC(巡逻 ↔ 追击 ↔ 攻击 ↔ 逃跑),一旦状态超过十几个、转移条件复杂,就该上**行为树**了。

## 二、行为树 Behavior Tree

行为树是 FSM 的"升级版",用树形结构组合多种**节点**,通过遍历树来决策。

### 节点类型

| 类别 | 节点 | 行为 |
| --- | --- | --- |
| 控制节点 | Sequence 顺序 | 子节点依次执行,任一失败则返回失败(类比 &&) |
| 控制节点 | Selector 选择 | 子节点依次尝试,任一成功就返回成功(类比 \|\|) |
| 控制节点 | Parallel 并行 | 同时执行多个子节点 |
| 装饰节点 | Decorator | 修饰子节点返回值(取反、重复、限次等) |
| 叶子节点 | Condition 条件 | 判断,返回成功 / 失败 |
| 叶子节点 | Action 行为 | 执行具体逻辑(移动、攻击、播放动画) |

### 行为树 vs FSM

| 维度 | FSM | 行为树 |
| --- | --- | --- |
| 复杂度 | 状态多时转移爆炸 | 模块化、可复用 |
| 切换逻辑 | 显式 `CurrentState = new ...` | 隐式:每帧从根遍历 |
| 可读性 | 状态图直观 | 树形优先级直观 |
| 调试 | 转移条件散落各状态 | 集中在树结构 |
| 适用 | 简单 NPC | 复杂 BOSS、伙伴 AI |

行为树更适合"AI 优先级会随时变化"的场景:每帧重头评估,自然支持"巡逻途中看到敌人立刻切追击",而 FSM 要在巡逻状态里写"看到敌人 → 切追击"的转移。

## 三、RVO / ORCA:动态避障

寻路只解决"我要去哪",但路上会有其他单位。如果每个人都沿固定路径走,会撞成一团。**RVO(Reciprocal Velocity Obstacles)** / **ORCA(Optimal Reciprocal Collision Avoidance)** 是业界标准局部避障算法。

### 几何直觉

1. 有两个单位 Pa、Pb,记录他们的位置和速度。
2. 计算 Pa 相对 Pb 的位置 Pb - Pa,再除以时间 t 转到速度空间。
3. 把 Pa 半径叠加到 Pb 上,Pa 简化为一个点;以 Pa 为圆心,与新 Pb 相切的椎体区域就是"不可经过"区域(穿过就会撞)。
4. 算相对速度 Vc = Va - Vb,如果 Vc 终点落在不可经过区域 → **需要避障**;否则不需要。

### 速度修正

如果需要避障,从 Vc 终点向椎体边界做垂线,得到修正向量 Vu:

- Vc 落在两条切线垂线组成的四边形中:Vu = Pb 圆心 - Vc 终点。
- Vc 落到垂线后方:挑离切线垂直方向最近的方向做修正。
- 通常双方各承担一半:`Va += Vu/2, Vb -= Vu/2`,但若 Pb 速度不可改,只能 `Va += Vu`。

### 多目标与同屏优化

- 多个障碍 → 多个 ORCA 区域做交集 / 叠加,有时"安全区域"为空,只能挑次优解。
- **万人同屏**的关键是**并行化**:**Unity DOTS + Burst + Job System + Entities**,把所有单位的位置 / 速度塞进 NativeArray,Job 里并行算 ORCA 修正,能稳定跑万级单位。

## 四、空间数据结构:AI 查询的底座

技能范围查询、视野判定、AOI、近战判定,本质都是"在空间里找附近的东西"。线性遍历 O(n) 在大量单位下不可接受,需要空间分区结构。

| 结构 | 维度 | 划分方式 | 适用 |
| --- | --- | --- | --- |
| 四叉树 QuadTree | 2D | 递归四分 | 2D 游戏 / 技能范围 |
| 八叉树 Octree | 3D | 递归八分 | 3D 空间分区 |
| BVH | 任意 | 包围盒层次 | 光追、碰撞 |
| BSP | 任意 | 超平面二分 | 室内关卡、渲染排序 |
| k-d 树 | k 维 | 沿轴交替二分 | 最近邻搜索 |
| Spatial Hash | 任意 | 哈希分桶 | 均匀分布的大世界 |
| Linear BVH | 3D | BVH + Morton 码 | GPU 友好 |

### 八叉树 / 四叉树代码骨架

```csharp
struct TreeBaseData
{
    public int x;          // 坐标 x
    public int z;          // 坐标 z
    public int border;     // 边长
}

class QuadTree
{
    public TreeBaseData data;
    public List<object> objectList = new();

    public QuadTree topLeft;
    public QuadTree topRight;
    public QuadTree botLeft;
    public QuadTree botRight;

    // 提供:包围盒是否进入本子树、增删改查物体
    public bool Contains(Bounds b) { /* ... */ return false; }
    public void Insert(object obj) { /* 判断落到哪个子树 */ }
    public void Remove(object obj) { /* ... */ }
    public List<object> Query(Bounds b)
    {
        var result = new List<object>();
        // 递归收集所有相交子树的对象
        return result;
    }
}
```

### 工程优化要点

- **MMO 配合 AOI 思想**:只在玩家周围生成八叉树子树,远处用粗粒度树,局部同步压力小很多。
- **帧同步**游戏必须所有地方都插值 / 查询一致,老老实实全图建树。
- **SDF(Signed Distance Field)** 在 AI 避障、流场寻路上也越来越常见,可以预先把"距离最近障碍的距离"烘焙成场,运行时查询 O(1)。
- **Linear BVH** 用 Morton 码做空间排序,把 BVH 构建成线性结构,GPU 友好,光追 / 大规模粒子碰撞必备。

## 五、组合:一套完整的 AI 系统长什么样

```text
[决策层]  行为树 / FSM      →  决定"想去哪、想做什么"
   ↓
[全局寻路]  NavMesh + A*    →  算出区域级路径
   ↓
[路径平滑]  漏斗算法         →  把区域序列变成折线
   ↓
[局部避障]  RVO / ORCA      →  和周围单位动态避让
   ↓
[移动执行]  物理 / 动画根运动
```

辅助子系统:

- **空间数据结构**支撑技能范围、视野、声音感知、AOI。
- **流场**用于 RTS 这种"一个目标 + 海量单位"的极端场景。
- **DOTS / Job System** 把所有可以并行的部分塞进多线程。

游戏 AI 的工程难度从来不是"会写一个 A* 或一个行为树",而是把这些子系统**组装成一个稳定、可调试、可扩展的整体**。决策、寻路、避障、空间查询这四块缺一不可,任何一块短板都会让 NPC 看起来"很蠢"。
