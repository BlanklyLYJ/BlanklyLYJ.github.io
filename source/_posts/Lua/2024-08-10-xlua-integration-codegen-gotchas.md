---
permalink: 2024/08/10/xlua-integration-codegen-gotchas/
title: XLua 集成:三大标签 / LuaEnv / GC 机制 / 判 nil 坑
date: 2024-08-10 22:00:00
updated: 2024-08-10 22:00:00
tags:
  - Lua
  - XLua
  - Unity
  - 热更新
  - GC
categories:
  - [Lua, XLua]
comments: true
---

> 这一篇整合 XLua 在 Unity 项目中的实战知识:三大配置标签、LuaEnv 生命周期、C# 与 Lua 互相调用、GC 弱引用机制,以及经典的"Unity 对象在 Lua 里不为 nil"问题。

## 一、XLua 是什么

XLua 是腾讯开源的 Unity Lua 热更框架,核心特点:
- **双向调用**:Lua 调 C#,C# 调 Lua,都开箱即用
- **代码生成 + 反射**:开发了 `LuaCallCSharp` 等标签,生成委托代码;无标签时 fallback 到反射
- **热修复(Hotfix)**:标签 `Hotfix` 可在 Lua 中重写 C# 方法,做到线上修 bug
- **GC 友好**:C# 对象在 Lua 中通过弱引用表持有,避免双向 GC 卡死

同类对比:
- **slua / toLua**:同类方案,XLua 性能、稳定性、生态最均衡
- **ILRuntime / HybridCLR**:C# 层热更,不用 Lua,后续专门一篇对比

<!-- more -->

## 二、三大配置标签

XLua 的核心机制之一。通过给 C# 类打标签,配合 `Generate Code`,生成静态包装代码,**避免运行时反射**。

### `[LuaCallCSharp]`:Lua 调 C#

```csharp
[LuaCallCSharp]
public static List<Type> MyLuaCallCSharp = new List<Type>() {
    typeof(GameObject),
    typeof(Transform),
    typeof(List<Vector3>),
    typeof(Dictionary<string, int>),
};
```

打上这个标签的类型,点击 `XLua > Generate Code` 后,XLua 会:
1. 生成该类的所有构造函数、属性、方法的包装代码
2. 这些包装代码是**静态调用**,性能接近原生 C#
3. 没生成时也能用,但走反射,**性能差 1-2 个数量级**

### `[CSharpCallLua]`:C# 调 Lua

```csharp
[CSharpCallLua]
public static List<Type> MyCSharpCallLua = new List<Type>() {
    typeof(Action<GameObject>),
    typeof(Func<int, int, int>),
};
```

适用场景:
- C# 注册 UI 事件回调,Lua 实现
- 把 Lua table 适配成 C# interface
- `LuaTable.Get<DelegateType>(key)` 把 Lua 函数绑到委托

### `[BlackList]`:排除特定成员

```csharp
[BlackList]
public static List<List<string>> MyBlackList = new List<List<string>>() {
    new List<string>() { "UnityEngine.UI.Text", "OnRebuildRequested" },
    new List<string>() { "UnityEngine.GameObject", "networkView" },
};
```

生成时跳过这些成员,可能原因:
- 历史遗留 API 会引发编译错误(如 `networkView`)
- 内部回调不该暴露给 Lua

### `[GenCodeMenu]`:自定义生成入口

打上这个标签的静态函数会出现在 `XLua > Generate Code` 菜单中,允许自定义生成逻辑。

### 生成流程

```
开发期:打标签 → Generate Code → 编译 → 部署
热更期:Lua 脚本下发热加载,使用已生成的 C# 包装代码
```

> 关键:**生成代码是开发期完成的**,热更时 Lua 直接消费这些包装代码,所以零运行时反射开销。

## 三、LuaEnv:Lua 虚拟机实例

每个 LuaEnv 是一个独立的 Lua 虚拟机,通常全局唯一。

```csharp
LuaEnv luaEnv = new LuaEnv();
luaEnv.AddLoader(CustomLoader);  // 自定义 require 加载器
luaEnv.DoString("print('hello')");
luaEnv.DoString(scriptText, "module_name");
```

### 加载 Lua 文件

默认从 Resources 加载,文件名格式 `xxx.lua.txt`(因为 Resources 不识别 `.lua`):

```csharp
// 自定义 loader:从沙盒目录加载
byte[] CustomLoader(ref string filePath) {
    string path = Path.Combine(Application.persistentDataPath, filePath + ".lua");
    if (File.Exists(path)) return File.ReadAllBytes(path);
    return null;
}

luaEnv.AddLoader(CustomLoader);
luaEnv.DoString("require 'game.main'");
```

### 销毁 LuaEnv

```csharp
luaEnv.Dispose();  // 同步释放,如果 Lua 里有 C# 回调会抛异常
```

