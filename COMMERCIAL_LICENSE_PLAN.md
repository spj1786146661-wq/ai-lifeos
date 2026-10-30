# AI-LifeOS 开源与闭源模块隔离可行性评估

> 日期：2026-10-26。依据：本仓库实际源码、Git 记录、`OPEN_SOURCE_AUDIT.md`、小程序仓库实际文件与导入关系。
> 本文只做代码分析与架构设计。本轮未修改业务代码、未拆分模块、未删除文件、未安装依赖、未执行存储开发、未提交 Git。
> 许可证结论以可复现证据为限；凡需法律判断的部分均单独标注，不以工程结论替代法律意见。

## 1. 结论摘要

**目标架构在法律上可行，但不能靠拆进程或改用 HTTP 调用自动达成。**

现有网页版整体是上游 `ashishworkacc/life-tracker`（AGPL-3.0）的衍生作品，其自身继续开源没有障碍；真正需要单独判断的是把自研的 AI 分析引擎与商业后台作为闭源服务发布时，它是否与 AGPL 代码构成同一个作品。

工程上可以确认的事实是：`lib/life-records.ts` 是当前应用的数据契约与规范化中心，被解析、搜索、日历、去重、存储、附件、批量删除等模块共同依赖。任何闭源组件只要继续 import 这份文件，就与 AGPL 代码形成同一进程内的代码结合，闭源主张的风险很高。

因此低风险路径不是把同一个程序切成两个服务，而是**让闭源服务只依赖独立定义的接口契约，不复制、不 import AGPL 实现代码**。技术上可行，但需要重建一部分数据结构定义，并接受功能迁移成本。

在完成下列动作之前，不建议把任何自研模块按闭源发布：

1. 关闭闭源侧对 AGPL 派生文件的直接依赖。
2. 为闭源侧建立独立的 Schema 定义与测试。
3. 由法律专业人员确认衍生作品边界。

## 2. 判定方法

本文区分三类事实，避免把工程判断写成法律结论：

| 类型 | 含义 | 本文标注方式 |
| --- | --- | --- |
| 已证实 | 有 Git、源码、锁文件或文件哈希支撑 | 已证实 |
| 工程判断 | 由代码结构、导入关系和构建方式推出 | 工程判断 |
| 待法律确认 | 需要法律专业人员判断 | 待法律确认 |

同时明确一个原则：**使用 HTTP API、独立进程或独立部署，只说明工程上分离，不直接等于法律上独立。** 是否构成单一作品，取决于代码、数据结构的复制程度与两者之间的关系，而不取决于调用方式。本文在每一处隔离方案中都单独标注法律风险。

## 3. 必须遵守 AGPL 的现有模块及其衍生代码

### 3.1 判定依据

上游提交为 `1273bd9fb8005d10b03d5fedb9bdd66aee771844`，共 109 个文件。以 `git diff --numstat` 对比该提交与当前 HEAD，可以直接区分两类文件：**上游已存在并被修改的文件**，以及**本项目新增的文件**。

上游已存在的代码属于 AGPL 衍生，无论是否被修改。本项目新增的代码若与上游代码结合分发，同样整体受 AGPL 约束；判定其能否闭源，取决于它是否复制了 AGPL 实现。

### 3.2 AGPL 衍生代码清单（已证实）

以下文件在上游提交中已存在，当前仍在使用或已被修改：

| 位置 | 说明 |
| --- | --- |
| `app/layout.tsx`、`app/page.tsx`、`app/globals.css`、`app/favicon.ico` | 应用外壳与入口 |
| `app/(app)/` 下 29 个页面 | 上游原有页面（trackers、health、journal、goals、habits 等） |
| `app/(auth)/` 登录注册 | 上游认证页面 |
| `app/api/ai/` 下 12 个路由 | 上游 AI 路由（breakdown、chat、correlations、daily-brief、weekly-review 等） |
| `app/api/telegram/` 下 6 个路由 | 上游 Telegram 路由 |
| `app/api/health/` 下 2 个路由 | 上游健康数据路由 |
| `lib/ai/client.ts`、`lib/ai/prompts.ts`、`lib/ai/rateLimit.ts` | 上游 AI 客户端与提示词 |
| `lib/firebase/` 4 个文件 | 上游 Firebase 封装 |
| `lib/hooks/` 3 个文件 | 上游 React Hooks |
| `lib/xp.ts` | 上游经验值逻辑 |
| `components/command-center/QuickAddDrawer.tsx` | 上游组件 |
| `components/layout/` 7 个组件 | 上游导航与布局组件 |

这些文件是 AGPL 义务的直接对象：继续分发时必须保留 LICENSE、版权声明、来源说明和修改说明。

### 3.3 本项目新增但与 AGPL 代码结合的模块（已证实）

以下文件在上游提交中不存在，属于本项目新增。它们与上游代码在同一应用中结合分发，因此当前整体按 AGPL 处理；能否单独闭源，取决于其实现是否可脱离 AGPL 代码：

