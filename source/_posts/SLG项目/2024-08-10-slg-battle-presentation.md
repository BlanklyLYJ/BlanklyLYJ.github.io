---
permalink: 2024/08/10/slg-battle-presentation/
title: SLG 战斗表现:技能指示器 / Timeline / 武器拖尾 / 子弹时间
date: 2024-08-10 24:30:00
updated: 2024-08-10 24:30:00
tags:
  - SLG
  - 战斗表现
  - Timeline
  - Playable
  - 特效
categories:
  - [游戏开发, SLG]
comments: true
---

> 这一篇专门整合 SLG 战斗"表现层"的零散笔记:技能指示器、Timeline 动态绑定、子弹时间(无视 TimeScale)、武器拖尾、技能命中目标判定。和上一篇[SLG 战斗系统](@post/2024-08-10-slg-battle-system)互补 —— 那篇讲数据和流程,这篇讲"看起来怎么样"。

## 一、技能指示器:释放前的可视化

技能指示器是玩家"选目标 → 看到范围 → 确认释放"的关键反馈。参考[技能指示器设计](https://zhuanlan.zhihu.com/p/571357884)。

### 指示器类型

| 类型 | 适用 | 实现 |
|---|---|---|
| 圆形 | 范围 AOE | Projector + 圆形贴图 |
| 扇形 | 战士挥砍 | Mesh 顶点动态生成 |
| 直线 | 法师激光 | 拉伸的 quad |
| 六边形 | SLG 战棋 | 网格高亮(参考扁菱形 / 环形算法) |
| 自由曲线 | 弓箭抛物线 | 贝塞尔曲线 + LineRenderer |

### 与技能数据的对应

```csharp
class SkillData
{
    public Vector3 skillDirection;     // 圆形:无 / 直线:方向 / 扇形:朝向
    public int     skillRange;         // 范围
    public bool    isBlock;            // 是否被阻挡(影响指示器表现)
}
```

### 性能考虑

大量技能同时释放时,指示器会成为性能瓶颈。优化:

- 用 Projector 而不是 mesh(更便宜)
- 同帧只显示一个指示器(当前选中技能)
- 远距离 AI 不画指示器,只在玩家释放瞬间画一次

<!-- more -->

## 二、Timeline 表现技能:动态绑定 + 联合预制

技能的演出用 Unity Timeline,比纯动画更可控。但 Timeline 默认是静态绑定,需要做**动态绑定**才能配合运行时数据。

### 三个核心组件

| 组件 | 作用 |
|---|---|
| PlayableDirector | 播放 Timeline |
| UnionPrefab(联合预制体) | 技能释放后命中目标时动态创建的子预制 |
| TimelineDynamicBind | 等联合预制加载完毕后再统一调用播放 |

### 数据流

```
玩家释放技能
   ↓
加载技能 prefab(主)
   ↓ 异步
加载联合预制体(子:命中特效、Buff 特效)
   ↓
TimelineDynamicBind 等待所有 prefab 就绪
   ↓
绑定到 PlayableDirector 的 track
   ↓
开始播放 Timeline
   ↓
中途可打断 / 变速
```

### 为什么要"等加载完再播放"

如果联合预制体还没加载完,Timeline 就开始播,会出现:

- 命中瞬间特效缺失
- Buff 图标晚于动画出现
- 角色动作和特效不同步

`TimelineDynamicBind` 解决的就是这个"资源未就绪"问题。

## 三、子弹时间:无视 TimeScale 的变速

需求:**技能演出时不走 `Time.timeScale`**,允许自由变速、随时打断。

### 为什么不能用 TimeScale

`Time.timeScale = 0.5f` 会影响整个游戏(包括 UI、其他角色、网络同步),不符合"只让某个技能慢动作"的需求。

### 自己控制播放速率

```csharp
 playableGraph.GetRootPlayable(0).SetSpeed(speedMultiplier);
```

通过 `PlayableGraph` 直接控制某个 Playable 的速度,不影响全局。

### 子弹时间的实现思路

```csharp
public class SkillTimeController
{
    public PlayableDirector director;
    public float targetSpeed = 1f;
    public float currentSpeed = 1f;

    void Update()
    {
        // 平滑过渡到目标速度
        currentSpeed = Mathf.Lerp(
            currentSpeed, targetSpeed, Time.deltaTime * 5f);
        director.playableGraph.GetRootPlayable(0).SetSpeed(currentSpeed);
    }

    public void EnterBulletTime(float speed)
    {
        targetSpeed = speed;  // 0.3f 之类
    }

    public void ExitBulletTime()
    {
        targetSpeed = 1f;
    }
}
```

### 配合服务端时间

技能的"结束时机"由服务端决定(权威),但客户端要自己估算命中时间,且命中时间需要受子弹时间影响:

```
实际命中时间 = 服务端权威时间 × 子弹时间因子
```

这要求 Timeline 和子弹时间控制器**一起判断**命中时机,而不是各算各的。

## 四、技能类型矩阵:不同类型的处理

| 类型 | 命中判定 | Timeline 长度 | 子弹时间 |
|---|---|---|---|
| 持续性 | 实时计算(每帧) | 长(可循环) | 否 |
| 瞬发型 | 瞬间 | 短 | 可选 |
| 延迟瞬发 | 延迟一定时间 | 中 | 可选 |
| 偏离本体 | 全地图可点 | 中 | 否 |
| 围绕本体 | 必须以自身为出发点 | 中 | 否 |

### 命中目标列表

```csharp
public List<int> attackTargetList;  // 命中目标(友军 / 敌军)
```

PVE 战斗做在本地时,子弹时间的过程可能需要**覆盖角色的 shader**(变灰、变暗、加边缘高亮),让"被时间冻结的角色"和"正常时间内的角色"在视觉上区分开。

## 五、武器拖尾:历史轨迹 mesh

参考[武器拖尾制作](https://blog.csdn.net/qq_27489007/article/details/89881515)。

### 实现思路

```
每帧:
  1. 记录武器尖端位置 → 队列
  2. 队列长度超过阈值 → 出队老位置
  3. 用队列里的点生成 mesh(每两点形成一个 quad)
  4. 用渐变 alpha 让尾部淡出
```

### 伪代码

```csharp
public class WeaponTrail : MonoBehaviour
{
    public Transform weaponTip;        // 武器尖端
    public int maxPoints = 30;
    public float fadeSpeed = 2f;

    Queue<Vector3> positions = new Queue<Vector3>();
    Mesh mesh;

    void Update()
    {
        // 1. 记录位置
        positions.Enqueue(weaponTip.position);
        if (positions.Count > maxPoints)
            positions.Dequeue();

        // 2. 生成 mesh
        RebuildMesh();
    }

    void RebuildMesh()
    {
        var points = positions.ToArray();
        Vector3[] verts = new Vector3[points.Length * 2];
        int[] tris = new int[(points.Length - 1) * 6];

        for (int i = 0; i < points.Length; i++)
        {
            // 计算每个点的左右两侧偏移
            Vector3 dir = i < points.Length - 1
                ? points[i + 1] - points[i]
                : points[i] - points[i - 1];
            Vector3 side = Vector3.Cross(dir.normalized, Vector3.up) * 0.05f;
            verts[i * 2]     = points[i] - side;
            verts[i * 2 + 1] = points[i] + side;

            if (i < points.Length - 1)
            {
                tris[i * 6]     = i * 2;
                tris[i * 6 + 1] = i * 2 + 1;
                tris[i * 6 + 2] = i * 2 + 2;
                tris[i * 6 + 3] = i * 2 + 1;
                tris[i * 6 + 4] = i * 2 + 3;
                tris[i * 6 + 5] = i * 2 + 2;
            }
        }

        mesh.vertices = verts;
        mesh.triangles = tris;
    }
}
```

### 性能要点

- **maxPoints 不要太大**:30 个点已经够流畅
- **静止时不画**:武器速度 < 阈值就清空队列
- **shader 控制 alpha**:不要每帧改 vertex color,用 shader 的 time 参数控制

## 六、血条:从 Image 到 Mesh

参考[血条制作](https://www.yii666.com/blog/513768.html)。

### 方案对比

| 方案 | 优点 | 缺点 | 适用 |
|---|---|---|---|
| UI Image + FillAmount | 实现简单 | 大量敌人 DC 高 | 主角 / Boss |
| Mesh + 自定义 shader | 单 DC | 实现复杂 | 大量小怪 |
| Bone + SkinnedMesh | 曲线血条 | 复杂 | Boss 特效 |

### SLG 场景下的选择

- **大地图部队**:Mesh + CommandBuffer(同 HUD)
- **战斗场景**:UI Image(数量可控)
- **Boss**:独立方案(SkinnedMesh + 特效)

## 七、绳带:LineRenderer 的简化应用

绳带是武器拖尾的"静态版":不需要历史轨迹,只需要两个固定端点之间的连线。

```csharp
public LineRenderer right;
public Transform     rightPos;
public LineRenderer left;
public Transform     leftPos;

void Update()
{
    right.SetPosition(0, rightPos.position);
    right.SetPosition(1, transform.position);

    left.SetPosition(0, leftPos.position);
    left.SetPosition(1, transform.position);
}
```

适用场景:小鸟拖绳、固定绳索、鞭子静止态。

如果要弯曲,中间加控制点 + 贝塞尔:

```csharp
Vector3 Bezier(Vector3 p0, Vector3 p1, Vector3 p2, float t)
{
    return (1 - t) * (1 - t) * p0
         + 2 * (1 - t) * t * p1
         + t * t * p2;
}
```

## 八、技能模拟器:Lua 表格前置

技能模拟器要能跑,必须先加载 Lua 表格:

```csharp
LuaHelper.EnablePackAssetByLuaTable();
```

这是把策划配的技能数据(范围、伤害、特效路径等)从 Lua 表加载到 C# 侧,然后模拟器才能根据数据生成技能实例。

### 模拟器的价值

- 策划 / 美术在编辑器里直接调技能,不用跑完整战斗
- 把技能 prefab 挂到场景里,点击就能释放
- 范围指示器实时显示
- 配合子弹时间,逐帧检查命中

参考[技能模拟器设计](https://zhuanlan.zhihu.com/p/571357884)。

## 九、战斗表现的整体架构

```
玩家释放技能
   ↓
SkillManager 接收
   ↓
加载技能数据(Lua 表 → C# SkillData)
   ↓
加载 prefab(主 + 联合预制体)
   ↓
TimelineDynamicBind 等待资源
   ↓
PlayableDirector 播放
   ├── 同步:武器拖尾、特效
   ├── 同步:技能指示器(预览)
   └── 子弹时间控制器(可选)
   ↓
命中判定(实时 / 瞬间)
   ↓
命中目标表现(受击特效、shader 覆盖)
   ↓
Buff 应用(参考 Buff 设计)
   ↓
结束(服务端权威时间)
```

## 十、小结

| 模块 | 关键技术 |
|---|---|
| 技能指示器 | Projector / Mesh / LineRenderer,按类型选择 |
| Timeline 表现 | UnionPrefab + TimelineDynamicBind 等待资源 |
| 子弹时间 | PlayableGraph.SetSpeed,不依赖 TimeScale |
| 武器拖尾 | 历史轨迹队列 + mesh 重建 |
| 血条 | Image / Mesh / SkinnedMesh 按场景选 |
| 绳带 | LineRenderer + 贝塞尔(可选) |
| 技能模拟器 | Lua 表前置 + 编辑器内即时释放 |

战斗表现的本质是"**给数据穿衣服**":数据决定了伤害、范围、目标,表现决定了"看起来爽不爽"。一个好的表现系统能让 100 伤害的技能感觉像 1000,差的则相反。

## 参考

- [技能模拟器设计](https://zhuanlan.zhihu.com/p/571357884)
- [Timeline 系列教程](https://blog.csdn.net/Ha1f_Awake/article/details/101832385)
- [Playable 使用细则](https://zhuanlan.zhihu.com/p/632890306)
- [子弹时间小 demo](https://www.freesion.com/article/5377899670/)
- [武器拖尾制作](https://blog.csdn.net/qq_27489007/article/details/89881515)
- [血条制作](https://www.yii666.com/blog/513768.html)
- [烟雨迷离半世殇的战斗笔记](https://www.lfzxb.top/categories/)

---

阅读顺序建议:先看 [SLG 战斗系统](@post/2024-08-10-slg-battle-system)(流程和数据),再看这一篇(表现),最后看 [SLG 任务系统](@post/2024-08-10-slg-quest-system)(外围系统)。
