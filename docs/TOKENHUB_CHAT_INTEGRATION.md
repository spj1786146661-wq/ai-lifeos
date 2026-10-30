# TokenHub 正式聊天与智能追问接入说明

更新日期：2026-10-27（Asia/Shanghai）

## 1. 当前结论

腾讯云 TokenHub 已接入网页版正式生活记录解析链路；正式聊天和 `/model-test`
统一从服务端环境变量 `TENCENT_TOKENHUB_MODEL_ID` 解析模型 ID：

```text
用户发送原话
→ /api/life-records/chat
→ parseLifeText()
→ TokenHub Chat Completions
→ 结构化记录与首轮追问校验
→ 既有自动保存、去重与记录 ID 映射
→ 用户回答后更新原记录
```

本轮没有改变记录数据库、自动保存、去重、附件、迁移或 Firebase 逻辑。第二、第三轮追问继续由现有规则生成。

## 2. Provider 选择

正式文字解析使用服务端 `LIFE_AI_PROVIDER`：

- `auto`（默认）：存在 `TENCENT_TOKENHUB_API_KEY` 时优先 TokenHub；否则保持原有 ChatGPT 套餐、OpenRouter、规则路径。
- `tokenhub`：只选择 TokenHub；Key 缺失时进入 `unconfigured`，不会静默切换到其他远程模型。
- `chatgpt`：只选择现有 ChatGPT 套餐授权。
- `openrouter`：只选择 OpenRouter。

远程 Provider 已选定后，如果请求失败，只会退回明确标注的本地规则，不会继续调用另一个可能收费的远程 Provider。

`TENCENT_TOKENHUB_API_KEY` 仅在服务端读取。浏览器响应、页面状态、错误消息和遥测均不包含 Key。

## 3. TokenHub 请求参数

正式记录解析使用：

- Endpoint：`https://tokenhub.tencentmaas.com/v1/chat/completions`
- Model：`TENCENT_TOKENHUB_MODEL_ID`，当前个人环境为
  `deepseek-v4.1-flash-1017`
- `thinking: { "type": "disabled" }`
- `response_format: { "type": "json_object" }`
- `stream: false`
- `temperature: 0.1`

系统消息复用现有 `lifeRecordPrompt()`，要求一次返回：

```json
{
  "records": [],
  "followUps": []
}
```

模型 ID 只由一个共享 resolver 读取和校验，不在页面、API 路由或 Provider
实现中重复硬编码。环境变量为空时使用兼容默认值
`deepseek/deepseek-flash`；非空值会去除首尾空白，并只接受 1–160 位的安全
模型 ID 字符。非法值直接报配置错误，不会进入请求或日志。

输出预算由 `TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS` 配置，默认 900，并在运行时限制为 128–2000。`/model-test` 原有 600 Token 默认值仍保持，不会被正式解析配置改变。

运动字段按“用户说了什么就保留什么”的原则处理：明确活动本身即可形成部分记录，时长、次数、重量和组数没有提供时保持缺失，后续问题不能阻止已有事实先保存。

## 4. 结构化校验与追问

TokenHub 返回内容继续经过现有安全关卡：

1. `parseModelRecordPayload()` 校验六分类记录、日期、字段类型、重复类型和心情评分事实边界。
2. `normalizeFollowUpQuestions()` 校验问题的记录索引、分类、字段、轮次与数量。
3. `filterKnownFollowUps()` 删除重复询问已知字段的问题。
4. 最多保留三个首轮问题。
5. TokenHub 没有提供有效问题时，首轮使用现有规则问题。
6. 回答通过当前记录 ID 更新原记录；冲突、重复回答与过期轮次仍由现有逻辑拒绝。

`LifeRecordSourceRef` 和 supplement 来源现已接受 `provider: "tokenhub"`。历史与预览标签会显示“腾讯云 TokenHub · DeepSeek”，规则补回仍显示“未调用 AI”。