如果有未完成的回调,需要先 `Dispose` 前的提示:

```
try to dispose a LuaEnv with C# callback!
```

错误信息提示:**Lua 侧有未注销的 C# 委托引用**,直接 Dispose 会引发问题。需要先在 Lua 里清掉引用(把 delegate 置 nil),再 Dispose。

正确流程:
```csharp
// 1. 通知 Lua 清理引用
luaEnv.DoString("GameModule:OnApplicationQuit()");

// 2. 等一帧让 GC 完成
yield return null;

// 3. 再 Dispose
luaEnv.Dispose();
```

## 四、C# 调 Lua

```lua
-- lua side
gameConfig = {
    maxPlayer = 100,
    onStart = function() print("started") end,
}
```

```csharp
// C# side
LuaTable gameConfig = luaEnv.Global.Get<LuaTable>("gameConfig");
int maxPlayer = gameConfig.Get<int>("maxPlayer");

// 调 Lua 函数(用 Action 委托)
Action onStart = gameConfig.Get<Action>("onStart");
onStart();

// 或者用 Get<T>(key, out value)
if (gameConfig.Get("onStart", out Action cb)) {
    cb();
}
```

### LuaTable 的几种用法

```csharp
LuaTable t = luaEnv.Global.Get<LuaTable>("someTable");

// 1. 弱类型:Get<string, int>("name") 等
string name = t.Get<string>("name");

// 2. 强类型映射到 C# class / interface
[ CSharpCallLua ]
interface IGameConfig {
    int MaxPlayer { get; set; }
    Action OnStart { get; set; }
}
IGameConfig cfg = t.Cast<IGameConfig>();
```

## 五、Lua 调 C#

最简单:直接通过 `CS.UnityEngine.xxx`:

```lua
local GameObject = CS.UnityEngine.GameObject
local go = GameObject("MyCube")
local transform = go.transform
transform.position = CS.UnityEngine.Vector3(0, 0, 0)

-- 调用 C# 静态方法
local cube = GameObject.Find("cube")
local animator = cube:GetComponent(typeof(CS.UnityEngine.Animator))
```

注意几个细节:
- `CS.` 是 XLua 默认的 C# namespace 入口
- 静态方法/属性直接 `.` 访问
- 实例方法用 `:`(self 传递),实例属性用 `.`
- 泛型类型用 `typeof(...)`:`typeof(CS.UnityEngine.Animator)`
- `GetComponent` 返回值需要自己判 nil

### 把 Lua 函数传给 C# 委托

```csharp
// C# 注册一个回调签名
public static class Events {
    public static Action<int> onScoreChanged;
}
```

```lua
-- Lua 实现回调
function OnScoreChanged(score)
    print("score changed: " .. score)
end

CS.Events.onScoreChanged = OnScoreChanged
```

要求 `Action<int>` 已经在 `[CSharpCallLua]` 列表里生成,否则会报错或走反射。

## 六、GC 机制:C# 对象在 Lua 中的生命周期

XLua 的核心难点之一是**双向 GC 协调**:

- Lua 侧 GC 不知道 C# 堆
- C# 侧 GC 不知道 Lua 堆
- 跨边界的对象引用必须由 ObjectTranslator 中转

### ObjectTranslator 弱引用缓存

XLua 在 Lua 里创建一个**弱引用表**(value 模式),存放所有"Lua 持有的 C# 对象":

```csharp
// ObjectTranslator.cs (简化)
LuaAPI.lua_newtable(L);                // cache 表
LuaAPI.lua_newtable(L);                // 元表
LuaAPI.xlua_pushasciistring(L, "__mode");
LuaAPI.xlua_pushasciistring(L, "v");   // value 弱引用
LuaAPI.lua_rawset(L, -3);
LuaAPI.lua_setmetatable(L, -2);        // 给 cache 设元表
```

这样 Lua GC 时,弱引用的 C# 对象可被回收(只是 cache 失效,C# 对象本身归 C# GC 管)。

### `__gc` 元方法

```csharp
LuaAPI.xlua_pushasciistring(L, "__gc");
LuaAPI.lua_pushstdcallcfunction(L, translator.metaFunctions.GcMeta);
LuaAPI.lua_rawset(L, -3);
```

每个 C# 对象在 Lua 里的 userdata,metatable 都带 `__gc`。Lua GC 时:
1. 触发 `__gc` 回调
2. 调用 `ObjectTranslator.collectObject(index)`
3. 从 `objects` 字典里移除该 C# 对象的"Lua 固定引用"
4. 此后该 C# 对象归 C# GC 正常接管

### 关键设计点

