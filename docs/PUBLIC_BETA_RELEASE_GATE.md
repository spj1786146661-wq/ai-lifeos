# AI-LifeOS Web Public Beta 上线安全门禁

日期：2026-10-28
任务：`004-PB-01` 审查，`004-PB-02` 与 `004-PB-03` 代码侧收口
结论：**代码侧 P0 已收紧到可以进入真实 HTTPS 预发布验收，但仍不能直接公开上线。** 正式发布前仍必须由项目负责人完成真实 Corresponding Source 地址、腾讯云单实例、域名、证书和反向代理配置，并完成 HTTPS 与手机真机验收。

## 004-PB-03 实施结果

本节是当前结论；后续的 PB-01 条目保留为原始审查证据，凡与本节冲突的旧状态均以本节为准。

### A. 本轮实际关闭的代码侧 P0

1. **单实例门禁与 fail closed**
   - `lib/public-beta-security.ts` 要求 `single-instance`、实例数 `1`、状态后端 `memory-single-instance`、明确实例 ID 与发布 ID。
   - 缺少任一生产配置、配置为多实例或 Serverless、缺少真实源码 URL 时，Public Beta 请求返回不可用，不会静默降级。
   - 当前进程内限流和幂等只声明适用于单长期运行实例；多实例上线被明确阻断。

2. **服务端匿名会话与统一请求预算**
   - Proxy 签发 24 小时、HMAC-SHA256 签名的 `HttpOnly; Secure; SameSite=Strict` 匿名会话 Cookie。
   - 连接测试、Chat、Follow-up 均以服务端验证的会话和 BYOK Key 单向指纹划分作用域。
   - 预算：连接测试每会话每分钟 3 次、Chat 4 次、Follow-up 2 次；每 Key 指纹每分钟 12 次；全实例每分钟 120 次；全局并发 8、每会话并发 1。
   - 首次解析的 Public Beta 输出预算最多 900 Tokens；Follow-up 600、数据分析 850、连接测试 600。均无自动重试。
   - 不信任 `X-Forwarded-For`，客户端不能通过伪造转发 IP 获得新身份或越过预算。

3. **可信入口、Host/Origin/CSRF 与路由白名单**
   - Public Beta 公网请求必须同时满足精确 HTTPS Host、同源写请求、可信反向代理入口密钥和最小路由白名单。
   - 浏览器伪造的内部验证头会先被删除，再由 Proxy 注入服务端验证过的匿名会话。
   - TokenHub Base URL 固定，浏览器不能指定任意 URL。
   - OAuth、图片 AI、Health、Telegram、`/model-test` 和未知 API 保持公网拒绝。

4. **公网绝不使用开发者私人凭据**
   - Public Beta 进程检测到开发者 TokenHub/OpenRouter Key 或 Firebase 配置时拒绝提供公网服务。
   - Chat、Follow-up、连接测试继续使用当前请求携带的 BYOK；无 Key 返回错误，不回退到进程环境 Key。

5. **隐私、费用与首次第三方 AI 确认**
   - 新增 `/privacy`、`/terms`，说明浏览器本地存储、IndexedDB 附件、清理数据风险、导出恢复、删除方式、BYOK 生命周期、发送给 TokenHub 的内容和第三方费用边界。
   - 第一次连接第三方 AI 前必须勾选确认；只持久化告知版本，不持久化 API Key。
   - 文案不承诺永久免费或绝对零费用。

6. **AGPL 与显著源码入口**
   - 新增 `/source`，展示 LifeTracker、AGPL-3.0、Life OS MIT 来源和独立项目声明。
   - 页面只在配置真实 `AIOS_PUBLIC_BETA_SOURCE_URL` 和发布 ID 后展示源码入口；缺少时明确显示发布阻断，不生成虚假链接。
   - `docs/PUBLIC_BETA_DEPLOYMENT.md` 已列出 Corresponding Source 应包含的源码、构建说明、配置模板、许可证和修改说明，以及必须排除的 Secret、用户数据和凭据。

7. **生产安全配置**
   - Proxy 动态生成 CSP nonce，并为现有内联主题脚本注入 nonce。
   - 已配置 CSP、HSTS、Permissions-Policy、X-Frame-Options、nosniff、Referrer-Policy、COOP、CORP 和 `Cache-Control: no-store`。
   - 新增 `.env.public-beta.example`，仅含占位值和单实例边界；不含真实 Key。

### B. 当前仍未关闭的发布 P0

