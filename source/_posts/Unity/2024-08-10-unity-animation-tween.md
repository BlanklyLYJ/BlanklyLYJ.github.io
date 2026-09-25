---
permalink: 2024/08/10/unity-animation-tween/
title: Unity 动画系统(Animator / Animation)与 DoTween
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - Unity
  - Animator
  - Animation
  - DoTween
  - 缓动
categories:
  - [Unity, 动画]
comments: true
---

> 这一章把 Unity 的两套动画方案整合到一起:一是内置的 Animator / Animation(Mecanim),二是第三方补间库 DoTween。从 Animator 的状态机讲到如何用代码获取动画长度、监听播放完成,再到 DoTween 的常用 API 与 Ease 曲线。

## 一、Animation Clip:动画数据

### 1.1 AnimationClip 是什么

`AnimationClip` 是一段动画的原始数据,包含:

- 关键帧曲线(位置、旋转、缩放、材质属性等)
- 动画事件
- 长度、采样率、wrap mode
- 是否循环(loop)

```csharp
public AnimationClip clip;
public float duration => clip.length;
public bool isLoop => clip.isLooping;
```

### 1.2 Animation 与 Animator 的区别

| 维度 | Animation(老) | Animator(Mecanim) |
|---|---|---|
| 触发方式 | `animation.Play("name")` | `animator.SetBool / SetTrigger` |
| 状态管理 | 简单播放 | 状态机 + 过渡条件 |
| Blend Tree | 不支持 | 支持(混合 N 个动画) |
| 重定向 | 弱 | 强(humanoid 通用) |
| 层级 | 弱 | 支持(Layer、Mask) |
| 性能 | 较好 | 略重 |

新项目基本都用 Animator,Animation 只在"单独播一个 clip"场景里偶尔出现。

<!-- more -->

## 二、Animator:状态机

### 2.1 Animator Controller 结构

```text
AnimatorController
├── Parameters(参数)
│   ├── Float
│   ├── Int
│   ├── Bool
│   └── Trigger(一次性 bool)
├── Layers(层,可叠加)
│   └── Layer
│       └── State Machine
│           ├── States(状态)
│           │   └── Motion(AnimationClip / BlendTree)
│           ├── Transitions(过渡)
│           │   └── Conditions(条件)
│           └── Any State → 任意状态(用于"受击"等通用入口)
└── Sub-State Machines(子状态机)
```

### 2.2 状态机驱动动画

```csharp
private Animator _anim;
private static readonly int SpeedHash = Animator.StringToHash("Speed");

void Awake() => _anim = GetComponent<Animator>();

void Update()
{
    float speed = _rb.velocity.magnitude;
    _anim.SetFloat(SpeedHash, speed);
}
```

**关键技巧**:`Animator.StringToHash` 把参数名 hash 化,避免每次 `SetFloat("Speed", ...)` 都字符串 hash。把它缓存成 static readonly。

### 2.3 Trigger 与 Bool 的差别

```csharp
_animator.SetTrigger("Attack");  // 触发一次性,过渡完成后自动重置
_animator.SetBool("IsRunning", true);  // 持续状态
```

Trigger 适合"按键 → 播一次攻击动画"。Bool 适合"状态切换(跑步 / 站立)"。

### 2.4 Blend Tree:动画混合

Blend Tree 让多个动画按参数**混合播放**,适合移动(走 / 跑 / 静止)、瞄准(上 / 下 / 左 / 右):

| 类型 | 维度 | 典型场景 |
|------|------|---------|
| **1D Blend Tree** | 单参数 | Speed(0=静止,1=走,2=跑) |
| **2D Simple Directional** | 两参数,各动画方向不同 | 8 方向移动 |
| **2D Cartesian** | 两参数,自由笛卡尔 | 任意角度移动 |
| **2D Freeform Directional** | 类似 Simple,允许同方向多动画 | 复杂角色 |

**1D Blend Tree 示例**(Speed 驱动 Idle/Walk/Run):

```csharp
// 速度 0-2,Animator 内部 Blend Tree 按阈值自动混合
_animator.SetFloat(SpeedHash, currentSpeed);
```

