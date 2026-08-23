---
title: 配置序列化:JSON 与 XML 的语法、解析与选型
date: 2024-08-10 24:00:00
updated: 2024-08-10 24:00:00
tags:
  - 配置
  - JSON
  - XML
  - 序列化
  - C#
categories:
  - [工具, 配置]
comments: true
---

> JSON 和 XML 是配置与数据交换的两套老牌方案。luban 适合规则化数值表,而配置文件、外部协议、可视化数据往往仍走 JSON 或 XML。这一篇把两种格式的语法规则、C# 解析 API、序列化套路串起来,顺便讨论选型。

## 一、数据存储回顾:值类型与引用类型

理解序列化之前,先回顾 .NET 的内存模型。类型分两种:

| 类型 | 存储 | 例子 |
|---|---|---|
| 值类型 | 单段内存(实际数据,通常栈上) | `int`, `bool`, `struct`, `char`, `float` |
| 引用类型 | 两段内存(堆数据 + 栈引用) | `string`, 数组, 自定义类 |

引用类型赋值赋的是引用地址。所以两个变量指向同一对象,改一个另一个也变。GC 通过引用计数判断堆对象是否可回收。

序列化的本质:**把堆上的对象图压平成字节流或文本**,反过来再重建对象图。JSON 和 XML 是两种文本序列化方案。

<!-- more -->

## 二、JSON 语法规则

JSON 的核心规则:

- 数据在键值对中:`"key": value`
- 数据由逗号分隔
- 花括号 `{}` 保存对象
- 中括号 `[]` 保存数组

```json
{
  "xx": {
    "ss": "vv",
    "cc": {},
    "bb": ["1", "2", "3"]
  }
}
```

JSON 类型系统精简:仅 string / number / boolean / null / object / array。没有日期类型,没有注释(虽然有些扩展支持 `//`)。

## 三、JSON 解析:LitJson JsonMapper

Unity 项目里常见 LitJson 库,核心 API:

```csharp
// 字符串 → JsonData(动态对象)
JsonData data = JsonMapper.ToObject(File.ReadAllText("skill.json"));

// 数组遍历
foreach (JsonData item in data)
{
    JsonData id = item["id"];
    JsonData name = item["name"];
    JsonData damage = item["damage"];

    int i = Int32.Parse(id.ToString());
    int d = Int32.Parse(damage.ToString());
    Console.WriteLine($"{i}:{name}:{d}");
}
```

`JsonData` 是动态类型,索引器访问字段。优点灵活,缺点是没有类型检查,容易拼写错误。

### 泛型解析(强类型)

```csharp
// 反序列化为数组
Skill[] arr = JsonMapper.ToObject<Skill[]>(File.ReadAllText("skill.json"));

// 反序列化为 List
List<Skill> list = JsonMapper.ToObject<List<Skill>>(File.ReadAllText("skill.json"));

// 序列化
string json = JsonMapper.ToJson(myObject);
```

强类型方案编译期发现错误,推荐生产代码使用。

### JsonMapper vs Newtonsoft.Json

| 维度 | LitJson | Newtonsoft.Json (Json.NET) |
|---|---|---|
| 体积 | 小 | 大 |
| 性能 | 中 | 高(流式) |
| 功能 | 基础 | LINQ、属性控制、动态 |
| Unity 友好 | 是 | 是(需手动安装) |

中大型项目几乎都换到 Newtonsoft.Json,LitJson 适合轻量场景。

## 四、XML 语法规则

XML 比 JSON 严格:

- **必须有关闭标签**:`<p>xxx</p>`
- **大小写敏感**:`<p>` 与 `<P>` 不同
- **必须正确嵌套**:`<b><i>??</i></b>`(不能交叉)
- **必须有根元素**:整个文档一个根
- **属性值必须加引号**:`attr="value"`

```xml
<root>
  <child>
    <xxx></xxx>
  </child>
</root>
```

