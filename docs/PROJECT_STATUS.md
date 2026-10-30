# AI-LifeOS 项目状态

## 2026-10-28 Web Public Beta 上线冲刺与 004-X 冻结

- 004-X 进入功能冻结。真实 DeepSeek 已验证多记录自动保存、首轮 AI 联合评估、回答更新原记录、刷新持久化和单次请求控制；不再要求第三轮真实推理。
- 第二轮真实调用成功但有效问题数为 0。原会话 1 次 Follow-up POST、1 次 TokenHub 推理、HTTP 200、777/94/871 Tokens、4322 ms，幂等动作按单次上游执行判断为 `executed`。
- 零问题后追问组件曾直接不渲染，导致完成提示消失。现已增加活动会话与结束态渲染，正常零问题显示“本轮没有新的有效补充问题，智能补充已完成。”，请求失败显示独立未完成提示；刷新后结束状态与历史可恢复，第三轮后不会生成第四轮。定向测试 34/34、串行全量 513/513 通过。
- 未验证事项：日志不能区分模型原始返回空数组，还是返回候选后被 Schema / 历史去重全部过滤；观察窗口还出现第二个独立 correlationId 的真实调用，现有证据不能确认其来源。未新增模型请求追查。
- 当前单进程内存幂等不满足多实例 Public Beta。用户 API Key 三步连接、公网路由、正式隐私文本、生产 HTTPS 构建和 AGPL 对应源码入口仍未完成。
- P0/P1 上线清单见 `docs/WEB_PUBLIC_BETA_BLOCKERS.md`。Ollama、LM Studio、多模型池、手表导入和食物照片识别移入上线后。
- 3051 隔离测试实例已确认归属并停止，当前无该端口监听；本轮未调用真实模型。

## 2026-10-26 TokenHub 正式聊天与智能追问接入

- `deepseek/deepseek-flash` 已接入 `parseLifeText()` 正式文字解析链路，并复用现有自动保存、去重、记录 ID 映射、冲突保护和首轮智能追问结构。
- 正式请求固定 TokenHub Endpoint / Model，显式关闭思考并要求 JSON；一次请求返回结构化记录和最多三个首轮追问。第二、第三轮仍由规则生成。
- `LIFE_AI_PROVIDER` 支持 `auto|tokenhub|chatgpt|openrouter`；失败只进入明确标注的本地规则，不自动切换其他远程收费 Provider，也不自动重试。
- TokenHub 来源已进入记录 sourceRef、追问 supplement 和页面来源标签。回答追问仍更新保存后的原记录，不新增重复记录。
- 错误处理覆盖 Key 缺失、401/403、429、5xx、超时、网络失败、空正文、非法 JSON 和 Schema 校验失败；原文保留，API Key 与用户原文不写入遥测。
- 自动化：专项 36/36、串行全量 **461/461**，TypeScript 与定向 ESLint 通过。
- 本轮只使用 Mock 与合成数据，没有新增真实模型调用。004-V 已验证独立 TokenHub 能力，正式聊天真实端到端仍需一次受控人工验收。
- 实现说明：`docs/TOKENHUB_CHAT_INTEGRATION.md`。没有 commit、tag、push 或部署。

## 2026-10-26 TokenHub 真实 AI 智能追问验收

- 用户解除费用确认阻塞后，使用现有服务端 Key 对固定模型 `deepseek/deepseek-flash` 执行两次真实推理；没有自动重试或切换模型。
- 第一次默认请求 6977 ms 后为空回复，usage 未被现有封装保留。第二次关闭思考模式并要求 JSON 输出后成功，3302 ms，输入 527、输出 131、总计 658 Tokens。
- 成功样本正确输出睡眠、运动、饮食三条结构化记录和一个运动时长追问；没有重复询问已知信息，也没有编造数值。现有解析与追问纯函数离线兼容验证通过。
- TokenHub 目前仍只接入 `/model-test`，尚未进入正式 `life-parse-server`、自动保存和追问回答链路；不得表述为正式聊天端到端验收通过。
- 全部输入为合成数据；没有写入真实记录，没有修改业务代码、部署、commit、tag 或 push。

## 2026-10-26 最新未提交批次：网页版 AI 智能延伸对话 v1

