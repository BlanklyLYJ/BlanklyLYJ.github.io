---
title: Unity 生命周期、MonoBehaviour 与场景管理
date: 2024-08-10 22:00:00
updated: 2024-08-10 22:00:00
tags:
  - Unity
  - 生命周期
  - MonoBehaviour
  - 场景管理
categories:
  - [Unity, 基础]
comments: true
---

> 这是 Unity 系列的第一篇,把脚本生命周期、MonoBehaviour 的常见坑、GameObject 与组件操作、场景/预制体加载这些"每次开新工程都要重新捡一遍"的基础知识整合到一起,看完一次就能把 Unity 主循环的来龙去脉串起来。

## 一、Unity 脚本生命周期全景

Unity 中所有挂在 GameObject 上的脚本都继承自 `MonoBehaviour`。引擎在每一帧的不同时间点会按固定顺序调用一系列魔法方法,理解这个顺序是写对脚本的前提。

| 阶段 | 方法 | 调用时机 | 典型用途 |
|---|---|---|---|
| 初始化 | `Awake` | 实例创建后调用一次,无论脚本是否启用 | 缓存组件、初始化字段、注册事件 |
| 初始化 | `OnEnable` | 每次 `enabled = true` 或物体被激活 | 订阅事件、重置状态 |
| 初始化 | `Start` | `Awake` 之后、第一帧 `Update` 之前,仅当脚本启用时 | 跨脚本依赖初始化、协程启动 |
| 物理 | `FixedUpdate` | 固定时间间隔(默认 0.02s) | 刚体物理操作 |
| 输入 | `Update` | 每帧 | 输入检测、业务逻辑 |
| 物理 | `OnTriggerXXX` / `OnCollisionXXX` | 物理阶段之后 | 碰撞响应 |
| 后处理 | `LateUpdate` | 所有 `Update` 完成后 | 相机跟随、依赖动画结果的逻辑 |
| 渲染 | `OnPreCull` / `OnPreRender` | 渲染管线对应阶段 | 自定义渲染 |
| 销毁 | `OnDisable` | 每次 `enabled = false` 或物体被隐藏 | 取消订阅 |
| 销毁 | `OnDestroy` | 物体销毁时 | 释放资源、注销监听 |

<!-- more -->

### 1.1 Awake 与 Start 的区别

```csharp
public class Player : MonoBehaviour
{
    private Rigidbody _rb;

    private void Awake()
    {
        // 仅一次,无论 enabled 状态
        _rb = GetComponent<Rigidbody>();
    }

    private void Start()
    {
        // 仅当 enabled,且在 Awake 之后
        _rb.velocity = Vector3.forward;
    }
}
```

**关键差别**:
- `Awake` 在物体创建时**无条件调用**,即使脚本 `enabled = false`
- `Start` 在脚本启用后第一帧 `Update` 之前调用一次,且**只在物体 active 时**
- 如果场景里多个脚本互相依赖,被依赖方在 `Awake` 初始化,依赖方在 `Start` 取用

### 1.2 Update / LateUpdate / FixedUpdate

| 方法 | 频率 | 用途 |
|---|---|---|
| `Update` | 每帧,间隔不固定 | 输入、计时器、UI |
| `LateUpdate` | 在所有 `Update` 之后 | 摄像机跟随、动画下游逻辑 |
| `FixedUpdate` | 固定时间步长(默认 0.02s) | `Rigidbody` 物理 |

`FixedUpdate` 的频率由 `Time.fixedDeltaTime` 决定,与渲染帧率解耦。在低帧率下,一帧渲染可能触发多次 `FixedUpdate`;高帧率下可能跳过。**物理代码必须放 `FixedUpdate`**,否则结果会随帧率漂移。

### 1.3 编辑器扩展生命周期

Editor-only 还有一组方法,常规脚本几乎不用,但做编辑器扩展会用到:

```csharp
#if UNITY_EDITOR
private void Reset()
{
    // AddComponent 或 Reset 组件时,Editor only
}

private void OnValidate()
{
    // Inspector 字段修改时,Editor only
}
#endif
```

### 1.4 完整执行顺序图

把上表展开成时间线,一眼看懂全流程:

