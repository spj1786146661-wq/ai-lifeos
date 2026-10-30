# AI 任务交接摘要

更新日期：2026-10-28（Asia/Shanghai）

## 权威规则

`AGENTS.md` 是项目唯一权威总规则。本文件只保存最新任务状态和交接摘要，不复制或取代总规则，也不取代 `logs/ai-runs/` 下的历史运行日志。

## 新执行器启动顺序

在 `life-tracker/` 根目录依次完成：

1. 读取 `AGENTS.md`。
2. 读取本文件与 `docs/PROJECT_STATUS.md`。
3. 读取 `tasks/queue.json`，确认目标任务的状态、revision、claim、run ID 和验收条件。
4. 读取目标任务最近的运行日志；需要延续未完成工作时再读取更早记录。
5. 执行 `git status --short --branch`、`git rev-parse HEAD`，检查未提交代码和当前分支。
6. 只有确认没有冲突 claim、没有来源不明改动且用户已分配任务后，才创建唯一运行 ID 并开始工作。

不能自动加载 `AGENTS.md` 的执行器，应在启动提示中明确写出上述读取要求。建议启动提示：

```text
你在 AI-LifeOS 项目的 `life-tracker` 目录中工作。
开始前必须读取 AGENTS.md、docs/AI_HANDOFF.md、docs/PROJECT_STATUS.md、
tasks/queue.json 中指定任务、该任务最近的 logs/ai-runs 日志，并检查 Git 状态。
AGENTS.md 是唯一权威规则。只执行指定任务；遵守任务 claim、数据安全、
测试和日志要求。不得提交、推送、部署、迁移真实数据或修改登录配置，
除非用户在该任务中明确授权。
```

## 当前阶段

- 阶段：Web Public Beta 上线冲刺；004-X 智能追问功能冻结。
- 状态：**004-X 冻结。真实 DeepSeek 已完成多记录自动保存、首轮联合追问、回答更新原记录、刷新持久化和调用次数控制的验收。第二轮真实请求成功返回零个有效问题；界面无提示消失问题已最小修复并增加离线回归。没有新增真实模型调用。未 commit、tag、push 或部署。**
- 当前 Git HEAD 与分支以 `git status --short --branch` 和 `git rev-parse HEAD` 为准；本轮核验时 HEAD 为 `c9cb724ddd30d1cb6674f1d9794f4c45316b8721`，分支为 `feature/ren-sheng-shu-ju-cang-v1`。
- 下一主任务：**004-PB-01 Public Beta 安全架构审查**。先处理 `docs/WEB_PUBLIC_BETA_BLOCKERS.md` 中的 P0；不得继续扩展 004-X 或上线后功能。
- P0 包括用户自带 API Key 的安全传输与不落盘、三步模型连接、共享原子幂等、浏览器本地数据隔离、公网路由白名单、HTTPS 生产构建、真机移动端验收、正式隐私文本和 AGPL 对应源码入口。
- Ollama、LM Studio、多模型池、手表导入、食物照片识别等进入上线后 P1，不阻塞当前 Beta。
- 正式解析复用 `lifeRecordPrompt()`，一次 TokenHub 请求返回 `records` 和最多三个首轮 `followUps`；请求固定模型、关闭思考、要求 JSON，默认输出预算 900，可通过服务端环境变量在 128–2000 范围调整。
- `LIFE_AI_PROVIDER=auto|tokenhub|chatgpt|openrouter` 控制远程 Provider；显式选择或调用失败时不会静默切换另一个远程收费 Provider，只进入明确标注的规则降级。
- TokenHub 来源已进入解析结果、记录 sourceRef、追问 supplement 和前端来源标签。用户回答仍通过保存后的真实记录 ID 更新原记录，不创建副本；第二、第三轮继续使用规则。
- 空回复、异常 JSON、Schema 不合法、超时、认证、额度和上游错误不会伪造 AI 成果或丢失原文；没有自动重试。
- 脱敏遥测只记录 provider、model、成功状态、延迟、usage、request ID 和错误代码，不记录 Key 或用户原文。
- 004-X 零问题完成态、刷新恢复、失败态、三轮上限与幂等边界专项 **34/34 通过**，串行全量 **513/513 通过**。3051 隔离测试实例已确认归属并停止，端口监听为 0。
- 004-X 的已验收范围不包含第三轮真实推理。日志无法区分“模型原始空数组”和“候选被全部过滤”，也未能确认第二个独立 correlationId 真实调用的来源；这些作为冻结后的已知边界，不继续消耗模型额度追查。
- 实现说明：`docs/TOKENHUB_CHAT_INTEGRATION.md`。
- 本轮运行日志：`logs/ai-runs/LIFE-TOKENHUB-CHAT-INTEGRATION-001/001-20261026T224949+0800-46c509686d3b4cb8bdc941049d71cee2.md`。

