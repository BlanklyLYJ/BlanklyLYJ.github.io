---
permalink: 2024/08/10/unity-tips-framework/
title: Unity 杂项技巧与框架(快捷键 / MVC / UIToolkit / SLG 实战)
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - Unity
  - 快捷键
  - MVC
  - UIToolkit
  - 框架
  - SLG
categories:
  - [Unity, 杂项]
comments: true
---

> 这是 Unity 系列的最后一篇,整合那些"不好归类但又很重要"的内容:常用快捷键、撕纸效果、空格换行问题、MVC/MVP/MVVM 框架对比、qFramework、UIToolkit、状态机、SLG 项目实战经验等。把零散的小知识汇成一篇,方便后续翻阅。

## 一、Unity 常用快捷键

### 1.1 场景视图

| 快捷键 | 功能 |
|---|---|
| Q | 平移场景视图 |
| W | 移动物体 |
| E | 旋转物体 |
| R | 缩放物体 |
| F / 双击 | 场景视图聚焦选中物体 |
| Z | 轴点(Pivot)/ 中心(Center)切换 |
| X | 全局 / 局部坐标切换 |

### 1.2 摄像机 / FlyThrough

| 快捷键 | 功能 |
|---|---|
| Alt + 鼠标左键 | 视角环绕选中物体 |
| Alt + 鼠标右键 | 拉近 / 拉远 |
| 鼠标右键 + WASDQE | FlyThrough 模式(像 FPS) |

### 1.3 编辑操作

| 快捷键 | 功能 |
|---|---|
| Ctrl/Cmd + P | 播放 / 停止 |
| Ctrl/Cmd + Shift + P | 暂停 / 恢复 |
| Ctrl/Cmd + Shift + B | 打开 Build Settings |
| Ctrl/Cmd + B | 发布并运行 |
| Ctrl/Cmd + Shift + N | 创建空 GameObject |
| Alt + Shift + N | 创建子 GameObject |
| Ctrl/Cmd + D | 复制 |
| Ctrl/Cmd + Shift + F | 选中相机与 Scene 视图对齐(Align with View) |
| Ctrl/Cmd + Alt + F | 移动到 Scene 视图中心(Move to View) |
| Alt + Shift + A | 显示 / 隐藏物体 |
| Ctrl/Cmd + Shift + A | 添加组件 |
| Ctrl/Cmd + R | 重新编译 |

### 1.4 窗口

| 快捷键 | 功能 |
|---|---|
| Ctrl/Cmd + 1 | Scene |
| Ctrl/Cmd + 2 | Game |
| Shift + Space | 最大化 / 还原当前窗口 |
| Alt + → | 展开 Hierarchy |
| Alt + ← | 收起 Hierarchy |

熟练这些能省一半编辑时间。

<!-- more -->

## 二、文字空格换行问题

### 2.1 问题场景

游戏中经常出现:
- 中英文混排时英文被强制换行
- 全角空格、半角空格、不间断空格混用
- TextMeshPro 默认按空格断行,CJK 段落奇怪断开

### 2.2 空格字符

```text
U+0020  ' '   半角空格(ASCII 32)
U+00A0       不间断空格(nbsp,不换行)
U+3000  '　'  全角空格(CJK)
U+200B       零宽空格(不占位)
U+2003       em 空格(等宽)
```

| 空格 | 是否允许换行 |
|---|---|
| 半角 | 是 |
| nbsp | 否 |
| 全角 | TMP 中可配置 |

### 2.3 替换方案

```csharp
// 把全角空格替换为 nbsp,避免 TMP 错误换行
string FormatText(string text)
{
    return text.Replace("　", " ");
}
```

Lua 版本(xLua / toLua 用 Lua 5.1,**不支持 `\u{}` 转义**,必须用 UTF-8 字节序列):

```lua
function FormatText.replaceFullWidthSpace(text)
    -- 0xC2 0xA0 是 U+00A0 nbsp 的 UTF-8 编码
    return string.gsub(text, "%s+", string.char(0xC2, 0xA0))
end
```

