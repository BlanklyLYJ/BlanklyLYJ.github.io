---
title: Unity UGUI 基础组件(Canvas / Image / Text / TextMeshPro)
date: 2024-08-10 22:30:00
updated: 2024-08-10 22:30:00
tags:
  - Unity
  - UGUI
  - Canvas
  - TextMeshPro
categories:
  - [Unity, UGUI]
comments: true
---

> 这一篇把 UGUI 的"骨架组件"整合到一起:Canvas 的三种 Render Mode、Graphic 基类、Image 与 RawImage 的差别、Text 与 TextMeshPro 的实现原理、Image 裁切与多边形贴图。UGUI 的源码很多,但日常开发只需要抓住"渲染 + 重建 + 事件"三条主线就够用了。

## 一、Canvas:UGUI 的根

Canvas 是所有 UI 元素的容器,任何 UGUI 组件都必须放在某个 Canvas 之下才能渲染。一个 Canvas 有三个核心字段:Render Mode、Pixel Perfect、Sorting Layer。

### 1.1 三种 Render Mode

| 模式 | 行为 | 适用场景 |
|---|---|---|
| **Screen Space - Overlay** | UI 画在屏幕最上层,不受场景光照影响 | 99% 的 2D UI(主界面、HUD) |
| **Screen Space - Camera** | UI 画在指定相机前的一个平面上,受相机 FOV / 旋转影响 | 3D UI(伏在相机上的望远镜) |
| **World Space** | UI 作为场景中的一个平面物体存在 | NPC 头顶血条、世界中的告示牌 |

```text
Overlay      : 屏幕坐标,无变换,排序层最上
Camera       : 屏幕坐标,Plane Distance 控制纵深
World Space  : 世界坐标,Event Camera 决定事件来源
```

**关键差别**:
- Overlay 模式不参与深度排序,UI 永远在 3D 物体之上
- Camera 模式可以有 3D 物体挡住 UI(比如场景中的烟雾)
- World Space 完全脱离屏幕,UI 是世界的一部分

### 1.2 Canvas 的渲染机制

Canvas 自身是一个独立绘制单元,**只要它有至少一个 Graphic 子物体,就至少占一个 DrawCall**(空 Canvas 不画)。

UGUI 的渲染分两阶段:
1. **Rebuild**:收集所有子 Graphic 的顶点 / 顶点颜色,合并到一个 Mesh
2. **SendWillRenderCanvases**:把 Mesh 提交 GPU

性能面板里的 `Canvas.SendWillRenderCanvases` 就是这个过程的开销。Canvas 上的元素只要脏标记(`SetVerticesDirty` / `SetLayoutDirty`)就会触发整 Canvas 重建,所以"动静分离"是 UGUI 优化的核心思路(详见性能篇)。

<!-- more -->

### 1.3 CanvasGroup

`CanvasGroup` 不是 Canvas,而是给一段 UI 子树批量控制透明度、交互、射线检测:

```csharp
[RequireComponent(typeof(CanvasGroup))]
public class UIFader : MonoBehaviour
{
    private CanvasGroup _group;
    void Awake() => _group = GetComponent<CanvasGroup>();

    public void Hide()
    {
        _group.alpha = 0;
        _group.interactable = false;
        _group.blocksRaycasts = false;
    }
}
```

替代 `SetActive(false)` 隐藏 UI 时,`CanvasGroup` 不会触发 UI 重建,性能更好。

### 1.4 RectTransform / Anchor / Pivot:布局基础

UGUI 用 `RectTransform`(继承 Transform)定位 UI。三个核心字段决定"屏幕尺寸变时 UI 怎么动":

**Anchor(锚点)**——子 UI 在父容器中的"参考点":

| 锚点 | 屏幕尺寸变时行为 |
|------|----------------|
| 中心点(`0.5, 0.5`) | UI 永远居中,不拉伸 |
| 四角撑开(`Min=0,0 Max=1,1`) | UI 跟父级一起拉满,适合全屏背景 |
| 顶部某点 | UI 钉在顶部某位置 |
| 左右撑开(`Min=0,0.5 Max=1,0.5`) | 横向跟随,高度固定 |

**Pivot(中心点)**——UI 自身旋转 / 缩放的基准,`(0.5, 0.5)` 是中心,`(0, 0)` 是左下角。改 Pivot 不影响显示位置但影响旋转观感。

**anchoredPosition**——相对 Anchor 的偏移量(像素)。

```text
Canvas 1920×1080,UI 锚点中心 → UI 在中心,改分辨率 UI 还在中心
Canvas 1920×1080,UI 锚点左下角 → UI 钉左下角,跟分辨率无关
Canvas 1920×1080,UI 锚点四角撑开 → UI 跟 Canvas 一起拉伸
```

