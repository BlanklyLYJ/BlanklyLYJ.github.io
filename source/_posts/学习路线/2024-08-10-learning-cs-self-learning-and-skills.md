---
permalink: 2024/08/10/learning-cs-self-learning-and-skills/
title: CS 自学路线与编程基础:从语言到工程能力
date: 2024-08-10 22:30:00
updated: 2024-08-10 22:30:00
tags:
  - 计算机科学
  - 自学
  - Python
  - C#
  - 正则表达式
  - Erlang
categories:
  - [学习, 教程]
comments: true
---

> 这一整合自散落的几篇 CS 自学笔记:cs-self-learning 路线书、Python 基础语法、C# 文件 IO、正则表达式、Erlang、Lua 调试、Avalonia 模板安装等。把它们汇成一篇"非 Unity 但客户端程序员应该懂"的基础能力地图。

<!-- more -->

## 一、CS 自学路线:两本必读的"路线书"

### 1. cs-self-learning(PKUFlyingPig)

仓库地址:[github.com/PKUFlyingPig/cs-self-learning](https://github.com/PKUFlyingPig/cs-self-learning)

北大同学整理的计算机科学自学路线,涵盖:

- 编程语言(Python / C / C++ / Rust / Go)
- 数据结构与算法
- 计算机体系结构 / 操作系统 / 网络
- 数据库 / 编译原理 / Web
- 数学(线代 / 离散 / 概率)

每门课都附带公开课链接(MIT / CMU / Stanford / Berkeley),强调"用书 + 公开课 + 项目"组合拳。

### 2. TeachYourselfCS-CN

仓库地址:[github.com/izackwu/TeachYourselfCS-CN](https://github.com/izackwu/TeachYourselfCS-CN/blob/master/TeachYourselfCS-CN.md)

更精简,九门课:编程、体系结构、算法与数据结构、数学、操作系统、计算机网络、数据库、编译原理、分布式系统。每门推荐 1 本书 + 1 个公开课,选材保守经典。

### 3. 两者的取舍

| 维度 | cs-self-learning | TeachYourselfCS |
|---|---|---|
| 篇幅 | 长,中文友好 | 短,英文导向 |
| 选材 | 广,多方案并列 | 精,每门只挑 1-2 |
| 适合 | 自学时间长 | 工作中查漏 |

我的实践:TeachYourselfCS 选书 + 公开课,cs-self-learning 找补充资源。

### 4. GitHubDaily

[github.com/GitHubDaily/GitHubDaily](https://github.com/GitHubDaily/GitHubDaily):每日 GitHub 优秀项目汇总,适合做信息源。

## 二、Python 基础(快速参考)

Python 是我做导表脚本、写小工具、跑 AI 接口时的默认语言。这里整理一份速查表。

### 1. 数据类型与可变性

| 类型 | 类别 | 可变 |
|---|---|---|
| Number(int / bool / float / complex) | 不可变 | 否 |
| String | 不可变 | 否 |
| Tuple | 不可变 | 否 |
| List | 可变 | 是 |
| Dictionary | 可变 | 是 |
| Set | 可变 | 是 |
| bytes | 不可变二进制 | 否 |

### 2. 关键字速记

```
False None True and as assert break class continue def del
elif else except finally for from global if import in is
lambda nonlocal not or pass raise return try while with yield
```

### 3. 字符串特性

- 单引号 `'` 和双引号 `"` 等价
- 三引号 `'''/"""` 表示多行
- `r"..."` 让反斜杠不转义
- 字符串不可变,切片返回新串:`s[start:end:step]`
- 没有单独的字符类型,长度为 1 的字符串就是字符

### 4. type vs isinstance

```python
class A: pass
class B(A): pass

isinstance(B(), A)  # True,认为子类是父类
type(B()) == A      # False,严格类型
```

### 5. 参数传递

Python 中**类型属于对象,变量没有类型**,只是引用。

```python
a = [1, 2, 3]   # a 引用一个 List
a = "Runoob"    # a 改为引用一个 String,List 对象本身没变
```

函数参数都是"对象引用传递",可变对象在函数内修改会影响外部,不可变对象则不会。

### 6. 模块导入

跨文件调用:[runoob.com/python3/python3-module.html](https://www.runoob.com/python3/python3-module.html)

## 三、正则表达式(实战速查)

### 1. 元字符

| 字符 | 含义 |
|---|---|
| `\b` / `\B` | 单词边界 / 非边界 |
| `^` / `$` | 行 / 字符串开头结尾 |
| `\A` / `\z` / `\Z` | 字符串开头 / 结尾 / 结尾或 \n 前 |
| `.` | 除换行外任意字符 |
| `\w` / `\W` | 字母数字下划线 / 反 |
| `\s` / `\S` | 空白符 / 反 |
| `\d` / `\D` | 数字 / 反 |
| `[abc]` / `[^abc]` | 字符集 / 反义集 |

### 2. 量词

| 量词 | 含义 |
|---|---|
| `{n}` | n 次 |
| `{n,}` | ≥ n 次 |
| `{n,m}` | n~m 次 |
| `?` | 0 或 1 次 |
| `+` | ≥ 1 次 |
| `*` | ≥ 0 次 |

### 3. C# 中使用

C# 字符串前加 `@` 让编译器不解析转义字符,作为正则元字符:

```csharp
string pattern = @"^\d{5,}[a-z]+$";  // 至少 5 位数字 + 至少 1 个小写字母
```

### 4. 经典案例:IP 地址匹配

拆分需求:0-255 + `.` + 重复 3 次。

| 段 | 表达式 |
|---|---|
| 200-249 | `2[0-4]\d` |
| 250-255 | `25[0-5]` |
| 0-199 | `[01]?\d\d?` |

组合后:

```
^((2[0-4]\d|25[0-5]|[01]?\d\d?)\.){3}(2[0-4]\d|25[0-5]|[01]?\d\d?)$
```

## 四、C# 文件 IO 速查

```csharp
// FileInfo
var fi = new FileInfo(@"C:\path\to\xxx.txt");
fi.Create();
fi.Exists;        // 是否存在
fi.Name;          // 文件名
fi.Directory;     // 目录
fi.IsReadOnly;
fi.LastAccessTime;
fi.CopyTo("TextFile2.txt");
fi.MoveTo("TextFile3.txt");  // 重命名

// DirectoryInfo
var di = new DirectoryInfo(@"C:\path");
di.Root;
di.Parent;
di.CreateSubdirectory("芜湖");

// File 静态类
File.ReadAllLines(path);     // string[]
File.ReadAllText(path);      // string
File.ReadAllBytes(path);     // byte[]
File.WriteAllText("qf.txt", "内容");
File.WriteAllLines("x.txt", new[] { "a", "b" });
File.WriteAllBytes("y.txt", bytes);  // 复制文件
```

## 五、常见编译/运行错误

### 1. C# 静态上下文错误

```
Cannot access static method 'getNum' in non-static context
```

类成员全是 static,通过实例调用方法时报错。**原因**:C# 不能在非静态上下文中通过实例访问静态成员。改为类型名调用:`ClassName.GetNum()`。

参考:[manongdao.com/article-1554049.html](https://www.manongdao.com/article-1554049.html)

### 2. Lua 调试链接失败

```
Connection refused: connect
```

需要为 Lua 创建一个 `LuaDebug` 文件,内容是调试器配置,否则 LuaStudio/IntelliJ 链接不上。

参考:[cnblogs.com/gezp/p/12777667.html](https://www.cnblogs.com/gezp/p/12777667.html)

### 3. Git 推送慢 / No supported authentication

- 推送拉取慢:DNS 切换或代理
- TortoiseGit 报 `No supported authentication methods available`:重新配置 PuTTY 或切到 OpenSSH

## 六、其他语言与工具

### 1. Erlang

参考:[blog.csdn.net/zhongruixian/article/details/9417201](https://blog.csdn.net/zhongruixian/article/details/9417201)

要点:`++` 列表拼接在长列表上很慢,因为 Erlang 的 list 是链表,拼接要从头部遍历第一段。生产代码避免在循环中 `++`。

### 2. Avalonia(跨平台 UI)

控制台安装模板:

```
dotnet new -i Avalonia.Templates
```

Rider 中安装 AvaloniaRider 插件 + javafx runtime 才能预览。

### 3. Unity Animator/Animation 基础

- Animator:状态机,一个 GameObject 一般只有一个状态机,可控制多个动画
- Animation:具体动画片段
- Animation 不能拖进 Animator 的问题:[参考](https://blog.csdn.net/qq_37270308/article/details/121652343)

### 4. Lua 5.3 设计实现

强推这个系列:

- [Lua 是怎么跑起来的](https://yuerer.com/Lua5.3-设计实现(一)-Lua是怎么跑起来的/)
- [Table 与 Metatable](https://yuerer.com/Lua5.3-设计实现(二)-Table与Metatable/)

## 七、AI 工具的运用

### 1. ChatGPT 做导表工具设计

我让 ChatGPT 帮我梳理"导表工具要支持多语言、自定义模板、分赛季导出"的实现要点,它给出了一份相当完整的清单:

- **数据格式**:CSV / JSON / XML 或自定义
- **配置界面**:策划友好的 GUI
- **数据校验**:类型、范围、必填
- **导出代码**:模板引擎多语言支持
- **自定义模板**:模板编辑器
- **日志记录**:导入导出错误
- **版本控制**:数据变更历史
- **兼容性**:跨 OS、跨语言
- **性能优化**:增量、并行

这是一份相当扎实的工程清单,实际做项目时按这个走基本不会偏。

### 2. AI 在 Gameplay 中的应用

参考 GAMES104 Lecture 17 和腾讯云文章,游戏 AI 的几种范式:

| 范式 | 优点 | 缺点 |
|---|---|---|
| FSM(有限状态机) | 简单直观 | 状态爆炸 |
| 行为树(BT) | 模块化 | 节点开销 |
| HTN(任务网络) | 任务链清晰 | 多因素时不稳定 |
| GOAP(目标导向) | 智能、有想象力 | A* 难调、性能消耗大、需量化条件 |

GOAP 需要完成所有任务清单且有优先级 cost;HTN 通过优先队列从最基础任务一步步完成链,但要判断整条链是否能完整完成。

## 参考

- [cs-self-learning](https://github.com/PKUFlyingPig/cs-self-learning)
- [TeachYourselfCS-CN](https://github.com/izackwu/TeachYourselfCS-CN/blob/master/TeachYourselfCS-CN.md)
- [GitHubDaily](https://github.com/GitHubDaily/GitHubDaily)
- [Lua 5.3 设计实现系列](https://yuerer.com)
- 本博客《Unity 学习路线与教程资源》

---

上一篇:[Unity 学习路线与教程资源](#)
下一篇:[游戏世界观设定:色彩、位面与心流](#)
