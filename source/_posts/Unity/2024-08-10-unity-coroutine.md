---
title: Unity 协程(Coroutine / IEnumerator / yield)
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - Unity
  - 协程
  - IEnumerator
  - GC
categories:
  - [Unity, 协程]
comments: true
---

> 协程是 Unity 单线程异步的核心机制。这一篇从 yield 背后的 IEnumerator 谈起,讲清楚协程为什么不是多线程、它和线程在堆栈上的区别、yield return 各种指令的代价,以及 Start/Stop 协程时的常见坑。

## 一、为什么需要协程

Unity 主循环是单线程的。很多时候我们需要"延后执行某段代码"、"等待某个条件成立后再继续":

- 0.5 秒后播一个特效
- 等动画播放完毕再切换 UI
- 每隔 1 秒检查一次网络状态

传统做法是 `Update` 里维护计时器,逻辑分散且难维护。协程把这种"分段执行的异步流程"写在一个方法里:

```csharp
IEnumerator PlayFXAndSwitchUI()
{
    fx.Play();
    yield return new WaitForSeconds(0.5f);  // 等 0.5 秒
    uiPanel.SetActive(true);
    yield return new WaitUntil(() => anim.IsFinished);  // 等条件
    nextPanel.SetActive(true);
}

void Start()
{
    StartCoroutine(PlayFXAndSwitchUI());
}
```

读起来像同步代码,实际被切片成多次执行。

## 二、协程的本质:不是多线程

### 2.1 协程 vs 线程

| 维度 | 协程(Coroutine) | 线程(Thread / Task) |
|---|---|---|
| 调度 | Unity 主线程内,帧间调度 | 操作系统调度,可多核并行 |
| 并行 | 否,顺序执行 | 是 |
| 内存 | 共享主线程堆栈 | 各自独立栈 |
| 锁 | 不需要 | 多线程读写共享数据要加锁 |
| 调用 Unity API | 安全 | 不安全(大部分 API 必须主线程) |

> **结论**:协程本质上是"用迭代器语法写的状态机",Unity 在主循环的特定时机(Update 之后、LateUpdate 之前)推进它,没有任何并行。

<!-- more -->

### 2.2 协程的执行时序

```text
帧 N:
  Update           ← 协程 yield 之前的代码
  检查所有协程的 yield 指令是否满足
    满足 → 推进到下一个 yield
    不满足 → 等下一帧
  LateUpdate
```

协程里 `yield` 之前的代码是同步执行的(和普通函数调用一样),`yield` 之后的代码会在条件满足时被 Unity 在合适时机调用。

### 2.3 yield 之后代码的调用时机

| yield 指令 | 后续代码调用时机 |
|---|---|
| `yield return null` | 下一帧的 Update 之后 |
| `yield return WaitForEndOfFrame` | 本帧渲染完成后 |
| `yield return new WaitForSeconds(t)` | t 秒后(注意时间是从 0 累积,Game time) |
| `yield return new WaitForFixedUpdate` | 下一次 FixedUpdate 之后 |
| `yield return new WaitWhile(pred)` | pred 返回 false 的下一帧 |
| `yield return new WaitUntil(pred)` | pred 返回 true 的下一帧 |
| `yield return StartCoroutine(other)` | other 协程执行完后 |
| `yield return AsyncOperation` | 异步操作完成后 |
| `yield return WebRequest` | 网络请求完成后 |

### 2.4 yield return null vs yield return 0

```csharp
yield return null;  // 推荐
yield return 0;     // 会触发装箱(boxing),产生 GC
```

协程返回值类型是 `object`,所以 `yield return 0` 会把整数字面量 `0` 装箱成 object,产生 GC;`yield return null` 本身就是 object 引用,不装箱。

**进一步**:Unity 5.4+ 对 `null` 路径做了内部缓存优化,完全无分配。**始终用 `null`**。

## 三、IEnumerator:协程的底层协议

### 3.1 IEnumerator 接口

C# 中协程函数必须返回 `IEnumerator`:

```csharp
public interface IEnumerator
{
    object Current { get; }   // 当前 yield 返回的值
    bool MoveNext();           // 推进到下一个 yield,返回是否还有
    void Reset();              // 重置(协程不用)
}
```

C# 编译器把含 `yield` 的方法编译成一个**状态机类**,实现 `IEnumerator`:

```csharp
IEnumerator Count()
{
    for (int i = 0; i < 3; i++)
        yield return null;
}
```

编译后大致是:

```csharp
class Count_StateMachine : IEnumerator
{
    int state;
    int i;

    public object Current => null;

    public bool MoveNext()
    {
        switch (state)
        {
            case 0:
                i = 0;
                state = 1;
                return true;
            case 1:
                if (i < 3) { i++; return true; }
                state = 2;
                return false;
        }
        return false;
    }
}
```

每次 `MoveNext` 推进到下一个 `yield`,Unity 根据返回值(`Current`)决定下次什么时候再调 `MoveNext`。

### 3.2 StartCoroutine 的内部

```csharp
public Coroutine StartCoroutine(IEnumerator routine);
```

`StartCoroutine` 把迭代器包装成一个 `Coroutine` 对象,注册到 `MonoBehaviour` 的协程列表里。每帧 Unity 检查所有协程:

```text
foreach (coroutine in activeCoroutines)
{
    if (coroutine.Current is WaitForSeconds ws)
    {
        if (Time.time - coroutine.startTime >= ws.duration)
            coroutine.MoveNext();
    }
    else if (coroutine.Current is null)
    {
        coroutine.MoveNext();
    }
    // ...其他类型
}
```

`StopCoroutine` 把协程从列表中移除,`MoveNext` 不再被调用,后续代码自然就不再执行。

## 四、协程的 GC 陷阱

### 4.1 yield return 的装箱

```csharp
yield return new WaitForSeconds(1f);  // new 在堆上,GC!
yield return null;                     // null 被包装成 YieldInstruction,GC
```

协程本身 GC 来源:
- `new WaitForSeconds / WaitWhile / ...`:每次 new 都分配堆
- `yield return null`:Unity 会包装成内部对象
- 闭包捕获局部变量:编译器生成闭包类,实例化分配

### 4.2 缓存 WaitForSeconds

```csharp
// 反面教材:每帧调用都 new
IEnumerator Loop()
{
    while (true)
        yield return new WaitForSeconds(0.1f);  // 每次都 GC
}

// 正解:静态缓存
private static readonly WaitForSeconds Wait = new WaitForSeconds(0.1f);

IEnumerator Loop()
{
    while (true)
        yield return Wait;
}
```

`WaitForSeconds` 一旦创建,内部 duration 不变,完全可以静态缓存复用。

### 4.3 lambda 捕获的 GC

```csharp
// 反面:每次 yield 创建 lambda 闭包
yield return new WaitUntil(() => IsReady());

// 改进:用方法组
yield return new WaitUntil(IsReady);

// 进一步:缓存
private static readonly Func<bool> CheckReady = IsReady;
yield return new WaitUntil(CheckReady);
```

`WaitUntil(predicate)` 内部持有 predicate 引用,如果用 lambda 捕获了局部变量,每次都会创建闭包对象。

### 4.4 协程中的 List / 数组分配

```csharp
IEnumerator ProcessAll()
{
    var list = new List<int>(100);  // 堆分配
    // ...
}

// 如果 ProcessAll 被频繁启动,改成共享列表
private readonly List<int> _sharedList = new(100);
```

协程里所有局部变量都跟着迭代器状态机对象存放在堆上(不是栈上!),频繁启动会持续分配。

## 五、协程的堆栈与共享

### 5.1 协程的堆栈

很多人误以为"协程独立栈"。实际上 Unity 协程**没有独立栈**:

- 协程跑在**主线程**,共享主线程的栈
- 协程的"局部变量"实际是状态机对象的字段,在**堆**上
- 协程的执行上下文(局部变量、当前 yield 位置)是迭代器状态机对象

