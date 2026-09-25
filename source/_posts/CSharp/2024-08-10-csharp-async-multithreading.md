---
title: C# 异步编程与多线程(Thread / ThreadPool / Task / async·await)
date: 2024-08-10 18:30:00
updated: 2024-08-10 18:30:00
tags:
  - C#
  - 多线程
  - async
  - await
  - Task
categories:
  - [C#, 异步与并发]
comments: true
---

> 这是把分散在 5 篇笔记里的内容(Thread/Task/async·await/进程线程概念/线程堆栈)整合到一起的"异步与多线程"长文。从进程线程的关系讲到 await 的状态机原理,目标是看完一次就能把 C# 并发编程的三套 API 和底层模型串起来。

## 一、进程、线程、堆栈:并发的基本概念

**进程**是操作系统资源分配的基本单位,**线程**是 CPU 调度的基本单位。一个 CPU 在某一时刻只能运行一个线程,所谓"并发"是靠时间片轮转实现的视觉错觉。一个进程可以包含多个线程,这些线程共享进程的内存空间。

线程的组成:

- **CPU 寄存器**:记录当前执行状态
- **调用栈(Stack)**:维护函数调用链与局部变量
- **TLS(Thread Local Storage)**:线程本地存储

### 线程独占 vs 共享

| 独占资源 | 共享资源 |
|---|---|
| 线程 ID | 进程代码段 |
| 寄存器组 | 公有数据(堆) |
| 函数堆栈 | 文件描述符 |
| TLS | 信号处理器 |
| | 当前目录、用户 ID、组 ID |

共享带来便利也带来问题:**数据不一致、竞态条件、死锁**。所以需要互斥锁、信号量、读写锁等同步机制。

### Stack vs Heap:线程的内存模型

CLR 在运行 C# 程序时,内存逻辑上分两大块:

- **栈(Stack)**:由线程独占,保存方法调用栈、值类型局部变量。先进后出,方法返回时栈帧自动释放,**不受 GC 管理**。
- **堆(Heap)**:所有线程共享,存放引用类型对象。由 **GC** 管理生命周期。

分配规则:
- 值类型(`int / bool / struct / enum` 等,继承自 `System.ValueType`)→ **声明处**分配,通常在栈上;但若作为类的字段,则随对象一起在堆上
- 引用类型(`class / interface / delegate / string / object`)→ 总是分配在堆上,变量本身(引用指针)在栈上

```csharp
public int AddFive(int pValue)
{
    int result = pValue + 5;   // pValue、result 都在栈上
    return result;
}   // 方法返回,栈帧立即释放

public class MyInt { public int MyValue; }

public MyInt AddFive(int pValue)
{
    MyInt result = new MyInt();   // result(引用)在栈,new MyInt()(对象)在堆
    result.MyValue = pValue + 5;
    return result;   // 返回引用,对象继续在堆上直到 GC 回收
}
```

<!-- more -->

## 二、C# 并发的三套 API

C# 提供了三层抽象,自底向上越来越高级:

```
Thread  →  ThreadPool  →  Task  →  async / await
手动       池化          推荐      语法糖(基于 Task)
```

### 1. Thread:最底层的手动线程

```csharp
Thread t = new Thread(() =>
{
    Console.WriteLine($"线程 ID: {Thread.CurrentThread.ManagedThreadId}");
    Thread.Sleep(2000);
});
t.Start();
t.Join();   // 阻塞主线程等待 t 完成
```

特点:
- 前台/后台线程:`t.IsBackground = true` 切换为后台线程(进程退出时强制结束)
- 优先级:`t.Priority = ThreadPriority.Highest`
- 资源开销大(每个线程约 1MB 栈空间)
- `Thread.Abort()` 已过时,不要用

### 2. ThreadPool:线程池

线程池维护一组可复用线程,任务完成后线程不销毁,而是回到池里供下次使用。

```csharp
for (int i = 0; i < 10; i++)
{
    ThreadPool.QueueUserWorkItem(state =>
    {
        Console.WriteLine($"执行任务 {state}");
    }, i);
}
```

局限:
- 不能控制执行顺序
- 无法取消任务、无法获取异常
- 池内线程都是后台线程,不能设优先级
- 不适合长时间任务(会霸占池中线程)

### 3. Task:基于 ThreadPool 的封装(.NET 4.0+)

Task 在 ThreadPool 之上加了**任务抽象**:支持返回值、延续、取消、异常聚合。

```csharp
// 三种等价创建方式
Task t1 = new Task(() => {}).Start();

Task t2 = Task.Factory.StartNew(() => {});

Task t3 = Task.Run(() => {});
```

带返回值:

```csharp
Task<int> task = Task.Run(() => 42);
int result = task.Result;   // 注意:获取 Result 会阻塞调用线程
```

阻塞控制(替代 `Thread.Join`):

```csharp
Task.Wait()       // 等单个 Task 完成
Task.WaitAll(ts)  // 所有完成才解除阻塞
Task.WaitAny(ts)  // 任一完成即解除阻塞
```

同步执行(罕见用法,会阻塞主线程):

```csharp
new Task(() => Console.WriteLine("sync")).RunSynchronously();
```

## 三、async / await:语言级异步(.NET 4.5+)

async/await 是基于 Task 的语法糖,让异步代码读起来像同步代码。

```csharp
public async Task<int> CalculateAsync()
{
    int a = await Task.Run(() => 10);
    int b = await Task.Run(() => 20);
    return a + b;
}
```

### 返回类型

异步方法的返回类型只能是这三种:
- `Task<T>`:调用方需要返回值
- `Task`:调用方只需追踪状态,不要返回值
- `void`:fire-and-forget,极不推荐(异常无法捕获)

### async/await 的关键事实

- `async` 只能修饰方法,且通常和 `await` 配对出现(单独 async 没意义,编译器会警告)
- `await` 后面跟一个 `Task` / `Task<T>` / `ValueTask` / 实现了 `GetAwaiter()` 的对象
- `await` 之前和之后的代码**可能在不同线程上执行**(状态机切换)
- 异步方法的异常会聚合到返回的 Task 上,不会直接抛出(除非用 `void`)

### 三套 API 该用哪个?

| 场景 | 推荐 |
|---|---|
| 长时间 CPU 密集任务 | `Task.Run` |
| IO 操作(文件 / 网络 / 数据库) | `async` / `await`(原生异步 API) |
| 需要细粒度控制(优先级、前台线程) | `Thread` |
| 短时小任务 | `ThreadPool.QueueUserWorkItem` 或 `ValueTask` |

## 四、await 的状态机原理

async/await 看似魔法,实际是编译器生成的**状态机**。理解原理对调试和性能优化很重要。

### 编译器做了什么

对于前面那段 `CalculateAsync`,编译器生成:

1. 一个状态机结构体 `<CalculateAsync>d__0`,实现 `IAsyncStateMachine`
2. 字段:
   - `<>1__state`:当前状态(-1 未开始,0/1 在等待, -2 已完成)
   - `<>t__builder`:`AsyncTaskMethodBuilder<int>` 管理任务生命周期
   - `<a>5__1`、`<b>5__2`:局部变量(被提升为字段,以便跨 await 保留)
   - `<>u__1`:当前 awaiter
3. 一个 `MoveNext()` 方法,根据 state 走不同分支

### 简化的 MoveNext 流程

```csharp
private void MoveNext()
{
    try
    {
        switch (<>1__state)
        {
            case -1:  // 初次进入
                <>1__state = 0;
                awaiter = Task.Run(() => 10).GetAwaiter();
                if (!awaiter.IsCompleted)
                {
                    // 任务未完成,注册回调,返回(不阻塞)
                    <>t__builder.AwaitUnsafeOnCompleted(ref awaiter, ref this);
                    return;
                }
                goto case 0;
            case 0:   // 第一次 await 恢复
                <a>5__1 = awaiter.GetResult();
                <>1__state = 1;
                awaiter = Task.Run(() => 20).GetAwaiter();
                if (!awaiter.IsCompleted)
                {
                    <>t__builder.AwaitUnsafeOnCompleted(ref awaiter, ref this);
                    return;
                }
                goto case 1;
            case 1:   // 第二次 await 恢复
                int b = awaiter.GetResult();
                int result = <a>5__1 + b;
                <>1__state = -2;
                <>t__builder.SetResult(result);
                return;
        }
    }
    catch (Exception ex)
    {
        <>1__state = -2;
        <>t__builder.SetException(ex);
    }
}
```

### 关键点

1. **同步完成优化**:`if (!awaiter.IsCompleted)` 检查,若任务已完成直接跳过回调注册,避免上下文切换开销
2. **回调注册**:`AwaitUnsafeOnCompleted` 内部调用 `awaiter.UnsafeOnCompleted(stateMachine.MoveNext)`,任务完成时再次调用 `MoveNext`
3. **状态恢复**:每次 `MoveNext` 通过 state 字段知道该跳到哪个 case,从上次 await 处继续
4. **零分配优化**:状态机是 `struct`,在同步完成路径下可以避免堆分配

### AsyncTaskMethodBuilder 的职责

| 方法 | 作用 |
|---|---|
| `Create()` | 创建 builder 实例 |
| `Start(ref sm)` | 启动状态机,首次调用 MoveNext |
| `AwaitUnsafeOnCompleted` | 注册回调 |
| `SetResult(T)` | 任务完成,设置结果 |
| `SetException` | 任务失败,设置异常 |

## 五、线程同步问题与解决

### 竞态条件(Race Condition)

多个线程同时读写共享数据,结果依赖执行顺序:

```csharp
int counter = 0;
for (int i = 0; i < 10; i++)
{
    new Thread(() => { for (int j = 0; j < 10000; j++) counter++; }).Start();
}
// counter 最终值可能不是 100000
```

### 死锁(Deadlock)

两个线程互相等待对方持有的锁:

```csharp
// 线程 1:lock(A) { lock(B) {...} }
// 线程 2:lock(B) { lock(A) {...} }
// → 永远等不到
```

### 解决方案

**lock(互斥锁)**:

```csharp
private readonly object _lockObj = new object();

lock (_lockObj)
{
    counter++;   // 同一时刻只有一个线程能进入
}
```

**信号量(SemaphoreSlim)**:限制并发数

```csharp
var sem = new SemaphoreSlim(3);   // 同时最多 3 个线程
await sem.WaitAsync();
try { /* ... */ }
finally { sem.Release(); }
```

**线程安全集合**:`ConcurrentDictionary` / `ConcurrentQueue`

**避免共享**:尽可能用不可变数据、消息传递(如 `Channel<T>`)取代共享状态

## 六、实战要点

1. **优先用 Task.Run 处理 CPU 密集任务**,IO 密集用原生 async API(`ReadAsync` / `WriteAsync` / `HttpClient.GetAsync` 等),不要 `Task.Run` 包一层
2. **避免 async void**,事件处理器除外
3. **异步方法全链路异步**:不要在异步链中同步等待(`.Result` / `.Wait()`),否则可能死锁(UI / ASP.NET 上下文)
4. **取消用 CancellationToken**,不要用 Thread.Abort
5. **异常处理**:用 `try/catch` 包住 `await`,或检查 `Task.IsFaulted`
6. **性能**:热路径上考虑 `ValueTask` 替代 `Task<T>`,减少堆分配

## 七、演进路线总结

```
Thread (手动)
   ↓ 池化复用
ThreadPool
   ↓ 任务抽象
Task  (.NET 4.0)
   ↓ 语法糖
async / await  (.NET 4.5)
   ↓ 零分配
ValueTask  (.NET Core 2.1)
```

每一层都是对下层的封装与改进,核心目标是:**用更低的资源开销、更简洁的代码,表达异步逻辑**。但底层的本质始终是:线程、栈、共享内存、同步原语。

## 参考

- [MSDN:异步编程](https://learn.microsoft.com/zh-cn/dotnet/csharp/asynchronous-programming/)
- 《CLR via C#》(Jeffrey Richter)第 27 章
- [Stephen Toub - Async/Await FAQ](https://devblogs.microsoft.com/dotnet/async-faq-where-do-i-start/)

---

[上一篇:C# 委托体系:委托、事件、匿名方法与 Lambda](/2024/08/10/csharp-delegate-event/)