| 文件 | 行数规模 | 与 AGPL 代码的关系 |
| --- | --- | --- |
| `lib/life-records.ts` | 395 | 核心数据模型与规范化，被几乎所有自研模块依赖 |
| `lib/life-intent-parse.ts` | 274 | 规则解析，直接 import `life-records.ts` 与 `life-source-fragments.ts` |
| `lib/life-parse-server.ts` | 202 | 服务端解析入口，import 解析器与 AI Provider |
| `lib/life-chat.ts` | 62 | 聊天意图与分析统计，import `life-records.ts` |
| `lib/life-search.ts` | 44 | 搜索，import `life-records.ts` |
| `lib/life-calendar.ts` | 158 | 日历计算，import `life-records.ts` |
| `lib/life-record-duplicates.ts` | 66 | 去重指纹，import `life-records.ts` |
| `lib/life-auto-save.ts` | 76 | 自动保存批次，import 上述两个文件 |
| `lib/storage-adapter.ts` | 67 | 存储抽象，import `life-demo-store.ts` 与 `life-records.ts` |
| `lib/indexeddb-adapter.ts` | 350 | IndexedDB 适配器 |
| `lib/life-attachments.ts` | 374 | 附件引用与备份 |
| `lib/life-attachment-service.ts` | 326 | 附件恢复服务，import 附件、记录、去重模块 |
| `lib/life-record-bulk-delete.ts` | 176 | 批量删除，import 附件、记录、存储抽象 |
| `lib/life-migration-*.ts` | 6 个文件 | 迁移状态机、路由、引擎、校验 |
| `lib/ai/chatgpt-plan-*.ts` | 4 个文件 | ChatGPT 套餐授权与 Responses 调用 |
| `app/api/life-records/` 下 4 个路由 | — | 生活记录 API |
| `components/life-records/` 10 个组件 | — | 生活记录界面 |

其中 `lib/life-records.ts` 是关键节点：它既定义 `LifeRecord`、`LifeRecordDraft` 等类型，也实现 `normalizeLifeRecord`、`parseDemoLifeText`、`parseModelLifeCandidates`、`summarizeLifeRecords` 等函数。**它同时是数据契约和业务实现**，这是隔离难点的根源。

## 4. 完全自主研发、没有直接复制 AGPL 实现的模块

需要谨慎表述：以下模块是本项目从零编写的，但自主编写不等于可以闭源，因为它们与 AGPL 代码在同一作品中结合使用。

| 模块 | 自主性判断 | 能否独立闭源 |
| --- | --- | --- |
| `lib/ai/chatgpt-plan-oauth.ts` | 自主实现 OAuth、PKCE、JWKS 校验，未复制上游代码 | 具备独立条件，但需解除对下游的牵连 |
| `lib/ai/chatgpt-plan-credentials.ts` | 自主实现 DPAPI 凭据保护 | 同上 |
| `lib/ai/chatgpt-plan-responses.ts` | 自主实现 Responses API 调用与限额处理 | 同上 |
| `lib/ai/chatgpt-plan-provider.ts` | 自主实现 Provider 状态解析与降级 | 同上 |
| `lib/lan-access.ts` | 自主实现局域网访问码校验 | 具备独立条件 |
| `lib/tokenhub-model-test*.ts` | 自主实现腾讯云 TokenHub 测试接入 | 具备独立条件 |
| `lib/life-migration-state.ts` | 自主实现迁移状态机 | 依赖 `life-records.ts` 类型 |

导入关系显示（已证实）：`chatgpt-plan-*.ts` 相关文件之间的依赖只涉及 `node:crypto`、`openai` SDK 和彼此，**没有 import 任何 AGPL 派生的 `life-*.ts` 文件**。这是目前最有希望的闭源候选。

`lib/ai/client.ts` 与 `lib/ai/prompts.ts` 是上游文件，闭源服务不能直接复用它们。

## 5. 模块间依赖关系

### 5.1 网页端导入关系（已证实）

```text
life-records.ts  <- life-search.ts
                <- life-calendar.ts
                <- life-intent-parse.ts
                <- life-chat.ts
                <- life-record-duplicates.ts
                <- life-attachments.ts
                <- life-record-bulk-delete.ts
                <- storage-adapter.ts

life-intent-parse.ts + life-parse-server.ts -> life-records.ts
life-record-duplicates.ts + life-records.ts -> life-auto-save.ts
life-attachments.ts + life-records.ts -> life-attachment-service.ts
storage-adapter.ts + life-attachments.ts + life-records.ts -> life-record-bulk-delete.ts
life-record-store.ts -> storage-adapter / indexeddb-adapter / firebase / life-attachments / life-migration-routing

chatgpt-plan-provider.ts -> chatgpt-plan-responses.ts -> chatgpt-plan-credentials.ts + chatgpt-plan-oauth.ts
（该链路不 import 任何 life-*.ts）
```

关键结论：`life-records.ts` 是单一枢纽。它一旦被闭源服务引用，闭源服务就与整个 AGPL 衍生树绑定。

### 5.2 服务端路由耦合（已证实）

`app/api/life-records/chat/route.ts` 同时 import：

- `lib/ai/client`（上游 AGPL）
- `lib/ai/chatgpt-plan-provider`（自研）
- `lib/life-chat`、`lib/life-parse-server`、`lib/life-records`（自研但与 AGPL 结合）
- `lib/lan-access`（自研）

