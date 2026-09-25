---
permalink: 2024/08/10/lua-string-pattern/
title: Lua 字符串与模式匹配:不是正则,但够用
date: 2024-08-10 21:30:00
updated: 2024-08-10 21:30:00
tags:
  - Lua
  - 字符串
  - 模式匹配
  - UTF-8
categories:
  - [Lua, 字符串]
comments: true
---

> Lua 没有"正则表达式",只有"模式(pattern)"——一个轻量、设计独特的迷你 DSL。这篇整合 Lua 模式语法、字符类、捕获、常用 API,以及 UTF-8 字符串过滤、中英混排空格等实战问题。

## 一、Lua 字符串基础

- **不可变**:任何修改都生成新字符串(`..` 也是)
- **字节序列**:Lua 字符串是任意字节流,可以含 `\0`,不依赖 `\0` 结尾
- **编码无关**:Lua 不知道 UTF-8,`#s` 返回**字节数**不是字符数

```lua
local s = "中文"
print(#s)  -- 6,UTF-8 下每个汉字 3 字节
```

要处理 UTF-8 字符( rune 数),用 Lua 5.3+ 的 `utf8` 库:

```lua
print(utf8.len("中文"))  -- 2
print(#utf8.codepoint("中", 1))  -- 单个码点
```

<!-- more -->

## 二、模式(Pattern)不是正则

