---
title: C# 面试题精选:执行顺序、内存陷阱、装箱识别
date: 2024-08-10 20:30:00
updated: 2024-08-10 20:30:00
tags:
  - C#
  - 面试
  - async
  - 内存优化
  - 装箱
categories:
  - [C#, 面试题解]
comments: true
---

> 这一整合自三道常考的 C# 代码题:**输出预测、内存问题排查、装箱拆箱识别**。它们看起来简单,实际考点都涉及到 async/await 状态机、string 不可变性、值类型 vs 引用类型这些底层模型——前面几篇的延伸。

<!-- more -->

## 题一:FuncTest() 的输出顺序

### 代码

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;

public class TestClass
{
    Task<int> FuncA()
    {
        int a = 100;
        Debug.Log(a);
        return Task.Run(() =>
        {
            Thread.Sleep(1);
            return a + 200;
        });
    }

    int FuncB()
    {
        int a = 200;
        return a;
    }

    async void FuncAsync()
    {
        int a = await FuncA();
        Debug.Log(a);
    }

    void FuncTest()
    {
        FuncAsync();        // 注意:没有 await
        int b = FuncB();
        Debug.Log(b);
    }
}
```

问:`FuncTest()` 调用后,日志输出的顺序?

### 关键分析

1. **`FuncTest()` 调用 `FuncAsync()`,但没用 `await`**
   - `FuncAsync` 是 `async void`,调用立即返回
   - 进入 `FuncAsync` 后开始执行 `await FuncA()`,触发 `FuncA()` 的同步部分
2. **`FuncA()` 内部同步执行的部分**
   - `int a = 100;`
   - `Debug.Log(a);` ← **输出 100**(这是同步的)
   - 返回一个 `Task.Run(...)`,里面的 `Thread.Sleep(1) + return a + 200` 在线程池线程上异步执行
3. **回到 `FuncTest`,继续执行**
   - `FuncAsync` 因 await 暂停,但 `FuncTest` 不等它
   - `int b = FuncB();` ← 同步调用,**`FuncB` 内部 a = 200,返回 200**
   - `Debug.Log(b);` ← **输出 200**
4. **大约 1ms 后**,Task 完成,`FuncAsync` 的 await 恢复
   - `int a = await FuncA()` 得到返回值 300
   - `Debug.Log(a);` ← **输出 300**

### 输出顺序

```
100      ← FuncA 同步部分
200      ← FuncTest 同步部分
300      ← FuncAsync await 恢复后(约 1ms 后)
```

**注意**:`async void` 是危险的——调用方无法 await,异常无法捕获。生产代码应改成 `async Task`,调用方用 `await`。

### 考点回顾

- `async void` 立即返回,调用方不等
- `await` 之前的代码同步执行,`await` 之后的代码可能在另一个线程
- `Task.Run` 的工作何时完成取决于线程池调度

## 题二:这段代码有什么内存问题?

### 代码

```csharp
List<string> list = new List<string>();
string content = "";
for (int i = 0; i < 1024 * 1024; i++)   // 约 100 万次
{
    content += i;
    list.Add(content);
}
```

### 四个内存陷阱

#### 陷阱 1:string 不可变 → 堆分配爆炸

C# 的 `string` 是不可变引用类型。每次 `content += i` 实际上:
1. 计算新字符串长度
2. 在堆上分配一个**全新**的 string 对象
3. 把旧字符串和新内容拷贝到新对象
4. 旧字符串变成垃圾,等 GC 回收

100 万次循环,且字符串不断变长:
- 第 1 次:content = "0"(1 字符)
- 第 2 次:content = "01"(2 字符)
- 第 N 次:content ≈ N 字符

累计分配:`1 + 2 + 3 + ... + 1,000,000` ≈ **5 × 10^11** 个字符的字符串堆分配。**实际绝对会 OutOfMemoryException**。

#### 陷阱 2:List 引用相同的对象图

每次 `list.Add(content)`,添加的是同一个 content 引用的副本(指向堆上同一个 string 对象)。但因为每次循环都 `+=`,content 实际指向新创建的对象。

但问题是:**list 里所有的元素都还活着**——只要 list 不释放,所有 100 万个字符串都不会被 GC 回收。

#### 陷阱 3:List<string> 的扩容

`List<T>` 内部是 `T[]`,容量不够时 2 倍扩容。100 万次 Add,容量从 0 → 4 → 8 → 16 → ... → 1,048,576,要约 18 次扩容,每次都:
- 新建一个更大的数组
- 把旧数组所有元素拷贝过去
- 旧数组变垃圾

最后一次扩容(从 524288 → 1048576)就要分配 8MB 引用数组,拷贝 50 万次。

#### 陷阱 4:GC 压力

短时间产生海量垃圾对象(每次循环遗留的旧字符串),触发频繁 GC,可能造成明显卡顿(GC Pause)。

### 修复方案

#### 方案 A:用 StringBuilder

```csharp
List<string> list = new List<string>(1024 * 1024);   // 预分配容量
StringBuilder sb = new StringBuilder(64);
for (int i = 0; i < 1024 * 1024; i++)
{
    sb.Append(i);
    list.Add(sb.ToString());
    sb.Clear();    // 复用同一个 SB
}
```

避免了循环中"字符串拼接"的堆分配。但 `list.Add(sb.ToString())` 仍然会产生 100 万个 string,内存峰值仍然很高。

#### 方案 B:重新评估需求

100 万个递增字符串列表——真的需要全部存起来吗?
- 如果只是处理,流式遍历即可,不要 list
- 如果需要按索引访问,可以现算而不是预存

#### 方案 C:延迟生成 / IEnumerable

```csharp
IEnumerable<string> GenerateStrings(int count)
{
    StringBuilder sb = new StringBuilder(64);
    for (int i = 0; i < count; i++)
    {
        sb.Append(i);
        yield return sb.ToString();
        sb.Clear();
    }
}

// 用时按需迭代,不一次性占内存
foreach (var s in GenerateStrings(1024 * 1024))
{
    Process(s);
}
```

### 考点回顾

- `string` 不可变,`+=` 等于"分配 + 拷贝"
- `List<T>` 的容量与扩容成本
- 大对象集合 = GC 压力
- 善用 `StringBuilder` 与 `IEnumerable<T>`

## 题三:装箱拆箱识别(简版)

### 代码

```csharp
void func(float b, System.Object c)
{
    Debug.Log((int)b);
    Debug.Log((int)c);
}

int a = 100;
func(a, a);
```

### 逐行分析

| 位置 | 操作 | 类型 |
|---|---|---|
| `func(a, a)` 第一个参数:`int a → float b` | int → float 隐式数值转换 | **不是装箱** |
| `func(a, a)` 第二个参数:`int a → object c` | 值类型 → 引用类型 | **装箱** |
| `Debug.Log((int)b)` | float → int 显式数值转换 | **不是拆箱** |
| `Debug.Log((int)c)` | object → int | **拆箱** |

### 答案

**装箱 1 次**(发生在传第二个参数时)、**拆箱 1 次**(发生在 `(int)c` 时)。

### 详细分析见

[C# 类型系统:装箱拆箱、泛型、ref/out、StringBuilder 与深拷贝](/2024/08/10/csharp-type-system/) 一文。

## 总结:解 C# 面试题的通用思路

| 题型 | 关键考察点 | 思考路径 |
|---|---|---|
| 输出预测 | async/await、执行顺序、闭包捕获 | 区分同步部分 / 异步部分,看是否有 `await` |
| 内存问题 | string 不可变、装箱、集合扩容、GC | 找循环、找 `+=`、找 `new` |
| 装箱识别 | 值类型 vs 引用类型、隐式 / 显式转换 | 看类型转换链,值类型 → object/interface 才装箱 |
| 多线程题 | 竞态、死锁、可见性 | 找共享数据、找锁的获取顺序 |

更重要的:**不要死记答案,要回到 CLR 模型**(线程、栈、堆、GC、类型系统)。每道看似复杂的题,拆到底都是这些底层机制的组合。

## 参考

- [C# string 不可变性与性能](https://learn.microsoft.com/zh-cn/dotnet/api/system.string)
- [MSDN:List<T>.Capacity 与扩容](https://learn.microsoft.com/zh-cn/dotnet/api/system.collections.generic.list-1.capacity)

---

[上一篇:C# 基础补全:类型 / 集合 / 多态 / LinQ](/2024/08/10/csharp-linq-and-fundamentals/)

## 系列目录

1. [C# 委托体系:委托、事件、匿名方法与 Lambda](/2024/08/10/csharp-delegate-event/)
2. [C# 异步编程与多线程](/2024/08/10/csharp-async-multithreading/)
3. [C# 类型系统:装箱拆箱、泛型、ref/out、StringBuilder 与深拷贝](/2024/08/10/csharp-type-system/)
4. [C# 反射与特性(Attribute)](/2024/08/10/csharp-reflection-attribute/)
5. [C# 基础补全:类型 / 集合 / 多态 / LinQ](/2024/08/10/csharp-linq-and-fundamentals/)
6. C# 面试题精选(本篇)
