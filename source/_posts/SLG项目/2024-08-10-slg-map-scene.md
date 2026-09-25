---
title: SLG 地图与场景:建造系统 / 场景切换 / RTS 视角控制
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - SLG
  - 地图系统
  - 建造
  - 场景管理
  - Unity
categories:
  - [游戏开发, SLG]
comments: true
---

> 这一篇整合 SLG 项目里和"地图 / 场景"相关的笔记:从网格化的建造系统、场景加载的三种方式,到 RTS 风格的鼠标边缘视角移动。这些是 SLG 地图层的"基础设施",看似不起眼,但决定了玩家第一眼的体验。

## 一、网格化建造系统

SLG 的核心玩法之一是"造城"。本项目用 `GridManager` 做方形网格管理。

### GridManager:网格系统

```csharp
class GridManager
{
    public int width, height;        // 网格宽高
    public float cellSize;           // 格子大小
    public TGridObject[,] gridArray; // 网格对象数组
    public TextMesh debugText;       // debug 用
}
```

### 性能陷阱

`TGridObject[,]` 看起来直观,但有两个问题:

1. **大地图数据爆炸**:1000x1000 的地图就是 100 万个对象,内存和初始化时间都受不了
2. **大多数格子是空的**:实际有建筑的格子可能只占 1%

优化方向:

| 方案 | 适用 |
|---|---|
| 只记录有建筑的格子(字典) | 建筑稀疏 |
| 按区块分块加载 | 大地图 + 分块 |
| 八叉树 / 四叉树搜索 | 建筑密集 + 大范围查询 |

本项目偏向**只记录建筑坐标的网格**,用宽高方向占位:

```csharp
// 优化后:不创建实例,只在建造时记录
Dictionary<Vector2Int, BuildingBaseObject> occupiedCells;
```

### GridBuildingSystem:建造驱动

```csharp
class GridBuildingSystem
{
    public static GridBuildingSystem Instance;  // 单例
    public GridManager gridManager;
    public List<Transform> testTransformList;   // 建造列表(应优化成配置)
    public Transform currentBuilding;           // 当前选中
    public Direction dir;                       // 朝向
    public GameObject ghostGO;                  // 预建造虚影
}
```

### 帧推流程

```csharp
void Update()
{
    // 1. 射线命中地块
    Vector3 hitPoint = GetMouseWorldSnappedPosition();

    // 2. 计算可建造性
    bool canBuild = CheckCanBuild(hitPoint, currentBuilding, dir);

    // 3. 虚影跟随
    ghostGO.transform.position = LerpPosition(hitPoint);
    ghostGO.transform.rotation = LerpRotation(dir);

    // 4. 监听抬起(避免重复触发)
    if (Input.GetMouseButtonUp(0) && canBuild)
    {
        PlaceBuilding();
    }
}
```

关键点:

- **必须监听抬起而不是按下**:否则一帧会触发多次建造
- **LateUpdate Lerp**:虚影位置和朝向用插值,显得更丝滑
- **方向通过 GetKey 切换**:R 键旋转之类的

<!-- more -->

### BuildingConfig:建筑配置

```csharp
class BuildingConfig
{
    public enum Direction { N, E, S, W };

    public Direction GetNextDirection(Direction d);
    public float GetRotationAngle(Direction d);
    public Vector2Int GetOffset(Direction d);
    public List<Vector2Int> GetOccupiedCells(Direction d);
    public Dictionary<int, BuildingConfig> configMap;  // 应通过表加载
}
```

### 类结构总览

```
GridManager           网格系统(数据层)
GridObject            单格对象
BuildingConfig        建筑配置
BuildingBaseObject    建筑实例
BuildingGhostObject   虚影实例
GridBuildingSystem    建造驱动
```

## 二、场景切换与加载

### Build Settings 是前提

```
File → Build Settings
```

只有加到 Build Settings 列表里的场景才会被打包。新增场景必须先加到这里,否则运行时 `LoadScene` 会报错。

### 三种加载方式

```csharp
// 1. 通过 Build Settings 索引
SceneManager.LoadScene(0);

// 2. 通过名称 + 加载模式
SceneManager.LoadScene(0, LoadSceneMode.Single);    // 替换当前场景
SceneManager.LoadScene(0, LoadSceneMode.Additive); // 保留当前,叠加新场景

// 3. 通过名称
SceneManager.LoadScene("MainCity");

// 4. 异步加载(推荐)
AsyncOperation op = SceneManager.LoadSceneAsync("MainCity");
```

### 异步加载的好处

```csharp
IEnumerator LoadSceneAsync(string sceneName)
{
    AsyncOperation op = SceneManager.LoadSceneAsync(sceneName);
    op.allowSceneActivation = false;  // 先卡在 90%

    while (op.progress < 0.9f)
    {
        loadingBar.value = op.progress;
        yield return null;
    }

    loadingBar.value = 1.0f;
    op.allowSceneActivation = true;  // 触发切换
}
```

| 方式 | 适用 | 注意 |
|---|---|---|
| `LoadScene(int)` | 简单切换 | 同步,会卡帧 |
| `LoadScene(name, Additive)` | 子场景叠加 | 需要手动管理生命周期 |
| `LoadSceneAsync` | 大场景 | 不卡帧,可显示进度 |

### Additive 模式的常见用法

```
MainScene(常驻)
  ├── UIScene (Additive)
  ├── BattleScene (Additive)
  └── ...
```

