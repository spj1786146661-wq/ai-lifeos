# AI人生数据库 — 项目协作规则

## 统一规则地位与启动顺序

- 本文件是 AI-LifeOS 所有 AI 模型和执行器的**唯一权威总规则**。Codex、DeepSeek、GLM、MiniMax、OpenCode、Magpie 路由组及后续执行器都以此为准。
- 不为不同模型维护互相冲突的 `CLAUDE.md`、Copilot 指令或其他总规则副本。执行器如需专用配置，只能引用本文件并说明差异，不能复制后各自演进。
- Codex 原生读取 `AGENTS.md`。OpenCode 官方规则说明其项目级 `AGENTS.md` 会被自动加载；本机 OpenCode Desktop 随附 CLI 存在，但 CLI 不在 PATH，且尚未完成实际加载验证。无法确认会自动加载的执行器，必须在启动提示中显式要求读取本文件。
- 每次运行开始前，必须依次读取：
  1. `AGENTS.md`；
  2. `docs/AI_HANDOFF.md`；
  3. `docs/PROJECT_STATUS.md`；
  4. `tasks/queue.json` 中本任务记录；
  5. 本任务最近一次及尚需延续的历史日志（`logs/ai-runs/<task-id>/`）；
  6. 当前分支、HEAD、`git status --short --branch` 和未提交 diff。
- 只依据实际代码、测试、Git 记录和运行日志判断进度。README、旧总结、模型记忆或任务描述与现状冲突时，先记录冲突并以可复现证据为准。
- 新模型接手时先检查未提交代码，不得用回退、重置、清理或覆盖来“恢复干净状态”。当前工作区若有他人未提交改动，必须保留并在交接中说明。
- 每次只处理一个已分配任务。领取任务前确认其状态、执行次数和有效 claim；不得同时开发多个任务或擅自扩展验收范围。
- 任务开始、结束、失败、超时或中断前，必须按 `logs/ai-runs/README.md` 保存独立运行日志，并尽可能更新 `docs/AI_HANDOFF.md`、`docs/PROJECT_STATUS.md` 和任务队列。额度耗尽、工具失效或上下文不足时，优先保存进度后停止，等待下一执行器接手。
- 当用户明确要求“完全只读”时，只允许读取和检查，不得创建或修改日志、队列、交接、状态或任何其他项目文件；可以在对话中输出临时审查报告，但必须明确说明没有生成持久化日志、没有更新队列。该例外仅适用于只读审查，不适用于用户已授权的检查点或开发任务。
- 不得伪造测试结果、文件操作、模型身份、供应商、提交或 Git 状态。无法确认的事实必须写“未知”并说明验证边界。
- 发现本文件与已有项目规范、执行器配置或许可证声明冲突时，先向用户报告；不得自行覆盖或把一种解释写成既定事实。

## 项目真源与范围

- 这是已有项目。应用根目录为本文件所在的 `life-tracker/`，不要在工作区另建替代应用。
- 原始主项目：<https://github.com/ashishworkacc/life-tracker>，保留其 Git 历史、LICENSE、TERMS_OF_USE.md、版权及原有页面。
- `../.reference-life-os/` 是 <https://github.com/karim-coder/life-os> 的参考副本；不是当前运行入口，不要在其中开发或删除内容。
- 产品名：**AI人生数据库**；签名：**AI记录人生，AI改变人生**。
- 优先复用已有组件、Firebase 封装、AI 客户端和数据模型。未经用户确认，不重建、不大规模重构、不删除原页面。
- 本阶段只供本机单用户测试；不开发支付、公开注册、APP、小程序或复杂智能体，不公开部署或自动推送仓库。
- `NEXT_STEPS.md` 和任务队列中的后续任务只是计划，不是执行授权；每次只执行用户已明确分配、且队列中可领取的任务。

## 数据与密钥

