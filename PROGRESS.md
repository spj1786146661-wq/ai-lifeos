# 项目进展

更新日期：2026-10-28（Asia/Shanghai）。

## 当前阶段：Web Public Beta 上线冲刺（2026-10-28）

- 004-X 多记录、多轮智能追问进入**功能冻结**。已通过真实验收的部分包括：多记录自动保存、首轮真实 AI 联合评估、追问更新原记录、刷新持久化、单次发送与上游调用控制。
- 第二轮真实验收中，DeepSeek 请求成功，但最终有效问题数为 0。原会话 Follow-up POST 1 次、上游推理 1 次、HTTP 200、输入 777 / 输出 94 / 总计 871 Tokens、延迟 4322 ms。日志没有错误、超时或降级。
- 追问区域无提示消失是明确的界面缺陷：零问题时 `SmartFollowUps` 在“无问题且不能继续”条件下直接返回 `null`，把已经设置的完成提示一并隐藏。最终修复后，零问题正常结束显示“本轮没有新的有效补充问题，智能补充已完成。”；请求失败显示独立的未完成提示；完成态不再显示误导性的“继续下一轮”按钮。
- 新增离线回归验证：没有活动会话时组件保持隐藏；有会话且零问题正常结束时显示完成态；同一标签页刷新后结束状态与历史仍可恢复；请求失败不能被显示为正常完成；第三轮后不会生成第四轮；完成面板自身没有模型请求路径。最终定向测试 **34/34 通过**，串行全量 **513/513 通过**。
- 004-X-FINAL 已关闭 3051 测试实例：确认监听 PID 属于 `life-tracker` 的 `next dev -p 3051 -H 127.0.0.1` 进程树后停止，复查端口监听数为 0。未调用真实模型。
- 本轮没有调用 TokenHub、ChatGPT 或其他真实模型，没有读取、修改或迁移真实生活记录，没有 commit、tag、push 或部署。
- 当前服务端幂等存储仍是单进程内存 `Map`，公共 Beta 多实例部署前必须换成共享原子存储，或在明确的单实例约束下上线；不能把本地单实例测试称为跨实例严格幂等。
- Public Beta 的 P0/P1 清单见 `docs/WEB_PUBLIC_BETA_BLOCKERS.md`。Ollama、LM Studio、多模型池、手表导入、食物照片识别等全部移入上线后，不阻塞本次 Beta。

## 最新未提交阶段：网页版 AI 智能延伸对话 v1（2026-10-26）

- 发送后的自动保存流程保持不变；合法记录成功写入后，才把解析结果中的追问映射到真实记录 ID，并显示最多三个补充问题。
- 首轮记录解析与追问生成复用同一次模型请求；规则模式及后续第 2、3 轮使用本地缺字段规则，不额外调用模型。
- 每个问题在显示前校验记录索引、分类、字段适用性、长度和重复；已有字段、缺字段未保存或重复记录不会收到可操作追问。
- 回答只通过现有 `withRecordWriteLock()` 重新读取权威存储并调用 `storage.update()`，不创建副本。冲突值、重复回答和迟到旧轮次被拒绝。
- 原 `sourceText`、`sourceRef`、附件保持不变；补充记录保存问题、回答、字段、规则或 AI 来源、provider/model（可确认时）、轮次和时间。旧数据无 `round` 仍兼容。
- 每条记录最多三轮，每轮最多三个问题。模型追问失败、空数组或 JSON 损坏不影响原记录保存。
- 自动化：全量串行测试 **454/454 通过**，专项 11/11；TypeScript、定向 ESLint 通过。最终 `git diff --check` 在本轮收尾时复跑。
- 隔离浏览器：`http://127.0.0.1:3006/`，使用隔离副本、合成数据和规则模式。自动保存、评分追问、原记录更新、刷新后总数与平均分、跳过流程均通过；390×844 下 `scrollWidth=clientWidth=390`，控制台无 error。
- 本轮没有使用真实 ChatGPT/OpenRouter 做追问验收，页面明确显示「规则推荐 · 未调用 AI」；不得把本轮隔离结果写成真实 AI 已通过。
- 未读取、修改或迁移正式生活记录；未修改 Firebase、数据库迁移状态机、OAuth、Health、Telegram、Proxy 或微信小程序。未 commit、tag 或 push。

## 最新未提交阶段：心情可选评分 + 总记录批量删除

- 心情评分已从必填改为可选：`score` 字段缺失表示“用户没有评分”，不会写入 `0`、默认 `3`、`null` 转数字或模型推测值。「今天心情一般」「心情不错」「有点烦躁」可只保存描述；只有原话明确包含「心情3分」或用户手动选择 1–5 分时才保存评分。
- 历史编辑支持补充、修改和移除评分。未评分心情仍计入记录总数、日历和历史；统计新增 `ratedMoodCount`，平均分只使用明确有效的评分。
- 「总日历 · 总记录」新增独立「管理记录」区域，支持勾选多条、删除选中日期全部记录，以及需手动输入 `清空全部生活记录` 的危险清空流程。确认范围冻结为 ID 快照；执行时在当前权威写入锁内重新读取存储，不会因重复点击或页面变化扩大范围。
- 当前 `LifeRecordStorage` 没有原子批量删除接口，因此按记录逐条删除，并按最终权威数据准确报告成功、已不存在、失败和图片清理失败数量。共享附件只要仍被其他记录引用就保留；无人引用附件才按现有安全规则清理。
- 自动化回归：`npm run test:life` **363/363 通过**；本阶段定向测试 84/84；`npx tsc --noEmit` 通过；定向 ESLint 0 errors / 0 warnings。最终 `git diff --check` 结果见本轮运行日志。
- 隔离浏览器：`http://127.0.0.1:3031/` 使用合成数据和明确标注的演示规则模式。无评分保存、刷新、补评分、移除评分、不同日期记录、删除范围确认、取消流程、390×844 无横向溢出和控制台无 error 已验证。危险删除的最终确认按钮尚未由自动化代替用户点击；删除逻辑由独立测试实际覆盖。
- 本阶段未读取或修改正式生活记录、正式 localStorage、正式 IndexedDB、Firebase 云端数据或迁移状态机。Firebase 登录路由和认证保持原样；仅在既有 Firestore 更新适配器中补充“移除评分时删除旧 `score` 字段”的必要语义。未 commit、tag 或 push。

## 阶段收尾：智能输入、原文纠错、图片上传与多意图识别 v1（用户两轮人工验收通过，已建立本地 Git 检查点）

- 用户已在真实浏览器完成两轮人工验收。第一轮：核心保存、原文纠错、图片、备份恢复。第二轮：六类一句话拆成多条候选、只改其中一条其余不变、刷新后重复输入不重复保存、「心情不错」不转成确定评分、文字加图片时指定图片归属。全部通过。
- 收尾复核发现 2 处实现与验收口径不一致，并在建立检查点前修正（未新增产品范围）：
  1. 「心情不错」此前仍被规则换算成 4 分。现改为保留原词、不写确定评分，生成 `needsFields` 候选由用户在 1–5 中确认；只有「心情3分」这类明确数值才解析为对应评分。
  2. 缺字段候选此前会让整批「确认并保存全部」失败。现改为只保存已完整的候选，缺字段条目留在预览区继续提示，其他记录照常写入；图片归属按实际保存顺序重新映射，目标候选缺字段或重复时明确拒绝并提示。
