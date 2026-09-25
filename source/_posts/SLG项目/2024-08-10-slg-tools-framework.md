---
title: SLG 工具与基础框架:导表 / 合表 / 多语言 / 手游技术栈
date: 2024-08-10 24:00:00
updated: 2024-08-10 24:00:00
tags:
  - SLG
  - 工具链
  - 框架
  - Luban
  - Unity
categories:
  - [游戏开发, 系统设计]
comments: true
---

> 这一篇把"工具链 + 基础框架"相关的笔记整合起来:从 SLG 项目的实际工作内容(SettingPanel / 宝箱 / Luban 扩展 / 图片检测 / 表格工具 / FlowCanvas / SDK)、到手游基础框架的全景梳理,再到具体的 Excel 合表插件实现。看完能对一个手游项目"除了玩法还做了什么"有完整印象。

## 一、SLG 项目的实战工作流

先从一个真实 SLG 项目的工作内容看起,理解手游开发到底在做什么。

### 周度拆解

| 周次 | 工作内容 |
|---|---|
| 第一周 | 熟悉代码、装环境、SettingPanelController |
| 第二周 | 宝箱系统开发 |
| 第三周 | Luban 扩展(多语言)、表格规范检查、图片检测工具 |
| 第四周 | 表格提交工具、FlowCanvas 研究、SDK 备战 |
| 第五周 | FlowCanvas 实际应用、关卡入场入口、刷怪导出、SDK |

### 第三周:Luban 多语言扩展

需求:`language.xlsx` 表里用中文索引,在其他表里要转成 id 索引。

实现思路:写一个 Luban 扩展,加载 `language.xlsx` 建立"中文 → id"映射,在其他表加载时自动转换。这样策划可以直接在配置里写中文文案,工具自动转 id,避免手动维护 id 文案对应关系。

同时要做**表格规范检查**:扫所有表,找出没用 Localization 标记的字段,提醒策划补上。

### 第三周:图片检测工具

需求:检测 Prefab 中所有图片是否为空,或者使用了 built-in 资源。

为什么需要:

- **空图片**:策划 / 美术漏配,运行时显示破图
- **built-in 资源**:Unity 自带的默认 sprite,在线上会丢失或显示异常,必须用项目内资源

工具实现思路:

```csharp
foreach (var prefab in allPrefabs)
{
    foreach (var image in prefab.GetComponentsInChildren<Image>(true))
    {
        if (image.sprite == null)
            LogError(prefab, image, "sprite 为空");

        if (IsBuiltInSprite(image.sprite))
            LogError(prefab, image, "使用了 built-in sprite");
    }
}
```

### 第四周:表格提交工具

需求:实现定点 revert / commit / update,Unity 编辑器内开启表格。

为什么需要:

- 策划在 Excel 里改配置,改完要提交到 Git
- 但策划不一定会用 Git,需要在 Unity 里点按钮完成
- 表格提交需要"定点"操作:只提交某个表,不要把工作目录全提交

实现思路:

```csharp
[MenuItem("Tools/Excel/Commit asset.xlsx")]
static void CommitAssetExcel()
{
    GitRun("git add path/to/asset.xlsx");
    GitRun("git commit -m \"update asset.xlsx\"");
}
```

### 第五周:FlowCanvas 实际应用

入口和子系统:

```
CSnapGameFrameworkClient      // 关卡入场入口
LevelUtility.cs               // 关卡触发器检测
City_hotel_1001               // 关卡名
ExportAISpawnNew              // 导出场景 AI 刷怪配置
```

<!-- more -->

## 二、手游基础框架全景

把视角拉高,看一个完整手游项目需要哪些"基础框架"。

### 客户端核心框架

| 框架 | 必要性 | 说明 |
|---|---|---|
| UI 框架 | 必要 | 界面层级、生命周期、弹窗队列、通用动画 |
| 红点系统 | 大多需要 | 红点树为内核,触发显隐待探讨 |
| 特效 / 粒子系统 | 必要 | UI 层级管理 |
| 新手引导框架 | 必要 | 与 UI 框架深度耦合 |
| UI 大层级分类 | 必要 | 引导层 / 系统层 / 功能层 |

### 资源管理框架(最底层)

```
资源池(对象复用)
   ↓
AssetBundle 加载与管理(内存管理关键)
   ↓
GC 艺术(解决卡顿)
   ↓
热更策略
   ↓
多语言 + Variant 变体
   ↓
游戏分包(谷歌 a 包 + 游戏内 b 包)
   ↓
字体管理(稳定占内存,尽量小)
```

