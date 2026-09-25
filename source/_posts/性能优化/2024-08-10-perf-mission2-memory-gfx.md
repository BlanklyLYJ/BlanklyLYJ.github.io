---
permalink: 2024/08/10/perf-mission2-memory-gfx/
title: Unity 性能优化(二):内存问题与 Gfx 内存治理
date: 2024-08-10 19:30:00
updated: 2024-08-10 19:30:00
tags:
  - Unity
  - 性能优化
  - 内存
  - 纹理
  - AssetBundle
categories:
  - [Unity, 性能优化]
comments: true
---

> 这是性能优化系列的第二篇,主线是 Mission 2:内存问题。内存这块的优化空间在大多数项目里是最大的——纹理没人管、AB 包乱打、临时材质球满天飞。把内存治理好,资源内存和 Mono 堆都能砍掉一大块,闪退率会显著下降。

## 一、内存基线:三大块要分开看

Unity 项目的内存大体分成三部分:

| 内存类型 | 来源 | 排查工具 |
|---|---|---|
| **资源内存** | 纹理、网格、材质、Shader、AB 包、Audio | Memory Profiler |
| **Mono 堆内存** | C# 对象、被 .NET GC 管理 | Profiler Memory / Memory Profiler |
| **Gfx 内存** | 上传到 GPU 的资源(Texture、Mesh、RenderTexture) | Profiler Memory / 设备 GPU 监控 |

资源内存通常是最大头,Gfx 内存往往和资源内存有重叠(Read/Write 开启时会双份)。

<!-- more -->

## 二、资源冗余:最常见的内存杀手

### 2.1 AB 打包策略导致的冗余

AssetBundle 打包时会对引用资源做判断:如果被引用的资源本身没单独打包,就会被**打进引用它的 AB 包**里。

举例:一个 `texture` 同时被 `prefab1` 和 `prefab2` 使用,如果 prefab1 和 prefab2 分别打成独立 AB,那 texture 就会**进入两份 AB**,运行时同时存在两份。

正确做法:**公共依赖(纹理、材质、Shader)单独打包**,业务 AB 在 manifest 里写依赖关系。加载 prefab1 时,先按 manifest 加载 texture 这个公共包。

> 注意:尽量避免一份资源在两个 AB 中使用,除非真的全局到处用。

### 2.2 代码生成的临时材质球

这种泄漏最隐蔽:

```csharp
var obj = Resources.Load("Sphere1") as GameObject;
var o1 = Instantiate(obj);
// 改颜色会"新建"一个材质球实例
prop.SetColor(Shader.PropertyToID("_Color"), new Color(r, g, b, 1));
Destroy(o1);  // 只销毁了 GameObject,新材质球留在内存里!
```

`Renderer.material` 每次访问都会**复制一份材质实例**,改完不显式销毁就泄漏。要么用 `sharedMaterial`(改所有引用者),要么手动 `Destroy(material)`。

### 2.3 加载和缓存策略

`AssetBundle.Unload(false)` 只卸载 AB 自身,**不卸载它加载出来的资源**——这些资源永远留在内存里,典型的"以为卸了其实没卸"。

两种思路:

- `Unload(true)` 一刀切全部卸载(简单粗暴,但要确保没人引用)
- 自封装引用计数,引用归零时自动卸载(推荐,但要严格管引用)

## 三、Gfx 内存:纹理资源是重灾区

### 3.1 纹理压缩

普通图片格式(jpg/png)在 Unity 里会被转成 GPU 可直读的压缩格式:**ETC**(Android)、**ASTC**(全平台)、**PVRTC**(老 iOS)。

| 格式 | 平台 | 特点 |
|---|---|---|
| ASTC | 全平台主流 | 块大小可调(4x4 到 12x12),压缩率高,推荐 |
| ETC2 | Android | 不透明 + 半透明分开,质量中规中矩 |
| RGBA32 | 通用 | 未压缩,4 字节/像素,内存最大 |

不支持的格式会被 Unity **重新解压回 RGBA**,内存翻 4 倍甚至更多。

ASTC 通过调整像素块大小改变压缩率:每个块不管多大,都固定用 128 位存储。所以 4x4 块约 0.89 字节/像素,12x12 块约 0.22 字节/像素——同张图,块越大内存越小,质量越低。

### 3.2 Mipmap

Mipmap 不是为了内存,是为了**渲染性能**。

原理:远处物体如果用原图采样,1 个像素要采多个不相邻的 texel(1:N 关系),触发 Cache Miss,要从显存重新采样,消耗带宽。Mipmap 预生成多级缩略图,远处用小图,采样命中率高,带宽节省。

代价:总内存增加 1/3(原图 + 1/2 + 1/4 + ... = 4/3)。