- 首轮解析与最多三个追问复用一次模型请求；规则模式和后续轮次本地生成，不额外消耗模型调用。
- 问题会校验记录索引、类型、可补字段、已知字段、重复与数量；只映射到实际保存成功的记录 ID。
- 用户回答后，通过 `withRecordWriteLock()` 重新读取权威存储并只更新原记录。每轮最多三个问题，同一记录最多三轮；冲突、重复回答和旧轮次会被拒绝。
- 原话、来源引用、附件保留；`LifeRecordSupplement` 持久化问题、回答、字段、来源、模型（可确认时）、轮次和时间。旧 supplement 无轮次仍兼容。
- 自动化：串行全量 **454/454 通过**，专项 11/11；TypeScript 和定向 ESLint 通过。
- 隔离浏览器：3006、合成数据、规则模式。自动保存、追问、评分补充、总数不增加、刷新持久化、跳过和 390×844 无横向溢出通过；控制台无 error。
- 真实 AI 追问未在轮执行。正式用户数据、存储路由、迁移状态、Firebase、OAuth、Health、Telegram 和 Proxy 未改动；未 commit、tag 或 push。

## 2026-10-23 最新未提交批次：心情可选评分与总记录批量删除

- 心情数据：`LifeRecord.score` 保持向后兼容的可选字段；未评分以字段缺失表示。规则解析和真实模型候选都只接受用户原话中明确说出的分数，模型推测不会写入事实字段。
- 统计与历史：未评分心情计入记录数量、日历、搜索和历史；平均分只统计有效评分。编辑可新增、修改或移除评分。
- 批量删除：总日历独立页面提供选中删除、当天全部删除和手动确认的清空全部流程。删除 ID 在确认时冻结，执行时通过 `withRecordWriteLock()` 重新读取当前权威存储并逐条删除。
- 附件安全：每次记录删除后重新计算剩余引用；共享图片保留，无引用图片才清理。记录删除与附件清理失败分别报告，不把部分成功写成全部成功。
- 自动化：`npm run test:life` 363/363；本阶段定向测试 84/84；TypeScript 与定向 ESLint 通过。隔离浏览器已验证无评分保存/编辑/刷新、确认范围、取消流程及 390×844 布局；最终危险删除点击留给用户在合成数据环境人工确认。
- Git 与数据边界：本批次未 commit、tag 或 push；正式生活记录、正式 localStorage、正式 IndexedDB、Firebase 云端数据和迁移状态机均未接触。Firebase 登录路由不变；Firestore 更新适配器只补充了移除评分时显式删除旧字段。

## 2026-10-23 最新未提交批次：真实 ChatGPT 接入验收缺陷修复

- 代码与测试状态：无评分心情保留、评分不推断、来源去重、部分保存幂等、图片目标重映射、滚动与图片展示修复已实现；`npm run test:life` 347/347 通过，TypeScript、定向 ESLint 和 `git diff --check` 通过。
- 浏览器状态：3012 隔离预览使用合成数据和明确标注的演示规则模式；桌面与 390×844 手机布局、滚动、保存、刷新、去重和强制新事件已通过。控制台无 error/warning。
- 真实模型状态：用户此前真实 ChatGPT 调用已发现并暴露缺陷；本轮没有重新调用真实模型，不得将演示结果写成真实 AI 验收。
- 图片上传状态：附件服务与备份恢复有自动化测试；受控 Edge/Chrome 均因扩展文件 URL 权限无法注入合成图片，最终文件选择 UI 尚未完成浏览器验收。
- Git 状态：本批次未 commit、tag 或 push；真实用户存储和 Firebase 未修改。

更新日期：2026-10-23（Asia/Shanghai）

## 项目事实

- 实际项目根目录：AI-LifeOS 项目的 `life-tracker` 目录。
- 外层 `AI-LifeOS` 目录不是 Git 仓库；应用、文档和任务记录都在 `life-tracker/`。
- 技术栈：Next.js 16.1.6、React 19.2.3、TypeScript 5.9.3、Tailwind CSS 4、Firebase、Firebase Admin、OpenRouter/OpenAI 兼容 client、Recharts。
- 当前分支与 HEAD 以 Git 为准。分支 `feature/ren-sheng-shu-ju-cang-v1`。历史检查点：`checkpoint/local-database-upgrade-v1` → 97edda3c37490c95793456bc317f0bd0f686c5c8；`checkpoint/life-calendar-ios-v1`；`checkpoint/life-smart-input-v1`（本阶段，SHA 以 `git rev-parse` 为准）。未 push。
- 现有许可证和来源事实见 `OPEN_SOURCE_AUDIT.md`；主项目仍是 AGPL 派生项目，LifeOS MIT 通知不能改变整体许可。

