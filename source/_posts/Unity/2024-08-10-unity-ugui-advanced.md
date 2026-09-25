---
permalink: 2024/08/10/unity-ugui-advanced/
title: Unity UGUI 进阶(ScrollRect / Mask / 布局 / Raycaster)
date: 2024-08-10 23:00:00
updated: 2024-08-10 23:00:00
tags:
  - Unity
  - UGUI
  - ScrollRect
  - Mask
  - GraphicRaycaster
categories:
  - [Unity, UGUI]
comments: true
---

> 接着 UGUI 基础篇,这一篇深入到 ScrollRect 的实现、Mask 与 RectMask2D 的差异、布局组件的工作机制,以及 GraphicRaycaster 是怎么把鼠标点击转发到 UI 的。理解了这套机制,你就能解释为什么有些 UI 点击"穿透"、为什么 ScrollRect 会卡、为什么 Mask 会让 DrawCall 翻倍。

## 一、ScrollRect:滑动列表的核心

### 1.1 ScrollRect 的结构

ScrollRect 是一个组合组件,典型结构:

```text
ScrollRect
├── Viewport      (RectMask2D,负责裁切)
│   └── Content   (实际内容,被布局组件撑开)
└── Scrollbar Horizontal / Vertical (可选)
```

- **Viewport**:可见区域,通常挂 `RectMask2D` 把超出的内容裁掉
- **Content**:实际内容容器,ScrollRect 移动它的 `anchoredPosition` 实现滚动
- **Movement Type**:Unrestricted / Elastic / Clamped,决定超出边界时的回弹行为

### 1.2 实现机制

ScrollRect 在 `LateUpdate` 里处理滚动逻辑:

```csharp
// 简化版伪代码
protected virtual void LateUpdate()
{
    if (dragging)
    {
        // 在 OnScroll 里更新 Content 的 anchoredPosition
    }
    else if (velocity != Vector2.zero)
    {
        // 滑动惯性
        velocity *= deceleration;
        content.anchoredPosition += velocity * Time.unscaledDeltaTime;
    }

    UpdateBounds();    // 重新计算 Content 边界
    UpdateScrollbars(); // 同步 Scrollbar
}
```

`DrivenRectTransformTracker` 用于"接管"子物体的 RectTransform 属性(比如 Content 的锚点由 ScrollRect 控制),不让用户在 Inspector 修改。

### 1.3 无限滚动列表

Content 元素很多时,直接挂 1000 个 Item 会卡到爆。标准方案是**对象池 + 动态回收**:

```csharp
public class InfiniteScroll : MonoBehaviour, IInitializePotentialDragHandler, IDragHandler, IScrollHandler
{
    [SerializeField] private ScrollRect _scrollRect;
    [SerializeField] private GameObject _itemPrefab;
    [SerializeField] private float _itemHeight = 80f;

    private readonly List<RectTransform> _items = new();
    private float _contentHeight;
    private int _dataCount;

    void Start()
    {
        // 只创建可见数量 + 几个缓冲
        int visibleCount = Mathf.CeilToInt(_scrollRect.viewport.rect.height / _itemHeight) + 2;
        for (int i = 0; i < visibleCount; i++)
        {
            var item = Instantiate(_itemPrefab, _scrollRect.content).GetComponent<RectTransform>();
            _items.Add(item);
        }
    }

    void Update()
    {
        // 根据 Content 的 anchoredPosition 决定哪些 Item 显示什么数据
        float y = -_scrollRect.content.anchoredPosition.y;
        int firstVisibleIndex = Mathf.FloorToInt(y / _itemHeight);

        for (int i = 0; i < _items.Count; i++)
        {
            int dataIndex = firstVisibleIndex + i;
            if (dataIndex < 0 || dataIndex >= _dataCount)
            {
                _items[i].gameObject.SetActive(false);
                continue;
            }

            _items[i].gameObject.SetActive(true);
            _items[i].anchoredPosition = new Vector2(0, -dataIndex * _itemHeight);
            UpdateItem(_items[i], dataIndex);
        }
    }

    void UpdateItem(RectTransform item, int index) { /* 填数据 */ }
}
```

**关键思想**:不创建 1000 个,只创建可见的 10 个,滚动时复用、复用、复用。

<!-- more -->

### 1.4 ScrollRect 性能优化

