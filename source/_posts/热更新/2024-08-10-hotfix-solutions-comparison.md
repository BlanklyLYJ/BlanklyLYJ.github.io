---
permalink: 2024/08/10/hotfix-solutions-comparison/
title: 三种热更方案对比:HybridCLR / Lua / ILRuntime
date: 2024-08-10 22:30:00
updated: 2024-08-10 22:30:00
tags:
  - 热更新
  - HybridCLR
  - Lua
  - ILRuntime
  - Unity
categories:
  - [Lua, 热更方案对比]
comments: true
---

> Unity 三大主流热更方案的技术原理、优劣、选型建议。三种方案代表了三种思路:Lua 用虚拟机、ILRuntime 用 C# 解释器、HybridCLR 借 IL2CPP 自己实现解释器。

## 一、三种方案的本质差异

要理解差异,先看 Unity 编译流程:

```
C# 源码 → IL 中间语言 → IL2CPP → C++ → Native 二进制指令(机器码)
                                  ↑
                              AOT 提前编译
```

**关键观察**:正常的 IL2CPP 在打包时把 IL 编译成机器码,**没有运行时 IL 解释能力**。这就是为什么 Unity 不能像 Mono 那样运行时加载 DLL 直接执行。

三种热更方案各自的破解思路:

| 方案 | 思路 | 执行环境 |
|---|---|---|
| **Lua(XLua/toLua)** | 内置 Lua 虚拟机,跑 Lua 字节码 | Native asm 之外另起 VM |
| **ILRuntime** | 内置 C# 写的 IL 解释器,解释执行 DLL | Native asm 之外另起 VM |
| **HybridCLR(华佗)** | 借 IL2CPP 的 runtime,补一个 IL 解释器模块 | 直接复用 IL2CPP runtime |

<!-- more -->

## 二、Lua 方案(XLua / toLua / slua)

### 架构

```
Native 可执行文件
├─ Unity IL2CPP Runtime
├─ C# Game Code(已编译成机器码)
└─ Lua VM(嵌入的 C 库)
   └─ Lua 脚本(可热更,字节码形式)
```

### 工作流

1. 开发期:C# 写底层逻辑 + 框架,打 `[LuaCallCSharp]` 标签生成代码
2. 运行期:Lua 脚本作为热更资源下载,Lua VM 解释执行
3. C# ↔ Lua 通过 ObjectTranslator 互相调用

### 优点

- **成熟稳定**:腾讯网易等大厂多年生产验证(XLua、toLua)
- **生态完整**:工具链、调试器、文档都有
- **包体小**:Lua VM 只有几百 KB
- **运行时性能好**:LuaJIT 接近原生速度(toLua 配 LuaJIT)

### 缺点