## 上一阶段

- 阶段：网页版 AI 智能延伸对话 v1。
- 状态：**代码、自动化测试和隔离规则模式浏览器验收已完成；真实 AI 问题质量转入当前验收任务。**
- 开发前 Git：分支 `feature/ren-sheng-shu-ju-cang-v1`，HEAD `f4801781c55a620bf8f3618e080e4c5401bddd85`（上一检查点 `checkpoint/life-smart-input-v1`）。
- 当前 HEAD 为上一检查点 `checkpoint/life-smart-input-v1` 对应提交；精确值以 Git 直接核验为准。
- 工作区同时保留尚未提交的 ChatGPT 套餐接入、验收缺陷修复和本轮改动；不得把本轮文件以外的改动回退或覆盖。`$null` 与 `tools-build-stage/` 保持原样，未读取、未删除、未暂存、未提交。
- 本轮运行日志：`logs/ai-runs/LIFE-MOOD-BULK-DELETE-001/001-*.md`。

## 最新未提交任务：心情可选评分 + 总记录批量删除

- 无评分心情可直接保存；字段缺失表示未评分。历史编辑可补充、修改或移除评分；记录数量与有效评分数量分开统计。
- 模型返回的心情分数只有在用户原话明确包含 1–5 分时才保留；规则模式遵循同一边界。
- 总日历增加「管理记录」：选中删除、删除当天全部、清空全部三种范围。清空全部要求输入确认文字并再次确认。
- 删除范围在确认时冻结为 ID 快照，执行时在当前权威写入锁内重新读取存储；底层逐条删除时按最终状态报告成功、已不存在、失败和图片清理失败。
- 自动化：`npm run test:life` 363/363；定向测试 84/84；TypeScript、定向 ESLint 通过。隔离预览 `http://127.0.0.1:3031/` 当前返回 HTTP 200。
- 隔离浏览器已通过无评分保存、刷新、补分、移除评分、不同日期数据、确认范围、取消流程、390×844 布局和控制台检查。三个最终危险删除按钮没有由自动化代替用户确认；删除服务已有实际自动化覆盖。
- 正式记录、正式 localStorage、正式 IndexedDB、Firebase 云端数据、迁移状态机和备份文件均未接触。Firebase 路由与认证未改；Firestore 更新适配器只补充移除评分时显式删除旧 `score` 字段。

## 最新未提交任务：真实 ChatGPT 接入验收缺陷修复

- 状态：代码修复、自动化测试及演示模式隔离浏览器验收完成，等待用户集中验收；未 commit、tag 或 push。
- 用户此前已在真实 ChatGPT 套餐模式发现心情遗漏、模糊心情被推断评分、重复提交、滚动遮挡、图片内部 ID 和来源标记问题。本轮没有再次消耗真实模型额度。
- 已修复无评分心情候选、显式评分边界、同日同分类同原文去重、部分保存幂等与强制新事件、图片目标重映射、滚动条与固定输入区遮挡、用户向图片卡片和来源标签。
- 自动化基线：`npm run test:life` 347/347；TypeScript、定向 ESLint、`git diff --check` 通过；敏感模式扫描 15 个核心文件命中 0。
- 隔离预览 `http://127.0.0.1:3012/` 使用合成数据与演示规则模式，未读取正式记录；桌面 1366×768、1280×720 和手机 390×844 的保存可达性、无横向溢出及控制台无 error/warning 已验证。
- 真实图片文件选择尚未完成受控浏览器验收：Edge/Chrome 自动化扩展都未启用「Allow access to file URLs」，无法注入合成图片。附件服务、记录关联、重复目标、备份恢复与内部 ID 不展示已有自动化覆盖；最终 UI 需用户人工验收。
- 本轮未修改真实 localStorage、IndexedDB、Firebase、数据库迁移状态机或备份文件；`$null`、`tools-build-stage/` 保持原样。

