---
title: FlowCanvas 与可视化流程编排:配置驱动的关卡系统
date: 2024-08-10 24:30:00
updated: 2024-08-10 24:30:00
tags:
  - Unity
  - FlowCanvas
  - 可视化编程
  - 配置驱动
  - 关卡系统
categories:
  - [工具, 配置]
comments: true
---

> 数值配置(luban)、序列化(JSON/XML)是结构化数据,但有些东西不是"数据"而是"流程":关卡脚本、剧情节点、新手引导。这一篇讲可视化配置(FlowCanvas 之类)如何在客户端与服务端之间用配置驱动流程,以一个 SLG 关卡系统为例。

## 一、什么时候用可视化配置

游戏里"配置"分两层:

| 层 | 内容 | 工具 |
|---|---|---|
| 数值 | 攻击力、经验表、掉落概率 | Excel / luban |
| 流程 | 关卡时间轴、剧情分支、引导触发 | 可视化节点 / 脚本 |

数值适合表格,流程适合节点图。强行用表格表达流程,会出现一堆"条件列"和"分支列",策划看不懂、维护崩溃。

可视化工具(FlowCanvas、xNode、Behavior Designer、Unity Visual Effect Graph)用节点 + 连线表达,贴近策划思维。

<!-- more -->

## 二、关卡流程的拆解

以 SLG 关卡为例,流程涉及:

1. **关卡定义**:Scene + GameMode 配置,决定地图、AI、出生点
2. **服务器拉起**:战斗服根据配置启动关卡
3. **客户端拉起**:进入战斗场景、加载 HUD
4. **流程状态机**:Init → Loading → Playing → End
5. **流程节点**:开场动画、刷怪、目标判定、结算

每一项都可以是 FlowCanvas 节点。整个关卡 = 一张节点图 + 数据配置。

## 三、双端 Flow 的边界

关键设计:**客户端和服务端的 Flow 不能共享**,但需要严格对齐。常见约束:

- **服务器只能用** Server 节点 + Common 节点
- **客户端只能用** Client 节点 + Common 节点
- Common 节点双端都可执行(数据加载、通用判定)
- Server 节点处理 AI、战斗结算、权威判定
- Client 节点处理 HUD、特效、引导

为什么必须分?FlowCanvas 默认没有"端"概念,如果一份图同时跑双端,逻辑混乱、不可调试。文件夹和颜色区分(服务器图蓝色,客户端图黄色)是工程纪律。

## 四、配置驱动的拉起

`SceneGameModeConfig.xlsx` 决定每关的元信息:

| 字段 | 含义 |
|---|---|
| Scene | 场景 ID |
| GameMode | 游戏模式 ID |
| flowStage | 关联的 FlowCanvas 图 |
| AI 配置 | 这关的 AI 行为 |
| 出生点 | 玩家/怪物初始位置 |
| 关卡参数 | 时间限制、目标条件 |

服务器启动时读这份表,根据 flowStage 加载对应 FlowCanvas 图,执行初始化逻辑。

```csharp
// 服务器拉起(伪代码)
class ServerGameLevelSystem
{
    public void StartLevel(int sceneId, int modeId)
    {
        var config = SceneGameModeConfig.Get(sceneId, modeId);
        var flow   = FlowCanvas.Load(config.flowStage);

        // 期望第 0 帧加载好所有数据
        // 注意:这会让拉起变慢,需要权衡
        flow.Execute("OnServerInit");
    }
}
```

## 五、客户端 Flow 的边界原则

客户端的 FlowCanvas 应该**只做表现层**,核心规则不要碰:

- 只操作 HUD、Tip、特效
- 不做流程扭转(状态机交给专门的 LevelSystem)
- 需要决策时只发请求给服务器

为什么?**客户端不应该持有权威状态**。举个例子:

> 客户端 Flow 有个状态:Init → Playing。玩家中途加入游戏,服务器同步给他当前是 Playing。如果客户端自己有状态机扭转,中途加入时客户端可能从 Init 走起,跟服务器错位。

正确做法:客户端从 `ClientGameLevelSystem` 拿当前状态,FlowCanvas 节点根据这个状态执行表现,不做状态扭转。

## 六、引导与新手的特殊场景

教学关卡常常**没有服务器**,纯客户端 Flow。这类场景:

- 触发流程引导(高亮按钮、强制点击)
- 强引导开关(用户跳过/必看)
- 激活某些 UI HUD

这种 FlowCanvas 可以全是 Client 节点,不需要 Server 部分。但要注意:

> 教学关卡的引导触发条件,要分清是客户端本地触发还是服务器触发。某些"完成 X 关后弹引导"需要服务器权威,客户端触发会被绕过。

## 七、FlowCanvas 的拉起时机

