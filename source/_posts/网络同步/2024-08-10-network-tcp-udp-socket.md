---
permalink: 2024/08/10/network-tcp-udp-socket/
title: 网络基础:TCP/UDP 协议对比与 Socket 编程
date: 2024-08-10 22:00:00
updated: 2024-08-10 22:00:00
tags:
  - 网络
  - TCP
  - UDP
  - Socket
categories:
  - [网络, 同步]
comments: true
---

> 这一篇整理自 TCP/UDP 协议、聊天室设计、网络连接流程几篇笔记,目标是把"协议选型 → Socket API → 实战聊天室"的链路串起来,顺带把客户端登录时建立 TCP 连接的完整流程拆解一遍。

## 一、为什么有 TCP 和 UDP 两种协议

传输层有两个主力协议:**TCP** 面向连接、可靠;**UDP** 无连接、轻量。它们的差异不是"哪个更好",而是面向不同的应用场景。

| 维度 | TCP | UDP |
|---|---|---|
| 连接 | 三次握手建立连接 | 无连接 |
| 可靠性 | 可靠(ACK + 重传 + 序号) | 不可靠(尽最大努力) |
| 顺序 | 有序到达,接收端按序重组 | 无序,可能乱序 / 丢包 |
| 流控 / 拥塞控制 | 滑动窗口 + 拥塞避免 | 无 |
| 头部开销 | 20 字节起 | 8 字节 |
| 传输形式 | 字节流 | 数据报 |
| 典型场景 | HTTP / 登录 / 聊天 / 状态同步 | DNS / 实时语音 / 帧同步 |

游戏里的经验法则:**登录、聊天、回合制**走 TCP;**MOBA、FPS、ARPG 战斗**走 UDP(或者 KCP 这种基于 UDP 的可靠层),因为延迟比可靠性更敏感。

<!-- more -->

## 二、Socket:协议之上的编程接口

Socket 是操作系统提供给应用层的网络编程接口,它把"协议 + IP + 端口"封装成一个文件描述符,读写它就像读写文件。

C# 里 Socket 类位于 `System.Net.Sockets`,三种核心参数:

```csharp
new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
new Socket(AddressFamily.InterNetwork, SocketType.Dgram,  ProtocolType.Udp);
```

- `AddressFamily.InterNetwork`:IPv4
- `SocketType.Stream` 流式 / `Dgram` 数据报
- `ProtocolType.Tcp` / `Udp`

辅助类型:
- `IPAddress`:IP 地址,可用 `IPAddress.Parse("192.168.1.102")` 从字符串构造
- `IPEndPoint`:IP + 端口,端口范围 0~65535(<1024 是系统保留)
- `Encoding.UTF8.GetBytes(...)` / `GetString(...)`:字符串和字节流的相互转换

## 三、TCP 服务端 / 客户端最小实现

### 服务端

```csharp
using System.Net;
using System.Net.Sockets;
using System.Text;

// 1. 创建 Socket
Socket tcpServer = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);

// 2. 绑定 IP + 端口
IPAddress ip = new IPAddress(new byte[] { 192, 168, 1, 102 });
EndPoint point = new IPEndPoint(ip, 7890);
tcpServer.Bind(point);

// 3. 监听,最大等待队列 100
tcpServer.Listen(100);

// 4. 阻塞等待客户端连接,返回一个新的 Socket 用于通信
Socket clientSocket = tcpServer.Accept();

// 5. 发送 / 接收
byte[] data = Encoding.UTF8.GetBytes("李在干神魔?");
clientSocket.Send(data);

byte[] recData = new byte[1024];
int length = clientSocket.Receive(recData);
Console.WriteLine(Encoding.UTF8.GetString(recData, 0, length));
```

### 客户端

```csharp
Socket tcpClient = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
EndPoint point = new IPEndPoint(IPAddress.Parse("192.168.1.102"), 7890);
tcpClient.Connect(point);   // 三次握手在这步完成

byte[] data = new byte[1024];
int length = tcpClient.Receive(data);
Console.WriteLine(Encoding.UTF8.GetString(data, 0, length));

string input = Console.ReadLine();
tcpClient.Send(Encoding.UTF8.GetBytes(input));
```

