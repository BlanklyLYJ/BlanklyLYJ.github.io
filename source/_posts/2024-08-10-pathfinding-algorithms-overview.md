---
title: 游戏寻路算法全家桶:从 BFS/DFS 到 A*/JPS/NavMesh/流场/漏斗
date: 2024-08-10 22:00:00
updated: 2024-08-10 22:00:00
tags:
  - 寻路
  - A*
  - JPS
  - NavMesh
  - 流场
  - 漏斗算法
categories:
  - [算法, 寻路]
comments: true
---

> 这是把分散在 12 篇笔记里的"游戏寻路"知识整合到一起,从最基础的 BFS/DFS、Dijkstra,讲到工程上最常用的 A*,再到大规模场景下的 JPS、NavMesh、流场,以及 NavMesh 路径后处理必备的漏斗算法。看完一次就能把整套寻路体系串起来,知道什么场景该选什么。

## 一、基础四件套:BFS / DFS / Dijkstra / Best-First

寻路问题在算法层面就是"图上最短路径"问题,经典四件套必须先理清。

| 算法 | 是否需要终点 | 是否最优 | 思路 | 适用 |
| --- | --- | --- | --- | --- |
| BFS 广度优先 | 否 | 是 | 一层一层铺开 | 终点未知 / 小图 |
| DFS 深度优先 | 否 | 否 | 一条路走到黑 | 不要求最优解 |
| Dijkstra | 否 | 是 | 用累计消耗 g 推进 | 边权不一致 |
| Best-First | 是 | 否 | 用启发值 h 推进 | 迷宫类单路径 |

- **BFS**:每轮把当前层所有子节点加入待搜索队列,稳但慢,空间消耗大。
- **DFS**:每次从队首取一个推进,不撞南墙不回头,最优最差相差极大。
- **Dijkstra**:以"已走消耗 g"为优先级,起点的 g=0,每前进一格累加,如果子节点原 g 比新算出来的大就替换并改父链。当每格距离都是 1 时和 BFS 等价;**距离不均匀**时才显出价值。
- **Best-First(贪心)**:只看 h(到终点的估计距离),迷宫里几乎只有一条路时表现最好,但不保证最优。

<!-- more -->

距离函数的两种选择:

```text
曼哈顿距离:  |x2-x1| + |y2-y1|      // 只能四方向移动
欧几里得距离: sqrt((x2-x1)^2 + (y2-y1)^2)  // 可斜向移动
```

## 二、A*:工程上最常用的折中

A* = Dijkstra(g) + Best-First(h),用 f = g + h 综合判断。

核心结论:

- **h ≤ 实际距离**时,算法**必定找到最优解**;h 越接近实际值,效率越高。
- h > 实际时,效率更高但不保证最优。可以按需求调节"精度 / 性能"权重。
- 必须知道终点的确切位置。

### 伪代码骨架

```text
创建 toSearch = { startNode }
创建 processed = {}    // 已确定最优路径的点,不可回头

while (toSearch.Any())
    current = toSearch 中 F 最小者 (F 相同则取 H 小)
    processed.Add(current); toSearch.Remove(current)

    if current == target:
        沿 Connection 链回溯输出路径

    foreach neighbor of current (可走 且 不在 processed):
        costToNeighbor = current.G + current.GetDistance(neighbor)
        if neighbor 不在 toSearch 或 costToNeighbor < neighbor.G:
            neighbor.SetG(costToNeighbor)
            neighbor.SetConnection(current)
            if 不在 toSearch:
                neighbor.SetH(neighbor.GetDistance(target))
                toSearch.Add(neighbor)
```

### C# 参考实现

```csharp
public static List<NodeBase> FindPath(NodeBase startNode, NodeBase targetNode)
{
    var toSearch = new List<NodeBase>() { startNode };
    var processed = new List<NodeBase>();

    while (toSearch.Any())
    {
        var current = toSearch[0];
        foreach (var t in toSearch)
            if (t.F < current.F || t.F == current.F && t.H < current.H)
                current = t;

        processed.Add(current);
        toSearch.Remove(current);

        if (current == targetNode)
        {
            var path = new List<NodeBase>();
            var tile = targetNode;
            while (tile != startNode)
            {
                path.Add(tile);
                tile = tile.Connection;
            }
            return path;
        }

        foreach (var n in current.Neighbors.Where(t => t.Walkable && !processed.Contains(t)))
        {
            var cost = current.G + current.GetDistance(n);
            var inSearch = toSearch.Contains(n);
            if (!inSearch || cost < n.G)
            {
                n.SetG(cost);
                n.SetConnection(current);
                if (!inSearch)
                {
                    n.SetH(n.GetDistance(targetNode));
                    toSearch.Add(n);
                }
            }
        }
    }
    return null;
}
```

