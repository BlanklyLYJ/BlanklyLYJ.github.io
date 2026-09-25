---
permalink: 2024/08/10/csharp-linq-and-fundamentals/
title: C# 基础补全:类型 / 集合 / 多态 / LinQ
date: 2024-08-10 20:00:00
updated: 2024-08-10 20:00:00
tags:
  - C#
  - LinQ
  - 集合
  - 多态
  - 基础
categories:
  - [C#, 基础]
comments: true
---

> 这一篇整合 LinQ 学习笔记和 C# 基础问题清单:把零碎的"struct vs class、集合对比、virtual/abstract、LinQ 查询"等"基础但容易答不全"的知识点梳理一遍。

## 一、struct vs class:值类型与引用类型的对照

`struct` 和 `class` 表面看只是关键字差异,实际上决定了实例在内存中的存在方式、赋值语义、继承行为。

| 维度 | class | struct |
|---|---|---|
| 类型类别 | 引用类型 | 值类型 |
| 内存位置 | 托管堆 | 栈(或作为引用类型字段时随对象入堆) |
| 赋值语义 | 复制引用(指向同一对象) | 复制值(独立副本) |
| 参数传递 | 传引用地址 | 传值(除非用 ref/out) |
| 默认无参构造 | 无(必须显式定义) | 有(字段全零) |
| 继承 | 支持单继承 | 不支持(只能实现接口) |
| 成员访问修饰符 | 任意 | 不能 protected(不能被继承) |
| 实例化方式 | 只能 `new` | `new` 或直接 `SomeStruct s;` |
| 适用场景 | 复杂、大型数据 | 小于 16 字节、简单结构 |

什么时候用 struct?
- 数据小且简单(≤16 字节)
- 短生命周期,大量频繁创建(避免 GC 压力)
- 值语义合理(两个副本独立)

但 struct 不当使用会拖慢性能:赋值、传参、装箱都会拷贝整个 struct。

<!-- more -->

## 二、多态:virtual / abstract / override

多态分两种:
- **静态多态(编译时)**:方法重载(overload)、运算符重载
- **动态多态(运行时)**:虚方法 / 抽象方法 + 重写

### virtual vs abstract

| 关键字 | 基类是否有实现 | 子类是否必须重写 | 所在类要求 |
|---|---|---|---|
| `virtual` | 有(可以为空体) | 可选 | 任意类 |
| `abstract` | 无(只有声明) | 必须(否则子类也得是 abstract) | 必须是抽象类 |

```csharp
public abstract class Animal
{
    public abstract void MakeSound();   // 抽象方法,无实现

    public virtual void Eat()            // 虚方法,有默认实现
    {
        Console.WriteLine("eating...");
    }
}

public class Dog : Animal
{
    public override void MakeSound() => Console.WriteLine("Woof");
    public override void Eat()           // 可选重写
    {
        Console.WriteLine("Dog is eating");
    }
}
```

抽象类是**契约**:子类必须实现,否则不能实例化。虚方法是**扩展点**:子类按需重写。

## 三、接口 vs 抽象类

| 维度 | 接口(interface) | 抽象类(abstract class) |
|---|---|---|
| 实例化 | 不能 | 不能 |
| 成员实现 | 默认全无(C# 8+ 可有默认实现) | 可有可无 |
| 字段 | 不能有 | 能 |
| 继承 | 一个类可实现多个接口 | 一个类只能继承一个抽象类 |
| 构造函数 | 无 | 有 |
| 访问修饰符 | 默认 public,不能改 | 任意 |

口诀:**"is-a" 用抽象类,"can-do" 用接口**。
- `Dog : Animal`(狗是一种动物)→ 抽象类
- `Dog : IRunnable, IBarkable`(狗能跑、能叫)→ 接口

## 四、集合:Array / ArrayList / List / Dictionary

四种常用集合的本质对比:

| 集合 | 类型指定 | 大小指定 | 装箱 | 查找复杂度 | 适用场景 |
|---|---|---|---|---|---|
| `T[]` | 必须 | 必须 | 无 | O(1) | 长度已知、随机访问 |
| `ArrayList` | 不需要 | 不需要 | **会** | O(1) | 已废弃,用 `List<object>` 或 `List<T>` |
| `List<T>` | 必须 | 不需要 | 无 | O(1) 索引,O(n) 值查找 | 通用首选 |
| `Dictionary<K,V>` | 必须(K 和 V) | 不需要 | 无 | O(1) 平均 | Key-Value 查找 |

### 底层原理

- **Array**:连续内存,索引快,插入慢(要移动元素)
- **List<T>**:内部是 `T[]`,容量不够时 **2 倍扩容**;`Add` 摊销 O(1);`Remove` 用 `Array.Copy` 覆盖,O(n)
- **ArrayList**:本质是 `object[]`,每次 `+1` 扩容(空时一次扩 10 个);存值类型会装箱
- **Dictionary<K,V>**:数组 + Entry 结构体(`hashcode / next / key / value`)组成的哈希桶,**链地址法**解决冲突

### 内存提示

- `Dictionary` 牺牲内存换速度(需要存 hash 和处理冲突),不要无脑用
- 频繁插入删除头部用 `LinkedList<T>`
- 频繁插入(堆栈语义)用 `Stack<T>` / `Queue<T>`

## 五、LinQ(Language Integrated Query)

LinQ 让你**用类似 SQL 的语法查询任何 `IEnumerable<T>`**。两种等价写法:

### 5.1 查询表达式 vs 方法链

```csharp
class Info { public string Name; public int Value; public int Level; }
List<Info> list = new();

// 写法一:查询表达式(查询语法)
var res = from m in list
          where m.Value > 2
          select m;

// 写法二:扩展方法(方法语法,本质相同)
var res2 = list.Where(m => m.Value > 2);
```

两种语法等价,方法语法本质就是调用 `Enumerable.Where` 扩展方法。**复杂查询推荐查询语法,简单过滤推荐方法语法**。

### 5.2 排序

```csharp
// 查询语法
var res = from m in list
          where m.Value > 2
          orderby m.Value, m.Level descending
          select m;

// 方法语法
var res2 = list.Where(m => m.Value > 2)
               .OrderBy(m => m.Value)
               .ThenByDescending(m => m.Level);
```

### 5.3 投影:select 取字段

```csharp
var names = list.Select(m => m.Name);   // 只取 Name 字段
var pairs = list.Select(m => new { m.Name, m.Value });   // 匿名类型
```

### 5.4 联合查询:join / SelectMany

```csharp
// 查询语法 join
var res = from m in masterList
          join k in kongfuList on m.Kongfu equals k.Name
          select new { Master = m, Kongfu = k };

// 方法语法 SelectMany(笛卡尔积再过滤)
var res2 = masterList.SelectMany(
    m => kongfuList,
    (m, k) => new { Master = m, Kongfu = k }
).Where(x => x.Master.Kongfu == x.Kongfu.Name && x.Kongfu.Power > 90);
```

### 5.5 分组:group by

```csharp
// 按 join into 分组(类似 SQL)
var res = from k in kongfuList
          join m in masterList on k.Name equals m.Kongfu
          into groups
          orderby groups.Count()
          select new { Kongfu = k, Count = groups.Count() };

// 按自身字段分组
var res2 = from m in masterList
           group m by m.Type into g
           select new { Type = g.Key, Count = g.Count() };

// 方法语法
var res3 = masterList.GroupBy(m => m.Type)
                     .Select(g => new { Type = g.Key, Count = g.Count() });
```

### 5.6 量词操作符

```csharp
bool anyMaster = masterList.Any(m => m.Type == "qiufan");
bool allMaster = masterList.All(m => m.Level > 5);
bool contains  = masterList.Contains(someMaster);
```

`Any` / `All` 是短路求值:找到第一个匹配(或不匹配)就返回,不要用 `Count() > 0`(会遍历整个集合)。

### 5.7 LinQ 的两个执行时机

- **延迟执行**:Where / Select / OrderBy / GroupBy / Join — 直到 `foreach` / `ToList` / `Count` 才真正执行
- **立即执行**:ToList / ToArray / Count / Any / First — 立刻触发查询

```csharp
var query = list.Where(m => m.Value > 2);   // 此时不执行
foreach (var m in query) { ... }            // 这里才执行
var arr = query.ToArray();                   // 这里执行并缓存
```

## 六、其他容易翻车的基础点

### 空类有多大?

- 空类(无任何字段):**1 字节**(为了让两个实例在内存中地址不同)
- 含虚函数的类:**指针大小**(32 位 4 字节,64 位 8 字节),用于存虚函数表指针(vtable)

### struct 内引用字段内存布局

```csharp
public struct MyStruct
{
    public MyClass ClassRef;   // 引用类型字段(实际是指针)
    public int MyInt;          // 值类型字段
}
```

- struct 本身在栈上(局部变量场景)
- `ClassRef` 是指针,占固定大小(4/8 字节),指向堆上的 MyClass 实例
- MyClass 实例本身在堆上,由 GC 管理

### foreach 慢的原因

- 装箱:对值类型集合的早期版本会装箱(已优化)
- 迭代器对象:`IEnumerator<T>` 通常需要分配一个迭代器对象
- 方法调用:每步都通过接口调用 `MoveNext` / `Current`

热路径上可改用 `for` + 索引访问。

### Unity 中 Awake/Update 的调用机制

Unity 通过**反射**根据方法名查找并调用:
```csharp
typeof(MonoBehaviour).GetMethod("Awake")...
```
这就是为什么 `Awake` / `Start` / `Update` 等都是 protected 生命周期方法,而非接口——Unity 用反射 + native 调用。新版 Unity 已部分改用代码生成优化。

## 七、面试速记清单

- struct 是值类型,class 是引用类型 → struct 赋值是拷贝
- virtual 有实现,abstract 无实现,override 重写,两者都基于虚方法表
- 一个类只能继承一个抽象类,但可实现多个接口
- ArrayList 装箱,`List<T>` 不装箱,Dictionary 用哈希桶+链地址法
- LinQ 延迟执行,直到 foreach / ToList / Count 才真正跑
- struct 字段是引用类型时,struct 在栈,引用指向堆对象
- 空类 1 字节,有虚函数的类加一个 vtable 指针

## 参考

- 《CLR via C#》(Jeffrey Richter)第 14、15 章
- [LinQ 学习笔记(原文)](https://learn.microsoft.com/zh-cn/dotnet/csharp/linq/)

---

[上一篇:C# 反射与特性(Attribute)](/2024/08/10/csharp-reflection-attribute/)
