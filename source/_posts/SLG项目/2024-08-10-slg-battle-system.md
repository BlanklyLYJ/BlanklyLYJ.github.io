---
permalink: 2024/08/10/slg-battle-system/
title: SLG 战斗系统:发起流程 / 选中 / 技能范围 / HUD / 行军线
date: 2024-08-10 22:00:00
updated: 2024-08-10 22:00:00
tags:
  - SLG
  - 战斗系统
  - 技能
  - HUD
  - Unity
categories:
  - [游戏开发, SLG]
comments: true
---

> 把分散在多篇笔记里的战斗系统知识整合到一起:从客户端发起战斗、军队选中、技能管理器、扁菱形 / 环形技能范围公式,到 HUD 的合批思路和行军线的 CommandBuffer 渲染。看完这一篇能对一个 SLG 战斗模块的整体技术栈有个宏观印象。

## 一、战斗发起流程:房主 → 服务器 → DS → 客户端

战斗的入口是房主发起,典型的链路:

```
房主 UI 点击 → CS_StartBattle(RoomId, StartBattleParam)
            → 服务器通知 DS 拉起战斗 (TPSGame_Server)
            → DS 通过 stb_join_room 通知客户端开始时间
            → 客户端进入 GamePlay / POI 流程
```

关键点:

- **客户端只负责发起**,真正拉起战斗的是服务器把战斗参数下发给 dedicated server(DS)
- DS 与客户端之间的"开始时间"通过 `stb_join_room` / `MsgBattleStbJoinRoom` 协议同步
- 客户端 `ServerPOISwitchSystem` 负责切换到战斗 POI 流程
- 玩家投票 / 重开通过 `VotingReliableMsg` 这类可靠包传递

### 玩家同步信息

进入战斗时每个玩家会打包一份同步结构上报:

```csharp
BattlePlayerSyncInfo playerSyncInfo = new BattlePlayerSyncInfo
{
    PlayerId     = player.PlayerId,
    PlayerName   = player.PlayerName,
    GroupId      = player.TeamId,
    GroupIndex   = player.TeamIndex,
    MainRoleIndex= player.Team.MainRoleIndex,
    IsAIPlayer   = player.IsAi
};

// 英雄 id 和等级
RoleInfo info = new RoleInfo
{
    RoleId = role.RoleId,
    Level  = role.Level,
};
```

注意一个常见坑:**英雄等级不等于玩家等级**。如果玩法依赖玩家等级(如匹配、奖励发放),需要在 `BattlePlayerSyncInfo` 里补字段,并在 `MsgBattleStbJoinRoom` 中透传。

<!-- more -->

## 二、军队选中:射线 + 包围盒

SLG 中点击军队的判定通常不是用 OnMouseDown,而是**手动射线 + 包围盒**:

```
鼠标点击 → 屏幕坐标转射线 → 命中军队 Collider → 命中 UI 则不算
```

实现要点:

- 用 `FingerGestures` 之类的手势插件统一管理点击事件
- 射线如果先命中 UI GameObject,则本次点击不算"选中场景对象"
- 多个军队可叠加在同一个屏幕点,需要按距离 / 阵营过滤

军队的数据结构链路:

```
EarthData (服务端同步)
  → self.syncMap 缓存
  → WORLD_SYNC_NPC_TROOP_DATA 消息
  → TroopManager / NpcTroopManager 更新
  → TroopEntity (Unity 实体)
```

相关文件:`EarthData.txt` / `Troop.txt` / `TroopHelper.txt` / `TroopManager.txt` / `TroopEntity.cs` / `WorldObjsMgr.cs`。

军队模块的技术重点(以本项目代码为例):

| 模块 | 关键技术 |
|---|---|
| HUD 显示 | Mesh 合批 + CommandBuffer.DrawMesh |
| 大量军队渲染 | GPUInstance |
| 行军线 | HUDLineRender 单 DC 绘制 |
| 寻路同步 | 服务端权威,客户端插值 |
| 军队动作 | Animator / 动画状态机 |

## 三、技能系统:管理器 / 数据 / 类型

### 技能管理器的职责

技能管理器(`SkillManager`)是技能系统的中枢,负责:

1. **预制加载**:技能 prefab、受击特效、Buff 特效
2. **Timeline 表现**:用 Unity Timeline 做技能演出,支持动态绑定时长
3. **Lua 控制 Timeline**:Lua 侧调接口触发 Timeline 播放
4. **随时打断 / 自由变速**:不走 `Time.timeScale`,自己控制播放速率(用于"子弹时间")
5. **预览模式**:场景里挂上脚本就能点击释放,方便调试

### 技能数据结构

```csharp
class SkillData
{
    public Vector3    skillDirection;     // 方向,无方向则是原地技能
    public string     skillPrefabName;    // 技能 prefab
    public int        skillRange;         // 范围(格数)
    public List<int>  attackTargetList;   // 命中目标
    public GameObject hitEffectPrefab;    // 受击特效
    public PlayableAsset skillTimeLine;   // Timeline 资源
    public BuffData   skillBuff;          // 附加 Buff
    public bool       isBlock;            // 是否被阻挡
}
```

