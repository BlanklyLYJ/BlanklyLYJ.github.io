---
permalink: 2024/08/10/ci-tools-website-ftp-wol/
title: 小工具集:网站搭建 / FTP / WOL 远程唤醒
date: 2024-08-10 23:45:00
updated: 2024-08-10 23:45:00
tags:
  - 网站
  - FTP
  - WOL
  - Hexo
  - 工程化
categories:
  - [工程化, CI]
comments: true
---

> 这一篇把《网站搭建》《搭建博客》《FTP 服务器搭建》《WOL 远程唤醒》四篇笔记整合到一起。这些都是工程化里"非主线但必不可少"的小工具:博客做文档沉淀,FTP 做内网共享,WOL 让你能远程开机调代码。

## 一、为什么要把这些写在一起

这些工具看起来零散,但都属于"**搭基础设施**"的范畴,是任何独立开发者 / 小团队迟早要面对的。把它们集中在一篇,以后翻笔记的时候至少能找到入口。

<!-- more -->

## 二、个人博客搭建:Hexo + GitHub Pages

技术博客最主流的方案是 **Hexo + GitHub Pages**,免费、稳定、能自定义域名。

### 整体架构

```
本地写 Markdown → Hexo 生成静态站 → git push 到 GitHub Pages 仓库 → GitHub 自动发布
```

### 安装

依赖 Node.js 和 Git,装好后:

```bash
# 安装 Hexo CLI
npm install -g hexo-cli

# 初始化博客
hexo init my-blog
cd my-blog
npm install

# 本地预览
hexo server
# 访问 http://localhost:4000
```

### 选择主题

Hexo 默认主题 landscape 比较朴素,常见替换:

- **NexT**:最经典,功能全
- **Butterfly**:颜值高,卡片化(本博客用的就是它)
- **Fluid**:简洁,适合技术博客

```bash
# 安装 Butterfly
git clone -b master https://github.com/jerryc127/hexo-theme-butterfly.git themes/butterfly
```

`_config.yml` 改 `theme: butterfly`,装依赖:

```bash
npm install hexo-renderer-pug hexo-renderer-stylus --save
```

### 写文章

```bash
hexo new post "我的第一篇"
```

生成 `source/_posts/我的第一篇.md`,在 frontmatter 写好 `title / date / tags / categories`,下面写正文。

`<!-- more -->` 是摘要分隔符,首页只显示这之前的部分。

### 部署到 GitHub Pages

1. 新建仓库 `<username>.github.io`(必须用这个命名)
2. `_config.yml` 配置:

```yaml
deploy:
  type: git
  repo: https://github.com/<username>/<username>.github.io.git
  branch: main
```

3. 一键部署:

```bash
hexo clean
hexo generate
hexo deploy
```

打开 `https://<username>.github.io` 就能访问。

### 自定义域名(可选)

GitHub Pages 项目 → Settings → Pages → Custom domain,填入自己的域名,CNAME 解析到 `<username>.github.io`。

## 三、网站搭建:从 VPS 到 HTTPS

如果想要更自由(不被 GitHub 限制),可以租一台 VPS 自己搭。

### 选型

| 方案 | 适合 | 成本 |
|---|---|---|
| GitHub Pages | 静态站,个人博客 | 免费 |
| Vercel / Netlify | 静态 + Serverless | 免费起步 |
| VPS (阿里 / 腾讯 / Vultr) | 完全控制,动态站 | 月付几十 |
| 家庭宽带 + 内网穿透 | 自托管 | 流量费 |

### VPS 上跑 Hexo

```bash
# 装 Node.js + Nginx
sudo apt install nodejs npm nginx

# clone 编译产物
git clone https://github.com/<user>/<user>.github.io.git /var/www/blog

# Nginx 配置
sudo vim /etc/nginx/sites-available/blog
```

```nginx
server {
    listen 80;
    server_name blog.example.com;
    root /var/www/blog;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### HTTPS:Let's Encrypt 免费证书

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d blog.example.com
```

证书 90 天过期,certbot 会自动续期(装好后默认装了 systemd timer)。

## 四、FTP 服务器搭建(Windows)

游戏项目里美术同学经常要传 PSD / Maya / 视频,FTP 依然是简单粗暴的选择。

### 安装 FileZilla Server

