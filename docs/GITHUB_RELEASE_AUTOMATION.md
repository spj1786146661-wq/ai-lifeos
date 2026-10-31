# AI-LifeOS GitHub 版本发布与自动部署

更新日期：2026-10-31（Asia/Shanghai）

## 当前边界

当前 Windows 工作区的 `origin` 仍指向上游
`https://github.com/ashishworkacc/life-tracker.git`，不能把 AI-LifeOS
发布提交推送到该仓库。正式机制要求先建立用户自己的公开 GitHub
仓库，再把现有历史、标签和本阶段文件推送过去。

本轮只新增工作流、服务器脚本、配置样例、测试和本说明。没有创建远程
仓库、没有推送、没有建立版本标签、没有部署或修改 Google Cloud 服务器。

## 发布模型

```text
精确 annotated tag
  -> GitHub Actions 手动触发
  -> 全量串行测试、TypeScript、生产构建
  -> 生成带 SHA-256 的发布包
  -> GitHub production Environment 人工审批
  -> SSH 上传到 /srv/ai-lifeos/incoming
  -> 服务器安装生产依赖并启动候选实例
  -> 候选健康检查
  -> 原子切换 current symlink
  -> 重启 ai-lifeos.service
  -> 新版本健康检查
  -> 失败时自动切回 previous
```

普通提交、普通标签推送和合并都不会自动更新线上。只有
`Manual production release` 工作流可以被手动触发。

服务器运行时固定使用 root 管理的 Node.js `v24.22.2`：

```text
/opt/ai-lifeos/node/bin/node
/opt/ai-lifeos/node/lib/node_modules/npm/bin/npm-cli.js
```

`/opt/ai-lifeos/node` 是指向已校验版本目录的稳定符号链接。发布、候选
启动和正式 systemd 服务均不依赖登录用户的 NVM、shell profile、
`/usr/bin/node` 或 `/usr/bin/npm`。

## GitHub 工作流

- `.github/workflows/manual-release.yml`
  - 输入精确版本标签和 `DEPLOY <tag>` 确认文字。
  - 只接受 annotated semver 标签，例如 `v0.2.0-beta.1`。
  - 验证 GitHub 仓库公开；私库会在构建前失败。
  - 串行运行全部测试、TypeScript、脚本语法检查和生产构建。
  - 构建时写入发布 ID 和精确 tag tree 的 Corresponding Source URL。
  - 在 `production` Environment 人工审批后才进入部署作业。
- `.github/workflows/rollback-public-beta.yml`
  - 手动触发，要求输入 `ROLLBACK PREVIOUS`。
  - 复用同一生产 Environment 审批和同一发布并发组。
  - 只切换到服务器记录的上一正常版本。

两个工作流使用同一并发组：

```text
ai-lifeos-production-release
```

因此发布与回滚不会同时执行。

## 发布版本与 AGPL 源码

构建生成的源码地址格式：

```text
https://github.com/<owner>/<repo>/tree/<tag>
```

部署服务器会在每个 release 目录生成 `release.env`，只包含以下发布
元数据：

```text
AIOS_PUBLIC_BETA_RELEASE_ID=<tag>-<commit12>-r<run>-<attempt>
AIOS_PUBLIC_BETA_SOURCE_URL=https://github.com/<owner>/<repo>/tree/<tag>
AIOS_RELEASE_TAG=<tag>
AIOS_RELEASE_COMMIT=<40-character commit SHA>
AIOS_RELEASE_ARCHIVE_SHA256=<archive checksum>
```

systemd 先读取服务器持久环境文件，再读取
`/srv/ai-lifeos/current/release.env`。后者只覆盖发布 ID、源码地址和
发布元数据，不包含 TokenHub Key、会话密钥、入口密钥或任何用户数据。

公开仓库是该工作流的硬门禁。若仓库为 private，工作流停止，避免部署
版本展示无法访问的 AGPL Corresponding Source 地址。

## 服务器目录

```text
/srv/ai-lifeos/
  releases/
    <release-id>/
  current -> releases/<release-id>
  previous -> releases/<older-release-id>
  incoming/
    release.tar.gz
    release.json
  artifacts/
    <release-id>.tar.gz
    <release-id>.json
  state/
    current
    previous
  shared/
    public-beta.env
```

`shared/public-beta.env` 继续保存现有服务器秘密和 Public Beta 配置，
权限建议 `root:aios 0640`。发布脚本不会创建、覆盖、打印或上传该文件。

## 首次服务器配置

以下操作需要用户明确授权后在服务器执行。当前尚未执行。

### 1. 建立受限发布账号和目录