- 编辑某条候选补全字段后会自动清除「待补充」标记，不再出现已填好仍提示缺字段。
- 最终回归：`npm run test:life` **261/261 通过**（0 failed / 0 skipped）；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0（仅 LF/CRLF 提示）。
- 敏感信息扫描：本阶段源码、测试、文档与环境变量示例对常见 Key/Token/Private Key 模式命中 0；仅 `PROGRESS.md`、`docs/AI_HANDOFF.md`、`.env.example` 的说明性文字出现 “private key” 字样，不是密钥。
- Git 收尾：本地提交 `feat: add smart input, multi-intent parsing and image attachments v1`，附注标签 `checkpoint/life-smart-input-v1`；未推送远程、未设置 upstream。具体 SHA 以 `git rev-parse checkpoint/life-smart-input-v1^{commit}` 为准。
- 真实 AI 文本模型与真实视觉模型仍未配置、未测试；本阶段能力是规则解析驱动的智能输入与图片附件管理。

## 阶段记录：智能输入、原文纠错与图片上传识别 v1（开发批次，状态已被上方收尾覆盖）

以下内容保留开发当时的状态描述。本轮在 `checkpoint/life-calendar-ios-v1`（提交 b88b4c8a416e8782a4127b069b30d1c4c9e23987）之上开发，开发批次完成时尚未提交 Git。

### 功能 A：聊天原文直接纠错

- 新增 `lib/life-source-fragments.ts`：`splitSourceSentences()` 按中文与英文标点切分原话，偏移量始终指向未改动的原始字符串，因此标点、空格和重复片段都能唯一定位；`locateDraftInSource()` 用已解析记录的事实词（activity/food/note/金额/时长/分钟）加分类提示词定位最小相关句子；`spanFromOffsets()` 校验并修剪任意手选范围。
- 新增 `components/life-records/SourceFragmentEditor.tsx`：在原话气泡下展开，桌面端监听 `mouseup`/`touchend` 捕获真实选区并换算回原文偏移；手机端提供逐句按钮作为备用交互，避免与系统选择工具条冲突。选中片段后可直接指定六大分类，`RecordFields` 在原文基础上补充字段，加入下方待确认列表。
- `LifeRecordSourceRef` 记录 `messageId`、`start`、`end`、`text`、`origin`（`ai` 推测 / `user` 手动）、`candidateType`（解析器原分类）、`confirmedType`（用户确认分类）、`userEdited`。`normalizeLifeRecord()` 校验全部字段，非法引用被丢弃而不是让脏数据落库。
- 确认保存时补齐 `candidateType` 与 `confirmedType`；已保存记录在历史列表中展示「原文片段：… · AI 推测后已确认 / 手动确认」。
- 保留 `sourceText` 不变；保存、编辑、删除、备份、迁移路径全部沿用现有 `recordStorage`，没有新建权威数据源。
- 保留原有手动添加入口，只作为备用，不取代原文纠错。

### 功能 B：聊天输入框图片上传与附件库

- 新增 `lib/life-attachments.ts`：独立 IndexedDB 附件库 `life-tracker-attachments`（库名与正式记录库 `life-tracker-life-records` 不同），只存图片 Blob，记录里只保存 `{id,name,mimeType,size,sha256}` 引用，**不把 Base64 写入 LifeRecord**。校验 JPG/PNG/WebP、≤5 MB；`attachmentTypeFromName()` 兼容手机端空 MIME；`createMemoryAttachmentStorage()` 供测试使用。
- 新增 `lib/life-attachment-service.ts`：`saveRecordsWithAttachments()` 先写附件再写记录，记录写失败时只删除本次新增且无人引用的图片；`removeRecordAndUnusedAttachments()` 删除记录时只清理没有其他记录引用的附件；`restoreBackupWithAttachments()` 先校验记录备份，通过才写附件、再写记录，记录备份损坏时附件库零写入。
- `exportBackupWithAttachments()` 保持 JSON Backup v1 信封不变，额外附加 `attachmentBackup` 兄弟字段；旧版纯文字备份仍可正常导入（无引用 id 时直接走原路径）。
- 新增 `components/life-records/ImageComposer.tsx`：输入框上方图片入口、缩略图、大小显示、移除按钮、objectURL 释放；`AttachmentView.tsx` 在历史记录中从附件库读取并预览图片。
- 取消待确认卡片会同时丢弃图片，不会留下孤儿附件。

### 功能 C：AI 图片理解（真实状态：未接入）

- `app/api/life-records/image/route.ts` 改为**先校验文件再检查 Key**：坏文件一律 400（含按文件头签名校验的假图片）；缺 `OPENROUTER_API_KEY` 或 `OPENROUTER_VISION_MODEL` 时返回 503 `{mode:"unavailable", visionConfigured:false}`，明确写出「未调用 AI，也未保存图片」。
- 客户端不再把 503 当错误：保留图片、打开待确认卡片、提供「为图片添加记录」入口，并在状态栏和聊天回复中明确标注未调用 AI。
- 本机两个环境变量均未设置，因此**真实视觉模型未接入、未测试**，不能写成已通过。
- 不估算卡路里、重量、金额；用户主动问热量时才进入图片问答分支，且回答必须说明图片无法确定份量。

### 修复的四个阻塞性缺陷（接手上一位模型未完成的现场）

1. 无视觉模型时图片流程是死路：503 现在被正确识别为降级，而不是抛错。
2. 草稿预填编造值：`SourceFragmentEditor.baseDraft()` 与 `RecordFields.changeType()` 不再写入 sets:1 / hours:8 / amount:1 / score:3 等未确认事实；`emptyDraftForType()` 全部留空，由测试逐字段断言。
3. 刷新后重复判定失效：新增 `lib/life-record-duplicates.ts`，指纹为 `date + confirmedType + 起止偏移 + 规范化文本`，不依赖刷新后会变的 messageId；`confirmSave()` 同时比对内存 ref、已保存记录指纹和当前 records。
4. 附件备份恢复失败边界：记录备份损坏时附件库零写入，不会留下孤儿图片。

### 数据安全与验证边界

