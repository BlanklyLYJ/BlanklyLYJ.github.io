---
permalink: 2024/08/10/unity-input-eventsystem/
title: Unity 输入与交互(Input / EventSystem / Pointer)
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - Unity
  - Input
  - EventSystem
  - UGUI
  - 交互
categories:
  - [Unity, 交互系统]
comments: true
---

> 这一章把 Unity 的输入体系、UGUI 的 EventSystem、Pointer 事件接口、自定义交互组件等知识点整合到一起。从最底层的 Input API 讲到 PointerEventData,再到 InputField 的回调优化,看完能解释"为什么按钮点了一下没反应"以及"怎么自己写一个不参与绘制的可点击组件"。

## 一、传统 Input 系统

### 1.1 鼠标 / 键盘

```csharp
void Update()
{
    // 鼠标按下(0 左键 / 1 右键 / 2 中键)
    if (Input.GetMouseButtonDown(0)) Debug.Log("Left click down");
    if (Input.GetMouseButton(0))     Debug.Log("Left click held");
    if (Input.GetMouseButtonUp(0))   Debug.Log("Left click up");

    // 鼠标位置(屏幕坐标,左下角为原点)
    Vector3 mousePos = Input.mousePosition;

    // 键盘
    if (Input.GetKeyDown(KeyCode.Space))    Debug.Log("Space pressed");
    if (Input.GetKey(KeyCode.W))            Debug.Log("W held");
    if (Input.GetKeyUp(KeyCode.Space))      Debug.Log("Space released");

    // 输入轴(可在 Input Manager 配置)
    float h = Input.GetAxis("Horizontal");  // -1~1,平滑
    float v = Input.GetAxisRaw("Vertical"); // -1 / 0 / 1,不插值

    // 跳跃类(按下瞬间触发)
    bool jump = Input.GetButtonDown("Jump");
}
```

### 1.2 Input Manager vs Input System

| 维度 | Input Manager(老) | Input System 包(新) |
|---|---|---|
| 使用方式 | `Input.GetKey` 等静态方法 | 设备抽象 + Action Map |
| 多设备支持 | 弱 | 强(键盘 / 手柄 / 触屏统一) |
| 多人本地 | 难 | 内置 |
| 配置 | Project Settings → Input Manager | PlayerInput 组件 + .inputactions 资源 |
| 重绑定 | 难 | 内置 InputRebinding |

新项目推荐 Input System 包,老项目继续用 Input Manager 也行。下面主要讲老 Input Manager,新 Input System 单独查文档。

<!-- more -->

### 1.3 触屏

```csharp
foreach (Touch touch in Input.touches)
{
    if (touch.phase == TouchPhase.Began)  Debug.Log($"Touch {touch.fingerId} began");
    if (touch.phase == TouchPhase.Moved)  Debug.Log($"Touch moved {touch.deltaPosition}");
    if (touch.phase == TouchPhase.Ended)  Debug.Log($"Touch ended");
}

// 单点触屏可当作鼠标
bool tapped = Input.GetMouseButtonDown(0);
```

Android / iOS 上,第一根手指点击会被映射成左键,所以 `Input.GetMouseButton(0)` 在触屏上也能用。

### 1.4 摇杆 / 多输入设备

```csharp
string[] names = Input.GetJoystickNames();
foreach (var name in names) Debug.Log(name);

float h = Input.GetAxis("Joy1 Axis 1");  // 摇杆 X
bool a = Input.GetButtonDown("Joy1 Button 0");
```

每个手柄用 `Joy1 / Joy2 / ...` 区分。具体按钮映射依赖 Input Manager 配置。

### 1.5 新 Input System 包(简介)

Unity 2019.1+ 提供独立 `Input System` 包,替代 `Input Manager`(老)。**新项目优先选它**。

| 维度 | Input Manager(老) | Input System(新) |
|------|-------------------|------------------|
| API | `Input.GetKey` 等静态方法 | 设备抽象 + Action Map |
| 多设备 | 弱 | 强(键盘 / 手柄 / 触屏统一抽象) |
| 多人本地 | 难 | 内置 |
| 重绑定 | 难 | 内置 InputRebinding |
| 配置 | Project Settings → Input Manager | `.inputactions` 资源 + `PlayerInput` 组件 |

**使用流程**:
1. Package Manager 装 `Input System`
2. Player Settings → Active Input Handling → 选 `Input System Package` 或 `Both`(过渡期)
3. Project 窗口右键 → Create → Input Actions 创建 `.inputactions` 资源,可视化编辑器配 Action
4. 挂 `PlayerInput` 组件引用 `.inputactions`
5. 代码订阅:

