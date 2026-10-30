# AI 服务依赖边界说明

本文件记录 AI-LifeOS 中受保护 AI 模块的依赖边界，以及 `tests/ai-service-boundary.test.mjs` 的检查范围与盲区。

编制日期：2026-10-26

## 1. 目的与结论边界

AI-LifeOS 网页版是 AGPL-3.0 项目 LifeTracker 的衍生作品。`lib/ai/chatgpt-plan-*.ts` 与 `lib/ai/local-request-security.ts` 目前相对独立，未来存在单独部署为闭源 AI 服务的设想。

本文件与配套测试只处理**工程事实**：受保护模块的依赖闭包不会悄悄扩大到业务代码。

> **本文件不构成法律意见。** 不直接 import AGPL 模块，不等于法律上自动构成独立作品。独立性认定见 `COMMERCIAL_LICENSE_PLAN.md` 第 15.7 节，需专业法律确认。

## 2. 受保护模块

五个模块构成受保护集合，允许彼此依赖，闭包不得越界：

| 模块 | 行数 | 职责 |
| --- | --- | --- |
| `lib/ai/chatgpt-plan-credentials.ts` | 358 | 凭据读写、DPAPI 保护、设备标识、常量 |
| `lib/ai/chatgpt-plan-oauth.ts` | 660 | OAuth 授权、PKCE、回调校验、Token 交换与刷新 |
| `lib/ai/chatgpt-plan-responses.ts` | 238 | Responses API 调用与流式解析 |
| `lib/ai/chatgpt-plan-provider.ts` | 211 | Provider 状态判定与统一调用入口 |
| `lib/ai/local-request-security.ts` | 40 | 本地请求的同源与 Host 校验 |

## 3. 当前依赖关系

### 3.1 直接依赖

| 模块 | 本地依赖 | 第三方包 | Node.js 内置 |
| --- | --- | --- | --- |
| `chatgpt-plan-credentials.ts` | 无 | 无 | `child_process`, `crypto`, `fs`, `os`, `path` |
| `chatgpt-plan-oauth.ts` | `chatgpt-plan-credentials.ts` | 无 | `crypto` |
| `chatgpt-plan-responses.ts` | `chatgpt-plan-credentials.ts`, `chatgpt-plan-oauth.ts` | 无 | 无 |
| `chatgpt-plan-provider.ts` | `chatgpt-plan-credentials.ts`, `chatgpt-plan-responses.ts` | 无 | 无 |
| `local-request-security.ts` | 无 | 无 | 无 |

### 3.2 依赖图

```
chatgpt-plan-provider.ts
├── chatgpt-plan-responses.ts
│   ├── chatgpt-plan-oauth.ts
│   │   └── chatgpt-plan-credentials.ts
│   └── chatgpt-plan-credentials.ts
└── chatgpt-plan-credentials.ts

local-request-security.ts   (无依赖)
```

**本地传递闭包 = 上述五个文件，无第六个文件。**

**第三方包数量 = 0。** 注意 `openai` SDK 只被未受保护的 `lib/ai/client.ts` 使用，不在本集合内。

### 3.3 配置读取

模块只读取以下环境变量，不读取页面、路由或中间件上下文：

- `CHATGPT_PLAN_CREDENTIALS_FILE`
- `CHATGPT_PLAN_INSTALLATION_FILE`
- `CHATGPT_PLAN_HOST_ID`
- `CHATGPT_PLAN_MODEL`
- `CHATGPT_PLAN_VISION_MODEL`

## 4. 已确认禁止的依赖

测试会拒绝以下任何直接或间接依赖：

| 类别 | 判定 |
| --- | --- |
| AGPL 业务模块 | 任何 `life-*` 模块 |
| Next.js 运行时 | `next`、`next/*` |
| React 运行时 | `react`、`react-dom` |
| 路径别名 | `@/` 开头的任何引用 |
| Firebase | `firebase*` |
| 存储适配层 | `storage-adapter`、`indexeddb-adapter` |
| 应用内部类型 | 源码出现 `LifeRecord` 标记或引用 `life-records` |
| 未获准第三方包 | 白名单外的一切包 |

核心判据是闭包相等：**受保护模块的可解析本地传递闭包必须恰好等于五个文件**。任何新增的跨目录本地依赖都会使测试失败，无需逐个维护黑名单。

## 5. 允许的独立依赖

- Node.js 标准库：`assert`、`buffer`、`child_process`、`crypto`、`events`、`fs`、`http`、`https`、`net`、`os`、`path`、`process`、`stream`、`string_decoder`、`timers`、`tls`、`url`、`util`、`zlib`。
- 第三方包白名单当前为**空集**。确需引入时，应同时修改 `ALLOWED_PACKAGES` 并复核其对独立性的影响。

## 6. 自动化测试覆盖范围

`tests/ai-service-boundary.test.mjs` 共 13 项，分为两组。