也就是说，当前路由层把上游 AI 客户端、自研 Provider 和生活记录逻辑混在同一个文件里。这种混合是后续隔离的主要工作量来源。

### 5.3 构建与运行依赖（已证实）

所有模块在同一 Next.js 应用中编译和运行，共享 `package.json` 与锁文件。这意味着：**即使把闭源服务放到另一台服务器，只要它继续 import 本仓库的 `.ts` 源码文件，就仍然构成代码结合。**

## 6. 哪些功能可以构成真正独立的服务

### 6.1 可以独立：ChatGPT 套餐授权与 Responses 调用

理由（工程判断）：该模块只依赖 `openai` SDK、`node:crypto` 和自身文件，不 import 任何 `life-*.ts`；其职责是授权、令牌刷新、限额判断和模型调用，与生活记录语义无关。

待法律确认：即便代码独立，若最终产品说明把它描述为同一产品的组成部分，仍需判断是否影响作品边界认定。

### 6.2 可以独立：AI 分析引擎（需重建数据结构）

现状（已证实）：`lib/life-chat.ts` 的 `analysisFacts()`、`normalizeAnalysisRecords()` 依赖 `life-records.ts` 的类型与规范化函数。这是自研逻辑，但依赖 AGPL 衍生文件。

可行改造：闭源分析引擎定义自己的输入结构，只接收已按分类汇总的事实数组，不接收也不理解 `LifeRecord`。上游 AGPL 网页端负责把记录转换为该结构。

待法律确认：数据结构的字段命名、分类体系若与 `LifeRecord` 高度一致，可能被认为复制了表达；需要判断六大分类这类功能性概念是否受保护。

### 6.3 难以独立：生活记录核心链路

`life-records.ts`、`life-intent-parse.ts`、`life-search.ts`、`life-calendar.ts`、`life-record-duplicates.ts`、`life-auto-save.ts` 这六个文件与上游代码在同一应用中结合，且相互依赖紧密。把它们拆成独立服务需要重建数据模型和规范化逻辑，成本高且容易引入数据不一致。

工程判断：这一层保持开源更合理。它既是 AGPL 义务的正当履行，也能作为公开的技术资产。

## 7. 目标架构评估：AGPL 开源应用 + 独立闭源商业服务

### 7.1 架构方案

```text
开源层（AGPL-3.0，保持开源）
  - 上游 LifeTracker 页面与组件
  - lib/life-records.ts 等记录核心
  - 网页界面、日历、搜索、统计
  - 完整源码公开，含 Corresponding Source
        |
        | HTTPS + 独立契约（JSON）
        v
闭源商业服务层（自主代码，不 import AGPL）
  - AI 分析引擎（周/月/年复盘、洞察生成）
  - ChatGPT 套餐授权与令牌管理
  - 商业后台（用户、配额、计费）
```

### 7.2 各隔离方式的技术可行性、许可证风险与法律确认点

#### 方式一：进程隔离 + HTTP API（当前最现实）

技术可行性：高。改造点是把 `lib/life-chat.ts` 的分析调用改为向闭源服务发请求。

许可证风险：中。HTTP 调用本身不保证法律独立（见第 2 节）。若闭源服务继续复用 `LifeRecord` 类型定义，风险仍高。

必须满足：

1. 闭源服务不得 import 或复制 `lib/life-records.ts`。
2. 闭源服务定义独立的输入输出 Schema。
3. 开源侧只发送脱敏后的汇总事实，不发送原始记录全文，同时也可降低隐私风险。

待法律确认：独立 Schema 是否足以构成独立作品。

#### 方式二：独立数据结构 + 序列化边界

技术可行性：中。需要把 `analysisFacts()` 的输出改为闭源服务可消费的格式，并建立版本化契约。

许可证风险：中低。数据通过序列化边界传递，不共享代码，法律上更接近独立程序。

待法律确认：分类体系、字段命名的一致性是否导致表达复制。

#### 方式三：闭源服务作为纯算法提供者

技术可行性：中。闭源服务只实现输入统计事实、输出分析文本，不理解生活记录语义。开源层负责全部语义映射。

许可证风险：低。这是最干净的边界：闭源侧没有任何生活记录领域知识。

代价：开源层需要承担更多映射逻辑；若未来想更换模型或调整分类，改动集中在开源层。

#### 方式四：AGPL 代码替换（成本最高）

技术可行性：低。需要重写记录核心，且上游 Git 历史中的 AGPL 代码不会消失。

许可证风险：低，但成本与风险不对等。

判断：不作为本轮建议。

### 7.3 关于同一程序的人为拆分

用户明确要求评估这一点。判定要点如下：

真正独立的服务应当具备：独立的代码库、独立的构建产物、独立的数据结构定义、可被第三方替换的实现、以及不依赖 AGPL 源码的接口契约。

反之，以下情况属于人为拆分的风险信号：

- 闭源服务 import 开源仓库的 `.ts` 文件。
- 两边共享同一份 `LifeRecord` 类型定义。
- 拆分只是为了改变许可证适用范围，功能上仍紧密耦合。
- 闭源服务无法被第三方实现替代。