| 用途 | 是否开 Mipmap |
|---|---|
| 2D UI(相机距离固定) | **关** |
| 3D 场景纹理 | **开** |
| 3D UI / 世界空间 UI | 开 |

### 3.3 Texture Quality:画质分级

利用 Mipmap 做画质分级:

| 模式 | 行为 | 内存 |
|---|---|---|
| Full Res | 全部 mipmap 加载 | 不变 |
| Half Res | 用 mip1 替代 mip0 | 减少到 1/3 |
| Quarter Res | 用 mip2 替代 mip0 | 减少到 1/9 |

策略:**高端机 Full Res,低端机 Half Res 或 Quarter Res**。

### 3.4 Texture Streaming:运行时按需加载

Texture Streaming 是动态的 Texture Quality——根据摄像机距离动态决定加载哪些 mipmap 层级,可以设置一个总内存池(`MemoryBudget`),超了就丢弃远的 mipmap。

生效条件:

1. Quality Settings 开启 Texture Streaming
2. 纹理导入开启 `StreamingMipMaps` 和 `GenerateMipMap`
3. **重要坑**:Resources.Load 加载的纹理(包内资源)不会生效,只有 AB 加载的纹理才会

参数:

- **MemoryBudget**:总纹理内存池上限(MB),满了丢最远的 mipmap
- **MaxLevelReduction**:最多丢几层 mipmap

### 3.5 Read/Write Enabled:内存翻倍的元凶

开启 Read/Write 后,纹理会在 **CPU 内存和 GPU 内存各存一份**(双倍内存)。关掉的话,Unity 把纹理上传到 GPU 后会删除 CPU 端的副本。

> 99% 的纹理都不需要 Read/Write。除非你真的要在脚本里 `GetPixels` / `SetPixels`,否则一律关闭。

## 四、网格资源:同样的内存陷阱

### 4.1 Read/Write

和纹理一样,网格开启 Read/Write 也会双份内存。**不能关**的情况:

- 用了 MeshCollider(网格碰撞体)
- 游戏内需要用代码修改 Mesh

### 4.2 顶点属性

Position、Normal、Tangent 这些顶点属性不需要的就关掉。Tangent 一般只在用法线贴图时才需要。

Player Settings 里有 **Optimize Mesh Data**,开启后 Unity 自动去掉没用到的顶点属性(偶尔有 bug,需测试)。

### 4.3 骨骼

带动画的模型必须有骨骼,但**静态模型应该去掉骨骼**(建模软件导出时清掉)。每个骨骼节点都是一个 Transform,在场景里要参与计算。

### 4.4 静态合批的内存代价

静态合批把多个小网格合并成大网格,**内存会增大**——每个相同 Mesh 都会被复制一份插入合并后的大网格里。

| 情况 | 内存 |
|---|---|
| 不合批(共享 Mesh) | 1 份网格 |
| 静态合批 | N 份网格副本 |

所以 Mesh 重复率高的场景,**慎用静态合批**(用 GPU Instancing 代替)。

## 五、Shader 资源:变体爆炸

Shader 内存最大的坑是 **变体爆炸**。一个 Shader 关键字越多,变体数量指数级增长(2 的 N 次方)。

优化手段:

1. **脚本剔除变体**:打 AB 前用脚本去掉用不到的关键字(如 `_EMISSION`)
2. **手动注释关键字**:Shader 源码注释掉用不到的关键字
3. **ShaderVariantCollection**:显式收集实际用到的变体

打 AB 时一定要看 Shader 的变体数,**几百个变体的 Shader** 在低端机上能直接吃掉几十 MB 内存。

## 六、内存优化决策清单

实战中可以按这个顺序逐项排查:

- [ ] 纹理格式是否用 ASTC(低端机块更大)
- [ ] 纹理 Read/Write 是否全关
- [ ] UI 纹理 Mipmap 是否关闭
- [ ] 网格 Read/Write 是否关
- [ ] 网格顶点属性是否精简
- [ ] 静态模型是否去骨骼
- [ ] Shader 变体是否剔除
- [ ] AB 公共依赖是否单独打包
- [ ] 临时材质球是否手动销毁
- [ ] AB 卸载策略(引用计数 vs Unload(true))
- [ ] Resources.UnloadUnusedAssets 是否定期调用(5-10 分钟)
- [ ] Mono 堆是否有持续增长(泄漏)

## 七、收尾

内存优化是性价比最高的优化方向——改配置就能省 30% 以上内存。优先级:**纹理 Read/Write → 纹理压缩格式 → Shader 变体 → AB 引用计数**。把这几项做到位,大部分项目的内存峰值都能压到目标值以内。

下一篇讲 **动画模块(Mecanim + Legacy)** 的耗时优化。