`BaseGameFace` 是常见的关卡入口基类,继承自实际的 GameMode 类。拉起时机影响首屏体验:

| 时机 | 优势 | 劣势 |
|---|---|---|
| 进入场景前预执行 | 第 0 帧所有数据就绪 | 拉起变慢 |
| 进入场景后懒加载 | 首屏快 | 第 0 帧逻辑不完整 |
| 分帧执行 | 平衡 | 实现复杂 |

实践折中:

1. **必要数据(出生点、AI 配置)** 进场景前加载
2. **HUD、特效、引导** 进场景后懒加载
3. **FlowCanvas 节点** 分帧执行,避免一帧阻塞

## 八、客户端 / 服务端的同步契约

FlowCanvas 的图是双端共享的"蓝图",执行时各自跑各自版本:

```
                共享蓝图(同一个 .asset)
                       │
        ┌──────────────┴──────────────┐
        ▼                              ▼
   Server 节点图                  Client 节点图
   (AI/战斗/结算)                 (HUD/特效/引导)
        │                              │
        ▼                              ▼
   服务器权威状态                  客户端表现
        │                              │
        └──────────── 协议同步 ──────────┘
```

同步契约:

1. **状态变化**:服务器发起,客户端响应
2. **用户输入**:客户端发起,服务器校验
3. **表现触发**:服务器通知,客户端播放(不要自己决策)
4. **引导触发**:分清权威,纯客户端引导 vs 服务器验证后引导

## 九、可视化配置 vs 代码配置

| 维度 | 可视化(FlowCanvas) | 代码(脚本) |
|---|---|---|
| 策划友好 | 高 | 低 |
| 调试 | 中(图形化但复杂) | 高(断点) |
| 性能 | 中(节点开销) | 高 |
| 复用 | 中 | 高(继承、组合) |
| 维护 | 中(图越大越难) | 高(可拆分) |

可视化工具的核心价值是把"流程定义权"交给策划。代价是性能和复杂度管理。适合**频繁变动、非程序员维护的内容**。

## 十、典型陷阱

### 1. 客户端 Flow 扭转状态

```csharp
// 反面教材
class ClientFlowNode {
    public void OnEnter() {
        // 不要这样做!
        GameManager.State = GameState.Playing;
    }
}
```

正确做法:发请求给服务器,服务器回包后由 `ClientGameLevelSystem` 更新状态。

### 2. FlowCanvas 节点过大

一张图几百个节点,执行慢、维护难。拆分原则:按**功能模块**拆,每个模块小图,通过事件/委托通信。

### 3. 双端节点混用

策划不小心在客户端图里拖了 Server 节点,运行时报错或表现异常。解决:编辑器扩展做节点过滤,违规拖入直接报红。

### 4. 教学关卡的服务器依赖

教学关没有服务器,但引导触发条件依赖"完成 X 关"。如果按服务器逻辑写,教学关会卡住。解决:为教学关单独写客户端触发分支。

## 十一、FlowCanvas 节点设计

自定义节点的常见模式:

```csharp
public class FlowNode_ShowHUD : FlowNodeBase
{
    [Port("Text", Direction.In)] public string Text;

    public override void OnExecute()
    {
        // 只操作 HUD,不做状态扭转
        UIManager.Show<TipHUD>(Text);
    }
}

public class FlowNode_SendRequest : FlowNodeBase
{
    [Port("Request", Direction.In)] public GameRequest Req;

    public override void OnExecute()
    {
        // 客户端只发请求,等服务器回包
        NetworkManager.Send(Req);
    }
}
```

节点命名规范:

- Server 端:`Server_XXX`(蓝色)
- Client 端:`Client_XXX`(黄色)
- 通用:`Common_XXX`(绿色)

## 十二、小结

| 概念 | 关键 |
|---|---|
| 配置分层 | 数值(Excel)+ 流程(可视化) |
| 双端 Flow | Server / Client / Common 三类节点 |
| 客户端原则 | 只做表现,不做权威扭转 |
| 教学关卡 | 纯客户端 Flow,但要分清触发权威 |
| 拉起时机 | 必要数据预加载,表现层懒加载 |
| 节点设计 | 单一职责,易于策划拖拽 |

可视化配置不是"代码的替代",而是"流程定义权的转移"。让策划拥有改动玩法的能力,程序只负责底层支持和节点扩展。这是大型项目分工的核心模式。

## 参考

- [FlowCanvas 官方文档](https://flowcanvas.paradoxnotion.com/)
- [Unity Visual Scripting (Bolt)](https://docs.unity3d.com/Packages/com.unity.visualscripting@latest)

---

至此,从 luban 数值配置、JSON/XML 序列化到 FlowCanvas 可视化流程,游戏配置系统的全貌就完整了。下一篇将进入资源加载与热更新的工程实战。