```csharp
using UnityEngine.InputSystem;

public class PlayerController : MonoBehaviour
{
    [SerializeField] private InputActionReference moveAction;  // 引用 .inputactions 里的 Action

    private void OnEnable()
    {
        moveAction.action.performed += OnMove;
        moveAction.action.canceled += OnMove;
        moveAction.action.Enable();
    }

    private void OnDisable() => moveAction.action.Disable();

    private void OnMove(InputAction.CallbackContext ctx)
    {
        Vector2 dir = ctx.ReadValue<Vector2>();
        // 移动逻辑
    }
}
```

> **关键坑**:切到新 Input System 后,**UGUI EventSystem 也要换模块**——把 `StandaloneInputModule` 换成 `InputSystemUIInputModule`,否则 UI 点击没反应。

## 二、EventSystem:UGUI 事件总线

### 2.1 三个核心组件

任何 UGUI 交互都需要:

```text
EventSystem           全局调度,场景中唯一
StandaloneInputModule 标准 PC 输入(鼠标 / 键盘)
TouchInputModule      触屏输入(已合并到 Standalone)
GraphicRaycaster      每个 Canvas 上挂一个
```

新建 UI 时 Unity 会自动加 EventSystem。如果不小心删了,右键 Hierarchy → UI → Event System 重新加。

### 2.2 工作流程

每帧 `EventSystem.Update()`:

```text
1. InputModule 从 Input 拿到指针位置、按键状态
2. 询问所有 BaseInputRaycaster:"这个位置被哪些对象命中?"
3. 按 Sorting Layer / Depth 排序命中结果
4. 找到最上层命中对象,根据它的接口(IPointerDownHandler 等)派发事件
5. 处理 Hover(进入 / 退出)、Drag 等状态机
```

### 2.3 GraphicRaycaster 配置

Canvas 上的 GraphicRaycaster 有几个关键字段:

| 字段 | 含义 |
|---|---|
| `Ignore Reversed Graphics` | 是否忽略被反转(背向相机)的 Graphic |
| `Blocking Objects` | 哪些类型的物体能挡住 raycast |
| `Blocking Mask` | 哪些 Layer 挡 raycast |

默认配置基本够用,只有在 3D + UI 混合场景才需要调。

## 三、Pointer 事件接口

### 3.1 标准接口列表

UGUI 的事件以接口形式提供,挂在 GameObject 上的 MonoBehaviour 实现接口就能接收:

```csharp
public interface IPointerEnterHandler   { void OnPointerEnter(PointerEventData); }
public interface IPointerExitHandler    { void OnPointerExit(PointerEventData); }
public interface IPointerDownHandler    { void OnPointerDown(PointerEventData); }
public interface IPointerUpHandler      { void OnPointerUp(PointerEventData); }
public interface IPointerClickHandler   { void OnPointerClick(PointerEventData); }
public interface IBeginDragHandler      { void OnBeginDrag(PointerEventData); }
public interface IDragHandler           { void OnDrag(PointerEventData); }
public interface IEndDragHandler        { void OnEndDrag(PointerEventData); }
public interface IDropHandler           { void OnDrop(PointerEventData); }
public interface IScrollHandler         { void OnScroll(PointerEventData); }
public interface ISelectHandler         { void OnSelect(BaseEventData); }
public interface IDeselectHandler       { void OnDeselect(BaseEventData); }
```

### 3.2 完整点击交互

```csharp
public class CustomButton : MonoBehaviour,
    IPointerDownHandler, IPointerUpHandler, IPointerClickHandler
{
    public UnityEvent onClick = new();

    public void OnPointerDown(PointerEventData e)
    {
        transform.localScale = Vector3.one * 0.95f;
    }

    public void OnPointerUp(PointerEventData e)
    {
        transform.localScale = Vector3.one;
    }

    public void OnPointerClick(PointerEventData e)
    {
        onClick?.Invoke();
    }
}
```

`PointerEventData` 包含:
- `position`:屏幕坐标
- `pointerCurrentRaycast`:当前命中的对象
- `button`:0=左键 / 1=右键 / 2=中键
- `clickCount`:连击次数
- `dragging`:是否在拖
- `delta`:帧间位移
- `scrollDelta`:滚轮

### 3.3 Drag 实现

