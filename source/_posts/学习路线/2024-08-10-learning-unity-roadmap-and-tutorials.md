---
permalink: 2024/08/10/learning-unity-roadmap-and-tutorials/
title: Unity 学习路线与教程资源:从入门到进阶的笔记地图
date: 2024-08-10 22:00:00
updated: 2024-08-10 22:00:00
tags:
  - Unity
  - 学习路线
  - 教程
  - CatLikeCoding
  - 性能优化
categories:
  - [学习, 教程]
comments: true
---

> 这一整合自我多年累积下来的 Evernote / 印象笔记索引、TA 推荐教程、复习计划、阶段任务等十几篇笔记。文章不是简单罗列链接,而是按 **Unity 入门 → 模块进阶 → 框架与优化 → 工具链 → 复习节奏** 的顺序排成一条主线,并标注每个资源适合的阶段和痛点。

<!-- more -->

## 一、入门阶段:先把基础打实

### 1. 基础环境

- Unity 版本:推荐 `2021.3.31f1`(LTS,公司主流)
- 编辑器:Rider(配 AvaloniaRider + javafx runtime 插件)
- Lua 环境:解压 lua 官方包,把 bin 加入 Windows Path,命令行输入 `lua` 出版本号即可
- 模板:`dotnet new -i Avalonia.Templates`(Avalonia 跨平台 UI)

### 2. 入门课程推荐