### 技能类型矩阵

| 维度 | 取值 | 说明 |
|---|---|---|
| 持续性 | 持续 / 瞬发 / 延迟瞬发 | 持续型每帧重算命中目标 |
| 方向性 | 偏离本体 / 围绕本体 | 偏离型全地图可点,围绕型必须以自身为出发点 |
| 朝向 | 有 / 无 | 决定 prefab 是否需要旋转 |
| 命中判定 | 友军 / 敌军 | PVE 本地战斗时,子弹时间需要覆盖角色 shader |
| 结束时机 | 服务端权威 | 客户端自己估算命中时间,需考虑子弹时间影响 |

### 配合 Timeline 的资源

- **UnionPrefab(联合预制体)**:技能释放后命中目标时动态创建的子预制
- **TimelineDynamicBind**:联合预制体加载完毕后再统一调用 Timeline 播放,避免资源未就绪

### 技能模拟器的前置条件

技能模拟器要能跑,必须先加载 Lua 表格:

```csharp
LuaHelper.EnablePackAssetByLuaTable();
```

这是把策划配的技能数据从 Lua 表里加载到 C# 侧,然后模拟器才能根据数据生成技能实例。

## 四、技能范围:扁菱形与环形

六边形坐标 `(Q, R)` 下,技能范围是个有趣的几何问题。

### 环形技能

环形技能的格子计算公式:

```csharp
// m_Count 是圈数
for (int i = -m_Count; i <= m_Count; i++)
{
    for (int j = -m_Count; j <= m_Count; j++)
    {
        // 坐标相乘不能等于圈数平方,且相加绝对值不能大于圈数
        if (i * j == m_Count * m_Count || math.abs(i + j) > m_Count)
            continue;
        x.Add(new Vector2(i, j));
    }
}
```

如果要的是**圆环**(只有外圈,不是实心):

```csharp
for (int i = -m_Count; i <= m_Count; i++)
{
    for (int j = -m_Count; j <= m_Count; j++)
    {
        if (i * j == m_Count * m_Count || math.abs(i + j) > m_Count)
            continue;
        // 只保留最外圈:坐标绝对值等于圈数,或对角线绝对值等于圈数
        if (math.abs(i) == m_Count || math.abs(j) == m_Count
            || math.abs(i + j) == m_Count)
            x.Add(new Vector2(i, j));
    }
}
```

### 扁菱形技能(以人为边)

扁菱形的核心是给定起点 `(startQ, startR)` 和终点 `(endQ, endR)`,填充菱形覆盖的所有格子。算法思路:

1. **计算 Q / R 方向的位置差**:`positionQ = startQ - endQ`,`positionR = startR - endR`
2. **判断是轴向还是斜向**:Q、R 其中之一为 0 是轴向;两者绝对值相等是斜向
3. **求偏移单位向量** `leftOffset` / `rightOffset`:决定从起点和终点向两侧偏移的方向
4. **填充菱形边界**:起点周围偏移 1..absDistance,终点周围偏移 1..absDistance-1
5. **递归收缩**:把起点向终点移动一格、终点向起点移动一格,递归调用直到距离 ≤ 1

```csharp
public void RhombusSkill(int startQ, int startR, int endQ, int endR)
{
    int positionQ = startQ - endQ;
    int positionR = startR - endR;
    int absPositionQ = math.abs(positionQ);
    int absPositionR = math.abs(positionR);
    bool hasZero = positionQ == 0 || positionR == 0;
    bool leftZero = positionQ == 0;

    if (!hasZero)
    {
        if (absPositionQ != absPositionR || positionQ == positionR)
        {
            Debug.LogError("你这也对不上呀~");
            return;
        }
    }

    // 终点加入列表
    HexCoords pos = HexCoords.CreateFromQR(endQ, endR);
    m_lstRange.Add(pos);

    if (positionQ == 0 && positionR == 0) return;

    int distance = leftZero ? positionR : positionQ;
    int absDistance = math.abs(distance);

    // ... 偏移填充(略,完整代码见笔记)

    // 递归收缩到中点
    int nextStartQ = startQ - (int)math.sign(positionQ);
    int nextStartR = startR - (int)math.sign(positionR);
    int nextEndQ   = endQ   + (int)math.sign(positionQ);
    int nextEndR   = endR   + (int)math.sign(positionR);

    if (nextStartQ == endQ && nextStartR == endR) return;  // 偶数,互换位置
    RhombusSkill(nextStartQ, nextStartR, nextEndQ, nextEndR);
}
```

这种递归收缩的好处是**自动处理奇偶距离的差异**:偶数距离的菱形中点重合,奇数距离会留一格中点。

## 五、HUD:合批 + CommandBuffer

SLG 里一个屏幕上几十上百个 HUD(血条、名字、行军线),如果每个都开一个 Canvas 渲染会爆 DrawCall。本项目的做法是**收集所有可合批 HUD → 转化成 mesh 节点 → 用 CommandBuffer.DrawMesh 一次画完**。