## 已实现功能

- 中文手机优先首页：记录 / 数据 / 我的三栏，单一发送入口。
- 运动、睡眠、学习、饮食、消费、心情六类结构化记录。
- 保存前逐事件确认、修改、移除和取消；已保存记录支持编辑和删除。
- 本地 localStorage 安全层：不截断 500 条、损坏 JSON 不覆盖、容量错误明确、JSON Backup v1 导出和恢复。
- 本地关键词搜索：原话、备注、类别、结构化字段和日期匹配；分类圆环与搜索可叠加筛选。
- 聊天原话纠错：用户消息可展开 `SourceFragmentEditor`，桌面端支持真实选区、手机端支持逐句按钮；选中片段后直接指定六大分类并补字段，加入下方待确认列表。`LifeRecordSourceRef` 记录 messageId、起止偏移、原文、`origin`（ai/user）、`candidateType`、`confirmedType`、`userEdited`。
- 图片上传与附件库：`ImageComposer` 提供入口、缩略图、移除；附件存独立 IndexedDB 库 `life-tracker-attachments`，只存 Blob，LifeRecord 只保存 `{id,name,mimeType,size,sha256}` 引用，不写 Base64；历史记录通过 `AttachmentView` 预览。
- 逐句多意图解析：`lib/life-intent-parse.ts` 先按标点切句再逐句解析，一句话可同时产出多个分类；支持中文数字与「对象+时长」「时长+对象」两种语序，金额子句从食物描述中分离；同消息已有完整训练数据时不重复生成运动候选。
- 待补充候选：只提到分类但没有数字时（睡眠/学习/消费/运动）产出 `needsFields` 候选并提示补字段，不丢弃整句话也不编造数值。
- 批量确认：候选一次性进入预览区，底部「确认并保存全部 N 条」；缺字段条目单独标记，不阻塞其他条目。
- 图片附件归属：`saveRecordsWithAttachments()` 新增 `attachmentTargetIndex`；未选择归属时跳过图片、只保存文字记录。
- 刷新安全防重复：`lib/life-record-duplicates.ts` 用 `date + confirmedType + 起止偏移 + 规范化文本` 指纹判定，不依赖 messageId。
- 带附件备份：`exportBackupWithAttachments()` 保持 JSON Backup v1 信封并附加 `attachmentBackup`；`restoreBackupWithAttachments()` 先校验记录备份，通过才写附件。
- 仪表盘以已保存记录计算圆环和数字；圆环可筛选分类历史。
- 数据首页保留六大分类统计圆环，通过「总日历 · 总记录」入口进入独立总日历；分类圆环直接进入对应分类日历。
- 总日历、六大分类日历、当天记录筛选、浏览器历史导航、iOS 风格过渡、移动端滑动和 390px 窄屏适配已完成并通过用户集中验收。
- 规则演示解析和滚动 7/30/365 天分析。
- 服务端真实 AI 文本/分析/图片接口路径存在；未配置 Key 时必须显示演示模式。
- 迁移能力：IndexedDB Adapter v1、迁移前校验 v1、独立迁移复制与校验 v1、持久化迁移状态机、迁移编排、路由切换、写入闸门、中断恢复和「我的」页升级入口（默认关闭）。
- 原 LifeTracker 的习惯、任务、目标、专注、健康、日记、时间管理等页面和 API 保留。

## 存储架构

| 路径 | 当前状态 | 真实数据边界 |
| --- | --- | --- |
| 未登录本地 | 正式页面仍用 `localStorage["life-tracker:life-records:demo:v1"]` | 用户正式本地记录当前所在位置；禁止擅自清理或迁移 |
| Firebase 登录 | 正式页面仍用 Firestore `life_entries` | 登录路由优先，迁移逻辑不影响 |
| IndexedDB Adapter v1 | 代码和测试已完成，仅显式工厂调用 | 正式页面未接入；迁移未开始 |
| 迁移状态机 v1 | 状态存 IndexedDB `meta` store，`READY_TO_SWITCH` 不等于已启用 | 只有显式启用且 `activeStore=indexedDB` 才切换路由 |
| 写入闸门 | 新版页面本地写入共用 Web Lock 与状态闸门 | 无法阻止旧版标签页，依靠启用前来源指纹拒绝切换 |
| JSON Backup v1 | 导出/恢复已实现 | 可恢复；迁移前必须导出备份 |
| 图片附件库 v1 | IndexedDB `life-tracker-attachments`，独立于记录权威路由 | 只存 Blob；记录只存引用；未做真实配额实测 |