**Canvas Scaler** 决定 Canvas 整体如何适配分辨率:

| 模式 | 适合 |
|------|------|
| Constant Pixel Size | 固定像素(不缩放,小屏 UI 显得大) |
| **Scale With Screen Size** | **最常用**,按目标分辨率缩放 |
| Constant Physical Size | 按 DPI 真实物理大小(英寸 / mm) |

`Scale With Screen Size` 配置 `Reference Resolution(1920×1080)` + `Match = 0.5`(宽高各半权重),适配大多数项目。Match = 0 只看宽度,Match = 1 只看高度。

## 二、Graphic 与 GraphicRegistry

### 2.1 Graphic 抽象基类

`Graphic` 是所有可绘制 UI 组件的基类,`Image` 和 `Text` 都继承自它。它定义了:

- `color` / `raycastTarget` 等基础属性
- `SetVerticesDirty()` / `SetLayoutDirty()` 脏标记
- `OnPopulateMesh(VertexHelper vh)` 子类重写来填充顶点

```csharp
public class Empty4Raycast : MaskableGraphic
{
    protected Empty4Raycast() { useLegacyMeshGeneration = false; }

    protected override void OnPopulateMesh(VertexHelper toFill)
    {
        toFill.Clear();   // 不画任何顶点,但保留 raycast 能力
    }
}
```

**实用技巧**:很多人用透明 Image 当作 Button 的点击区域,但 alpha=0 的 Image 仍然参与渲染,**仍然占 DrawCall**。正确做法是写一个 `Empty4Raycast` 组件:继承 `MaskableGraphic` 但 `OnPopulateMesh` 里清空顶点,这样既有 raycast 又不参与绘制。

### 2.2 GraphicRegistry

`GraphicRegistry` 是 Canvas 与 Graphic 之间的注册表:

- Graphic 在 `OnEnable` 时把自己注册到所属 Canvas 的注册表
- GraphicRaycaster 通过这个注册表反向查找"哪些 Graphic 被点击"
- Canvas 在 Rebuild 时遍历所有注册的 Graphic

源码位置:`UnityEngine.UI.GraphicRegistry`。日常用不到,理解架构时有用。

### 2.3 Cull Transparent Mesh

Canvas 上的 `Cull Transparent Mesh` 选项:勾选后完全透明的 UI 元素会被剔除,不参与渲染批次;不勾选则会占一个 DrawCall。

默认勾选能省 DC,但如果你用透明 Image 做拖动热区,记得改成不参与绘制(用上面的 `Empty4Raycast`)。

## 三、Image 与 RawImage

### 3.1 Image:Sprite 承载

`Image` 是 UGUI 中显示精灵的标准组件,核心字段:

| 字段 | 含义 |
|---|---|
| `Source Image` | Sprite 引用 |
| `Color` | 整体颜色(与材质相乘) |
| `Material` | 自定义材质 |
| `Raycast Target` | 是否参与射线检测 |
| `Image Type` | Simple / Sliced / Tiled / Filled |
| `Preserve Aspect` | 保持原始比例 |
| `Set Native Size` | 按原始像素设置大小 |

`Sliced`(九宫格)是 UI 切图的关键:把 Sprite 切成 9 块,中间拉伸、四角不变形,常用于背景框、按钮。

### 3.2 RawImage:Texture 承载

`RawImage` 直接吃 `Texture`,没有 Sprite 的九宫格、UV 自动管理,只支持简单贴图:

```csharp
public class UIDynamicRawImage : RawImage
{
    public void SetTexture(Texture2D tex)
    {
        texture = tex;
        SetNativeSize();
    }
}
```

**用途对比**:

| 组件 | 数据源 | 适用 |
|---|---|---|
| `Image` | `Sprite`(图集可合批) | UI 静态图、九宫格 |
| `RawImage` | `Texture`(不能合批) | 网络下载图、RenderTexture、动态生成的图 |

**性能陷阱**:大量 RawImage 用不同 Texture 会破坏合批。规则是"同图集合批 = 同材质 + 同纹理",RawImage 各自一个纹理,等于各自一个 DC。

### 3.3 RawImage 显示多边形 / 圆形

默认 Image / RawImage 只能显示矩形。要显示圆形 / 多边形,可以:

1. **修改 UV**:让 RawImage 的四边形顶点 UV 映射到圆形纹理的有效区域
2. **改写 OnPopulateMesh**:自定义顶点(比如 12 段三角形拼圆)
3. **用 Shader**:片段着色器里 `discard` 圆外的像素

最常用的是改 UV:`RawImage.uvRect` 是一个 `Rect`,`x/y/w/h` 决定纹理采样区域,把它从 `(0,0,1,1)` 改成子区域就能"裁"出一个圆形。

### 3.4 Image 裁切