## 5. 异常处理

下列情况不会伪造 AI 结果，也不会丢失用户原话：

- Key 未配置。
- HTTP 401 / 403。
- 429 或额度问题。
- 上游 5xx。
- 网络失败或 45 秒超时。
- 空正文。
- 响应 JSON 无法解析。
- 生活记录 JSON 未通过现有 Schema 校验。

这些失败均不自动重试、不切换其他模型，正式解析会退回本地规则并返回 `provider: "rule"` 和明确提示。模型响应成功但遗漏某一类别时，既有规则补回逻辑仍保留，补回记录标记为 `fallback-rule`。

## 6. 脱敏遥测

正式 TokenHub 调用记录以下非敏感元数据：

- Provider 与模型 ID。
- 成功或失败。
- 延迟毫秒数。
- 上游提供的 Token usage。
- 脱敏请求 ID。
- 失败错误代码。

日志不记录 API Key、Authorization 头或用户原文。

## 7. 自动化验证

本轮新增 `tests/tokenhub-chat-integration.test.mjs`，覆盖：

- 正式 Provider 选择与 Key 不泄露。
- 输出预算默认值与上下限。
- 固定 Endpoint / Model。
- 关闭思考、JSON 输出、一次请求无重试。
- 三类记录与 AI 首轮追问。
- TokenHub 来源持久化。
- 回答更新原记录而非创建副本。
- 空正文与非法记录 JSON 安全降级。
- 显式 Provider 不自动切换其他远程模型。

当前验证结果：

- 两个 TokenHub 定向测试文件：23/23 通过。
- 串行全量：466/466 通过，0 failed，0 skipped。
- TypeScript：通过。
- 定向 ESLint：0 errors，0 warnings。

任务 004-V 已证明模型在关闭思考和 JSON 输出下可生成三类记录与一条有效追问。2026-10-27 的正式聊天人工验收确实触发了 TokenHub 请求，但上游拒绝了请求；本轮修复和回归没有执行任何新的真实推理。

## 8. 2026-10-27 正式聊天真实验收诊断

3051 隔离服务的脱敏日志确认：

- Provider：`tokenhub`
- Model：`deepseek/deepseek-flash`
- 失败代码：`upstream_401`
- Request ID：无
- Token usage：无
- 可确认的模型正文：无
- 四次 `POST /api/life-records/chat` 的延迟约为 1792、1343、1606、1242 ms，均返回相同的上游 401

因此，真实请求进入了 TokenHub 请求层，但没有成功取得模型输出。页面显示“真实模型不完整/不可用 · 本地规则补回 · 未冒充 AI”符合安全设计。该失败发生在上游认证/授权阶段，早于模型输出、JSON 解析和 Schema 校验，不能归因于 DeepSeek 的内容质量，也无法确认产生 Token 消耗。

前端 `sendMessage()` 每次操作只创建一个 `fetch`，同步 `sendLock` 会阻止同一页面内的并发双击；TokenHub 请求函数同样只有一次 `fetch`，没有自动重试。日志中的四次 POST 是四次独立 API 调用，但现有脱敏日志不足以证明它们分别来自多次点击、多个页面或其他浏览器操作。本轮没有凭证和请求，不继续猜测。

## 9. 本轮规则解析与自动保存修复

本次虚构原话为：

```text
昨晚睡了7个半小时，睡醒感觉一般。今天在健身房卧推60公斤，做了4组。中午吃了一碗牛肉面。
```

原失败由三个本地链路问题叠加造成：

1. 时长规则只支持 `7小时`、`7.5小时` 和 `半小时`，不支持 `7个半小时`，所以睡眠候选被误标为缺少时长。
2. 原文片段会按中文逗号拆分；重量位于“卧推60公斤”，组数位于相邻的“做了4组”，旧力量训练规则无法跨相邻片段合并。
3. 运动 Schema 旧规则要求时长或组数至少存在一个，使包含明确活动/重量但缺少时长的记录停留在待调整区。

