---
permalink: 2024/08/10/perf-mission5-ui-drawcall/
title: Unity 性能优化(五):UI 热点函数与 DrawCall 优化
date: 2024-08-10 21:00:00
updated: 2024-08-10 21:00:00
tags:
  - Unity
  - 性能优化
  - UGUI
  - DrawCall
  - 合批
categories:
  - [Unity, 性能优化]
comments: true
---

> 这是性能优化系列的第五篇,主线是 Mission 5:UI 热点函数 + DrawCall 优化。UI 在大多数手游里都是大头——玩家停留时间最长的就是各种界面。UI 卡顿和 DC 高的根因都在两件事:**Rebuild(重建)** 和 **Batch(合批)**。这篇把 UGUI 的耗时点、合批原理、Rebuild 优化、Mask/特效的坑一次性梳理清楚。

## 一、UI 的两个性能战场

UGUI 的性能压力来自:

1. **CPU 端 Rebuild**:UI 元素属性变化触发重建(顶点、网格、布局)
2. **CPU/GPU 端 Batch**:合批失败导致 DC 数量上涨,设置渲染状态耗时增加

Profiler 中的几个关键函数:

| 函数 | 含义 |
|---|---|
| `Canvas.SendWillRenderCanvases` | UI 元素属性变化触发的更新耗时 |
| `Canvas.BuildBatch` | UI 元素 Mesh 合并耗时 |
| `EmitWorldScreenspaceCameraGeometry` | 主线程等待子线程合并完成 |
| `Rendering.UpdateBatches` | SyncTransform 触发的批量更新 |
| `EventSystem.Update` | 输入、Raycast、事件分发 |

<!-- more -->

## 二、Canvas.SendWillRenderCanvases:UI 更新本身

每次 UI 元素的 **UIVertex 属性** 发生变化(位置、颜色、UV、大小等),都会被收集到 Rebuild 队列,在 `SendWillRenderCanvases` 时统一处理。

**优化思路:减少 UI 更新频率**。

- 跑马灯、动画 UI 用 GameObject 启停控制(代价小)
- 数据刷新做**隔帧更新**(不需要每帧更新)
- 关闭 UI 后停止它的更新逻辑,不要"看不见也在更新"

## 三、BuildBatch:网格合并

同一个 Canvas 下的 UI 元素会**合并到一个 Mesh** 中。Canvas 任何元素变化都会触发整个 Canvas 的合并重做。

合并流程:

1. Canvas 主线程发起 BuildBatch
2. 实际合并工作交子线程
3. 子线程压力大 / 网格太复杂 → 主线程产生等待
4. 等待耗时统计到 `EmitWorldScreenspaceCameraGeometry`

UGUI 合并时会根据 UI 属性**重排**,在不改变渲染效果的前提下,把相同材质的 UI 元素尽量放进同一个 SubMesh,把 DC 降到最低。

**优化**:动静分离——把"经常变"和"不变"的 UI 分到不同 Canvas。

## 四、SyncTransform:SetActive 的连锁反应

Canvas 下某个 UI 元素 `SetActive(true)` 激活时,会导致:

- 同 Canvas 下**其他 UI 元素**触发 SyncTransform
- 父 Canvas 下**其他 UI 元素**也触发 SyncTransform

当这种 SetActive 操作非常频繁时,父节点的 `Rendering.UpdateBatches` 耗时会爆炸。

**优化方案(三选一)**:

```csharp
// 1. 动静分离:把反复 SetActive 的元素单独放一个 Canvas
layoutGroup.gameObject.AddComponent<Canvas>();
layoutGroup.gameObject.AddComponent<GraphicRaycaster>();

// 2. 不用 SetActive,改 localScale
uiElement.transform.localScale = Vector3.zero;  // 隐藏
uiElement.transform.localScale = Vector3.one;   // 显示

// 3. 用 CanvasGroup 控制透明度
canvasGroup.alpha = 0;
canvasGroup.interactable = false;
canvasGroup.blocksRaycasts = false;
```