- 未读取、未修改、未迁移用户真实生活记录；正式 localStorage、正式 IndexedDB、Firebase 路由、迁移状态机和备份语义均未改动。
- 未跟踪字面文件 `$null` 与临时目录 `tools-build-stage/` 保持原样：未读取、未删除、未重命名、未修改、未暂存、未提交。
- 未执行 `git clean` / `reset --hard` / `git add .` / `git add -A`；未 commit、未 tag、未 push。
- 未安装依赖、未购买服务、未配置任何 API Key；未修改 Magpie/Codex/ChatGPT 登录配置。
- 敏感信息扫描：本阶段 22 个相关文件对常见 Key/Token/Password/Private Key 模式命中 0 次。
- 自动化测试：`npm run test:life` **234/234 通过**（上一检查点 202/202 + 本阶段 32 项）；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0（仅 LF/CRLF 提示）。
- **隔离 HTTP 验收**（非完整浏览器会话）：`GET /api/life-records/parse` 返回 `{"mode":"demo"}`；完整句子 demo 解析出运动/睡眠/消费/心情 4 条且字段正确；空数据分析不编造；带 2 条记录的分析正确汇总；真 PNG 无 Key → 503 `mode:"unavailable"`；文本伪装 PNG → 400；gif → 400。
- **隔离真实浏览器实测（Chrome headless，390×844）**：页面正常渲染，`scrollWidth=390`、`clientWidth=390`、无横向溢出；手机底栏为 `flex`、桌面导航为 `hidden`；图片入口、输入框、发送按钮均存在；控制台 0 error。
- 发送测试句后，待确认卡片正确渲染 4 条：运动（卧推 60 公斤 4 组）、睡眠（7 小时）、消费（¥38.00）、心情（4/5）；每张卡片显示对应原文片段与「AI 推测，待你确认」，并明确标注「规则演示 · 未调用 AI」。
- **确认保存无法在本沙箱完成**：该 headless 环境无法创建 IndexedDB backing store（`Internal error opening backing store for indexedDB.open.`）。应用按设计安全失败，显示「无法读取本地数据库迁移状态，已停止访问本地记录以保护数据」，未写 localStorage、未假报成功、无数据丢失；这是环境限制，不是应用逻辑缺陷。
- 因此以下仍未完成真实浏览器验收，需在可正常使用 IndexedDB 的 Edge 中人工验证：保存写入、刷新持久化、历史编辑/删除、图片附件保存与备份恢复。
- 新增可观察风险（本轮实测发现，未在本轮修复）：`runLocalWrite()` 在每次本地写入前都要先从 IndexedDB 读取迁移状态；若浏览器或环境完全无法使用 IndexedDB，即使从未迁移的 localStorage 用户也会被拒绝保存。当前实现选择「明确报错、不猜测」以保证不写错库，但对禁用 IndexedDB / 隐私模式受限的浏览器会阻断记录。是否增加「IndexedDB 无能力时按 localStorage 权威源放行」的降级策略，需要单独评估后再改。
- 生产构建未执行；正式 `.next` 存在已知 `EPERM` 环境问题，仍为发布前待验证事项。

## 本轮完成：本地数据库迁移完整阶段 v1（用户已完成集中验收，Git 收尾进行中）

- 在既有 `importRawRecordsForMigration()`、迁移校验和复制引擎上补齐持久化状态机、迁移编排、正式路由切换、写入闸门、中断恢复和「我的」页升级入口；没有重写 Adapter 或迁移引擎。
- 新增 `lib/life-migration-state.ts`：状态为 `NOT_STARTED → IN_PROGRESS → VERIFYING → READY_TO_SWITCH → SUCCEEDED`，失败进入 `FAILED`；只有显式启用且 `activeStore=indexedDB` 才能进入 `SUCCEEDED`。状态写入 IndexedDB `meta` store，记录写入 `records` store。
- 新增 `lib/life-migration-service.ts`：执行备份、来源指纹、校验、复制、回读比对；成功后只到 `READY_TO_SWITCH`，用户显式启用前 localStorage 仍是权威源。启用前重新比对来源与目标完整 SHA-256 指纹；任一侧变化即拒绝。
- 新增 `lib/life-migration-routing.ts`：未登录路径只在持久化状态为 `SUCCEEDED + indexedDB` 时切换；IndexedDB 有数据本身不能触发路由。新建、修改、删除和备份恢复均经过同一 Web Lock 和状态闸门。
- 中断恢复：`recoverInterruptedMigration()` 在 `IN_PROGRESS`/`VERIFYING` 时先重新校验来源；目标为空才重新事务化复制，目标完整一致只补写 `READY_TO_SWITCH`，目标非空且不一致则保留现场并标记 `FAILED`。
- 多标签页保护：迁移、启用、恢复与新版页面本地写入共用 Web Lock `ai-lifeos:local-db-migration:v1`；写入取得锁后重新读取持久化路由，防止某标签页启用后其它标签页仍写 localStorage。没有 Web Locks 时拒绝迁移，不退回时间戳锁。旧版标签页仍可绕过协作锁，依靠启用前来源指纹变化拒绝切换。
- 「我的」页新增存储状态、记录数、迁移阶段、错误、备份、开始/重新校验、安全恢复和显式启用入口；正式入口由 `NEXT_PUBLIC_ENABLE_LOCAL_DB_MIGRATION=true` 控制，默认关闭。界面明确写出 IndexedDB 仍是浏览器本地数据，不等于云端同步。
- Firebase 登录路径保持不变，仍优先使用 Firestore `life_entries`；迁移只影响未登录本地路径。旧 localStorage 数据从不自动删除，迁移前备份通过浏览器下载交给用户保存。
- 新增 `app/dev/migration-test/page.tsx`：只在开发环境提供，使用独立库 `ai-lifeos-migration-browser-test-v1` 和内存模拟 localStorage，不打开正式库。
- 自动化：`npm run test:life` 172/172 通过；`npx tsc --noEmit` 退出码 0。新增状态机、服务和路由测试覆盖完整成功、来源/目标变化、重复 ID、损坏 JSON、空数据、目标非空、并发复制、中断恢复、错误 claim 条件等。
- Edge 隔离浏览器实测：完整迁移测试 22/22 通过；刷新后状态读取通过，`SUCCEEDED + target=2`；隔离页控制台无 error/warn。正式页只读显示 5 条真实 localStorage 记录，升级入口 disabled，未迁移真实数据。
- 2026-10-22 用户集中人工验收结果（Edge）：完整迁移测试 26/26 通过（含写入失败、回读失败、JSON 备份导出与恢复）；两个真实标签页 Web Lock 测试通过；刷新后迁移状态与目标记录检查通过；正式页仍以 localStorage 为权威源，原有 5 条生活记录保持不变。
- 最终回归（本阶段收尾批次）：`npm run test:life` 176/176 通过；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0。本批次与上一段 172/172 记录不是同一次运行，分开保留。
- 敏感模式扫描：本轮涉及的页面、模块和测试共 11 个文件，常见 Key/Token/Password/Private Key 模式命中 0 次。
- 阶段收尾：已建立本地 Git 检查点提交 `feat: complete local database migration v1` 和附注标签 `checkpoint/local-database-upgrade-v1`，指向提交 `97edda3c37490c95793456bc317f0bd0f686c5c8`；未推送远程。
- Git 收尾状态：提交 `feat: complete local database migration v1` 与附注标签 `checkpoint/local-database-upgrade-v1` 已建立，指向提交 97edda3c37490c95793456bc317f0bd0f686c5c8。
- 未执行：真实用户生活记录迁移、正式启用 IndexedDB、正式数据上线迁移、旧 localStorage 数据清理。这些事项仍未完成，不得在文档或汇报中写成已完成。
- 尚未完成：真实 Firebase 登录路径浏览器回归、生产构建（开发服务器占用 `.next`）、真实正式数据迁移和旧版标签页完全隔离；这些仍不能宣称通过。

## 阶段收尾记录：本地数据库升级 v1（2026-10-22）

