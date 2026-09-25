---
permalink: 2024/08/10/csharp-reflection-attribute/
title: C# 反射与特性(Attribute):运行时的元数据魔法
date: 2024-08-10 19:30:00
updated: 2024-08-10 19:30:00
tags:
  - C#
  - 反射
  - 特性
  - Attribute
categories:
  - [C#, 反射与特性]
comments: true
---

> 这一篇把反射、特性和它们的配合使用整合起来。反射让代码"在运行时认识自己",特性让代码"携带自定义元数据",两者结合是依赖注入、序列化、ORM、单元测试框架等的基础。

## 一、什么是反射

**反射(Reflection)** 是程序在运行时查看自身(或其他程序集)元数据的能力。

> 有关程序及其类型的数据被称为**元数据(metadata)**。编译器编译时会把这些信息(类定义表、字段定义表、方法定义表等)嵌入到程序集中。`System.Reflection` 命名空间下的类允许你在运行时解析这些元数据。

简单说:**编译时已经固定的类型信息,运行时还能再拿出来用**。

<!-- more -->

## 二、Type:反射的入口

`System.Type` 是反射的起点。每个类型(包括类、结构、枚举、接口、委托)在运行时都对应一个 `Type` 对象,它存储了该类型的所有成员信息。

### 获取 Type 的三种方式

```csharp
// 1. 通过实例
MyClass obj = new MyClass();
Type t1 = obj.GetType();

// 2. 通过 typeof 关键字
Type t2 = typeof(MyClass);

// 3. 通过类型名字符串(需要命名空间)
Type t3 = Type.GetType("MyNamespace.MyClass");
```

### Type 常用成员

```csharp
Type type = typeof(MyClass);

type.Name;              // 类名 "MyClass"
type.FullName;          // 完整名 "MyNamespace.MyClass"
type.Assembly;          // 所在程序集
type.IsClass;           // 是否是类
type.IsValueType;       // 是否是值类型
type.BaseType;          // 基类

FieldInfo[] fields      = type.GetFields();        // 公有字段
PropertyInfo[] props    = type.GetProperties();    // 公有属性
MethodInfo[] methods    = type.GetMethods();       // 公有方法
ConstructorInfo[] ctors = type.GetConstructors();  // 构造函数
EventInfo[] events      = type.GetEvents();        // 事件
MemberInfo[] members    = type.GetMembers();       // 所有公有成员
```

### BindingFlags:精确控制反射范围

默认 `GetFields()` / `GetMethods()` 只返回**公有**成员。要拿到非公有或实例/静态过滤,用 `BindingFlags`:

```csharp
var flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
FieldInfo[] privateFields = type.GetFields(flags);
```

常用枚举值:
- `Public` / `NonPublic`
- `Instance` / `Static`
- `DeclaredOnly`:仅本类声明的,不继承的
- `IgnoreCase`:忽略大小写

## 三、Assembly:程序集级别操作

`System.Reflection.Assembly` 代表一个程序集(dll 或 exe)。

```csharp
// 获取对象所在的程序集
Assembly assem = obj.GetType().Assembly;
Console.WriteLine(assem.FullName);

// 获取程序集中所有类型
Type[] allTypes = assem.GetTypes();

// 加载程序集
Assembly a1 = Assembly.Load("MyLibrary");                // 按名称(在应用程序目录或 GAC)
Assembly a2 = Assembly.LoadFrom(@"C:\path\to\lib.dll");  // 按路径
Assembly a3 = Assembly.LoadFile(@"C:\path\to\lib.dll");  // 按绝对路径
```

### 动态创建实例

```csharp
// 通过类型名创建实例(等价于 new MyClass())
object obj = Activator.CreateInstance(type);

// 通过反射调用构造函数
var ctor = type.GetConstructor(new[] { typeof(int) });
object obj2 = ctor.Invoke(new object[] { 42 });
```

### 动态调用方法

```csharp
MethodInfo method = type.GetMethod("DoSomething");
method.Invoke(obj, new object[] { "arg1", 100 });
```

### 动态读写字段/属性

```csharp
FieldInfo field = type.GetField("name");
field.SetValue(obj, "hello");
string name = (string)field.GetValue(obj);
```

## 四、反射的性能代价

| 操作 | 相对耗时 |
|---|---|
| 直接调用方法 | 1× |
| 泛型委托调用 | ~1.2× |
| 反射调用方法 | **100× ~ 1000×** |

性能损耗来源:
1. 运行时解析类型信息
2. 参数装箱 / 类型检查
3. 安全检查(权限)

### 优化策略

- **缓存 MemberInfo**:不要每次循环里都 `GetMethod`,取一次缓存起来
- **用委托包装**:`Delegate.CreateDelegate` 把 `MethodInfo` 转成具体委托,调用速度接近直接调用
- **Expression Tree 编译**:`Expression.Lambda` 编译成委托,性能几乎等同直接调用
- **unsafe 指针反射**(进阶):用 `Unsafe.As` / `FieldOffset` 直接拿字段地址,跳过反射 API

## 五、特性(Attribute):给代码贴标签

特性是一种**特殊的类**,用来给程序结构(类、方法、字段、程序集等)附加**元数据**。应用了特性的程序结构叫做**特性目标**。

```csharp
[Obsolete("Use NewMethod instead", error: false)]
public void OldMethod() { }
```

编译后,这个特性信息会被写入程序集的元数据,运行时可以通过反射读出来。

## 六、C# 内置常用特性

### Obsolete:标记弃用

```csharp
[Obsolete("Use NewMethod instead")]
public void OldMethod() { }

[Obsolete("Don't use", true)]   // error: true → 编译时报错
public void DangerousMethod() { }
```

### Conditional:条件编译

```csharp
#define DEBUG   // 必须在文件最顶部

[Conditional("DEBUG")]
public static void Log(string msg) { Console.WriteLine(msg); }

// 调用处即使写了 Log("..."),如果没定义 DEBUG,编译器会直接删掉这行调用
Log("only runs in debug");
```

### 调用者信息特性(C# 5+)

```csharp
public static void Log(
    string message,
    [CallerFilePath]   string file     = "",
    [CallerLineNumber] int    line     = 0,
    [CallerMemberName] string member   = "")
{
    Console.WriteLine($"{file}:{line} [{member}] {message}");
}

Log("hello");   // 编译器自动填入文件路径、行号、方法名
```

## 七、自定义特性

### 步骤

```csharp
// 1. 类后缀以 Attribute 结尾(约定)
// 2. 继承 System.Attribute
// 3. 通常 sealed
// 4. 一般只定义字段/属性,不定义方法
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class MyTestAttribute : Attribute
{
    public string Description { get; }

    // 构造函数参数为"位置参数",使用特性时必须传
    public MyTestAttribute(string description)
    {
        Description = description;
    }

    // 公有属性/字段为"命名参数",使用时可选传
    public int Priority { get; set; }
}
```

### 使用

```csharp
[MyTest("A test class", Priority = 5)]
class MyClass { }

// 注:使用时 Attribute 后缀可省略,编译器会自动补全
```

### AttributeUsage:限定特性可贴的位置

```csharp
[AttributeUsage(AttributeTargets.Class)]              // 只能贴类
[AttributeUsage(AttributeTargets.Method)]             // 只能贴方法
[AttributeUsage(AttributeTargets.Class, Inherited = false)]   // 不被子类继承
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)] // 同一目标可多次贴
```

`AttributeTargets` 是个枚举,常见值:`Assembly / Module / Class / Struct / Enum / Method / Property / Field / Parameter / Return / GenericParameter / All`。

## 八、特性 + 反射:运行时元数据驱动

光贴特性没用,**还得用反射读出来**。这是 DI 容器、序列化、ORM 的核心套路。

```csharp
// 1. 定义特性
[AttributeUsage(AttributeTargets.Property)]
public sealed class ColumnAttribute : Attribute
{
    public string Name { get; }
    public ColumnAttribute(string name) => Name = name;
}

// 2. 应用到类
public class User
{
    [Column("user_id")]    public int    Id    { get; set; }
    [Column("user_name")]  public string Name  { get; set; }
}

// 3. 运行时反射读取,生成 SQL
static string BuildInsertSql<T>(T obj)
{
    Type type = typeof(T);
    var columns = new List<string>();
    var values  = new List<string>();

    foreach (var prop in type.GetProperties())
    {
        var attr = prop.GetCustomAttribute<ColumnAttribute>();
        if (attr != null)
        {
            columns.Add(attr.Name);
            values.Add($"'{prop.GetValue(obj)}'");
        }
    }

    return $"INSERT INTO {type.Name} ({string.Join(", ", columns)}) VALUES ({string.Join(", ", values)})";
}

// 调用
var sql = BuildInsertSql(new User { Id = 1, Name = "Tom" });
// → INSERT INTO User (user_id, user_name) VALUES ('1', 'Tom')
```

这就是 Mini Mapper / Dapper 等 ORM 的最简模型。

## 九、典型应用场景

| 场景 | 用法 |
|---|---|
| **序列化** | `[Serializable]` / `[JsonProperty("name")]` |
| **单元测试** | `[TestMethod]` / `[TestFixture]`(NUnit) / `[Fact]`(xUnit) |
| **依赖注入** | `[Inject]` / `[Service]` 自动注册 |
| **数据校验** | `[Required]` / `[Range(0, 100)]` |
| **ORM 映射** | `[Table("users")]` / `[Column("id")]` |
| **AOP / 拦截器** | `[Log]` / `[Transaction]` 自动包裹方法 |
| **编辑器扩展(Unity)** | `[SerializeField]` / `[Header("...")]` / `[Range(0, 10)]` |

## 十、何时用、何时不用

**适合用反射 + 特性的场景**:
- 框架 / 工具类代码,需要在运行时处理"任意类型"
- 需要数据驱动(配置、序列化)
- 编辑器扩展(Unity Inspector 显示自定义属性)

**避免用的场景**:
- 性能敏感的热路径(每帧调用)
- 简单业务代码里(直接调用更清晰)
- 静态类型安全重要的地方(反射绕过编译期检查)

## 参考

- 《CLR via C#》第 23 章:程序集加载与反射
- [C#(含Unity) unsafe 指针快速反射](https://zhuanlan.zhihu.com/p/547327113)
- [MSDN:反射 (C#)](https://learn.microsoft.com/zh-cn/dotnet/csharp/advanced-topics/reflection-and-attributes/)

---

[上一篇:C# 类型系统:装箱拆箱、泛型、ref/out、StringBuilder 与深拷贝](/2024/08/10/csharp-type-system/)