| 问题 | 原因 | 方案 |
|---|---|---|
| 滚动卡顿 | Content 重建顶点 | 静态文本单独 Canvas,关闭 Raycast Target |
| 滑动惯性掉帧 | 每帧 UpdateBounds | 减小 Item 数量,用无限滚动 |
| 大量 Item DrawCall 高 | 图集混乱 | 强制同图集,UI 元素共享 Material |
| Mask 性能差 | 模板缓冲 + 多 Pass | 改用 RectMask2D |

## 二、Mask 与 RectMask2D

UGUI 提供两个裁切组件,实现机制完全不同,各有适用场景。

### 2.1 实现差异

| 维度 | Mask | RectMask2D |
|---|---|---|
| 基类 | `MaskableGraphic` + 模板缓冲 | 单独组件,裁剪矩形 |
| 实现 | Stencil Buffer:绘制 mask 时写入 stencil,子元素绘制时按 stencil 测试 | 修改 Shader 中的 `_ClipRect`,子元素在着色器里裁掉 |
| DrawCall 影响 | 中断合批(mask 写入 + 移除需要单独 Pass) | 不中断合批(只改 shader uniform) |
| 性能 | 较差(2 个额外 Pass) | 较好(只一次 uniform 更新) |
| 形状 | 任意(取决于 Mask Graphic) | 必须是矩形 |
| 嵌套 | 支持(深度递增) | 不支持嵌套(只一个矩形) |
| Show Mask Graphic | 可显示 mask 自身的图 | 不显示 |

### 2.2 Mask 的 Stencil 实现

Mask 通过模板缓冲(Stencil Buffer)实现:

```csharp
// Mask 在子元素绘制前
var maskMaterial = StencilMaterial.Add(baseMaterial, 1,
    StencilOp.Replace, CompareFunction.Always,
    m_ShowMaskGraphic ? ColorWriteMask.All : 0);

// 子元素绘制时按 stencil = 1 测试

// Mask 在子元素绘制后清理
var unmaskMaterial = StencilMaterial.Add(baseMaterial, 1,
    StencilOp.Zero, CompareFunction.Always, 0);
```

**关键陷阱**:Mask 的 stencil 值与层级深度相关。Unity 默认 Stencil Buffer 是 8 bit,但 mask 实际**最多嵌套 7 层**(stencil 值用 1-7,0 表示无 mask)。超过 7 层嵌套 mask 会失效,需要重新组织 UI 层级。日常 UI 嵌套 2-3 层 mask 不会出问题,但深度列表(列表里嵌列表里嵌列表)要注意。

### 2.3 RectMask2D 的 _ClipRect 实现

RectMask2D 调用 `PerformClipping()` 把自身矩形传给子 Graphic,子 Graphic 的 shader 通过 `_ClipRect` uniform 在片段着色器里裁切。真实函数是 `UnityGet2DClipping`(UI 默认 shader 内置),简化逻辑等价于:

```hlsl
// 简化版,真实看 UnityGet2DClipping()
half2 insideMax = step(_ClipRect.xy, IN.worldPosition.xy);   // x≥min, y≥min
half2 insideMin = step(IN.worldPosition.xy, _ClipRect.zw);   // x≤max, y≤max
half inside = all(insideMax * insideMin);
color.a *= inside;
clip(color.a - 0.001);   // 完全透明 discard,避免深度写入
```

因为是 uniform,所有子元素共享一个 `_ClipRect`,可以合批。

### 2.4 选择建议

```text
矩形裁切、不需要嵌套        → RectMask2D(性能更好)
任意形状(圆形、不规则)       → Mask
滚动列表 Viewport          → RectMask2D(标准做法)
圆形头像 / 圆角按钮         → Mask + 圆形 Sprite,或用 Shader
```

## 三、布局组件(Layout System)

UGUI 的布局系统由三部分组成:

### 3.1 ILayoutElement / ILayoutGroup / ILayoutController

```text
ILayoutElement       声明自己占多少空间(min/preferred width/height)
ILayoutController    接收布局结果,设置自己的 RectTransform
ILayoutGroup         容器,聚合子 ILayoutElement,计算并下发布局
```

常见布局组件:

| 组件 | 作用 |
|---|---|
| `HorizontalLayoutGroup` | 子元素横向排列 |
| `VerticalLayoutGroup` | 子元素纵向排列 |
| `GridLayoutGroup` | 网格排列 |
| `Content Size Fitter` | 控制 RectTransform 大小 |
| `Layout Element` | 给子元素声明 prefer size |