1. **真实 Corresponding Source 地址**：代码入口已完成，但尚无当前运行版本可访问的真实 HTTPS 源码地址。发布前必须上传与部署版本一一对应的源码并配置 `AIOS_PUBLIC_BETA_SOURCE_URL`。
2. **腾讯云生产资源配置**：必须由用户在控制台确认单个长期运行实例、固定实例数 1、关闭自动扩容、Secret 注入、出站访问和日志脱敏。当前不能部署为多实例或 Serverless。
3. **域名、证书与反向代理**：必须完成真实域名、HTTPS 证书、HTTP→HTTPS、Nginx 入口密钥注入，并只让 Next.js 监听 `127.0.0.1:3000`。
4. **真实 HTTPS 预发布验收**：必须验证 CSP 无违规、Cookie 安全属性、连接测试、Chat、Follow-up、429、断网和错误状态。
5. **手机真机验收**：Android Chrome 和 iPhone Safari 的连接、记录、自动保存、编辑、删除、备份、键盘和横向溢出尚未在目标 HTTPS 环境验证。
6. **许可证/条款人工确认**：`TERMS_OF_USE` 与 AGPL/商业发布关系仍建议在公开测试前由法律专业人员确认。

### C. 单实例生产架构

```text
手机 / 桌面浏览器
  └─ HTTPS 正式域名
      └─ Nginx 或腾讯云受控反向代理
          ├─ 覆盖并验证 Host / Origin
          ├─ 注入 x-aios-ingress-secret
          └─ 127.0.0.1:3000
              └─ 唯一长期运行的 Next.js Node.js 进程
                  ├─ 进程内匿名会话预算与幂等
                  └─ 固定 TokenHub 官方地址 + 用户请求级 BYOK
```

- 生活记录和附件仍存于用户浏览器，服务端不建立生活记录数据库。
- 该架构的硬限制是只能运行一个 Node 进程。需要高可用、滚动发布、自动扩容或 Serverless 时，必须先把限流与幂等迁移到共享原子存储。
- 不能用多个进程同时指向当前内存状态，也不能把当前 Map 宣称为跨实例保护。

### D. 验证结果

| 检查 | 结果 |
| --- | --- |
| Public Beta 定向安全测试 | 48/48 通过 |
| 串行全量自动化 | 538/538 通过，0 failed，0 skipped |
| TypeScript | 通过 |
| 定向 ESLint | 0 errors / 0 warnings |
| `git diff --check` | 通过，仅有现有 LF/CRLF 提示 |
| Next.js 16 生产构建 | 通过：webpack 独立目录编译、TypeScript、68/68 页面生成及构建追踪完成 |
| Turbopack 独立构建 | 当前受控 Windows 环境创建 `firebase-admin` Junction 时失败；webpack 成功后不再作为代码阻断 |
| 真实 AI 推理 | 0 次 |
| 真实生活记录访问 | 0 次 |

生产构建使用测试占位域名、测试秘密和独立 `AIOS_DIST_DIR`。它证明当前代码可以完成生产构建，不代表真实 HTTPS、真实域名、源码地址或腾讯云配置已经通过验收。

### E. 是否可以进入 009-BETA

**可以进入 009-BETA 的预发布环境配置与 HTTPS 验收阶段，但不能直接公开发布。** 下一阶段只应处理上文 B 节的外部部署门禁和真实移动端验收；不得把多实例、Serverless、真实源码地址或真机验收写成已完成。

## PB-01 原始审查快照

以下内容保留 004-PB-01 当时的代码证据和修复建议，用于追溯风险来源。其“当前”“尚未实现”“下一步”等状态描述是历史快照；004-PB-02、004-PB-03 完成后的现状以本文开头“004-PB-03 实施结果”为准。

- PB-01 当时只读审查了源码、配置、测试和既有审计报告，没有修改业务代码。
- PB-01 没有调用真实 AI 模型，没有读取或修改真实生活记录、OAuth 凭据、备份或 Firebase 数据。
- PB-01 定向运行 Proxy、LAN、幂等、ChatGPT Provider 和 TokenHub 适配器测试，共 **69/69 通过**。
- **513/513** 是 PB-01 的进入基线；PB-03 已完成 **538/538** 串行全量回归。
- PB-01 当时没有验证生产构建；PB-03 已完成独立 webpack 生产构建。腾讯云实际部署、真实 HTTPS 和真机验收仍未完成。

## A. 当前可以直接复用的能力

