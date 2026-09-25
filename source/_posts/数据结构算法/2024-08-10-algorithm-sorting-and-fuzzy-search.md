---
permalink: 2024/08/10/algorithm-sorting-and-fuzzy-search/
title: 排序算法与模糊搜索:从快排插排到 KMP 字符串匹配
date: 2024-08-10 23:00:00
updated: 2024-08-10 23:00:00
tags:
  - 算法
  - 排序
  - 快速排序
  - KMP
  - 字符串匹配
  - 模糊搜索
categories:
  - [算法, 数据结构]
comments: true
---

> 这一篇把"算法味"最浓的两块整合:排序(快排、插排为核心)和字符串 / 模糊搜索(KMP / 编辑距离 / 莱文斯坦 / Soundex / Trie)。这两块看起来基础,但它们是工程上"出现频率最高"的算法:任何列表 UI 都要排序,任何搜索框都要模糊匹配。

## 一、排序算法全家桶

### 复杂度与特性对比

| 算法 | 平均时间 | 最坏时间 | 空间 | 稳定性 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 冒泡 | O(n²) | O(n²) | O(1) | 稳定 | 教学 |
| 选择 | O(n²) | O(n²) | O(1) | 不稳定 | 教学 |
| 插入 | O(n²) | O(n²) | O(1) | 稳定 | 小数据 / 近似有序极快 |
| 希尔 | O(n log² n) | O(n⁴/³) | O(1) | 不稳定 | 插排改进 |
| 归并 | O(n log n) | O(n log n) | O(n) | 稳定 | 稳定且最坏可控 |
| 快排 | O(n log n) | O(n²) | O(log n) | 不稳定 | 综合最快 |
| 堆排 | O(n log n) | O(n log n) | O(1) | 不稳定 | 内存友好 |
| 计数 / 桶 | O(n+k) | O(n+k) | O(k) | 稳定 | 整数 / 范围已知 |
| 基数 | O(d·n) | O(d·n) | O(n+d) | 稳定 | 字符串 / 多关键字 |

<!-- more -->

### 快速排序:工程默认

思路:取一个**中心点 pivot**,把剩余数据按"小于 / 大于 pivot"分到两边,指针从前后同时扫描,重合位置留给 pivot,然后对左右子序列递归。

```csharp
public static void QuickSort(int[] arr, int left, int right)
{
    if (left >= right) return;

    int pivot = arr[(left + right) / 2];
    int i = left, j = right;
    while (i <= j)
    {
        while (arr[i] < pivot) i++;
        while (arr[j] > pivot) j--;
        if (i <= j)
        {
            (arr[i], arr[j]) = (arr[j], arr[i]);
            i++; j--;
        }
    }

    QuickSort(arr, left, j);
    QuickSort(arr, i, right);
}
```

平均时间 O(n log n),空间 O(log n)(递归栈)。

**为什么工程默认快排**:虽然最坏 O(n²),但常数因子最小、对缓存友好,实际跑起来比归并、堆都快。配合三数取中、随机化 pivot、小数组切到插排,几乎可以避免最坏情况。

### 插入排序:扑克牌排序

思路:数组前半段是已排序队列,后半段未排序。从未排序区拿一个值,跟前面挨个比,比它大的往后挪一位,直到找到合适位置插入。

```csharp
public static void InsertionSort(int[] arr)
{
    for (int i = 1; i < arr.Length; i++)
    {
        int key = arr[i];
        int j = i - 1;
        while (j >= 0 && arr[j] > key)
        {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = key;
    }
}
```

**插排的隐藏价值**:在**近似有序**的数据上接近 O(n),这让它成为很多高级排序算法的"小数组兜底"。Java Arrays.sort、C++ std::sort 在子数组 < 16 / 32 时都切到插排。

### 选择排序的工程位置

工程上很少单独用,但它的思想"每轮选最小"出现在**TopK 问题**里:维护大小为 K 的最小堆 / 最大堆,O(n log K) 求第 K 大 / 小。

## 二、排序的工程坑

- **稳定性**:相同 key 元素相对顺序不变。归并、插排、冒泡、计数稳定;快排、堆、选择不稳定。
- **多字段排序**:先按次要字段排,再按主要字段排(必须用稳定排序)。或者用 comparator 链式比较。
- **对象排序**:不要用对象本身比较,而是用 comparator 抽离字段,避免对象重建。
- **并行排序**:大数组用 ForkJoin / Parallel.ForEach 切块并行。
- **特殊场景**:
  - 整数且范围小:计数排序。
  - 字符串数组:基数排序 / 多键排序。
  - 内存受限:外部归并排序。

## 三、字符串匹配:从暴力到 KMP

### 暴力匹配 O(n·m)

```text
for i = 0 to n - m:
    j = 0
    while j < m and text[i+j] == pat[j]: j++
    if j == m: return i
```

每次失配,主串指针回退到 i+1,模式串回退到 0。最坏 O(n·m)。

### KMP:O(n + m)

KMP 的核心:**预处理模式串,得到 next 数组**,失配时模式串指针不回退,而是跳到 next[j] 位置,跳过已经匹配过的前缀。

#### next 数组的含义

`next[j]` = 模式串 `pat[0..j-1]` 的"最长相等前后缀长度"。

例如 `pat = "ABAB"`:

| j | pat[0..j-1] | 最长相等前后缀 | next[j] |
| --- | --- | --- | --- |
| 0 | "" | / | -1 |
| 1 | "A" | 0 | 0 |
| 2 | "AB" | 0 | 0 |
| 3 | "ABA" | "A" 1 | 1 |
| 4 | "ABAB" | "AB" 2 | 2 |

#### 构造 next 数组