- 文档与状态校准：`docs/AI_HANDOFF.md` 中 `AIOS-STORAGE-002` 由 `interrupted` 改为 `completed`；`tasks/queue.json` 仅修改该任务的状态与 `lastResult`，保留 `executionCount=1`、原始运行 ID 和历史日志，未编造第二次执行；`docs/PROJECT_STATUS.md` 同步为已验收状态。
- `AGENTS.md` 新增「跨平台长期开发原则」：继续 Next.js、核心逻辑与 UI 分离、存储只走 StorageAdapter 抽象、未来可分别接入 IndexedDB/SQLite/小程序兼容存储、AI 调用仅走服务端、不同平台本地数据不天然共享、避免平台耦合、按完整阶段连续实施后集中验收。本轮未实现 APP、小程序或新存储适配器。
- 开发测试页 `app/dev/migration-test/page.tsx` **保留**：后续迁移维护需要可重复的浏览器隔离验收；页面只在开发环境提供（`process.env.NODE_ENV === 'production'` 时 `notFound()`），使用独立库 `ai-lifeos-migration-browser-test-v1` 和内存模拟 localStorage，不打开正式库 `life-tracker-life-records`，不读取正式 localStorage。
- AI 源码访问范围保护补丁仍未实施，已记录到 `NEXT_STEPS.md` 作为独立待办，本轮未开发、未宣称已具备强制访问隔离。
- 未接触真实生活记录内容：未迁移、未启用正式 IndexedDB、未清理旧 localStorage、未修改 Firebase 业务逻辑。Git 检查点只保护代码，浏览器本地数据仍由用户自行保管。
- 生产构建未通过验证：本机执行 `npx next build --webpack` 在静态页生成阶段出现 `EPERM: operation not permitted, mkdir '.next\server\app\...segments\...'`；`.next` 目录 ACL 中存在 `Everyone: DeleteSubdirectoriesAndFiles` 的 Deny 项。编译与 TypeScript 阶段均成功。该错误属于本机构建环境权限问题，本轮不修改 ACL、不重建 `.next`、不强行重试，也不能据此认定应用代码有缺陷。
- 仓库根目录存在未跟踪的临时目录 `tools-build-stage/`（此前为隔离构建尝试创建，含源码副本）。本轮按保守策略保留、不删除、不提交、不读取其中内容；其中可能包含 `$null` 字面文件的副本。
- 未跟踪字面文件 `$null` 保持原样：未读取正文、未删除、未重命名、未修改、未暂存、未提交。

## 本轮完成：IndexedDB 无损迁移写入 v1（未提交，等待验收）

- 新增 `MigrationTargetNotEmptyError`、`MigrationImportResult`、`MigrationCapableStorage` 和 `importRawRecordsForMigration(records)`，全部在 `lib/indexeddb-adapter.ts`。`createIndexedDBAdapter()` 的返回类型从 `LifeRecordStorage` 收紧为 `MigrationCapableStorage`，后者 extends 前者，因此现有调用方、`recordStorage` 路由和正式接口语义不变。
- 迁移导入不调用 `normalizeLifeRecord()`：实测迁移后字段集合与来源完全一致（`Object.keys` 排序后相同），原始 ID、`createdAt`、`sourceText`、`note`、全部结构化字段、未知字段（`moodTag`）、嵌套对象和数组（`legacyBlob.nested`、`tags`）都原样保留，不生成新 ID、不改写时间、不修改来源对象。
- 目标判空与批量写入在**同一个 readwrite 事务**内完成：先 `store.count()`，非空即 `tx.abort()` 并抛 `MigrationTargetNotEmptyError`，然后逐条 `store.add()`（非 `put`），等待事务 `complete` 后才返回 `{ written }`。全程不使用 `clear()`。
- 结构预检在任何数据库操作之前：非数组、非对象元素、缺失/空/非字符串 ID、重复 ID 都直接抛错，不接触目标库。
- 迁移引擎 `lib/life-migration-engine.ts` 的 `MigrationTarget` 接口从 `restoreBackup()` 改为 `importRawRecordsForMigration()`；引擎删除了迁移前的预读判空，改由目标端事务保证，因此「先读到空、再被别人写入」的竞态不再依赖引擎侧的先后顺序。
- 引擎新增 `isTargetNotEmpty()` 按错误名分流到 `target_not_empty` 阶段，因此换一个适配器实现同样能正确归类，不依赖具体类。
- 保留原有：来源校验、不可比较值检查、写入前后中断检查、完整字段比较、ID 集合比较、回读验证、错误阶段报告。写入后校验失败仍不宣称成功、不自动清空目标库。
- 测试：`tests/indexeddb-adapter.test.mjs` 18 → 28 项；`tests/life-migration-engine.test.mjs` 22 → 29 项；`npm run test:life` 122/122 通过（上一轮 105 + 新增 17），`npx tsc --noEmit` 退出码 0，定向 ESLint 0 errors 0 warnings，`git diff --check` 退出码 0。
- 测试覆盖任务要求的 16 项，另补充：字段集合逐键一致、来源对象不被改写、迁移导入不属于正式接口面、普通 `create()` 产生的记录同样受保护、并发导入只允许一个成功、字段顺序不同不产生假差异、既有 JSON 导出与恢复语义不变。
- 敏感信息扫描：4 个改动文件对常见密钥模式命中 0 次；未读取、未删除、未暂存未跟踪的 `$null`。
- 仍未实现：持久化迁移状态机、正式多标签页锁、自动迁移、正式数据切换。本轮只解决无损写入与事务安全。
## 本轮完成：迁移前数据校验 v1（尚未提交，等待验收）

- 新增 `lib/life-migration-validation.ts`：纯函数 `validateLocalSource()` 与 `parseLocalSource()`，只判断来源数据是否满足安全迁移条件，不读取 localStorage、不写入任何数据库、不调用 AI。
- 校验覆盖：JSON 无法解析、根结构不是数组、元素不是对象、ID 缺失/空串/非字符串/重复、日期非法（含 2026-02-30）、类型不受支持、类型必填字段缺失、字段类型或范围错误。空数组与 `null`/`undefined`/`''` 是合法空数据，与损坏数据分开判定。
- 字段规则复用 `lib/life-records.ts` 的 `validLifeDate`、`LIFE_RECORD_TYPES`、`LIFE_RECORD_LABELS`，取值范围与 `normalizeLifeRecord` 一致；未新增依赖，未修改任何已有文件。
- 三条硬约束：不修改输入对象（`records` 以原始引用返回，测试断言 `record === original`）；不自动补 ID、不改日期、不删记录；**不调用 `normalizeLifeRecord` 做规范化比对**，否则未知字段会被静默丢弃却显示校验通过。
- 与备份恢复路径的差异已记录：`restoreDemoBackup()` 和 IndexedDB `validateBackup()` 会为缺失 ID 补 UUID，迁移校验改为直接报 `ID_MISSING`，避免悄悄改变记录身份。
- `null` 输入在初版被误判为非法，已修复为合法空数据；`'   '` 保持判为损坏，与 `readRawStorage()` 现有语义一致。
- 测试：新增 `tests/life-migration-validation.test.mjs` 29 项，全部使用合成数据；`npm run test:life` 83/83 通过（原 54 + 新增 29），`npx tsc --noEmit` 退出码 0，定向 ESLint 0 errors 0 warnings，`git diff --check` 退出码 0。
- 敏感信息扫描：两个新文件对常见密钥模式命中 0 次；未读取、未删除、未暂存未跟踪的 `$null`。
- **迁移引擎尚未开发**：本模块只是迁移前的检查关卡，不能据此声称迁移已完成。

## 本轮完成：历史记录搜索 v1

