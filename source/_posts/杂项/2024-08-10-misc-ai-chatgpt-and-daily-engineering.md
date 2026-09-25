---
permalink: 2024/08/10/misc-ai-chatgpt-and-daily-engineering/
title: 随笔:AI、ChatGPT 与日常工程小记
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - 随笔
  - AI
  - ChatGPT
  - ECS
  - 游戏开发
categories:
  - [随笔]
comments: true
---

> 这一整合自散落在 99-未分类里的几篇零碎笔记:ChatGPT 摸索、AI 设计模式、基础语法、ECS 业务流程、关卡交互、角色控制组件等。它们都是写下来当时没归类的小记,串起来其实是一条"日常工程思考"的脉络。

<!-- more -->

## 一、ChatGPT 摸索:让 AI 帮你做架构设计

### 1. 用 GPT 设计导表工具

我给 GPT 3.5 的需求:

> 让游戏策划可以配置游戏数据的导表工具,实现多编程语言(C++/Go/Lua/C#)导出静态代码,可自定义导出模板。

GPT 给出了一份相当完整的实现要点清单:

| 要点 | 内容 |
|---|---|
| 数据格式 | CSV / JSON / XML 或自定义 |
| 配置界面 | 策划友好的 GUI |
| 数据校验 | 类型、范围、必填 |
| 导出代码 | 模板引擎支持多语言 |
| 自定义模板 | 模板编辑器 |
| 日志记录 | 操作日志、错误信息 |
| 版本控制 | 数据变更历史 |
| 兼容性 | 跨 OS、跨语言、跨开发环境 |
| 性能优化 | 增量、并行 |

进一步追加需求(分赛季导出 + 多语言收集)后,GPT 也能在原框架下扩展。这次经历让我意识到:**AI 不是替你写代码,是替你列 checklist**。当你说不清楚自己想要什么时,先让 AI 给你一份大纲,再人在上面改,效率比从零开始高得多。

### 2. 用 GPT 设计有限状态机

让 GPT 实现状态模式下的有限状态机,它给出了一份相当合理的接口设计:

- `IState`:状态接口(OnEnter / OnUpdate / OnExit)
- `StateMachine`:持有当前状态,提供 Transition 方法
- 具体状态继承 IState,实现具体逻辑

这套模板在战斗 AI、UI 流程、新手引导里都能复用。

## 二、游戏 AI 设计模式对比

参考 GAMES104 Lecture 17 和腾讯云的 GOAP 文章。

### 1. 行为树与状态机:基础但不够

**行为树**和**有限状态机**是基础方案,对于复杂 AI 不够适配。

### 2. GOAP(目标导向行动规划)

需要完成所有任务清单,并且有优先级 cost。

| 优点 | 缺点 |
|---|---|
| AI 更有想象力 | 难开发 |
| 能涌现复杂行为 | 需要处理 A* 算法 |
| | 性能消耗较大 |
| | 需要量化条件 |

参考:[腾讯云 GOAP 设计](https://cloud.tencent.com/developer/article/2462954)、[OwlCat Blog](https://www.cnblogs.com/OwlCat/p/17936809)

### 3. HTN(分层任务网络)

任务序列通过优先队列,从最基础任务开始一步步完成 HTN 链。但需要判断这条链是否需要完全完成,否则 NPC 会做一些多余的东西。

**缺点**:影响因素过多时,任务队列不稳定,反复修改任务。

### 4. 选型建议

| 场景 | 推荐 |
|---|---|
| 简单 NPC(商店老板) | FSM |
| 通用战斗 AI | 行为树 |
| 复杂 BOSS(多阶段多意图) | HTN |
| 高智能涌现(类似 RPG 大世界) | GOAP(团队有能力时) |

## 三、ECS 业务层的反复问题

整理自项目中的思考。

### 1. 业务层核心是这五件事

- ECS 架构
- 网络同步
- 数据(组件)生命周期
- System 设计
- 双端流程(客户端 + 服务端)

### 2. 反复出现的问题 ⇒ 基建需求

转测期间整理评估是否有基建需求,典型基建缺口:

- **时间格式**:没有统一的函数转换,已有的 TimeUtil 像是热更框架里的,不够适用
- **服务端时间**:似乎没有地方可以统一获取
- **表格 id**:没有索引
- **condition 表**:没有通用表示

这些都是"看起来小但反复咬人"的问题,值得在转测期专门立项。

## 四、关卡交互系统设计

整理自 FlowCanvas 关卡开发的笔记。

### 1. 核心类

| 类 | 职责 |
|---|---|
| `InteractHandleState` | 处理交互状态(FlowCanvas 节点) |
| `InteractInstance` | 交互实例(运行时数据) |
| `InteractStateAttach` | 状态附加组件 |
| `boundaryListenerComponent` | 范围检测组件 |
| `boundaryListenerSystem` | 范围检测系统 |
| `CombatActor` | 战斗角色 |

### 2. 设计模式

- **Handle/Instance 分离**:配置(Handle)与运行时(Instance)解耦
- **State + Attach**:状态用 FlowCanvas 描述,附加组件用 MonoBehaviour 挂载
- **Component + System**:ECS 风格的检测分离

这套结构让策划可以在 FlowCanvas 里编辑交互流程,程序员只暴露关键 API。

## 五、Unity 基础备忘

### 1. Animator vs Animation

- Animator:状态机,一个 GameObject 一般只有一个,控制多个动画
- Animation:具体动画片段
- Animation 不能拖进 Animator 的解决:[CSDN 文章](https://blog.csdn.net/qq_37270308/article/details/121652343)

### 2. Lua 5.3 设计实现推荐

强推这个系列,理解 Lua 底层必备:

- [Lua 是怎么跑起来的](https://yuerer.com/Lua5.3-设计实现(一)-Lua是怎么跑起来的/)
- [Table 与 Metatable](https://yuerer.com/Lua5.3-设计实现(二)-Table与Metatable/)

## 六、个人工作流改进

### 1. 时间格式统一

项目里时间相关函数分散,统一封装一个 TimeUtil:

- 服务器时间获取接口
- 时区转换
- 格式化(yyyy-MM-dd HH:mm:ss)
- 倒计时/计时器封装

### 2. 表格 id 索引

策划配置的表格缺少主键索引,程序读起来痛苦。建议在导表阶段强制要求每张表都有唯一 id,并在生成代码时自动建索引。

### 3. Condition 表的通用化

任务系统、引导系统、活动系统都有 condition,但目前每套都是自己写。考虑做一个通用 condition DSL:

```
condition = AND(level >= 10, OR(has_item(1001), finished_quest(2001)))
```

这样所有系统共享同一套 condition 解析器。

## 七、未来的小工具计划

- **导表工具可视化**:目前用脚本驱动,加一个 GUI 让策划直接预览导出结果
- **关卡编辑器扩展**:FlowCanvas + 自定义节点,让策划自己画交互流程
- **基础建设清单**:把时间格式、表格索引、condition DSL 等缺口列成"基建 sprint",每个迭代处理一两项

这些不是大功能,但能让整个团队的开发体验上一个台阶。所谓基建,就是这种"看不到但缺了就痛"的东西。

## 参考

- [GAMES104 Lecture 17 - 高级 AI](https://www.bilibili.com/video/BV1iG4y1i78Q/)
- [GOAP 模式的 AI 设计](https://cloud.tencent.com/developer/article/2462954)
- [OwlCat HTN/GOAP 系列](https://www.cnblogs.com/OwlCat/p/17936809)
- [Lua 5.3 设计实现](https://yuerer.com)
- 本博客《CS 自学路线与编程基础》《Unity 学习路线与教程资源》

---

上一篇:[游戏世界观设定:色彩、位面与心流](#)