- **需要学 Lua**:C# 团队学习成本
- **语言切换开销**:每次 C# ↔ Lua 调用都有 marshalling 成本
- **类型系统不统一**:Lua 没有强类型,IDE 智能感知弱
- **GC 不互通**:Lua GC 和 C# GC 需要协调(见 XLua 一篇)
- **代码冗余**:同样的逻辑可能要写两遍(C# 接口 + Lua 实现)

## 三、ILRuntime 方案

### 架构

```
Native 可执行文件
├─ Unity IL2CPP Runtime
├─ C# Game Code(已编译成机器码)
└─ ILRuntime(C# 实现的 IL 解释器)
   └─ IL DLL(热更代码,以资源形式下发)
```

### 工作流

1. 开发期:热更代码用普通 C# 写,编译成 DLL,作为资源下发
2. 运行期:ILRuntime 加载 DLL,**用 C# 实现的 IL 解释器** 逐条解释 IL 指令
3. 跨边界调用:通过委托适配器、反射接口

### 优点

- **统一语言**:C# 写底层和热更,IDE 智能感知完整
- **现成工具链**:Visual Studio 调试、断点
- **包体友好**:ILRuntime 本身是 C# DLL,几百 KB

### 缺点

- **执行速度慢**:C# 解释 IL 大约比原生慢 10-100 倍
- **反射开销大**:跨边界调用频繁使用反射,性能瓶颈
- **维护停滞**:ILRuntime 社区近年活跃度下降,新 Unity 版本支持滞后
- **跨域 GC 复杂**:ILRuntime 实例对象映射到主域,生命周期管理复杂

## 四、HybridCLR(华佗)

### 架构

```
Native 可执行文件(由 IL2CPP 生成)
├─ IL2CPP Runtime(原有)
├─ AOT 模块:已编译成机器码的 C# 代码
└─ HybridCLR Interpreter(额外添加的解释器模块)
   └─ IL 指令(运行时加载,来自热更 DLL)
```

### 工作流

1. 打包:用 IL2CPP 出包,带 HybridCLR 模块
2. 热更代码用普通 C# 写,编译成 DLL,作为资源下发
3. 运行时:HybridCLR 加载 DLL,**复用 IL2CPP runtime 的元数据 / GC / 类型系统**,逐条解释 IL
4. AOT ↔ Interpreter 共享同一个 runtime,互调几乎零成本

### 关键创新

HybridCLR 的核心思想是:**不引入新 runtime,而是给 IL2CPP 补上"运行时解释 IL"的能力**。

正常 IL2CPP:
```
数据内存(GameObjects, MonoBehaviours) + 二进制机器指令(AOT 编译产物)
```

HybridCLR IL2CPP:
```
数据内存(GameObjects...) + 二进制机器指令(AOT 代码)
                       + IL 解释器(执行热更 DLL 的 IL 指令)
```

数据内存和类型系统是共享的!这是性能优势的根源。

### 优点

- **真正用 C# 写热更**:无需学 Lua
- **性能最好**:热更代码性能接近 AOT(约 1.5-3 倍慢)
- **跨域零成本**:AOT ↔ 解释器在同一 runtime,不需要 marshalling
- **GC 统一**:一个 CLR,一个 GC
- **生态原生**:NuGet 库、C# 8.0+ 语法都支持
- **现代维护**:活跃开源,跟得上 Unity 新版本

### 缺点

- **接入成本**:需要重新打 IL2CPP 出包,接入 HybridCLR 模块
- **包体增加**:约 2-5 MB(IL 解释器代码)
- **iOS 限制**:由于苹果政策,某些场景仍需注意
- **生态较新**:相比 Lua 方案,生产案例相对少

## 五、技术细节对比

### 执行模型对比

| 方案 | 执行模型 | 跨域调用 | GC | 反射 |
|---|---|---|---|---|
| Lua(XLua) | 独立 VM | 通过 wrapper,有开销 | 双向 GC 协调 | 仅生成代码 |
| ILRuntime | C# 解释 IL | 通过委托桥接 | 跨域映射 | 频繁反射 |
| HybridCLR | IL2CPP + IL 解释器 | 同一 runtime,直接调用 | 同一 CLR GC | 原生反射 |

### 性能(热更代码相对于纯 AOT C#)

| 方案 | 大概性能 | 备注 |
|---|---|---|
| Lua + LuaJIT | 1.5-3× 慢 | LuaJIT 接近原生 |
| Lua(纯解释) | 5-10× 慢 | 无 JIT |
| ILRuntime | 10-100× 慢 | C# 解释 IL |
| HybridCLR | 1.5-3× 慢 | 优化后的解释器 |

### 包体增量

| 方案 | 增量 | 主要来源 |
|---|---|---|
| Lua(XLua) | ~1-2 MB | Lua VM + wrapper |
| ILRuntime | ~1-2 MB | 解释器 DLL |
| HybridCLR | ~2-5 MB | IL2CPP 修改 + 解释器 |

### 工具链 / 调试

| 方案 | 调试器 | 智能感知 |
|---|---|---|
| Lua | LuaDev / EmmyLua(IDE) | 弱类型,Lua 项目专属 |
| ILRuntime | VS / VS Code 可断点 | 完整 C# 智能感知 |
| HybridCLR | VS / VS Code 可断点 | 完整 C# 智能感知 |

## 六、选型建议

### 用 Lua(XLua)的场景

- 团队已有 Lua 经验或老项目
- 极度注重包体(轻量胜过一切)
- 需要兼容老版本 Unity(无法升级到支持 HybridCLR 的版本)
- 项目类型适合 Lua:SLG、卡牌、回合制(逻辑密集但性能要求不极致)

### 用 ILRuntime 的场景

- 已经在用,迁移成本太大
- 不推荐新项目用(ILRuntime 维护停滞,HybridCLR 是更好的选择)

### 用 HybridCLR 的场景(推荐)

- 新项目首选
- 团队主栈是 C#
- 注重代码统一和长期维护
- 性能要求高(ARPG、MOBA、动作类)
- 期望未来跟 Unity 官方技术栈对齐

## 七、迁移路径

**从 Lua 迁移到 HybridCLR**:
1. 新代码全部用 C#,接入 HybridCLR
2. 老代码逐步用 C# 重写,废弃 Lua 模块
3. XLua 的 ObjectTranslator 接口可以临时保留,做平滑过渡

**从 ILRuntime 迁移到 HybridCLR**:
1. 因为都是 C#,代码可以直接复用
2. 移除 ILRuntime 适配层,改用 HybridCLR 加载
3. 跨域委托改写法

## 八、未来趋势

Unity 官方在 2022 年发布了 **Cloud Build + Scriptable Build Pipeline**,加上社区推动 HybridCLR,可以看出趋势:

- **Lua 方案** 仍然占半壁江山,但新项目越来越少
- **ILRuntime** 基本停止增长,被 HybridCLR 替代
- **HybridCLR** 是当前事实标准,生态在快速成长

如果今天开始新项目,默认选 HybridCLR 准没错。

## 参考

- [HybridCLR 官方文档](https://hybridclr.doc.code-philosophy.com/)
- [ILRuntime 文档](https://ourkidding.github.io/ILRuntimePublic/)
- [XLua 项目](https://github.com/Tencent/xLua)
- [三种热更方案对比](https://zhuanlan.zhihu.com/p/567161568)

---

[上一篇:XLua 集成](/2024/08/10/xlua-integration-codegen-gotchas/)

## 系列目录

1. [Lua 语言核心:table / metatable / 闭包 / OOP](/2024/08/10/lua-core-table-metatable-oop/)
2. [Lua 字符串与模式匹配](/2024/08/10/lua-string-pattern/)
3. [XLua 集成:三大标签 / LuaEnv / GC 机制 / 判 nil 坑](/2024/08/10/xlua-integration-codegen-gotchas/)
4. 三种热更方案对比(本篇)
