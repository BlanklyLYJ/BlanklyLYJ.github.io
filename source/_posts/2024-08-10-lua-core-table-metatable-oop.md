---
title: Lua 语言核心:table / metatable / 闭包 / OOP
date: 2024-08-10 21:00:00
updated: 2024-08-10 21:00:00
tags:
  - Lua
  - table
  - metatable
  - 闭包
  - OOP
categories:
  - [Lua, 语言核心]
comments: true
---

> 这是把分散在多篇笔记里的 Lua 核心知识(table 底层 / metatable / 闭包 / 面向对象)整合到一起。Lua 没有类、没有原型,所有"对象语义"都建立在 table + metatable 之上,所以理解这套机制是写好 Lua 的前提。

## 一、table 的底层:数组 + 哈希表

Lua 5.x 的 table 是**数组 + 哈希表**的混合结构,源码层定义大致如下:

```c
typedef struct Table {
  lu_byte flags;        /* 元方法缓存标记 */
  lu_byte lsizenode;    /* log2(哈希表大小),注意是 2 的幂 */
  unsigned int sizearray;  /* 数组部分大小 */
  TValue *array;        /* 数组部分 */
  Node *node;           /* 哈希部分 */
  Node *lastfree;       /* 哈希分配指针 */
  struct Table *metatable;
} Table;
```

关键设计:
- **数组部分**专门存放连续整数键 `1, 2, 3, ...`,O(1) 索引
- **哈希部分**存放任意键(字符串、浮点数、零散整数等)
- 写入时 Lua 自动判断走哪一边:连续整数进数组,其他进哈希

这种设计兼顾了"既当数组又当字典"的常见用法,避免纯哈希实现下的整数性能损耗。

<!-- more -->

### SETLIST vs SETTABLE

```lua
local a = {1, 2, 3}  -- SETLIST 指令:走数组部分
a[3] = 5             -- SETTABLE 指令:可能走数组也可能走哈希
a.name = "x"         -- SETTABLE:走哈希
```

- `SETLIST`:构造语法 `{...}` 触发,优先填数组部分,空间不够时 `luaH_resizearray` 扩容
- `SETTABLE`:`t[k] = v` 触发,根据 k 类型路由

### 哈希冲突:线性探查 + 开链

Lua 的哈希冲突处理介于"开放地址法"和"链地址法"之间,可以理解为**线性探查 + 链式回填**:

1. 计算 key 的 mainposition(应有位置)
2. 如果被占,看占用者的 mainposition 是不是这里
   - 如果是(同一桶的冲突):新建节点,链入
   - 如果不是(走错位置):把占用者挪走,新 key 占用 mainposition
3. 找不到空闲位置时触发 `rehash`,重新计算数组/哈希两部分大小

### rehash 的代价

`rehash` 会:
1. 统计数组部分键的数量
2. 统计哈希部分中可转为整数键的数量
3. 重新分配两部分大小
4. 把所有键重新插入

**性能要点**:每次 rehash 都是 O(n)。如果在一个空 table 里连续 `t[k] = v` 插入 N 个键,会触发多次 rehash,总复杂度 O(n²)。预知大小时用 `table.new(narray, nhash)`(Lua 5.3+)或一次性构造 `{...}` 避免。

## 二、取长度 # 的真相

```lua
local t = {1, 2, 3}
print(#t)  -- 3
```

`#` 操作符调用 `luaH_getn`,**先在数组部分二分查找边界**(找最后一个 `t[i] != nil` 且 `t[i+1] == nil` 的位置),找不到再去哈希部分。

**重要警告**:**不要对非序列(有空洞)的 table 用 #**。结果未定义,可能返回任意一个边界。

```lua
local t = {}
t[1] = "a"
t[2] = "b"
t[5] = "e"   -- 3、4 是空洞
print(#t)    -- 可能是 2,也可能是 5
```

如果要安全计数,自己维护 `n` 字段或用 `table.getn` + `__len` 元方法。

## 三、metatable 与元方法(metamethod)

每个 table 可以挂一个 metatable,里面定义若干**元方法**,在特定操作下自动触发。

### 常用元方法