**关键点**:`Accept()` 是阻塞的,真实项目里要么开线程,要么用 `BeginAccept` / `AcceptAsync` 异步版本。

## 四、UDP 服务端 / 客户端

UDP 不需要 `Accept` / `Connect`,直接收发:

### 服务端

```csharp
Socket udpServer = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
udpServer.Bind(new IPEndPoint(IPAddress.Parse("192.168.1.102"), 7890));

new Thread(() =>
{
    while (true)
    {
        EndPoint remote = new IPEndPoint(IPAddress.Any, 0);
        byte[] data = new byte[1024];
        // ref 表示 ReceiveFrom 可以把"数据来源"回填到 remote
        int len = udpServer.ReceiveFrom(data, ref remote);
        var ep = (IPEndPoint)remote;
        Console.WriteLine($"{ep.Address}:{ep.Port} -> {Encoding.UTF8.GetString(data, 0, len)}");
    }
}) { IsBackground = true }.Start();
```

### 客户端

```csharp
Socket udpClient = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
EndPoint server = new IPEndPoint(IPAddress.Parse("192.168.1.102"), 7890);
while (true)
{
    string msg = Console.ReadLine();
    udpClient.SendTo(Encoding.UTF8.GetBytes(msg), server);
}
```

注意 `ReceiveFrom(data, ref remote)` 用 `ref` 把发送方地址塞回 `remote`,这是 UDP 没有"连接"概念的关键:每次收包都得知道是谁发的。

## 五、封装类:TcpListener / TcpClient / UdpClient

直接用 `Socket` 比较啰嗦,.NET 提供了一层封装:

```csharp
// TCP
TcpListener listener = new TcpListener(ipAddress, port);
listener.Start();
TcpClient client = listener.AcceptTcpClient();

// UDP
UdpClient client = new UdpClient(ipAddress, port);
client.Receive(ref point);
```

封装类内部还是 `Socket`,但提供了 `GetStream()` 这种基于 `NetworkStream` 的高级 API,可以配合 `StreamReader` / `StreamWriter` 用。

## 六、实战:多人聊天室

聊天室的核心是**服务端维护一个客户端列表,收到消息后广播给所有人**。

### 服务端骨架

```csharp
// 1. 创建并监听
Socket server = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
server.Bind(new IPEndPoint(IPAddress.Parse("192.168.0.1"), 7890));
server.Listen(100);

List<Client> clients = new List<Client>();

while (true)
{
    Socket sock = server.Accept();
    Client c = new Client(sock);
    clients.Add(c);
}
```

### Client 类(每个连接一个)

```csharp
class Client
{
    private Socket socket;
    private Thread t;
    private byte[] data = new byte[1024];

    public Client(Socket s) {
        socket = s;
        t = new Thread(ReceiveMessage) { IsBackground = true };
        t.Start();
    }

    void ReceiveMessage()
    {
        while (true)
        {
            // Poll 10ms 看看是否可读,可读 = 有数据 OR 对端关闭
            if (socket.Poll(10, SelectMode.SelectRead))
            {
                int len = socket.Receive(data);
                if (len == 0) { socket.Close(); return; }  // 对端关闭
            }
            string msg = Encoding.UTF8.GetString(data, 0, len);
            Program.BroadcastMessage(msg);
        }
    }

    public void Send(string msg) => socket.Send(Encoding.UTF8.GetBytes(msg));
}
```

### 广播 + 清理

```csharp
static void BroadcastMessage(string msg)
{
    List<Client> dead = new List<Client>();
    foreach (var c in clients)
    {
        if (!c.IsConnected) dead.Add(c);
        else c.Send(msg);
    }
    foreach (var d in dead) clients.Remove(d);  // 清理已断开
}
```

### Unity 客户端