```text
主线程栈:所有协程共享(实际只有一个,因为协程在主线程顺序跑)
堆:所有协程的状态机对象都在堆上
```

### 5.2 多协程之间的数据共享

```csharp
private int _counter;

IEnumerator Adder()
{
    while (true)
    {
        _counter++;
        yield return null;
    }
}

IEnumerator Reader()
{
    while (true)
    {
        Debug.Log(_counter);
        yield return null;
    }
}

void Start()
{
    StartCoroutine(Adder());
    StartCoroutine(Reader());
}
```

两个协程都在主线程顺序执行,`_counter` 是普通字段,**不需要锁**。

### 5.3 协程与 GameObject 生命周期

```csharp
IEnumerator RunForever()
{
    while (true) yield return null;
}

void Start() => StartCoroutine(RunForever());

void OnDisable() => Debug.Log("disabled");
```

GameObject 被关闭(`SetActive(false)`)后:
- 协程**停止推进**(Update 不调用,MoveNext 不会执行)
- 重新激活时**不会自动恢复**(协程对象还在,但已经"丢"了)
- GameObject 销毁时,协程对象一起被回收

正确做法:在 `OnEnable` 启动,`OnDisable` 停止:

```csharp
private Coroutine _routine;

void OnEnable()
{
    _routine = StartCoroutine(MyRoutine());
}

void OnDisable()
{
    if (_routine != null) StopCoroutine(_routine);
}
```

注意保存 `StartCoroutine` 的返回值(`Coroutine` 对象),`StopCoroutine(routine)` 比 `StopCoroutine(methodName)` 性能好且更安全。

## 六、协程的实用模式

### 6.1 延迟执行

```csharp
public static IEnumerator Delay(float seconds, Action callback)
{
    yield return new WaitForSeconds(seconds);
    callback?.Invoke();
}

StartCoroutine(Delay(2f, () => { /* 2 秒后执行 */ }));
```

### 6.2 等待动画完成

```csharp
IEnumerator WaitForAnimation(Animator anim, string stateName)
{
    // 等进入指定状态
    yield return new WaitUntil(() => anim.GetCurrentAnimatorStateInfo(0).IsName(stateName));
    // 等播放完毕
    yield return new WaitUntil(() =>
        anim.GetCurrentAnimatorStateInfo(0).normalizedTime >= 0.99f);
}
```

### 6.3 链式协程

```csharp
IEnumerator Chain()
{
    yield return StartCoroutine(Step1());
    yield return StartCoroutine(Step2());
    yield return StartCoroutine(Step3());
}
```

`yield return StartCoroutine(other)` 会让当前协程等另一个协程完成。

### 6.4 异步资源加载

```csharp
IEnumerator LoadAsset(string path, Action<Object> onLoaded)
{
    ResourceRequest req = Resources.LoadAsync<Object>(path);
    yield return req;
    onLoaded?.Invoke(req.asset);
}
```

`ResourceRequest` 是 `AsyncOperation` 子类,`yield return req` 会等加载完成。

### 6.5 超时控制

```csharp
IEnumerator WaitOrTimeout(Func<bool> pred, float timeout, Action onTimeout)
{
    float start = Time.time;
    while (!pred())
    {
        if (Time.time - start > timeout)
        {
            onTimeout?.Invoke();
            yield break;
        }
        yield return null;
    }
}
```

`yield break` 提前结束协程。

### 6.6 StopAllCoroutines 与多协程管理

`StopCoroutine(IEnumerator)` 只停一个,`StopAllCoroutines` 停当前 MonoBehaviour 上**所有**协程:

```csharp
void OnDisable()
{
    StopAllCoroutines();  // 干净清空,不用保存引用
}
```

注意:
- `StopAllCoroutines` 无差别清空,**不区分**字符串名 / IEnumerator 引用
- 跨 MonoBehaviour **不能停别人的协程**,每个 MonoBehaviour 维护自己的协程列表
- 如果协程 A 里 `yield return StartCoroutine(B)`,停止 A **不会**自动停 B,B 还会继续跑——需要 B 自己保存自己的引用并主动停