Blend Tree 内部按阈值(0/0.5/1.5/2)插值,无需手动管理 Transition。比"状态机 + Transition"流畅得多,**是角色移动的标准方案**。

### 2.5 Layer 与 Avatar Mask:上下半身分离

复杂角色常需要"上半身攻击,下半身跑步"——用 **Animator Layer**:

| Layer | 用途 | Avatar Mask |
|------|------|------------|
| Base Layer | 全身(移动) | 无 |
| Upper Body | 上半身(攻击 / 装弹) | 只勾骨骼的上半部分 |
| Attack | 武器 / 特效 | 只勾武器骨骼 |

```csharp
// 设置 Layer 权重(0-1)
_animator.SetLayerWeight(1, 1f);  // 上半身 Layer 满权重
```

每个 Layer 用独立 Avatar Mask 决定影响哪些骨骼。Layer 权重为 0 时该层不生效,1 时完全覆盖 Base Layer 在 mask 区域的行为。

> **Override vs Additive**:Layer 的 Blending 模式。Override 是覆盖(上半身完全替换 Base),Additive 是叠加(在 Base 上加动作,常用于呼吸 / 眨眼等微动作)。

## 三、获取动画长度与监听完成

### 3.1 通过 AnimationClip 拿长度

```csharp
public AnimationClip clip;
float duration = clip.length;
```

简单场景够用,但混合 / 过渡 / Blend Tree 时无效。

### 3.2 通过 AnimatorStateInfo

```csharp
IEnumerator WaitForAnim(string stateName)
{
    // 等 Animator 进入指定状态
    while (!_anim.GetCurrentAnimatorStateInfo(0).IsName(stateName))
        yield return null;

    // 等播放完毕(normalizedTime 0~1)
    while (_anim.GetCurrentAnimatorStateInfo(0).normalizedTime < 1f)
        yield return null;

    Debug.Log("Anim finished");
}
```

`normalizedTime` 是归一化进度,0 = 开头,1 = 结尾。循环动画里会一直涨。

### 3.3 Animation Event

在 AnimationClip 上挂事件,到特定帧时回调:

```csharp
public void OnAttackHit()
{
    // 在攻击动画的"挥刀"帧调用
    if (Physics.Raycast(...)) DamageTarget();
}
```

在 Animation 视窗里把事件拖到特定帧,事件名对应 GameObject 上的 public 方法。优点是帧精确,缺点是污染方法命名空间。

### 3.4 normalizedTime 判断播完

```csharp
void Update()
{
    var state = _anim.GetCurrentAnimatorStateInfo(0);
    if (state.IsName("Attack") && state.normalizedTime >= 0.99f)
    {
        // 播完了,切换状态
        _anim.SetTrigger("AttackEnd");
    }
}
```

UI 动画也常用这种模式:入场动画播完后切到 idle 空状态机,避免 Update 一直驱动。

### 3.5 异步加载导致动画不同步

**现象**:UI 子物体异步加载,Animator 在子物体加载前就播放,导致动画从中间帧开始,看起来"卡一半"。

**根因**:Animator 默认在 OnEnable 时就开始播放,而子物体此时还没创建完。

**解决方案**:
- **Init 阶段创建所有子节点**:在 Init 阶段把所有可能的子物体(包括隐藏的)一次性创建,Animator 控制器完整,加载完毕后才统一 `Play`
- **延迟启动**:子物体加载完后通过 `Animator.enabled = false` 暂停,所有 ready 后统一 `enabled = true`
- **限制首次进入的节点**:只有"主节点"才能触发 Play,子节点跟随

```csharp
public class UIAnimatorSync : MonoBehaviour
{
    [SerializeField] private Animator _anim;

    private void OnEnable()
    {
        _anim.enabled = false;  // 先关,等子节点加载完
        StartCoroutine(InitChildren());
    }

    private System.Collections.IEnumerator InitChildren()
    {
        // 等所有子节点加载完(具体项目里这里可能等 Resources.LoadAsync)
        yield return null;
        _anim.enabled = true;   // 统一启动
        _anim.Play("Entry", 0, 0f);
    }
}
```