```text
应用启动
  ↓
Awake()             ← 一次,无论 enabled
  ↓
OnEnable()          ← 每次 enabled = true 或物体激活
  ↓
Start()             ← 第一帧 Update 之前,仅 enabled 时
  ↓
─────── 主循环(每帧)────────
FixedUpdate()       ← 固定间隔(物理,可能 0 或多次)
  ↓
物理回调(OnTrigger* / OnCollision*)
  ↓
Update()            ← 每帧
  ↓
协程 yield 推进
  ↓
LateUpdate()        ← 所有 Update 完成后
  ↓
渲染(OnPreCull / OnPreRender / OnRenderObject 等)
  ↓
WaitForEndOfFrame / 帧结束
─────────────────────────────
  ↓
OnDisable()         ← enabled = false 或物体隐藏
  ↓
(重新激活时 OnEnable → 不再调 Start,直接进主循环)
  ↓
OnDestroy()         ← 物体销毁
```

### 1.5 应用层生命周期

除了帧级回调,还有一组应用级回调,**独立于帧触发**:

| 方法 | 触发时机 | 平台 |
|------|---------|------|
| `OnApplicationFocus(bool hasFocus)` | 应用获得 / 失去焦点(切窗口、切后台) | 全部 |
| `OnApplicationPause(bool paused)` | 应用被系统暂停(来电、切后台) | 全部,iOS / Android 主要靠它 |
| `OnApplicationQuit()` | 应用退出时 | **仅 Standalone**(PC / Mac),移动端**不保证调用** |

典型用途:

```csharp
private void OnApplicationFocus(bool hasFocus)
{
    if (!hasFocus)
    {
        // 切到后台,暂停 BGM / 计时器
        AudioManager.Instance.PauseBGM();
        Time.timeScale = 0;
    }
    else
    {
        AudioManager.Instance.ResumeBGM();
        Time.timeScale = 1;
    }
}

private void OnApplicationPause(bool paused)
{
    if (paused)
    {
        // 切后台立刻保存,移动端 OnApplicationQuit 不可靠
        SaveSystem.SaveAll();
    }
}

private void OnApplicationQuit()
{
    PlayerPrefs.Save();
}
```

> **移动端关键坑**:`OnApplicationQuit` 在 iOS / Android 上**不保证**调用(系统可能直接 kill 进程)。重要数据必须在 `OnApplicationPause` 里就保存,不要等 Quit。

### 1.6 ScriptableObject 生命周期

`ScriptableObject` 是另一种常用基类,生命周期**与 MonoBehaviour 不同**,容易踩坑:

| 方法 | ScriptableObject | MonoBehaviour |
|------|------------------|---------------|
| `Awake` | ❌ 没有 | ✅ 有 |
| `OnEnable` | ✅ 有(创建 / 加载时) | ✅ 有 |
| `Start` | ❌ 没有 | ✅ 有 |
| `Update` | ❌ 没有 | ✅ 有 |
| `OnDisable` / `OnDestroy` | ✅ 有 | ✅ 有 |
| `OnValidate` / `Reset` | ✅ Editor only | ✅ Editor only |

```csharp
public class GameConfig : ScriptableObject
{
    public int maxLevel;

    // ⚠ ScriptableObject 没有 Awake / Start!
    // 初始化放在 OnEnable

    private void OnEnable()
    {
        Debug.Log("Config loaded");
    }

    private void OnValidate()
    {
        // Editor only,字段修改时校验
        maxLevel = Mathf.Max(1, maxLevel);
    }
}
```

**记忆诀窍**:ScriptableObject 是"数据资源",不参与帧循环,只在创建 / 加载 / 销毁时触发回调。

## 二、GameObject 与组件操作

### 2.1 获取组件

```csharp
// 当前物体上的组件
Rigidbody rb = GetComponent<Rigidbody>();

// 父级(向上查找)
Transform parent = transform.parent;

// 子级(向下查找,深度优先)
Transform child = transform.Find("Arm/Hand");

// 查找场景中其他物体(慎用,性能差)
Player player = FindObjectOfType<Player>();
Player[] players = FindObjectsOfType<Player>();

// 按名字 / 标签
GameObject go = GameObject.Find("MainCamera");
GameObject[] enemies = GameObject.FindGameObjectsWithTag("Enemy");
```

`FindObjectOfType` 内部要遍历整个场景,**避免在 `Update` 里调用**。正确做法是在 `Awake` / `Start` 中缓存引用,或用单例 / 事件总线解耦。

### 2.2 实例化与销毁

```csharp
// 创建克隆
GameObject bullet = Instantiate(bulletPrefab, firePoint.position, firePoint.rotation);

// 销毁
Destroy(bullet, 2f);   // 2 秒后销毁
DestroyImmediate(bullet); // 立即销毁,仅 Editor

// 激活 / 关闭
gameObject.SetActive(false);
bool active = gameObject.activeInHierarchy; // 场景中是否激活
bool selfActive = gameObject.activeSelf;     // 自身勾选状态
```

