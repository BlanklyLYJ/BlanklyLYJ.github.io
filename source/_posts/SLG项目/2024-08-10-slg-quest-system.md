---
permalink: 2024/08/10/slg-quest-system/
title: SLG 任务系统:condition / 引导 / 红点树 / 宝箱 / 刷怪触发器
date: 2024-08-10 22:30:00
updated: 2024-08-10 22:30:00
tags:
  - SLG
  - 任务系统
  - 新手引导
  - 红点
  - Unity
categories:
  - [游戏开发, 系统设计]
comments: true
---

> 任务、引导、红点、宝箱、刷怪触发器、奖励表现 —— 这几个看似零散的系统,本质上都是同一类东西:**条件触发 + 表现分发**。把这一套放在一起看,会发现它们的设计模式高度相似,理解一个就能举一反三。

## 一、condition 模块:任务系统的底座

condition(条件)是任务、引导、红点、商店刷新等多个系统的公共底座。一个 condition 通常长这样:

```
conditionId → 检查函数 → bool
            → 参数列表 → 支持多参数(等级提升、击杀 N 个怪、收集 K 个道具)
```

### 触发源分类

| 触发源 | 说明 | 示例 |
|---|---|---|
| 服务器触发 | 大部分 condition 由服务器主动推送 | 任务完成、活动开启 |
| 通用消息检测 | 少量需要客户端监听通用消息 | 等级提升、引导完成 |
| 时间触发 | 客户端定时检查 | 每日重置、活动倒计时 |

### 多参数支持

条件可能携带各种参数,例如"击杀 N 个 ID 为 X 的怪",这里的 N 和 X 都是参数。设计 condition 接口时要预留变长参数:

```csharp
public interface ICondition
{
    bool Check(params object[] args);
    string GetTipText();  // 点击通用提示,通过配置处理
}
```

任务本身在 condition 之上只是纯业务,不涉及底层机制。

<!-- more -->

## 二、新手引导:FlowCanvas + Luban

新手引导是手游里"看起来简单,实际很复杂"的系统。本项目用 **FlowCanvas v3.29** 给策划配置引导流程。

### 设计思路

```
FlowCanvas (策划可视化编辑)
   ↓ 导出 .fs + json
Luban json (代码读取)
   ↓
引导运行时 (按触发条件执行逻辑)
```

关键约束:

1. **导出的 json 需要符合 luban 逻辑**,允许作为正式数据加载
2. **xml 定义引导表 json 的格式**,扩展 FlowCanvas 组件(只给策划用,运行时不依赖)
3. **写工具按格式导出**,`.fs` 文件保留不动,只动 json 部分

### 引导参数分类

| 参数 | 取值 |
|---|---|
| 强弱引导 | 强引导(强制点击)、弱引导(提示但可忽略) |
| 触发时机 | 首次进入界面、服务端触发、调用触发、满足多项条件后触发 |
| 引导类型 | 场景引导、界面引导 |

### 引导事件类型

引导可执行的"动作"统一抽象成事件类型,例如:

```
1. 进入视频剧情
2. 进入角色对话(也用 condition 做条件判断)
3. 进入特定界面
4. 强制点击某个按钮
5. 强制进入战斗(战前引导也算界面引导)
```

### 表现效果

具体到界面层,引导需要支持的表现:

- 蒙黑(整体遮罩)
- 高亮某个组件(挖孔)
- 出现手指滑动方向
- 点击表现

### 引导的几个坑

实际项目踩过的坑:

1. **强引导期间界面必须全程开启**:否则玩家可能在间隙点到其他东西。挖孔遮罩 + 全屏拦截是常见做法
2. **前置条件判断**:引导 A 完成后才触发引导 B,需要一个排序机制
3. **触发条件控制**:必须等"主界面就绪"再触发,否则弹窗时序冲突会崩溃
4. **引导框支持多个**:每个引导框记录来自哪个引导,方便溯源
5. **可视化工具要谨慎选择**:FlowCanvas 适合"流程图"型逻辑,不适合复杂分支