### 3.6 Animator 控制不到动态父节点

**现象**:UGUI 通用底板动画需求——某些 UI 模板在实例化时被包到动态创建的父节点里(比如 ScrollRect 的 Content),自带的 Animator 控制不到这个父节点。

**原因**:Animator 只能控制它所在 GameObject 子树的 Transform。父节点的位置 / 旋转无法被它驱动。

**解决思路**:
1. **在顶层另挂一个 Animator**:实例化时把父节点也加上 Animator,把子物体的 `runtimeAnimatorController` 引用传给它
2. **新增参数触发**:用脚本(而不是 Animator)控制父节点初始位置,Animator 接管后续动画
3. **统一显隐接口**:对外提供 `Show()/Hide()`,内部协调父子 Animator

```csharp
public class UIItem : MonoBehaviour
{
    [SerializeField] private Animator _selfAnim;
    private Animator _parentAnim;

    public void BindParent(GameObject parentGo)
    {
        _parentAnim = parentGo.AddComponent<Animator>();
        _parentAnim.runtimeAnimatorController = _selfAnim.runtimeAnimatorController;
    }

    public void PlayShow()
    {
        _selfAnim.SetTrigger("Show");
        if (_parentAnim != null) _parentAnim.SetTrigger("Show");
    }
}
```

### 3.7 UI 隐藏时动画播完触发关闭不灵敏

**问题**:UI 隐藏(`SetActive(false)`)时 `Update` 不驱动,动画"播完关闭"的回调不触发 → 界面关不掉。

**解决**:不要等动画回调,判断 UI 是否显示,未显示时直接执行关闭逻辑:

```csharp
public IEnumerator PlayHideThenDeactivate()
{
    _anim.SetTrigger("Hide");
    // 等动画 length 秒,但不要 yield return new WaitForSeconds(length)
    // 因为 SetActive(false) 后协程也停了
    float timer = _anim.GetCurrentAnimatorStateInfo(0).length;
    while (timer > 0 && gameObject.activeSelf)
    {
        timer -= Time.deltaTime;
        yield return null;
    }
    gameObject.SetActive(false);
}
```

或者更稳的:动画最后一帧挂 Animation Event,直接调用 `SetActive(false)`——事件由 Animator 触发,不依赖外部协程。

## 四、DoTween:补间动画库

### 4.1 基础 API

```csharp
using DG.Tweening;

// 移动
transform.DOMove(new Vector3(5, 0, 0), 1f);            // 1 秒移动到 (5,0,0)
transform.DOLocalMove(Vector3.zero, 1f);
transform.DOMoveX(5f, 1f);
transform.DOMoveY(5f, 1f).From();   // 从目标值动到当前位置

// 旋转 / 缩放
transform.DORotate(new Vector3(0, 90, 0), 1f);
transform.DOScale(2f, 0.5f);

// 颜色 / 透明度
text.DOColor(Color.red, 2f);
text.DOFade(0f, 1f);
spriteRenderer.DOFade(0.5f, 1f);

// RectTransform(UI)
rectTransform.DOAnchorPos(new Vector2(100, 0), 1f);
rectTransform.DOScale(Vector3.one * 1.2f, 0.3f);
```

### 4.2 DOTween.To:值变化

```csharp
public Vector3 value = Vector3.zero;

// param1: getter lambda
// param2: setter lambda
// param3: 目标值
// param4: 时长
DOTween.To(() => value, x => value = x, new Vector3(10, 10, 10), 2f);
```

适合自定义属性的补间,比如把血量从当前值平滑过渡到目标值。

<!-- more -->

### 4.3 控制播放

```csharp
Tween t = transform.DOMove(target, 1f);

t.SetAutoKill(false);  // 默认播完即销毁,设为 false 才能重放
t.Pause();

// 之后
transform.DOPlayForward();   // 正放
transform.DOPlayBackwards(); // 倒放
transform.DORestart();       // 重新开始
transform.DOPause();
transform.DOKill();          // 销毁
```