节点抽象层面只需要 G / H / F / Connection / Neighbors:

```csharp
public List<NodeBase> Neighbors { get; protected set; }
public NodeBase Connection { get; private set; }
public float G { get; private set; }
public float H { get; private set; }
public float F => G + H;
```

## 三、JPS:在大网格上把 A* 进一步剪枝

**Jump Point Search(跳点搜索)** 是 A* 在均匀网格上的优化版,核心是"找强制邻居和跳点"。

思路:

1. 地图栅格化,默认斜向与横纵向消耗一致。
2. 从当前点沿 x、y 方向跳跃搜索,遇到**强制邻居**或终点即为**跳点**。
3. 把搜索起点作为跳点的父节点,记入跳点列表。
4. 选 cost 最低的跳点继续,直到找到终点。

优势是显著减少 open list 中的节点数,在大网格上比 A* 快一个数量级。局限是只支持最简单的运动模型,如果有体型限制或斜向 cost 不一致,需要扩展。

## 四、NavMesh:工业级不规则地形寻路

格子表示法在大地图上成本爆炸,真实项目用的是**导航网格 Navigation Mesh**:把可行走区域烘焙成多边形网格,在多边形之间做高层寻路。

Unity 自带 NavMesh 烘焙参数(AI -> Navigation 面板):

| 参数 | 含义 |
| --- | --- |
| Agent Radius | 角色半径,影响距墙极限 |
| Agent Height | 物体高度,决定能否进入缝隙 |
| Max Slope | 最大可行走坡度 |
| Step Height | 可跨越高度(楼梯) |
| Voxel Size | 体素大小(高级选项) |
| Min Region Area | 小于此面积的区域不生成 NavMesh |
| Height Mesh | 保留高度信息,做更精细的踏步处理 |

工程上常用到的扩展:

- **NavObstacle + Carve**:动态阻挡,可以设 `Carve Only Stationary`,只在静止时重算 NavMesh。
- **OffMeshLink**:网格间的手动链接,用于跳跃、传送、上下层。

业界标杆是开源的 [recastnavigation](https://github.com/recastnavigation/recastnavigation),Unity / Unreal 的内置方案基本都是它的工程化封装。

## 五、漏斗算法:NavMesh 路径的"拉直"

A* 在 NavMesh 上找到的是一连串**多边形区域**,而不是光滑路径。把区域序列变成最短折线,就要用**漏斗算法 Funnel Algorithm**。

核心思想:

1. 起点作为漏斗顶点 F,初始化左右极限向量。
2. 沿邻区共边推进,每个新顶点根据它在左/右极限的位置:
   - 同侧更靠外 → 扩张漏斗
   - 同侧更靠内 → 收缩漏斗,更新极限点
   - 越过对侧极限 → 当前对侧极限点必然经过,作为路径拐点加入,漏斗顶点置为该点。
3. 到达最后一个区域后,把 End 与左右极限对比,逐步记录所有漏斗顶点。

判断"点是否在多边形内"用经典的 **PNPoly** 算法。漏斗算法的难点在于**漏斗颠倒**的边界情况,需要重置左右极限边和点。

## 六、流场寻路:RTS 万人同屏的方案

 RTS / MOBA 这类同屏单位极多的场景,如果每个单位独立跑 A*,开销爆炸。**流场(Flow Field)**的思路是:**对每个目标点只算一次路径**,生成全场"指向终点的方向场",之后每个单位查表即可。

典型流程:

1. 从终点反向跑一遍 Dijkstra,生成每个格子到终点的最小消耗 **距离场**。
2. 对每个格子取邻居中消耗最小的方向,生成 **向量场 / 流场**。
3. 单位每帧根据所在格子的向量,微调自己速度方向。

配合 RVO/ORCA 避障就能做到"万人同屏"。星际 2、风暴之门这一类 RTS 的核心寻路都是流场 + NavMesh + 局部避障的组合。

## 七、选型建议

| 场景 | 推荐 |
| --- | --- |
| 小型网格 / 算法练习 | BFS / DFS / Dijkstra |
| 通用角色寻路 | A* |
| 大型均匀网格 | JPS |
| 不规则地形 / 商业项目 | NavMesh + A* + 漏斗 |
| RTS / 万人同屏 | 流场 + NavMesh + RVO 避障 |
| 终点未知 | BFS / Dijkstra(不能用 A*) |

寻路算法的工程价值不在于"会写 A*",而在于知道每个算法的代价模型,在大地图、多单位、动态障碍、特殊地形这些约束下做出合适选型。下一篇会把动态避障(RVO/ORCA)和空间数据结构(四叉树/八叉树/BVH/BSP/k-d 树)单独展开。