按此标准，当前代码中 `lib/life-chat.ts` 与 `lib/life-records.ts` 的关系，以及 `app/api/life-records/chat/route.ts` 同时 import 上游 AI 客户端与自研 Provider 的写法，都更接近耦合而非独立服务。需要在改造中解除。

## 8. 微信小程序五个 AGPL 来源模块的合规处理

### 8.1 现状（已证实）

小程序位于 AI-LifeOS 同级目录的 `ai-lifeos-miniprogram`，`miniprogram/shared/` 下有 7 个共享模块，其中 5 个与网页版同源：

| 小程序文件 | 网页版来源 | 大小 |
| --- | --- | --- |
| `shared/life-records.ts` | `lib/life-records.ts` | 16167 B |
| `shared/life-calendar.ts` | `lib/life-calendar.ts` | 3214 B |
| `shared/life-record-duplicates.ts` | `lib/life-record-duplicates.ts` | 1867 B |
| `shared/life-auto-save.ts` | `lib/life-auto-save.ts` | 1257 B |
| `shared/life-search.ts` | `lib/life-search.ts` | 678 B |

另有 2 个自研模块：`shared/wechat-storage-adapter.ts`（5052 B）、`shared/life-ai-gateway.ts`（1049 B）。

文件哈希与网页版不同，但 diff 显示六分类定义、规范化逻辑、搜索匹配、日历网格、重复指纹、自动保存批次的实现同源，差异主要是为微信环境删减和改写。**这属于对 AGPL 代码的修改复制，不是独立实现。**

小程序当前没有 LICENSE 文件，也没有 AGPL 文本或源码获取说明。

### 8.2 三种处理方案

#### 方案一：小程序整体按 AGPL 开源（推荐）

做法：在小程序仓库根添加 AGPL-3.0 LICENSE、版权声明、来源说明和修改说明；提供 Corresponding Source 获取方式，例如在小程序关于页给出公开仓库地址。

技术可行性：高，只需补文档和一个仓库。
许可证风险：低，义务直接履行。
商业影响：小程序源码需公开，但不影响闭源商业后台。
待法律确认：小程序商店分发场景下，源码提供方式是否满足 AGPL 第 13 条要求。

#### 方案二：重写五个模块，使其真正独立

做法：按 `LifeRecord` 的字段语义重新实现规范化、搜索、日历、去重、自动保存，不复制上游实现细节。

技术可行性：中。五个模块合计约 23 KB，逻辑清晰，可重写；但需要重新建立测试。
许可证风险：中。重新实现是否被认定为独立作品，取决于实现差异程度，不能仅因自行编写就认定独立。
待法律确认：这是本方案的关键，必须由法律专业人员判断。

#### 方案三：小程序改为调用开源后端，本地不持有这些模块

做法：小程序只做界面，记录解析、校验、统计全部由开源 AGPL 后端提供，本地只保留存储适配器。

技术可行性：中低。需要后端 API，且离线能力下降。
许可证风险：中。调用方式不自动带来独立（见第 2 节）。
待法律确认：同上。

### 8.3 建议

优先方案一。理由：小程序是 AGPL 派生代码的直接分发形式，补齐许可证义务成本最低；方案二的重写在法律上仍不确定，却要承担全部重写成本和回归测试成本。

## 9. 商业后台与闭源 AI 引擎的边界设计

### 9.1 闭源侧允许包含

- AI 模型调用、提示词工程、结果解析与校验。
- ChatGPT 套餐 OAuth、令牌刷新、限额管理。
- 用户账户、配额、计费、订阅逻辑。
- 跨用户聚合分析，需单独评估隐私合规。
- 与生活记录语义无关的通用算法。

### 9.2 闭源侧禁止包含

- 任何 `lib/life-*.ts` 的 import 或源码复制。
- 与 `LifeRecord` 完全一致的类型定义，尤其字段名、分类枚举、规范化规则。
- 上游 `lib/ai/client.ts`、`lib/ai/prompts.ts` 的复制。
- 上游 `lib/firebase/`、`lib/xp.ts`、`components/layout/` 的复制。

### 9.3 契约设计原则

闭源服务通过版本化 JSON 契约通信，契约只描述输入统计事实、输出分析结论，不描述生活记录领域模型：

```json
{
  "contractVersion": "1",
  "period": "week",
  "facts": [{ "category": "exercise", "count": 4, "metrics": {} }],
  "summary": "...",
  "insights": [],
  "model": "..."
}

```

这样做的好处是闭源服务不理解运动、睡眠的业务含义，只处理通用分类统计，法律边界更清晰。

待法律确认：`category` 字段若与六大分类一一对应，是否仍被认为复制了表达。

## 10. 成本最低、对现有功能影响最小的改造顺序

按先补义务、再建边界、最后才考虑重写排列。每一步都可独立验收，任一步骤未通过即可停止。

### 第一步：履行现有 AGPL 义务（零代码风险）

动作：

1. 确认 `LICENSE`、`TERMS_OF_USE.md` 保留完好，已证实存在。
2. 为公开部署准备 About 页或页脚，提供 Corresponding Source 获取入口。
3. 建立最终产物的第三方许可证、NOTICE 与 SBOM 生成流程。
4. 为小程序补齐 LICENSE、版权与来源说明，对应 8.3 节方案一。