**关键陷阱**:DoTween 默认播放完毕自动销毁。如果想反复"DOPlayForward / DOPlayBackwards",必须在创建时 `SetAutoKill(false)`,并在 Awake / Start 时预创建一次:

```csharp
private Tween _tween;

void Awake()
{
    _tween = transform.DOScale(1.2f, 0.3f).SetAutoKill(false).Pause();
}

public void Pulse() => _tween.PlayForward();
```

### 4.4 From Tween

```csharp
// 默认:从当前位置 → 目标 (5, 0)
transform.DOMoveX(5f, 1f);

// From:从目标 (5, 0) → 当前位置
transform.DOMoveX(5f, 1f).From();

// From with relative:从 (current+5) → current
transform.DOMoveX(5f, 1f).From(true);
```

### 4.5 链式 API

```csharp
transform.DOMove(target, 1f)
    .SetEase(Ease.OutBack)        // 缓动曲线
    .SetLoops(2, LoopType.Yoyo)   // 重复 2 次,Yoyo = 来回
    .SetDelay(0.5f)               // 延迟
    .OnComplete(() => Debug.Log("Done"))
    .OnUpdate(() => Debug.Log("Updating"))
    .OnKill(() => Debug.Log("Killed"));
```

### 4.6 Sequence:组合动画

```csharp
Sequence seq = DOTween.Sequence();
seq.Append(transform.DOMoveX(5f, 1f));         // 顺序
seq.Append(transform.DOMoveY(5f, 1f));
seq.Join(transform.DORotate(...));             // 与上一个并行
seq.PrependInterval(0.5f);                     // 前面插入等待
seq.Insert(0f, transform.DOScale(...));        // 在绝对时间插入
seq.OnComplete(() => { /* 全部完成 */ });
```

### 4.7 DOText:打字机

```csharp
Text text = GetComponent<Text>();
text.DOText("Hello World", 2f);  // 2 秒内逐字显示
```

如果原本有文字会被覆盖,所以先把 `text.text = ""`。

### 4.8 DOShake:震屏

```csharp
// 相机震动,1 秒,强度 (1, 1, 0)
Camera.main.transform.DOShakePosition(1f, new Vector3(1, 1, 0));
Camera.main.transform.DOShakeRotation(0.5f, 10f);
```

震完会自动回到原位(因为 DOShake 内部记录了起始 transform)。

## 五、DoTween 的 Ease 曲线

### 5.1 内置 Ease

| Ease | 效果 |
|---|---|
| Linear | 匀速 |
| InSine / OutSine / InOutSine | 正弦曲线(轻缓) |
| InQuad / OutQuad / InOutQuad | 二次方 |
| InCubic / OutCubic / InOutCubic | 三次方 |
| InQuart / OutQuart / InOutQuart | 四次方 |
| InExpo / OutExpo / InOutExpo | 指数(剧烈) |
| InBack / OutBack / InOutBack | 超出再回弹 |
| InElastic / OutElastic / InOutElastic | 弹性(像皮筋) |
| InBounce / OutBounce / InOutBounce | 弹跳 |
| Flash / InFlash / OutFlash | 闪烁(可配置次数) |

`In*` 加速,`Out*` 减速,`InOut*` 两头变化(更"自然")。

### 5.2 设置 Ease

```csharp
transform.DOMove(target, 1f).SetEase(Ease.OutBack);

// 自定义 AnimationCurve
transform.DOMove(target, 1f).SetEase(curve);
```

`AnimationCurve` 可在 Inspector 拖拽编辑,适合美术调整。

### 5.3 Ease 选择经验

| 场景 | 推荐 Ease |
|---|---|
| UI 弹窗入场 | OutBack(轻超出再回) |
| UI 退出 | InBack |
| 血条 / 进度条 | OutQuad |
| 伤害飘字 | OutCubic + 上浮 |
| 震屏 | 默认 |
| 通用过渡 | OutQuart |
| 持续循环(呼吸) | InOutSine |

## 六、DoTween Path:路径动画