## 上一阶段已完成

- 本地数据库迁移完整阶段 v1：检查点 `checkpoint/local-database-upgrade-v1` → 提交 97edda3c37490c95793456bc317f0bd0f686c5c8；用户 Edge 集中验收 26/26 通过，双标签页 Web Lock 与刷新持久化通过；正式页仍以 localStorage 为权威源，原有 5 条生活记录未变。
- 总日历、分类日历与 iOS 动画 v1：检查点 `checkpoint/life-calendar-ios-v1`；数据首页保留六大分类统计圆环，通过「总日历 · 总记录」进入独立总日历，分类圆环直接进入分类日历。
- 上一阶段未修改 LifeRecord 模型、原话、ID、创建时间、解析规则、存储路由、数据库迁移、Firebase 或备份语义，未引入新的权威存储。

## 本轮结果

- 原话纠错：`lib/life-source-fragments.ts` 按中英标点切分原话并保留指向原始字符串的偏移量；`components/life-records/SourceFragmentEditor.tsx` 在用户消息气泡下展开，桌面端监听 `mouseup`/`touchend` 捕获真实选区并换算偏移，手机端提供逐句按钮作为备用交互。
- `LifeRecordSourceRef` 新增 `candidateType`、`confirmedType`、`userEdited`；`normalizeLifeRecord()` 校验后写入，确认保存时补齐 candidate/confirmed 分类。
- 图片附件：`lib/life-attachments.ts` 提供独立 IndexedDB 库 `life-tracker-attachments`，只存 Blob；LifeRecord 只保存 `{id,name,mimeType,size,sha256}` 引用，不写 Base64。
- 附件一致性：`lib/life-attachment-service.ts` 保证保存失败只清理本次新增且无人引用的图片、删除记录不误删其他记录仍在用的附件、记录备份损坏时附件库零写入。
- 备份兼容：`exportBackupWithAttachments()` 保持 JSON Backup v1 信封，附加 `attachmentBackup` 兄弟字段；旧版纯文字备份仍可导入。
- 防重复：`lib/life-record-duplicates.ts` 用 `date + confirmedType + 起止偏移 + 规范化文本` 做指纹，不依赖刷新后会变的 messageId。
- 无视觉模型降级：图片接口先校验文件再检查 Key；坏文件 400（含文件头签名校验），缺 Key 503 `mode:"unavailable"`；客户端保留图片并提供手动分类入口，明确标注未调用 AI。
- 修掉四个阻塞缺陷：503 死路、草稿预填编造值、刷新后重复判定失效、附件恢复孤儿图片。
- 自动化：`npm run test:life` **234/234 通过**；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0（仅 LF/CRLF 提示）。
- 敏感模式扫描：22 个相关文件，常见 Key/Token/Password/Private Key 模式命中 0。
- 未读取、未修改、未迁移用户真实生活记录；正式 localStorage、正式 IndexedDB、Firebase 路由、迁移状态机、备份语义均未改动。

## 追加轮次结果（多意图自动识别与批量确认优化）

