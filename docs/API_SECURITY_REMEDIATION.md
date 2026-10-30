# API Security Remediation — Task 003-E

检查与整改日期：2026-10-26

## 1. 范围与结论

本轮处理 `docs/PROXY_MIGRATION_AUDIT.md` 第 7 节列出的 health 和 Telegram API
认证缺口。修复目标是让这些旧接口默认不可用，并在显式启用后仍执行接口级认证，
而不是把 `proxy.ts` 的局域网或公网入口控制当成 API 授权。

结论：

- Health 与 Telegram 附属 API 在所有环境默认关闭。
- 显式启用后，缺失配置、缺失身份、错误身份或错误 webhook secret 均默认拒绝。
- 客户端提交的 `userId` 不再单独构成身份。
- Food webhook 现已强制校验 Telegram 的 secret header。
- 本轮没有修改聊天、生活记录、日历、存储迁移、Firebase 业务规则或 UI。

## 2. 实际修复的漏洞

### 2.1 Apple Health sync

涉及：

- `app/api/health/apple-sync/route.ts`

整改前：

- 仅凭请求体中的 `userId` 写入健康数据。
- GET 可匿名查看接口配置。
- 错误响应返回内部异常文本。

整改后：

- 设置 `AIOS_ENABLE_LEGACY_HEALTH_API=true` 才会启用，否则返回 404。
- POST 和 GET 都必须携带
  `Authorization: Bearer <AIOS_HEALTH_SYNC_TOKEN>`。
- 服务端从 `AIOS_HEALTH_SYNC_USER_ID` 取得可信所有者身份。
- 请求体 `userId` 必须与该服务器配置身份完全一致，否则返回 403。
- 500 响应仅返回通用错误，不返回内部异常或配置内容。

### 2.2 Apple Health import

涉及：

- `app/api/health/import/route.ts`

整改后：

- 设置 `AIOS_ENABLE_LEGACY_HEALTH_API=true` 才会启用。
- 必须使用 Firebase ID Token，并由 Firebase Admin SDK 在服务端验证。
- 实际写入身份来自已验证 Token 的 UID。
- 请求体 `userId` 必须匹配 Token UID，否则返回 403。
- 500 响应不返回内部异常文本。

### 2.3 Telegram 账户链接

涉及：

- `app/api/telegram/link/route.ts`

整改后：

- 设置 `AIOS_ENABLE_LEGACY_TELEGRAM_API=true` 才会启用。
- POST 与 DELETE 都要求已由服务端验证的 Firebase ID Token。
- 客户端 `userId` 只能作为一致性声明；缺失时使用 Token UID，不匹配时返回 403。
- 不允许覆盖其他用户已经绑定的同一 `chatId`。
- 读取、冲突检查和写入改为 Firestore transaction，缩小并发覆盖窗口。
- DELETE 只能删除 Token UID 自己拥有的链接。

### 2.4 Telegram setup / food-setup

涉及：

- `app/api/telegram/setup/route.ts`
- `app/api/telegram/food-setup/route.ts`

整改后：

- 只有设置 `AIOS_ENABLE_LEGACY_TELEGRAM_API=true` 才会启用。
- 必须提供
  `Authorization: Bearer <TELEGRAM_SETUP_SECRET>`。
- `TELEGRAM_WEBHOOK_SECRET` 与 `TELEGRAM_FOOD_WEBHOOK_SECRET`
  必须分别配置。
- webhook 地址只能来自服务端 `NEXT_PUBLIC_APP_URL`，并且必须是 HTTPS。
- 注册 webhook 时同时发送 Telegram 支持的 `secret_token`。

### 2.5 Telegram cron

涉及：

- `app/api/telegram/cron/route.ts`

整改后：

- 只有设置 `AIOS_ENABLE_LEGACY_TELEGRAM_API=true` 才会启用。
- `CRON_SECRET` 未配置时返回 503。
- Bearer secret 缺失或错误时返回 401。
- 不再存在“未配置 secret 就不校验”的降级路径。

### 2.6 Telegram webhook / food webhook

涉及：

- `app/api/telegram/webhook/route.ts`
- `app/api/telegram/food-webhook/route.ts`

整改后：

- 两个 webhook 都受 `AIOS_ENABLE_LEGACY_TELEGRAM_API=true` 控制。
- 分别强制校验
  `x-telegram-bot-api-secret-token` 与对应环境变量。
- 环境变量未配置返回 503；header 缺失或 secret 不匹配返回 401。
- secret 校验发生在 `req.json()` 之前，未授权请求不会进入业务解析。
- 用户身份仅从服务器端 `telegram_links` 文档读取。

## 3. 环境变量与响应策略

只在明确需要旧接口时配置：

