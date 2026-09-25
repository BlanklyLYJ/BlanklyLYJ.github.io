---
permalink: 2024/08/10/csharp-type-system/
title: C# 类型系统:装箱拆箱、泛型、ref/out、StringBuilder 与深拷贝
date: 2024-08-10 19:00:00
updated: 2024-08-10 19:00:00
tags:
  - C#
  - 装箱拆箱
  - 泛型
  - 深拷贝
  - StringBuilder
categories:
  - [C#, 类型系统]
comments: true
---

> 这一篇把 6 篇零散笔记(装箱拆箱/装箱识别题/泛型/ref 与 out/StringBuilder/深拷贝)整合起来,围绕"值类型 vs 引用类型"这条主线,讲清楚 C# 类型系统的性能要点。

## 一、值类型 vs 引用类型:一切的基础

| 维度 | 值类型 | 引用类型 |
|---|---|---|
| 基类 | `System.ValueType` | `System.Object` |
| 实例 | bool / byte / char / decimal / double / enum / float / int / long / struct 等 | class / interface / delegate / object / string |
| 内存分配 | 通常在栈上(或作为引用类型字段随对象入堆) | 总是托管堆 |
| 赋值 | 字段级拷贝 | 引用拷贝(指向同一对象) |
| 生命周期 | 作用域结束自动释放 | GC 回收 |

记住核心事实:**值类型变量本身就存值,引用类型变量存的是堆上对象的指针**。后续的所有性能讨论都围绕这一点展开。

<!-- more -->

## 二、装箱(Boxing)与拆箱(Unboxing)

### 定义

- **装箱**:值类型 → 引用类型(通常是 `object` 或接口)
- **拆箱**:引用类型 → 值类型(只有装过箱的才能拆)

### 装箱的内部三步

1. 在托管堆分配内存:大小 = 值类型实例大小 + 方法表指针 + SyncBlockIndex
2. 把值类型数据拷贝到新堆对象中
3. 返回堆对象地址(这就是引用)

### 拆箱的两步

1. 获取堆对象中**值类型字段部分**的地址(严格意义的拆箱,本身不耗性能)
2. 把值从堆拷贝到栈上的值类型实例(这一步与装箱一样耗性能)

### 性能影响

每次装箱都:① 在堆上分配内存(增加 GC 压力)、② 数据拷贝。
每次拆箱都:① 数据拷贝(还会做类型检查)。
**热路径上大量装箱拆箱 = 性能灾难**(尤其是 Unity 这种 GC 敏感环境)。

### 触发场景

```csharp
// 场景 1:object 参数
void Log(object obj) { /* ... */ }
Log(42);   // int 42 被装箱为 object

// 场景 2:非泛型集合
ArrayList list = new ArrayList();
list.Add(1);    // 装箱
list.Add("x");  // string 是引用类型,不装箱
int x = (int)list[0];   // 拆箱

// 场景 3:接口调用值类型
IComparable cmp = 5;   // 装箱(int → IComparable)
```

### 装箱识别题

```csharp
void func(float b, System.Object c)
{
    Debug.Log((int)b);
    Debug.Log((int)c);
}

int a = 100;
func(a, a);
```

逐行分析:
- `func(a, a)`:第一个 `a` → `float` 是**隐式数值转换**(int→float,不装箱);第二个 `a` → `object` 是**装箱**
- `(int)b`:`b` 本身是 float,这是值类型之间的**显式转换**,不是拆箱
- `(int)c`:`c` 是 object,先**拆箱**为 int(类型检查 + 拷贝),不涉及进一步转换

所以:**装箱 1 次,拆箱 1 次**。

### 一个常见误区:"引用类型中的值类型字段会装箱吗?"

**不会**。

```csharp
class MyClass { public int Value; }   // int 作为字段嵌入堆对象,无装箱
MyClass obj = new MyClass();
object o = obj;   // 引用类型转 object,协变,无装箱
```

理由:装箱的定义是"把值类型用引用类型的方式分配一个 GC 堆对象,获得引用语义"。`MyClass.Value` 这个 int 一开始就在堆上(作为 MyClass 实例的一部分),它的"值类型身份"在内存层面已经成立,没有发生"从栈到堆"的转换。

判断口诀:**装箱与否与 object 没有必然联系,关键看是否发生了"值类型 → 堆对象引用"的转换**。

## 三、泛型:从语言层面消灭装箱

C# 2.0 引入泛型,**核心动机之一就是避免装箱**。

```csharp
// 反面教材:用 object 实现通用容器,值类型每次操作都装箱
class BoxedContainer
{
    private object _value;
    public void Set(object v) => _value = v;
    public object Get() => _value;
}

// 正解:用泛型
class GenericContainer<T>
{
    private T _value;
    public void Set(T v) => _value = v;
    public T Get() => _value;
}

var c = new GenericContainer<int>();
c.Set(42);    // 无装箱
int x = c.Get();   // 无拆箱
```

泛型类、泛型方法、泛型接口:`System.Collections.Generic` 命名空间下的 `List<T>` / `Dictionary<TKey, TValue>` 等都是泛型版本,值类型存进去不装箱。

### 泛型方法示例

```csharp
public class ClassA<T>
{
    private T a;
    private T b;

    public ClassA(T a, T b) { this.a = a; this.b = b; }

    public string GetSum() => $"{a}{b}";

    // 泛型方法:多个类型参数
    public static string G<A, B, C>(A a, B b, C c) => $"{a}{b}{c}";
}

var o1 = new ClassA<int>(1, 2);
var o2 = new ClassA<string>("1", "2");
```

## 四、ref 与 out:地址传递

`ref` 和 `out` 让方法可以**按引用传递值类型**,避免了"传值 → 修改 → 返回"的装箱 / 拷贝开销。

```csharp
public static void TestRef(ref int num)
{
    num = 100;
}

public static void TestOut(out int num)
{
    num = 100;   // out 必须在方法内赋值
}

int a = 0;
TestRef(ref a);
Console.WriteLine(a);   // 100

int b;
TestOut(out b);
Console.WriteLine(b);   // 100
```

### ref vs out 的区别

| 修饰符 | 调用前是否要初始化 | 方法内是否必须赋值 |
|---|---|---|
| `ref` | 必须 | 可选(已传入值) |
| `out` | 不必(传入也会被忽略) | 必须(编译器强制) |

### 为什么 ref/out 不会装箱?

它们传的是**变量地址**,本质是托管指针,值类型本身仍以值类型的形式存在于原位置(通常是栈上)。所以"看起来像引用",实际上并没有发生值类型 → 引用类型的堆分配。

### ref 返回值(C# 7+)

```csharp
public ref int Find(int[] arr, int target)
{
    for (int i = 0; i < arr.Length; i++)
        if (arr[i] == target) return ref arr[i];
    throw new InvalidOperationException();
}

int[] nums = { 1, 2, 3 };
ref int slot = ref Find(nums, 2);
slot = 99;   // 直接修改原数组的元素,无任何拷贝
```

## 五、StringBuilder:字符串拼接的"避免 GC"利器

`string` 在 C# 中**不可变**——每次拼接(`"a" + "b"`)都会在堆上 new 一个新 string,旧 string 等 GC 回收。

```csharp
string s = "";
for (int i = 0; i < 1000; i++)
    s += i.ToString();   // 每次 += 都产生新 string,灾难
```

`StringBuilder` 解决这个问题。

### 底层原理

- 内部维护一个 **`char[]`** 字符数组
- `Append` 把字符直接写入数组,不产生新 string
- `ToString()` 时才一次性返回最终字符串

### 扩容机制

- 当元素数超过 `Capacity` 时触发扩容
- 扩容是 **2 倍指数级**:1 → 2 → 4 → 8 → 16 → ...
- 扩容时新建一个更大的 char 数组,旧数组数据通过**链表头插法**链接(避免每次扩容都拷贝整个旧数组)

### 使用建议

```csharp
// 一次性拼接几千次:用 StringBuilder
var sb = new StringBuilder(1024);   // 预估容量,避免多次扩容
for (int i = 0; i < 1000; i++)
    sb.Append(i);
string result = sb.ToString();

// 少量拼接:直接 +,编译器会优化成 Concat,可读性更好
string greeting = "Hello, " + name + "!";
```

## 六、深拷贝(Deep Copy)

浅拷贝只复制引用,深拷贝要求**所有嵌套的对象都重新创建**。

### 方案 1:序列化 / 反序列化

```csharp
[Serializable]
public class MyObject : ICloneable
{
    public int Value { get; set; }
    public ReferenceType Reference { get; set; }

    public object Clone()
    {
        using var stream = new MemoryStream();
        var formatter = new BinaryFormatter();
        formatter.Serialize(stream, this);
        stream.Seek(0, SeekOrigin.Begin);
        return formatter.Deserialize(stream);
    }
}
```

注意:`BinaryFormatter` 在 .NET 5+ 被标记为过时且不安全,新代码改用 `System.Text.Json` 或 `MessagePack` 等替代方案。

### 方案 2:手动逐字段拷贝

```csharp
public MyObject DeepCopy()
{
    return new MyObject
    {
        Value = this.Value,
        Reference = this.Reference != null
            ? new ReferenceType { NestedValue = this.Reference.NestedValue }
            : null
    };
}
```

简单可靠,但字段多了维护成本高。

### 方案 3:反射

```csharp
public static T DeepClone<T>(T obj) where T : new()
{
    if (obj == null) return default;
    var clone = new T();
    foreach (var field in typeof(T).GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
    {
        var value = field.GetValue(obj);
        field.SetValue(clone,
            value != null && !field.FieldType.IsValueType && field.FieldType != typeof(string)
                ? DeepClone(value)   // 引用类型递归拷贝
                : value);            // 值类型 / string 直接赋值
    }
    return clone;
}
```

适用复杂对象图,缺点是反射有性能损耗(可缓存 PropertyInfo / FieldInfo)。

### 三种方案对比

| 方案 | 优点 | 缺点 |
|---|---|---|
| 序列化 | 自动处理嵌套,代码少 | 性能差、依赖可序列化、`BinaryFormatter` 不安全 |
| 手动 | 性能最好、控制精细 | 维护成本高 |
| 反射 | 通用、可处理任意类 | 性能损耗、缓存优化复杂 |

## 总结一张图

```
值类型 vs 引用类型
        │
        ├──→ 装箱拆箱(性能损耗)
        │        │
        │        ├──→ 用泛型消灭
        │        └──→ 用 ref/out 绕过
        │
        ├──→ 字符串(string 是引用类型)
        │        │
        │        └──→ 不可变 → 用 StringBuilder 避免堆分配
        │
        └──→ 深拷贝(如何复制对象图)
                 │
                 ├── 序列化
                 ├── 手动
                 └── 反射
```

C# 类型系统的"性能感"几乎全在这张图里:能不装箱就不装箱、能用 ref 就不用返回新对象、字符串拼接前先想 StringBuilder、深拷贝看场景挑方案。

## 参考

- 《CLR via C#》(Jeffrey Richter)第 5 章:基元类型、引用类型与值类型
- [MSDN:装箱和拆箱](https://learn.microsoft.com/zh-cn/dotnet/csharp/programming-guide/types/boxing-and-unboxing)
- [C# 深拷贝的几种实现](https://www.cnblogs.com/seekdream/p/15193616.html)

---

[上一篇:C# 异步编程与多线程](/2024/08/10/csharp-async-multithreading/)