### 1. 生活记录与移动端产品流程

以下功能已有实现和自动化覆盖，可作为 Public Beta 核心：

- 六大分类、多意图解析、原文片段、日期和数字保留。
- 发送后自动保存、重复识别、待调整候选、用户确认新增、编辑和精确撤销。
- 心情评分可选，缺失评分不进入均值。
- 搜索、统计、日历、分类筛选、历史记录管理。
- JSON 备份与恢复，图片附件使用独立 IndexedDB Blob 库并带引用清理。
- 手机优先页面、移动底栏、390px 窄屏适配和 reduced-motion。

### 2. 腾讯云 TokenHub 适配器

`lib/tokenhub-model-test.ts` 是当前最适合 BYOK 改造的基础：

- 固定使用 `https://tokenhub.tencentmaas.com/v1/chat/completions`，不接受用户自定义 Base URL，天然避免任意 URL 代理。
- `requestTokenHubModel()` 已支持调用方传入 `options.apiKey`，不必改成全局环境 Key。
- 已有输入边界、输出 Token 上限、超时、无自动重试、安全错误映射、Request ID 和 usage 归一化。
- 正式解析已关闭思考、请求 JSON、经过 Schema 校验，并在失败时明确降级。
- 日志目前只记录 Provider、模型、延迟、usage、correlationId 和安全的 Request ID，不记录原文或 Key。

### 3. 现有解析、保存和追问引擎

- `lifeRecordPrompt()`、模型 JSON 校验、六分类归一化和缺字段策略可复用。
- 自动保存、去重、原文关联、编辑原记录和两轮后续追问可复用。
- 第一轮解析与最多三个追问已合并为一次模型请求。
- 服务端 Chat 与 Follow-up 已有输入大小限制和并发/完成后的幂等测试。

### 4. 路由与运行环境保护基础

- `proxy.ts` 会删除浏览器伪造的内部验证头。
- Public Test 模式只接受精确配置的 HTTPS Host，并要求写请求具有精确同源 Origin。
- 当前 Public Test 模式只开放 `/model-test` 和 `/api/model-test/chat`，主应用、正式记录、Follow-up、图片、OAuth、Health 和 Telegram 都默认不可达。
- Health 与 Telegram 路由默认关闭，显式开启后仍有服务端鉴权。
- ChatGPT 套餐 OAuth 只允许本机回环，不应进入公开 Beta。

### 5. 开源声明基础

- `components/life-records/OpenSourceNotice.tsx` 已展示 LifeTracker、AGPL-3.0、Life OS MIT 通知和独立项目说明。
- 但 `CORRESPONDING_SOURCE_URL` 仍为 `null`，因此尚未完成 AGPL Corresponding Source 的公开提供。

### 6. 不能直接复用的部分

- **智谱 BigModel / Z.ai 当前没有 Provider 实现。** 仓库中没有可审查的 BigModel 请求、模型目录或测试，不能列为已复用能力。
- **OpenRouter 当前是进程级环境 Key。** `lib/ai/client.ts` 在模块加载时读取开发者环境变量，不适合不同用户 BYOK；Public Beta 首期不应开放。
- **ChatGPT 套餐授权是个人本机能力。** 不能作为公开用户共享 AI 后端。
- **Public Test 页面不是 Public Beta。** `/model-test` 使用开发者环境 Key，且全局限流桶不能满足公网多用户要求。

## B. 真正的 P0 上线阻断项

### P0-1：公开环境隔离和默认拒绝路由

**当前风险与证据**

- `proxy.ts:131-148` 的 Public Test 白名单只开放测试页和测试 API。
- `app/api/life-records/chat/route.ts:23-26`、`app/api/life-records/follow-up/route.ts:41-55`、`app/api/life-records/image/route.ts:25-28` 都只允许 loopback/LAN；公网主流程实际上不可用。
- 若直接扩大 `AIOS_PUBLIC_TEST_HOSTS` 或放宽路由，可能把开发者个人 Key、OAuth 管理、Health、Telegram 或旧 `/api/ai/*` 一并暴露。
- 生产若配置 `TENCENT_TOKENHUB_API_KEY`、`OPENROUTER_API_KEY` 或 ChatGPT 本机凭据，所有访客会消耗开发者资源。

**需要修改**

- `proxy.ts`
- `lib/lan-access.ts`
- `app/api/life-records/chat/route.ts`
- `app/api/life-records/follow-up/route.ts`
- `app/api/model-test/chat/route.ts`
- `.env.example`