Image 裁切有几种思路:
- **RectMask2D / Mask**:把 Image 放到裁切容器下,详见 UGUI 进阶篇
- **Fill Amount**:`Image Type = Filled` 时,`fillAmount` 控制可见比例,适合做血条、CD
- **修改 RectTransform**:外层加个非溢出容器,改 Image 的 anchoredPosition

### 3.5 UvRect 与坐标转换

`RawImage.uvRect` 用的是 0~1 的归一化坐标,要和 UI 的 pixel 坐标互转:

```csharp
// UI 像素坐标 → uv 坐标
Vector2 uiPos = new Vector2(100, 50);
Rect uvRect = rawImage.uvRect;
Vector2 uv = new Vector2(
    uvRect.x + uiPos.x / rawImage.rectTransform.rect.width * uvRect.width,
    uvRect.y + uiPos.y / rawImage.rectTransform.rect.height * uvRect.height
);
```

这种转换常用于"在 RawImage 上点击的位置对应到纹理上的某个像素",做颜色拾取、热区判断。

### 3.6 交互控件:Button / Toggle / Slider / Dropdown / Scrollbar

UGUI 内置 5 个交互控件,都继承自 `Selectable`(支持过渡、键盘导航):

| 控件 | 作用 | 关键字段 / 事件 |
|------|------|----------------|
| **Button** | 点击触发 | `onClick`(UnityEvent)、`interactable`、过渡色调 |
| **Toggle** | 勾选框 | `isOn`、`onValueChanged`、Toggle Group(单选) |
| **Slider** | 滑动数值 | `value`、`minValue/maxValue`、`onValueChanged`、`wholeNumbers` |
| **Scrollbar** | 滚动条 | `value`(0-1)、`direction`、`onValueChanged` |
| **Dropdown** | 下拉选择 | `value`、`options`、`onValueChanged`、`template` |

```csharp
// Button
button.onClick.AddListener(() => Debug.Log("Clicked"));
button.interactable = false;  // 灰显不可点

// Toggle + Toggle Group(单选,像 Tab)
toggle.onValueChanged.AddListener(on => Debug.Log("Checked: " + on));
toggleGroup.RegisterToggle(toggle);  // 同组 Toggle 只能一个 isOn = true

// Slider
slider.minValue = 0;
slider.maxValue = 100;
slider.wholeNumbers = true;  // 只允许整数
slider.onValueChanged.AddListener(v => hp = Mathf.RoundToInt(v));

// Dropdown 自定义选项
dropdown.ClearOptions();
dropdown.AddOptions(new List<string> { "Easy", "Normal", "Hard" });
dropdown.value = 1;          // 默认 Normal
dropdown.RefreshShownValue();
```

> Dropdown 默认用原生 UI,风格统一性差,UI 风格强的项目常用 TMP_Dropdown 或自写。
>
> **Selectable 的 Navigation**:Tab 键在控件间跳转,默认 `Automatic`,改成 `Explicit` 可手动指定上 / 下 / 左 / 右跳到哪个控件,适合手柄 / 键盘操作的游戏菜单。

## 四、Text 与 TextMeshPro

### 4.1 Text 的渲染原理

Text 不是"画字",而是把字符串动态光栅化成纹理,再画矩形面片:

```text
1. 字体文件 (.ttf) 加载到内存
2. 字符串中每个字符 → 字形位图(256x256 缓存纹理)
3. 字形位图存不下时扩大纹理(最大 1024x1024)
4. 纹理变化时,通过 TextureRebuildCallback 通知所有 Text 重建
5. 顶点构建:每个字符一个四边形,UV 指向字形位图
6. 提交 Mesh 给 Canvas 合批
```

**性能要点**:
- 字符首次出现时要光栅化,可能卡顿
- 不同字号、不同字体风格的同一字符会占多个缓存槽
- 字符串变化频繁(比如计分)会反复重建顶点

### 4.2 Shadow 与 Outline 的代价

```csharp
public class Shadow : BaseMeshEffect { ... }
public class Outline : Shadow { ... }
```

`Shadow` 在 `ModifyMesh` 里把原始顶点复制一份,加上偏移,画一遍自己的影子。
`Outline` 继承 Shadow,**画了 4 份影子**(上下左右),顶点数 ×5。

**结论**:用 Outline / Shadow 会让 Text 顶点数暴增。如果几十个 Text 都加 Outline,顶点压力很大。优化方案:
- 用 TextMeshPro 内置的描边(顶点不增加)
- 把描边烘焙到字库里
- 关键位置用 Image 描边代替

### 4.3 ContentSizeFitter:文字自适应

希望 Text 的 RectTransform 跟随内容变化:

```csharp
ContentSizeFitter fitter = text.GetComponent<ContentSizeFitter>();
fitter.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
```