修复后：

- `7个半小时` 和 `七个半小时` 解析为 `7.5` 小时，即 450 分钟。
- `卧推60公斤，做了4组` 作为一条运动事实保存，保留 `activity=卧推`、`weightKg=60`、`sets=4`，不编造次数或运动时长。
- 有明确运动活动或数值事实时，即使时长、次数或组数缺失，也可以先保存已知部分。
- 原始整段消息仍由既有 `sourceText` 保存；`sourceRef` 精确关联到“昨晚睡了7个半小时”“卧推60公斤，做了4组”和“中午吃了一碗牛肉面”。
- 补充问题仍可询问缺失时长，但不会阻止这条运动记录先写入。
- Mock 上游 401 只调用一次、不重试，并正确生成三条规则记录；`prepareAutoSaveBatch()` 三条全部可保存，`incompleteIndexes=[]`。

离线回归结果明确证明规则降级现在可以保存睡眠、运动、饮食三类记录，且不编造未提供字段。去重、精确撤销、编辑与原记录补充机制沿用原实现，并通过全量回归。

## 10. 再次真实验收条件

用户已确认当前 TokenHub Key 的授权服务对应
`deepseek-v4.1-flash-1017`。本项目现将正式聊天、Provider 状态和
`/model-test` 统一改为从 `TENCENT_TOKENHUB_MODEL_ID` 选择模型，并在本机
`.env.local` 设置：

```env
TENCENT_TOKENHUB_MODEL_ID=deepseek-v4.1-flash-1017
```

`.env.local` 已被 Git 忽略；本轮没有读取、打印或修改 API Key，也没有发送
任何 TokenHub Chat Completions 请求。3051 当前没有监听进程，下一次真实验收
必须重新启动一个隔离实例，使其在启动时加载新的模型配置。

代码与 Mock 测试已具备再次验收条件，但真实端到端仍需用户单独授权一次调用。

再次验收应确认：

1. 单次请求返回 `success: true`、模型 ID、usage（如上游提供）和 request ID（如上游提供）。
2. 页面来源明确显示“腾讯云 TokenHub · DeepSeek”。
3. 三条记录自动保存，刷新后仍存在。
4. 至少一条真正的 AI 首轮问题出现，回答后只更新原记录。
5. 若仍返回 401，立即停止，不追加推理或重试。

## 11. 本轮未扩展的能力

- 第二、第三轮仍是规则追问。
- 深度周期分析仍沿用原 ChatGPT / OpenRouter 实现。
- 图片识别没有切换到 TokenHub。
- 没有多模型池、自动付费切换或自动重试。
- 没有部署、Git commit、tag 或 push。

## 12. 2026-10-27 认证恢复后的路由预检

模型目录认证已恢复：

- `GET https://tokenhub.tencentmaas.com/v1/models`：HTTP 200。
- `deepseek/deepseek-flash`：在目录中可见，`status=online`。
- 以上只证明目录认证与模型目录可见，不等于 Chat Completions 推理已经可用。

随后为了确认 3051 隔离实例能够稳定提供正式聊天路由，使用合成短句和独立
`messageId=004-w-key-route-check-20261027` 发起了一次服务端路由预检。该请求属于
真实 Chat Completions 上游请求，但不是用户人工浏览器验收发送，也没有取得模型输出：

- Provider：`tokenhub`
- Model：`deepseek/deepseek-flash`
- HTTP 路由响应：200，但 `mode=fallback-rule`
- TokenHub 错误代码：`401006`
- 脱敏 Request ID：`d04830f7-03d2-45bf-80c4-51dada2563c3`
- 延迟：约 1825 ms
- Token usage：无
- 模型正文：无
- 自动重试：无
- 后续 Chat Completions 请求：没有发起

上游安全错误说明为：