隔离浏览器测试使用独立库 `ai-lifeos-migration-browser-test-v1` 和内存模拟 localStorage；不使用正式库，也不读取正式 localStorage。

## 验证状态

- 2026-10-22 智能输入阶段：`npm run test:life` **234/234 通过**；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0（仅 LF/CRLF 提示）。
- 本阶段隔离 HTTP 验收：`GET /api/life-records/parse` 返回 demo 模式；完整句子解析出运动/睡眠/消费/心情 4 条；空数据分析不编造；真 PNG 无 Key → 503 `mode:"unavailable"`；伪装图片 → 400；gif → 400。
- **隔离真实浏览器实测（Chrome headless，390×844）**：页面正常渲染，`scrollWidth=390`、`clientWidth=390`、无横向溢出；手机底栏为 `flex`、桌面导航为 `hidden`；图片入口、输入框、发送按钮均存在；控制台 0 error。
- 发送测试句后，待确认卡片正确渲染 4 条：运动（卧推 60 公斤 4 组）、睡眠（7 小时）、消费（¥38.00）、心情（保留「心情不错」原词，评分待用户确认）；每张卡片显示对应原文片段与「AI 推测，待你确认」，并明确标注「规则演示 · 未调用 AI」。
- **确认保存无法在本沙箱完成**：该 headless 环境无法创建 IndexedDB backing store（`Internal error opening backing store for indexedDB.open.`）。应用按设计安全失败，显示「无法读取本地数据库迁移状态，已停止访问本地记录以保护数据」，未写 localStorage、未假报成功、无数据丢失；这是环境限制，不是应用逻辑缺陷。
- 因此以下仍未完成真实浏览器验收，需在可正常使用 IndexedDB 的 Edge 中人工验证：保存写入、刷新持久化、历史编辑/删除、图片附件保存与备份恢复。

- 2026-10-22 多意图识别与批量确认优化：`npm run test:life` **259/259 通过**；`tests/life-intent-parse.test.mjs` 18/18；`tests/life-attachment-service.test.mjs` 11/11；`tests/life-record-duplicates.test.mjs` 13/13；`npx tsc --noEmit`、定向 ESLint、`git diff --check` 均通过。
- 2026-10-23 收尾修正：`npm run test:life` **261/261 通过**（0 failed / 0 skipped）；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0（仅 LF/CRLF 提示）。新增断言覆盖「心情不错」不写确定评分、「心情3分」解析为 3 分。
- 本轮隔离真实浏览器实测（3006 隔离副本 + 合成数据）：桌面视口一句话识别 6 条（睡眠/运动/饮食/消费/学习/心情），单条修改组数后一键保存，刷新后 6 条保留；重复提交同一句被拒并提示已保存过；手机 390×844 视口 5 条识别、保存、刷新保留、编辑备注、删除均正常；控制台无 error / warning。
- 本轮修复：`学习英语45分钟` 不识别时长、`跑了5公里` 不识别、`看了一会儿书` 落到未识别区、390×844 下固定输入框遮挡「确认并保存全部」按钮导致保存静默失败。
- 真实 AI 文本解析仍未测试（未设置 `OPENROUTER_API_KEY`）；真实视觉模型仍未接入、未测试。

- 2026-10-22 日历阶段：`npm run test:life` 202/202 通过，日历专项 26/26；`npx tsc --noEmit`、定向 ESLint、`git diff --check` 通过；Edge/Chrome 隔离浏览器桌面与 390×844 视口验收通过，控制台无 error/warning。
- 2026-10-22 `AIOS-STORAGE-002` 运行批次：`npm run test:life` 176/176 通过；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0。
- 2026-10-22 Edge 隔离浏览器测试：完整迁移测试 26/26 通过，含写入失败、回读失败、JSON 备份导出与恢复；两个真实标签页不能同时取得迁移锁通过；刷新后状态 `SUCCEEDED`、target=2；修复后控制台无 error/warning。
- 正式页只读检查：权威源 localStorage、本地记录 5 条、迁移状态尚未升级、开发开关未开启时操作按钮 disabled；未迁移真实数据。
- 历史批次独立记录，不与本轮合并：`AIOS-OPS-001` 47/47；IndexedDB Adapter 交付批次自动化 50/50、Edge 13/13。
- 真实 AI：未验证，缺少并禁止擅自配置 API Key。
- 真实 Firebase：未验证，缺少隔离项目和测试账号。
- 真实正式数据迁移：未开始，必须等待用户单独明确授权。
- 全项目 lint 仍有既有问题；定向 ESLint 不能写成全项目通过。
- 当前生产构建待验证；开发服务器占用 `.next` 时曾出现 Windows `EPERM`。
- npm 漏洞审计此前因 `ECONNRESET` 未取得完整结果。

