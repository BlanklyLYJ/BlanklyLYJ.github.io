---
title: 图形学基础与法线纹理:从渲染管线到法线还原公式
date: 2024-08-10 23:00:00
updated: 2024-08-10 23:00:00
tags:
  - 图形学
  - 渲染管线
  - 法线纹理
  - 切线空间
  - Shader
categories:
  - [图形学, Shader]
comments: true
---

> 这一篇把图形学基础(渲染管线 / 空间 / 数学工具)和"从法线纹理还原法线向量"这个常被问到的面试题整合到一起。法线纹理是凹凸感渲染的核心,理解它的存储原理、采样公式、切线空间转换,才能写出正确的 PBR / 卡通 Shader。

## 一、图形学渲染管线速览

现代光栅化管线的核心阶段:

| 阶段 | 输入 | 输出 | 可编程 |
| --- | --- | --- | --- |
| 顶点着色 Vertex Shader | 顶点数据(位置、法线、uv) | 裁剪空间位置 | 是 |
| 曲面细分 Tessellation | 控制点 | 更密集顶点 | 可选 |
| 几何着色 Geometry Shader | 图元 | 0~N 个图元 | 可选 |
| 裁剪 / 视口变换 | 裁剪空间 | 屏幕坐标 | 否 |
| 光栅化 Rasterizer | 图元 | 片元 | 否 |
| 片元着色 Fragment Shader | 插值后的顶点属性 | 颜色 / 深度 | 是 |
| 输出合并 Output Merger | 颜色 / 深度 | 帧缓冲 | 否(可配置) |

理解两件事:

1. **顶点着色器决定位置,片元着色器决定颜色**。这是写 Shader 的第一原则。
2. 所有"高级效果"(PBR、卡通、故障艺术)本质上都是在片元着色器里改最终颜色。

<!-- more -->

## 二、坐标空间链路

一个顶点从模型到屏幕会经过一连串空间变换:

```text
模型空间 (Object)
   ↑  Model Matrix
世界空间 (World)
   ↑  View Matrix
观察空间 (View)
   ↑  Projection Matrix
裁剪空间 (Clip)
   ↑  透视除法
NDC (Normalized Device Coordinates)
   ↑  视口变换
屏幕空间 (Screen)
```

着色器里通常写法:

```glsl
// 顶点着色器
vec4 clipPos = projection * view * model * vec4(aPos, 1.0);
gl_Position = clipPos;
```

法线、切线等方向向量则不能用 MVP(可能有非均匀缩放),需要用法线矩阵 `transpose(inverse(mat3(model)))`。

## 三、光照模型的几个层次

| 模型 | 描述 | 性能 |
| --- | --- | --- |
| Lambert 漫反射 | `max(0, dot(N, L))` | 极低 |
| Half-Lambert | `0.5 * dot(N,L) + 0.5` | 低,适合卡通 |
| Phong / Blinn-Phong | 加 spec: `pow(dot(N,H), shininess)` | 中 |
| PBR(基于物理) | Cook-Torrance BRDF + 能量守恒 | 高 |

无论用哪种模型,**N(法线)** 都是核心输入。光照、阴影、环境反射、轮廓描边都要用到它。

## 四、法线纹理:把凹凸烘焙进纹理

### 为什么需要法线纹理

真实几何体用三角形表达凹凸成本太高(一个砖墙的砖缝就要数万顶点)。**法线纹理 Normal Map** 的思路是:**几何还是平的,但法线"假装"那里有凹凸**,光照用扰动后的法线算,视觉上就有了立体感。

### 法线的存储

法线是单位向量,三个分量范围 [-1, 1];而 RGBA8 纹理每个通道范围 [0, 1]。所以存储时要做映射:

```text
存储:  color = (normal + 1) * 0.5
还原:  normal = color * 2 - 1
```

这就是面试题"从法线纹理还原法线向量"的核心公式。

```glsl
// 采样并还原法线
vec3 normalSampled = texture(normalMap, uv).rgb;
vec3 normal = normalSampled * 2.0 - 1.0;
```

### 切线空间(Tangent Space)

法线纹理里的法线**几乎都是切线空间下的**(Z 朝外为正,所以纹理整体偏蓝)。要让光照算式工作,需要把它转到世界空间(或把光照转到切线空间)。

切线空间由三个基向量组成:

- **N(Normal)**:顶点法线。
- **T(Tangent)**:沿纹理 U 方向的切线。
- **B(Bitangent)**:`cross(N, T) * sign`,沿 V 方向。

构造 TBN 矩阵:

```glsl
vec3 T = normalize(tangent);
vec3 N = normalize(normal);
vec3 B = cross(N, T) * tangent.w;   // w 存 handedness

mat3 TBN = mat3(T, B, N);

// 把采样到的法线从切线空间转到世界空间
vec3 worldNormal = normalize(TBN * normal);
```

### 完整片元着色器片段

```glsl
// 顶点着色器把 TBN 传下来
vTBN = mat3(T, B, N);   // 已经是世界空间

// 片元着色器
vec3 n_tangent = texture(normalMap, uv).rgb * 2.0 - 1.0;
vec3 N = normalize(vTBN * n_tangent);

vec3 L = normalize(lightDir);
float diff = max(dot(N, L), 0.0);
vec3 color = albedo * (ambient + diff * lightColor);
```

## 五、为什么切线空间法线纹理是"蓝色"的

打开一张法线纹理,会发现整体偏蓝紫。原因:

- 切线空间 Z 轴 = N(法线),对大多数"几乎朝外"的法线,z 分量接近 1。
- 还原前存储:`(z + 1) * 0.5`,z 接近 1 时颜色接近 1,蓝色通道满值。
- 所以纹理整体看起来偏蓝。

这是个简单但实用的视觉判据:**一张看起来蓝紫的纹理多半是切线空间法线贴图**,而一张五颜六色的可能是世界空间 / 对象空间法线贴图(用于特殊场景如水面波纹、体积法线)。

## 六、法线纹理常见踩坑

| 现象 | 原因 |
| --- | --- |
| 光照方向看起来反了 | 法线没 normalize / TBN 顺序写错 |
| 凹凸感反向(凸变凹) | 还原公式写反了,或者纹理被当作 OpenGL / DX 不同坐标 |
| 静态时正常,动画后变形 | 没在顶点着色器重新算 TBN |
| 缩放后光照抖 | 模型有非均匀缩放,没用法线矩阵 |
| 跨平台差异 | OpenGL 和 DirectX 的 uv.y 方向相反,需要在采样时翻转 |

## 七、和其他图形技术的衔接

- **PBR**:法线是 BRDF 的核心输入,误差直接导致金属 / 粗糙度算错。
- **视差映射 / 法线细节映射**:用法线做基础凹凸,再叠加视差做更强立体感。
- **轮廓描边**(卡通渲染):用叉乘屏幕方向和法线找边缘。
- **后处理 SSAO**:屏幕空间法线(从深度重建)做环境光遮蔽。

下一篇会把"后处理 Glitch Art"和"蓝色协议技术分享"放到一起,继续讲视觉表现层。图形学的两条主线:**真实感(光照、PBR、BRDF)** 和 **风格化(卡通、故障、风格化后处理)**,法线纹理是这两条主线共同的基础设施。