**最小修复**

1. 新增独立的 `AIOS_PUBLIC_BETA_HOSTS`，不复用 Test 环境变量。
2. 公网白名单只允许：
   - `GET /` 和静态资源；
   - `POST /api/life-records/chat`；
   - 完成 BYOK 后的 `POST /api/life-records/follow-up`；
   - Provider 模型列表、连接测试和断开 API。
3. `/model-test`、OAuth、Health、Telegram、旧 `/api/ai/*`、调试页和未声明 API 在公网默认返回 403/404。
4. Public Beta 生产环境明确不设置开发者 `TENCENT_TOKENHUB_API_KEY`、`OPENROUTER_API_KEY` 和 ChatGPT 个人凭据。
5. 首期若不开放图片理解，隐藏图片发送入口；不要留下点击后必然 403 的按钮。

**验收方法**

- 对每个路由分别测试：精确公网 Host、错误 Host、错误 Origin、直接请求内部验证头。
- 证明公开环境中 `/api/life-records/chatgpt-plan/*`、`/api/health/*`、`/api/telegram/*`、`/api/model-test/chat` 不可达。
- 证明公网请求即使携带浏览器伪造的 LAN/Public 内部头也被拒绝。

**可通过部署限制简化**

可以。首批只开放文字记录、单个 Provider 和少量邀请用户，不开放图片 AI、OAuth、Health、Telegram。

### P0-2：用户自带 API Key 的短期安全链路

**当前风险与证据**

- 当前没有 Public BYOK API。
- `lib/life-parse-server.ts:94-108` 和 `lib/tokenhub-model-test.ts:284-287` 默认读取服务端环境 Key。
- `lib/ai/client.ts:24` 的 OpenRouter Key 是全局环境配置。
- 没有证据表明 Key 已进入 `localStorage`、`sessionStorage` 或 URL；不能把“当前未发现泄露”写成“已有安全 BYOK”。

**需要修改或新增**

- `lib/ai/provider-registry.ts`（新增，固定 Provider 元数据与 Base URL）
- `lib/ai/byok-connection.ts`（新增，请求级凭证类型、校验和脱敏）
- `lib/life-parse-server.ts`
- `lib/life-follow-up-server.ts`
- `lib/life-chat-route.ts`
- `app/api/life-records/chat/route.ts`
- `app/api/life-records/follow-up/route.ts`
- `app/api/ai/providers/tokenhub/models/route.ts`（新增）
- `app/api/ai/providers/tokenhub/test/route.ts`（新增）
- `app/api/ai/connection/route.ts`（新增，如需要断开当前匿名会话）
- `app/page.tsx` 或新的连接组件

**最小修复**

首期采用“页面内存中的临时连接”：

- Provider 固定为 TokenHub，模型 ID 由服务端允许列表验证。
- Key 只保存在当前 React 页面内存，不进入 localStorage、sessionStorage、URL、IndexedDB 或日志。
- 每次正式 Chat/Follow-up 请求在 HTTPS JSON 请求体中携带 Key；服务端只把 Key 交给固定 TokenHub 地址，用完即释放。
- 刷新页面后要求重新输入 Key，UI 必须明确说明。
- “断开”只清除前端内存和服务端匿名会话状态。
- 服务端永远不使用环境 Key 代替用户 Key。
- 不提供自定义 Base URL。

如果产品必须刷新后仍保持连接，再增加 P1 的短期加密 HttpOnly Cookie 会话；不要把明文 Key 放进任何浏览器存储。

**验收方法**

- 两个不同 Key 的请求不能复用彼此的模型结果、限流桶或错误信息。
- Key 不出现在页面源码、网络 URL、localStorage、sessionStorage、IndexedDB、响应体和服务端日志。
- 错误 Key、过期 Key、无模型权限、429、超时和空响应都显示安全错误。
- 刷新后状态明确显示“需要重新连接”，不能伪称仍已连接。

**可通过部署限制简化**

可以。首批只支持 TokenHub、文字、临时连接，刷新后重连。OpenRouter 和 BigModel 留到 P1。

### P0-3：移动优先的三步连接向导

**当前风险与证据**

- `app/page.tsx:1567-1610` 的「我的」仍是本机测试文案，只提供 ChatGPT 套餐按钮。
- 页面明确写着“本机测试版暂不提供公开账号和模型设置”，不能直接作为 Public Beta 引导。
- 当前 `/model-test` 是开发工具，使用服务端 Key，不适合公网用户。