- 不覆盖、清空、删除、迁移或批量修改真实用户数据。自动化测试默认使用内存、模拟存储、`fake-indexeddb` 和合成输入；真实浏览器或云验收必须由用户明确授权并说明写入范围。
- 当前正式路由：未登录使用 `localStorage["life-tracker:life-records:demo:v1"]`；Firebase 登录用户使用 Firestore `life_entries`。二者没有自动迁移，正式页面尚未接入 IndexedDB。
- `lib/indexeddb-adapter.ts` 已完成并仅通过显式工厂调用和独立测试启用。导入适配器不得自动创建或写入正式数据库。正式 localStorage → IndexedDB 迁移尚未开始，必须等待明确授权。
- 任何存储迁移必须具备独立备份、完整校验、明确状态机、失败回滚和单一权威写入源；不得自动删除旧数据，不得让两个存储同时接收正式写入。
- Git 检查点只保护代码，不备份浏览器/云数据。不要把真实记录、数据库导出、截图中的私人数据纳入 Git。
- OpenRouter、Telegram、Admin 私钥等只放服务端环境变量；不能使用 `NEXT_PUBLIC_` 暴露秘密，不能在日志、截图、文档中输出密钥。
- Firebase Web 配置是客户端标识，不等于数据库权限；权限必须由认证和服务端/Firestore 规则控制。
- 无密钥必须明确显示演示模式。规则、模拟模型输出或内存存储测试不得称为真实 AI 或真实云数据库验收。
- 不读取、输出或记录 API Key、Token、Cookie、密码、服务账号私钥、私人生活记录或其他敏感信息。日志只记录变量名、检查结果和脱敏后的错误。
- 只读安全审查可以读取必要的文件元数据和最小匹配片段来判断是否包含敏感信息，但不得输出正文、凭据、个人生活记录或可还原的私人数据。报告只保留文件路径、类型、大小、哈希、命中数量和不含秘密的分类结论。
- 不自动购买服务、安装新软件、升级依赖或产生费用；涉及这些事项先取得用户确认。

## Git 与开源

- 开始前检查分支和未提交改动，保留已有工作；不执行 `reset --hard`、`clean -fd`、强制推送或删除历史。
- 未经用户明确授权，不执行破坏性命令、删除文件、`git reset`、`git clean`、提交、合并主分支、建立标签、推送远程或部署。
- 当前开发分支以 `git status --short --branch` 为准，不得把本文中的历史分支名当作永久事实。提交时使用明确文件清单，先审查暂存区中的秘密和用户数据。
- 不同执行器并行开发时，优先使用独立 Git Worktree 或独立分支。不得直接覆盖他人未提交代码；合并前先审查双方 diff 和任务 claim。
- 许可证事实与来源见 OPEN_SOURCE_AUDIT.md。发现风险先记录，不擅自删除、替换来源代码或更改许可证。
- LifeOS MIT 通知位于 `docs/third-party-notices/life-os-MIT.txt`；MIT 参考代码不能把整个 AGPL 派生项目改为 MIT。

## 任务领取、并发与防覆盖

- `tasks/queue.json` 是任务状态记录，当前以文件级 revision 和 `claim` 字段表达领取意图。同一任务同一时刻只能有一个有效 claim。
- 每次执行必须有全局唯一运行 ID；运行 ID 同时写入任务 claim、运行日志和最终交接摘要。运行 ID 至少包含本地时间、时区和随机标识，避免两个模型重复。
- `claim` 为 `null` 或包含以下字段的对象；字段定义只描述协议，不代表执行器已经强制校验：

  ```json
  {
    "claimToken": "全局唯一随机值",
    "runId": "唯一运行 ID",
    "executorId": "执行器实例标识",
    "provider": "可确认的供应商或 unknown",
    "modelId": "可确认的精确模型或 unknown",
    "claimedAt": "ISO 8601 时间",
    "heartbeatAt": "ISO 8601 时间",
    "leaseExpiresAt": "ISO 8601 时间",
    "fencingRevision": 1
  }
  ```

- claim 必须在领取时同时记录 `claimToken`、`runId`、`executorId`、供应商、精确模型标识（无法确认则写 `unknown`）、领取时间、最后 heartbeat、lease 到期时间和 `fencingRevision`。heartbeat 只能由持有相同 `claimToken` 的执行器更新；lease 过期不等于任务完成，新执行器接手前仍须检查未提交代码、旧 Worktree 和最后日志。
- 任务状态变化必须增加任务 `revision`，并把 `claim.fencingRevision` 与本次 revision 关联。持有旧 `claimToken` 或旧 `fencingRevision` 的进程失去写入资格；后续 SQLite 控制面应使用事务和 `BEGIN IMMEDIATE` 强制执行，当前 JSON 文件没有这种保证。
- `lastResult` 必须是对象或 `null`，建议字段包括：`status`、`runId`、`finishedAt`、`exitCode`、`tests`、`summary`、`reportPath`、`errorCode` 和 `retryable`。无法取得的信息写 `null`，不得伪造退出码或测试结果。
- 队列更新必须采用乐观并发控制：读取 queue revision 和任务 revision → 校验状态、claim token 与 lease → 写入新 revision → 再次校验。条件不满足时停止，不得盲目覆盖。写入应先写同目录临时文件、校验 JSON，再原子替换；当前协议尚未提供自动实现。
- 当前只定义并发协议，尚未实现文件锁、原子 compare-and-swap 脚本或自动 lease 回收；在自动化执行器落地前，这些约束只能靠模型遵守和人工审查，不能称为执行器级互斥。
- 新执行器发现有效 claim、revision 不一致、来源不明的未提交文件或交接摘要与 Git 不一致时，应停止领取并报告，不得抢占。