- 新增 `lib/life-search.ts`：纯函数 `searchLifeRecords()`，对已加载记录做本地子串匹配，不改写、不排序、不复制记录对象；空查询返回空数组，不会把全部记录当成匹配结果。
- 匹配范围覆盖用户可回忆的字段：`sourceText` 原话、`note` 备注、类别中文名、`activity`/`subject`/`food` 结构化字段和 `date` 日期；大小写、空白与全角字符在比较前统一规范化。
- `app/page.tsx` 在历史记录区新增搜索输入框、清除按钮、匹配数量提示；点分类圆环时清空搜索，避免两种筛选条件混淆。
- 搜索只读取已保存记录，不调用任何 AI 服务，不产生费用，界面文案明确写出这一点。
- 测试：`npm run test:life` 54/54 通过（原 47 项 + 新增 `tests/life-search.test.mjs` 7 项），`npx tsc --noEmit` 退出码 0，`npx eslint app/page.tsx lib/life-search.ts` 退出码 0，`git diff --check` 退出码 0。
- Edge 浏览器实测：5 条真实记录下 `肠粉`→4 条、`电工`→4 条、`2026-10-20`→4 条、`睡眠`→1 条、`9小时`→1 条、无匹配词→0 条并显示空状态；分类圆环筛选与搜索叠加正常；刷新后记录仍在；控制台无 error/warning。
- 未修改任何存储逻辑：`recordStorage` 路由、localStorage 键名与 Firebase 分支均未改动，搜索不写入任何存储。

# 项目进展

更新日期：2026-10-21（Asia/Shanghai）。

## 本轮完成：多模型协作检查点与交接校准

- `AIOS-TOOLING-004A` 将第一阶段协作规则、交接文档、任务队列、日志规范和 `AIOS-OPS-001` 历史日志纳入本地 Git 检查点。
- `AGENTS.md` 增加完全只读任务例外、敏感元数据检查边界，以及 claim/lease/runId/claimToken/fencingRevision/结构化 `lastResult` 的协议字段。该协议仍没有执行器级互斥实现。
- `tasks/queue.json` 保持 `schemaVersion: 1`，兼容原任务结构；补充 claim 字段定义，并将本检查点任务记录为完成。
- 测试记录按套件和运行批次分开：`AIOS-OPS-001` 本次运行 `npm run test:life` 为 47/47；历史 IndexedDB 交付记录中的 50/50 保留为另一次记录，两者不合并成同一批测试。
- 本任务只修改批准的协作制度文档，没有修改 `app/`、`components/`、`lib/`、`tests/`、依赖、环境变量、登录配置或真实用户数据；未推送、未部署。

## 本轮完成：多模型协作与交接基础结构

- `AGENTS.md` 已非破坏性扩展为 Codex、OpenCode、Magpie 及后续模型共用的唯一权威总规则，补充启动读取顺序、事实依据、单任务领取、真实数据保护、敏感信息、测试失败边界、Git 禁止事项、唯一运行 ID、claim/lease/revision 防覆盖协议和中断保存要求。
- 新增 `docs/AI_HANDOFF.md`（最新交接摘要）、`docs/PROJECT_STATUS.md`（依据代码、测试和 Git 的状态）、`tasks/queue.json`（机器可读任务队列）和 `logs/ai-runs/`（不可覆盖的运行历史及格式规范）。
- 本任务 `AIOS-OPS-001` 运行日志已保存；基线 `npm run test:life` 47/47 通过，`npx tsc --noEmit` 通过。
- 本轮未修改业务代码、依赖、环境变量、登录配置、Magpie 路由或真实用户数据；未提交、未推送、未部署。并发锁目前只完成协议定义，自动 claim/lease/CAS 脚本仍待后续实现。

## 本轮完成：IndexedDB Adapter v1（已完成并通过真实浏览器验收）

- 新增 `lib/indexeddb-adapter.ts`，实现 `LifeRecordStorage` 全部 7 个异步接口，并保持现有 `LifeRecord` 数据模型与 JSON Backup v1 兼容。
- records/meta 两个 Object Store，按真实记录字段建立 `by_date`、`by_type_date` 索引；读取、创建、修改、删除、导出和恢复均通过 IndexedDB 事务。
- 所有写操作等待事务 `complete` 后才返回成功；批量创建和备份恢复失败时整体回滚。创建使用 `add`，重复 ID 不会被静默覆盖。
- 备份在写入前完整校验；非法日期、重复内部 ID、版本或格式错误不会清空现有数据。打开、升级和事务失败均明确报错，不会伪装成空数据库。
- 适配器导入时不会打开或创建数据库，只在显式调用后惰性打开；正式页面尚未接入。
- Edge 真实浏览器场景验收：13/13 通过；刷新后持久化测试通过。覆盖 CRUD、批量事务、重复 ID、批量失败回滚、JSON Backup v1 导出/恢复、非法日期与重复 ID 拒绝、原数据保护、重新打开连接和刷新持久化标记。
- 历史 IndexedDB Adapter 交付批次记录：该批次自动化回归 50/50 通过（含独立 IndexedDB Adapter 18 项）；真实浏览器控制台无 warn/error；桌面与 390×844 布局正常。该 50/50 与 `AIOS-OPS-001` 的 47/47 不是同一次运行。
- `createIndexedDBAdapter()` 增加仅供测试注入的 `createRecordId` 选项；默认仍使用 `crypto.randomUUID()`，正式页面调用路径未变。
- 临时 `/dev/indexeddb-test` 路由、客户端页面和专属浏览器场景模块已从正式工作区移除；验收证据保留在本文件中，不进入产品代码。
- 保留 `tests/indexeddb-adapter.test.mjs` 与 `fake-indexeddb` 开发依赖；独立测试数据库可继续保留，无需为清理路由而删除。
- 正式 localStorage 数据未迁移、未修改或清理；正式 IndexedDB 未连接。未登录仍走 localStorage，Firebase 登录用户仍走 Firestore `life_entries`，正式“记录 / 数据 / 我的”页面未改。
- 完整生产构建未执行通过验证：当前开发服务器占用 `.next`，尝试构建出现 Windows `EPERM` 权限冲突，未关闭服务器。生产构建和真实浏览器发布前检查仍待验证。

## 本轮完成：StorageAdapter v1.1 异步接口统一（用户已通过 4 项人工浏览器验收）

- `LifeRecordStorage` 接口 7/7 方法全部异步：`exportBackup()` → `Promise<DemoBackup>`，`isLocalDataCorrupted()` → `Promise<boolean>`。
- 数据损坏检测与迁移状态明确分离（接口注释 + NEXT_STEPS.md 约束）；未来迁移状态走独立 `getMigrationStatus()`。
- Firebase 云端行为不变；登录路由不变；备份 JSON v1 格式不变（旧备份文件兼容，有测试）。
- 页面导出/损坏检测改 await；新增异步 resolve 测试；29/29 测试、tsc、定向 ESLint 全部通过。
- NEXT_STEPS.md 录入 IndexedDB 开发 7 条约束（损坏/迁移分离、Firebase 优先、单一权威源、真实浏览器测试等）。

## 本轮完成：StorageAdapter v1（用户已通过 5 项人工浏览器验收）

- 新增 `lib/storage-adapter.ts`：定义 `LifeRecordStorage` 统一存储接口（load / create / update / remove / isLocalDataCorrupted / exportBackup / restoreBackup，全 Promise），并提供 `createLocalStorageAdapter()` 工厂。
- `lib/life-record-store.ts` 重写为双适配器路由：未登录 → localStorage 适配器（数据安全机制原样保留），已登录 → Firestore 适配器（云行为逐行保留，集合 `life_entries` 不变）。
- `app/page.tsx` 仅替换调用点，UI 与行为不变；页面不再直接操作 localStorage，备份/恢复也走统一接口。
- 数据安全 v1 全部机制保持：无 500 条截断、损坏 JSON 拒写并保留原始数据、容量不足明确报错、JSON 备份 v1 格式兼容（旧备份可导入）。
- 新增 `tests/storage-adapter.test.mjs`（10 项）；生活模块 28 项测试全部通过；`npx tsc --noEmit` 与定向 ESLint 0 问题。
- **用户已通过 5 项人工浏览器验收**：记录、数据展示/刷新保留、编辑/删除、导出、恢复。
- 附带修复：本地适配器惰性初始化，避免模块顶层访问 `localStorage` 的 SSR 风险。