**需要修改或新增**

- `app/page.tsx`
- `components/life-records/AiModelConnection.tsx`（建议新增）
- 上述 TokenHub models/test API
- 首页 AI 来源标签和错误状态

**最小修复**

三步流程：

1. **选择服务商**：首期只显示腾讯云 TokenHub。
2. **输入 API Key**：密码输入、粘贴、清除；显示“仅用于本次页面会话”。
3. **选择模型并测试**：从固定目录或官方模型列表读取，选择后执行无推理的 `GET /v1/models` 权限检查，再设为当前模型。

界面必须显示：

- 当前 Provider、模型、真实 AI/规则降级状态。
- Key 不会持久保存、刷新后需要重连。
- 请求会发送给所选第三方服务商。
- 断开连接按钮。
- 测试失败时不能把规则结果标成 AI。

**验收方法**

- 390×844 和 1366×768 视口完成完整三步。
- 刷新后需要重新连接且提示准确。
- 错误 Key、模型不存在、网络失败和额度错误均有可操作提示。
- 页面没有自定义 Base URL 或任意模型代理入口。

**可通过部署限制简化**

可以。首期只显示 TokenHub 一个选项，不实现 17 家 Provider 的完整选择器。

### P0-4：公网限流、费用、幂等和单实例边界

**当前风险与证据**

- `app/api/model-test/chat/route.ts:65-70` 的限流 Key 是固定字符串 `model-test-local-process`，所有访客共享一个桶。
- `lib/request-idempotency.ts:66` 使用进程内 `Map`；Chat 为 15 分钟/512 条，Follow-up 为 15 分钟/256 条。
- `app/api/life-records/chat/route.ts` 没有通用公网速率限制。
- 多实例或 Serverless 进程不会共享幂等状态；测试已明确验证不同 Store 不共享。
- 当前幂等 scope 主要来自客户端 `clientSessionId`，公开环境下需要额外绑定服务端匿名会话和用户 Key 指纹，避免不同用户响应缓存串用。

**需要修改**

- `lib/request-idempotency.ts` 或新增共享存储适配器
- `app/api/life-records/chat/route.ts`
- `app/api/life-records/follow-up/route.ts`
- `app/api/ai/providers/tokenhub/*`
- `proxy.ts`（可信代理头处理）

**最小修复**

首批 Public Beta 固定为**一个长期运行 Node 实例**：

- 服务端签发随机 HttpOnly `SameSite=Strict; Secure` 匿名会话 Cookie，不保存 API Key。
- 按“匿名会话 + 可信客户端 IP”限流，不使用客户端可伪造的原始 `X-Forwarded-For`。
- 幂等 scope 绑定匿名会话和 Key 的 HMAC 指纹；缓存中不保存原始 Key。
- Chat 每会话每分钟最多 4 次，Follow-up 每轮最多 1 次；输入最多 500 字、输出最多 900 Tokens、总超时沿用现有配置。
- 429、超时和 Provider 失败不自动重试。
- 若启用第二实例或 Serverless 自动扩缩，必须改用 Redis/PostgreSQL 等共享原子状态；当前内存 Map 不能宣称跨实例严格幂等。

**验收方法**

- 并发重复、完成后的重复和刷新后重试都不会重复调用上游。
- 两个不同匿名会话或不同 Key 不会复用对方缓存。
- 单次发送只产生一次上游推理。
- 扩容到两个进程的测试必须失败关闭，或切换共享存储后重新验证。

**可通过部署限制简化**

可以，但只能通过明确的单实例部署限制。不能把“单进程 Map”当作公网多实例幂等。

### P0-5：隐私告知、本地数据边界与删除能力

**当前风险与证据**

- `lib/life-record-store.ts:133-185` 当前无登录用户写浏览器本地存储，附件写 IndexedDB；Firebase 登录路径仍存在。
- `app/page.tsx:1590` 明确写着当前页面“不是正式隐私政策”。
- AI 请求会把用户原文或追问上下文发送给第三方 Provider。
- 浏览器本地数据不会自动跨设备同步，清除站点数据会丢失记录和附件。
- 若 Public Beta 误配 Firebase 客户端变量，记录可能进入 Firestore，与“首期浏览器本地”的产品承诺不一致。

**需要修改或新增**

- 新增 `app/privacy/page.tsx`
- 新增 `app/terms/page.tsx`
- `app/page.tsx`
- `components/life-records/AiModelConnection.tsx`
- `.env.example`