```csharp
int[] BuildNext(string pat)
{
    int[] next = new int[pat.Length];
    next[0] = -1;
    int k = -1, j = 0;
    while (j < pat.Length - 1)
    {
        if (k == -1 || pat[j] == pat[k])
        {
            k++; j++;
            next[j] = (pat[j] == pat[k]) ? next[k] : k;  // 优化版
        }
        else
        {
            k = next[k];
        }
    }
    return next;
}
```

#### 主匹配流程

```csharp
int KmpSearch(string text, string pat)
{
    int[] next = BuildNext(pat);
    int i = 0, j = 0;
    while (i < text.Length && j < pat.Length)
    {
        if (j == -1 || text[i] == pat[j])
        {
            i++; j++;
        }
        else
        {
            j = next[j];   // 模式串指针跳跃,主串不动
        }
    }
    return j == pat.Length ? i - j : -1;
}
```

#### KMP 的工程价值

- 主串指针不回退,适合**流式数据**(网络、文件大对象)。
- 失配时跳跃而非回退,在长模式串上比暴力快得多。
- 思想扩展到 **AC 自动机**(多模式串匹配)、**后缀自动机**(子串统计)。

## 四、模糊搜索:不只是精确匹配

实际产品的搜索框往往不是精确匹配:用户拼错、漏字、记不清。需要"模糊"匹配。

### 4.1 编辑距离(Levenshtein Distance)

两个字符串 A、B 的编辑距离 = 把 A 变成 B 所需的最少操作(插入、删除、替换)。

动态规划,O(m·n):

```text
dp[i][j] = min(
    dp[i-1][j]   + 1,        // 删除
    dp[i][j-1]   + 1,        // 插入
    dp[i-1][j-1] + (A[i] != B[j] ? 1 : 0)   // 替换 / 不变
)
```

应用:拼写检查、命令纠错、搜索引擎的"你是不是想找: ..."。

### 4.2 Trie 字典树:前缀匹配

把所有候选词插入 Trie,用户输入前缀,沿 Trie 走到对应节点,子树即所有候选。

```csharp
class TrieNode
{
    public Dictionary<char, TrieNode> children = new();
    public bool isEnd;
}

class Trie
{
    private TrieNode root = new();

    public void Insert(string word)
    {
        var node = root;
        foreach (var c in word)
        {
            if (!node.children.ContainsKey(c))
                node.children[c] = new TrieNode();
            node = node.children[c];
        }
        node.isEnd = true;
    }

    public bool StartsWith(string prefix, out List<string> results)
    {
        results = new List<string>();
        var node = root;
        foreach (var c in prefix)
        {
            if (!node.children.ContainsKey(c)) return false;
            node = node.children[c];
        }
        // DFS 收集所有子树
        Dfs(node, prefix, results);
        return true;
    }

    private void Dfs(TrieNode node, string cur, List<string> res)
    {
        if (node.isEnd) res.Add(cur);
        foreach (var kv in node.children)
            Dfs(kv.Value, cur + kv.Key, res);
    }
}
```

应用:自动补全、IP 路由最长前缀匹配、汉字输入法候选词。

### 4.3 Soundex / 拼音相似度

Soundex 把单词编码成"字母 + 三位数字",同发音单词编码相同。中文场景下用**拼音 + Soundex** 做相似匹配,比如"刘备"和"留备"能匹配上。

### 4.4 N-gram 索引

把词拆成 N 字符滑窗(如 2-gram:"刘" → "刘备" → "刘备的字"),建立 `gram → 词列表` 的倒排索引。搜索时,对 query 拆 gram,查倒排,合并候选 + 按相似度排序。

应用:数据库全文索引(Elasticsearch 的 Lucene 底层就是这种思路)。

## 五、组合方案:实际项目的模糊搜索

| 场景 | 推荐方案 |
| --- | --- |
| 命令 / 配置项精确补全 | Trie 前缀匹配 |
| 拼写纠错 | 编辑距离 + 词频 |
| 中文姓名模糊匹配 | 拼音 + Soundex |
| 大规模文本搜索 | 倒排索引(N-gram + TF-IDF) |
| 海量商品搜索 | ES + 同义词词典 + 业务权重 |
| 代码符号跳转 | 子序列匹配(fuzzy matcher) |

## 六、数据结构和算法的衔接

排序 + 模糊搜索都依赖前面讲过的数据结构:

- **快速排序**依赖"分治"思想,本质和树的递归同源。
- **插入排序**依赖有序数组,本质是线性表 + 二分查找。
- **KMP next 数组**本质是字符串的"自匹配",和后缀结构、Trie 树思想相通。
- **Trie** 是树的特例,字符为边的多叉树。
- **编辑距离**是动态规划,DP 表和图最短路径(Floyd / Dijkstra)同源。

## 七、面试要点速记

- 快排:O(n log n) 平均,O(n²) 最坏,空间 O(log n),不稳定,工程默认。
- 插排:O(n²),近似有序接近 O(n),稳定,小数组兜底首选。
- 归并:O(n log n) 稳定可控,空间 O(n),外排序 / 链表排序唯一选择。
- 堆排:O(n log n) 最坏可控,空间 O(1),TopK / 优先队列。
- KMP 核心:**next 数组** + 主串指针不回退。
- 编辑距离 = DP,操作 = 插入 / 删除 / 替换。
- Trie 前缀匹配 O(L),L = 词长。
- 工程模糊搜索 = 倒排索引 + 编辑距离 + 业务权重。

到此,从树、图、哈希到排序、模糊搜索的数据结构与算法整合就完整了。把这些"基础"吃透,90% 的工程问题和面试题都不会再是问题。