成本：低，主要是文档与构建流程。
影响：不影响任何现有功能。
验收：公网页面可见源码获取入口；小程序包含许可证文件。

### 第二步：把 ChatGPT 套餐授权抽成可独立部署单元（低风险）

动作：

1. 保持 `lib/ai/chatgpt-plan-*.ts` 相关文件不 import 任何 `life-*.ts`，已证实当前满足。
2. 新增测试，断言这条依赖规则不被破坏。
3. 文档明确该模块可独立部署为授权服务。

成本：低，主要是测试与文档。
影响：不改变现有行为。
验收：依赖规则测试通过；模块可在独立进程中运行。

### 第三步：为闭源 AI 分析引擎定义独立契约（中等成本）

动作：

1. 新建契约定义，含类型与校验，放在将来闭源仓库，不放在本仓库。
2. 在开源侧新增适配函数，把 `analysisFacts()` 输出转换为契约格式。
3. 调用点从本地函数改为服务请求，保留规则降级路径。

成本：中。需要改造 `lib/life-chat.ts` 与 `app/api/life-records/chat/route.ts`。
影响：需要回归测试聊天分析功能。
验收：分析功能在降级模式下行为不变；契约校验失败有明确提示。

### 第四步：解耦路由层混合依赖（中等成本）

动作：

1. 将 `app/api/life-records/chat/route.ts` 中对上游 `lib/ai/client` 与自研 Provider 的混合引用拆分。
2. 上游 AGPL 路由与自研路由分离，各自依赖清晰。

成本：中。
影响：需要回归全部生活记录 API。
验收：API 测试通过；文件依赖图不再混用两类代码。

### 第五步：评估商业后台独立部署（后续）

动作：在第三、四步完成后，再设计用户账户、配额、计费。

成本：高。
前置条件：法律确认前三步的边界有效。

### 不建议的动作

- 现在重写 `lib/life-records.ts`：影响全部功能，且法律收益不确定。
- 现在删除或替换上游代码：`AGENTS.md` 要求发现许可证风险先记录，不擅自删除或替换来源代码。
- 现在拆分小程序模块：收益低于风险。

## 11. 风险登记

| 编号 | 风险 | 等级 | 当前状态 |
| --- | --- | --- | --- |
| R1 | 网页版整体为 AGPL 衍生，闭源商业 SaaS 不能直接宣称合规 | 高 | 已证实，需履行义务 |
| R2 | 小程序五个模块为 AGPL 修改复制，无许可证声明 | 高 | 已证实，需补文档或重写 |
| R3 | `TERMS_OF_USE.md` 的 Non-Commercial 措辞与 AGPL 源码共享要求存在冲突 | 高 | 已证实存在冲突，待法律确认 |
| R4 | 闭源服务若继续 import `life-records.ts`，闭源主张不成立 | 高 | 工程判断，需改造解除 |
| R5 | HTTP API 调用被误认为法律独立 | 中 | 已在本文明确否定 |
| R6 | 契约字段与六大分类高度一致，可能被认为复制表达 | 中 | 待法律确认 |
| R7 | 小程序重写方案的法律不确定性 | 中 | 待法律确认 |
| R8 | 上游截图、SVG、商标授权未核实 | 中 | 待核实 |
| R9 | LGPL、MPL、CC-BY 依赖在最终产物中的义务 | 中 | 已在 `OPEN_SOURCE_AUDIT.md` 记录 |

## 12. 需要法律专业人员确认的问题

1. `TERMS_OF_USE.md` 的 Non-Commercial 条款与 AGPL-3.0 的组合效力，以及它是否构成额外商业许可。
2. 自研模块与 AGPL 代码在同一 Next.js 应用中结合时，衍生作品边界的认定。
3. 独立 JSON 契约加独立 Schema 是否足以支持闭源发布。
4. 契约中保留六大分类语义是否构成表达复制。
5. 小程序以 AGPL 开源分发时，源码提供方式是否满足第 13 条要求。
6. 小程序重写方案的独立性认定标准。
7. 上游截图、Create Next App 脚手架 SVG 及商标的授权范围。
8. OpenAI、腾讯云、Firebase、微信等服务条款对商业分发的限制。

## 13. 本轮未做的事

按任务约束，本轮只生成本文档：

- 未修改任何业务代码。
- 未拆分、删除或移动任何模块。
- 未安装依赖。
- 未执行存储开发。
- 未提交 Git、未打标签、未推送。
- 未读取、修改、删除 `$null`、`tools-build-stage/` 或 `.next-model-test-prod-audit/`。

遗留说明：比对上游文件清单时曾创建临时文件 `.upstream-files.txt`，删除它被自动审批以本轮除报告外不得改动项目文件为由拒绝。该文件仅含上游文件名列表、不含敏感信息，保留在工作区未跟踪状态，由你决定是否删除。

另一未跟踪空文件 `b[1]-a[1]))` 是上一轮命令解析误产生的，同样保留原样。

## 14. 下一步建议