| 元方法 | 触发场景 |
|---|---|
| `__index` | 读 `t[k]` 时,t[k] 不存在 |
| `__newindex` | 写 `t[k] = v` 时,t[k] 原本不存在 |
| `__add / __sub / __mul / __div` | 算术运算 `+ - * /` |
| `__eq / __lt / __le` | 比较 `== < <=` |
| `__concat` | 字符串连接 `..` |
| `__len` | 取长度 `#t` |
| `__call` | 把 table 当函数调用 `t(...)` |
| `__tostring` | `tostring(t)` |
| `__gc` | 垃圾回收时回调 |

Lua 启动时,这些元方法的名字字符串会被预先创建并缓存(`luaT_init`),加速后续查找。metatable 的 `flags` 字段按位记录"哪些元方法不存在",进一步加速。

### `__index` 详解

`__index` 可以是 **table** 或 **function**:

```lua
-- 形式 1:table
local base = {x = 1}
local t = setmetatable({}, {__index = base})
print(t.x)  -- 1,从 base 找到

-- 形式 2:function
local t = setmetatable({}, {__index = function(t, k)
  return rawget(_G, k)  -- 自定义查找逻辑
end})
```

查找链路:`t[k]` → `rawget(t, k)` → `__index` →(若 table)递归 →(若 function)调用。

### `__newindex` 与链式赋值

类似 `__index`,但用于写入。Lua 限制 `__index` / `__newindex` 链查找不超过 **2000 次**(`MAXTAGLOOP`),防止死循环。

```c
#define MAXTAGLOOP 2000
```

## 四、pairs 与 ipairs

| 函数 | 实现 | 行为 |
|---|---|---|
| `pairs(t)` | 调 `luaH_next`,遍历数组部分 + 哈希部分 | 顺序不保证,能遍历所有非 nil |
| `ipairs(t)` | 调 `lua_geti`,从 1 开始递增,遇 nil 停 | 仅遍历连续整数序列 |

### 死键(dead key)

`pairs` 遍历过程中,如果某个 key 的 value 被设为 nil,这个 key 可能被 GC 标记为 deadkey,但仍可能在后续 rehash 时被清除。

**安全规则**:遍历 table 时不要插入新键(可能触发 rehash,导致死键被清,行为未定义)。删除(设 nil)相对安全。

## 五、闭包:UpValue 机制

Lua 的函数闭包依赖 **UpValue** 结构,捕获外层局部变量。

```lua
function makeCounter()
  local count = 0
  return function()
    count = count + 1
    return count
  end
end

local c = makeCounter()
print(c())  -- 1
print(c())  -- 2
```

底层机制:
- 函数返回时,`count` 本应在栈上,但函数已退出
- Lua 把 `count` 包装成 **UpValue 结构**,从栈迁移到堆上
- 闭包持有这个 UpValue 的引用,后续访问 `count` 实际访问 UpValue

UpValue 有两种状态:
- **open**:仍在原栈上,多个闭包共享(通过 open 链表组织)
- **closed**:已迁移到 UpValue 结构体自身(`u.value`),由引用计数管理

闭包的本质:**外层局部变量在堆上的延迟生命周期**。

## 六、面向对象三件套

Lua 没有类,但用 table + metatable 可以模拟面向对象。

### 封装

```lua
local Animal = {}
Animal.name = "animal"
Animal.age = 1

function Animal:sayHello()
  print("I'm " .. self.name)
end

local a = setmetatable({}, {__index = Animal})
a.name = "dog"
a:sayHello()  -- I'm dog
```

### 继承(经典 new 模式)

```lua
Animal = {}
Animal.__index = Animal  -- 元表指向自己

function Animal.new(o)
  o = o or {}
  setmetatable(o, self)  -- 让 o 的 __index 找到 Animal
  return o
end

function Animal:sayHello()
  print("I'm " .. self.name)
end

-- 子类
Dog = Animal:new()
Dog.bark = function(self)
  print("wangwang")
end

local d = Dog:new()
d.name = "wangcai"
d:sayHello()  -- I'm wangcai(继承自 Animal)
d:bark()      -- wangwang(Dog 自己的)
```

### 多态(方法重写)