## 三、红点树:隔帧刷新的脏标记系统

红点系统是 UI 框架的标配。本项目用**红点树**作为核心,关键设计是**隔帧刷新 + 脏节点**。

### RedDefine:红点定义

```csharp
class RedDefine
{
    public int id;              // 唯一 id
    public int parentId;        // 父节点
    public bool isStop;         // 是否计算自身数量
    public Func<bool> checkFun; // 检查函数
    public Func<int> getCount;  // 特殊数量计算
    public object checkParam;   // 多项同类型红点的区分参数
    public bool isCalcChildren; // 是否统计子节点数量
}
```

`checkParam` 的妙用:任务列表里每个任务都需要红点,但都属于"任务红点"类型。用 `checkParam` 区分具体是哪个任务的红点,避免为每条任务都定义一个红点 id。

### RedModule:模块总控

```csharp
class RedModule
{
    Pool clsPool;                  // 红点池
    Dictionary<int, RedNode> mgrMap;       // 不同类型红点控制器
    Dictionary<int, RedNode> dirtyNodeMap; // 脏节点,隔帧刷新
    List<RedNode> tempNodeList;            // 临时缓存,二次处理
    Dictionary<int, RedNode> targetMap;    // 实例 + GO 绑定
    List<RedNode> delayBind;               // 延迟绑定
}
```

### 隔帧刷新策略

红点不需要每帧都重算,正确做法:

```
帧 N: 收集所有变更的红点 → 标脏
帧 N+1: 处理脏节点 → 计算 count → 更新 GO 表现
帧 N+2: 计算红点深度(父节点 count += 子节点 count)
```

这种"标记 → 计算 → 深度更新"的三段式避免了一次刷新的卡顿。

### RedNode:节点

```csharp
class RedNode
{
    public int id;
    public RedType type;
    public int count;
    public int mgrType;
    public Dictionary<GameObject, ...> targetMap;     // 绑定对象
    public Dictionary<Text, ...> numTargetMap;        // 数量 Text
    public Dictionary<object, Action> callbackMap;    // 回调
    public RedNode parent;
    public List<RedNode> children;
    public int childCount;
    public Func<bool> checkFun;
    public object checkParam;
}
```

### 红点系统架构

```
RedDefine (定义层)
    ↓ 创建
RedNode (节点层)
    ↓ 组织成树
BaseRedMgr / 子类 Mgr (管理层)
    ↓ 调度
RedModule (总控)
    ↓ 隔帧
帧推
```

`BaseRedMgr` 提供通用接口,子类按业务定制(如 `TaskRedMgr`、`MailRedMgr`、`ShopRedMgr`)。

## 四、宝箱系统:从掉落到展示

宝箱系统是"奖励表现"的一个具体实例,涉及:

| 子系统 | 说明 |
|---|---|
| ModelItemBox | 宝箱数据模块 |
| ItemBoxInfoPopupWindowController | 宝箱信息弹窗 |
| ObtainItemBoxWindowController | 获得宝箱弹窗 |
| ObtainItemCommonWindowController | 通用道具获得弹窗(已完成) |
| 主界面宝箱区域 | 主界面 HUD |

### 二次确认弹窗

很多操作需要二次确认(刷新商店、消耗道具开宝箱):

```csharp
string content = string.Format("是否消耗{0}刷新商店？", name);
UIViewManager.Instance.ShowMessageBox(content, "",
    (int)E_MessageBox_Type.ToDayTip,
    () =>
    {
        _modelShop.Req_RefreshShop((uint)m_shopId);
    });
```

封装成通用 `ShowMessageBox` 后,所有需要二次确认的地方都能复用。

## 五、刷怪触发器:动态与静态

SLG / 关卡游戏里刷怪分两类:

| 类型 | 说明 | 触发时机 |
|---|---|---|
| 静态刷怪 | 进地图就刷的初始怪,杀完没了 | 关卡加载 |
| 动态刷怪 | 触发后刷怪,分无限 / 波次 | 任务、玩家进区域、游戏进程 |

