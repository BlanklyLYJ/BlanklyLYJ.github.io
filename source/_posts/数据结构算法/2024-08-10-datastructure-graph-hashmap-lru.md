---
permalink: 2024/08/10/datastructure-graph-hashmap-lru/
title: 图、哈希表与 LRU 缓存:从存储结构到淘汰算法
date: 2024-08-10 22:30:00
updated: 2024-08-10 22:30:00
tags:
  - 数据结构
  - 图
  - HashMap
  - LRU
  - 双向链表
categories:
  - [算法, 数据结构]
comments: true
---

> 这一篇把"非树形结构"的三块整合到一起:图(图的存储 / 遍历 / 应用)、哈希表(冲突解决 / 工程实现)、LRU 缓存(哈希 + 双向链表的经典组合)。这三块都属于"工程上极其常用但容易被低估"的结构,理解原理才能用好标准库,甚至自己写工业级组件。

## 一、图 Graph

### 存储方式

| 方式 | 空间 | 适用 | 备注 |
| --- | --- | --- | --- |
| 邻接矩阵 | O(V²) | 稠密图 | 查边 O(1),空间浪费 |
| 邻接表 | O(V+E) | 稀疏图 | 查边 O(deg(v)) |
| 边集数组 | O(E) | 只关心边 | Kruskal 等 |

游戏 / 路径规划里多数图都是稀疏的,邻接表最常用。

### 遍历

```text
BFS(广度优先):  用队列,适合求无权图最短路径、层级遍历
DFS(深度优先):  用栈 / 递归,适合连通性、拓扑排序、检测环
```

### 常见算法

| 问题 | 算法 |
| --- | --- |
| 单源最短路径(无负权) | Dijkstra |
| 单源最短路径(允许负权) | Bellman-Ford |
| 全源最短路径 | Floyd-Warshall |
| 最小生成树 | Kruskal / Prim |
| 拓扑排序 | DFS / Kahn |
| 强连通分量 | Tarjan / Kosaraju |
| 二分图判定 / 匹配 | 染色法 / 匈牙利算法 |

<!-- more -->

### 工程视角

游戏里的"图"经常不是显式 graph,而是隐式的:

- **网格寻路**:每个格子是节点,四 / 八邻居是边。
- **NavMesh**:多边形是节点,共边是边。
- **任务依赖**:任务为节点,前置关系为边(拓扑排序)。
- **社交关系 / 好友系统**:玩家为节点,好友为边(BFS 找 N 度好友)。

掌握图的核心是"把问题映射到图模型",至于具体算法大部分标准库都有现成实现。

## 二、哈希表 HashMap

### 核心思想

数组 + 哈希函数 + 冲突解决,达到平均 O(1) 的查找 / 插入 / 删除。

```text
put(key, value):
  1. hash = hashFunc(key)
  2. index = hash % array.Length
  3. 把 (key, value) 挂到 array[index] 后面

get(key):
  1. 算出 index
  2. 在 array[index] 的链表里逐个比对 key
```

### 冲突解决

| 方法 | 思路 | 备注 |
| --- | --- | --- |
| 链地址法 | 同 index 的键挂成链表 | Java HashMap 1.8+ 链长 > 8 转红黑树 |
| 开放地址法 | 冲突就找下一个空位 | 线性探查 / 二次探查 / 双哈希 |
| 再哈希 | 用第二个哈希函数 | 减少聚集 |
| 公共溢出区 | 单独维护一个溢出区 | 实现简单 |

### Java HashMap 1.8 关键设计

- 初始容量 16,负载因子 0.75,超过就 rehash × 2。
- 链表长度 ≥ 8 且数组长度 ≥ 64 时,链表转**红黑树**(避免哈希冲突攻击)。
- 红黑树节点 ≤ 6 时退化回链表(避免树化开销)。
- 哈希扰动:`(h = key.hashCode()) ^ (h >>> 16)`,把高位信息混到低位。

### 工程注意

- **键必须正确实现 hashCode / equals**,否则退化成单链表。
- **不要在 foreach 里直接增删 key**,触发 modCount 不一致抛 ConcurrentModificationException。
- **容量预估**:已知大小用 `new HashMap<>(expectedSize / 0.75 + 1)` 避免 rehash。
- **线程安全**:Hashtable 全锁,ConcurrentHashMap 分段锁 / CAS(1.8+),Collections.synchronizedMap 包装锁。

## 三、LRU 缓存:哈希 + 双向链表的经典组合

### 需求

LRU(Least Recently Used,最近最少使用):一个固定容量的缓存,淘汰最久没用的项。

- `get(key)`:命中则返回值,并把这一项移到"最近使用"位置;不命中返回 -1。
- `put(key, value)`:命中则更新并移到最近;不命中则插入,**超容量就淘汰最久未用**。

