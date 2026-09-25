---
title: 版本控制工作流:Git / SVN / GitHub 实战与常见问题
date: 2024-08-10 23:00:00
updated: 2024-08-10 23:00:00
tags:
  - Git
  - SVN
  - GitHub
  - Hook
  - 工程化
categories:
  - [工程化, CI]
comments: true
---

> 这一篇把《Git 安装》《SVN 基础用法》《访问 GitHub 慢》《关闭 Git 自动 GC》《TortoiseGit 报错》《一键切分支》《Git Hooks》《GayHub》八篇笔记整合到一起,讲清 Git/SVN 工作流、SSH 配置、Hook 实战以及踩坑记录。

## 一、版本控制选型:Git vs SVN

| 维度 | Git | SVN |
|---|---|---|
| 模型 | 分布式 | 集中式 |
| 离线操作 | 完整仓库,可离线 commit | 必须连服务器 |
| 分支 | 轻量,鼓励频繁分支 | 重,分支是目录拷贝 |
| 速度 | 本地操作极快 | 依赖网络 |
| 学习曲线 | 较陡 | 平缓 |
| 大文件 / 二进制 | 一般(LFS 弥补) | 较好 |
| 典型场景 | 互联网 / 开源 | 企业内网 / 美术资源 |

游戏项目常见组合:**程序代码用 Git,美术资源(原画、PSD、Maya)用 SVN**。SVN 对大文件友好,且 TortoiseSVN 集成资源管理器对美术同学友好。

<!-- more -->

## 二、Git 安装与 SSH 配置

### 安装