```lua
local d1 = Dog:new()
function d1:sayHello()
  print("I'm " .. self.name .. ", a dog")
end

local d2 = Dog:new()
d2.name = "luck"
function d2:sayHello()
  print("I'm " .. self.name .. ", another dog")
end

d1:sayHello()  -- I'm ..., a dog
d2:sayHello()  -- I'm ..., another dog
```

## 七、私有变量(双 table)

Lua 没有访问修饰符,但用闭包可以模拟私有:

```lua
local function newPerson(name, age)
  -- 私有 table,外部无法直接访问
  local self = {name = name, age = age}

  -- 暴露的接口
  return {
    sayName = function() print(self.name) end,
    setAge  = function(newAge) self.age = newAge end,
    getAge  = function() return self.age end
  }
end

local p = newPerson("tayler", 20)
p.sayName()      -- tayler
p.setAge(21)
print(p.getAge()) -- 21
print(p.name)    -- nil,私有不可见
```

`self` 是闭包内的局部变量,外部只能通过返回对象上的方法间接访问。

## 八、多重继承(__index 函数)

`__index` 是函数时,Lua 会以 `(table, key)` 调用它。利用这个可以实现多继承:

```lua
local function search(k, plist)
  for _, parent in ipairs(plist) do
    local v = parent[k]
    if v then return v end
  end
end

local function createClass(...)
  local c = {}
  local parents = {...}

  -- 类查找时,遍历所有父类
  setmetatable(c, {__index = function(_, k)
    return search(k, parents)
  end})

  -- 实例的 __index 指向类自身
  c.__index = c

  function c:new(o)
    o = o or {}
    setmetatable(o, c)
    return o
  end

  return c
end

-- 用法
local A = {hello = function() print("A") end}
local B = {world = function() print("B") end}
local C = createClass(A, B)

local obj = C:new()
obj:hello()  -- A
obj:world()  -- B
```

## 九、性能注意

### 堆内存重复开销

```lua
-- 反面教材:每次调用都重新构造表
function compareSkill(a, b)
  local skillList = {
    E_HeroData.E_TBL_hero_skill_1_id,
    E_HeroData.E_TBL_hero_skill_2_id,
    E_HeroData.E_TBL_hero_skill_3_id
  }
  -- 用 skillList 做 sort 比较
end
```

`skillList` 是常量,但每次进函数都新建一个 table。如果用在 `table.sort` 的比较函数里(高频调用),会产生大量短命对象,GC 压力剧增。

**改法**:提为 upvalue 或全局:

```lua
local SKILL_LIST = {
  E_HeroData.E_TBL_hero_skill_1_id,
  E_HeroData.E_TBL_hero_skill_2_id,
  E_HeroData.E_TBL_hero_skill_3_id,
}

function compareSkill(a, b)
  -- 直接用 SKILL_LIST
end
```

### 其他要点

- **预分配 table**:`table.new(narray, nhash)`(5.3+)
- **避免遍历中插入新键**:可能触发 rehash,行为未定义
- **不要对非序列用 #**:结果不可预测
- **闭包捕获大对象**:会延长其生命周期,注意内存

## 十、小结

| 概念 | 本质 |
|---|---|
| table | 数组 + 哈希的混合结构 |
| metatable | 一组元方法,定义 table 的"运算符重载" |
| `__index` | 读访问的回退路径(实现继承的关键) |
| `__newindex` | 写访问的回退路径 |
| UpValue | 闭包捕获的外层局部变量,堆上结构 |
| OOP | table + `__index` 模拟 |
| 私有 | 双 table + 闭包捕获 |

Lua 的简洁在于:语言核心只提供 table + metatable + 闭包三件套,其余(类、继承、私有、模块)都在这套机制上构造。理解了这三件套,Lua 代码就没什么神秘的了。

## 参考

- [Lua 5.3 源码 ltable.c](https://www.lua.org/source/5.3/ltable.c.html)
- [Lua 程序设计(第 4 版)](https://book.douban.com/subject/30738586/)
- [Lua 5.3 设计实现(四):Closure 与 Upvalues](https://yuerer.com/Lua5.3-设计实现(四)-Closure与Upvalues/)

---

下一篇:[Lua 字符串与正则(模式匹配)](#) — 整合自 lua 正则、文本空格问题、特殊字符过滤