```bash
sudo useradd --system --create-home --home-dir /var/lib/ai-lifeos --shell /usr/sbin/nologin aios
sudo useradd --create-home --shell /bin/bash deploy
sudo install -d -o aios -g aios -m 0755 /srv/ai-lifeos
sudo install -d -o aios -g aios -m 0755 /srv/ai-lifeos/releases
sudo install -d -o deploy -g deploy -m 0750 /srv/ai-lifeos/incoming
sudo install -d -o root -g aios -m 0750 /srv/ai-lifeos/shared
sudo install -d -o root -g root -m 0755 /srv/ai-lifeos/state /srv/ai-lifeos/artifacts
sudo install -d -o root -g root -m 0755 /etc/ai-lifeos
```

### 2. 安装固定 Node.js 24 运行时

先审查并安装 root-owned 安装器：

```bash
sudo install -o root -g root -m 0755 \
  scripts/release/server/install-node-runtime.sh \
  /usr/local/sbin/aios-install-node-runtime
sudo /usr/local/sbin/aios-install-node-runtime
```

安装器只接受 Node.js `v24.22.2`，从 Node.js 官方 HTTPS 地址下载
`node-v24.22.2-linux-x64.tar.xz`，并使用官方
`SHASUMS256.txt` 中对应的 SHA-256
`48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75`
验证后，安装到 `/opt/ai-lifeos/node-v24.22.2-linux-x64`。稳定入口为
`/opt/ai-lifeos/node`。目录和文件由 `root:root` 持有，group/other
不可写，但 `aios` 服务用户可读取和执行。

安装后验证：

```bash
/opt/ai-lifeos/node/bin/node --version
/opt/ai-lifeos/node/bin/node \
  /opt/ai-lifeos/node/lib/node_modules/npm/bin/npm-cli.js --version
```

不要把维护者 NVM 目录授权给 `deploy` 或 `aios`，也不要把 NVM 路径写入
systemd。`deploy` 账号只需上传发布包并通过 sudo 执行两个固定的
root-owned wrapper；它不需要直接修改 `/opt/ai-lifeos`。

### 3. 安装 root-owned 发布脚本

```bash
sudo install -o root -g root -m 0755 \
  scripts/release/server/deploy-release.sh \
  /usr/local/sbin/aios-deploy-release
sudo install -o root -g root -m 0755 \
  scripts/release/server/rollback-release.sh \
  /usr/local/sbin/aios-rollback-release
sudo install -o root -g root -m 0644 \
  scripts/release/deploy.conf.example \
  /etc/ai-lifeos/deploy.conf
sudo install -o root -g root -m 0440 \
  scripts/release/sudoers-aios-deploy.example \
  /etc/sudoers.d/aios-deploy
sudo visudo -cf /etc/sudoers
```

安装 sudoers 文件前必须把示例中的 `deploy` 改成实际受限 SSH 账号。

### 4. 迁移现有环境文件

保持现有值原样，把服务器环境文件放在 Git 外：

```text
/etc/ai-lifeos/public-beta.env
```

再把它链接或安装为：

```text
/srv/ai-lifeos/shared/public-beta.env
```

不要在本轮重新生成会话密钥、入口密钥或 TokenHub Key。

### 5. 更新 systemd unit

第一次从现有 NVM 服务迁移前，先确认旧 unit 没有 drop-in，并备份当前
实际 unit。备份必须在替换 unit 之前完成：

```bash
test -z "$(systemctl show --property=DropInPaths --value ai-lifeos.service)"
test "$(systemctl show --property=FragmentPath --value ai-lifeos.service)" \
  = "/etc/systemd/system/ai-lifeos.service"
sudo install -d -o root -g root -m 0755 /etc/ai-lifeos/legacy
sudo install -o root -g root -m 0644 \
  /etc/systemd/system/ai-lifeos.service \
  /etc/ai-lifeos/legacy/ai-lifeos.service
```

然后以 `scripts/release/ai-lifeos.service.example` 为基线，把新 unit 安装到
原路径：

```ini
WorkingDirectory=/srv/ai-lifeos/current
EnvironmentFile=/srv/ai-lifeos/shared/public-beta.env
EnvironmentFile=/srv/ai-lifeos/current/release.env
Environment=PATH=/opt/ai-lifeos/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/opt/ai-lifeos/node/bin/node /srv/ai-lifeos/current/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
```

在 `/etc/ai-lifeos/deploy.conf` 中为第一次迁移临时设置：

```text
AIOS_LEGACY_MIGRATION=1
AIOS_SYSTEMD_UNIT_FILE=/etc/systemd/system/ai-lifeos.service
AIOS_LEGACY_UNIT_BACKUP=/etc/ai-lifeos/legacy/ai-lifeos.service
```

执行 `systemctl daemon-reload`，但不要提前重启服务。当前旧进程会继续运行。
首次发布脚本会先确认旧服务仍在 `127.0.0.1:3000` 健康运行，再启动
`3001` 候选版本。候选失败或新正式版本切换失败时，脚本会恢复旧 unit、
重新加载 systemd 并重启原来的 NVM 服务。若旧 unit 备份缺失、与新 unit
相同、存在未审查的 drop-in，或旧服务不健康，迁移会在切换前拒绝继续。