### 3.2 LayoutGroup 的工作流程

Layout 系统的更新分两个 Pass:

```text
1. CalcHorizontal / CalcVertical:遍历所有 ILayoutElement,聚合 min/preferred size
2. SetChildrenAlongAxis:根据聚合结果,设置每个子元素的 anchoredPosition 和 sizeDelta
```

调用时机:`CanvasUpdateRegistry` 在 Rebuild 阶段调用,标记为 dirty 的 Layout 会重新计算。

### 3.3 ContentSizeFitter 与 Layout 重建

`ContentSizeFitter` 让 RectTransform 跟随内容变化:

```csharp
public enum FitMode { Unconstrained, MinSize, PreferredSize }
public FitMode horizontalFit;
public FitMode verticalFit;
```

**陷阱**:ContentSizeFitter 改变 RectTransform 大小是异步的(下一帧 Layout Rebuild),如果你想"设置文字 → 立刻拿宽度",需要强制刷新:

```csharp
LayoutRebuilder.ForceRebuildLayoutImmediate(text.GetComponent<RectTransform>());
```

否则你拿到的还是旧宽度。

### 3.4 Layout 与性能

布局组件**很重**:每次子元素变化都会重新计算整个子树。优化建议:

- 静态 UI 不要用 LayoutGroup,直接手摆
- 列表 Item 用代码手动定位,不要在滚动时跑 Layout
- 一个 Canvas 不要堆太多 LayoutGroup(嵌套会指数级放大)
- 列表 Item 设 `layoutPriority`,减少聚合开销

### 3.5 SafeArea:刘海屏 / 全面屏适配

iPhone X 之后所有手机基本都有刘海 / 圆角 / 手势条,UI 必须避开。Unity 2019.2+ 提供 `Screen.safeArea`,返回当前可用区域(`Rect`)。

```csharp
public class SafeAreaFitter : MonoBehaviour
{
    private RectTransform _rt;

    private void Awake()
    {
        _rt = (RectTransform)transform;
        ApplySafeArea();
    }

    private void ApplySafeArea()
    {
        Rect safe = Screen.safeArea;
        Vector2 anchorMin = safe.position;
        Vector2 anchorMax = safe.position + safe.size;
        anchorMin.x /= Screen.width;
        anchorMin.y /= Screen.height;
        anchorMax.x /= Screen.width;
        anchorMax.y /= Screen.height;
        _rt.anchorMin = anchorMin;
        _rt.anchorMax = anchorMax;
        _rt.offsetMin = Vector2.zero;
        _rt.offsetMax = Vector2.zero;
    }
}
```

挂在顶部 UI 容器(顶部 Bar / 侧边栏 / 底部按钮区)上即可自动避开刘海。

**注意**:
- 横竖屏切换时 `safeArea` 会变,要监听 `Screen.orientation` 变化重新 apply
- 安卓早期版本(< 11)`safeArea` 不准,需要原生插件读 `DisplayCutout`
- 不要把整个 Canvas 都套 SafeArea(那等于没适配,UI 会变小),只套"必须避开边缘"的容器

## 四、GraphicRaycaster:点击是怎么找到 UI 的

### 4.1 EventSystem 的角色

UGUI 的事件系统由三个组件协作:

```text
EventSystem           全局事件调度,负责每帧检测输入
StandaloneInputModule 把键盘 / 鼠标输入转换成事件
GraphicRaycaster      对 Canvas 做 raycast,找到点击的 Graphic
```

`EventSystem` 每帧 `Update`,从 InputModule 拿到指针位置,询问所有 Raycaster:"这个位置有哪些可点击对象?"

### 4.2 GraphicRaycaster 的实现

`GraphicRaycaster.Raycast` 简化逻辑:

```csharp
public override void Raycast(PointerEventData eventData, List<RaycastResult> resultAppendList)
{
    if (canvas == null) return;

    // 1. 拿到 Canvas 下所有注册的 Graphic
    var canvasGraphics = GraphicRegistry.GetGraphicsForCanvas(canvas);

    // 2. 转换屏幕坐标到 Canvas 空间
    Vector2 position;
    if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(
            canvas.transform as RectTransform, eventData.position,
            eventData.enterEventCamera, out position))
        return;

    // 3. 倒序遍历(后画的优先),检测点是否在 RectTransform 内
    for (int i = canvasGraphics.Count - 1; i >= 0; i--)
    {
        var graphic = canvasGraphics[i];
        if (!graphic.raycastTarget) continue;

        if (RectTransformUtility.RectangleContainsScreenPoint(
                graphic.rectTransform, eventData.position,
                eventData.enterEventCamera, graphic.raycastPadding))
        {
            resultAppendList.Add(new RaycastResult
            {
                gameObject = graphic.gameObject,
                module = this,
                ...
            });
        }
    }
}
```