## 五、EventSystem.Update:Raycast 轮询

UGUI 的 Graphic Raycaster 每帧会遍历所有 **RaycastTarget = true** 的组件,做射线检测,看哪些 UI 接收到了点击。

**优化**:

- 不需要接收事件的 Image、Text → **关闭 Raycast Target**
- 不用富文本的 Text → 关闭 Rich Text
- 尽量不用 Best Fit(计算量大)

## 六、DrawCall 计算原理:Depth 排序

UGUI 的 DC 计算比想象复杂,核心是 **Depth 计算 + 排序**。

### 6.1 Depth 计算

每个 Canvas 内部按 Hierarchy 顺序(深度优先)计算每个渲染元素的 Depth:

1. 跳过不渲染的节点(active = false、Image disabled、不可见 Layer 等)
2. 没有任何元素相交 → depth = 0
3. 有相交 → 找相交元素中 max depth 的元素
   - 能 Batch(同材质/图集)→ depth = max depth
   - 不能 Batch → depth = max depth + 1
4. 同时盖多个元素 → 取最高 depth 的元素参与计算

> 注意:Depth 与 Hierarchy 节点无关,只和**渲染元素是否相交**有关。

### 6.2 三轮排序

计算完 Depth 后,UGUI 做三轮排序得到最终 DC 顺序:

1. 按 **Depth 升序**
2. 同 Depth 内按 **Material Instance ID 升序**
3. 同 Material 内按 **Texture Instance ID 升序**

排序完成后,相邻且 Material + Texture 相同的元素合并成一个 DC。

### 6.3 优化点

- **同 Canvas 才合批**:不同 Canvas 不会合批(即使 Order in Layer 相同)
- **Tag/Layer 不同** → 不影响合批
- **Outline/Shadow 脚本** → 不影响合批(但增加顶点)
- **避免 UnityWhite 默认图**:Mask、Sprite、Background 等用默认 Unity 图不利于合批
- **垫高层级让 Text 合批**:给 Text 下面放一张透明图,把 Text 层级"垫"到和其他 Text 相同
- **RectTransform 值不同** → 不影响合批

## 七、Mask 与 RectMask2D:实现机制完全不同

两者都是裁剪,但原理和 DC 表现完全不同。

| 维度 | Mask | RectMask2D |
|---|---|---|
| 实现层 | GPU(Shader 模板测试) | CPU(矩形顶点裁剪) |
| 多出 DC | 是(前后各 1 个 Mask DC) | 否 |
| 内外合批 | Mask 内可与外部 Mask 合批 | RectMask2D 内不与外界合批 |
| Mask 之间 | 可互相合批 | 互不相干 |
| 裁剪形状 | 任意(Image 决定) | 仅矩形 |

**Mask 原理**:GPU 模板缓冲,先在节点前画一个区域确定裁剪范围,Mask 节点下的元素按这个范围算 Alpha,最后绘制结束指令。

**RectMask2D 原理**:不需要图片,CPU 计算元素是否在矩形内。完全脱离矩形的元素直接不渲染(DC = 0),Mask 没这个现象。

**选型**:

- 滚动列表(List 同质元素)→ RectMask2D(无额外 DC)
- 不规则形状裁剪 → Mask
- 多个 Mask 内元素可能合批 → 一个 Canvas 内放 Mask

## 八、Rebuild:比 DC 影响更大的元凶

Rebuild 分两种:

### 8.1 Layout Rebuild

重新计算 Layout 组件子节点的位置或大小(如 HorizontalLayoutGroup)。触发场景:

- OnEnable
- OnDidApplyAnimationProperties
- OnRectTransformDimensionsChange
- OnTransformChildrenChanged
- 直接子节点(且是 Graphic 类型)被 SetLayoutDirty