## 规则加载兼容

- Codex：官方文档确认会从项目根向当前目录逐层读取 `AGENTS.md`。
- OpenCode：官方规则文档确认项目根 `AGENTS.md` 会被读取，且优先于同目录 `CLAUDE.md`。
- 本机 OpenCode Desktop 已安装，随附 CLI 位于用户目录但不在 PATH；实际 CLI 版本与 `AGENTS.md` 加载仍未验证。
- Magpie 便携程序位于当前用户的 Downloads 目录，版本 `0.1.1307`；未发现运行进程或默认网关 `127.0.0.1:3430` 监听。
- 不创建 `CLAUDE.md` 或 Copilot 总规则副本，避免多份规则漂移。

## 已知风险

- 真实视觉模型未接入：本机没有 `OPENROUTER_API_KEY` 和 `OPENROUTER_VISION_MODEL`，真实识图未测试，不得宣称为已通过。
- 附件库无独立并发锁：两个标签页同时上传同一图片的行为未测试。

- 旧版标签页可绕过协作 Web Lock；当前只有启用前来源指纹这一道拦截，不是完整方案。
- 新增可观察风险（本轮实测发现，未在本轮修复）：`runLocalWrite()` 在每次本地写入前都要先从 IndexedDB 读取迁移状态；若浏览器或环境完全无法使用 IndexedDB，即使从未迁移的 localStorage 用户也会被拒绝保存。当前实现选择「明确报错、不猜测」以保证不写错库，但对禁用 IndexedDB / 隐私模式受限的浏览器会阻断记录。是否增加「IndexedDB 无能力时按 localStorage 权威源放行」的降级策略，需要单独评估后再改。
- 篡改或损坏的持久化状态现在会被标记为 `FAILED`，但异常状态仍需人工核查后再决定是否重置。
- 真实云服务鉴权、Firestore 规则、AI 成本和隐私边界未完成发布前验收。
- 未跟踪字面文件 `$null` 存在于工作区；来源不能确认，保留、未读取正文、未暂存、未提交、未删除。
- AGPL、上游 Terms 和商业发行方式仍需在公开服务或商业化前处理。

## 当前授权边界

智能输入、原文纠错与图片上传识别 v1 已完成开发和自动化测试，**尚未 commit / tag / push**，等待用户集中验收。真实数据迁移、正式启用 IndexedDB、清理旧数据、推送和部署仍未执行，必须等待用户单独明确授权。

真实视觉模型接入需要用户在服务端配置 `OPENROUTER_API_KEY` 与 `OPENROUTER_VISION_MODEL` 并单独授权调用；无 Key 时必须继续明确显示未配置状态，不得伪造识别结果。

## 阶段收尾补充

- `AGENTS.md` 已新增「跨平台长期开发原则」：继续 Next.js、核心逻辑与 UI 分离、存储只走 StorageAdapter、未来可分别接入 IndexedDB/SQLite/小程序兼容存储、AI 调用仅走服务端、不同平台本地数据不天然共享、避免平台耦合、按完整阶段连续实施后集中验收。
- 开发测试页 `app/dev/migration-test/page.tsx` 保留用于后续迁移维护；生产环境 `notFound()` 阻止访问，使用独立测试库 `ai-lifeos-migration-browser-test-v1` 和内存模拟 localStorage，不接触正式库和正式 localStorage。
- AI 源码访问范围保护补丁仍未实施，记录在 `NEXT_STEPS.md` 作为独立待办。
- 生产构建仍未验证：开发服务器占用 `.next` 时曾出现 Windows `EPERM`，必须在独立环境重新验证。
- 生产构建本轮实测：编译与 TypeScript 阶段成功，静态页生成阶段出现 `EPERM: operation not permitted, mkdir '.next\server\app\...segments\...'`；`.next` 目录 ACL 含 `Everyone: DeleteSubdirectoriesAndFiles` Deny 项。状态记为「未通过验证」，不修改 ACL、不强行重试，不据此认定应用代码有缺陷。
- 工作区遗留未跟踪项：字面文件 `$null` 与临时目录 `tools-build-stage/`，均保留原样，不读取、不删除、不暂存、不提交。