1. 先执行第 10 节第一步与第二步：成本最低、无功能风险，且立即降低许可证风险。
2. 在第三步之前取得第 12 节第 2、3 项的法律意见，避免改造方向错误。
3. 小程序按方案一补许可证文档，可与网页版义务履行并行推进。

完成法律确认后，再决定是否进入第三、四步的代码改造。
## 15. 任务 002 修订版（2026-10-26，基于任务 001 与 001-B 结论）

本节依据 `OPEN_SOURCE_AUDIT.md`（含第 21 节补充审计）与 `SOURCE_PROVENANCE_MATRIX.md` 重写任务 002 的七项要求。上文第 1 至 14 节保留为历史分析，事实以本节与两份审计报告为准。

### 15.1 AGPL 修改版本及其源代码范围

本项目是 `ashishworkacc/life-tracker` 的修改版本。上游基线为共同祖先 `1273bd9fb8005d10b03d5fedb9bdd66aee771844`，该树共 109 个文件，根 `LICENSE` 为 GNU AGPL v3。

以当前 HEAD `c9cb724ddd30d1cb6674f1d9794f4c45316b8721` 对比基线，`app`、`components`、`lib` 范围共 50 个文件变动：新增 9775 行、删除 169 行，其中 4 个文件被修改，46 个文件为新增，0 个删除。修改的 4 个文件为 `app/page.tsx`、`app/globals.css`、`app/layout.tsx`、`app/(auth)/signup/page.tsx`。

把范围扩大到整个 Git 树，基线到 HEAD 共 111 个文件变动，新增 23790 行、删除 182 行，其中 100 个文件为新增、11 个文件被修改。多出的部分是 `app/api/model-test/`、`app/model-test/`、`lib/lan-access.ts`、`lib/tokenhub-model-test*.ts`、`tests/*.test.mjs`、`docs/**` 等自研与文档文件，不属于上游内容。

需要注意，`middleware.ts` 在上游基线和当前 HEAD 中都存在，但工作区中已被删除且尚未提交。发布版本必须明确它是否属于计划内的删除。

需要开源发布的 Corresponding Source 范围包括：

1. 上游 109 个文件的全部内容，含未修改部分。
2. 本项目对上游文件的修改：`app/page.tsx`、`app/globals.css`、`app/layout.tsx`、`app/(auth)/signup/page.tsx`。
3. 本项目新增的 47 个文件，即 `lib/life-*.ts`、`lib/ai/chatgpt-plan-*.ts`、`lib/storage-adapter.ts`、`lib/indexeddb-adapter.ts`、`app/api/life-records/**`、`components/life-records/**`、`app/dev/migration-test/**` 及相关测试。
4. 构建所需配置：`package.json`、`package-lock.json`、`next.config.ts`、`tsconfig.json`、`middleware.ts`（当前为删除状态，需在发布版本中说明）。

不需要开源的范围：`node_modules`（第三方包按各自许可证分发）、`.next` 构建产物、真实用户数据、OAuth 凭据、备份文件。

`TERMS_OF_USE.md` 第 2 节标题为 Non-Commercial Use，正文又讨论满足 AGPL 源码共享要求的商业产品，并附加 significant functional transformation 表述。该措辞与标准 AGPL 的商用边界存在冲突，需向权利人澄清，见第 12 节。

### 15.2 自主功能与 AGPL 应用的结合程度

按结合紧密程度分三档：

第一档，紧密结合，难以在不改动开源应用的前提下抽离：

| 功能 | 依赖文件 | 结合方式 |
| --- | --- | --- |
| 六大分类数据模型 | `lib/life-records.ts` | 定义 `LifeRecord`、`LifeRecordDraft`，被 8 个以上自研模块 import |
| 规则解析 | `lib/life-intent-parse.ts`、`lib/life-parse-server.ts` | 直接 import 数据模型 |
| 搜索 | `lib/life-search.ts` | import 数据模型 |
| 日历 | `lib/life-calendar.ts` | import 数据模型 |
| 去重 | `lib/life-record-duplicates.ts` | import 数据模型 |
| 自动保存 | `lib/life-auto-save.ts` | import 数据模型与去重模块 |
| 存储与迁移 | `storage-adapter.ts`、`indexeddb-adapter.ts`、`life-migration-*.ts` | import 数据模型与 `life-demo-store.ts` |
| 附件 | `life-attachments.ts`、`life-attachment-service.ts` | import 数据模型与去重模块 |
| 批量删除 | `life-record-bulk-delete.ts` | import 数据模型、附件、存储抽象 |
| 界面 | `components/life-records/**`、`app/page.tsx` | `app/page.tsx` 本身是上游文件的修改版 |

第二档，可独立但当前与开源应用同进程：`app/api/life-records/chat/route.ts` 同时 import 上游 `lib/ai/client`、自研 `chatgpt-plan-provider` 和生活记录模块；`image/route.ts` 同样 import 上游 `lib/ai/client`。这两个路由是隔离的主要工作量。

第三档，已具备独立条件：`lib/ai/chatgpt-plan-oauth.ts`、`chatgpt-plan-credentials.ts`、`chatgpt-plan-responses.ts`、`chatgpt-plan-provider.ts`、`local-request-security.ts` 只依赖 `node:crypto`、`openai` SDK 和彼此，不 import 任何 `life-*.ts`。`lib/lan-access.ts` 与 `lib/tokenhub-model-test*.ts` 同样自主。

