# AI-LifeOS Web Public Beta 单实例部署说明

更新日期：2026-10-28

## 适用架构

首期只支持一个长期运行的 Next.js Node.js 进程：

```text
Internet
  -> Tencent Cloud HTTPS / Nginx (80 redirects to 443)
  -> 127.0.0.1:3000 (one next start process)
  -> fixed TokenHub HTTPS endpoint, with each user's request-level API Key
```

当前 Chat、连接测试和 Follow-up 的限流、并发预算及幂等缓存都是单进程内存状态。不得配置第二个应用实例、Serverless、多进程 Cluster 或自动横向扩容。需要多实例时，必须先用 Redis、PostgreSQL 等共享原子存储替换，并重新验证并发幂等、限流和会话隔离。

## 可选：SSH 隧道个人 Alpha BYOK

个人 Alpha 只用于维护者通过 SSH 隧道访问一台服务器的场景，不属于 Public Beta。它默认关闭，并通过完整 Host 绑定启用：

```text
AIOS_PERSONAL_ALPHA_BYOK=1
AIOS_PERSONAL_ALPHA_BYOK_HOST=localhost:3100
```

启用后，只有浏览器请求的 `Host` 完整等于 `localhost:3100` 时，页面才显示 TokenHub 三步 BYOK 向导。`127.0.0.1`、`::1`、局域网 IP、公网域名、通配符、其他端口或缺失端口都不会匹配。连接测试、Chat、数据分析和 Follow-up 会在服务端再次执行相同判断；该模式下没有请求级 Key 时直接拒绝，不会回退到开发者个人 Key。

服务器只监听回环地址：

```bash
npm run start -- --hostname 127.0.0.1 --port 3100
```

Windows 客户端建立 SSH 隧道后访问：

```text
http://localhost:3100
```

该模式使用 HTTP 回环隧道，不能直接把 3100 端口暴露到公网。API Key 默认只保存在当前页面内存；用户主动勾选后，可在当前标签页和 `localhost:3100` 精确来源的 `sessionStorage` 中保存到本次浏览会话结束。断开或主动清除会删除该凭据。Public Beta 的公网 Host、Origin、CSRF、可信入口、会话和路由白名单检查保持启用且不受此模式影响。

## 腾讯云控制台需要人工确认

1. 只保留 **1 个**应用实例；实例组期望数量、最小数量和最大数量均设为 1。
2. 关闭自动横向扩容、函数并发扩容、滚动期间双实例同时接流量等会产生并行应用进程的配置。
3. 公网安全组只开放 80/443；Next.js 3000 端口只监听 `127.0.0.1`，不向公网或 VPC 其他主机开放。
4. 绑定正式域名和受信任 TLS 证书；80 永久重定向到 443。
5. 设置 CPU、内存、磁盘和出站流量告警。AI 费用由用户自己的 TokenHub Key 承担，但仍需防止应用资源滥用。
6. 不在 Public Beta 进程配置开发者 TokenHub/OpenRouter Key、Firebase 客户端配置、Firebase Admin 凭据或个人 ChatGPT OAuth 凭据。
7. 上传与实际部署 commit/tag 对应的 Corresponding Source，并把真实 HTTPS 地址和发布版本写入环境变量。

## 可信 HTTPS 入口

公网请求必须经过反向代理。反向代理需要：

- 丢弃客户端传入的 `X-AIOS-Ingress-Secret`，再写入服务器保存的正确值。
- 覆盖 `Host`，不要把任意客户端 Host 原样转发。
- 不把客户端 `X-Forwarded-For` 当作 AI-LifeOS 身份或额度依据。当前应用完全不使用这些头做授权。
- 仅把流量转发到 `127.0.0.1:3000`。

Nginx 关键配置示例（占位值必须人工替换）：

```nginx
server {
  listen 80;
  server_name beta.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name beta.example.com;

  # ssl_certificate / ssl_certificate_key 使用腾讯云签发的真实文件。

  location / {
    proxy_set_header Host beta.example.com;
    proxy_set_header X-AIOS-Ingress-Secret "与 AIOS_PUBLIC_BETA_INGRESS_SECRET 相同的服务器秘密";
    proxy_set_header X-Forwarded-For "";
    proxy_set_header Forwarded "";
    proxy_pass http://127.0.0.1:3000;
  }
}
```

入口秘密和会话签名秘密必须不同，均至少 32 个随机字符，只保存在服务器受限配置中。

## 构建与启动

1. 使用 Node.js 20 或更高版本，执行锁文件安装。
2. 根据 `.env.public-beta.example` 创建仓库外的服务器环境文件。
3. 确认 `AIOS_PUBLIC_BETA_RELEASE_ID` 与源码地址完全对应。
4. 执行 `npm run build`。
5. 只启动一个进程：

```powershell
npm run start -- --hostname 127.0.0.1 --port 3000
```

生产模式关键配置不完整、Corresponding Source 地址缺失、开发者 Key/Firebase 凭据误配、入口秘密错误或拓扑不是单实例时，公网 Host 会返回 503/403，不会静默退回开发模式。

## 发布包边界

Corresponding Source 应包括当前修改版源码、`package.json`、锁文件、构建配置、环境变量模板、README、LICENSE、第三方通知及构建运行说明。不得包含：

- `.env.local` 或服务器真实环境文件；
- TokenHub、OpenRouter、OAuth、Telegram、Firebase 密钥；
- 浏览器记录、IndexedDB、备份和附件；
- `.next`、运行日志和本机凭据文件。