```csharp
// 添加 DO Tween Path 组件
// 在 Inspector 编辑路径点(Ctrl+Shift 加点,Ctrl+Alt 删点)
// 然后代码:
doTweenPath.DOPlay();
```

适合巡逻路径、技能弹道。

## 七、DoTween 可视化组件

DoTween 提供 `DO Tween Animation` 组件,可以完全在 Inspector 配置:

- Target Type(Transform / RectTransform / Camera / ...)
- Animation Type(Move / Rotate / Scale / Fade / Color / ...)
- From / To 值
- Duration / Delay / Ease / Loops

代码控制:

```csharp
DOTweenAnimation anim = GetComponent<DOTweenAnimation>();
anim.DOPlay();
anim.DORestart();
anim.DOPlayBackwards();
```

适合美术 / 策划调整,程序不需要写代码。

## 八、UI Animator 与 DoTween 选型

| 场景 | 推荐 |
|---|---|
| 简单移动 / 缩放 / 淡入淡出 | DoTween |
| 多状态切换(角色动作) | Animator |
| 序列动画(依次播放) | DoTween Sequence |
| 复杂状态机(连招) | Animator |
| 美术调整可视化 | DO Tween Animation 组件 |
| 程序精确控制 | DoTween 代码 |

**经验**:角色动画用 Animator,UI / 简单补间用 DoTween。两者可以并存。

## 九、性能与坑

### 9.1 Animator 的开销

- 即使状态机没有变化,Animator 每帧也在采样动画
- 大量 Animator 时,关闭"不活跃"的 GameObject 上的 Animator(`animator.enabled = false`)

### 9.2 DoTween 的 GC

- Tween 创建有少量 GC(`new Tween()` 内部对象池)
- 回调用 lambda 捕获局部变量会产生闭包,缓存回调方法避免

### 9.3 SetAutoKill 与内存泄漏

GameObject 销毁时,挂在它身上的 Tween **不会**自动销毁(因为 Tween 是 Sequence 上的)。需要 `OnDestroy` 时 `transform.DOKill()`:

```csharp
private void OnDestroy()
{
    transform.DOKill();
}
```

或者在初始化时 `SetLink(gameObject)`,DoTween 会在 GameObject 销毁时自动 kill:

```csharp
transform.DOMove(target, 1f).SetLink(gameObject);
```

## 十、状态机 / FSM

复杂角色用 Animator 处理动画状态,业务逻辑可以用独立的 FSM:

### 10.1 简单状态机

```csharp
public interface IState
{
    void Enter();
    void Update();
    void Exit();
}

public class IdleState : IState { /* ... */ }
public class RunState : IState { /* ... */ }
public class AttackState : IState { /* ... */ }

public class StateMachine
{
    private IState _current;

    public void Change(IState next)
    {
        _current?.Exit();
        _current = next;
        _current.Enter();
    }

    public void Update() => _current?.Update();
}
```

### 10.2 状态机的优势

- 每个 State 独立类,职责清晰
- 状态切换显式,容易扩展
- 配合 Animator 同步状态

适合复杂角色、敌人 AI、UI 流程管理。

## 参考

- [DoTween 官方文档](http://dotween.demigiant.com/)
- [DoTween Ease 曲线](https://blog.csdn.net/qq_33789001/article/details/124408540)
- [Animator 获取动画长度](https://blog.csdn.net/LCHUIHUI/article/details/86010773)
- [游戏设计模式:有限状态机](https://zhuanlan.zhihu.com/p/22976065)

---

下一篇:[Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/) — 整合 DrawCall、批处理、JobSystem、Burst、SRP 等渲染与性能优化内容。

## 系列目录

1. [Unity 生命周期、MonoBehaviour 与场景管理](/2024/08/10/unity-lifecycle-mono-scene/)
2. [Unity UGUI 基础组件](/2024/08/10/unity-ugui-basics/)
3. [Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/)
4. [Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/)
5. [Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/)
6. [Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/)
7. Unity 动画系统与 DoTween(本篇)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. [Unity Android 构建与调试](/2024/08/10/unity-android-build-debug/)
10. [Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/)