主场景负责基础系统(Network、Audio、AssetBundle),子场景按需加载。但要注意**子场景的对象销毁需要显式 `UnloadScene`**,不会随切换自动清理。

## 三、RTS 视角控制:鼠标边缘移动

RTS / SLG 游戏里,鼠标移到屏幕边缘时摄像机应该往那个方向移动。参考[这篇 CSDN 教程](https://blog.csdn.net/qq_42139931/article/details/128063800)。

### 基本实现

```csharp
public float panSpeed = 20f;
public float panBorderThickness = 10f;
public Vector2 panLimit;

void Update()
{
    Vector3 pos = transform.position;

    // 鼠标位置
    Vector3 mouse = Input.mousePosition;

    // 右边缘
    if (mouse.x >= Screen.width - panBorderThickness)
        pos.x += panSpeed * Time.deltaTime;
    // 左边缘
    if (mouse.x <= panBorderThickness)
        pos.x -= panSpeed * Time.deltaTime;
    // 上边缘
    if (mouse.y >= Screen.height - panBorderThickness)
        pos.z += panSpeed * Time.deltaTime;
    // 下边缘
    if (mouse.y <= panBorderThickness)
        pos.z -= panSpeed * Time.deltaTime;

    // 边界限制
    pos.x = Mathf.Clamp(pos.x, -panLimit.x, panLimit.x);
    pos.z = Mathf.Clamp(pos.z, -panLimit.y, panLimit.y);

    transform.position = pos;
}
```

### 优化点

1. **键盘 + 鼠标双控**:WASD 也支持移动,鼠标边缘作为补充
2. **边缘厚度可视化**:开发期画一个 Gizmo,看到边缘触发区
3. **加速曲线**:长按边缘时速度递增,避免大地图慢
4. **触屏支持**:移动端用拖拽替代边缘检测
5. **缩放(Zoom)**:滚轮调整 Y 轴高度 + 视野角度,做成"近大远小"

### 边界限制

SLG 大地图通常有边界,不能让玩家飘出地图外:

```csharp
// 严格矩形边界
pos.x = Mathf.Clamp(pos.x, mapMinX, mapMaxX);
pos.z = Mathf.Clamp(pos.z, mapMinZ, mapMaxZ);
```

如果是六边形或非矩形地图,需要做形状判断(点是否在多边形内)。

## 四、世界迷雾(扩展)

笔记里没有专门的迷雾文件,但 SLG 必备。常见做法:

| 方案 | 说明 |
|---|---|
| Texture2D 像素涂抹 | 客户端维护一张探索纹理,角色移动时"擦除"迷雾 |
| Tile-based | 离散的格子,每个格子有"已探索 / 当前可见 / 未知"三种状态 |
| RenderTexture + Shader | 用 RenderTexture 做遮罩,Shader 控制可见性 |

性能上 Tile-based 最简单,但视觉效果粗糙;Texture 涂抹效果好但需要处理 UV 和大地图分块。

## 五、小地图(扩展)

小地图的实现思路:

```
1. 顶视相机渲染地形 + 角色 → RenderTexture
2. UI Image 显示 RenderTexture
3. 角色图标独立画在 UI 层(不依赖相机渲染)
4. 边框 / 路径等装饰
```

或者用纯图标方案(不渲染地形,只画点和线),性能更好,适合大型 SLG。

## 六、场景 / 地图的协作

把上面这些放在一起看,一个 SLG 项目的"地图 / 场景层"是这样组织的:

```
启动
  ↓
SceneManager.LoadSceneAsync("Boot")  // 引导 / 资源预加载
  ↓
SceneManager.LoadScene("MainUI", Additive)  // 主 UI 叠加
  ↓
玩家点击"进入战斗"
  ↓
SceneManager.LoadSceneAsync("Battle")
  ↓
GridManager 初始化网格
  ↓
玩家建造 / 操作
  ↓
摄像机边缘移动 + 缩放
```

每一层都需要考虑:

1. **加载性能**:大场景用异步,UI 用叠加
2. **边界控制**:地图边界、摄像机边界、可建造边界
3. **可视反馈**:虚影、范围指示器、网格 debug

## 七、小结

| 模块 | 关键技术 |
|---|---|
| 建造系统 | 网格管理 + 虚影 + 方向配置 |
| 场景切换 | Build Settings + LoadSceneAsync |
| 视角控制 | 鼠标边缘检测 + 边界 Clamp |
| 世界迷雾 | Tile / Texture / RenderTexture |
| 小地图 | 顶视相机 RenderTexture 或纯图标 |

SLG 的地图层看起来"就是放几个建筑",但要做好需要把**网格、建造、视角、迷雾、小地图**全部串起来。每一层都不难,但协作时有很多细节(比如建造时摄像机不能挡、迷雾要同步给小地图)。

## 参考

- [Unity 中 3C 以及 Gameplay 实现记录](https://zhuanlan.zhihu.com/p/691516531)
- [RTS 鼠标边缘视角移动](https://blog.csdn.net/qq_42139931/article/details/128063800)
- [Unity SceneManager 文档](https://docs.unity3d.com/ScriptReference/SceneManagement.SceneManager.html)

---

下一篇:[SLG 工具与基础框架:导表 / 合表 / 多语言 / 手游技术栈](@post/2024-08-10-slg-tools-framework) — 整合自实现基础、工作内容、工具需求、梳理手游基础框架等笔记。