| 功能 | 必需配置 |
| --- | --- |
| Apple Health | `AIOS_ENABLE_LEGACY_HEALTH_API=true`、`AIOS_HEALTH_SYNC_TOKEN`、`AIOS_HEALTH_SYNC_USER_ID`、Firebase Admin 凭据 |
| Telegram 统一开关 | `AIOS_ENABLE_LEGACY_TELEGRAM_API=true` |
| Telegram linking | Firebase Admin 凭据 |
| Telegram setup | `TELEGRAM_SETUP_SECRET`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、HTTPS `NEXT_PUBLIC_APP_URL` |
| Telegram food setup | `TELEGRAM_SETUP_SECRET`、`TELEGRAM_FOOD_BOT_TOKEN`、`TELEGRAM_FOOD_WEBHOOK_SECRET`、HTTPS `NEXT_PUBLIC_APP_URL` |
| Telegram cron | `CRON_SECRET` |
| Telegram webhook | `TELEGRAM_WEBHOOK_SECRET`、`TELEGRAM_BOT_TOKEN` |
| Telegram food webhook | `TELEGRAM_FOOD_WEBHOOK_SECRET`、`TELEGRAM_FOOD_BOT_TOKEN` |

状态码约定：

| 状态 | 含义 |
| --- | --- |
| `404` | 对应的 legacy 功能开关未开启 |
| `503` | 功能已开启，但服务端认证配置不完整 |
| `401` | 认证 secret 或 Bearer Token 缺失、错误 |
| `403` | 已验证身份与目标资源所有者不一致 |
| `400` | 已授权请求的参数无效 |

失败响应不包含 secret、Bearer Token、授权码或内部异常对象。

## 4. 本地开发与生产策略

- 开发环境同样默认关闭；不会因为使用 `next dev` 自动开放。
- 生产环境不配置开关时，这些 route 返回 404。
- `AIOS_ENABLE_LEGACY_HEALTH_API` 和
  `AIOS_ENABLE_LEGACY_TELEGRAM_API` 只有在值严格等于字符串
  `true` 时启用。
- 即使显式启用，缺少对应 secret 或服务端身份配置仍会失败关闭。
- 这些接口不属于当前“聊天即记录”MVP 的必要路径，因此不启用时不损害核心功能。

## 5. 修改文件

- `lib/api-security.ts`
- `lib/firebase/admin.ts`
- `app/api/health/apple-sync/route.ts`
- `app/api/health/import/route.ts`
- `app/api/telegram/link/route.ts`
- `app/api/telegram/setup/route.ts`
- `app/api/telegram/food-setup/route.ts`
- `app/api/telegram/cron/route.ts`
- `app/api/telegram/webhook/route.ts`
- `app/api/telegram/food-webhook/route.ts`
- `tests/api-security.test.mjs`
- `docs/API_SECURITY_REMEDIATION.md`

工作区中还有本任务开始前已存在的大量未提交修改。本轮没有清理、回退或提交它们。

## 6. 自动化验证

- API 安全专项测试：12/12 通过。
- TypeScript：`tsc --noEmit` 通过。
- 定向 ESLint：通过。
- 全量串行回归：443/443 通过，0 失败，0 跳过。
- `git diff --check`：通过，仅有既存文本文件的 LF/CRLF 提示。

专项测试覆盖：

- 开关只接受精确字符串 `true`；
- Bearer 格式、缺失和错误 secret；
- Firebase Token 验证成功、缺失和失败；
- 客户端伪造所有者 `userId`；
- Apple Health 默认 404、启用后未认证 401、合法 owner 200；
- Telegram 管理接口默认 404、启用后未认证 401；
- 两个 webhook 的未配置 503、缺失/错误 header 401；
- 合法 webhook secret 能通过安全门禁；
- 序列化后的失败结果不包含测试 secret。

Node.js 在直接加载 TypeScript 测试模块时会输出项目既有的
`MODULE_TYPELESS_PACKAGE_JSON` 性能提示；提示不影响测试结果，本轮没有为此修改
`package.json` 的模块类型。

未执行真实 Firebase、Telegram Bot 或 Firestore 端到端请求，因为本轮不需要读取
真实用户数据或联系第三方服务。

## 7. 尚未完成与公网阻断项

### 7.1 Telegram 设置 UI 尚未接入新认证

**未完成，功能影响明确。**

当前 `app/(app)/settings/page.tsx` 调用 `/api/telegram/link` 时没有附带
Firebase ID Token。开启 legacy Telegram 功能并启用新安全校验后，该旧设置页无法完成
linking。它属于旧功能，不在“聊天即记录”MVP 必要路径内，因此本轮没有修改 UI。

若今后恢复 Telegram linking，需要：

1. 在客户端取得当前 Firebase ID Token；
2. 以 `Authorization: Bearer <id-token>` 调用；
3. 服务端继续验证 Token UID；
4. 增加成功、失败和退出登录时的端到端测试。

### 7.2 其他仍需发布的阻断项

- 真实 Firebase ID Token 验证和 Firestore transaction 尚未做端到端集成验证。
- 真实 Telegram webhook 注册与 secret header 回调尚未做端到端验证。
- 生产构建仍受本次任务之外的 `.next` 权限/构建环境问题影响。
- 这些 route 的请求体大小、速率限制和集中审计尚未实现；当前依靠默认关闭、
  secret 认证和 Proxy 默认拒绝降低暴露面。

## 8. 对现有用户功能的影响

- 核心聊天、自动保存、生活记录、日历、统计、搜索和本地存储未修改。
- 未启用 legacy 开关时，health 与 Telegram 附属 API 返回 404。
- 旧 Telegram 设置 UI 在启用安全开关后不能直接 linking，需按 7.1 完成客户端 Token 接入。
- 没有读取、修改、迁移或删除真实用户生活记录、OAuth 凭据或 Firebase 数据。