### 2.3 AddComponent 动态挂载

```csharp
// 运行时给物体加组件
Rigidbody rb = gameObject.AddComponent<Rigidbody>();
rb.mass = 1f;
```

注意:`AddComponent` 是堆分配,不要每帧调用。如果需要频繁创建带组件的对象,做对象池。

### 2.4 Transform 操作

```csharp
// 位置 / 旋转 / 缩放
transform.position = new Vector3(0, 1, 0);     // 世界坐标
transform.localPosition = Vector3.zero;        // 父级相对
transform.rotation = Quaternion.Euler(0, 90, 0); // 欧拉角
transform.rotation = Quaternion.LookRotation(dir); // 朝向某方向

// 移动
transform.Translate(Vector3.forward * speed * Time.deltaTime);
transform.Rotate(Vector3.up, 90 * Time.deltaTime);

// 父子关系
childTransform.SetParent(rootTransform, false);
```

**重要**:`transform.position` 是属性,直接赋值 `transform.position.x = 1` 会报错(因为属性返回的是值类型副本),必须整体赋值:

```csharp
// 错误
transform.position.x = 1;

// 正确
Vector3 p = transform.position;
p.x = 1;
transform.position = p;
```

## 三、时间与帧率

### 3.1 deltaTime 与 fixedDeltaTime

```csharp
void Update()
{
    // 每帧位移 = 速度 × 每帧耗时,保证不同帧率下移动一致
    transform.Translate(Vector3.forward * speed * Time.deltaTime);
}
```

`Time.deltaTime` 是上一帧到当前帧的间隔。**任何随时间变化的逻辑都应该乘 `deltaTime`**,否则在 144Hz 显示器上跑得比 60Hz 快 2.4 倍。

### 3.2 时间戳(Unix 时间)

```csharp
// C# 中获取 Unix 时间戳(秒)
long timestamp = (DateTime.Now.ToUniversalTime().Ticks - 621355968000000000) / 10000000;
```

那个奇怪的 `621355968000000000` 是 `0001-01-01` 到 `1970-01-01` 的 tick 数,因为 .NET 的 `DateTime` 起点是公元 1 年,Unix 时间戳起点是 1970 年。

### 3.3 帧率 vs 定时器

> 一个被忽视的细节:Unity 的 `Update` 不是匀速的,刷新率越低,`Update` 之间间隔越长。

如果用 `Update` 实现定时器(`timeLeft -= deltaTime; if (timeLeft <= 0) Do()`),在低帧率下精度会很差。需要高精度定时(比如网络包重发),应该用 `InvokeRepeating`、协程或 `Time.realtimeSinceStartup`。

## 四、场景管理

### 4.1 加载场景

```csharp
using UnityEngine.SceneManagement;

// 同步加载(会卡顿)
SceneManager.LoadScene("BossRoom");

// 异步加载
AsyncOperation op = SceneManager.LoadSceneAsync("BossRoom");
op.allowSceneActivation = false; // 加载完成后再切换
StartCoroutine(WaitForLoad(op));

IEnumerator WaitForLoad(AsyncOperation op)
{
    while (op.progress < 0.9f) yield return null;
    op.allowSceneActivation = true;
}
```

`allowSceneActivation = false` 时,`progress` 最多到 0.9,显式置 `true` 才会切场景。常用于在 loading 界面等待资源预加载。

### 4.2 多场景叠加

```csharp
// 叠加加载(用于大世界分块、UI 分层)
SceneManager.LoadScene("UI", LoadSceneMode.Additive);

// 卸载
SceneManager.UnloadSceneAsync("UI");

// 设置活跃场景(决定光照、实例化的物体去哪)
SceneManager.SetActiveScene(SceneManager.GetSceneByName("Level"));
```

### 4.3 持久化物体

```csharp
// 切场景时不销毁(常用于全局管理器)
DontDestroyOnLoad(gameObject);
```

注意多次切场景、重复 `DontDestroyOnLoad` 会产生重复实例,需要自己做单例守卫:

```csharp
public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }
}
```

## 五、MonoBehaviour 的常见坑

### 5.1 字段在 Inspector 显示规则

- `public` 字段默认显示
- `private` 加 `[SerializeField]` 显示
- `public` 不想显示加 `[NonSerialized]`
- 自定义类要 `[Serializable]` 才能展开