```csharp
public class Draggable : MonoBehaviour, IBeginDragHandler, IDragHandler, IEndDragHandler
{
    private RectTransform _rt;
    private Canvas _canvas;
    private Vector2 _offset;

    void Start()
    {
        _rt = GetComponent<RectTransform>();
        _canvas = GetComponentInParent<Canvas>();
    }

    public void OnBeginDrag(PointerEventData e)
    {
        RectTransformUtility.ScreenPointToLocalPointInRectangle(
            _canvas.transform as RectTransform, e.position, e.pressEventCamera, out var local);
        _offset = _rt.localPosition - (Vector3)local;
    }

    public void OnDrag(PointerEventData e)
    {
        if (RectTransformUtility.ScreenPointToLocalPointInRectangle(
                _canvas.transform as RectTransform, e.position, e.pressEventCamera, out var local))
        {
            _rt.localPosition = local + _offset;
        }
    }

    public void OnEndDrag(PointerEventData e) { /* 落点判断 */ }
}
```

**关键 API**:`RectTransformUtility.ScreenPointToLocalPointInRectangle` 把屏幕坐标转成 Canvas 内的局部坐标。

### 3.4 ScrollRect 的拖拽

ScrollRect 内部就是实现了 IDragHandler、IScrollHandler,根据 `delta` 移动 Content。详见 UGUI 进阶篇。

### 3.5 手动派发事件:ExecuteEvents.Execute

有时需要代码主动触发 UI 事件(键盘按确认 = 按钮点击、AI 主动 hover、自动化测试):

```csharp
// 让 button 像被点击一样触发
ExecuteEvents.Execute<IPointerClickHandler>(
    button.gameObject,
    new PointerEventData(EventSystem.current),
    ExecuteEvents.pointerClickHandler);

// 让某个对象像被 hover 一样
ExecuteEvents.Execute<IPointerEnterHandler>(
    target.gameObject,
    new PointerEventData(EventSystem.current),
    ExecuteEvents.pointerEnterHandler);
```

签名:`ExecuteEvents.Execute<T>(GameObject target, BaseEventData data, EventFunction<T> functor)`。

应用场景:
- 键盘 / 手柄导航模拟点击
- 自动化测试主动触发 UI 事件
- 脚本控制 hover 状态(过场动画"假"高亮)

## 四、不参与绘制的可点击组件

### 4.1 问题

UI 里很多"热区"——不显示,但需要响应点击。常见做法是放一个 `alpha=0` 的 Image,但它**仍然参与顶点构建,占一个 DrawCall**。一个界面 10 个热区就多了 10 份顶点。

### 4.2 解决:Empty4Raycast

继承 `MaskableGraphic`(有 raycast 能力),但 `OnPopulateMesh` 清空顶点(不绘制)。挂在 GameObject 上即可作为热区:

```csharp
public class Empty4Raycast : MaskableGraphic
{
    protected Empty4Raycast() { useLegacyMeshGeneration = false; }
    protected override void OnPopulateMesh(VertexHelper toFill) => toFill.Clear();
}
```

效果:`raycastTarget = true` → 可点击;顶点数 0 → 不占 DC。

