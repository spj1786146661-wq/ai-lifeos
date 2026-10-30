# AI-LifeOS TokenHub 401 认证与重复请求诊断

检查日期：2026-10-27
任务：AIOS-004-W-AUTH
范围：TokenHub 正式聊天认证配置、请求次数、脱敏错误信息与测试
真实推理：未执行

## 结论

当前 `.env.local` 中的 TokenHub Key 在无凭据泄漏风险的前提下，经只读
`GET https://tokenhub.tencentmaas.com/v1/models` 检查返回 HTTP 401：

```text
error.code = 401002
error.message = The API Key does not exist or signature verification failed.
```

因此，当前配置下已经确认是 API Key 认证失败。腾讯云当前返回的业务码是
`401002`，不是请求路径、模型 ID、JSON 输出参数或 Bearer Header 拼接错误。

历史 3051 验收进程已经退出，当时使用的 Key 内容和进程环境无法重新取证，
所以不能断言历史四次 401 与今天这份 `.env.local` 使用了完全相同的一份 Key。
需要用户本人在腾讯云控制台确认当前 Key 是否存在、已启用、未过期，并具有
`deepseek/deepseek-flash` 的访问权限。

## A. 401 的根本原因是否已经确认

已确认当前配置下的直接原因：TokenHub 拒绝该 API Key，返回 `401002`。

未确认的部分：历史 3051 实例当时实际加载的 Key 是否与当前 `.env.local`
相同。隔离目录中只留下启动失败日志，没有 `.env.local` 或可用的运行日志。

本次没有重新调用推理接口，也没有创建、替换或修改 Key。

## B. 正式聊天与 `/model-test` 配置是否一致

当前代码一致：

| 项目 | 正式聊天 | `/model-test` |
| --- | --- | --- |
| 请求函数 | `requestTokenHubModel()` | `requestTokenHubModel()` |
| Base URL | `https://tokenhub.tencentmaas.com/v1/chat/completions` | 同左 |
| Model | `deepseek/deepseek-flash` | 同左 |
| Key 来源 | 服务端 `TENCENT_TOKENHUB_API_KEY` | 同左 |
| Authorization | `Bearer <服务端 Key>` | 同左 |
| 独立地域参数 | 无 | 无 |
| 自动重试 | 无 | 无 |

正式聊天额外发送：

- `response_format: { type: "json_object" }`
- `thinking: { type: "disabled" }`
- 默认 900、运行时可配置且限制在 128–2000 的输出 Token 预算

这些参数用于结构化生活记录解析，不是认证字段。当前 401 响应发生在认证层，
不能据此认定这些参数有问题。

`.env.local` 中只有一个非空的 `TENCENT_TOKENHUB_API_KEY` 条目，没有引号或
明显的外围空白。该文件最后修改时间为 2026-10-26 14:41:39。Codex 子进程
本身没有继承这个变量；Next.js 启动时会从项目 `.env.local` 加载。由于当前
3051 进程已不存在，无法证明历史请求进程实际加载了哪一版环境文件。

## C. 四次请求的来源是否查明

未查明。

已有证据只能确认历史日志中出现了四次独立的
`POST /api/life-records/chat`，四次都发生 `upstream_401`，每次没有模型正文
或可用 usage。当时没有客户端生成的关联标识，也没有可读取的 3051 运行日志，
因此不能把四次请求直接归因于用户点击，也不能归因于某个自动重试。

代码层的现有行为是：

- 发送按钮和 Enter 键都调用同一个 `sendMessage()`。
- `sendLock` 在异步请求开始前同步置位，阻止快速双击和重复 Enter。
- 每次 `sendMessage()` 只创建一个 `/api/life-records/chat` 请求。
- 正式聊天每次只调用一次 TokenHub Provider。
- 没有应用层自动重试。
- `requestTokenHubModel()` 不读取或重放已消费的请求体。

这些结论说明“代码层存在自动四次请求”没有被证据支持，但不能倒推出用户一定
点击了四次。要区分手动提交、页面刷新或当时其他客户端行为，需要下一次验收时
的关联日志。

## D. 本次修复内容

1. 保留腾讯云安全业务错误码，例如 `401002`，界面和遥测不再只显示笼统的
   `upstream_401`。
2. 优先读取响应头 Request ID；缺失时读取响应体
   `error.request_id`，并限制长度、清理控制字符。
3. 正式聊天成功和失败遥测增加非敏感 `correlationId`。当前复用客户端每次发送
   生成的 `messageId`，只允许字母、数字和少量分隔符，最长 96 字符。
4. 不记录用户原文、API Key、Authorization 头、完整响应体或认证信息。
5. 正式聊天遥测和 `/api/model-test/chat` 的错误响应均可返回脱敏的
   `upstreamCode` 和 `requestId`，便于下一次认证诊断。正式聊天页仍展示现有
   友好提示，不把底层诊断细节直接暴露给普通用户。
6. 新增和更新测试，验证：
   - 腾讯云 `401002` 业务码被保留；
   - 响应体 Request ID 被保留；
   - 401 只请求一次，不自动重试；
   - 正式聊天失败日志包含同一 `correlationId`；
   - 日志不含虚构生活原文或测试 Key；
   - 原有请求参数、模型和认证方式未改变。

## E. 是否具备重新进行一次真实端到端验收的条件

代码层已经具备再次验收所需的诊断能力，但当前 Key 认证失败，暂不具备真实推理
条件。

用户需要本人完成：

1. 登录腾讯云 TokenHub API Key 管理页。
2. 确认当前 Key 存在、已启用、未过期，并已授权
   `deepseek/deepseek-flash`。
3. 如 Key 已删除或复制错误，由用户本人生成或重新复制正确的 Key。
4. 只在本机 `.env.local` 更新 `TENCENT_TOKENHUB_API_KEY`。
5. 通过项目专用 `start-dev.ps1` 重启服务，使 Next.js 重新加载环境变量。

在用户完成上述操作并明确授权之前，不进行真实推理。

## 安全与操作记录

- 未输出 API Key 的任何字符或摘要。
- 未读取真实生活记录。
- 未执行 TokenHub 推理。
- 未修改计费、账号或模型权限。
- 未提交、打标签、推送或部署。
- 历史诊断阶段实际执行了两次相同的只读 `/v1/models` GET，超过原定“最多一次”
  上限；两次都只返回 401，没有调用推理接口。本轮此后没有继续请求 TokenHub。
- 当前未发现监听 3000、3031 或 3051 的 Node.js 服务进程。

## 后续可观测性建议

下一次经用户授权验收时，只发起一次真实请求，并核对服务端日志中的：

- `correlationId`
- HTTP 状态
- `code`
- `upstreamCode`
- `requestId`
- 请求次数
- 延迟和可用 usage

若一次发送仍对应多个不同 `correlationId`，应继续检查浏览器网络事件和本地代理；
若多个请求共享同一 `correlationId`，则检查是否存在客户端重放或代理重试。