```csharp
public class Player : MonoBehaviour
{
    public int hp = 100;                        // 显示
    [SerializeField] private float speed = 5f;  // 显示
    [NonSerialized] public bool isDead;         // 不显示
    public WeaponData weapon;                   // WeaponData 需 [Serializable]
}

[Serializable]
public class WeaponData
{
    public string name;
    public int damage;
}
```

### 5.2 退出 Play 模式

```csharp
#if UNITY_EDITOR
    UnityEditor.EditorApplication.isPlaying = false;
#else
    Application.Quit();
#endif
```

Editor 下 `Application.Quit()` 不生效,必须用 `EditorApplication.isPlaying = false`。这俩宏分离是打包时常见错误源。

### 5.3 物体激活与协程

GameObject `SetActive(false)` 后:
- 脚本不调用 `Update`
- 协程**停止**,重新激活不会自动恢复,需要重新 `StartCoroutine`
- `OnDisable` 被调用,`OnEnable` 在激活时调用

如果想隐藏但不停止协程,可以禁用 `Renderer` 或单独的脚本组件,而不是整个 GameObject。

## 六、物理与碰撞

### 6.1 Rigidbody 关键字段

| 字段 | 含义 |
|---|---|
| `Mass` | 质量,影响碰撞冲量 |
| `Drag` | 平移阻力 |
| `Angular Drag` | 旋转阻力 |
| `Use Gravity` | 是否受重力 |
| `Is Kinematic` | 设为 true 时不受物理影响但仍能触发碰撞 |
| `Constraints` | 冻结位置 / 旋转的某些轴 |

### 6.2 碰撞器与触发器

```csharp
private void OnCollisionEnter(Collision other)
{
    // 两个非 Trigger 碰撞器接触
}

private void OnTriggerEnter(Collider other)
{
    // 任一方是 Trigger,且至少一方有 Rigidbody
    if (other.CompareTag("Enemy"))
        Debug.Log("Hit enemy");
}
```

| 类型 | 触发条件 |
|---|---|
| `OnCollisionXXX` | 双方都不是 Trigger |
| `OnTriggerXXX` | 至少一方是 Trigger |

`Is Trigger` 让碰撞器变成"探测器":可以穿过,但会发事件。

### 6.3 Mesh 与渲染

`Mesh Filter` 存模型数据(顶点、三角形、UV、法线),`Mesh Renderer` 负责绘制:

```text
vertices : Vector3[]   顶点坐标
triangles: int[]       三角形索引,每三个构成一个面
normals  : Vector3[]   法线
uv       : Vector2[]   纹理坐标
```

## 七、性能注意点

### 7.1 避免在 Update 里做重活

```csharp
// 反面教材
void Update()
{
    var enemies = FindObjectsOfType<Enemy>(); // 全场景扫描,每帧
    foreach (var e in enemies) { ... }
}

// 正解:Awake 时缓存,或用事件总线
private Enemy[] _enemies;
void Awake() => _enemies = FindObjectsOfType<Enemy>();
```

### 7.2 字符串拼接的 GC

```csharp
void Update()
{
    // 每帧分配新字符串,GC 压力
    Debug.Log("Player HP: " + hp);

    // 改用 $"..." 也没本质区别
    // 真要省,只在变化时输出
}
```

### 7.3 组件缓存

`GetComponent<T>()` 内部不是零成本(虽然新版做了缓存)。高频访问的字段应该 `Awake` 时拿一次:

```csharp
private Rigidbody _rb;
void Awake() => _rb = GetComponent<Rigidbody>();
void Update() => _rb.velocity = ...;
```

## 参考

- [Unity 官方手册:MonoBehaviour](https://docs.unity3d.com/cn/current/ScriptReference/MonoBehaviour.html)
- [Unity 生命周期事件顺序](https://blog.csdn.net/manpi/article/details/129968738)
- [零基础入门 Unity - 古迹探险](https://catlikecoding.com/unity/tutorials/)

---

下一篇:[Unity UGUI 基础组件(Canvas / Image / Text / TextMeshPro)](/2024/08/10/unity-ugui-basics/) — 整合自 Canvas Render Mode、Image、Text、TextMeshPro、Image 裁切、RawImage 多边形等笔记。

## 系列目录

1. Unity 生命周期、MonoBehaviour 与场景管理(本篇)
2. [Unity UGUI 基础组件](/2024/08/10/unity-ugui-basics/)
3. [Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/)
4. [Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/)
5. [Unity Editor 扩展(EditorWindow / Inspector / 工具)](/2024/08/10/unity-editor-extension/)
6. [Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/)
7. [Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. [Unity Android 构建与调试](/2024/08/10/unity-android-build-debug/)
10. [Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/)
