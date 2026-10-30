# Next.js 16 Proxy 迁移与路由安全检查

检查日期：2026-10-26
项目：AI-LifeOS 的 `life-tracker` 目录
分支：`feature/ren-sheng-shu-ju-cang-v1`
检查时 HEAD：`c9cb724ddd30d1cb6674f1d9794f4c45316b8721`

## 结论摘要

- `middleware.ts` 的删除和 `proxy.ts` 的新增，符合 Next.js 16 将 Middleware 改名为 Proxy 的官方迁移方向。
- `proxy.ts` 导出了 Next.js 16 要求的 `proxy` 函数，并保留了原 matcher。
- 当前实现不只是透传：它增加了 loopback、私有 IPv4 LAN、精确公网测试白名单和默认拒绝策略。
- 已修复一个内部验证头可被浏览器伪造后穿透到下游的问题。
- 当前没有发现 Proxy 自身阻止正式构建的明确代码错误；完整生产构建仍未验证，原因是本机文件系统权限和 Turbopack 的 Windows junction 问题。
- 旧 API 的业务级认证仍不完整。Proxy 不能替代每个敏感 API 自己的认证、授权和审计，正式公网部署前必须补齐或保持这些接口不可访问。

## 1. 版本与官方迁移规范

`package.json` 中的 Next.js 版本为 `16.1.6`。该版本的官方迁移要求包括：

- 将 `middleware.ts` 改名为 `proxy.ts`；
- 将导出的 `middleware` 函数改名为 `proxy`；
- Proxy 使用 Node.js 运行时；
- 与 Middleware 相关的配置名称使用 Proxy 命名，例如 `skipProxyUrlNormalize` 和 `experimental.proxyClientMaxBodySize`。

官方参考：

- <https://nextjs.org/docs/app/guides/upgrading/version-16>
- <https://nextjs.org/docs/app/api-reference/file-conventions/proxy>
- <https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize>

## 2. Git HEAD 中的原 middleware.ts

通过 `git show HEAD:middleware.ts` 读取原文件。原实现为全量透传：

```ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Auth is handled client-side by AppLayout (lib/hooks/useAuth).
// Middleware passes all requests through — no server-side cookie check needed.
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)',
  ],
}
```

原文件没有重定向、重写、请求头注入、认证或安全响应头逻辑。它本身不是一个服务端认证边界。

## 3. 当前 proxy.ts 对照

### 3.1 导出与 matcher

当前文件导出 `async function proxy(request: NextRequest)`，并保留完全相同的 matcher：

```text
/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)
```

因此静态资源排除范围没有缩小，原先会经过 Middleware 的页面和 API 仍会经过 Proxy。

### 3.2 loopback 模式

当 Host 是 `localhost`、`127.0.0.1`、`::1` 或 `[::1]` 时：

- 请求被放行；
- 浏览器提交的 `x-aios-lan-verified` 被删除；
- 浏览器提交的 `x-aios-public-test-verified` 被删除；
- 响应增加 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 和 `Cross-Origin-Resource-Policy`。

这保持了原有本机使用方式，同时避免把内部验证标记当成浏览器可自行声明的授权。

### 3.3 公网测试模式

只有当 Host 精确匹配 `AIOS_PUBLIC_TEST_HOSTS` 中的条目时才进入公网测试模式。该变量没有通配符支持。

公网测试模式只开放：

- `GET /model-test`
- `HEAD /model-test`
- `POST /api/model-test/chat`

POST 还必须满足与请求 Host 完全一致的 HTTPS Origin。其他路径返回 403。该模式不开放生活记录、OAuth、Telegram、健康数据、备份或管理员接口。

### 3.4 LAN 模式

只有私有 IPv4 Host 才进入 LAN 模式。浏览器没有通过访问码时：

- GET/HEAD 返回局域网登录页；
- 其他方法返回 401。

通过访问码后，`lib/lan-access.ts` 的默认拒绝策略只允许：

- 首页和静态 shell 的读取；
- `/model-test` 的读取；
- `/api/life-records/parse` 的读取和 POST；
- 带可信同源 Origin 的 `/api/life-records/chat`、`/api/life-records/image` 和 `/api/model-test/chat` POST。

未知私有 Host、未知 API 和其他写操作均拒绝。LAN 访问码 Cookie 设置为 HttpOnly、SameSite=Strict，路径为 `/`。由于当前是 HTTP LAN，Cookie 使用 `secure: false`；这意味着同 Wi-Fi 网络上的监听风险仍需在正式使用前评估。