Windows 下从 [git-scm.com](https://git-scm.com/) 下载安装包,一路 Next 即可。

### 全局配置

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

这一步**必须做**,否则提交记录里作者是空的,而且无法生成 SSH 密钥对。

### 配置 SSH(免密推送)

Git 推送到 GitHub 走 SSH 协议,需要先生成密钥对:

```bash
# 1. 检查是否已配置
cd ~/.ssh

# 2. 生成密钥(三次回车,密码留空)
ssh-keygen -t rsa

# 3. 查看公钥
cat ~/.ssh/id_rsa.pub
```

- 私钥 `id_rsa`:绝对不能泄露
- 公钥 `id_rsa.pub`:复制到 GitHub → Settings → SSH keys

Windows 下 `.ssh` 目录在 `C:\Users\Administrator\.ssh`,看不到就用 `ls -ah`。

### TortoiseGit 的 SSH 冲突

TortoiseGit(小乌龟)默认用自己的 SSH 客户端:

```
C:\Program Files\TortoiseGit\bin\sshaskpass.exe
```

会与 Git 自带的 SSH 冲突。改 Setting → Network → SSH client:

```
C:\Program Files\Git\usr\bin\ssh.exe
```

否则会报 `No supported authentication methods available`。

## 三、Git 常用工作流

### 个人开发:main + feature

```bash
git checkout -b feature/login
# ...开发...
git add .
git commit -m "feat: 实现登录"
git checkout main
git merge feature/login
git branch -d feature/login
```

### 团队协作:Git Flow 简化版

```
main        生产分支,只接受 merge
develop     集成分支
feature/*   功能分支
hotfix/*    紧急修复
release/*   发布分支
```

### PR 工作流(GitHub)

1. fork 仓库 / 或在自己有权限的分支上开发
2. push 到远程分支
3. 在 GitHub 上发 PR
4. Code Review
5. Squash merge 到 main

## 四、一键切换所有项目分支

实际项目里同时维护多个仓库(客户端、服务端、配置库),切分支要切换 N 次,用 shell 脚本批量处理:

```bash
#!/bin/bash
echo "<<<<<<<<温馨提示:请将该脚本放在存放项目的文件中,和项目路径同级>>>>>>>>>"
read -p "请输入你要切换的分支:" branch

for dir in $(ls)
do
  if test -d $dir
  then
    cd $dir
    git checkout ${branch}
    echo ">>>>>>>"$dir"已切换分支:${branch}"
    cd ..
  else
    echo "<当前不是目录>"
  fi
done
```

把脚本放在仓库根目录的同级,跑一次就把所有子目录切到同一分支。

## 五、常见问题与解决

### 问题 1:GitHub 访问慢,推送拉取卡

**原因**:`github.global.ssl.fastly.net` 域名被限速。

**解决**:用 IP 查询网站(如 [ipaddress.com](https://www.ipaddress.com/))查到对应 IP,加进 hosts:

```
# C:\Windows\System32\drivers\etc\hosts
199.232.5.194   github.global-ssl.fastly.net
140.82.114.3    github.com
```

改完刷 DNS 缓存(Windows):

```bash
ipconfig /flushdns
```

### 问题 2:Git 频繁卡在 AutoGC

每次操作都看到 `Auto packing the repository` 提示,非常烦。

**原因**:Git 默认每达到一定阈值就自动 `git gc`,大仓库会很慢。

**关闭自动 GC**:

```bash
git config --global gc.auto 0
```

需要清理时手动跑:

```bash
git gc --prune=now
```

### 问题 3:TortoiseGit 报 No supported authentication methods available

见上文 SSH 配置那节,改 SSH client 路径到 Git 自带的 `ssh.exe` 即可。

### 问题 4:SVN 查看提交记录报错

SVN 配合 Rider / IDEA 使用时,有时查看 log 报"Unable to find repository location"。

**解决**:在 SVN 客户端里 `Relocate` 一次,确认 working copy 路径与远端 URL 对应。

### 问题 5:Git 推送被拒(non-fast-forward)

```bash
git pull --rebase origin main
# 解决冲突
git add .
git rebase --continue
git push
```

`--rebase` 比 `merge` 干净,不会留 merge commit。

## 六、Git Hooks:自动化的钩子

Hook 是 Git 在特定时机触发的脚本,位于 `.git/hooks/` 目录,默认有 `.sample` 后缀的样例文件,改名(去掉 `.sample`)即可生效。

### 常用 Hook

| Hook | 触发时机 | 用途 |
|---|---|---|
| `pre-commit` | `git commit` 之前 | 代码风格检查、敏感信息扫描 |
| `commit-msg` | 写完提交信息后 | 校验 commit message 格式 |
| `pre-push` | `git push` 之前 | 跑测试、阻止向 main 推 |
| `post-merge` | merge 之后 | 自动 npm install |
| `pre-receive` | 服务端收到推送 | CI 触发 |

### 实战:校验分支与版本号一致

游戏项目里,常常要求"客户端分支必须与配置版本号匹配",否则 SDK 资源对不上。可以用 `pre-commit`:

```bash
#!/bin/bash
# .git/hooks/pre-commit

# 取当前分支
branchname=$(git branch | grep "*" | awk '{print $2}')

# 从某个配置文件读出版本号
version=$(cat Assets/VERSION.txt)

# 比较
if [ "$version" != "$branchname" ]; then
    echo "Error: VERSION.txt($version) 与分支($branchname) 不一致!"
    echo "请先修改版本号再提交"
    exit 1
fi
```

### 实战:校验 commit message 格式

```bash
#!/bin/bash
# .git/hooks/commit-msg

msg=$(cat $1)
# 强制格式:[type] xxx,type 必须是 feat/fix/docs/chore/refactor
pattern="^\[(feat|fix|docs|chore|refactor)\] .+"
if [[ ! $msg =~ $pattern ]]; then
    echo "Error: commit message 必须形如 [feat] xxx"
    exit 1
fi
```

### Hook 与团队共享

`.git/hooks/` 不会被 git 追踪,要让团队共享,常见做法:

1. 把 hook 脚本放在仓库的 `scripts/hooks/`
2. 文档里要求每个新成员 `cp scripts/hooks/pre-commit .git/hooks/`
3. 或用 [Husky](https://typicode.github.io/husky/) (前端项目)、[pre-commit](https://pre-commit.com/) (Python / 通用)自动安装

## 七、SVN 配合 Rider / Unity 的使用要点

- **首次 checkout** 用 TortoiseSVN,避免 IDE 把元数据搞乱
- **提交前 update**:多人协作时,先 `svn update` 再 commit,避免冲突堆积
- **冲突解决**:TortoiseSVN 提供 GUI 三方合并,比 Git 命令行直观
- **大文件**: SVN 处理 100MB+ 的 PSD / Maya 文件比 Git 稳定,所以美术资源走 SVN 是行业惯例

## 八、常用 Git 命令速查

```bash
# 分支
git branch -a                    # 查看所有分支
git checkout -b feature/x        # 新建并切换
git branch -d feature/x          # 删除本地
git push origin --delete feature/x  # 删除远程

# 撤销
git reset --soft HEAD^           # 撤销 commit,保留改动
git reset --hard HEAD^           # 撤销 commit + 改动(危险)
git checkout -- file             # 丢弃工作区改动
git restore --staged file        # 把暂存区撤回工作区

# 暂存
git stash                        # 临时保存改动
git stash pop                    # 恢复改动

# 历史
git log --oneline --graph        # 简洁历史
git reflog                       # 查看所有操作记录(救命)
```

## 参考

- [Pro Git 中文版](https://git-scm.com/book/zh/v2)
- [Git Hooks 编写使用](https://blog.csdn.net/baidu_27652997/article/details/130723889)
- [关闭 Git 自动 GC 方法](https://blog.csdn.net/fromfire2/article/details/109857219)
- [访问 GitHub 慢问题](https://blog.csdn.net/dddzrhnb/article/details/118635970)

---

下一篇:[Jenkins 自动化打包:Unity iOS / Android 全流程](2024-08-10-ci-jenkins-unity-build.md) — 整合自 Jenkins 安装、打包细则、本地打包三篇笔记。