- 新增 `lib/life-intent-parse.ts`：逐句扫描，一句话可同时产出多个分类；支持中文数字与「对象+时长」「时长+对象」两种语序；金额子句从食物描述中分离。
- 实测用户示例「昨晚睡了7个小时，早上去健身房练胸，卧推60公斤做了4组，中午吃了一碗牛肉面花了28块，下午学了两个小时英语，晚上心情不错。」产出 6 条：睡眠 7 小时、卧推 60 公斤 4 组、一碗牛肉面、¥28、英语 120 分钟、心情候选（保留「心情不错」，评分待用户确认）；「早上去健身房练胸」不额外生成第二条运动候选。
- 修复上一轮三个真实缺口：`学习英语45分钟` 不识别时长、`跑了5公里` 不识别、`看了一会儿书` 落到未识别区。
- 只提到分类但没有数字时给待补充候选（`昨晚没睡好`、`学了英语`、`买了杯咖啡`、`去健身房练了腿`），不丢弃也不编造数值。
- 预览区一次列出全部候选，底部「确认并保存全部 N 条」；缺字段条目单独提示且不阻塞其他条目。
- `saveRecordsWithAttachments()` 新增 `attachmentTargetIndex`，图片不再默认关联所有候选；未选择归属时跳过图片、只保存文字记录。
- 修复 390×844 手机视口下固定输入框遮挡「确认并保存全部」按钮导致静默失败的问题（记录页底部留白 `pb-[20rem] sm:pb-40`）。
- 自动化（多意图批次）：`npm run test:life` **259/259 通过**；`tests/life-intent-parse.test.mjs` 18/18；`tests/life-attachment-service.test.mjs` 11/11；`tests/life-record-duplicates.test.mjs` 13/13；`npx tsc --noEmit`、定向 ESLint、`git diff --check` 均通过。
- 收尾修正（2026-10-23）：「心情不错」不再换算成确定评分，改为保留原词并标记待补充分数；新增「心情3分」显式评分解析。缺字段候选不再让整批保存失败，只保存完整候选、其余留在预览区；编辑补全后自动清除「待补充」标记。
- 收尾回归：`npm run test:life` **261/261 通过**；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0。
- 隔离浏览器实测（3006 隔离副本 + 合成数据）：桌面视口一句话 6 条全部识别、单条修改组数 4→5 后一键保存、刷新后 6 条保留；重复提交同一句被拒并提示已保存过；手机 390×844 视口 5 条识别、保存、刷新保留、编辑备注、删除均正常；控制台无 error / warning。
- 真实 AI 模式仍未测试（未设置 `OPENROUTER_API_KEY`）；真实视觉模型仍未接入、未测试。
## 验证基线

- 本轮智能输入阶段：`npm run test:life` 234/234 通过；`npx tsc --noEmit`、定向 ESLint、`git diff --check` 均通过。
- 本阶段隔离 HTTP 验收：解析接口 demo 模式正确、空数据不编造、真 PNG 无 Key → 503、伪装图片 → 400。
- **隔离真实浏览器实测（Chrome headless，390×844）**：页面正常渲染，`scrollWidth=390`、`clientWidth=390`、无横向溢出；手机底栏为 `flex`、桌面导航为 `hidden`；图片入口、输入框、发送按钮均存在；控制台 0 error。
- 发送测试句后，待确认卡片正确渲染 4 条：运动（卧推 60 公斤 4 组）、睡眠（7 小时）、消费（¥38.00）、心情（4/5）；每张卡片显示对应原文片段与「AI 推测，待你确认」，并明确标注「规则演示 · 未调用 AI」。
- **确认保存无法在本沙箱完成**：该 headless 环境无法创建 IndexedDB backing store（`Internal error opening backing store for indexedDB.open.`）。应用按设计安全失败，显示「无法读取本地数据库迁移状态，已停止访问本地记录以保护数据」，未写 localStorage、未假报成功、无数据丢失；这是环境限制，不是应用逻辑缺陷。
- 因此以下仍未完成真实浏览器验收，需在可正常使用 IndexedDB 的 Edge 中人工验证：保存写入、刷新持久化、历史编辑/删除、图片附件保存与备份恢复。
- 上一日历阶段：`npm run test:life` 202/202 通过，日历专项 26/26；Edge/Chrome 隔离浏览器桌面与 390×844 视口验收通过。
- 历史 `AIOS-STORAGE-002`：`npm run test:life` 176/176 通过；Edge 隔离迁移测试 26/26 通过。
- 历史 `AIOS-OPS-001` 批次：`npm run test:life` 47/47 通过；与上述不是同一次运行，不合并统计。
- 历史 IndexedDB Adapter 交付批次：自动化 50/50、Edge 13/13；同样作为独立历史记录保留。
- 当前生产构建仍待验证：开发服务器占用 `.next` 时曾出现 Windows `EPERM`。
- 真实 AI、真实 Firebase、真实正式数据迁移均未验证或未开始。

## 已知边界