### 3.5 安全响应头

Proxy 为放行响应添加：

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Resource-Policy: same-origin`

API 响应以及登录/拒绝响应额外使用 `Cache-Control: no-store`。

## 4. 本轮发现并修复的安全缺口

检查时发现入口只删除浏览器伪造的 LAN 验证头，没有删除公网测试验证头。虽然公网测试 API 还检查 Host 和路径，但下游若信任该内部头，仍存在被错误放大的风险。

已做最小修复：

```ts
incomingHeaders.delete(LAN_VERIFIED_HEADER)
incomingHeaders.delete(PUBLIC_TEST_VERIFIED_HEADER)
```

修复后，Proxy 只有在通过 Host、路径、方法和 Origin 检查后，才会重新写入对应的验证头。新增测试覆盖了 loopback、LAN、公网放行、公网拒绝和未知 Host。

修改前 `proxy.ts` SHA-256：

```text
64CB68BC028545C76B363B0F4620A8AD75C07EB860C8EE9B9A4A76249945C74B
```

修改后 `proxy.ts` SHA-256：

```text
3C76726562A8B500A2171FF66FBA0D17110665FC7BD15D98F7F73A98654CD42E
```

## 5. next.config.ts 检查

`next.config.ts` 当前没有使用旧名称 `skipMiddlewareUrlNormalize` 或 `middlewareClientMaxBodySize`。配置中的 `distDir` 仅通过可选环境变量 `AIOS_DIST_DIR` 支持隔离构建，默认仍为 `.next`；`allowedDevOrigins` 只在显式设置 `AIOS_ALLOWED_DEV_ORIGIN` 时启用。

没有发现需要在本任务范围内修改的 Next.js 16 配置错误。本轮未改动 `next.config.ts`。

## 6. Node.js 运行时影响

Next.js 16 的 Proxy 固定使用 Node.js runtime，不再以 Edge runtime 作为该文件约定的默认目标。本次代码只使用：

- `Request` / `Headers` / `URL` 等标准 Web API；
- `NextRequest`、`NextResponse`；
- `process.env` 读取服务端配置；
- `request.formData()` 处理局域网登录表单。

没有发现 Edge 专用 API 或依赖浏览器环境的调用。Node.js runtime 也意味着 Proxy 可以读取服务端环境变量；这符合当前 LAN 和公网测试开关的设计，但要求部署环境正确配置环境变量且不把秘密暴露给浏览器。

## 7. API 认证边界

Proxy 已显著降低未知公网主机和未授权 LAN 设备的访问面，但敏感 API 不能只依赖 Proxy：

- `app/api/health/apple-sync/route.ts` 注释将 `userId` 当作 bearer token；
- `app/api/health/import/route.ts` 只检查请求体 `userId`；
- `app/api/telegram/link/route.ts` 只检查 `userId` 和 `chatId`；
- `app/api/telegram/setup/route.ts` 的 GET 可尝试注册 webhook；
- `app/api/telegram/cron/route.ts` 只有配置 `CRON_SECRET` 时才校验；
- `app/api/telegram/webhook/route.ts` 只在 secret 与请求头同时存在时比较，缺少请求头时没有拒绝；
- `app/api/telegram/food-webhook/route.ts` 未发现 secret 校验。

当前 LAN/公网 Proxy 默认拒绝这些路径的公网访问，这降低了风险，但不能作为接口自身的认证证明。正式公网部署前应：

1. 为所有敏感 API 增加独立认证和授权；
2. 为 webhook 使用强制存在的 secret，并对缺失 header 直接拒绝；
3. 为管理员、OAuth 和健康数据接口保持 loopback 或单独受保护的入口；
4. 对 API 调用增加请求大小、速率、超时和审计限制。

本任务禁止修改业务 API，因此这些风险只记录，不在本轮修复。

## 8. 构建与编译证据

### 8.1 Proxy 已进入构建管线

隔离 Webpack 构建虽然最终失败，但已生成：

```text
.next-proxy-audit-003d/server/proxy.js
```

该文件大小为 189,242 bytes，SHA-256 为：

```text
3ECE9C10F32FF3BD1870EBBF2C18C1DBE503864470E28B4935D16DB421508624
```

对生成文件的只读检查确认其中包含：

- `x-aios-lan-verified`
- `x-aios-public-test-verified`
- `AIOS_PUBLIC_TEST_HOSTS`
- `AIOS_LAN_ACCESS_KEY`

这说明 Next.js 构建管线识别并编译了 `proxy.ts`，而不是只读取了旧 `middleware.ts`。

### 8.2 Turbopack

隔离构建命令使用 `.next-proxy-audit-003d`，没有使用正式 `.next`。Turbopack 在工具内部失败：

```text
TurbopackInternalError: failed to create junction point to ../../node_modules/firebase-admin
os error 80
```

失败发生在工具创建 Windows junction 阶段，尚未进入应用代码编译错误。

### 8.3 Webpack

同一隔离目录的 Webpack 构建最终失败：

```text
EPERM: operation not permitted, mkdir
...\.next-proxy-audit-003d\server\app\(app)\dashboard
```

隔离目录继承了项目根目录的 ACL：

```text
Everyone Deny DeleteSubdirectoriesAndFiles
```

因此本轮不能宣称完整生产构建通过。该结论是环境/权限阻断，不是对应用代码成功或失败的最终判断。

## 9. 自动化验证

以下命令均已实际执行：

| 检查 | 结果 |
| --- | --- |
| `node --test --test-concurrency=1 tests/proxy-migration.test.mjs` | 7/7 通过 |
| `node --test --test-concurrency=1 tests/lan-access.test.mjs tests/local-request-security.test.mjs` | 22/22 通过 |
| `node --test --test-concurrency=1 tests/*.test.mjs` | 431/431 通过，0 failed，0 skipped |
| `.\node_modules\.bin\tsc.cmd --noEmit` | 退出码 0 |
| `.\node_modules\.bin\eslint.cmd proxy.ts next.config.ts tests\proxy-migration.test.mjs` | 退出码 0 |
| `git diff --check` | 退出码 0；仅有既有 LF/CRLF 提示 |

测试覆盖：

- 原 matcher 排除规则保持不变；
- loopback 会剥离两个浏览器伪造验证头；
- 未验证 LAN 设备得到登录页；
- 已验证 LAN 设备只收到 Proxy 生成的 LAN 标记；
- 公网测试路径只收到 Proxy 生成的公网标记；
- 公网测试路径之外返回 403；
- 未知 Host 返回 403。

测试警告 `MODULE_TYPELESS_PACKAGE_JSON` 来自项目没有声明 `"type": "module"`，不影响测试结果。

## 10. 变更范围

本轮代码修改仅包括：

- `proxy.ts`：增加公网内部验证头的剥离；
- `tests/proxy-migration.test.mjs`：新增 Next.js 16 Proxy 路由行为测试。

本报告文件 `docs/PROXY_MIGRATION_AUDIT.md` 为审计交付物。

没有恢复 `middleware.ts`，没有修改业务 API、OAuth、数据库迁移、真实生活记录、Firebase、`.next` ACL 或正式运行服务。

## 11. 最终回答

1. **middleware.ts 的删除是否属于正常迁移？**
   是。Next.js 16 的官方约定是 `middleware.ts` 改为 `proxy.ts`，导出函数改为 `proxy`；当前文件也使用 Node.js runtime，符合迁移方向。

2. **proxy.ts 是否正确继承原有路由行为？**
   原 matcher 完全保留，且原有全量透传在本机 loopback 场景继续有效。当前 Proxy 额外加入 LAN、公网测试白名单、默认拒绝和安全响应头。

3. **是否发现新的安全风险？**
   发现浏览器可提交公网测试内部验证头并被下游继续接收的风险，已通过入口剥离两个验证头修复。另发现若干旧 API 自身认证不足，正式公网部署前必须处理。

4. **是否存在阻止正式构建或部署的问题？**
   Proxy 已被构建管线编译，未发现 Proxy 自身的明确编译错误。完整生产构建尚未验证：Turbopack 遇到 Windows junction 错误，Webpack 遇到 `.next-proxy-audit-003d` 的 EPERM 权限错误。部署前还需解决 API 认证边界和本机构建环境问题。

5. **本次是否修改代码？具体修改了哪些内容？**
   是。只修改 `proxy.ts`，并新增 `tests/proxy-migration.test.mjs`；生成本审计文档。没有提交、打标签、推送或部署。