**最小修复**

- 首期强制本地模式，生产不配置 Firebase 客户端变量；页面明确“当前手机浏览器本地记录，不跨设备同步”。
- 连接向导在发送前说明：原文、相关记录和追问上下文会发送给所选 Provider。
- 隐私页写明本地存储、附件、备份、第三方 AI、日志脱敏、删除方式和数据保留边界。
- 提供删除单条、删除当天、批量删除、清空全部和导出备份入口。
- 断开 AI 连接和删除记录必须分开说明，不能暗示断开 AI 会删除生活记录。

**验收方法**

- 新用户首次进入能看见本地存储与第三方 AI 告知。
- 清除站点数据、导出、恢复和清空全部的结果与说明一致。
- 配置错误导致 Firebase 开启时，Public Beta 启动检查拒绝发布。

**可通过部署限制简化**

可以。首批不做账号和云同步，减少隐私范围；但不能省略第三方 AI 告知和本地数据风险。

### P0-6：HTTPS、安全响应头和生产构建（PB-01 时状态）

**当前风险与证据**

- PB-01 时 `next.config.ts` 没有 `headers()`；Proxy 只提供 `nosniff`、`X-Frame-Options`、`no-referrer` 和 CORP 等基础头。PB-03 已补齐生产安全头。
- PB-01 时没有生产 CSP、HSTS 或 Permissions-Policy。PB-03 已实现动态 CSP nonce、HSTS 和 Permissions-Policy。
- BYOK 的 Key 在浏览器内存中，XSS 会直接威胁 Key，因此严格 CSP 是上线门禁。
- PB-01 时生产构建因本机 `.next` 的 `EPERM` 环境问题未验证；PB-03 已在独立目录用 webpack 完成生产构建。
- `vercel.json` 与 `firebase.json` 存在，但没有证据表明它们对应当前可用的腾讯云生产部署；不能把配置文件存在当作部署通过。

**需要修改**

- `next.config.ts`
- `proxy.ts`
- 部署反向代理配置（腾讯云侧，不在当前仓库）

**最小修复**

- 只通过 HTTPS 公网域名访问，HTTP 301 到 HTTPS。
- 添加 HSTS、`Permissions-Policy`、严格 `frame-ancestors`、`base-uri`、`form-action` 和适合 Next.js 的 CSP。
- Cookie 使用 `Secure`、`HttpOnly`、`SameSite=Strict`。
- 反向代理覆盖而不是信任客户端传入的 Host、Proto、Forwarded 头。
- 在干净隔离环境中执行生产构建和 `next start`；当前开发服务不能作为生产验收。

**验收方法**

- 生产构建、启动、首页、静态资源、Chat 和 Follow-up API 在 HTTPS 下通过。
- 外部扫描确认没有 HTTP 可用入口、没有缺失 HSTS、没有宽泛 CORS。
- 浏览器控制台没有 CSP 违规，API Key 不在页面源码或存储中。

**可通过部署限制简化**

不能跳过 HTTPS、CSP 和生产构建。可以先用平台提供的托管证书和反向代理，不自行维护证书。

### P0-7：AGPL Corresponding Source 与发布声明

**当前风险与证据**

- `components/life-records/OpenSourceNotice.tsx:17` 的 `CORRESPONDING_SOURCE_URL` 为 `null`。
- `docs/WEB_OPEN_SOURCE_COMPLIANCE.md` 明确说明尚未完成 AGPL-3.0 第 13 条要求的当前运行版本源码提供。
- 公开 Beta 一旦通过网络让用户交互，就不能只提供 LifeTracker 原仓库链接。

**需要修改**

- `components/life-records/OpenSourceNotice.tsx`
- `README.md`
- `docs/WEB_OPEN_SOURCE_COMPLIANCE.md`
- 新增公开源码仓库或可下载 Corresponding Source 的正式地址

**最小修复**

- 发布与部署提交完全对应的源码。
- 页面显著提供当前运行版本源码入口、AGPL-3.0 全文、构建/安装说明、修改说明和第三方通知。
- 对不能公开的 Secret、真实数据、部署凭据做配置模板隔离；不得因公开源码泄露运行环境。
- 上线前完成 `TERMS_OF_USE.md` 与 AGPL/商业使用解释的人工或法律确认。

**验收方法**