- 真实视觉模型未接入：本机没有 `OPENROUTER_API_KEY` 和 `OPENROUTER_VISION_MODEL`，真实识图未测试，不得写成已通过。
- 附件库无独立并发锁：记录层已有 Web Lock，两个标签页同时上传同一图片的行为未测试。
- 附件库容量与配额未做真实浏览器实测；写入失败路径只有自动化测试。
- 图片识别目前只覆盖饮食一类，尚未扩展到运动、消费、学习、心情。
- 旧版标签页仍可绕过协作 Web Lock；当前依靠启用前来源指纹变化拒绝切换，不能宣称完全解决旧标签页并发。
- 新增可观察风险（本轮实测发现，未在本轮修复）：`runLocalWrite()` 在每次本地写入前都要先从 IndexedDB 读取迁移状态；若浏览器或环境完全无法使用 IndexedDB，即使从未迁移的 localStorage 用户也会被拒绝保存。当前实现选择「明确报错、不猜测」以保证不写错库，但对禁用 IndexedDB / 隐私模式受限的浏览器会阻断记录。是否增加「IndexedDB 无能力时按 localStorage 权威源放行」的降级策略，需要单独评估后再改。
- 迁移、启用、恢复入口默认关闭，需 `NEXT_PUBLIC_ENABLE_LOCAL_DB_MIGRATION=true`。
- 真实迁移必须由用户单独明确授权，并在关闭其它 AI人生数据库标签页后执行。
- 浏览器本地数据不等于云端同步，仍需定期导出 JSON Backup v1。
- 生产构建未通过验证：本机 `next build --webpack` 在静态页生成阶段出现 `EPERM: mkdir`，与 `.next` 目录 ACL 的 Deny 项相关；编译与 TypeScript 均成功。不修改 ACL、不强行重试，需在独立环境再验证。
- 工作区遗留：未跟踪字面文件 `$null` 与未跟踪临时目录 `tools-build-stage/` 均保留原样，不读取、不删除、不暂存、不提交。
- 开发测试页 `app/dev/migration-test/page.tsx` 保留用于迁移维护，生产环境通过 `notFound()` 阻止访问。
- claim、lease、revision 和 fencing 仍只是协议定义，没有执行器级锁。
- 未跟踪字面文件 `$null` 保留在工作区：未读取正文、未删除、未暂存、未提交。

## 下一模型行动

1. 先核对 Git 状态、未提交改动范围和本摘要，不要假定它仍是最新事实。
2. 本阶段已建立本地检查点 `checkpoint/life-smart-input-v1`，未 push、未设置 upstream；后续改动应在新任务下另建检查点。
3. 不要开始正式数据迁移、不切换生产存储、不清理旧数据、不推送或部署。
4. 下一步是接入真实视觉模型（需服务端 OPENROUTER_API_KEY 与 OPENROUTER_VISION_MODEL）与真实文本模型验收。
5. 发布前仍需验证生产构建、真实 Firebase 登录与规则、移动端真机布局。
6. 后续可选任务：正式迁移授权前的检查项、AI 源码访问范围保护补丁（尚未实施，不得宣称已具备）。

## v0.1 个人版阶段归档（2026-10-23）

用户已完成人工验收：ChatGPT 官方重新授权成功，最新环境可使用真实 ChatGPT 模型；情绪描述与背景性运动词汇已能正确区分；自动保存与首页历史记录管理已通过隔离测试。

本轮只做 Git 阶段收尾，没有开发新功能。

### 已解决问题

- OAuth 403 复发根因：临时进程代理配置未形成项目启动脚本，Next.js 重启后 Node.js 直连出口与浏览器不一致。新增 `start-dev.ps1` 将代理配置固定为项目专用、进程级、可重复的启动方式。
- 过期授权状态显示：过期凭据不再显示为「AI 模式 / 可用」。

### 保留的未解决事项

- 生产构建仍未验证（`.next` EPERM 环境问题）。
- 图片文件选择 UI 需人工在真实浏览器点击验证。
- 真实视觉模型对图片的结构化识别尚未验收。

### 下一步

等待用户下一条开发指令。不要自行开始新功能、公开部署或商业化开发。

## 004-PB-01 Public Beta 安全架构审查（2026-10-28）