## 执行边界与验证

- 不推倒重写已有功能，不超出已分配任务的验收条件，不顺手修改无关业务、系统配置、登录配置、Magpie 路由或用户其他项目。
- 修改代码必须运行与该模块直接相关的测试；涉及共享接口、数据模型或存储时还必须运行回归测试。测试失败、检查未完成或结果不确定时，不得报告“任务完成”。
- 分别报告：代码已存在、自动化测试通过、真实浏览器验证、真实 AI/云验证、尚未验证。模拟数据、规则解析、Mock、`fake-indexeddb` 不能替代真实 AI、真实 Firebase 或真实浏览器验收。
- 不并发运行会争用 `.next` 的任务。生产构建验证应使用独立工作目录或隔离 Worktree，不能破坏正在运行的开发服务器。

## 跨平台长期开发原则

以下原则约束未来所有客户端的实现方式，本轮只作为规范记录，不据此重写现有项目。

- 当前继续使用 Next.js 网页技术栈，不为提前支持 APP 或小程序而重写或替换现有项目。
- 核心业务逻辑与 UI 分离，尽量沉淀为可复用的 TypeScript 模块，避免把业务规则写在页面组件里。
- 存储层只通过 StorageAdapter 抽象访问，核心业务逻辑不得直接绑定 IndexedDB、localStorage 或任何具体存储实现。
- 未来不同客户端可分别接入 IndexedDB、SQLite 或小程序兼容的存储实现，替换时不得改动核心业务逻辑。
- AI 调用只能经过服务端接口，客户端不得持有或暴露 API Key；无密钥时明确进入演示模式。
- 不同平台不会天然共享本地数据，跨设备能力必须单独设计备份、导入或同步方案，不能假设本地库自动互通。
- 新增模块应避免不必要的平台耦合，不提前引入只在单一平台成立的假设。
- 按完整开发阶段连续实施并自动测试，阶段结束后再集中人工验收；不得把阶段拆成无意义的小步骤反复请求确认。

## 验证与运行

在应用根目录执行：

```powershell
npm run test:life
npx tsc --noEmit
npx eslint app/page.tsx app/api/life-records components/life-records lib/life-*.ts
npm run lint
npx next build --webpack
npm run start -- --hostname 127.0.0.1
```

- 开发命令：`npm run dev -- --hostname 127.0.0.1`。运行地址固定使用 <http://127.0.0.1:3000/>；换成 localhost 或其他端口会切换浏览器数据空间。
- 当前开发/验收环境使用 `next dev` 开发模式。旧的 `next start` 生产构建进程不监听源码变化，开发期间不要用它做功能验收（2026-10-21 曾因此导致新 UI"不可见"的误判）。
- 不并发运行 build、dev 或修改 `.next` 的任务；类型检查在构建结束后执行，避免生成类型文件竞争。
- 历史上正常权限下 Webpack 构建曾成功；当前开发服务器占用 `.next` 时，生产构建出现 `EPERM`，因此**当前生产构建仍是发布前待验证事项**。不要把历史构建成功写成当前构建通过，也不要把受限环境错误直接归因于应用代码。
- 每个实际开发模块完成后运行相关测试。全项目 lint 仍有原有问题，不能把局部检查通过写成全项目通过。
- 分别报告：源代码已存在、自动化测试通过、浏览器实际验证、尚未验证。尤其不要把图片后端代码称为已完成图片上传。
- 维护 `PROJECT_AUDIT.md`、`OPEN_SOURCE_AUDIT.md`、`PROGRESS.md`、`NEXT_STEPS.md`、`docs/PROJECT_STATUS.md`、`docs/AI_HANDOFF.md`、`tasks/queue.json` 和独立运行日志；保留日期、验证边界和剩余问题。