要求两个操作都 O(1)。

### 数据结构组合

- **哈希表**:`key → 链表节点`,O(1) 定位。
- **双向链表**:维护"最近使用顺序",O(1) 调整。

双向链表使用**伪头 / 伪尾哨兵节点**省去边界判断:

```text
[head] <-> [最近使用 ... 最久未用] <-> [tail]
   ↑                                      ↑
   新插入点                              淘汰点
```

### C# 完整实现

```csharp
public class DLinkedNode
{
    public string key;
    public int value;
    public DLinkedNode prev;
    public DLinkedNode next;

    public DLinkedNode() { }
    public DLinkedNode(string k, int v) { key = k; value = v; }
}

public class LRUCache
{
    private readonly int capacity;
    private readonly Dictionary<string, DLinkedNode> cache;
    private readonly DLinkedNode head, tail;   // 伪头尾
    private int size;

    public LRUCache(int capacity)
    {
        this.capacity = capacity;
        cache = new Dictionary<string, DLinkedNode>();
        head = new DLinkedNode();
        tail = new DLinkedNode();
        head.next = tail;
        tail.prev = head;
        size = 0;
    }

    public int Get(string key)
    {
        if (!cache.ContainsKey(key)) return -1;
        var node = cache[key];
        MoveToHead(node);
        return node.value;
    }

    public void Put(string key, int value)
    {
        if (cache.ContainsKey(key))
        {
            var node = cache[key];
            node.value = value;
            MoveToHead(node);
        }
        else
        {
            if (size == capacity)
            {
                var removed = RemoveTail();
                cache.Remove(removed.key);
                size--;
            }
            var newNode = new DLinkedNode(key, value);
            cache.Add(key, newNode);
            AddToHead(newNode);
            size++;
        }
    }

    private void AddToHead(DLinkedNode node)
    {
        node.prev = head;
        node.next = head.next;
        head.next.prev = node;
        head.next = node;
    }

    private void RemoveNode(DLinkedNode node)
    {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    private void MoveToHead(DLinkedNode node)
    {
        RemoveNode(node);
        AddToHead(node);
    }

    private DLinkedNode RemoveTail()
    {
        var res = tail.prev;
        RemoveNode(res);
        return res;
    }
}
```

### 工程变体

| 变体 | 思路 | 场景 |
| --- | --- | --- |
| LFU | 淘汰访问频率最低的 | Redis 4.0+ |
| ARC | LRU + LFU 自适应 | 数据库缓存 |
| FIFO | 先进先出 | 简单场景 |
| 2-LRU | 两个 LRU 队列分级 | 高命中率缓存 |
| TinyLFU | 频率素描 + LRU | Caffeine |

## 四、为什么哈希 + 链表这套组合这么常见

LRU 不是唯一应用。所有"既要 O(1) 查找又要维护某种顺序"的场景,几乎都是这个组合:

- **LinkedHashMap(Java)**:本质就是 HashMap + 双向链表,默认按插入序,可设为按访问序(就是 LRU)。
- **Redis zset**:跳表 + 哈希,逻辑类似。
- **数据库 Buffer Pool**:页号 → 帧,LRU 链表。
- **CPU Cache**:硬件级 LRU。
- **HTTP 缓存**:URL → 响应,LRU / LFU。

理解哈希 + 链表,等于掌握了一大半"内存数据结构"的本质。

## 五、华容道问题:状态空间搜索

顺便提一个有趣的例子:华容道问题本质上也是图 + 数据结构的应用。

- **节点** = 棋盘的一个状态(每个棋子的位置组合)。
- **边** = 一次合法移动。
- **目标** = 从初始状态到"曹操出口"状态的路径。

解法:**BFS + 哈希去重**。把每个状态序列化为字符串作为哈希 key,避免重复访问。状态数有限(虽然巨大),BFS 必然能找到最短解。

类似的思路可用于:八数码、魔方求解、推箱子。这种"状态空间搜索"是图算法的经典应用。

## 六、小结

| 结构 | 优势 | 劣势 | 适用 |
| --- | --- | --- | --- |
| 邻接表图 | 稀疏图高效 | 查边需遍历邻接点 | 网络、寻路、依赖 |
| HashMap | O(1) 综合 | 无序、内存浪费 | 缓存、kv 存储 |
| 双向链表 | 删除 O(1) | 内存开销大 | 维护顺序 |
| HashMap + 双向链表 | O(1) + 有序 | 实现复杂 | LRU / LFU / 访问序表 |

下一篇会切换到排序与模糊搜索,把更"算法味"的内容(KMP、快速排序、插入排序等)和这些数据结构联系起来。