- 从公网页面一次点击可到达当前部署版本的 Corresponding Source。
- 源码 commit/tag 与生产部署版本一一对应。
- 不含 `.env.local`、OAuth 凭据、数据库、备份或用户数据。

**可通过部署限制简化**

不能省略。即使小规模受邀 Beta，只要公开用户可访问运行版本，就必须准备好源码入口。

### P0-8：真实移动端与目标部署验收

**当前风险与证据**

- 已有 390×844 自动化/模拟验证，但 Public Beta 需要真实 Android Chrome 和 iPhone Safari。
- `public/manifest.json` 和图标存在，但没有 service worker；不应宣传完整离线 PWA。
- 没有腾讯云部署配置、域名、证书或实例扩缩容证据。
- 当前 `vercel.json` 固定 `bom1` 区域，且 Serverless/多实例会破坏当前内存幂等假设。

**需要修改**

- 部署配置（腾讯云侧）
- `public/manifest.json`（如首期宣传 PWA）
- 移动端 UI 仅修验收发现的阻断问题

**最小修复**

- 选择单个长期运行的 Node 实例，放在受控 HTTPS 反向代理后。
- 不配置开发者个人 AI Key，不配置 Firebase 客户端变量。
- 首批只支持 TokenHub 文字记录；图片识别、OAuth、Health、Telegram 默认关闭。
- 真机验证：连接、输入、自动保存、刷新、编辑、删除、备份、统计、日历和网络失败。

**验收方法**

- Android Chrome 和 iPhone Safari 各完成一条关键路径。
- 断网时不能显示保存成功；恢复网络后用户可明确重试。
- 刷新后本地记录保留，AI Key 连接按设计要求重连。
- 手机横竖屏和键盘弹出时无横向溢出、发送按钮不被遮挡。

**可通过部署限制简化**

可以缩小功能范围，但不能把模拟器测试当作真机验收。若暂不承诺 PWA，安装/离线能力可移到 P1。

## C. 最少需要修改的文件与模块

### Public Beta 首期核心改动

```text
proxy.ts
lib/lan-access.ts
lib/ai/provider-registry.ts                 新增
lib/ai/byok-connection.ts                   新增
lib/tokenhub-model-test.ts                  复用并收紧公网默认环境 Key
lib/life-parse-server.ts                    接受请求级 BYOK 上下文
lib/life-follow-up-server.ts                接受请求级 BYOK 上下文
lib/life-chat-route.ts                      透传短期连接上下文
lib/request-idempotency.ts                  增加安全 scope/共享存储接口
app/api/life-records/chat/route.ts          公网白名单和 BYOK
app/api/life-records/follow-up/route.ts     公网白名单和 BYOK
app/api/ai/providers/tokenhub/models/route.ts 新增
app/api/ai/providers/tokenhub/test/route.ts   新增
app/page.tsx                                接入连接向导和隐私文案
components/life-records/AiModelConnection.tsx 新增
next.config.ts                              安全响应头
.env.example                                新变量名和本地/公网边界
app/privacy/page.tsx                        新增
app/terms/page.tsx                          新增
components/life-records/OpenSourceNotice.tsx 填入真实 Corresponding Source
```

### 建议新增测试

```text
tests/public-beta-routing.test.mjs
tests/byok-connection.test.mjs
tests/tokenhub-byok-routes.test.mjs
tests/public-idempotency-scope.test.mjs
tests/public-beta-security-headers.test.mjs
tests/public-beta-mobile-contract.test.mjs
```

## D. 推荐的最小部署架构

### 首期架构

```text
手机/桌面浏览器
  └─ HTTPS 正式域名
      └─ 受控反向代理
          └─ 单个长期运行 Next.js Node 实例
              ├─ TokenHub 固定 Base URL
              └─ 不持久化生活记录和附件

浏览器本地
  ├─ localStorage / 已启用的 IndexedDB：生活记录
  ├─ IndexedDB Blob：图片附件
  └─ 页面内存：用户短期 API Key
```

### 发布约束

- 一个实例、一个区域、固定实例数；不使用自动扩缩容。
- 用户记录和附件留在浏览器，服务端不存生活数据库。
- 不配置 Firebase 客户端变量、开发者 TokenHub Key、OpenRouter Key 或 ChatGPT 本机凭据。
- 匿名 HttpOnly 会话只用于限流和幂等，不存 API Key。
- 首批用户量超过单实例承载或需要高可用时，必须先接共享原子幂等/限流存储。

### 不建议