### 数据流

```
HUDManager.InitHudAtlas()      // 启动时加载图集配置、对象池
   ↓
Troop 初始化时拿一个 HUD 实例  // 对象池
   ↓
Title 注册到 HUDTitleRender     // 按建筑 / 己方 / 敌方分到不同合批层
   ↓
HUDUtility.SetTitleItemInfo     // 业务更新数据
   ↓
LateUpdate 帧推                 // 数据 → mesh 表现
   ↓
CommandBuffer.DrawMesh          // 一次性提交到相机渲染回调
```

### LateUpdate 里做了什么

```csharp
void LateUpdate()
{
    // 1. 检查 HUD 相机是否偏移,是则打脏标记
    if (CameraMoved) bCameraDirty = true;

    // 2. 清除过期 title 和 mesh
    if (bCameraDirty) CleanExpired();

    // 3. 处理气泡(只有背景和文字,解析简单)
    ProcessBubbles();

    // 4. 静态合批:更新 vertex / uv
    UpdateStaticBatch();

    // 5. 动态合批:每个节点自己更新(因为不合批)
    UpdateDynamicBatch();

    // 6. 提交到 CommandBuffer
    SubmitToCommandBuffer();
}
```

最后相机渲染完毕会回调 `CarmeraCallback`,把之前提交的 mesh 节点按列表合批渲染。

### 性能权衡

| 方案 | 优势 | 劣势 |
|---|---|---|
| Canvas per HUD | 实现简单 | 几十 DC,无法接受 |
| Mesh + CommandBuffer | 单 DC,渲染压力低 | CPU 合批压力集中 |
| ComputeBuffer + Shader | CPU 几乎零开销 | 实现门槛高 |

如果发现 CPU 成为瓶颈(常见于大量 HUD 场景),应该往 ComputeBuffer + Shader 方案迁移。

### HUD 图集编号坑

`assets_all.txt` 规定了图集编号,**谁先有图集谁的编号靠前**。这意味着:

- 编号定下来后**不能随意增删**(否则所有引用编号都要改)
- 新增图集只能追加到最后
- 启动时需要单独为行军线之类的特殊 HUD 设置独立图集

## 六、行军线:跟随部队的 HUD

行军线和 HUD 共享同一套 mesh + CommandBuffer 机制,但有几个特点:

1. **跟随部队创建**:部队不存在(被剔除)则不显示
2. **拖拽视角时可能闪烁**:因为部队剔除是动态的,有些行军线会在视野边缘突然出现 / 消失
3. **初始化位置很关键**:部队初始化位置错了,行军线在非跟随状态下必然错位,**即使后续纠正也没用**

数据收集入口:

```csharp
// Troop 初始化时告诉行军线当前位置
HUDLineRender.Instance.RegisterTroopPosition(troopId, currentPos);

// 每帧由 HUDLineRender 统一收集所有部队 mesh
HUDLineRender.Instance.CollectMeshForFrame();
```

## 七、Buff 系统

Buff 系统的设计核心是**属性聚合 + 时间管理**:

- **属性聚合**:同一个 Buff 多次施加是叠加、刷新还是替换,需要在 BuffDef 里配置
- **时间管理**:持续时间、Tick 间隔、剩余时间,需要支持暂停 / 加速
- **状态机**:冰冻、眩晕、沉默等控制 Buff 需要打断技能、阻止行动
- **可视化**:Buff 图标、剩余时间环、堆叠层数

(具体设计参考[知乎 Buff 系统设计](https://zhuanlan.zhihu.com/p/416805924))

## 八、小结

| 模块 | 核心技术 |
|---|---|
| 战斗发起 | 房主 → 服务器 → DS → 客户端,玩家同步信息走 stb_join_room |
| 军队选中 | 射线 + 包围盒,FingerGestures 插件 |
| 技能管理 | Timeline + UnionPrefab + DynamicBind,支持打断 / 变速 |
| 技能范围 | 六边形坐标 (Q, R) 下的扁菱形 / 环形递归算法 |
| HUD | Mesh 合批 + CommandBuffer.DrawMesh,单 DC 渲染 |
| 行军线 | HUD 共享机制,跟随部队生命周期 |
| Buff | 属性聚合 + 时间管理 + 状态机 |

战斗系统的复杂度在于"模块多 + 强同步":每个模块单独看不难,合起来要把数据流、生命周期、性能全部对齐才能跑顺。

## 参考

- [Unity Timeline 系列教程](https://blog.csdn.net/Ha1f_Awake/article/details/101832385)
- [Playable 使用细则](https://zhuanlan.zhihu.com/p/632890306)
- [Buff 系统设计](https://zhuanlan.zhihu.com/p/416805924)
- [烟雨迷离半世殇的战斗笔记](https://www.lfzxb.top/categories/)

---

下一篇:[SLG 任务系统:condition / 引导 / 红点树 / 宝箱](@post/2024-08-10-slg-quest-system) — 整合自任务 condition、引导系统、红点树、宝箱系统、刷怪触发器、奖励表现六篇笔记。