### 15.3 独立 AI 服务、商业后台与开源应用的隔离方案

前提原则：独立进程、HTTP API、独立部署只证明工程分离，不直接等于法律独立。判定独立作品要看代码与数据结构的复制程度，以及两者能否互相替换。以下每种方案都单独标注法律风险。

方案一，进程隔离加 HTTP API。改造点是把 `lib/life-chat.ts` 的分析调用改为请求闭源服务。技术可行性高，法律风险中。若闭源服务继续复用 `LifeRecord` 类型定义，闭源主张仍然不稳。必须满足：闭源侧不 import 不复制 `lib/life-records.ts`；闭源侧定义独立输入输出 Schema；开源侧只发送汇总事实，不发送原始记录全文。

方案二，序列化边界加独立 Schema。开源侧把 `analysisFacts()` 输出转换为版本化 JSON 契约，闭源侧只理解契约。法律风险中低，因为不共享代码。需确认分类字段命名是否构成表达复制。

方案三，闭源服务作为纯算法提供者。闭源侧只实现输入统计事实、输出分析文本，不理解运动、睡眠、学习等业务含义，全部语义映射留在开源侧。法律风险最低，是最干净的边界。代价是映射逻辑集中在开源层，未来调整分类只需改开源侧。

方案四，替换 AGPL 代码。需重写记录核心，且上游 Git 历史中的 AGPL 代码不会消失。法律风险低但成本与收益不对等，不建议。

关于人为拆分的判定标准：真正独立的服务应具备独立代码库、独立构建产物、独立数据结构定义、可被第三方替换、以及不依赖 AGPL 源码的接口契约。反之，闭源服务 import 开源仓库 `.ts` 文件、两边共享同一份 `LifeRecord` 类型定义、拆分只为改变许可证适用范围而功能仍紧密耦合、闭源服务无法被第三方替代，都属于人为拆分信号。按此标准，当前 `life-chat.ts` 依赖 `life-records.ts`、以及聊天路由混用上游 AI 客户端与自研 Provider 的写法，都更接近耦合。

推荐组合：方案三作为闭源 AI 引擎形态，方案二作为通信契约，方案一作为部署方式。第一步不写代码，只需把契约定义与依赖规则确定下来。

### 15.4 网页版与小程序分别应履行的许可证义务

网页版：

1. 保留 `LICENSE`（AGPL-3.0 全文）、`TERMS_OF_USE.md`、上游版权声明。
2. 保留并展示对 `karim-coder/life-os`（MIT）的致谢与通知，现有 `docs/third-party-notices/life-os-MIT.txt` 已含完整 MIT 正文与版权行，前面另加来源网址，需继续保留。
3. 公网提供远程交互时，向用户显著提供当前运行版本 Corresponding Source 的获取入口，例如关于页或页脚链接，指向与运行版本一致的提交或标签。
4. 为最终产物生成第三方许可证清单、NOTICE 与 SBOM，覆盖 19 个直接依赖与锁文件中的 LGPL、MPL、CC-BY 包。
5. 对 Apache-2.0 包保留许可证、NOTICE 与修改说明。
6. 说明本项目相对上游的修改，至少在源码仓库中提供修改说明。

小程序：

1. 五个共享模块 `shared/life-records.ts`、`life-calendar.ts`、`life-record-duplicates.ts`、`life-auto-save.ts`、`life-search.ts` 已证实是对网页 AGPL 代码的修改移植，SHA-256 均不同、行数有差异，但六分类定义、规范化流程、搜索匹配、日历网格、重复指纹、自动保存批次逻辑同源。
2. 小程序当前没有 LICENSE 文件，也没有 AGPL 文本或源码获取说明，这是分发前的阻断项。
3. 三个处理方案：整体按 AGPL 开源并补许可证与源码入口（推荐，成本最低）；重写五个模块使其真正独立（法律上仍不确定，且需重建测试）；改为调用开源后端、本地只留存储适配器（需后端 API，离线能力下降，且调用方式不自动带来独立）。
4. 小程序还需单独满足微信平台的隐私指引、域名备案、服务类目等要求，这些不是开源许可证问题。

### 15.5 LifeTracker 与 Life OS 的致谢和许可证声明方案

LifeTracker（AGPL-3.0）需要：

1. 仓库根保留 `LICENSE` 文件，内容为 AGPL-3.0 全文，不得删除或替换。
2. 新增 `NOTICE` 或在 `README.md` 中增加来源段落，写明：本项目基于 `https://github.com/ashishworkacc/life-tracker` 的 `1273bd9fb8005d10b03d5fedb9bdd66aee771844` 版本修改而来，上游版权归原权利人所有，修改部分按 AGPL-3.0 发布。
3. 在界面关于页展示同样信息，并提供源码获取链接。
4. 列出主要修改内容摘要，例如新增六大分类中文生活记录、聊天解析、日历、IndexedDB 适配与迁移引擎、ChatGPT 套餐接入。
5. 保留 `TERMS_OF_USE.md`，同时在文档中记录其措辞与 AGPL 的冲突待澄清，不自行改写其法律含义。