## 当前状态与已知问题

- **localStorage 数据尚未迁移**：真实记录仍保存在 `localStorage["life-tracker:life-records:demo:v1"]`；IndexedDB 迁移仅完成方案设计（见 NEXT_STEPS.md），未实施。
- **IndexedDB Adapter v1 尚未接入正式页面**：当前仅通过显式工厂调用和独立测试启用；Adapter 和真实浏览器验收已完成，下一阶段才是 localStorage → IndexedDB 安全迁移。
- **备份缺失或空 ID 的处理需在迁移前确认**：当前恢复会为缺失/空 ID 生成新 ID；这不会覆盖已有记录，但会改变记录身份。迁移设计需决定拒绝还是显式修复，并记录审计结果。
- **Firebase 云端 create 不返回文档 ID**：`firebaseAdapter.create` 经 batch 写入后返回的记录 id 为空串（与重构前行为一致，页面随后重载掩盖了此问题）；接口语义问题待解决。
- **生产构建待验证**：开发服务器占用 `.next` 时构建出现 `EPERM`；本轮没有关闭开发服务器，不能把生产构建写成通过。

## 本轮完成：本地数据安全 v1（用户已人工浏览器验收）

- 修复 `lib/life-demo-store.ts` 超过 500 条记录静默截断（删除 `.slice(0, 500)`）；浏览器存储空间不足时抛出明确错误，写入失败不影响原有记录。
- 修复损坏 JSON 被静默当作空库、随后被覆盖的问题：损坏原始字符串原样保留，所有写入（增/改/删）在损坏状态下被拒绝并给出明确提示；`app/page.tsx` 检测到损坏数据时在页面顶部提示。
- 「我的」页新增「备份与恢复」：JSON 导出全部生活记录（含 schema/version/exportedAt；损坏数据以 `corruptedRaw` 字段一并保全）与从备份恢复（写入前逐条校验，失败不落盘）。
- 测试 `tests/life-demo-store.test.mjs` 从 2 项扩充到 8 项；生活模块 18 项测试全部通过，`npx tsc --noEmit` 与生活记录模块定向 ESLint 0 问题。
- **用户已通过浏览器实际验证**记录功能、备份与恢复入口及正常行为不受影响。
- 排查并解决一次"验收看不到新 UI"的问题：当时 3000 端口运行的是 10-20 的旧 `next start` 生产构建；已切换为 `next dev` 开发模式。

## 开发环境（当前）

- 实际项目与应用根目录：`life-tracker/`（本文件所在目录）。
- 当前使用 Next.js 开发模式 `next dev`，访问地址固定 `http://127.0.0.1:3000/`。
- **开发与功能验收期间不要使用旧的 `next start` 生产构建进程**；它不监听源码变化，会造成"代码已改、页面未变"的假象。

## 本轮完成：审查、保护与验证

- 确认现有 life-tracker 原仓库、开发分支、38 个原始提交及 LifeOS 参考副本。
- 读取配置、首页、数据存储、解析/分析/图片接口、原有 API、Firestore 规则、许可证、依赖及测试。
- 扫描当前源码与本地可达 Git 历史，未发现所检模式匹配的硬编码密钥。
- 现有 12 项测试通过；构建完成后 TypeScript、生活记录模块 lint 通过。
- 正常权限执行 `npx next build --webpack` 成功，58/58 静态生成任务完成；生产服务在 `127.0.0.1:3000` 正常运行。
- 浏览器验证：中文首页、演示四类解析、草稿修改/取消、分类筛选、刷新保留原有 9 条记录、390×844 首页布局。控制台未观察到 warn/error。
- 只在内存中复现 500 条截断及损坏 JSON 后保存的风险，没有写入用户记录。
- 创建两份审查报告、项目规则和下一步建议；补充 `.gitignore` 对 `.env` / `.env.*` 的防误提交保护，仍允许 `.env.example`。
- 本地代码检查点使用标签 `checkpoint/local-audit-2026-10-20` 定位；完整提交号由 `git rev-parse checkpoint/local-audit-2026-10-20^{commit}` 查询。无推送、无公开部署。

## 已有实现

| 模块 | 实际状态 |
| --- | --- |
| 中文生活记录首页 | 记录 / 数据 / 我的三个栏目；单一发送入口、规则识别记录或分析 |
| 六类记录 | 运动、睡眠、学习、饮食、消费、心情；结构化校验、手动补充 |
| 保存前确认 | 逐件预览、可选修改、移除、取消、确认保存；本轮浏览器只测草稿，不写用户数据 |
| 存储与历史 | 本地 localStorage CRUD；Firebase `life_entries` 适配已写，未做真实云验收 |
| 仪表盘 | SVG 圆环在上、统计数字在下，按已保存记录计算；圆环显示近 7 天记录覆盖 |
| 分析 | 滚动 7/30/365 天统计与前期比较；服务端真实 AI 调用路径存在，但未配置/实测 |
| 图片 | 饮食识别后端和结果校验存在；前端附件入口未完成，不能从页面上传 |
| 原项目功能 | 原习惯、任务、目标、专注、健康、日记、时间管理等页面/API 保留；未全部接入新首页或重新验收 |

## 尚未完成或未通过

- 独立分类记录页面、iOS 风格页面过渡、年月日历追溯未实现；当前只是同页滚动筛选。
- 图片前端上传/预览未完成；真实 AI 文本、图片和分析未测试。
- Firebase 真实登录、持久化、授权规则、跨设备恢复未测试。
- ~~本地记录超限丢失、损坏数据保护、备份/恢复~~ 已于 2026-10-21 修复并通过验收；多人/多标签页并发问题仍未修复。
- 全项目 lint：87 errors、73 warnings；新增生活记录模块定向检查为 0。
- npm 在线漏洞审计失败（ECONNRESET），尚无可信完整漏洞清单。
- 公开服务鉴权、正式隐私政策及开源合规尚未具备。

## 工作边界

本轮没有开发新功能、修改业务数据、升级依赖或更改原许可证。此前尚未提交的功能代码完整纳入本地代码检查点，包括未完成的图片接入。后续工作等待用户指令。

## 真实 ChatGPT 接入验收缺陷修复（2026-10-23，开发完成，等待集中验收）

用户在真实 ChatGPT 套餐模式中发现并报告心情遗漏、模糊心情被推断评分、重复提交、桌面滚动遮挡、图片内部 ID 展示和来源标记不一致。本轮在现有智能输入、附件与 ChatGPT Provider 上完成修复，未重写存储、迁移、Firebase 或日历。

