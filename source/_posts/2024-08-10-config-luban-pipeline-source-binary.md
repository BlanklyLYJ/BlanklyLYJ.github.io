---
title: luban 导表体系:配置管线、源码剖析与二进制读取
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - Unity
  - luban
  - 配置
  - 导表
  - 反射
categories:
  - [工具, 配置]
comments: true
---

> luban 是国内游戏圈最常用的配置导表工具,把 Excel/CSV 转成多语言代码 + 二进制/JSON/protobuf 数据。这一篇整合了 luban 的基础概念、源码导表流程、二进制表反射读取三块内容,目标是看完能回答:luban 怎么工作、源码长什么样、运行时怎么把二进制读出来用。

## 一、luban 解决什么问题

游戏配置传统上有几个痛点:

- **Excel 是策划的母语**:策划在 Excel 里改数值,程序不想手工同步代码
- **多端共用**:客户端(C#/Lua)、服务端(C++/Go/Python)都要读同一份配置
- **类型丰富**:不只 K-V,还有 list、map、嵌套结构、多语言文本
- **数据校验**:引用关系、必填项、类型检查

luban 把 Excel 定义成 Schema(类似 protobuf),然后:

1. **生成代码**:每个表对应一个强类型 Class,字段、属性、嵌套类型一应俱全
2. **导出数据**:二进制(bytes)、JSON、Lua、XML、protobuf 等格式可选
3. **运行时加载**:生成的代码 + 数据格式形成完整闭环

<!-- more -->

## 二、典型工作流

```
Excel (.xlsx)  ──┐
                │
Defines (.bbl) ─┼──► luban CLI ──► 代码 (cs/lua/go/cpp/...)
                │              ──► 数据 (bytes/json/lua/...)
conf (luban.conf) ─┘
```

- **Excel**:策划填写实际数据
- **Defines**:类型定义(类似 protobuf 的 .proto),声明表结构和导出规则
- **luban.conf**:全局配置,指定输入输出路径、目标语言、数据格式
- **生成的代码**:运行时强类型访问
- **生成的数据**:运行时反序列化加载

## 三、Schema 与导表规则

luban 支持丰富的类型系统:

| 类型 | 写法 | 说明 |
|---|---|---|
| 基础 | `int`, `long`, `float`, `string`, `bool` | 内置 |
| 容器 | `list,int`、`map,int,int` | 列表/字典 |
| 嵌套 | `TbItem` 引用其它表 | 表间引用 |
| 多语言 | `text` | 多语言 key,自动关联 string 表 |
| 枚举 | `enum` | 整型枚举 |
| 可空 | `int?` | 可空类型 |

特殊导出规则示例:

```
# 列表用 int[][]
map<int,int> 字段
```

支持复杂结构是 luban 比手撸 Excel 解析器的核心优势。

## 四、源码导表流程

luban 入口在 `Program.Main`:

```csharp
// Program.cs 简化版
public static void Main(string[] args)
{
    var opts = ParseOptions(args);
    AddCustomTemplateDirs(opts.CustomTemplateDirs);

    // 创建导出管线
    var pipeline = PipelineManager.Ins.CreatePipeline(opts.Pipeline);

    // 执行
    pipeline.Run(CreatePipelineArgs(opts));
}
```

管线分三段:

1. **LoadSchema**:加载所有表数据
2. **PrepareGenerationContext**:准备生成上下文
3. **ProcessTargets**:多 Task 并发导出

### LoadSchema 阶段

```csharp
// 加载 define 文件
LoadSchema();

// 校验属性合法性
XmlSchemaUtil.ValidAttrKeys(...);

// 加载所有表格 title
LoadTableValueTypeSchemasFromFile();

// 创建程序集 _rawAssembly
_rawAssembly = ...;
```

define 文件是类型定义层,可以是 `.bbl` 或 Excel 的 define 表。`_rawAssembly` 是动态生成的 C# 代码编译产物,运行时反射使用。

### PrepareGenerationContext 阶段

```csharp
_defAssembly = new DefAssembly(_rawAssembly, _args.Target, _args.OutputTables);
// 内部解析表格 title、参数、引用
```

`DefAssembly` 是核心类,负责:

- 解析 title(列头)
- 解析参数
- 处理引用关系(`ParseRefString`)

`RawDefs` 是 `luban.conf` 的解析类,记录所有原始定义。

### ProcessTargets 阶段

```csharp
// 多 Task 并发
ProcessTargets();
```

每个 Target 对应一个输出目标(C# 客户端 / Lua 客户端 / Go 服务端 / ...)。`CodeTargetBase` 决定代码导出形式,`UnderlyingDeclaringTypeNameVisitor` 负责基础类型名称映射。

### 数据收集

```csharp
// DataLoaderManager
DataLoaderManager.Ins.LoadTableFile(...);  // 收集 Excel 原始数据
TableDataInfo.BuildIndexs(...);             // 整合 title
```

`DefaultSchemaCollector` 是默认的收集器实现,可替换为自定义逻辑。

## 五、生成的代码长什么样

假设有一张 `TbItem` 表,luban 生成的 C# 代码大致结构:

```csharp
public partial class TbItem : BaseTable
{
    // 内部数据字典(luban 生成的具体类型)
    private Dictionary<int, ItemX> _dataMap;

    // 通过 key 获取
    public ItemX Get(int id) => _dataMap.TryGetValue(id, out var v) ? v : null;

    // 全部数据
    public Dictionary<int, ItemX> DataList => _dataMap;
}

public partial class ItemX
{
    public int Id;
    public string Name;
    public int Price;
    public List<int> Rewards;
    // ...
}
```

`BaseTable` 是所有表的基类,提供统一接口。`_dataMap` 是私有字段,从二进制反序列化而来。

## 六、运行时反射:读取二进制表

某些场景下不能直接用生成的代码(比如编辑器扩展想做通用表格浏览),就需要反射读取。下面这段代码遍历所有表,找含中文的字段:

```csharp
private void LoadTableData()
{
    _needCorrectDictionary.Clear();
    PbManagerEditor.Initialize();
    Tables tables = PbConfigManager.GetTables();        // 加载所有表
    Type type = tables.GetType();

    // 遍历每个表属性(TbItem, TbHero, ...)
    foreach (var memberInfo in type.GetProperties(
        BindingFlags.Public | BindingFlags.Instance))
    {
        if (memberInfo.Name == "TbChatMask"
         || memberInfo.Name == "TbChatMaskRegex")
            continue;

        BaseTable tableObj = (BaseTable)memberInfo.GetValue(tables);
        Type tableType = tableObj.GetType();

        // 反射拿私有字段 _dataMap
        FieldInfo fieldInfo = tableType.GetField("_dataMap",
            BindingFlags.NonPublic | BindingFlags.Instance);
        if (fieldInfo == null) continue;

        object dataMap = fieldInfo.GetValue(tableObj);
        Type dictType = dataMap.GetType();

        // 字典不能直接 foreach(类型未知),用反射调 GetEnumerator
        MethodInfo getEnumerator = dictType.GetMethod("GetEnumerator");
        IEnumerator enumerator = (IEnumerator)getEnumerator.Invoke(dataMap, null);

        while (enumerator.MoveNext())
        {
            var kvp = enumerator.Current;
            Type kvpType = kvp.GetType();

            // KeyValuePair 的 Key / Value
            PropertyInfo keyProp = kvpType.GetProperty("Key");
            PropertyInfo valueProp = kvpType.GetProperty("Value");
            object valueSource = valueProp.GetValue(kvp, null);

            // 遍历 Value 的所有公共字段
            FieldInfo[] fields = valueSource.GetType().GetFields(
                BindingFlags.Public | BindingFlags.Instance);
            foreach (FieldInfo field in fields)
            {
                if (field.FieldType != typeof(string)) continue;
                string value = (string)field.GetValue(valueSource);
                if (!ToolUtil.ContainsChinese(value)) continue;

                // 记录含中文字段
                if (!_needCorrectDictionary.TryGetValue(
                    memberInfo.Name, out var list))
                {
                    list = new List<string>();
                    _needCorrectDictionary[memberInfo.Name] = list;
                }
                if (!list.Contains(field.Name)) list.Add(field.Name);
            }
        }
    }
}
```

### 反射读取的关键点

| 难点 | 解法 |
|---|---|
| `_dataMap` 是私有字段 | `GetField` + `BindingFlags.NonPublic` |
| 字典泛型类型未知 | 反射 `GetEnumerator`,不直接强转 |
| `KeyValuePair` 类型未知 | 反射 `Key` / `Value` 属性 |
| 字段遍历 | `GetFields` + `BindingFlags.Instance` |

这套思路也适用于:

- 编辑器表格浏览工具
- 配置检查脚本(找空值、找重复 key、找含中文应改用多语言)
- 自动生成文档

## 七、导表工具链的工程化

实际项目中,luban 只是核心,周边还要配:

### 锁表机制

多人协作时,有人改表、有人想导出会冲突。理想流程:

1. 改表前锁(`svn lock -m "..."`)
2. 改完解锁或自动随 commit 解锁
3. 锁状态对所有人可见

实践方案(SVN):

```bash
svn lock -m "lockmessage" [--force] table.xlsx
# 修改...
svn commit table.xlsx   # 自动解锁
```

更进阶可以做飞书机器人通知:谁锁了哪张表,改了什么,推送到群里。

### 提交按钮(Unity 编辑器内)

在 Unity 编辑器里给策划一个按钮,点一下完成:

1. 收集指定文件夹变更
2. 打开 SVN 提交界面

```csharp
// 伪代码
[MenuItem("Tools/提交表格")]
static void CommitTables()
{
    var changes = SVNUtil.CollectChanges("Assets/Tables/");
    SVNUtil.OpenCommitWindow(changes);
}
```

不需要单独的应用,Unity 编辑器扩展足够。

### 多语言检查

多语言表往往有"同 key 不同语言"的问题。导出后用工具检查:

```
language 表: key | cn | en | tw
string   表: id  | content
```

遍历所有 string 字段,与 language 表对齐,列出遗漏或重复。这一步可以挂到 luban 后处理钩子。

## 八、特殊导出规则示例

luban 支持表格的特殊导出规则:

```
# 列表用 int[][]
map<int,int> 字段
```

通过 define 里的类型注解实现。常见技巧:

- **嵌套 list**:`list,list,int` 表示二维数组
- **map 容器**:`map,int,TbItem` 嵌套引用
- **可空字段**:`int?`,序列化时省略
- **默认值**:`int:0`,空值填充

这些规则让 Excel 表达能力接近 protobuf,远超普通 K-V 配置。

## 九、luban vs 其它方案

| 工具 | 优势 | 劣势 |
|---|---|---|
| **luban** | 类型丰富、多语言、社区活跃 | 学习曲线、配置稍复杂 |
| **Excel-Reactor** | Unity 集成好 | 单语言,跨端弱 |
| **cathei.configgen** | 轻量 | 功能少 |
| **手撸** | 完全可控 | 维护成本爆炸 |

中大型项目几乎必然选 luban 或类似工具。

## 十、小结

| 概念 | 关键 |
|---|---|
| 工作流 | Excel + Defines + luban.conf → 代码 + 数据 |
| 三段管线 | LoadSchema / PrepareContext / ProcessTargets |
| 多 Target | 一个表导出多语言、多格式 |
| 运行时反射 | 私有 `_dataMap` + `GetEnumerator` |
| 工程化 | 锁表、提交按钮、多语言检查 |

luban 把"配置"从"代码 + Excel"提升到"Schema + Data",这一步抽象让游戏配置系统接近工业级。理解它的源码与运行时反射,意味着能做任何定制化的配置工具链。

## 参考

- [luban 官方仓库](https://github.com/focus-creative-games/luban)
- [luban 文档](https://luban.docs.l4ph.com)

---

下一篇:[JSON 与 XML 序列化对比](#) — 整合自 json 语法规则、jsonMapper 解析、xml 语法/操作/标签相关笔记。