### 热更框架对比

| 方案 | 性能 | 主流度 |
|---|---|---|
| xLua (Lua + C#) | iOS 上稳定 | 当前最主流 |
| ILRuntime (纯 C#) | iOS 历史上有性能问题 | 占比偏低 |
| Wolong (纯 C#) | 远超其他方案 | 大概率未来主流 |

热更策略通常是增量包:只下变更的资源 / 代码。

### 表格 / 编辑器工具(TA 方向)

- 表格生成静态数据(策划配置,代码调用)
- 各种美术 / 策划工具
- GM 工具
- 地图、模型、技能编辑器

### 网络与原生

```
网络框架(主流 protobuff)
   ↓
SDK 接入(支付 / 登录 / 推送)
   ↓
Android / iOS 原生开发
   ↓
性能优化
   ├── 消息隔帧处理
   ├── 图集合批
   ├── 包体优化
   ├── 界面异步加载
   └── 特效分级
   ↓
动画系统 / Timeline / DOTween
   ↓
音频视频系统
   ↓
多语言
```

### 服务器方向

| 模块 | 选项 |
|---|---|
| 语言 | C++ / Go / .NET / Erlang / Lua(Go 比较火) |
| 缓存 | Redis / MongoDB |
| 数据库 | MySQL / PostgreSQL |
| 架构 | 分布式:网关、游戏服、账号服、聊天服、战斗服、邮件服、支付服 |

物理相关的游戏可能需要在服务器上跑 Unity(自写物理或不需要物理的可不跑)。

### 战斗逻辑框架(因游戏而异)

| 游戏 | 战斗特点 |
|---|---|
| 战双 / 崩坏 | 小房间关卡战斗,操作角色放技能 |
| 碧蓝航线 | 放置任意数量船只弹幕攻击 |
| 明日方舟 | 沙盘地图部署干员,角色自行攻击 / 释放技能 |
| 率土之滨 / 三战 | 部队间战斗 + 战报生成 |

### 地图框架

| 游戏 | 地图特点 |
|---|---|
| 率土之滨 / 三战 | 战场沙盘 |
| 明日方舟 | 干员部署位 + 位置 buff + 怪物寻路 + 陷阱 |
| 万国觉醒 | 大地图 + 无极缩放 + LOD 特效分级 |

## 三、Excel 合表工具:OfficeOpenXml 实现

策划拆表很常见:`asset.xlsx` 是主表,`asset#sub1.xlsx`、`asset#sub2.xlsx` 是子表。合表工具把它们合并成最终配置。

### 需求

1. 根据主表名 `asset.xlsx`,扫描同目录下所有 `asset#*.xlsx` 子表
2. 合并所有子表
3. 子表里第一列 column 相同的行 row 要忽略(去重)
4. C# 实现,用 OfficeOpenXml 库

### 实现

```csharp
using OfficeOpenXml;

public void MergeExcel(string folderPath, string masterFileName)
{
    // 加载主表
    ExcelPackage masterPackage = new ExcelPackage(
        new FileInfo(Path.Combine(folderPath, masterFileName)));
    ExcelWorksheet masterSheet = masterPackage.Workbook.Worksheets[0];

    // 创建合并后的 package
    ExcelPackage mergedPackage = new ExcelPackage();
    ExcelWorksheet mergedSheet = mergedPackage.Workbook.Worksheets.Add("Merged Data");

    // 已遇到的第一列值(去重)
    HashSet<string> seenValues = new HashSet<string>();

    // 遍历所有子表 asset#*.xlsx
    foreach (var file in Directory.GetFiles(folderPath, "asset#*.xlsx"))
    {
        if (file.Equals(Path.Combine(folderPath, masterFileName),
            StringComparison.OrdinalIgnoreCase))
            continue;  // 跳过主文件

        ExcelPackage subPackage = new ExcelPackage(new FileInfo(file));
        ExcelWorksheet subSheet = subPackage.Workbook.Worksheets[0];

        ExcelCellAddress lastCell = subSheet.Dimension.End;
        int lastRow = lastCell.Row;
        int lastCol = lastCell.Column;

        // 第一行是标题,从第二行开始
        for (int row = 2; row <= lastRow; row++)
        {
            string firstColValue = subSheet.Cells[row, 1].Text;

            // 去重:第一列相同的行跳过
            if (!string.IsNullOrEmpty(firstColValue)
                && !seenValues.Add(firstColValue))
                continue;

            // 复制非第一列的数据
            for (int col = 2; col <= lastCol; col++)
            {
                mergedSheet.Cells[mergedSheet.Dimension.End.Row + 1, col].Value
                    = subSheet.Cells[row, col].Value;

                if (col > mergedSheet.Dimension.End.Column)
                    mergedSheet.Column(col).Width = subSheet.Column(col).Width;
            }
        }

        subPackage.Dispose();
    }

    // 保存合并结果
    mergedPackage.SaveAs(
        new FileInfo(Path.Combine(folderPath, "Merged_Asset.xlsx")));

    masterPackage.Dispose();
    mergedPackage.Dispose();
}
```

### 几个坑

1. **主表的 max row**:todo 里写了"先找出主表的最大 row 值,startRow 才能往后加"——否则子表数据会覆盖主表
2. **子表按名称合并**:不同子表第一列相同的行,只保留第一个出现的
3. **列宽同步**:子表列宽 != 主表时,需要单独设置(`mergedSheet.Column(col).Width`)
4. **空值处理**:第一列为空的行,逻辑上要决定是合并还是跳过

### 改进方向

- **支持多 sheet**:目前只处理 `Worksheets[0]`,多 sheet 时要循环
- **类型保留**:ExcelPackage 默认按文本读,数值 / 日期会丢类型,需要单独处理
- **差异更新**:每次只合变更的子表,而不是全量

## 四、Sam 的秘密笔记

一个公开的金山文档分享链接:[Sam 的秘密笔记](https://www.kdocs.cn/l/cbSqBT9pOXH5)。具体内容需要打开查看,通常是某个项目内积累的踩坑 / 最佳实践集合。

## 五、把工具链串起来

一个 SLG 项目完整的"工具 + 框架"流程大致这样:

```
策划配置(Excel)
   ↓ 合表工具
合并后的 Excel(asset.xlsx + asset#*.xlsx → Merged_Asset.xlsx)
   ↓ Luban
静态数据 C# / Lua 类
   ↓ 加载到运行时
游戏运行
   ↓ 策划改表
重新合表 → 重新 Luban → 热更下发
```

每一步都需要工具支撑:

| 环节 | 工具 |
|---|---|
| 策划编辑 | Excel + FlowCanvas |
| 合并 | Excel 合表插件(本节代码) |
| 转换 | Luban(支持多语言、Localization 标记) |
| 提交 | Unity 编辑器内的 Git 工具 |
| 校验 | 图片检测、Localization 标记检查 |
| 热更 | xLua / Wolong + 增量包 |

## 六、3C 与 Gameplay 基础

最后回到最基础的"3C"(Camera / Control / Character),这是任何 Gameplay 的起点。

### Camera 相机

先做简单的角色跟随,角色移动时相机一起移动。

### Control 控制

搜集玩家按键、鼠标、屏幕滑动区域,释放对应的操作或连招。

### Character 角色

- 人物建模
- 动画(Animator / PlayableBehaviour / Animancer Pro / Locomotion)
- 输入处理

参考:

- [Unity 3C 以及 Gameplay 实现记录](https://zhuanlan.zhihu.com/p/691516531)
- [CharacterController 完整实现](https://blog.csdn.net/qq_36303853/article/details/134984516)

## 七、小结

| 模块 | 关键技术 |
|---|---|
| 工作流 | Luban 扩展 + 图片检测 + 表格工具 + FlowCanvas |
| 客户端框架 | UI / 资源 / 热更 / 网络 / 性能 |
| 服务器框架 | 分布式 + 缓存 + 数据库 |
| 合表工具 | OfficeOpenXml + 去重 + 列宽同步 |
| 3C 基础 | Camera / Control / Character |

工具链和基础框架是"看不见但决定项目生死"的部分。一个项目能不能长期跑下来,玩法可以重构,但工具链一旦烂了就很难救。**前期在工具上投入的时间,后期会以 10 倍回报**。

## 参考

- [Unity 3C 以及 Gameplay 实现记录](https://zhuanlan.zhihu.com/p/691516531)
- [Luban 配置工具](https://github.com/focus-creative-games/luban)
- [OfficeOpenXml 文档](https://github.com/EPPlusSoftware/EPPlus)
- [FlowCanvas](https://flowcanvas.paradoxnotion.com/)

---

下一篇:[C# 异步编程与多线程(async/await、Task、Thread)](@post/2024-08-10-csharp-async-multithreading) — 配合本篇的热更 / 网络框架阅读。