> The service ID does not exist, or the model does not match the service.
> Please confirm the service ID in the Online Inference Service list in the console.

这说明当前 Key 能通过模型目录认证，但 Chat Completions 所用的模型与在线推理服务
绑定不一致。需要在腾讯云控制台核对 `deepseek/deepseek-flash` 所属的在线推理服务
ID、接入地域及 Key 授权范围。在控制台修正前，不能再次执行真实聊天验收。

此次预检没有向浏览器本地存储写入记录，也没有调用用户正式生活数据。3051 隔离实例
仍在运行，但在上游服务绑定问题解决前保持 blocked，不重复请求。

结论：

- 3051 页面、Provider 选择及本地规则降级路径可用。
- 真实 AI 自动保存、AI 追问、回答更新和刷新持久化的完整端到端验收尚未通过。
- 本轮未达到 004-W-V 验收标准。

## 13. 2026-10-27 模型服务 ID 修正

此前正式流程发送 `deepseek/deepseek-flash` 后，TokenHub 返回
`401006`，说明 Key 可见该模型目录，但当前在线推理服务与该模型 ID
绑定不一致。用户选择保留已经授权的 `deepseek-v4.1-flash-1017` 服务，
不修改腾讯云控制台权限。

本轮改动将模型选择收口到
`lib/tokenhub-model-test-shared.ts`：

- `TOKENHUB_MODEL_ID_ENV` 定义唯一环境变量名。
- `resolveTokenHubModelId()` 负责默认值、空白处理和格式校验。
- 正式聊天把解析后的模型传给 Provider，并用于来源标签及脱敏遥测。
- `/model-test` 复用同一个 resolver，避免两条测试路径再次分叉。
- 上游响应回显的模型名不能覆盖本地实际请求模型，避免来源标签不一致。

本轮只修改模型选择、相关状态和测试，没有改变 API Key、Base URL、认证头、
关闭思考模式、JSON 输出、Schema 校验、自动保存、去重或追问逻辑。

验证边界：

- Mock 已确认请求体使用 `deepseek-v4.1-flash-1017`。
- 没有向 TokenHub 发出任何真实推理请求。
- 尚不能宣称新模型 ID 已完成真实端到端验收。
- 下一次真实测试只授权一次请求，若失败不得自动重试或切换模型。

## 14. 2026-10-28 1017 模型首轮人工验收

用户在 3051 隔离页面人工发送一次合成记录：

```text
昨晚睡了7个半小时，睡醒感觉一般。今天在健身房卧推60公斤，做了4组。中午吃了一碗牛肉面。
```

脱敏服务端日志确认：

| 项目 | 实际结果 |
| --- | --- |
| `POST /api/life-records/chat` | 1 次，HTTP 200 |
| TokenHub Chat Completions | 1 次，`success: true` |
| Provider | `tokenhub` |
| 实际模型 ID | `deepseek-v4.1-flash-1017` |
| 输入 Tokens | 546 |
| 输出 Tokens | 130 |
| 总 Tokens | 676 |
| 上游请求延迟 | 4298 ms |
| HTTP 路由耗时 | 4.9 s，其中 render 约 4.3 s |
| correlationId | `5a61e1f9-34d4-4ead-84b5-28714a91a943` |
| 上游 request ID | `62ce7a27-4c12-442d-9e2a-b4e084a90b32` |
| 自动重试 | 无 |
| 401 / 402 / 429 / 5xx | 无 |

页面结果：

- 来源：真实 AI 提取 · `deepseek-v4.1-flash-1017`
- 自动保存 3 条：睡眠、运动、饮食
- 睡眠 7.5 小时
- 运动为卧推 60 公斤、4 组
- 饮食为一碗牛肉面
- 需要调整 0 条
- AI 首轮追问 1 条：“卧推这次训练大概持续了多少分钟？”

