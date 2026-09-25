---
permalink: 2024/08/10/slg-character-interaction/
title: SLG 角色与交互:交互物 / 自动扮演 / 移动手感 / 视觉表现
date: 2024-08-10 23:00:00
updated: 2024-08-10 23:00:00
tags:
  - SLG
  - ECS
  - 角色控制
  - 交互系统
  - Unity
categories:
  - [游戏开发, SLG]
comments: true
---

> 这一篇把围绕"角色"的所有零散笔记整合起来:从 ECS 框架下的交互物系统、CharacterController 的手感优化、SLG 角色自动扮演玩法,到血条 / 武器拖尾 / 绳带的视觉表现。看似主题分散,但本质上都是"如何让角色在游戏世界里活起来"。

## 一、交互物系统:ECS 框架下的前后端同构

交互物(Interactable)是关卡里所有"能交互"的对象:门、宝箱、机关、NPC、传送点。本项目用 ECS 框架统一管理,**前后端共用一套代码**。

### 模块结构

```
SystemBase
  ├── InteractHandleSystem         // 交互处理
  ├── InteractDeathSystem          // 交互物死亡
  └── HandlingInteractSystem       // 处理交互系统(前后端共用)

Component
  └── HandlingInteractComponent    // 交互组件:触发、打断、成功

Entity
  ├── InteractEntityFactory        // entity 工厂
  └── IInteractHandler             // 抽象类

Actor
  └── CombatActorInteract          // entity 初始化

Utils
  └── InteractUtils                // 对外接口,桥接 World 和 InteractEntity
```

### 调用入口

```
ServerGameLevelSystem             // 服务器关卡总控
   ↓
LevelInteractDataSubSystemImpl
   .StaticInteractSpawn();        // 创建关卡交互物
   ↓
GameModelFace.LoadAllModuleConfigs()  // 加载交互物表
   ↓
SceneGameModeConfig.xlsx          // 配置表
```

### ECS 的好处

- **前后端同构**:同一套 `HandlingInteractSystem` 在服务器跑权威逻辑,在客户端跑表现
- **数据驱动**:每个交互物的状态都是 Component 数据,方便序列化、同步、查询
- **可插拔**:新增交互类型只需要新增 Handler,不动 System

<!-- more -->

## 二、角色自动扮演:SLG 玩法构想

这是一个独立的设计构想:玩家不直接操作角色,而是扮演**时间之神(亚弗戈蒙)**,观察 NPC 的活动。

### 核心玩法

```
玩家 = 神(可多位)
   ↓ 选择一个角色
角色 = AI 驱动
   ↓ 玩家可植入"倾向"
倾向 → 影响 AI 决策
   ↓ 角色自主生活
最终结局 = AI 行为 + 倾向 + 随机事件 的涌现
```

### 世界观设定

| 神职 | 神名 | 职责 |
|---|---|---|
| 时间之神 | 亚弗戈蒙 | 玩家扮演,可赐予回溯赐福 |
| 能量之神 | 克图格亚 | 影响 battle / 物理事件 |
| 梦神 / 精神之神 | 拜亚提斯 | 影响 sanity / 梦境 |
| 反派 | 旧日支配者 | 暗中操纵信仰 |

### 派系与角色

```
人类帝国    霸王(类似格里菲斯)
精灵帝国    宰相(精灵奴隶,参考泽拉斯)
野兽帝国    兽人游侠(类似指环王叶子)
机械 AI 帝国 螳螂妖 / 天蛾人 / 蜘蛛精
鱼人、蛇人帝国 ?
```

### 剧情分支示例

以"霸王结局"为例,玩家通过信仰、伙伴关系、决策等变量影响最终走向:

```
霸王结局(信仰纯粹 ≥ 90%)
  ├── 宰相必须是伙伴,且发现旧日支配者秘密
  ├── 召唤星之彩 → 击伤三神 → 大陆分裂(一代完结)
  └── 子分支:
       ├── 纯粹统治(无挚交,信仰 ≥ 75%)
       ├── 迷途知返(信仰不足,遁入轮回)
       └── ...
```