1. 下载 [FileZilla Server](https://filezilla-project.org/)
2. 安装时勾选"作为服务启动"
3. 启动 Admin 界面,默认端口 14147

### 配置用户

1. Server → Configure → Users → Add
2. 用户名 + 密码
3. Shared folders:添加可访问目录,设置权限(读 / 写 / 删 / 创建目录 / 列文件)
4. Speed limits:可限速,避免占用全部带宽

### 防火墙 / 路由器

- Windows 防火墙放行 21 端口(控制)和被动模式端口区间(如 50000-51000)
- 路由器做端口映射:外网 21 → 内网 FTP 服务器 21
- 公网访问建议改用 **SFTP / FTPS**,FTP 明文传输密码不安全

### Unity 项目 FTP 分发

打包后的 APK / IPA,可以用脚本自动上传 FTP,团队内部下载:

```python
import ftplib
ftp = ftplib.FTP("ftp.example.com")
ftp.login("user", "pass")
with open("game.apk", "rb") as f:
    ftp.storbinary(f"/builds/game_1.0.0.apk", f)
ftp.quit()
```

## 五、WOL(Wake On LAN):远程唤醒电脑

场景:在外面想调家里的代码,但电脑关着。WOL 让你通过"魔术包"把电脑开机。

### 原理

主板 + 网卡支持 WOL 时,关机后网卡仍由待机电压供电,持续监听特定的"魔术包",收到就触发主板上电。

魔术包格式:

```
6 字节 0xFF + 16 次重复目标 MAC 地址
通过 UDP 广播到局域网
```

### 配置步骤(以华硕 X570 + Intel I211 为例)

#### 1. 路由器:绑定 IP 和 MAC

登录路由器(192.168.0.1 / 192.168.1.1)→ DHCP 设置 → 把目标电脑的 MAC 与 IP 绑定。**这一步必须做**,否则 DHCP 重新分配 IP 后 WOL 失效。

#### 2. BIOS:开启 LAN 唤醒

进入 BIOS → Advanced / Power 菜单:
- `Power On By PCI-E` → Enabled
- `Power On By RTC` → 视情况
- 华硕叫 `Wake on LAN` / `PME Wake Up`

不同主板名字不同,带 LAN / Wake / PME 字样的全开。

#### 3. 网卡驱动:开启魔术包唤醒

设备管理器 → 网络适配器 → 右键有线网卡 → 属性:

- **电源管理**:三个勾全勾(允许计算机关闭此设备以节约电源 / 允许此设备唤醒计算机 / 只允许幻数据包唤醒)
- **高级**:`Wake on Magic Packet` → Enabled,`启动 PME` → Enabled(注意!这个不开唤醒不了)

不同网卡属性名字不一,带 Wake / PME 字样的全启用。

#### 4. 验证网卡供电

正常关机(S5 状态),看网口灯是否闪烁:
- 灯亮 → 网卡有电,能收魔术包
- 灯灭 → BIOS / 网卡没配好,从头再来

#### 5. 测试唤醒

下载 [WakeOnLAN](https://www.wakeonlan.me/) 客户端(PC / 手机微信小程序都有),输入目标 IP + MAC,点唤醒。电脑端可以用 Wireshark 抓 UDP 9 端口确认收到。

### 外网唤醒

公网唤醒需要满足:

- **公网 IPv4**(个人宽带通常没有,企业用户大概率有)
- 或 **DDNS**(花生壳 / nat123 / 每步),动态域名解析
- 或 **IPv6**(移动 / 联通新装宽带很多默认有,走 IPv6 桥接)
- 或 **frp 内网穿透**(有公网服务器的话)

个人推荐 **IPv6 + DDNS** 方案:家用宽带基本都有 IPv6,搭一个免费的 DDNS(如 dnspod) + frp 通道,外网就能唤醒。

### 重要限制

**WOL 只在 S5(正常关机)状态下生效**。休眠(S4)、快速启动(S0ix)可能不行。Windows 的"快速启动"要关掉,否则名义上是关机实际上是混合休眠。

## 六、小结

| 工具 | 价值 | 维护成本 |
|---|---|---|
| Hexo + GitHub Pages | 文档沉淀 / 个人品牌 | 极低 |
| VPS + Nginx | 完全控制 | 中(要续费 / 防黑) |
| FTP | 美术资源传大文件 | 低 |
| WOL | 远程开机调代码 | 一次性配置 |

这些工具单看都不复杂,但**搭好一次,后面几年都受益**。值得花一个周末把基础设施铺一遍。

## 参考

- [Hexo 官方文档](https://hexo.io/zh-cn/)
- [Butterfly 主题文档](https://butterfly.js.org/)
- [FTP 服务器搭建](https://blog.csdn.net/2301_76989163/article/details/137077426)
- [WOL 远程唤醒原理与陷阱](https://zhuanlan.zhihu.com/p/28859620)

---

下一篇:[SDK 与平台接入:Google 登录 / 支付 / 数数 / Crasheye](2024-08-10-sdk-google-login-payment-analytics.md) — 整合自 SDK 接入的八篇笔记。
