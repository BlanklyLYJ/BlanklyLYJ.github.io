---
title: 风格化后处理与曲线:Glitch Art / Bezier / 蓝色协议
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - 图形学
  - 后处理
  - Glitch
  - Bezier
  - 蓝色协议
  - Shader
categories:
  - [图形学, Shader]
comments: true
---

> 这一篇把风格化视觉表现层的三个主题整合到一起:十种 Glitch Art(故障艺术)后处理算法的实现要点、Bezier(贝塞尔)曲线在游戏里的工程用法,以及《蓝色协议 BLUE PROTOCOL》的技术分享解读。共同点:都是"让画面更好看"的视觉表现技术,核心都是噪声 / 数学 / 后处理组合。

## 一、Glitch Art:赛博朋克的视觉语言

**故障艺术(Glitch Art)** 是赛博朋克风格的核心元素之一,本质是把数字软硬件故障引起的破碎、变形、错位、失真,经过艺术加工做成先锋视觉表现。《赛博朋克 2077》《银翼杀手 2049》《看门狗 2》《攻壳机动队》都大量使用了这套视觉语言。

业界参考实现:毛星云的 X-PostProcessing Library (XPL),Unity Post-processing Stack v2 的开源后处理算法库。

主流的十种 Glitch 后处理:

| 名称 | 核心思想 |
| --- | --- |
| RGB 颜色分离 | RGB 三通道用不同 uv 偏移采样 |
| 错位图块 | 横纵交错的随机强度图块做 uv 抖动 |
| 错位线条 | 行级 UV 抖动 |
| 图块抖动 | 整块小区域集体偏移 |
| 扫描线抖动 | 沿水平方向随机行偏移 |
| 数字条纹 | 横向条纹错位 |
| 模拟噪点 | 叠加随机噪声 |
| 屏幕跳跃 | 整帧纵向跳变 |
| 屏幕抖动 | 整帧水平 / 垂直抖动 |
| 波动抖动 | 正弦波驱动 uv 偏移 |

<!-- more -->

### 1.1 通用噪声函数

几乎所有 Glitch 都要随机数,常用低成本的 GLSL 噪声:

```glsl
float randomNoise(float x, float y)
{
    return frac(sin(dot(float2(x, y), float2(12.9898, 78.233))) * 43758.5453);
}
```

原理是 `sin * 大数取小数部分`,得到伪随机分布。性能远好于真正的 Perlin / Simplex,适合后处理这种全屏开销敏感场景。

### 1.2 RGB 颜色分离 Glitch

```glsl
half4 Frag_Horizontal(VaryingsDefault i) : SV_Target
{
    float splitAmount = _Indensity * randomNoise(_TimeX, 2);

    half4 colorR = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
        float2(i.texcoord.x + splitAmount, i.texcoord.y));
    half4 colorG = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.texcoord);
    half4 colorB = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
        float2(i.texcoord.x - splitAmount, i.texcoord.y));

    return half4(colorR.r, colorG.g, colorB.b, 1);
}
```

要点:G 通道用原始 uv,R 和 B 各自左右偏移,偏移量由噪声驱动。可以用三角函数 + pow 控制抖动的间隔、幅度、曲线,得到更"自然"的不规律感。

```glsl
float splitAmout = (1.0 + sin(_TimeX * 6.0)) * 0.5;
splitAmout *= 1.0 + sin(_TimeX * 16.0) * 0.5;
splitAmout *= 1.0 + sin(_TimeX * 19.0) * 0.5;
splitAmout *= 1.0 + sin(_TimeX * 27.0) * 0.5;
splitAmout = pow(splitAmout, _Amplitude);
splitAmout *= 0.05 * _Amount;
```

### 1.3 错位图块 Glitch

第一步:基于 uv 和噪声生成方格块。

```glsl
half2 block = randomNoise(floor(i.texcoord * _BlockSize));
```

第二步:对强度做二次筛选,增加随机性。

```glsl
half displaceNoise = pow(block.x, 8.0) * pow(block.x, 3.0);
```

第三步:用筛选后的强度对 G/B 通道采样。

```glsl
half r = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.texcoord).r;
half g = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
    i.texcoord + float2(displaceNoise * 0.05 * randomNoise(7.0), 0.0)).g;
half b = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex,
    i.texcoord - float2(displaceNoise * 0.05 * randomNoise(13.0), 0.0)).b;
return half4(r, g, b, 1.0);
```

进阶版可以做"双层 blockLayer + 双层强度筛选",配合 RGBSplitNoise,得到更丰富的图块表现。

### 1.4 Glitch 工程要点

- **不要常开**:Glitch 是"信号失效"的视觉表达,常开就成静态滤镜了。最好绑定"信号干扰 / 受击 / 切场"等事件,短暂触发。
- **频率与时间**:`_TimeX` 驱动 + 多个不同频率 sin 叠加 = 自然随机感。
- **性能**:全屏后处理一定要避免分支和重复采样,把噪声和偏移塞进一个 pass。
- **可读性**:把每种 Glitch 拆成独立 Effect,通过 Blit 链组合,而不是写一个千行大 Shader。