### 设计核心:拟剧论 + 人格面具

- **拟剧论**:每个角色都有"前台"(社会面具)和"后台"(真实自我)
- **人格面具**:参考 P5,角色的"觉醒"会解锁不同能力
- **记忆 = 道具附魔核心**:所有道具的强度由"记忆"驱动,何为人也靠记忆

这种设计的本质是 **"AI 模拟 + 玩家引导" 的涌现式叙事**,适合长线 SLG,但开发难度极高(需要稳定的 AI 行为树 + 大量剧情条件触发)。

## 三、移动手感优化:告别僵硬

僵硬的角色移动是手游体验杀手。优化的核心是**惯性、加速度、动画融合**三件套。

### CharacterController 的完整实现

参考[这篇 B 站视频](https://www.bilibili.com/video/BV199w3epEQG/)的算法,核心要素:

| 要素 | 说明 |
|---|---|
| 移动 | 水平 + 垂直分开处理 |
| 跳跃 | 重力 / 蓄力 / 二段跳 |
| 下蹲 | 碰撞体缩小 + 速度衰减 |
| 奔跑 | 速度上限切换 + 动画加速 |
| 上下坡 | 角度限制 + 自动贴地 |
| 物理碰撞 | 与 Rigidbody 协作 |

### 加速度 vs 速度

僵硬的根源是"瞬时切速"。优化思路:

```csharp
// 反面:直接设速度,突兀
rigidbody.velocity = inputDir * maxSpeed;

// 正面:加速度平滑
private Vector3 currentVelocity;
currentVelocity = Vector3.SmoothDamp(
    currentVelocity,
    inputDir * maxSpeed,
    ref velocityY,    // 内部速度缓存
    accelerationTime  // 加速度时间
);
rigidbody.velocity = currentVelocity;
```

`SmoothDamp` 是 Unity 内置的平滑函数,本质是 critically damped spring(临界阻尼弹簧),不会过冲。

### 动画融合

移动手感还依赖动画的 blend tree:

```
静止 → 走 → 跑 → 冲刺
   ↑     ↑     ↑
  速度阈值 0.1 / 0.5 / 0.9
```

动画混合时间通常设 0.1-0.2 秒,太长会"漂",太短会"抖"。

### 通过碰撞速度判断状态

```csharp
private void OnCollisionEnter2D(Collision2D collision)
{
    // relativeVelocity.magnitude 是相对速度的大小
    if (collision.relativeVelocity.magnitude > maxSpeed)
    {
        Dead();
    }
    else if (collision.relativeVelocity.magnitude >= minSpeed
          && collision.relativeVelocity.magnitude < maxSpeed)
    {
        render.sprite = hurtSprite;
    }
}
```

`Collision2D.relativeVelocity` 是参与碰撞的两个物体的相对速度,`.magnitude` 是其向量长度。可以用它做:

- **摔伤判定**:从高处落下,着地速度 > maxSpeed 则死亡
- **碰撞特效**:速度区间决定不同的撞击特效
- **物理反馈**:不同速度对应不同震屏强度

## 四、视觉表现:血条 / 绳带 / 武器拖尾

这三个是角色"看起来有反馈"的最基础三件套。

### 血条

血条制作的常见方案:

| 方案 | 优势 | 劣势 |
|---|---|---|
| UI Image + FillAmount | 简单 | 大量敌人时 DC 高 |
| Mesh + 自定义 shader | 单 DC | 实现门槛 |
| Bone + SkinnedMesh | 可做曲线血条 | 复杂 |

参考[血条制作教程](https://www.yii666.com/blog/513768.html)。

### 绳带:LineRenderer 跟随

绳带是 LineRenderer 的最简应用,适合小鸟拖绳子、鞭子等:

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

只要在 Update 里设置两个端点,LineRenderer 就会自动连线。如果要更平滑的曲线,需要中间加几个控制点 + 贝塞尔曲线插值。

### 武器拖尾

武器拖尾的本质是**记录武器尖端的历史轨迹 + 用 mesh 渲染**:

```
帧 N:   武器位置 A
帧 N+1: 武器位置 B → AB 之间生成一个 quad
帧 N+2: 武器位置 C → BC 之间生成一个 quad
...
```

参考[武器拖尾制作帖子](https://blog.csdn.net/qq_27489007/article/details/89881515)。

### 三件套的共性

这三个表现都遵循同一个模式:**记录状态变化 + 用 mesh / UI 表现**。区别只在记录什么:

| 表现 | 记录对象 |
|---|---|
| 血条 | 当前 HP / Max HP |
| 绳带 | 端点位置 |
| 武器拖尾 | 历史位置队列 |

## 五、道具与设定:小细节

### 道具附魔的"焰色反应"启发

七色(红橙黄绿蓝靛紫)对应的矿石 / 元素的焰色反应,可以作为道具附魔属性的视觉锚点:

| 颜色 | 元素 | 矿石示例 | 焰色 |
|---|---|---|---|
| 红 | Sr / Li | 天青石、锂辉石 | 深红 / 紫红 |
| 橙 | Ca | 方解石、石膏 | 橙红 |
| 黄 | Na | 岩盐、硼砂 | 亮黄 |
| 绿 | Cu / Ba | 孔雀石、重晶石 | 翠绿 / 黄绿 |
| 蓝 | Cu | 蓝铜矿 | 蓝绿 |
| 靛 | In / Rb | 铟、铷 | 靛蓝 |
| 紫 | K / Rb | 钾长石 | 淡紫 |

这种"以现实化学为锚"的设计能给玩家一种"这世界是自洽的"的沉浸感。

### 武器设定示例

```
武器:瞬斩
特性:不在刀鞘或切割物体时迅速损失能量
代价:补充能量麻烦
```

这种"特性 + 代价"的双面设计,是优秀道具设计的典型范式 —— 强但有约束,玩家需要在约束内最大化收益。

## 六、性能优化要点

| 场景 | 优化 |
|---|---|
| 大量角色 | GPUInstance / ECS |
| 远距离角色 | 动画 LOD(CullingGroup) |
| 移动卡顿 | SmoothDamp 平滑,避免突变 |
| 物理碰撞 | 使用 relativeVelocity 而不是自算 |
| 武器拖尾 | 限制历史长度,周期清理 |

## 七、小结

| 模块 | 核心思路 |
|---|---|
| 交互物 | ECS 前后端同构,Component + Handler 解耦 |
| 自动扮演 | AI 驱动 + 玩家引导,涌现式叙事 |
| 移动手感 | 加速度平滑 + 动画 blend |
| 视觉表现 | 状态记录 + mesh / UI 表现 |
| 道具设计 | 特性 + 代价,现实科学为锚 |

"角色"系统的复杂度在于:既要响应玩家输入(手感),又要驱动 AI(自动扮演),还要表现物理反馈(碰撞、血条、拖尾)。这三层叠加才是一个"活的角色"。

## 参考

- [角色移动手感优化算法全解析](https://www.bilibili.com/video/BV199w3epEQG/)
- [Unity 3C 以及 Gameplay 实现记录](https://zhuanlan.zhihu.com/p/691516531)
- [CharacterController 完整实现](https://blog.csdn.net/qq_36303853/article/details/134984516)
- [血条制作](https://www.yii666.com/blog/513768.html)
- [武器拖尾制作](https://blog.csdn.net/qq_27489007/article/details/89881515)

---

下一篇:[SLG 地图与场景:TileMap / 建造系统 / 场景切换 / 视角控制](@post/2024-08-10-slg-map-scene) — 整合自建造基础逻辑、场景切换加载、RTS 边缘视角移动等笔记。