### 6.1 真实工程检查（8 项）

1. 五个受保护模块全部存在。
2. 本地传递闭包严格等于五个模块。
3. 无越界依赖或未获准第三方包。
4. 不直接或间接依赖 `life-*`。
5. 不共享 `LifeRecord` 内部类型。
6. 不依赖 Next.js 运行时。
7. 不使用 `@/` 别名或动态 import 绕开检查。
8. 外部依赖仅限标准库与白名单。

### 6.2 检测器自检（5 项）

用内存中的合成源码证明检测器有效，**不修改真实业务文件**：

1. 越界 `life-*` 依赖被检出。
2. 多行 `import` 与 `export ... from` 同样被解析。
3. 合法 Node 内置模块与 SDK 不被误伤。
4. 无法静态解析的动态 import 被记为盲区。
5. 未获准第三方包被拒绝。

此外，在系统临时目录构造了带真实文件系统的越界依赖，用同一检测器验证会产出 2 条违规并清理临时目录，**全程未触碰仓库文件**。

## 7. 检测盲区

本测试**不宣称 100% 覆盖**。已知盲区：

1. **非字面量动态引用**。`import(someVar)`、`require(someVar)` 无法静态解析。测试会把这类写法记为盲区并失败，但被计算的变量内容本身无法追溯。
2. **运行时字符串拼接**。通过字符串拼接构造的模块名不在检测范围内。
3. **重新导出链条跨文件**。`export * from './x'` 会被解析，但若经过多层间接再导出且路径非常规，可能遗漏。当前闭包只有一层，已覆盖。
4. **类型层面的隐式耦合**。结构形状相同但名称不同的类型不会被判为共享类型。
5. **代码复制。** 把业务逻辑抄一份进受保护模块，静态依赖分析无法发现。这恰恰是法律独立性最需要人工审查的部分。
6. **第三方包自身的传递依赖**。测试只检查受保护模块直接声明的包名，不展开其内部依赖树。

## 8. 尚未解决的技术耦合

### 8.1 调用方（方向安全）

以下文件依赖受保护模块，方向是「AGPL 应用 → AI 模块」，**不会把 AGPL 代码拉进 AI 闭包**：

| 调用方 | 引用的受保护模块 |
| --- | --- |
| `app/api/life-records/chatgpt-plan/route.ts` | credentials, provider, oauth, local-request-security |
| `app/api/life-records/chatgpt-plan/authorize/route.ts` | credentials, oauth, local-request-security |
| `app/api/life-records/chat/route.ts` | provider |
| `app/api/life-records/image/route.ts` | provider |
| `lib/life-parse-server.ts` | provider |

其中 `app/api/life-records/chat/route.ts`、`image/route.ts`、`lib/life-parse-server.ts` 同时依赖 AGPL 业务模块与上游 `lib/ai/client.ts`。它们是**混合耦合点**，但耦合在 AI 模块之外，不影响本文件的闭包结论。

### 8.2 抽取时的实际阻力

1. `lib/life-parse-server.ts` 反向依赖 `chatgpt-plan-provider.ts`。抽取 AI 服务时这个 AGPL 文件必须改造，属于应用侧工作量。
2. 五个模块当前以文件路径方式被引用，抽取时需建立稳定的包边界与版本号。
3. 环境变量（凭据文件路径、模型名）属于进程配置，抽取后需要独立的配置注入方式。
4. 凭据存储依赖 Windows DPAPI（`child_process` 调用 PowerShell）。跨平台部署需要新的安全存储实现。

## 9. 未来独立部署建议

1. **先定契约再拆代码。** 定义独立输入输出 Schema，避免闭源侧复用 `LifeRecord` 结构。
2. **保持单向依赖。** 继续让 AGPL 应用依赖 AI 模块，禁止 AI 模块反向依赖业务代码。
3. **纳入 CI。** 本测试必须进入常规测试集，阻止后续无意耦合。
4. **抽取顺序**：先把 `local-request-security.ts` 与 `chatgpt-plan-credentials.ts` 打成可复用包，再处理 `oauth`/`responses`，最后是 `provider`。
5. **跨平台凭据**。DPAPI 替换方案需单独设计并测试，不能回退到弱加密。
6. **不要为了拆分而拆分**。若无闭源商业诉求，维持现状的合规成本最低。

## 10. 需要进一步法律确认的事项

1. 五个模块在技术上独立，是否足以支持法律意义上的独立作品认定。
2. Provider 层暴露的接口语义是否构成对 AGPL 代码表达的复制。
3. 抽取后若闭源服务仍使用「六大分类」等业务概念，是否影响独立性判定。
4. 独立部署后，AGPL 应用与闭源服务之间的数据传输是否触发额外义务。
5. 小程序侧五个 AGPL 移植模块与本 AI 模块边界的交叉影响。