## 二、Bezier 曲线:游戏里的万能曲线

**贝塞尔曲线(Bézier)** 用控制点定义一条参数曲线,核心公式(De Casteljau 算法):

```text
n 阶贝塞尔曲线 B(t) = Σ C(n,i) * (1-t)^(n-i) * t^i * P_i     t ∈ [0,1]
```

按阶数:

| 阶数 | 控制点数 | 形态 |
| --- | --- | --- |
| 一阶 | 2 | 直线段 |
| 二阶 | 3 | 抛物线段 |
| 三阶 | 4 | 最常用 |
| n 阶 | n+1 | 复杂曲线 |

### 代码实现(三阶)

```csharp
public static Vector3 CubicBezier(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float t)
{
    float u = 1 - t;
    float tt = t * t;
    float uu = u * u;
    float uuu = uu * u;
    float ttt = tt * t;

    return uuu * p0                 // (1-t)^3 * P0
         + 3 * uu * t * p1          // 3(1-t)^2 t * P1
         + 3 * u * tt * p2          // 3(1-t) t^2 * P2
         + ttt * p3;                // t^3 * P3
}
```

### 游戏里的典型用法

- **相机轨迹**:策划在编辑器里放控制点,相机沿 Bezier 平滑运动。
- **UI 弹窗动画**:`EaseIn / EaseOut / EaseInOut` 本质就是参数 t 经过 Bezier 重映射。
- **抛物线技能**:火球、跳跃,三阶 Bezier 加 1 个高度控制点。
- **路径平滑**:NavMesh 路径折线点用 Bezier 平滑,角色移动更自然。
- **粒子 / 弹幕轨迹**:曲率可控,看起来比直线生动得多。

### 进阶要点

- **切线方向**:对 B(t) 求导,得到曲线在某点的速度方向,常用来对齐朝向。
- **弧长参数化**:Bezier 的 t 不是均匀弧长,需要预计算查找表,做"匀速沿曲线移动"。
- **样条拼接**:多段 Bezier 之间保证 C1 连续(切线一致)才能平滑过渡,这是 Catmull-Rom / B-Spline 的思路。

## 三、《蓝色协议》技术解读

《蓝色协议》是万代南梦宫的二次元开放世界 MMO,日系动漫风渲染的标杆。其技术分享的几个亮点:

### 3.1 卡通渲染核心

- ** ramp shading**:把光照结果映射到一张阶梯式渐变纹理,得到"赛璐璐"分层着色。
- **rim light 边缘光**:`1 - dot(N, V)` 配合阈值,得到亮边描边效果。
- **法线修改**:在 Shader 里用法线扰动模拟手绘笔触。

### 3.2 描边

业界主流三种描边方案:

| 方案 | 思路 | 优缺点 |
| --- | --- | --- |
| Back-face 描边 | 反向法线膨胀背面画黑色 | 简单但粗细不均 |
| 后处理描边 | Sobel / Roberts 边缘检测 | 灵活但易抖动 |
| 几何描边 | 重建法线 / 深度做边 | 质量最高,开销大 |

蓝色协议混合使用几何描边 + 后处理,根据镜头距离切换。

### 3.3 大世界与流式加载

- 多 LOO(Level of Origin)区块划分。
- 视锥剔除 + 遮挡剔除双重过滤。
- 异步流式加载,关键资源预加载。

### 3.4 角色与场景光照统一

二次元风格最大的挑战是"在不同环境下角色和场景光照一致"。他们做法:

- 角色用**自定义光照通道**,不被场景真实光源计算干扰。
- 场景烘焙全局 SH(Spherical Harmonics)系数,运行时给角色"补环境光"。
- 重要时刻切到"剧场光照",牺牲一致性换戏剧感。

### 3.5 性能与渲染管线

- Forward+(前向 +)做大量实时光。
- 自研 LOD 系统,角色头发、衣物都做了离散 LOD。
- GPU Driven Rendering 减少绘制调用。

## 四、视觉表现层的"配方"思路

把上面三块组合起来,可以发现风格化视觉的核心是**数学 + 噪声 + 后处理**的组合:

```text
噪声函数 (random / Perlin / Simplex)
   ↓
驱动 uv 偏移 / 颜色通道分离
   ↓
后处理 Pass 输出最终画面
```

- **故障艺术**:噪声 + uv 偏移。
- **二次元**:阶梯光照 + 描边 + ramp。
- **Bezier 动画**:参数化曲线驱动 UI / 相机。
- **大世界 MMO**:流式加载 + GPU Driven + 自定义光照通道。

掌握这套思路后,看到任何"看起来很酷"的效果,都能拆解成"用某数学工具驱动某视觉变量"的配方,而不是把它当成黑魔法。下一主题会切换到数据结构与算法,把树、图、排序、缓存这些更底层的内容讲清楚。