> 完整原理(`MaskableGraphic` 继承体系、`GraphicRegistry` 注册机制)见 [UGUI 基础篇 §2 Graphic](/2024/08/10/unity-ugui-basics/#二-graphic-与-graphicregistry)。

## 五、InputField 与 TMP_InputField

### 5.1 监听输入

```csharp
public InputField inputField;

void Start()
{
    inputField.onValueChanged.AddListener(text => Debug.Log("Changed: " + text));
    inputField.onEndEdit.AddListener(text => Debug.Log("End: " + text));
}
```

`onValueChanged`:每次输入都触发(包括按退格)
`onEndEdit`:失去焦点或按回车时触发

### 5.2 避免回调循环

```csharp
void OnValueChanged(string text)
{
    // 修改文本会再次触发 onValueChanged,可能死循环
    if (text.Length > 10)
    {
        inputField.text = text.Substring(0, 10);  // 触发 OnValueChanged("...")
    }
}
```

Unity 提供 `SetTextWithoutNotify`:

```csharp
/// <summary>
/// 设置文本但不触发 onValueChanged。
/// </summary>
public void SetTextWithoutNotify(string input)
{
    SetText(input, false);
}
```

```csharp
void OnValueChanged(string text)
{
    if (text.Length > 10)
    {
        _suppress = true;
        inputField.SetTextWithoutNotify(text.Substring(0, 10));
        _suppress = false;
    }
    // ...
}
```

### 5.3 输入长度限制

```csharp
[SerializeField] private InputField _input;
[SerializeField] private int _maxChars = 10;

void OnValueChanged(string text)
{
    if (text.Length > _maxChars)
    {
        // 截断 + 不触发回调
        _input.SetTextWithoutNotify(text.Substring(0, _maxChars));
        _input.caretPosition = _maxChars;  // 光标位置
    }
}
```

### 5.4 移动端键盘

```csharp
TouchScreenKeyboard keyboard = TouchScreenKeyboard.Open(
    "default text",
    TouchScreenKeyboardType.Default,
    autocorrection: false,
    multiline: false,
    secure: false,
    alert: false,
    "placeholder");
```

`TouchScreenKeyboard.isSupported` 在 PC 上返回 false,要走 InputField 的输入。

## 六、3D 物体的点击

UGUI 的 EventSystem 默认只处理 Canvas 上的 Graphic。3D 物体点击有两种方式:

### 6.1 PhysicsRaycaster + 接口

```csharp
// 1. 相机上挂 PhysicsRaycaster
// 2. 3D 物体挂 Collider,脚本实现 IPointerClickHandler

public class Clickable3D : MonoBehaviour, IPointerClickHandler
{
    public void OnPointerClick(PointerEventData e)
    {
        Debug.Log("3D clicked");
    }
}
```

`PhysicsRaycaster` 让 EventSystem 知道用 Physics.Raycast 来检测 3D 物体。

### 6.2 手动 Raycast

```csharp
void Update()
{
    if (Input.GetMouseButtonDown(0))
    {
        Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
        if (Physics.Raycast(ray, out RaycastHit hit, 100f))
        {
            hit.collider.GetComponent<IClickable>()?.OnClick();
        }
    }
}
```

简单粗暴,适合"只有一个相机 + 几个可点对象"的场景。

## 七、自定义输入模块

如果想做"键鼠 + 手柄 + 触屏"统一处理,继承 `BaseInputModule`:

```csharp
public class CustomInputModule : BaseInputModule
{
    public override void Process()
    {
        // 每帧调用,自己处理输入 → 派发事件
        // 例如:读手柄按键,模拟 PointerDown
    }
}
```

复杂度高,通常用现成的 Input System 包代替。

## 八、性能与最佳实践

### 8.1 关掉不需要的 RaycastTarget

每个 Graphic 默认 `raycastTarget = true`,GraphicRaycaster 每帧都要遍历检测。不需要点击的(装饰图、文字)一律关掉:

```csharp
[MenuItem("Tools/UI/Disable unnecessary RaycastTarget")]
static void Disable()
{
    var all = FindObjectsOfType<Graphic>();
    foreach (var g in all)
    {
        if (g.GetComponent<IPointerClickHandler>() == null &&
            g.GetComponent<IDragHandler>() == null &&
            !g.TryGetComponent<Button>(out _))
            g.raycastTarget = false;
    }
}
```

### 8.2 避免每帧 GetKeyDown

`Input.GetKeyDown` 已经缓存了状态,每帧调没问题。但要注意 `Input.GetAxis` 在某些平台 GC 较大,移动端可考虑 `GetAxisRaw`。

### 8.3 多相机 UI 与 3D 同时响应

如果 UI 与 3D 都要响应同一点击,关闭 EventSystem 的 `firstRaycasterResult` 行为,或者在 raycast 模块里设置 `block` 为 false。

## 参考

- [Unity Input 官方手册](https://docs.unity3d.com/ScriptReference/Input.html)
- [EventSystem 工作原理](https://docs.unity3d.com/Packages/com.unity.ugui@1.0/manual/EventSystem.html)
- [Empty4Raycast 实现思路](https://blog.csdn.net/akak2010110/article/details/80953370)
- [InputField.Setting text without notify](https://docs.unity3d.com/ScriptReference/UI.InputField.SetTextWithoutNotify.html)

---

下一篇:[Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/) — 整合 Animator / Animation、DoTween 缓动、Ease 曲线、UIFade 等。

## 系列目录

1. [Unity 生命周期、MonoBehaviour 与场景管理](/2024/08/10/unity-lifecycle-mono-scene/)
2. [Unity UGUI 基础组件](/2024/08/10/unity-ugui-basics/)
3. [Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/)
4. [Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/)
5. [Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/)
6. Unity 输入与交互(本篇)
7. [Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. [Unity Android 构建与调试](/2024/08/10/unity-android-build-debug/)
10. [Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/)