首次发布成功后，把 `AIOS_LEGACY_MIGRATION` 改回 `0`。保留旧 unit 备份，
直到至少一个后续版本也完成发布和回滚演练。第一次成功迁移没有
`state/previous` 管理版本，因此普通回滚工作流不能把它自动回滚到 NVM
旧版；旧版恢复保护专门覆盖首次迁移失败。

现有服务名若不是 `ai-lifeos.service`，在
`/etc/ai-lifeos/deploy.conf` 中填写实际名称。发布脚本只重启该服务，
不触碰 Nginx、Tailscale Funnel 或 Xray。

正式端口保持 `3000`，候选版本使用 `3001`。发布前脚本会先检查候选
端口未被占用，在候选实例通过本机健康检查后才切换 `current`。原有
Nginx、Tailscale Funnel 与 Xray 继续指向正式服务，不需要改为候选
端口。

### 6. 配置 SSH 部署密钥

为 `deploy` 账号建立专用 SSH key，只允许其：

1. 写入 `/srv/ai-lifeos/incoming/`；
2. 无密码执行两个固定的 root-owned 发布命令；
3. 不读取 `/srv/ai-lifeos/shared/public-beta.env`；
4. 不读取其他 release、用户数据、Nginx 配置、Tailscale 状态或 Xray 配置。

不要复用个人管理员 SSH key，不要关闭 SSH 主机校验。

## GitHub Environment 配置

在用户自己的公开 GitHub 仓库中创建 `production` Environment，并设置
required reviewer。

Environment secrets：

```text
DEPLOY_SSH_KEY
DEPLOY_KNOWN_HOSTS
```

Repository variables：

```text
PUBLIC_BETA_HOST=<公开 HTTPS 主机名，可带端口，例如 beta.example.com:8443>
DEPLOY_HOST=<SSH 主机名或地址>
DEPLOY_USER=deploy
DEPLOY_PORT=22
DEPLOY_PATH=/srv/ai-lifeos
```

`DEPLOY_KNOWN_HOSTS` 必须来自服务器 SSH host key 的已验证指纹。工作流
使用 `StrictHostKeyChecking=yes`，不提供跳过主机校验的选项。

工作流会把 `PUBLIC_BETA_HOST` 解析为两个不同值：

```text
构建和应用 Host 白名单：beta.example.com
公网健康检查 Origin：https://beta.example.com:8443
```

因此 `:8443` 会保留在公网 `/` 和 `/source` 验证中，但不会进入
`AIOS_PUBLIC_BETA_HOSTS`。服务器的
`/srv/ai-lifeos/shared/public-beta.env` 同样应把
`AIOS_PUBLIC_BETA_HOSTS` 配置成不带端口的主机名。该拆分不改变
Next.js 的 `127.0.0.1:3000` 监听地址。

## 首次发布流程

1. 建立用户自己的公开 GitHub 仓库。
2. 新增独立 remote；不要覆盖当前上游 `origin`。
3. 确认本阶段未提交工作已按用户授权单独提交。
4. 推送准备发布的 commit 和 annotated tag。
5. 在 GitHub Actions 中手动运行 `Manual production release`。
6. 输入精确 tag 和 `DEPLOY <tag>`。
7. 构建完成后在 `production` Environment 由用户本人审批。
8. 工作流部署并检查公开 `/` 与 `/source`。

## 回滚

服务器保留全部 release 目录，不自动删除。`state/previous` 指向上一
次通过健康检查的版本。回滚工作流只切换 `current` symlink、恢复
`previous` 状态并重启 `ai-lifeos.service`；若旧版本也无法通过健康
检查，会自动恢复回滚前版本并失败退出。

服务器磁盘需要人工监控。清理旧 release 前必须先确认当前和 previous
均不在清理列表中。

## 用户数据边界

- 生活记录仍在用户当前浏览器 localStorage/IndexedDB。
- 发布只切换服务器代码目录，不改变站点 origin，不清理浏览器存储。
- 不迁移、覆盖、删除用户记录、附件、备份或 OAuth 凭据。
- 发布包不包含浏览器数据、服务器环境文件、API Key、SSH key 或日志。
- TokenHub Key 会话记忆功能已存在于当前工作区；下一版本必须一起发布。
- 后续多 Provider 会话记忆必须按 `origin + providerId + model` 隔离，
  清除连接时只删除当前 Provider 对应项。

## 本地验证

```powershell
node --test tests/release-automation.test.mjs
bash -n scripts/release/server/deploy-release.sh
bash -n scripts/release/server/rollback-release.sh
bash -n scripts/release/server/install-node-runtime.sh
node --check scripts/release/check-release-source.mjs
node --check scripts/release/package-release.mjs
node --check scripts/release/public-beta-authority.mjs
```

工作流会在 GitHub Ubuntu runner 上重复这些检查，并在独立环境中执行
全量串行测试、TypeScript 和生产构建。