### 8.2 Graphic Rebuild

Graphic 类的 `SetAllDirty / SetLayoutDirty / SetVerticesDirty / SetMaterialDirty` 都触发 Rebuild。基本大小、旋转、文字变化、图片修改都会触发。

### 8.3 Rebuild 优化原则

UGUI 在一帧内**收集所有 dirty**,然后统一处理。所以单帧内多次 SetDirty 只会 Rebuild 一次,但 Rebuild 范围是整个 Canvas。

**优化**:

1. **动静分离**:加载后一直不变化的 Graphic 放一个 Canvas;一直变化的(跑马灯、ANI)放另一个 Canvas
2. 减少 Canvas 子节点的删/增、显/隐
3. 减少 Canvas 子节点的 Vertex/Rect/Color/Material/Texture 改变
4. 不要设计层数太深、节点太多的 UI 结构

> 必要时适度增加 DC(分离 Canvas)换取 Rebuild 性能,**Rebuild 危害比 DC 多几个更大**。

## 九、粒子、Raycast、OverDraw 三大专项

### 9.1 粒子特效

粒子不归 Canvas 管,**它的分布与穿插不会影响 Canvas 的 DC**。

**坑**:如果粒子勾了 Render 属性,就有了 Order in Layer 概念,会和 Canvas 的 Order 混合。一个 Canvas 上挂个 Order=20 的特效,下一个 UI Order 不超过 20 就会被穿透。

### 9.2 Raycast Target 优化

Graphic Raycaster 遍历所有 RaycastTarget=true 的组件做一系列测试,通过测试的加入命中列表。不需要事件接收的组件一律关 Raycast Target。

### 9.3 OverDraw

OverDraw 是 GPU 压力来源,尤其半透明物体。可以在 Scene 视图左上角切到 OverDraw 模式查看,**颜色越鲜亮 OverDraw 越大**。

降低 OverDraw:

- 避免短时间内大量特效产生(多层叠加浪费资源,前几层挡住后面看不见)
- 特效产生在屏幕上**平均分布**(一个消亡另一个产生,换班显示)
- 避免 Unity 自带 Outline/Shadow,用 TextMeshPro 替代
- 不直接渲染特效,渲染到 MaskableGraphic(UI 方式展示)灵活控制层级

## 十、DrawCall 优化小项

| 优化项 | 收益 |
|---|---|
| 合并图集 | DC 显著下降 |
| 重叠不打断层级穿插 | 同 Depth 的同图集元素合批 |
| 避免 Z != 0 | Z 不为 0 会打断合批 |
| Pos Z = 0 时父子相邻可合批 | 满足图集/材质相同且相邻 |
| 静态 UI 节点合并 Mesh | DC 进一步下降 |

## 十一、UI 优化决策清单

- [ ] 不接收事件的 Image/Text,Raycast Target 是否关闭
- [ ] 反复 SetActive 的 UI 是否改用 localScale / CanvasGroup
- [ ] 是否动静分离(经常变化的 UI 单独 Canvas)
- [ ] Mask 是否合理使用(滚动列表用 RectMask2D)
- [ ] Outline/Shadow 是否用 TMP 替代
- [ ] 图集是否合并到位(同 Canvas 同图集)
- [ ] UI 元素 Z 值是否都为 0
- [ ] Best Fit 是否最小化使用
- [ ] 跑马灯等动画 UI 是否单独 Canvas

## 十二、收尾

UI 优化的核心:**Rebuild 比 DC 影响更大,动静分离永远是第一步**。

实战经验:把"频繁变化的 UI"独立到子 Canvas 后,即使 DC 多了 3-5 个,Rebuild 耗时下降 70% 以上,整体帧率反而提升。

下一篇讲 **加载优化与渲染模块 CPU/GPU 压力**——Shader 解析、Resources.UnloadUnusedAssets、合批、剔除、Overdraw、Shader 复杂度。