- 心情候选：服务端提示词明确要求保留无评分心情；模型响应解析不再因为 `score` 缺失丢弃候选；预览显示「未提供评分 · 待补充」，缺字段条目不阻塞其他完整记录。只有用户明确写出「心情3分」等数字时才保留 1–5 整数评分。
- 防重复：来源指纹改用日期、用户确认分类和规范化原文片段；偏移量与每次变化的 `messageId` 不作为身份。部分保存后只保留缺字段及疑似重复候选；用户可在同一卡片明确选择「仍作为新事件保存」。
- 附件归属：保存结果返回原始候选索引和 `attachmentSaved`；部分保存后图片目标随原卡片重映射，目标重复或全批重复时保留待保存图片，不擅自改挂到第一条新记录。
- 滚动：记录内容区显示可拖动细滚动条，保留鼠标、触控板和触摸滚动，固定输入区与正文分离，并保留安全区底部留白和「跳到保存按钮」。
- 图片展示：新增用户向 `PendingImageReview`，显示缩略图、友好文件名、归属选择、取消入口；内部 attachment ID、SHA-256 不进入普通 UI。
- 来源标记：`origin=ai` 只有在服务端返回可信 `provider=chatgpt/openrouter` 时才显示「真实模型」；规则与降级分别标记「本地规则解析」和「本地规则补回」，不按授权状态冒充 AI。
- 自动化：`npm run test:life` 347/347 通过；`npx tsc --noEmit`、定向 ESLint、`git diff --check` 均通过。敏感模式扫描 15 个本轮核心文件，命中 0。
- 隔离浏览器：使用 3012 端口、合成记录和演示规则模式验证六类候选、无评分心情、部分保存、重复提交、强制新事件、刷新持久化、日历/统计/历史联动、桌面 1366×768、1280×720 与手机 390×844 滚动和布局；控制台无 error/warning。
- 真实模型边界：用户此前已用真实 ChatGPT 发起调用并发现上述缺陷；本轮没有再次消耗真实模型额度，也没有把规则演示结果称为真实 AI 验收。真实图片浏览器上传尚未完成：Edge/Chrome 自动化扩展均因未启用「Allow access to file URLs」无法注入合成图片；附件保存、关联、备份恢复和内部 ID 不展示由自动化测试覆盖，最终文件选择 UI 仍待人工验收。
- 本轮未读取、修改、迁移或删除真实生活记录；正式 localStorage、IndexedDB、Firebase、迁移状态机和备份文件未改动。未 commit、tag 或 push。
## 本轮补充修正：迁移缺陷修复与浏览器失败场景（2026-10-22，仍未提交）

在上一版未提交代码基础上修正三个真实缺陷，并补齐浏览器失败场景；不改动 Adapter 与迁移引擎的核心路径。

- `lib/life-record-store.ts`：本地读取路由原先缓存适配器，另一个标签页启用 IndexedDB 后，本标签页仍可能继续读旧 localStorage。现改为每次读取重新确认持久化状态；状态读取失败时明确报错并停止，不再静默回退 localStorage，避免形成两个写入源。
- `lib/life-migration-state.ts`：`normalizeMigrationState()` 原会把 `SUCCEEDED + activeStore=localStorage` 视为已启用，导致页面误判已迁移且无法安全重试。现标记为 `FAILED` 并给出 `INVALID_ACTIVE_STORE`。
- `lib/life-migration-service.ts`：`READY_TO_SWITCH` 状态下点击「重新校验」原先会调用要求目标为空的迁移导入而必然失败。现改为只读比对来源与目标完整指纹；任一侧变化即保留现场并标记失败，不覆盖、不删除目标数据。
- `lib/life-migration-routing.ts` 新增 `hasIndexedDBSupport()`：环境不支持 IndexedDB 时按能力判断为 localStorage 权威源，而不是一律报错；IndexedDB 存在但读取失败仍然报错，不猜状态。
- `app/dev/migration-test/page.tsx` 新增：IndexedDB 写入失败注入、回读失败注入、JSON 备份导出与恢复、两个真实标签页锁测试（子标签页通过 `ifAvailable` 探测并回传结果）。
- 测试：新增 3 项状态断言与 2 项路由能力断言；`npm run test:life` 176/176 通过；`npx tsc --noEmit` 退出码 0；定向 ESLint 0 errors / 0 warnings；`git diff --check` 退出码 0。
- Edge 隔离浏览器实测：完整迁移测试 26/26 通过（含写入失败、回读失败、JSON 备份导出与恢复）；两个真实标签页不能同时取得迁移锁通过；刷新后状态 `SUCCEEDED`、target=2。调试期间出现过 2 处 TypeScript `never` 收窄错误和 2 条对应控制台 error（时间戳 06:17），修复后重跑无 error/warning，不得把修复前记录计入最终结果。
- 正式页只读复核：「我的」显示权威源 localStorage、本地记录 5 条、迁移状态尚未升级；开发开关未开启，三个操作按钮 disabled；未迁移真实数据。
- 敏感模式扫描：19 个相关文件，命中项均为变量名或扫描说明文字，未发现真实凭据；环境中无 `.env` 或 `.env.local`。
- 仍未提交、未打标签、未推送；正式 localStorage 未迁移，正式 IndexedDB 未连接，Firebase 业务逻辑未改。

## 已完成：总日历、分类日历与 iOS 动画 v1（2026-10-22，用户已集中验收）

- 最终页面层级：数据首页保留原有六大分类统计圆环，不直接展开完整月历；通过独立「总日历 · 总记录」入口一次进入总日历，点击分类圆环直接进入对应分类日历。
- 总日历支持月份切换、按日期展示当天所有分类记录；六大分类日历只展示当前分类。所有视图共用同一份 `records` 和 `LifeRecord.date`，没有建立第二套数据源或示例数据。
- 支持总日历与分类日历之间、分类日历与数据首页之间的浏览器历史导航。最终后退顺序为：分类日历 → 总日历 → 数据首页。
- 保留 iOS 风格滑入、滑出、月份切换和日期选择动画；使用 transform/opacity，并支持 `prefers-reduced-motion`。移动端支持左右滑动切月，纵向滚动优先。
- 保留原有统计圆环、统计数字、关键词搜索、历史记录编辑和删除；日历只读取记录，不修改用户原始记录。
- 修复实现中发现的 11 月被误算为 31 天和 390px 窄屏横向溢出。390×844 验收中 `scrollWidth`、`clientWidth`、`bodyScrollWidth` 均为 390。
- 自动化验证：日历专项 26/26、全量 `npm run test:life` 202/202；`npx tsc --noEmit`、定向 ESLint 和 `git diff --check` 均通过。
- Edge/Chrome 隔离页面验证：首页不显示月历、一次进入总日历、当天全部记录、六个分类日历、搜索、编辑、删除、刷新持久化、浏览器前进/后退和手机布局均通过；控制台无 error/warning。浏览器验收使用合成数据，不读取或修改正式用户生活记录。
- 用户已完成两轮集中人工验收并确认最终布局。阶段检查点名称为 `checkpoint/life-calendar-ios-v1`；提交 SHA 由 Git 直接核验，不在文档中重复预写。
- 未修改 LifeRecord 字段、`sourceText`、ID、`createdAt`、自然语言解析、日期校验、localStorage/Firebase 路由、数据库迁移或 JSON Backup v1 语义；未引入新的权威存储。

---

## 本轮追加：多意图自动识别与批量确认优化（开发完成，等待用户集中验收）

**尚未提交 Git、尚未建立标签、尚未推送。** 上一轮已完成智能输入、原文纠错与图片上传识别 v1；本轮在其之上优化识别与确认体验。

### 1. 新增逐句多意图解析器 `lib/life-intent-parse.ts`

原 `parseDemoLifeText()` 每类只做一次整段 `text.match()`，无法在一句话里产出多个分类，中文数字也不支持。新增解析器：