## 七、协程 vs async/await vs UniTask

协程是 C# 2.0 时代的产物,语言层面有 async/await 后,协程的很多场景可以更优雅:

| 维度 | Coroutine | Task (async/await) | UniTask |
|---|---|---|---|
| 同步等待 | `yield return` | `await` | `await` |
| 返回值 | IEnumerator | `Task<T>` | `UniTask<T>` |
| GC | 每次 yield 都有 | 状态机分配 | 零 GC(struct + 对象池) |
| 跨线程 | 主线程内 | 可跨线程 | 主线程内(默认) |
| 取消 | StopCoroutine | CancellationToken | CancellationToken |

新项目推荐 **UniTask**,它把协程和 Task 的优点结合,零 GC、支持 await、与 Unity API 兼容。但已有代码大量协程的情况下,继续用协程也很合理。

## 八、常见错误

### 8.1 在协程里访问已销毁对象

```csharp
IEnumerator Bad()
{
    yield return new WaitForSeconds(1f);
    // 这 1 秒内 GameObject 可能已被销毁
    transform.position = Vector3.zero;  // NullReferenceException
}

// 修复:加守卫
IEnumerator Good()
{
    yield return new WaitForSeconds(1f);
    if (this == null) yield break;  // MonoBehaviour 重载了 == 操作符
    transform.position = Vector3.zero;
}
```

> **为什么 `this == null` 能判断销毁?** MonoBehaviour 重载了 `==` / `!=` 操作符。GameObject 被 `Destroy` 后,C# 托管对象(wrapper)还在,但 native 侧已释放。重载后的 `==` 检测到 native 已死,返回 `true`。所以 `this == null` 实际是问"native 还活着吗",而不是真的引用为空。这也意味着 `ReferenceEquals(this, null)` 永远是 false,这里**必须用 `==`**。

### 8.2 StopCoroutine 用字符串 vs IEnumerator

```csharp
IEnumerator Routine() { yield return null; }

// 启动用 IEnumerator,停止也必须用同一个 IEnumerator 引用
IEnumerator routineRef = Routine();
StartCoroutine(routineRef);
StopCoroutine(routineRef);   // OK

// 字符串方式:必须用字符串启动
StartCoroutine("Routine");
StopCoroutine("Routine");    // OK

// 混用会失败
StartCoroutine(routineRef);
StopCoroutine("Routine");    // 不停!
```

最稳妥:保存 `Coroutine` 引用,用 `StopCoroutine(Coroutine)` 停止。

### 8.3 协程里抛异常

```csharp
IEnumerator Risky()
{
    throw new Exception("oops");  // 协程异常会被 Unity 捕获,日志能看到,但后续代码不会执行
}
```

协程异常会被 Unity 内部 try/catch,记日志后协程被销毁,**不会**传播到调用者。如果需要异常处理,自己 try/catch。

## 参考

- [Unity 官方手册:Coroutines](https://docs.unity3d.com/cn/current/Manual/Coroutines.html)
- [聊一聊协程背后的实现原理](https://www.cnblogs.com/iwiniwin/p/14878498.html)
- [Unity 协程详解](https://blog.csdn.net/m0_63024355/article/details/132589927)
- [UniTask:零 GC 异步方案](https://github.com/Cysharp/UniTask)

---

下一篇:[Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/) — 整合 EditorWindow、CustomEditor、Selection、AssetDatabase 等编辑器扩展常用 API。

## 系列目录

1. [Unity 生命周期、MonoBehaviour 与场景管理](/2024/08/10/unity-lifecycle-mono-scene/)
2. [Unity UGUI 基础组件](/2024/08/10/unity-ugui-basics/)
3. [Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/)
4. Unity 协程(本篇)
5. [Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/)
6. [Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/)
7. [Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. [Unity Android 构建与调试](/2024/08/10/unity-android-build-debug/)
10. [Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/)