| 资源 | 阶段 | 特点 |
|---|---|---|
| 零基础入门 Unity - 古迹探险(西卡) | 零基础 | 跟着做小项目,不啃概念 |
| Siki 学院 | 入门 → 中级 | 体系全,API 速查 |
| [教程汇总:Unity 从入门到入坟](https://www.bilibili.com) | 任意 | 收藏一篇就够了 |
| M_Studio(波波老师) | 入门 | 关卡设计风格 |
| 麦扣 M_Studio(微卡) | 入门 | 视频节奏好 |

入门阶段我的建议是**做一个古迹探险级别的小项目**,跑完加载场景、相机、控制、碰撞、UI、存档这条链,胜过读十本书。

## 二、进阶模块:每个方向都有一份"主笔记"

进阶阶段我自己整理过一份完整的 Evernote 索引(300+ 条),按模块归类如下。

### 1. C# 基础

| 主题 | 关键点 |
|---|---|
| 数据类型与存储 | 值类型/引用类型、栈 vs 堆 |
| ref vs out | ref 入参必须赋值,out 出参必须由方法内赋值 |
| 泛型 | where 约束、协变逆变 |
| 装箱与拆箱 | 接口接收值类型、`ArrayList`、`yield return 0` 都会装箱 |
| 反射 | GetType / PropertyInfo / MethodInfo |
| 特性(Attribute) | `[Serializable]`、`[SerializeField]` |
| 委托/事件/匿名方法/Lambda | 见本博客《C# 委托体系》 |
| Linq | Where/Select/GroupBy,注意 GC |
| async/await | 状态机原理,见本博客《C# 异步编程》 |
| 多线程 / Task / Thread | Task.Run、CancellationToken |

### 2. Lua 基础

- 作用域与闭包
- table 与 metatable 底层
- OOP 实现:`__index` 链
- `__index` vs `__newindex`
- string 模式匹配(不是正则)
- GC 弱引用表

参考:[Lua 5.3 设计实现系列](https://yuerer.com)(讲 Lua 是怎么跑起来、Table 与 Metatable)

### 3. Unity UGUI 源码(必读)

按顺序啃下来:

1. **Graphics.cs**:基类
2. **GraphicRaycaster.cs**:点击射线
3. **Image / RawImage / Text**:常用控件
4. **Mask / RectMask2D**:遮罩
5. **Canvas**:渲染根
6. **ScrollRect**:滚动列表
7. **CanvasUpdateRegistry**:重建流程
8. **ClipperRegistry**:剪裁
9. **TextMeshPro**:高级文字

读完这一套,UI 框架的"合批原理"和"重建原理"就心中有数了。

### 4. AssetBundle 与资源管理

- AssetBundle 基础:manifest + GetAllDependencies
- 资源加载框架:依赖 + 引用计数 + 池
- 多语言变体:通过 alias 加载不同 ab
- 热更:YooAsset / HybridCLR / ILRuntime / injectFix 的对比
- Xlua 实践:框架搭建、API、try to dispose a LuaEnv with C# callback

### 5. 性能优化(进阶必读)

我整理的"性能优化终极指南"路线图(按 UWA 学堂结构):

| Mission | 主题 |
|---|---|
| 1 | 定位瓶颈 + 排查工具 |
| 2 | 策略导致的内存问题 + Gfx 内存 |
| 3 | Mecanim 动画 + Legacy 动画 |
| 4 | 物理模块耗时 |
| 5 | 热点函数 + DrawCall 优化 |
| 6 | 加载优化(Loading.UpdatePreloading) |
| 7 | 渲染模块 CPU 压力 + GPU 压力 |

补充阅读:

- Unity 性能内存优化:图片长宽关系(Mipmap)
- 解密计算机系统中的"缓存不命中惩罚"
- 移动游戏性能优化通用技法
- Unity 渲染优化的 4 种批处理(静态 / 动态 / SRP Batcher / GPU Instancing)
- DrawCall 概念(UWA 学堂)

## 三、框架与生态:抄一份然后改

### 1. 常用框架

| 框架 | 类型 | 适用 |
|---|---|---|
| ET | 全栈 ECS 风格 | 服务端 + 客户端 |
| GF(GameFramework) | 经典 MonoBehaviour 框架 | 中小项目 |
| QFrameWork | 国产轻量 | 工具向 |
| YooAsset | 资源管理 | 通用 |

### 2. 工具链必学

- **动画**:Animancer(代码驱动,不依赖状态机)
- **相机**:Cinemachine
- **配置**:Luban(支持 Excel + 多语言 + 多语言导出)
- **热更**:HybridCLR(纯 C# 热更)
- **版本控制**:SVN + Git(关掉 Git 自动 GC 避免卡顿)
- **自动化**:Jenkins(配 Gitlab CI/CD)
- **UI**:Odin(序列化增强)
- **骨骼**:Splines
- **Debug**:SRDebugger(运行时面板)
- ** tween**:DoTween

### 3. 编辑器扩展

Unity Editor 编程的几个关键 API:

- `EditorWindow`:自定义窗口
- `Selection`:Project 面板选中文件
- `AssetPostprocessor.OnPostprocessAllAssets`:资源导入钩子(我用来做 prefab 多语言替换)
- `EditorGUILayout`:UI 绘制
- `CreateAnimatorControllerAtPath` + `AddState`:程序化生成 Animator

实战例子:**UI Animator 动效编辑器**——原本靠模板 controller 文件复制创建,改成凭空创建,右键 prefab 即可在指定文件夹创建 controller。

## 四、教程站点与专栏

### CatLikeCoding

Jasper Flick 的教程,文字 + 代码,质量极高。覆盖:

- Basics / Objects
- Mesh Basics / Procedural Grid
- Movement / Loops
- Object Management / Persisting Objects
- Graph / Mathematical Surfaces
- Rendering 系列(Frustum、Depth & Transparency、Advanced Rendering)
- Custom SRP / RP/Light 等

进阶渲染必读。

### 杰哥的 Unity 笔记

国内 UP,讲 Battle / Skill / AI 等系统模块,适合做参考。

### 知乎专栏

- TA 笔记:[zhuanlan.zhihu.com/p/265590519](https://zhuanlan.zhihu.com/p/265590519)
- 世界佬的知乎:[zhuanlan.zhihu.com/p/435005339](https://zhuanlan.zhihu.com/p/435005339)
- "除了渲染,游戏客户端程序员还有哪些进阶方向?":[zhihu.com/question/433768405](https://www.zhihu.com/question/433768405)

### UWA 社区

性能优化问答 + 博客,DrawCall、内存、GC 都有真机数据。

## 五、客户端程序员的进阶方向

按"除了渲染之外"的维度,我整理的几个方向:

| 方向 | 关键技术 |
|---|---|
| Gameplay 框架 | ECS、状态机、行为树、HTN、GOAP |
| 网络同步 | 帧同步 / 状态同步、预测回滚、AOI、RVO |
| 工具链 | 编辑器扩展、Jenkins、Luban、Excel 导表 |
| 资源管理 | AssetBundle、YooAsset、热更 |
| 性能优化 | Profiler、内存、DrawCall、DOTS |
| AI | FSM、行为树、GOAP、Utility AI |
| 物理 | 自实现物理库(2D 圆形 / 3D 球体) |

## 六、复习节奏与自我管理

### 1. 每天一个小目标

工作日:

- 回家放下所有东西,烧水 + 10 个俯卧撑
- 10 点开始学 Unity,11 点半结束,11 点 45 上床,不带手机
- 周五放假一天

周末:

- 9:30 开始学,11 点外卖,12 点吃,午睡到 1 点
- 1 点继续,3 点休息(自选)到 3:30
- 5 点外卖,6 点吃,晚上自行安排

### 2. 心流管理

进入心流的几个条件(参考《心流》笔记):

1. 主动屏蔽无关干扰(大脑默认是无序的)
2. 微习惯启动(先做 5 个俯卧撑,自然进入)
3. 难度匹配(踮脚能够到)
4. 及时反馈(任务列表划掉、半小时闹钟紧迫感)
5. 充足能量(喝水、先小睡)

### 3. 阶段性复习清单

每隔一段时间我重新过一遍的清单:

- C# 基础:GC / 托管堆非托管堆 / Dictionary List Array 底层
- Lua 基础:class 实现 / GC / Xlua
- 数据结构:链表 vs 数组、队列与栈、Cache miss、链表判环、红黑树
- 寻路:NavMesh / 漏斗算法 / RVO 动态避障
- 大地图:大世界怎么管理
- 算法:堆 / TopK / MD5 / 深拷贝浅拷贝 / 防止外部修改

### 4. 学习方法(第 0 课)

> 聚沙成塔,不求真会了再去做,一定得上手;不求甚解,复制粘贴也是一种本事;能用就好,做出来就算成功。

这句话我从一开始就贴在墙上,比任何方法论都管用。

## 七、进阶目标清单

参考《来嘛,明年的你会不会笑话这时候的我》:

### 基本要求

- SDK 接入(CrashEye、Siki 全套)
- 一个 UI 框架(ET / GF / QF)
- 一个资源加载框架(AssetBundle / VFS)
- 深入 C#
- Shader 庄懂
- 导表工具(自写)
- bat 脚本

### 进阶

- ECS
- 自己接一个 SDK
- 深入 Lua
- 网络
- Timeline + 动画状态机

### 终极

- 自己写个框架
- 看 Unity 源码
- protoBuf + 网络框架
- 导表工具可视化
- 给自己的游戏写剧情
- 深入英语 / 日语

## 参考

- [cs-self-learning (PKUFlyingPig)](https://github.com/PKUFlyingPig/cs-self-learning)
- [TeachYourselfCS-CN](https://github.com/izackwu/TeachYourselfCS-CN/blob/master/TeachYourselfCS-CN.md)
- [GitHubDaily](https://github.com/GitHubDaily/GitHubDaily)
- [CatLikeCoding](https://catlikecoding.com/unity/tutorials/)
- 本博客《C# 委托体系》《Unity 客户端面试精选》

---

上一篇:[西山居解限机面试复盘](#)
下一篇:[游戏世界观设定:色彩、位面与心流](#)