- 直接把现有 `/model-test` 设为公网主入口。
- 用开发者个人 Key 给所有访客调用模型。
- 用 Vercel/Serverless 多实例配合当前进程内 Map 作为严格幂等。
- 同时启用 Firebase 云数据和浏览器本地数据，造成两套权威存储。

## E. 004-PB-02 三步连接向导的现有基础

可以复用：

- `requestTokenHubModel()` 的固定 URL、Token 上限、超时、usage 和错误映射。
- TokenHub `GET /v1/models` 已在此前验收中成功读取模型目录，可用于“测试连接”，不必消耗推理 Token。
- `app/page.tsx` 已有「我的」页连接状态卡、模型来源标签和错误提示位置。
- `app/model-test/page.tsx` 可复用输入、加载、usage 和错误展示样式，但必须移除服务端开发者 Key 假设。
- 现有真实 AI/规则降级标识可以扩展为 Provider、模型和连接状态。

需要新增：

- 固定 Provider Registry。
- Provider → Key → 模型的三步组件。
- 请求级 Key 上下文。
- 匿名会话、限流和幂等 scope。
- 断开连接与刷新后重连说明。

首期不要做：

- 自定义 Base URL。
- 17 家 Provider 自动切换。
- 图片输入能力推断。
- 将 ChatGPT 套餐授权扩展到公网用户。

## F. 最短开发、验收、发布顺序

1. **冻结范围**：文字记录、TokenHub、临时 BYOK、浏览器本地数据、单实例。
2. **路由隔离**：新增 Public Beta Host 白名单，关闭 Test/OAuth/Health/Telegram/调试 API。
3. **BYOK 核心**：请求级 Key、固定 Provider/Model、模型列表和连接测试。
4. **正式流程接入**：Chat 与 Follow-up 使用用户 Key；本地个人版继续使用本机配置。
5. **公网保护**：匿名会话、按会话/IP 限流、安全幂等 scope、输入/输出/超时上限。
6. **隐私与合规**：隐私页、第三方 AI 告知、本地数据风险、删除/备份说明、Corresponding Source。
7. **生产安全**：CSP/HSTS/Cookie、HTTPS 反向代理、生产构建和单实例启动。
8. **真机验收**：Android Chrome、iPhone Safari、断网、刷新、重连、自动保存和备份。
9. **小范围发布**：邀请 5–20 名用户，观察 429、失败率、延迟和重复调用；达标后再扩容。

## G. 必须由用户在腾讯云控制台确认的事项

1. 实际使用 **CloudBase 云托管、静态托管 + 云函数，还是其他腾讯云产品**。
2. 是否支持单个长期运行 Node 实例、固定并发和稳定冷启动。
3. 是否允许固定实例数、关闭自动扩缩容，或提供共享 Redis/PostgreSQL 原子状态。
4. 环境变量和 Secret 的注入方式、是否可能被构建日志或控制台输出。
5. 出站网络、固定出口和访问 `tokenhub.tencentmaas.com` 的连通性。
6. 自定义域名、DNS、TLS 证书和 HTTPS 强制策略。
7. 反向代理是否正确覆盖 Host/Proto/Forwarded 头，是否记录请求体或自定义头。
8. 平台日志、APM、WAF 是否可能捕获 API Key 或用户原文，需要哪些脱敏配置。
9. TokenHub 账户、模型权限、免费额度、费用上限和 API Key 的调用范围。
10. 是否愿意为共享幂等/限流状态配置持久存储。
11. Public Beta 正式域名、隐私政策主体、用户条款和 AGPL Corresponding Source 地址。

## PB-01 当时的最终判断

- **可以上线复用**：记录、自动保存、去重、编辑、删除、统计、日历、备份、TokenHub 请求适配器、精确 Host/Origin 路由保护。
- **PB-01 当时不能直接上线**：当时存在 `/model-test`、开发者环境 Key、公网主应用路由、单进程幂等、非正式隐私文案、缺失安全头和缺失 Corresponding Source 等风险。PB-03 已完成代码侧收口，剩余外部门禁见本文 B 节。
- **最小可行路径**：TokenHub 单 Provider + 页面内存 BYOK + 浏览器本地记录 + 单长期运行实例 + 严格公网白名单 + 完整隐私/源码门禁。
- **PB-01 当时的下一步**：进入 `004-PB-02`。该任务与 `004-PB-03` 已完成；当前下一步是 `009-BETA` 的真实 HTTPS 预发布配置和移动端验收。