## Web Public Beta 安全审查（2026-10-28）

- `004-PB-01` 已完成，完整门禁见 `docs/PUBLIC_BETA_RELEASE_GATE.md`。
- 当前可以直接复用的核心是记录、自动保存、去重、编辑、删除、统计、日历、备份、TokenHub 固定端点适配器和精确 Host/Origin 路由保护。
- 当前不能直接公开：`/model-test` 使用开发者环境 Key；正式 Chat/Follow-up 仅本机/LAN；BYOK、正式隐私页和安全响应头尚未实现。
- 智谱 BigModel 当前没有 Provider 代码；OpenRouter 当前是进程级环境 Key，不应在首期多用户 Beta 开放。
- Chat 与 Follow-up 的进程内幂等 Map 只适用于单长期运行实例；多实例或 Serverless 需要共享原子状态。
- AGPL Corresponding Source 地址仍为空，生产构建、HTTPS、腾讯云实际部署和 Android/iPhone 真机仍未验证。
- 本轮定向测试 69/69 通过；真实 AI 调用 0 次，未读取或修改真实生活记录。

## Web Public Beta 三步连接与请求级 BYOK（2026-10-28）

- `我的 → AI 连接 → 免费开启 AI` 已加入腾讯云 TokenHub 三步向导，普通用户不需要填写 Base URL、模型 ID、温度或输出 Tokens。
- 连接测试只使用固定合成文本，服务端成功响应后仍须通过 LifeRecord Schema 校验。
- API Key 仅在当前页面内存与当前 HTTPS 请求体中短暂存在；刷新或断开即丢失。Chat、分析和 Follow-up 使用同一页面内存连接。
- Public Beta 无 Key 时拒绝推理，不会使用开发者私人环境变量 Key；固定 TokenHub 官方地址，禁止浏览器自定义 URL。
- Public Beta 使用 `AIOS_PUBLIC_BETA_HOSTS` 精确 HTTPS 主机白名单、同源写入检查、最小 API 白名单和安全响应头。图片 AI、ChatGPT OAuth、Health、Telegram、`/model-test` 与未知 API 默认关闭。
- 本机 loopback 个人版、LAN 模式及既有 Provider 行为保持不变。
- 智谱 BigModel 连接仍未实现；界面只保留标注“尚未开放”的推广邀请入口。
- 阶段说明：`docs/PUBLIC_BETA_BYOK.md`。
- 最终验证：Public Beta 定向 45/45、串行全量 530/530 通过；TypeScript 与定向 ESLint 通过；敏感字面量扫描未发现真实 Key、Token 或私钥；真实模型调用 0 次。
- 本轮没有真实模型调用、部署、提交、打标签或推送。

### 尚未关闭的 Public Beta P0

- 限流与 Chat/Follow-up 幂等仍是单进程内存状态；首发应强制单实例，多实例/Serverless 前必须使用共享原子存储。
- 尚未完成真实 HTTPS 部署、生产构建和 Android Chrome / iPhone Safari 真机验收。
- 正式隐私政策、第三方 AI 数据处理告知、用户条款和删除/备份说明尚未发布。
- AGPL Corresponding Source 的真实地址和显著入口尚未启用。

## Web Public Beta 代码侧安全收口（004-PB-03，2026-10-28）

- 单实例部署约束、匿名会话、可信入口密钥、统一请求预算、Public Beta 私人凭据禁用和多实例 fail-closed 已完成。
- `/privacy`、`/terms`、`/source` 已完成；第三方 AI 首次连接必须确认隐私和费用说明。
- 源码入口已具备代码和页面，但尚未配置真实 Corresponding Source URL；公开发布仍被阻断。
- 生产安全头和动态 CSP nonce 已完成；webpack 独立生产构建成功。
- 验证结果：定向 48/48、全量 538/538、TypeScript、定向 ESLint、`git diff --check` 通过；真实模型调用 0 次。
- 当前可以进入 009-BETA 的真实 HTTPS 预发布验收，不能直接公开：仍需腾讯云单实例、域名/证书/Nginx、真实源码地址及 Android Chrome / iPhone Safari 真机验收。