**关键点**:
- `raycastTarget = false` 的 Graphic 不会参与检测(优化关键)
- 倒序遍历,后绘制的优先(符合视觉直觉)
- 检测的是 RectTransform 的矩形,不是图像的实际像素(透明区域也算)

### 4.3 点击穿透问题

```csharp
// 想让点击穿透透明区域 → 改写 Raycast 检测 alpha
public class AlphaRaycastFilter : MonoBehaviour, ICanvasRaycastFilter
{
    public bool IsRaycastLocationValid(Vector2 sp, Camera eventCamera)
    {
        // 读纹理对应像素的 alpha,小于阈值返回 false
        return IsPixelOpaque(sp);
    }
}
```

`ICanvasRaycastFilter` 接口可以自定义 raycast 过滤逻辑,常用于圆形头像、不规则按钮。

### 4.4 多个 Canvas 的事件分发

多个 Canvas 时,`EventSystem` 会按 Sorting Layer / Depth 排序所有 Raycaster,先调用最上层的,找到目标后停止(除非 `Raycast Target` 是 `Block` 行为)。

## 五、Raycast Target 字段的正确使用

每个 Graphic 都有 `raycastTarget` 字段。**默认是 true**,但很多 UI 不需要响应点击(比如血条、装饰图):

```csharp
// 优化:不需要点击的 Text / Image 全部关掉 raycastTarget
text.raycastTarget = false;
decorationImage.raycastTarget = false;
```

关掉的好处:
- 减少 GraphicRaycaster 遍历开销
- 减少不必要的 hit 结果
- 减少 GC 分配(每个 hit 都创建 `RaycastResult` struct,但有 List 增长)

批量关闭:

```csharp
[MenuItem("Tools/UI/关闭所有 Text 的 RaycastTarget")]
public static void DisableTextRaycast()
{
    var texts = FindObjectsOfType<Text>();
    foreach (var t in texts)
    {
        if (!t.GetComponent<Button>() && !t.GetComponent<Toggle>())
            t.raycastTarget = false;
    }
}
```

## 六、综合案例:滚动列表性能优化

完整方案:

```text
1. 用对象池 + 无限滚动 → Item 数量固定
2. Item 内部静态部分(背景、字框)单独 Canvas,与动态文字分离
3. 所有 Sprite 在一个图集
4. Viewport 用 RectMask2D,不用 Mask
5. 所有 Text 关闭 raycastTarget
6. 用 TextMeshPro 减少描边顶点
7. Item 内部不要用 LayoutGroup,手算 anchoredPosition
8. Item 数据更新时用 SetTextWithoutNotify
```

按这套做下来,一个 1000 项的滚动列表可以稳定 60 FPS。

## 参考

- [UGUI 源码 - GraphicRaycaster](https://github.com/Unity-Technologies/uGUI/blob/master/UnityEngine.UI/UI/Core/GraphicRaycaster.cs)
- [Mask 与 RectMask2D 区别](https://blog.csdn.net/weixin_38027841/article/details/116093515)
- [Unity UGUI 滚动列表最佳实践](https://unity.com/how-to/architect-game-scripting-optimization)
- [Layout System 原理](https://docs.unity3d.com/Packages/com.unity.ugui@1.0/manual/comp-LayoutElement.html)

---

下一篇:[Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/) — 从 yield 背后的 IEnumerator 谈到协程的 GC 陷阱与堆栈共享。

## 系列目录

1. [Unity 生命周期、MonoBehaviour 与场景管理](/2024/08/10/unity-lifecycle-mono-scene/)
2. [Unity UGUI 基础组件](/2024/08/10/unity-ugui-basics/)
3. Unity UGUI 进阶(本篇)
4. [Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/)
5. [Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/)
6. [Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/)
7. [Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. [Unity Android 构建与调试](/2024/08/10/unity-android-build-debug/)
10. [Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/)