- 先用 `splitSourceSentences()` 按标点切句，保留指向原始字符串的偏移量，再**逐句独立解析**，所以一句可产多个分类、一消息可产多句。
- 支持中文数字（`一/两/二/三…十/半`）与阿拉伯数字混用。
- `MONEY_SPLIT` 正则把「花了28块」这类金额子句从食物描述中切开，饮食与消费同句可分别成立。
- 学习支持「对象 + 时长」和「时长 + 对象」两种语序：`学习英语45分钟`、`学了两个小时英语`、`看书一小时`、`背单词30分钟`、`复习数学两个小时` 都能识别。
- 运动支持力量数据（重量 + 组数）、有氧时长、纯距离（`跑了5公里`）三种形态；纯距离只标记待补充时长，不猜测数字。
- 只提到分类但没有数字时（`昨晚没睡好`、`学了英语`、`买了杯咖啡`、`去健身房练了腿`）给出一条 `needsFields` 候选，提示补字段，**不丢弃整句话也不编造数值**。
- 同消息已有完整训练数据时，`早上去健身房练胸` 不再额外生成第二条运动候选；同消息重复同一事实也只保留一条。
- 每条候选自动带 `sourceRef`（messageId + span + `origin: 'ai'`），刷新后仍可回溯到原话。

服务端 `lib/life-parse-server.ts` 的 demo 分支改为调用新解析器；`messageId` 由 `app/api/life-records/chat/route.ts` 从请求体透传，页面生成的 UUID 与候选引用保持一致。

### 2. 批量确认与防重复

- 候选一次性进入预览区，底部按钮为「确认并保存全部 N 条」，不需要逐条点「加入待确认记录」。
- 预览区顶部提示哪些条目缺字段；缺字段的条目显示「待补充：… 这一条不会阻塞其他记录」。
- `lib/life-record-duplicates.ts` 的 `sourceFragmentFingerprint` 用 `date + type + span + 原文` 作为身份，同句饮食与消费不会互相误去重；连续点击、刷新后重提交都不会产生副本。
- 预览卡片上原文片段的标签从「AI 推测」改为「规则推测」，与当前 demo 模式一致。

### 3. 图片附件归属

原 `saveRecordsWithAttachments()` 会把图片关联到**所有**候选记录。现新增 `attachmentTargetIndex`：

- `null` 表示尚未决定归属，确认保存时跳过图片、只保存文字记录；
- 数字则只把图片关联到该下标的候选；
- 不传该参数时保持旧行为（第一条），既有调用方不受影响。

预览区中「待保存图片」下方列出每条候选的按钮，未选择时明确提示「还没有选择图片归属。确认保存时会跳过这张图片」。

### 4. 修复的手机端遮挡

`app/page.tsx` 记录页底部原本只留 `pb-48`，390×844 手机视口下固定输入框会遮住「确认并保存全部」按钮，导致点击落在输入框上、静默失败。改为 `pb-[20rem] sm:pb-40`。

### 5. 测试

| 检查 | 结果 |
| --- | --- |
| `npm run test:life` | 259/259 通过 |
| 新增 `tests/life-intent-parse.test.mjs` | 18/18 通过 |
| `tests/life-attachment-service.test.mjs` | 11/11 通过（新增 4 项图片归属） |
| `tests/life-record-duplicates.test.mjs` | 13/13 通过（新增 3 项批量保存） |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint | 0 errors / 0 warnings |
| `git diff --check` | 通过，仅有 LF/CRLF 提示 |

### 6. 隔离浏览器验证（隔离副本，合成数据）

- 隔离预览地址：`http://127.0.0.1:3006/`
- 桌面视口：一句话同时识别睡眠、运动、饮食、消费、学习、心情共 6 条；修改单条组数 4→5 后一键保存；刷新后 6 条全部保留，修改值持久化。
- 重复提交同一句话：提示「这些原文片段已经保存过，没有重复写入。」，总数仍为 6 条。
- 手机视口 390×844：`scrollWidth=390`、`clientWidth=390`，无横向溢出；识别含学习的 5 条并保存成功；刷新后仍为 5 条；编辑备注与删除记录均正常。
- 控制台无 error / warning（`tab.dev.logs` 过滤 error、warning 后为空）。

### 7. 未验证 / 已知限制

- **真实 AI 模式未测试**：本机未设置 `OPENROUTER_API_KEY`，规则演示解析通过，但不能当作真实 AI 验收。
- **真实视觉模型未接入、未测试**：本机未设置 `OPENROUTER_API_KEY` 与 `OPENROUTER_VISION_MODEL`；图片上传、预览、取消、附件保存与备份恢复已在自动化测试中验证，浏览器端图片选择交互尚未人工点击验证。
- 生产构建仍未验证（`.next` EPERM 环境问题，按要求未处理）。
- 沙箱 headless Chrome/Edge 无法创建 IndexedDB backing store，因此本轮浏览器验证仅覆盖页面渲染、解析卡片、持久化与交互，未覆盖 IndexedDB 写入路径。

## v0.1 个人版最终收尾（2026-10-23，用户已完成人工验收）

### 1. 用户人工验收结论

用户已亲自确认：

- ChatGPT 官方重新授权成功，最新环境可使用真实 ChatGPT 模型。
- 「今天感觉有点烦躁，可能是因为工作太多了，不过下午出去散步以后舒服了不少。」被正确识别为心情，而不是运动。
- 自动保存、首页历史记录管理等此前开发的功能已通过隔离测试。

### 2. 本阶段解决的问题

**OAuth 403 复发根因**：上次成功调用时，代理配置只存在于临时 PowerShell 进程中，没有形成项目启动脚本；切换或重启 Next.js 后新进程未继承 `NODE_USE_ENV_PROXY`、`HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`，Node.js 服务端直连出口与 Edge 浏览器出口不一致，导致授权码交换返回 `unsupported_country_region_territory`。

**稳定启动方式**：新增 [start-dev.ps1](start-dev.ps1)。脚本在 Node.js 启动前设置进程级代理，只影响该进程树，不修改 Windows 全局代理、注册表或其他 Node 项目。脚本会先检查本地代理端口，再用无凭据请求检查 OpenAI 官方 API 网络路径，只有返回预期的 HTTP 401 才启动 Next.js；遇到地区 403 或网络失败时直接停止，避免用户在错误出口下完成授权。

**局限记录**：脚本中的 `127.0.0.1:10808` 是本机授权代理入口，不是产品通用配置。换机器或换网络环境时需要按本机实际授权代理调整，或改用环境变量方式配置。

### 3. 授权客户端身份稳定性

只读核查确认：安装标识 `ext_agent_host_id` 保持稳定的 `urn:uuid:<UUIDv4>` 格式，未因切换预览端口重新生成；代码继续优先复用官方签发并保存的正式 `client_id`；OAuth 回调严格使用 `http://127.0.0.1:<动态端口>/auth/callback`。

### 4. 过期授权状态显示修正

此前过期凭据可能被显示成「AI 模式 / 可用」。现在过期授权明确显示为未配置，界面提示需要重新授权，不会把不可用的凭据说成真实 AI 可用。

### 5. 测试结果

| 检查 | 结果 |
| --- | --- |
| 全量自动化测试（串行） | 374/374 通过，0 failed |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint | 0 errors / 0 warnings |
| `git diff --check` | 通过，仅有 LF/CRLF 提示 |
| 凭据模式扫描 | 仅变量名、文档注释、正则校验和脱敏逻辑，无真实密钥 |

### 6. 尚未验证

- 生产构建仍未验证（`.next` EPERM 环境问题，按要求未处理）。