### 动态刷怪的高级配置

策划在配置时希望支持:

1. **多区域联通**:多个刷怪区域合并为一个统一的刷怪区域(通过特定 id 关联)
2. **刷怪顺序**:联通区域内的刷怪顺序
3. **波次间隔**:上一波怪死后多久刷下一波
4. **区域内上限**:每波刷怪数量、区域内怪物上限、总刷怪数量
5. **召唤怪处理**:怪物召唤的怪物一般不参与数量统计

### 触发方式

通过 FlowCanvas 都能触发,常见模式:

| 触发条件 | 场景 |
|---|---|
| 游戏开始 | 静态刷怪 |
| 任务触发 | 守塔、清除某区域 |
| 游戏进程 | FlowCanvas 判断节点 |
| 进入区域 | 配合 `BoundaryCheckSystem` |

### 性能优化

| 方案 | 用途 |
|---|---|
| 编号管理 | 每个刷怪器手填编号,FlowCanvas 查询方便 |
| EntityCullingGroupSystem | 基于角色 / 怪距离做动画 LOD |
| 四叉树 | 空间分割加速查询(本项目暂未启用) |

`EntityCullingGroupSystem` 是人字拖那边处理过的基础流程,基于距离控制动画 LOD,后续可拓展到怪的通用性能优化。

```csharp
// 关键代码位置
LevelAIDataSubSystemImpl        // 关卡 AI 数据子系统
LevelInteractDataSubSystemImpl  // 关卡交互数据
  .StaticInteractSpawn();       // 创建关卡对应的关卡交互物
```

## 六、奖励表现:可接管的状态机

由宝箱系统引申出来的一个通用问题:**奖励的"何时表现、怎么表现"应该可以由业务接管**。

### 默认行为的问题

默认实现是"立即弹奖励",没有给业务接手空间。但实际场景需要:

- 宝箱奖励:等宝箱开启动画结束后再弹
- 挂机自动奖励:不管什么都飘字
- 抽卡:做更炫酷的界面

### 枚举接管方案

定义一个表现模式枚举,在服务端发奖励时附带:

| 枚举值 | 表现策略 |
|---|---|
| 0 | 默认逻辑(遍历道具列表,需要界面的走界面,否则飘字) |
| 1 | 无表现(交给业务自行处理) |
| 2 | 全都界面 |
| 3 | 全都飘字 |

### 为什么不按"获取途径"区分

最初讨论过按"获取途径"区分(商店、关卡、挂机),但发现**同一个系统可能有多种掉落表现**(挂机既有飘字也有特殊抽卡)。所以表现模式做成枚举,由调用方指定,而不是绑定到系统。

## 七、把六个系统串起来

回过头看,这六个系统其实是一个递进关系:

```
condition (条件)
   ↓ 满足条件触发
任务 / 引导 / 刷怪 (业务)
   ↓ 完成后给奖励
宝箱 / 奖励表现 (分发)
   ↓ 引导玩家领取
红点树 (提示)
```

设计原则:

1. **condition 是底座**:几乎所有"何时做"的问题都靠 condition
2. **表现可配置**:引导、奖励、红点的表现都通过配置 / 枚举驱动,不要硬编码
3. **脏标记 + 隔帧**:红点、引导这类高频系统必须用脏标记 + 隔帧刷新
4. **策划自助**:FlowCanvas + Luban 让策划改配置就能调逻辑,不动代码

## 参考

- [FlowCanvas 官方文档](https://flowcanvas.paradoxnotion.com/)
- [红点系统设计](https://zhuanlan.zhihu.com/p/682439585)
- [Luban 配置工具](https://github.com/focus-creative-games/luban)

---

下一篇:[SLG 角色与交互:交互物 / 自动扮演 / 移动手感 / 视觉表现](@post/2024-08-10-slg-character-interaction) — 整合自交互物逻辑、SLG 角色自动扮演、移动手感优化、血条 / 绳带 / 武器拖尾制作等笔记。