- 已生成 `docs/PUBLIC_BETA_RELEASE_GATE.md`，把上线门禁分为 8 个 P0 和可延后的 P1。
- 当前 Public Test 只开放 `/model-test` 与 `/api/model-test/chat`；主应用、正式 Chat、Follow-up、图片、OAuth、Health 和 Telegram 均未对公网开放。
- 当前 `/model-test` 使用开发者环境 TokenHub Key，进程全局限流，不能作为 Public Beta 入口。
- TokenHub 请求助手支持请求级 `apiKey`、固定 URL、输出上限、超时、usage 与安全错误映射，可复用为临时 BYOK。
- 智谱 BigModel 当前没有 Provider 实现；OpenRouter 当前是进程级环境 Key，不适合首期多用户。
- Chat/Follow-up 幂等为单进程 `Map`，只适用于单长期运行实例；多实例/Serverless 必须使用共享原子存储。
- 当前隐私页、正式用户条款、CSP/HSTS/Permissions-Policy、AGPL Corresponding Source 和生产构建仍未完成。
- 本轮定向测试 69/69 通过；没有调用真实模型，没有读取或修改真实生活记录。
- 下一任务：`004-PB-02` 三步连接向导与 TokenHub 请求级 BYOK。

## 004-PB-02 三步连接向导与 TokenHub 请求级 BYOK（2026-10-28）

- 新增手机优先三步向导：领取腾讯云试用权益、获取并粘贴 API Key、以固定合成生活描述执行结构化连接测试。
- API Key 只存在当前 React 页面内存和当前 HTTPS 请求体；不进入 localStorage、sessionStorage、IndexedDB、URL、Cookie、分析事件、普通日志或服务端持久化存储。
- Chat、分析和 Follow-up 已贯通当前请求携带的 TokenHub Key；Public Beta 缺 Key 时返回 `byok_required`，不会回退使用开发者环境变量凭据。
- 服务端固定 TokenHub 官方地址和允许模型，浏览器不能提供 Base URL；Public Beta 通过精确 HTTPS Host、同源写入、最小路由白名单和内部验证头保护。
- Public Beta 默认拒绝图片 AI、ChatGPT OAuth、Health、Telegram、`/model-test` 和未知 API；本机个人版和 LAN 现有行为保持不变。
- 智谱邀请入口已保留，明确标注尚未开放并披露推广邀请关系；本阶段未实现智谱 Provider。
- 完整说明见 `docs/PUBLIC_BETA_BYOK.md`。
- 最终自动化：Public Beta 定向 **45/45**、串行全量 **530/530** 通过；TypeScript、定向 ESLint、`git diff --check` 通过；真实模型调用 0 次。
- 发布前仍需：单实例部署约束或共享原子幂等/限流、真实 HTTPS 与手机真机验收、正式隐私/条款、AGPL Corresponding Source 真实入口和生产构建验证。
- 本轮不 commit、tag、push 或部署；下一任务不得自动开始。

## 004-PB-03 Public Beta 上线安全阻断修复（2026-10-28）

- 新增服务端签名匿名会话、可信反向代理入口密钥和单实例生产门禁；Public Beta 多实例或 Serverless 配置会 fail closed。
- 连接测试、Chat、Follow-up 已纳入统一的会话、Key 指纹、全局和并发预算；不使用 `X-Forwarded-For` 作为可信身份。
- 公网进程如配置开发者 TokenHub/OpenRouter Key 或 Firebase 配置会拒绝服务；Public Beta 只使用用户请求级 BYOK。
- 新增 `/privacy`、`/terms`、`/source` 和首次第三方 AI 告知确认；缺少真实 Corresponding Source 地址仍是发布阻断。
- 新增 `.env.public-beta.example` 和 `docs/PUBLIC_BETA_DEPLOYMENT.md`，明确单长期运行 Node 实例、HTTPS 反向代理和腾讯云人工配置范围。
- 最终验证：Public Beta 定向 48/48、串行全量 538/538、TypeScript、定向 ESLint、`git diff --check` 通过；webpack 独立生产构建成功。
- Turbopack 在当前受控 Windows 环境创建 Junction 失败；webpack 构建成功，因此不作为应用代码失败，但部署环境仍应复测目标构建器。
- 本轮没有真实 AI 调用、真实生活记录访问、提交、推送或部署。
- 下一步可以进入 009-BETA 预发布环境配置与真实 HTTPS 验收；公开发布前仍需真实源码地址、单实例腾讯云资源、域名证书、反向代理和 Android/iPhone 真机验收。