Life OS（MIT）需要：

1. 保留 `docs/third-party-notices/life-os-MIT.txt`，内含完整 MIT 正文与 `Copyright (c) 2026 Life OS` 版权行。
2. 在关于页或 NOTICE 中致谢：`components/life-records/CapsuleDashboard.tsx` 的 SVG 圆环进度写法参考了 `https://github.com/karim-coder/life-os`（MIT）的 focus-view 实现。
3. 不得把整个 AGPL 派生项目改标为 MIT，也不得删除该通知。

候选仓库 `gunnar0022/lifeboard`、`sushil766/life-os`、`lunanoir21/Life-os-project`、`edrisranjbar/lifeos` 经核查均未使用，不需要致谢或许可证声明。其中 LifeBoard 存在 LICENSE 为 MIT 而 README 第 294 行写 Not currently licensed for redistribution 的冲突，浅克隆无法确定 LICENSE 首次引入时间；本项目未使用其代码，该冲突不影响本项目，仅登记备查。

### 15.6 成本最低、最大限度保留现有功能的整改路线

第一阶段，零代码风险，只补文档与构建流程：

1. 在 `README.md` 增加来源、致谢、修改说明与 Corresponding Source 获取说明。
2. 新增关于页或页脚入口，展示 AGPL 义务信息与源码链接。
3. 建立最终产物的第三方许可证清单、NOTICE 与 SBOM 生成流程。
4. 为小程序补 AGPL LICENSE、版权声明、来源说明与源码获取方式。

第二阶段，低风险，加测试不加行为：

1. 新增依赖规则测试，断言 `lib/ai/chatgpt-plan-*.ts` 与 `lib/lan-access.ts` 不 import 任何 `lib/life-*.ts`，防止未来无意耦合。
2. 在文档中明确该授权模块可独立部署。

第三阶段，中等成本，需回归测试：

1. 定义闭源 AI 分析契约（类型与校验），契约只描述输入统计事实与输出分析结论。
2. 在开源侧新增适配函数，把 `analysisFacts()` 输出转为契约格式。
3. 调用点从本地函数改为服务请求，保留规则降级路径，AI 不可用时明确告知用户。
4. 拆分 `app/api/life-records/chat/route.ts` 与 `image/route.ts` 中上游 AI 客户端与自研 Provider 的混合依赖。

第四阶段，后续：在第三阶段完成且法律确认有效后，再设计商业后台的用户账户、配额与计费。

不建议的动作：现在重写 `lib/life-records.ts`（影响全部功能且法律收益不确定）；现在删除或替换上游代码（违反项目规则，发现许可证风险先记录）；现在拆分小程序模块（收益低于风险）。

### 15.7 需要法律专业人员确认的事项

1. `TERMS_OF_USE.md` 的 Non-Commercial Use 条款与 AGPL-3.0 的组合效力，以及它是否构成额外商业许可或额外限制。
2. 自研模块与 AGPL 代码在同一 Next.js 应用中结合时，衍生作品边界的认定。
3. 独立 JSON 契约加独立 Schema 是否足以支持闭源发布。
4. 契约中保留六大分类语义是否构成表达复制。
5. 小程序以 AGPL 开源分发时，源码提供方式是否满足 AGPL 第 13 条要求。
6. 小程序重写方案的独立性认定标准。
7. 上游截图、Create Next App 脚手架 SVG 及 Vercel 等商标的授权范围。
8. OpenAI、腾讯云、Firebase、微信等服务条款对商业分发的限制。
9. 闭源 AI 服务处理用户生活记录时的隐私与数据保护义务，尤其是跨用户聚合分析。

## 16. 后续产品路线（仅登记，本轮不开发）

以下需求由用户在本轮提出，只作为后续开发候选项记录。本轮未开始任何实现，也未评估各自的技术方案优先级。

1. Web 端保存后最多三次有效智能补充提醒。规则是先保存再提醒，用户拒绝后不再打扰同一事项。
2. 微信小程序 Lite 本地存储监控、备份及导出。
3. Web 端 JSON 与 ZIP 数据导入及去重。
4. Web 端手表运动、心率及睡眠数据文件导入。
5. Web 端饮食照片识别与可选营养分析。

其中第 5 项涉及图片识别与营养估算，需要先确认可用的视觉模型与授权范围，且不得在用户未提供数值时编造重量、热量或金额。

## 17. 本轮执行边界

本轮只生成本文档：

- 未修改业务代码。
- 未拆分、删除或移动任何模块。
- 未安装依赖。
- 未执行存储开发。
- 未提交 Git、未打标签、未推送。
- 未读取、修改、删除 `$null`、`tools-build-stage/`、`.next-model-test-prod-audit/`。
- 未读取真实用户数据、密钥或私人资料。

尝试删除旧版 `COMMERCIAL_LICENSE_PLAN.md` 以整体重写时，被自动审批以超出本轮授权范围为由拒绝，因此改为在文末追加本节，保留第 1 至 14 节历史内容。此前比对上游清单生成的 `.upstream-files.txt` 与误产生的 `b[1]-a[1]))` 两个空文件仍保留原样，由用户决定是否删除。