或手动:

```csharp
public void FitTextHeight(Text text)
{
    RectTransform rt = text.GetComponent<RectTransform>();
    rt.SetSizeWithCurrentAnchors(RectTransform.Axis.Vertical, text.preferredHeight);
}
```

`ContentSizeFitter` 内部就是这么做的,但在 Layout 系统里集成得更好。

## 五、TextMeshPro:升级版文字

### 5.1 与原生 Text 的区别

| 维度 | Text | TextMeshPro |
|---|---|---|
| 字体格式 | .ttf / .otf | TMP_FontAsset(自带 SDF) |
| 渲染管线 | 传统位图 | SDF(可任意缩放不糊) |
| 描边 / 阴影 | 加组件,顶点暴增 | 内置字段,零顶点开销 |
| 富文本 | 有限 | 完整(<color>、<sprite>、<size>) |
| 字符缓存 | 动态光栅化 | 预生成图集 |
| 中文断行 | CJK 友好 | 默认按空格断行,需配置 |

### 5.2 TMP 的中文断行坑

TMP 默认按拉丁语系规则断行:遇到空格才允许换行。中文字与字之间没空格,会被当作一个超长单词,导致溢出。

**解决方案**:
1. 用新版 TMP(2.1+),开启 `isRightToLeft` 旁边的 CJK 选项
2. 自定义 LineBreakingTable:在 `LineBreaking Leading Characters` / `Following Characters` 里加中文字符
3. 用 `<space>` 标签手动插软换行点

### 5.3 TMP Sprite Asset:图文混排

TMP 支持 inline sprite,做法:
1. 准备一张图集
2. `Window → TextMeshPro → Sprite Asset` 创建 sprite 资源
3. 给 TMP_Text 字段 `Sprite Asset` 赋值
4. 文本里写 `<sprite name="coin"> 100` 或 `<sprite index=0>`

`<sprite>` 标签会在文字流中插入精灵,参与排版,比"一个 Image 一个 Text 拼起来"省顶点、省 DrawCall。

### 5.4 TMP 与原生 Text 的换行字符差异

```text
   → 不换行空格(nbsp)
   → 普通空格,允许换行
　  → 全角空格,CJK 才有
```

TMP 默认把全角空格当作可换行,有时会导致中文段落奇怪地换行,可以把全角空格替换成 nbsp:

```csharp
text = text.Replace("　", " ");
```

## 六、Text 输入(InputField)

InputField 的回调触发、`SetTextWithoutNotify`、输入长度校验、TMP_InputField 差异等内容,**集中在输入篇** [Unity 输入与交互 §5 InputField](/2024/08/10/unity-input-eventsystem/#五-inputfield-与-tmp-inputfield) 讨论(那里更成体系)。

本篇只列高频踩坑速查:

- `inputField.text = ...` 会触发 `onValueChanged` → 改用 `inputField.SetTextWithoutNotify(...)`
- 多次连续修改会触发多次回调 → 用 `_suppress` 标志位避免递归
- TMP_InputField 跟 InputField API 几乎一致,迁移成本低

## 七、综合性能建议

| 场景 | 优化点 |
|---|---|
| 大量 UI | 同图集合批;动静分离(动元素单独 Canvas) |
| 透明热区 | 用 `Empty4Raycast` 替代 alpha=0 的 Image |
| 文字描边 | 用 TMP,避免 Outline 组件 |
| 大图 | 用 RawImage + Texture,但单独 Canvas 避免破坏合批 |
| 频繁变化的数字 | 关闭 Raycast Target,考虑用 Text 而非 TMP(看场景) |
| 静态背景 | 单独 Canvas,Canvas.willRenderCanvases 不被脏标记 |

## 参考

- [Unity UGUI 源码](https://github.com/Unity-Technologies/uGUI)
- [Canvas Render Mode 三种模式](https://blog.csdn.net/fdyshlk/article/details/78509909)
- [UGUI 之 RawImage 显示多边形](https://www.xuanyusong.com/archives/4375)
- [TextMeshPro 中文断行问题](https://blog.csdn.net/linxinfa/article/details/123681974)
- [Unity 内存优化:Text 渲染原理](https://blog.csdn.net/weixin_38027841/article/details/116093515)

---

下一篇:[Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/) — 整合 ScrollRect、Mask 与 RectMask2D 的实现差异、GraphicRaycaster、布局组件。

## 系列目录

1. [Unity 生命周期、MonoBehaviour 与场景管理](/2024/08/10/unity-lifecycle-mono-scene/)
2. Unity UGUI 基础组件(本篇)
3. [Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/)
4. [Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/)
5. [Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/)
6. [Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/)
7. [Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. [Unity Android 构建与调试](/2024/08/10/unity-android-build-debug/)
10. [Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/)