```csharp
void Start()
{
    clientSocket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
    clientSocket.Connect(new IPEndPoint(IPAddress.Parse("192.168.0.1"), 7890));
    new Thread(ReceiveLoop) { IsBackground = true }.Start();
}

void ReceiveLoop()
{
    byte[] data = new byte[1024];
    while (clientSocket.Connected)
    {
        int len = clientSocket.Receive(data);
        messageQueue.Enqueue(Encoding.UTF8.GetString(data, 0, len));
    }
}

void OnDestroy()
{
    clientSocket?.Shutdown(SocketShutdown.Both);  // 不发不收
    clientSocket?.Close();
}
```

Unity 里跨线程更新 UI,要把收到的消息塞进队列,主线程 `Update` 里出队渲染。

## 七、登录流程:TCP 连接是怎么建立的

下面这套流程来自项目实战,讲的是 SOP(登录服)→ Game Server(游服)的连接切换:

1. 玩家点击登录,客户端 `login_state == Step_None` 进入第一条分支
2. 调用 `RemoteBuilderMgr.RemoteBuilder(new LoginRemoteBuilder())` 创建一个 TCP 实例
3. 注册三条回调:连接成功、断开、收到数据
4. `ConnectServer(ip, port)` 内部:
   - 解析 IP,如果已存在 socket 则先关掉
   - `new Socket(...)`,初始化包头缓冲
   - 调用 `socket.BeginConnect`,回调里 `EndConnect` 完成握手
5. 握手成功后把 `_networkConnectedEvent` 压入帧推栈,然后 `Receive()`
6. `Receive()` 调 `BeginReceive`,回调 `EndReceive` 收数据
7. 数据接收是分包的:`_recvStream.Position` 记录当前进度,长度不够就继续收;够了就 `ProcessPacket` 解析包体
8. 包体进入 `_packetQueue`,帧推执行时通过 `LUA_LSReceiverProcess` 抛给 Lua

切换到游服时:
- Lua 通知 C# 停掉当前 LoginServer 连接
- `LSRemoteBuilder` 卸载,新的 `GSRemoteBuilder` 装载
- 整个过程对 Lua 层透明

`SendMessage` 的发送链路:
- `Send` → `DoSend`,先写包头(包体长度),再写包体
- `socket.BeginSend` 完成后回调检查是否全部写完,没写完继续

## 八、踩过的坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `Receive` 一直返回 0 | 对端已关闭 | `Poll` + `Receive == 0` 判定断开 |
| 跨线程访问 UI 报错 | Socket 回调在子线程 | 队列 + 主线程 Update 出队 |
| 包粘在一起 / 半截 | TCP 是字节流,无边界 | 自定义包头(长度字段) + 缓冲流 |
| 同一连接收发互扰 | 没区分读写缓冲 | `_recvStream` / `_sendStream` 分离 |
| 主线程卡死 | `Accept` / `Receive` 阻塞 | 后台线程或异步 API |

## 九、协议选型小结

```
登录 / 聊天 / 大厅 / HTTP → TCP
MOBA / FPS / 实时战斗   → UDP(或 KCP / ENET)
DNS / 心跳 / 发现服务     → UDP
```

记住一句话:**TCP 强调"对",UDP 强调"快"**。游戏里常见的组合拳是登录 + 聊天走 TCP、战斗走 UDP,登录成功后再开第二条 UDP 连接,各司其职。

## 参考

- [C# Socket 官方文档](https://learn.microsoft.com/zh-cn/dotnet/api/system.net.sockets.socket)
- 《网络是怎样连接的》(户根勤)
- [细谈网络同步在游戏历史中的发展变化](https://zhuanlan.zhihu.com/p/130702310)

---

下一篇:[游戏同步方案:帧同步 vs 状态同步](2024-08-10-network-sync-framelock-vs-state.md) — 整合自《帧同步》《状态同步》《王者荣耀逻辑渲染分离》《明日方舟帧对齐》四篇笔记。