详见 [Unity 空格换行问题](https://copyfuture.com/blogs-details/20210204071336547j)。

## 三、UI 框架:MVC / MVP / MVVM

### 3.1 三种模式

| 模式 | 数据 / 视图关系 | 适用 |
|---|---|---|
| MVC | View ↔ Controller ↔ Model | Web / 早期 UI |
| MVP | View ↔ Presenter ↔ Model,Presenter 持有 View 接口 | WinForms / 部分游戏 UI |
| MVVM | View ↔ ViewModel(双向绑定) ↔ Model | WPF / 数据驱动 UI |

### 3.2 Unity 中的选择

游戏 UI 大多用 MVP(显式数据流),少数用 MVVM(数据绑定)。

```csharp
// 简单 MVP
public interface IPlayerView
{
    void SetHP(int hp);
    void SetName(string name);
}

public class PlayerHUD : MonoBehaviour, IPlayerView
{
    [SerializeField] private Text _hpText;
    [SerializeField] private Text _nameText;

    public void SetHP(int hp) => _hpText.text = $"HP: {hp}";
    public void SetName(string name) => _nameText.text = name;
}

public class PlayerPresenter
{
    private readonly IPlayerView _view;
    private readonly PlayerModel _model;

    public PlayerPresenter(IPlayerView view, PlayerModel model)
    {
        _view = view;
        _model = model;
        _model.OnHPChanged += hp => _view.SetHP(hp);
    }

    public void Init()
    {
        _view.SetName(_model.Name);
        _view.SetHP(_model.HP);
    }
}
```

### 3.3 qFramework

国内开源 Unity 框架,提供:
- MVC + IOC 容器
- 工具类(Math / Pool / Event)
- 资源管理
- UI Kit

适合中小项目快速开发,详见 [qFramework GitHub](https://github.com/liangxiegame/QFramework)。

### 3.4 UIToolkit(UI Elements)

Unity 全新 UI 系统,取代 IMGUI(Editor UI)。特点:

```text
1. UXML(类 HTML)描述结构
2. USS(类 CSS)描述样式
3. C# 操作逻辑
```

```csharp
// Editor Window 用 UIToolkit
public class MyWindow : EditorWindow
{
    [MenuItem("Tools/My Window")]
    public static void Open() => GetWindow<MyWindow>("My");

    public void CreateGUI()
    {
        var root = rootVisualElement;
        root.Add(new Label("Hello"));
        var btn = new Button(() => Debug.Log("Click")) { text = "OK" };
        root.Add(btn);
    }
}
```

UIToolkit 是 Editor UI 的未来,运行时 UI 还在迭代,详见 [UIToolkit 简明教程](https://zhuanlan.zhihu.com/p/391982670)。

## 四、状态机与游戏逻辑

### 4.1 有限状态机(FSM)

```csharp
public enum PlayerState { Idle, Run, Attack, Hurt, Dead }

public class PlayerFSM : MonoBehaviour
{
    public PlayerState State { get; private set; }

    public void ChangeState(PlayerState next)
    {
        if (State == next) return;
        ExitState(State);
        State = next;
        EnterState(State);
    }

    void EnterState(PlayerState s) { /* Animator.SetTrigger 等 */ }
    void ExitState(PlayerState s) { /* 清理 */ }

    void Update()
    {
        switch (State)
        {
            case PlayerState.Idle: UpdateIdle(); break;
            case PlayerState.Attack: UpdateAttack(); break;
            // ...
        }
    }
}
```

### 4.2 状态机的扩展:行为树 / NodeCanvas

复杂 AI 用行为树。NodeCanvas / FlowCanvas 是 Unity 第三方可视化脚本框架:
- 状态机、行为树、对话系统可视化编辑
- 策划 / 美术也能写"逻辑"
- 与代码互转

```text
FlowCanvas JSON 格式
节点 / 连线 / 黑板变量
```

详见 [NodeCanvas 任务系统](https://zhuanlan.zhihu.com/p/718702259)。

### 4.3 状态机的应用:战斗 / 任务系统

开放世界任务系统:
- 主任务节点
- 子任务(收集 / 杀怪 / 护送)
- 状态(未接 / 进行 / 完成 / 失败)
- 触发器(自动触发 / NPC 触发 / 区域触发)

把任务节点抽象成 FSM,可以灵活组合成复杂任务流。

## 五、撕纸效果

### 5.1 思路

撕纸 = 一个 Mesh 在撕的过程中动态变形。常见做法:
1. **顶点动画**:Mesh 切成两半,沿切割线分离
2. **Shader 扭曲**:用噪声纹理扰动 UV
3. **Texture 切换**:每个阶段换一张图

### 5.2 简单实现

```csharp
public class Tearable : MonoBehaviour
{
    [SerializeField] private MeshFilter _meshFilter;
    [SerializeField] private float _tearAmount = 0f;
    [SerializeField] private int _tearIndex = 5;  // 撕开顶点索引

    void Update()
    {
        Mesh mesh = _meshFilter.mesh;
        Vector3[] verts = mesh.vertices;
        verts[_tearIndex] += new Vector3(_tearAmount, 0, 0);
        mesh.vertices = verts;
    }
}
```

详见 [Unity 撕纸效果](https://zhuanlan.zhihu.com/p/376168823)。

## 六、扩展系统类

### 6.1 C# 扩展方法

```csharp
public static class TransformExtensions
{
    public static void Reset(this Transform t)
    {
        t.position = Vector3.zero;
        t.rotation = Quaternion.identity;
        t.localScale = Vector3.one;
    }

    public static void DestroyAllChildren(this Transform t)
    {
        for (int i = t.childCount - 1; i >= 0; i--)
            Destroy(t.GetChild(i).gameObject);
    }
}

// 使用
transform.Reset();
parentTransform.DestroyAllChildren();
```

详见 [Unity 扩展系统类](https://www.cnblogs.com/chinarbolg/p/9601359.html)。

## 七、2D 物理:SpringJoint 2D

```text
SpringJoint 2D = 弹簧组件
- 两个 RigidBody2D 之间连接
- Distance:目标距离
- Frequency:振荡频率(越大弹簧越硬)
- Damping Ratio:阻尼(越大停止越快)
```

典型用途:绳子、布料、橡皮筋、弹性碰撞。

## 八、Tilemap

### 8.1 Tilemap 结构

```text
Grid             (网格容器)
├── Tilemap      (背景层)
├── Tilemap      (碰撞层)
└── Tilemap      (装饰层)
+ Tilemap Collider 2D
+ Composite Collider 2D(合并)
```

### 8.2 SLG 世界地图思路

SLG 类游戏的地图典型做法:
- Tilemap 表示网格基础
- 每个 Tile 一个建筑 / 资源点
- 世界迷雾:Texture2D.SetPixel 实现(详见下文)
- 行军线:自定义 Mesh + 插值动画

详见 [SLG 世界地图篇](https://zhuanlan.zhihu.com/p/107741968)。

### 8.3 世界迷雾实现

```text
核心思路:Texture2D.SetPixel(不用 GetPixel)
```

为什么不用 GetPixel?

> GPU 显存里的纹理,如果 CPU 要读取(GetPixel),数据要从 GPU 回传到 CPU,造成带宽堵塞,不仅自己慢还阻塞其他模块。所以几乎所有纹理都不勾 Read/Write。

世界迷雾方案:
1. 准备一张 Texture2D(运行时 new)
2. 探索区域 SetPixel 黑色 → 透明
3. Apply 推送到 GPU
4. 用 RawImage 显示在地图上层

详见 [SLG 世界迷雾实现](https://zhuanlan.zhihu.com/p/107741968)。

## 九、SLG 项目难点经验

> 这一节是某个真实 SLG 项目的踩坑经验。

### 9.1 建筑系统

- 方形网格坐标 + 占地规则
- 策划美术需求:编辑器(在地块点击记录坐标,自动写入配置)
- 锁定区域划分:PNPoly 检查点是否在多边形内
- 大量建筑查询:四叉树地图管理

### 9.2 场景加载优化

- 预制太大 → 移动地图时加载卡顿
- 联合预制:把多个小预制打包成大预制,只记录大预制位置
- 不记录旋转缩放(直接做出来,减少配置)

### 9.3 通用 UI 动画 / Animator 父节点控制 / 异步不同步

这三块经验(美术 K 帧与配置协同、UI 隐藏时动画回调、Animator 控制动态父节点)**已整合到动画篇**,详见:

- [动画篇 §3.5 异步加载导致动画不同步](/2024/08/10/unity-animation-tween/#3-5-异步加载导致动画不同步)
- [动画篇 §3.6 Animator 控制不到动态父节点](/2024/08/10/unity-animation-tween/#3-6-animator-控制不到动态父节点)
- [动画篇 §3.7 UI 隐藏时动画播完触发关闭不灵敏](/2024/08/10/unity-animation-tween/#3-7-ui-隐藏时动画播完触发关闭不灵敏)

### 9.6 多语言

```text
保存资源时 → 生成 TMP 预制 → 预制上的 img/txt 通过脚本替换
```

### 9.7 大规模敌人音频管理

- 八叉树组织 3D 空间
- 视锥剔除不可听对象
- LOD 控制远处用低质量音源
- 配合 Wwise 中间件

## 十、CatLikeCoding:Unity 进阶教程

[CatLikeCoding](https://catlikecoding.com/unity/tutorials/) 是公认的 Unity 最佳免费教程系列,涵盖:
- Basics(基础)
- Mesh / Procedural Mesh(程序化网格)
- Render Pipelines(渲染管线)
- Job System / ECS
- 数学 / 流体 / 物理

每章都从零写代码,适合深入理解 Unity 底层。

## 十一、其他小技巧

> 原本这一节还收集了 Unix 时间戳、退出 Play、Inspector 显示规则、字体 Rect 自适应、RawImage 多边形等技巧,这些**已分散到对应主题的篇章**(避免重复维护)。下面只保留独有 / 难以归类的小技巧。

### 11.1 四元数 vs 欧拉角

```csharp
// 欧拉角(Vector3)
Vector3 eulerAngles = new Vector3(0, 90, 0);
transform.rotation = Quaternion.Euler(eulerAngles);

// 四元数(Quaternion)
Quaternion q = transform.rotation;
transform.rotation = q * Quaternion.Euler(0, 90, 0);  // 在当前旋转上转 90 度

// 朝向某点
transform.rotation = Quaternion.LookRotation(target.position - transform.position);
```

| 维度 | 欧拉角 | 四元数 |
|---|---|---|
| 直观 | 好 | 差 |
| 万向节死锁 | 有 | 无 |
| 插值 | 不平滑 | 平滑(Slerp) |

Unity 内部统一用四元数,我们只需要在 Editor 想到时用欧拉角。

> Unix 时间戳、退出 Play、Inspector 显示规则等小技巧详见:
> - [生命周期篇 §3.2 时间戳(Unix 时间)](/2024/08/10/unity-lifecycle-mono-scene/)
> - [生命周期篇 §5.2 退出 Play 模式](/2024/08/10/unity-lifecycle-mono-scene/)
> - [Editor 扩展篇 §3.3 控制属性显示](/2024/08/10/unity-editor-extension/)

### 11.2 流程图工具:FlowCanvas

可视化脚本框架,JSON 格式存储流程图,策划 / 美术可编辑。把 FlowCanvas 导出的 JSON 转成 Excel(Luban)配置,再反向解析也是常见做法。

## 十二、Unity 资源学习路径

```text
入门:
  - Unity Learn(官方免费课)
  - CatLikeCoding Basics
  - [教程汇总]Unity 从入门到入坟

进阶:
  - UGUI 源码
  - DOTS / JobSystem
  - SRP / URP / HDRP
  - CatLikeCoding 高级系列

实战:
  - 做一个 SLG / ARPG 小 demo
  - 接 SDK(广告 / 内购 / 推送)
  - 上架 Google Play / App Store

持续:
  - Unity 官方博客
  - UWA(中文社区)
  - Unity 论坛
```

## 参考

- [Unity 常用快捷键](https://blog.csdn.net/weixin_43673589/article/details/122334027)
- [CatLikeCoding 教程](https://catlikecoding.com/unity/tutorials/)
- [Unity MVC / MVP / MVVM](https://blog.csdn.net/qq_54476817/article/details/132513548)
- [UIToolkit 简明教程](https://zhuanlan.zhihu.com/p/391982670)
- [游戏设计模式:有限状态机](https://zhuanlan.zhihu.com/p/22976065)
- [SLG 世界地图篇](https://zhuanlan.zhihu.com/p/107741968)
- [Unity 撕纸效果](https://zhuanlan.zhihu.com/p/376168823)
- [qFramework GitHub](https://github.com/liangxiegame/QFramework)
- [杰哥的 Unity 笔记](https://developer.unity.cn/projects/zhuan-zai-unityyou-hua-zhi-gc-he-li-you-hua-unityde-gc)

---

## 系列目录

1. [Unity 生命周期、MonoBehaviour 与场景管理](/2024/08/10/unity-lifecycle-mono-scene/)
2. [Unity UGUI 基础组件](/2024/08/10/unity-ugui-basics/)
3. [Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/)
4. [Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/)
5. [Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/)
6. [Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/)
7. [Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. [Unity Android 构建与调试](/2024/08/10/unity-android-build-debug/)
10. Unity 杂项技巧与框架(本篇)