### XML 元素命名规则

1. 名称可含字母、数字及其他字符
2. 不能以数字或标点开头
3. 不能以 `xml`(任何大小写)开头
4. 不能包含空格

XML 比 JSON 的优势:**属性 + 元素双重表达**,可以同时写元信息和数据。劣势:体积大、解析复杂。

## 五、XML 解析:XmlDocument

C# 的 `System.Xml.XmlDocument` 是 DOM 风格解析器,把整个 XML 加载到内存树:

```csharp
XmlDocument doc = new XmlDocument();
// 从文件加载
doc.Load("skillInfo.xml");
// 或从字符串加载
doc.LoadXml(File.ReadAllText("skillInfo.xml"));

// 获取根节点
XmlNode rootNode = doc.FirstChild;
XmlNodeList nodeList = rootNode.ChildNodes;

List<Skill> skillList = new List<Skill>();
foreach (XmlNode temp in nodeList)
{
    Skill skill = new Skill();
    XmlNodeList fieldNodes = temp.ChildNodes;
    foreach (XmlNode field in fieldNodes)
    {
        if (field.Name == "id")
        {
            skill.Id = Int32.Parse(field.InnerText);
        }
        else if (field.Name == "name")
        {
            skill.Name = field.InnerText;
            // 属性访问
            skill.Property = field.Attributes[0].Value;
        }
        else
        {
            skill.Damage = Int32.Parse(field.InnerText);
        }
    }
    skillList.Add(skill);
}
```

### 关键 API

| API | 用途 |
|---|---|
| `Load(path)` / `LoadXml(str)` | 加载 |
| `FirstChild` | 根节点 |
| `ChildNodes` | 子节点列表 |
| `InnerText` | 节点文本 |
| `Attributes[i].Value` | 属性值 |
| `SelectNodes(xpath)` | XPath 查询 |

### XmlReader vs XmlDocument

`XmlDocument` 是 DOM,整树加载。`XmlReader` 是流式,逐节点读:

| 风格 | 优势 | 劣势 |
|---|---|---|
| DOM (`XmlDocument`) | 随机访问、修改 | 内存大 |
| 流式 (`XmlReader`) | 内存小、性能高 | 只能前向、不能改 |

大文件(几十 MB)用 XmlReader,小配置用 XmlDocument。

## 六、JSON vs XML 选型

| 维度 | JSON | XML |
|---|---|---|
| 体积 | 小 | 大(标签冗余) |
| 可读性 | 简洁 | 详细 |
| 类型系统 | 简单 | 复杂(属性、命名空间) |
| 解析速度 | 快 | 慢 |
| 注释 | 不支持(扩展支持) | 支持(`<!-- -->`) |
| 跨语言 | 几乎所有语言 | 几乎所有语言 |
| 适用场景 | API、配置 | 文档、复杂结构 |

游戏配置里 JSON 更主流。XML 适合需要 Schema 校验、属性元数据的场景。

## 七、序列化与反序列化模式

无论 JSON 还是 XML,通用模式都是:

```csharp
// 序列化
string text = Serializer.Serialize(obj);
File.WriteAllText(path, text);

// 反序列化
string text = File.ReadAllText(path);
T obj = Serializer.Deserialize<T>(text);
```

C# 内置 `System.Text.Json` 或 `DataContractSerializer` 可直接用:

```csharp
// System.Text.Json
using System.Text.Json;

string json = JsonSerializer.Serialize(skill);
Skill obj = JsonSerializer.Deserialize<Skill>(json);

// DataContractSerializer (XML)
using System.Runtime.Serialization;
using System.Xml;

var serializer = new DataContractSerializer(typeof(Skill));
using var writer = XmlWriter.Create("skill.xml");
serializer.WriteObject(writer, skill);
```

属性控制:

```csharp
[DataContract]
public class Skill
{
    [DataMember(Name = "id")]
    public int Id { get; set; }

    [DataMember(Name = "name")]
    public string Name { get; set; }

    [IgnoreDataMember]
    public string Internal;   // 不序列化
}
```

## 八、完整性校验:MD5 与 hash

配置/资源下载时,完整性校验离不开哈希。**MD5(Message-Digest Algorithm 5)** 把任意输入压成 128 位哈希,通常表示为 32 位十六进制串。

### MD5 算法步骤

1. **分组**:输入按 512 位(64 字节)分组,不足填充
2. **初始化**:4 个 32 位寄存器 A、B、C、D
3. **处理**:每个 512 位分组经过四轮循环,每轮含位运算、逻辑函数、非线性操作
4. **输出**:缓冲区最终值为 128 位哈希

### 雪崩效应

输入任一位变化,输出显著不同。这让 MD5 适合:

- 数据完整性校验
- 数字签名
- 密码存储(早期,现已不推荐)

### 安全提醒

MD5 存在碰撞攻击和预图攻击,**不再适合高安全场景**。需要密码学安全应使用 SHA-256 / SHA-3。但作为完整性校验(防下载错误)仍然够用。

```csharp
using System.Security.Cryptography;

public static string MD5Hex(byte[] bytes)
{
    using var md5 = MD5.Create();
    byte[] hash = md5.ComputeHash(bytes);
    return BitConverter.ToString(hash).Replace("-", "").ToLower();
}
```

配置热更的常见流程:

```
远端 manifest(含 md5) ──► 对比本地 md5 ──► 不一致则下载
```

## 九、数据类型与序列化的关系

不同类型在序列化中的处理:

| 类型 | JSON | XML |
|---|---|---|
| 值类型(int 等) | 直接数字 | 文本 |
| string | 带引号 | 标签或属性 |
| 数组/list | `[]` | 重复标签 |
| 字典/map | `{}` | 重复标签 + 属性 key |
| 嵌套对象 | 嵌套 `{}` | 嵌套标签 |
| null | `null` 字面量 | 省略标签 |

序列化要解决的几个常见问题:

- **循环引用**:A 引 B,B 引 A,默认序列化会无限递归。解决:用 `[IgnoreDataMember]` 标记一边,或使用支持引用的序列化器(`PreserveObjectReferences`)
- **多态**:子类序列化为父类,反序列化时丢失类型。解决:类型信息写入数据(`$type` 字段)
- **版本兼容**:字段增删。解决:用可空、默认值、`[OnDeserialized]` 回调补全

## 十、实战选型建议

| 场景 | 推荐 |
|---|---|
| 游戏数值表 | luban(二进制) |
| 用户存档 | JSON(Newtonsoft) |
| 工具配置 | JSON 或 YAML |
| 跨服务协议 | protobuf |
| 文档型数据 | XML |
| 资源清单 | 自定义文本 + hash 校验 |

JSON 在 90% 配置场景胜出。XML 留给传统系统对接和需要 Schema 校验的严肃场景。

## 十一、小结

| 概念 | 要点 |
|---|---|
| JSON 语法 | 键值对 + 数组,简洁 |
| LitJson | `JsonMapper.ToObject<T>` |
| XML 语法 | 标签 + 属性,严格 |
| XmlDocument | DOM 风格,内存大 |
| XmlReader | 流式,内存小 |
| MD5 | 完整性校验,不安全场景用 SHA-256 |

序列化是工程基本功。理解每种格式的特性,才能在配置、协议、存档、资源清单之间做正确选择。

## 参考

- [LitJson GitHub](https://github.com/JayXon/LitJson)
- [Newtonsoft.Json 文档](https://www.newtonsoft.com/json/help)
- [MD5 RFC 1321](https://www.rfc-editor.org/rfc/rfc1321)

---

下一篇:[FlowCanvas 与可视化配置](#) — 整合自 flow 客户端拉起与触发、可视化配置相关笔记。
