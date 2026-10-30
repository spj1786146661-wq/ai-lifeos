# AI-LifeOS GitHub 版本发布与自动部署

更新日期：2026-10-30（Asia/Shanghai）

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

### 2. 安装 root-owned 发布脚本

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

### 3. 迁移现有环境文件

保持现有值原样，把服务器环境文件放在 Git 外：

```text
/etc/ai-lifeos/public-beta.env
```

再把它链接或安装为：

```text
/srv/ai-lifeos/shared/public-beta.env
```

不要在本轮重新生成会话密钥、入口密钥或 TokenHub Key。

### 4. 更新 systemd unit

以 `scripts/release/ai-lifeos.service.example` 为基线，把现有服务改成：

```ini
WorkingDirectory=/srv/ai-lifeos/current
EnvironmentFile=/srv/ai-lifeos/shared/public-beta.env
EnvironmentFile=/srv/ai-lifeos/current/release.env
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
```

现有服务名若不是 `ai-lifeos.service`，在
`/etc/ai-lifeos/deploy.conf` 中填写实际名称。发布脚本只重启该服务，
不触碰 Nginx、Tailscale Funnel 或 Xray。

### 5. 配置 SSH 部署密钥

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
PUBLIC_BETA_HOST=<公开 HTTPS 主机名>
DEPLOY_HOST=<SSH 主机名或地址>
DEPLOY_USER=deploy
DEPLOY_PORT=22
DEPLOY_PATH=/srv/ai-lifeos
```

`DEPLOY_KNOWN_HOSTS` 必须来自服务器 SSH host key 的已验证指纹。工作流
使用 `StrictHostKeyChecking=yes`，不提供跳过主机校验的选项。

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
node --check scripts/release/check-release-source.mjs
node --check scripts/release/package-release.mjs
```

工作流会在 GitHub Ubuntu runner 上重复这些检查，并在独立环境中执行
全量串行测试、TypeScript 和生产构建。