- **C# 对象不能由 Lua 单方面创建并保留**:Lua 创建的对象最终在 C# GC 时回收
- **Lua 弱引用**:允许 Lua 主动释放"自己不再用"的 C# 对象引用,避免循环
- **`__mode = "v"`** 是核心:让 Lua 缓存表只持有 value 弱引用,key 强引用

## 七、坑:Unity 对象在 Lua 里不为 nil

经典问题:

```lua
local go = CS.UnityEngine.GameObject.Find("cube")
-- ... 中间 go 被 Destroy ...
if go == nil then
    print("destroyed")
end
```

**预期**:Destroy 后 `go == nil` 为 true。
**实际**:`go == nil` 为 false,后续访问 `go.transform` 报错。

### 原因

`UnityEngine.Object` 重载了 `==` 运算符,在 C# 里:

```csharp
// UnityEngine.Object 内部
public override bool Equals(object o) {
    return CompareBaseObjects(this, o as Object);
}
// obj == null 在 C# 里实际检查 "is destroyed or fake-null"
```

但 Lua 的 `==` 是引用相等,看的是 C# 对象本身(并未真正为 null,只是被标记 destroyed)。

### 解决方案 1:C# 写扩展方法

```csharp
[LuaCallCSharp]
[ReflectionUse]
public static class UnityEngineObjectExtention {
    public static bool IsNull(this UnityEngine.Object o) {
        return o == null;  // 走 UnityEngine.Object 的 ==
    }
}
```

Lua 侧:

```lua
if go:IsNull() then
    -- destroyed
end
-- 或者
if not go or go:IsNull() then ... end
```

### 解决方案 2:Lua 侧自定义 nullobj

利用 Lua 元表 `__eq` 重载 `==`:

```lua
local nullobj = setmetatable({__type = "nullobj"}, {
  __eq = function(a, b)
    local nul, target
    if a.__type == "nullobj" then
      nul, target = a, b
    else
      nul, target = b, a
    end

    -- 如果 target 是 Unity userdata,调 IsNull
    if type(target) == "userdata" and target.IsNull ~= nil then
      return target:IsNull()
    end
    return false
  end
})

-- 使用
local go = CS.UnityEngine.GameObject.Find("cube")
if go == nullobj then
  -- destroyed
end
```

### 推荐实践

- **在项目里固定一种判空方式**(扩展方法或 nullobj),全局使用
- **不要混用** `go == nil` 和 `go:IsNull()`,容易遗漏
- **不限于 GameObject**:所有 `UnityEngine.Object` 子类(Material、Texture、Component…)都有这个问题

## 八、性能要点

| 操作 | 相对耗时 |
|---|---|
| Lua 调 C# 生成代码 | 1× ~ 5× |
| Lua 调 C# 反射 | 30× ~ 100× |
| C# 调 Lua (Action) | 1× |
| C# 调 Lua (LuaTable.GetFunction) | 5× |
| LuaVM 内访问 Lua | 1× |

经验:
- **热路径**(每帧调用)一定要生成代码,不要反射
- **C# → Lua** 用具体 delegate,不要每次 `GetFunction`
- **避免** 在循环里 `LuaTable.Get<...>`,缓存引用
- **大对象传递**:LuaTable / LuaFunction 比原生 Lua 慢,能内联就内联
- **GC 注意**:跨边界创建对象会产生双向 GC 引用,改用 `struct` 或值传递

## 九、整体架构

```
        Lua 侧                    C# 侧
┌─────────────────────┐   ┌────────────────────────┐
│  Lua 脚本(.lua.txt) │←→ │ LuaEnv (虚拟机实例)     │
│                      │   │                        │
│  CS.UnityEngine.xxx  │←→ │ ObjectTranslator       │
│  (弱引用 cache)      │   │  - objects Dictionary  │
│                      │   │  - reverseMap          │
│  metaFunctions.GcMeta│──→│  __gc → collectObject  │
└─────────────────────┘   │                        │
                          │  生成代码(LuaCallCSharp)│
                          │  反射 fallback          │
                          └────────────────────────┘
```

**热更时的边界**:
- 改 Lua 脚本(下发热更包)→ 应用层逻辑
- 改 C# 代码 → 需要重新打 APK
- 改 `[LuaCallCSharp]` 列表 → 需要重新 Generate Code + 打 APK
- 加 `[Hotfix]` 修复 C# bug → 仅需打补丁包,不需重新打 APK

## 参考

- [XLua 官方 FAQ](https://github.com/Tencent/xLua/blob/master/Assets/XLua/Doc/faq.md)
- [XLua 源码解析](https://zhuanlan.zhihu.com/p/572147030)
- [Unity GameObject 在 Lua 中判 nil](http://www.imxqy.com/code/lua/ugonil.html)

---

[上一篇:Lua 字符串与模式匹配](/2024/08/10/lua-string-pattern/)

下一篇:[三种热更方案对比:HybridCLR / Lua / ILRuntime](#)