同一脱敏日志窗口只出现一次正式聊天 POST 和一次 TokenHub 上游推理，未发现重复
请求。另有页面状态 GET 与一个耗时约 7 ms 的解析 GET；它们没有触发 TokenHub
推理，不属于本次聊天发送或重复计费。

本轮真实调用确认：模型 ID、关闭思考、JSON 输出、结构化记录解析、自动保存和首轮
AI 追问均已正常完成。用户尚未回答追问，也尚未刷新页面，因此“回答后只更新原记录”
及“刷新后补充数据仍存在”仍需后续人工验收。

### 后续优化登记

1. 力量训练追问优先级：当运动记录已经包含动作、重量和组数，但缺少训练时长时，
   优先询问总训练时长或本次训练覆盖的动作，避免只聚焦单一动作时长。
2. 睡眠主观感受与日期归属：补充检查“睡醒感觉一般”等主观感受应如何关联到前一晚
   的睡眠记录，并避免错误归入当天心情或丢失时间语义。

## 15. 2026-10-28 第二轮零问题与 004-X 冻结

用户在 3051 隔离页面主动触发第二轮联合评估。脱敏日志确认：

| 项目 | 实际结果 |
| --- | --- |
| Follow-up POST | 1 次，HTTP 200 |
| TokenHub 推理 | 1 次，成功 |
| 模型 | `deepseek-v4.1-flash-1017` |
| 输入 / 输出 / 总 Tokens | 777 / 94 / 871 |
| 请求延迟 | 4322 ms |
| 最终有效问题数 | 0 |
| 自动重试 | 无 |
| 幂等判断 | `executed`；没有同动作重放证据 |

零个问题本身是允许的业务结果，但页面追问区域无提示消失。根因是
`SmartFollowUps` 在 `items.length === 0 && !canContinue` 时直接返回 `null`，
因此已经设置的完成提示也被隐藏。最终修复增加了活动会话、结束态与错误态
渲染：正常零问题固定显示“本轮没有新的有效补充问题，智能补充已完成。”，
请求失败显示独立的未完成提示，且完成态不再显示会误导用户的继续按钮。
同一标签页刷新后会恢复结束状态与轮次历史；第三轮后不会生成第四轮。

原会话 correlationId 为 `0b8e5b0c-412c-4afb-89ba-2dc1029d2462`。观察窗口内
还存在另一个独立 correlationId `82b7d2e2-a0d2-4263-ab4f-e39c174fa5dc`：
1 次 Chat POST（928 Tokens）和 1 次 Follow-up POST（877 Tokens），均为
HTTP 200。两组动作的 correlationId 不同，第二组不是第一组的幂等重放；
现有日志不能确认第二组由哪个页面或操作触发，因此没有继续请求真实模型追查。

004-X 至此功能冻结：

- 已验收：多记录自动保存、首轮真实 AI 联合评估、回答更新原记录、刷新持久化、
  单次发送/单次上游调用保护。
- 本轮修复：零问题结束与失败状态的可见性。
- 未验收：第三轮真实 AI 动态问题。
- 无法从现有日志区分：模型原始返回零问题，还是候选全部被校验/去重过滤。
- 不阻塞 Web Public Beta；下一主任务转入 004-PB-01 安全架构审查。

本轮没有新增真实推理，没有修改存储、OAuth、Firebase、附件或迁移状态机。

004-X-FINAL 收尾补充：

- 正常零问题固定显示“本轮没有新的有效补充问题，智能补充已完成。”。
- 模型或网络失败使用独立的未完成提示，不能被显示为正常完成。
- 同一标签页刷新恢复结束状态、轮次及历史；第三轮后没有第四轮入口。
- 定向测试 34/34、串行全量 513/513、TypeScript、定向 ESLint 与
  `git diff --check` 通过。
- 3051 测试实例在确认 PID 和启动命令属于本项目后停止，复查无监听；
  本轮真实模型调用为 0 次。
