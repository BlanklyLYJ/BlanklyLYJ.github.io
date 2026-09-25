---
permalink: 2024/08/10/csharp-delegate-event/
title: C# 委托体系:委托、事件、匿名方法与 Lambda
date: 2024-08-10 18:00:00
updated: 2024-08-10 18:00:00
tags:
  - C#
  - 委托
  - 事件
  - Lambda
categories:
  - [C#, 委托与事件]
comments: true
---

> 这一篇把分散在多个笔记里的"委托 / 事件 / 匿名方法 / Lambda"知识整合到一起,从函数指针讲到 IL 视角下的事件封装,目标是看完一次就能把这套体系的来龙去脉串起来。

## 一、为什么需要委托

一句话:**委托是类型安全的函数指针**。

C/C++ 里有函数指针,可以做到"把方法当作参数传来传去",但它是地址级别的、不安全。C# 在语言层面提供了 `delegate`,把"持有一组相同签名的方法引用"做成一个**类**,既能声明类的地方就能声明委托,又能由编译器和 CLR 共同保证类型安全。

典型使用场景:
- 事件回调(UI 点击、消息到达)
- 把方法作为参数(策略模式、回调注入)
- 异步编程的延续(任务完成后做什么)
- 观察者模式(订阅 / 发布)

<!-- more -->

## 二、委托的本质:它是个类

`delegate` 关键字看起来像方法声明,但编译器实际上为你生成了一个继承自 `System.MulticastDelegate` 的类。

```csharp
public delegate void Feedback();  // 这其实是声明一个类
```

查看 IL 代码可以看到这个类有:
- 三个方法:`Invoke`(同步调用)、`BeginInvoke` / `EndInvoke`(异步调用)
- 三个内部字段:
  - `_target`:方法所属对象引用(静态方法为 null)
  - `_MethodPtr`:方法地址
  - `_invocationList`:委托链(多播时是数组,单播时为 null)

每个委托对象实际是一个**包装器**:包装了一个方法 + 调用该方法时要操作的对象。

## 三、声明与使用

```csharp
// 1. 声明委托类型
public delegate void TestDelegate(int num);

// 2. 与签名匹配的方法
public static void TestMethod(int num)
{
    Console.WriteLine(num);
}

// 3. 创建委托实例并赋值
TestDelegate d = new TestDelegate(TestMethod);
// 或简写
TestDelegate d2 = TestMethod;

// 4. 调用
d.Invoke(10);
d2(10);  // 等价
```

声明委托的语法和定义方法类似,只是没有方法体,前面加 `delegate`。访问修饰符(`public` / `private` / `protected`)和类一样可用。

## 四、委托链:多播委托(MulticastDelegate)

`+=` / `-=` 是语法糖,本质上调用 `Delegate.Combine` / `Delegate.Remove`。

```csharp
Feedback fbStatic = new Feedback(Program.FeedbackToConsole);
Feedback fbInstance = new Feedback(new Program().FeedbackToFile);

Feedback fbChain = fbStatic;
fbChain += fbInstance;   // 等价于 Delegate.Combine
fbChain.Invoke();        // 依次执行两个方法

fbChain -= fbInstance;   // 等价于 Delegate.Remove
```

组合后,`_invocationList` 字段被初始化为委托数组,调用时按顺序遍历执行。

### 多播委托的"返回值陷阱"

如果委托链中每个方法都有返回值,`Invoke` 只会返回**最后一个**方法的返回值,前面的都被丢弃。

```csharp
delegate string Feedback();

Feedback feedback = Diaomao;
feedback += Liangzai;
Console.WriteLine(feedback.Invoke());  // 只输出 "I'm Liangzai"
```

要拿到所有返回值,使用 `GetInvocationList`:

```csharp
foreach (var fb in feedback.GetInvocationList())
{
    Console.WriteLine(((Feedback)fb).Invoke());
}
```

### 多播异常处理

委托链中某个方法抛异常会中断后续调用。解决方法同样是 `GetInvocationList`,逐个 `try/catch`:

```csharp
foreach (var fb in fbChain.GetInvocationList())
{
    try { ((Feedback)fb).Invoke(); }
    catch (Exception e) { Console.WriteLine(e.Message); }
}
```

## 五、.NET 内置的泛型委托

日常开发绝大多数情况都不需要自己声明 `delegate`,直接用 `Action` / `Func` / `Predicate`。

| 委托 | 特点 | 重载数 |
|---|---|---|
| `Action<...>` | 无返回值,0~16 个参数 | 17 |
| `Func<..., TResult>` | 有返回值,0~16 个参数 + 1 个返回类型 | 17 |
| `Predicate<T>` | 返回 `bool`,常用于判断 / 查找 | 1 |

```csharp
// Action 作为参数:策略注入
public static void Process(string foodName, Action<string> usage)
{
    usage(foodName);
}

Process("bread", name => Console.WriteLine("eat " + name));
Process("bread", name => Console.WriteLine("give " + name + " to friend"));
```

## 六、匿名方法与 Lambda

`delegate` 关键字除了声明类型,还能直接写**匿名方法**:

```csharp
Func<int, int, int> plus = delegate(int a, int b)
{
    return a + b;
};
```

但匿名方法写起来啰嗦,C# 3.0 起推荐用 **Lambda 表达式**:

```csharp
Func<int, int, int> plus = (a, b) => a + b;
```

Lambda 的特点:
- 参数类型可省略(编译器推断)
- 单条表达式可省略 `return` 和 `{}`
- 单参数可省略括号:`Func<int, int> sq = x => x * x;`

Lambda 本质上是匿名方法的语法糖,在表达式树场景下还能被编译成数据(`Expression<Func<T>>`),这是 IQueryable 的基础。

## 七、事件(Event):对委托的封装

### 为什么需要 event

把委托字段直接声明为 `public` 看似能满足"发布 / 订阅",但有两个安全隐患:

1. **外部可随意赋值**:别人一句 `customer.Order = null` 就清空了所有订阅者
2. **外部可随意触发**:任何人都能 `customer.Order.Invoke(...)`,绕过发布者本身的逻辑

`event` 关键字就是为这两个问题而生。它**不是新类型**,而是给委托字段加了一层包装器(mask),对外只暴露 `+=` 和 `-=`。

### IL 视角:事件 = 私有委托字段 + add/remove

```csharp
public class Customer
{
    public event OrderEventHandler Order;
}
```

编译后变成三个构造:
1. 一个**私有**委托字段 `Order`
2. 公共方法 `add_Order`(对应 `+=`)
3. 公共方法 `remove_Order`(对应 `-=`)

外部只能通过 `+=` / `-=` 操作,无法 `=` 赋值,也无法 `Invoke`。

### 完整声明(显式 add/remove)

如果想自定义订阅逻辑(比如加锁、日志),可以显式声明:

```csharp
public class Customer
{
    private OrderEventHandler _orderHandler;

    public event OrderEventHandler Order
    {
        add    { _orderHandler += value; }
        remove { _orderHandler -= value; }
    }
}
```

### 事件的五要素

事件模型由五部分组成:
1. 一个事件本身
2. 一群关心这个事件的订阅者
3. 事件发生
4. 订阅者被依次通知
5. 订阅者根据事件信息做出响应

约定:事件参数类应继承 `System.EventArgs`,类名以 `EventArgs` 结尾。

## 八、实战:点餐事件

完整的事件用法,从EventArgs 到订阅触发:

```csharp
// 1. 事件参数类
public class OrderEventArgs : EventArgs
{
    public string DishName { get; set; }
    public string Size     { get; set; }
}

// 2. 事件处理委托(也可直接用 EventHandler<T>)
public delegate void OrderEventHandler(Customer sender, OrderEventArgs e);

public class Customer
{
    // 3. 事件成员
    public event OrderEventHandler Order;
    public float Bill;

    // 4. 触发事件的方法(负责通知)
    public void OrderDish()
    {
        var e = new OrderEventArgs
        {
            DishName = "RoastChicken",
            Size = "large"
        };
        Order?.Invoke(this, e);   // ? 是空引用判断,等价于 if (Order != null)
    }
}

public class Waiter
{
    // 5. 订阅者响应
    public void Service(Customer customer, OrderEventArgs e)
    {
        float price = 50;
        price = e.Size switch
        {
            "small"  => price * 0.5f,
            "large"  => price * 1.5f,
            _        => price
        };
        customer.Bill += price;
        Console.WriteLine($"Serving {e.DishName} ({e.Size})");
    }
}

// 使用
var customer = new Customer();
var waiter   = new Waiter();
customer.Order += waiter.Service;   // 订阅
customer.OrderDish();
Console.WriteLine($"Bill: ${customer.Bill}");  // 75
```

## 九、委托与事件的区别

| 维度 | 委托 | 事件 |
|---|---|---|
| 本质 | 类型(类) | 委托字段的封装成员 |
| 外部赋值 | 允许(`=`) | 禁止 |
| 外部触发 | 允许(`.Invoke`) | 禁止 |
| 外部订阅/取消 | 允许(`+=` / `-=`) | 允许(`+=` / `-=`) |
| 设计意图 | 函数指针 / 回调 | 发布订阅模式 |

简而言之:**委托是被暴露的方法容器,事件是封装后的安全版**。事件对委托的关系,类似于属性(property)对字段(field)的关系。

## 十、委托的缺点与使用建议

委托虽强大但容易被滥用:

- **耦合度高**:方法级别耦合,调用关系隐式
- **可读性差 / Debug 难**:不容易一眼看出实际调用了什么
- **潜在内存泄漏**:实例方法所属的对象不会被释放,即使没有其他引用

使用建议:
- 简单回调用 `Action` / `Func`,不必自定义 delegate
- 跨对象通知用 `event`,不要把委托字段直接 public
- 注意退订(`-=`),尤其在使用 IDisposable / Unity MonoBehaviour 时
- 在 Java 里没有委托,用接口(回调接口)实现类似功能,所以 C# 的委托可以视作"语言级别支持的策略对象"

## 参考

- 《CLR via C#》(Jeffrey Richter)
- [Timothy Liu 《C# 语言入门详解》](https://www.bilibili.com/video/BV1uJ41197kM)
- [MSDN:使用委托](https://learn.microsoft.com/zh-cn/dotnet/csharp/programming-guide/delegates/)

---

下一篇:[C# 异步编程与多线程(async/await、Task、Thread)](#) — 整合自《Unity C# Task/async/await》《深入解析 await 实现原理》《多线程》《进程和线程的概念》《线程堆栈:简称栈 Stack》五篇笔记。