Lua 模式语法与 POSIX 正则**不兼容**,但有相似之处。区别:
- 用 `%` 转义,不是 `\`
- 没有 `|`(或)、`{n,m}`(重复次数)、非贪婪默认
- 更轻量,适合嵌入式场景

### 字符类

| 模式 | 含义 |
|---|---|
| `.` | 任意字符 |
| `%a` | 字母 |
| `%d` | 数字 |
| `%s` | 空白符(空格 / `\n` / `\t` / `\r`) |
| `%w` | 字母和数字 |
| `%p` | 标点 |
| `%c` | 控制字符 |
| `%x` | 十六进制数字 |
| `%l` | 小写字母 |
| `%u` | 大写字母 |
| `%z` | `\0` 字符(5.1) |

**大写形式 = 补集**:`%A` 非字母,`%D` 非数字,`%S` 非空白…

### 模式修饰符

| 修饰符 | 含义 |
|---|---|
| `+` | 前一项 1 次或多次(贪婪) |
| `*` | 前一项 0 次或多次(贪婪) |
| `-` | 前一项 0 次或多次(**最短匹配**) |
| `?` | 前一项 0 次或 1 次 |
| `^` | 字符串开头(或在 `[]` 内表示补集) |
| `$` | 字符串结尾 |

`*` 和 `-` 的区别是经典坑:

```lua
string.match("a/b/c", ".-/")   -- "a/"(最短)
string.match("a/b/c", ".*/")   -- "a/b/"(贪婪)
```

### 字符集 `[]`

```lua
[%w_]      -- 字母数字 + 下划线
[01]       -- 二进制
[%[%]]     -- 一对方括号(转义)
[0-7]      -- 八进制数字(用连字符)
[^0-7]     -- 非八进制数字(开头 ^ 表示补集)
[^\n]      -- 非换行符
```

### 特殊字符转义

模式串中的特殊字符:`( ) . % + - * ? [ ^ $`,要匹配本身用 `%` 转义:

```lua
string.match("a.b", "%.")    -- "."
string.match("100%", "%%")   -- "%"
```

## 三、捕获 `()`

`()` 包围要捕获的部分:

```lua
local pair = "name = Anna"
local first, last, key, value = string.find(pair, "(%a+)%s*=%s*(%a+)")
-- first=1, last=10, key="name", value="Anna"
```

### 反向引用 `%1`

`%1` 表示第一个捕获的拷贝,常用于匹配对称字符:

```lua
-- 匹配单/双引号字符串
string.match('  "hello"  ', '(["\'])(.-)%1')
-- 返回 '"', 'hello'
```

## 四、核心 API

| API | 用途 |
|---|---|
| `string.find(s, pat)` | 找模式,返回起止位置 + 捕获 |
| `string.match(s, pat)` | 返回捕获,不关心位置 |
| `string.gmatch(s, pat)` | 迭代所有匹配,常用于遍历 |
| `string.gsub(s, pat, repl, n)` | 替换,返回新串 + 替换次数 |
| `string.format(fmt, ...)` | C 的 sprintf |
| `string.byte(s, i)` / `string.char(...)` | 字节 ↔ 数字 |
| `string.rep(s, n)` | 重复 n 次 |
| `string.sub(s, i, j)` | 截取(允许负索引) |

### gsub 的替换格式

`repl` 可以是字符串、函数、表:

```lua
-- 字符串(%0 整体,%1 第一个捕获)
string.gsub("hello", "l", "L")           -- "heLLo", 2
string.gsub("2024-08-10", "(%d+)-(%d+)-(%d+)", "%3/%2/%1")  -- "10/08/2024"

-- 表:捕获值作为 key 查表
local dict = {dog = "犬", cat = "猫"}
string.gsub("I have a dog", "%w+", dict)  -- "I have a 犬"

-- 函数:捕获值传给函数,返回值替换
string.gsub("hello world", "%w+", function(w) return w:upper() end)
-- "HELLO WORLD"
```

## 五、实战 1:去除首尾空白

Lua 标准库没有 `trim`,自己写:

```lua
-- 方法 1:两次 gsub
function trim(s)
  s = s:gsub("^%s+", "")
  s = s:gsub("%s+$", "")
  return s
end

-- 方法 2:一次 gsub + 捕获(推荐)
function trim(s)
  return (s:gsub("^%s*(.-)%s*$", "%1"))
end

-- 注意:外层括号让函数只返回第一个值(gsub 实际返回两个值:新串 + 次数)
```

## 六、实战 2:中英混排空格变成换行

UGUI Text 在自动换行时,可能在中文和英文之间的空格处断行,导致排版难看。**把空格替换成不间断空格(U+00A0)** 就不会被识别为换行点:

```lua
local function replaceFullWidthSpace(text)
  -- %s+ 匹配连续空白,\u{00A0} 是不间断空格
  return (text:gsub("%s+", "\u{00A0}"))
end
```

> 注意 `\u{XXXX}` 是 Lua 5.3+ 语法。5.1 用 `string.char(0xC2, 0xA0)`(UTF-8 编码)。

## 七、实战 3:中文 + 数字 + 字母过滤(拒绝表情/特殊符号)

需求:用户名只允许中文、数字、大小写字母,不允许空格、符号、emoji。

Lua 字符串是字节流,处理 UTF-8 中文要按字节解析:

- ASCII 数字:`48-57`
- 大写字母:`65-90`
- 小写字母:`97-122`
- 中文(UTF-8):首字节 `228-233`,后续两字节通常 `128-191`

```lua
local function isValidName(s)
  local i = 1
  local byteCount = #s
  while i <= byteCount do
    local c = string.byte(s, i)

    if (c >= 48 and c <= 57) or        -- 0-9
       (c >= 65 and c <= 90) or        -- A-Z
       (c >= 97 and c <= 122) then     -- a-z
      i = i + 1
    elseif c >= 228 and c <= 233 then  -- 可能是中文 UTF-8 首字节
      local c1 = string.byte(s, i + 1)
      local c2 = string.byte(s, i + 2)
      if c1 and c2 and c1 >= 128 and c1 <= 191
                 and c2 >= 128 and c2 <= 191 then
        i = i + 3
      else
        return false  -- 字节残缺
      end
    else
      return false  -- 不允许的字符
    end
  end
  return true
end

print(isValidName("张三123abc"))  -- true
print(isValidName("张三🎉"))       -- false
print(isValidName("hello world")) -- false(空格)
```

### 边界处理

- `228-233` 是 CJK 统一汉字的常见 UTF-8 首字节范围,严格来说还要覆盖扩展汉字区(233 也有部分汉字)
- Emoji 通常是 4 字节 UTF-8(首字节 240-247),不在本范围,自然被拒绝
- 标点符号在 ASCII 范围(33-47 等),也被拒绝

## 八、性能注意

- **预编译模式**:`re = utf8.compile? —— Lua 没有,但可以用 upvalue 缓存模式字符串,避免每次构造
- **gsub 大文本**:`gmatch` 迭代比一次性 gsub 内存友好
- **避免 `.-` 跨大范围**:最短匹配在长文本中可能退化,先用 `[^x]+` 限定范围

## 九、模式 vs 正则:速查对照

| 需求 | 正则 | Lua 模式 |
|---|---|---|
| 数字 | `\d+` | `%d+` |
| 字母 | `[a-zA-Z]+` | `%a+` |
| 字母数字 | `[a-zA-Z0-9]+` | `%w+` |
| 空白 | `\s+` | `%s+` |
| 任意字符 | `.*` | `.*` |
| 非贪婪 | `.*?` | `.-` |
| 行首 / 行尾 | `^...$` | `^...$` |
| 反向引用 | `\1` | `%1` |
| 或 | `a\|b` | **无**(写两个 pattern) |
| n 到 m 次 | `a{2,3}` | **无**(写 `aaa?` 之类) |

记忆口诀:**正则的 `\` 在 Lua 里换成 `%`**;不支持的功能(或、计数)只能用多次匹配拼接。

## 参考

- [Lua 5.4 参考手册:Patterns](https://www.lua.org/manual/5.4/manual.html#6.4.1)
- 《Lua 程序设计(第 4 版)》第 10 章

---

[上一篇:Lua 语言核心:table / metatable / 闭包 / OOP](/2024/08/10/lua-core-table-metatable-oop/)
