# AI人生数据库 — 项目审查

审查日期：2026-10-20（Asia/Shanghai）。范围：现有代码、运行验证、数据保护、Git 检查点；没有新增产品功能或重构。

## 1. 结论

**现有项目可以在本机正常构建并以演示模式运行，但尚不适合公开服务或承载没有备份的长期记录。**

- 已通过：12 项现有测试、构建结束后的 TypeScript 检查、生活记录模块定向 lint、正常权限下 Webpack 生产构建、首页及演示接口检查。
- 未通过：全项目 lint（87 errors、73 warnings）；受限环境下默认 Turbopack 构建。
- 未完成验证：真实 AI、图片识别、Firebase 云读写/权限、全部原项目功能。当前没有对应服务配置。
- 关键风险：本地记录超 500 条会静默截断；没有生活记录备份/恢复；损坏 JSON 后继续保存可能覆盖原值。
- 代码扫描未发现匹配的硬编码密钥；npm 在线漏洞审计因连接失败未完成，不能声明“依赖无漏洞”。

## 2. 目录、Git、环境

| 项目 | 实测情况 |
| --- | --- |
| 工作区 | AI-LifeOS 本地项目目录 |
| 当前应用 | `life-tracker/`，独立 Git 仓库；不是工作区根目录的另一个新 App |
| 参考副本 | `.reference-life-os/`，独立 Git 仓库，审查时工作树干净 |
| 开发分支 | `feature/ren-sheng-shu-ju-cang-v1` |
| 审查前 HEAD | `1273bd9fb8005d10b03d5fedb9bdd66aee771844`，2026-03-26 |
| 原始历史 | 38 个本地可达提交，保留 |
| 审查前状态 | 109 个已跟踪文件中 9 个修改、100 个未变；另有 14 个未跟踪源码/测试/通知文件，无原页面删除 |
| Git / Node / npm | 2.53.0.windows.3 / v24.20.0 / 11.19.0 |
| 锁文件 | `package-lock.json`，相对原 HEAD 未修改；本轮没有安装/升级依赖 |
| 项目身份 | package name `life-tracker`，version `0.1.0`，private=true；页面品牌为 AI人生数据库 |

审查前已修改文件：`.env.example`、`README.md`、`app/(auth)/signup/page.tsx`、`app/globals.css`、`app/layout.tsx`、`app/page.tsx`、`package.json`、`public/manifest.json`、`tsconfig.json`。新增生活记录 API、组件、5 个 `lib/life-*.ts`、测试和 LifeOS 许可证通知均属于此前工作。

本轮仅新增审查/规则/进度文档及验证证据，并补充 `.gitignore` 的 `.env`、`.env.*` 保护；未改变业务源码和数据。根 `LICENSE`、`TERMS_OF_USE.md` 和原版权均保留。

## 3. 技术栈与运行方式

| 层 | 实际依赖 |
| --- | --- |
| 前端/服务端 | Next.js 16.1.6 App Router，React / React DOM 19.2.3 |
| 类型/样式 | TypeScript 5.9.3，Tailwind CSS 4.2.1 |
| 存储/认证 | Firebase 12.10.0，firebase-admin 13.7.0；无配置时 localStorage |
| 模型客户端 | openai 6.29.0，原有客户端连接 OpenRouter |
| 图表 | Recharts 3.8.0 保留于原页面；新圆环为 SVG，没有直接使用 Recharts |
| 其他 | date-fns 4.1.0、xlsx 0.18.5、jszip 3.10.1、next-pwa 10.2.6 |
| 测试 | Node 内置 `node:test`，现有 3 个测试文件、12 个测试 |

当前访问地址：**<http://127.0.0.1:3000/>**，生产进程仅绑定回环地址。

在 `life-tracker/` 目录运行（现有依赖已安装）：

```powershell
# 本轮实际成功验证的生产构建与启动
npx next build --webpack
npm run start -- --hostname 127.0.0.1

# 原有开发启动方式
npm run dev -- --hostname 127.0.0.1

# 原有默认构建脚本
npm run build
```

不要同时启动多个占用 3000 端口的服务，也不要在服务运行时并发改写 `.next`。本轮未改系统设置、未启动公网服务。

## 4. 已有功能与真实完成度

| 功能 | 代码与行为 | 本轮证据/边界 |
| --- | --- | --- |
| 中文聊天首页 | `app/page.tsx`：三栏目、单发送框、中文提示和中英类别 | 浏览器可见，390×844 首页无横向溢出 |
| 结构化记录 | `lib/life-records.ts`：运动/睡眠/学习/饮食/消费/心情 | 单元测试通过；规则与模型输出校验分别存在 |
| 记录或分析识别 | `lib/life-chat.ts`、`api/life-records/chat` | 正则分类；不是真实模型意图识别 |
| 解析确认 | 结果逐件显示，可修改/移除/取消，确认才调用存储 | 浏览器将草稿卧推 60 改为 65 公斤后取消，未写入数据 |
| 本地存储/编辑/删除 | `lib/life-demo-store.ts` | 内存 CRUD 测试通过；真实用户记录本轮不做增删改 |
| 云存储 | `lib/life-record-store.ts` 复用原 Firebase helper，集合 `life_entries` | 实现存在；无 Firebase 配置，未验证云持久化 |
| 数据仪表盘 | `CapsuleDashboard.tsx` 按已加载记录计算圆环和统计 | 原有记录可展示，圆环为记录覆盖天数，不是健康目标达成率 |
| 历史分类 | 点圆环设置类别并同页滚动到历史 | 实际点击运动后显示该类；**不是独立页面，也没有日历** |
| 周/月/年分析 | 滚动 7/30/365 天及上一等长区间统计；可走服务端 AI | 演示接口通过；真实 AI 未测试 |
| 图片 | image API 支持 JPEG/PNG/WebP ≤5MB、饮食草稿与可选热量问答 | **前端没有 file input/附件按钮**；仅有未接通状态和发送分支 |
| 我的 | 访客/测试账号、存储与隐私说明 | 个人资料、模型设置仍待开发；不是正式隐私政策 |
| 原项目页面 | habits/todos/goals/focus/health/journal/time-ledger/trackers/AI/Telegram 等源码保留 | 生产路由编译通过；依赖外部服务的行为未完整验收 |

新 `life_entries` 与原习惯、睡眠、食物等集合没有自动互通。原项目的 `/life-os` 页面本身来自 LifeTracker，不能据其名称判断为 karim-coder/LifeOS 的完整集成。

## 5. 配置与敏感信息

### 当前检查结果

- 项目根目录只有 `.env.example`，没有 `.env.local` 或其他实际环境文件。
- 当前执行环境中的 OpenRouter key/vision model、Firebase Web project/key/Admin、Telegram bot key 均未设置；运行时 GET `/api/life-records/parse` 返回 `{"mode":"demo"}`。
- 扫描审查开始时的 123 个非忽略文件清单中的相关文本文件：私钥头、常见服务 Token、硬编码 credential 赋值模式均未发现匹配。
- 扫描本地 38 个可达提交、242 个唯一 blob 中的相关文本：未发现强密钥模式匹配。未审计远程不可达历史、忽略目录、二进制中的任意编码秘密；不是专业秘密检测工具的完整保证。
- `.env.example` 的 Firebase sender/app ID 为示例占位内容，不能作为真实配置证明。
- AI 客户端使用服务端 `process.env.OPENROUTER_API_KEY`，未发现 `NEXT_PUBLIC_OPENROUTER_API_KEY` 或客户端直接持有模型密钥。浏览器 warn/error 日志为空。
- 审查前 ignore 只覆盖 `.env.local`/`.env.*.local`；本轮增加 `.env`/`.env.*`，验证 `.env.production` 被忽略，`.env.example` 仍可跟踪。

### 必需与可选配置

| 使用方式 | 需要项 | 当前状态 |
| --- | --- | --- |
| 本地规则演示 | 无外部密钥 | 可运行 |
| 真实文字解析/分析 | `OPENROUTER_API_KEY`；`OPENROUTER_DEFAULT_MODEL` 有默认值，需核实模型可用及费用 | 未配置、未测试 |
| 真实图片识别 | 上述 key + `OPENROUTER_VISION_MODEL` | 未配置，示例环境文件也尚未说明 vision 变量 |
| Firebase 云记录/登录 | Firebase Web app 配置，Auth 测试用户及 Firestore/规则；代码先检查 projectId/key | 未配置、未测试 |
| 原有 Admin/Telegram | `FIREBASE_SERVICE_ACCOUNT`，bot token/webhook secret；定时任务 `CRON_SECRET` 等按原功能配置 | 新首页演示不需要，未测试 |
| 通知/PWA等 | VAPID、推送权限及相关服务设置 | 未验证完整行为 |

本轮没有填写虚假密钥、购买服务、调用收费模型或改动现有用户账号。

## 6. 数据存储与丢失风险

### 本地模式

- 数据在浏览器 `localStorage["life-tracker:life-records:demo:v1"]`，不是服务器磁盘数据库。
- 刷新通常保留：本轮在浏览器只读看到原有 **9 条**，刷新后仍为 **9 条**。本轮未确认保存测试草稿、未编辑或删除既有记录。
- 清理“站点数据”、浏览器配置文件或隐私模式结束会丢失；仅清理缓存文件不一定清理 localStorage，需要区分。
- `127.0.0.1` 与 `localhost`、不同端口/协议/浏览器分别存储；切换地址可能看起来为空，不能立即覆盖。
- **P1：500 条截断。** `lib/life-demo-store.ts` 保存调用 `.slice(0, 500)`。在内存以 500 条加 1 条复现：剩 500 条，旧末条被丢弃。
- **P1：损坏数据被当空库。** 读取失败静默返回 `[]`；在内存以损坏 JSON 后保存复现：原字符串被新的一条记录替代。数组内元素也缺少读时校验。
- 没有新生活记录的导出/导入/版本迁移/自动备份，多标签页整数组写入可能覆盖并发更新。
- 未保存预览及聊天历史仅在 React 状态中，刷新丢失；不是已保存记录丢失。

### Firebase 模式

- 认证后 `life_entries` 存储在 Firestore，浏览器缓存清理一般不会删除云端记录，但需重新登录且依赖配置/规则。
- 本地模式与云端无自动迁移，切换 Firebase 后不会自动显示原本 localStorage 数据。
- 实际云项目、部署的规则、备份、保留策略和数据量均无法确认；本轮无云端写入。
- **Git 检查点不包含任何浏览器或云数据备份。**

## 7. 运行与测试结果

| 检查 | 结果 |
| --- | --- |
| `npm run test:life` | 12/12 通过；规则解析、模型输出校验、统计、学习/饮食、内存 CRUD、分析窗口 |
| `npx tsc --noEmit` | 构建结束后独立运行退出 0 |
| 定向 ESLint | `app/page.tsx app/api/life-records components/life-records lib/life-*.ts` 退出 0 |
| 全项目 ESLint | 87 errors / 73 warnings，均位于相对原 HEAD 未改的源码文件；不是全项目通过 |
| 默认 `npm run build` | 受限环境 Turbopack CSS worker 子进程连接错误，退出 1 |
| `npx next build --webpack` | 受限环境先遇 `.next` mkdir EPERM；正常权限重试编译、类型检查、58/58 静态生成和 build traces 全通过 |
| 生产启动 | `npm run start -- --hostname 127.0.0.1` Ready，页面可访问 |
| 模式/解析接口 | 200，明确 demo；指定语句返回卧推60kg×4组、睡眠7h、消费38CNY、心情4/5 |
| 无效请求 | 非法日期、空文字均 400 |
| 周/月/年演示统计 | 200，7/30/365 天；使用合成输入，未写数据库，也不是真实 AI |
| 未配置图片接口 | 503，明确缺 key/model，未上传真实图片、未调用 AI |
| 浏览器 | 中文显示、草稿修改取消、分类筛选、刷新保留、手机首页通过；观察期间 warn/error 0 |
| npm 依赖漏洞查询 | 受限及正常权限尝试均未拿到完整结果；正常权限错误 ECONNRESET |
| 真实 AI/Firebase/图片 | **未测试**，缺配置；不能用演示测试替代 |

初次 TypeScript 与 build 并行检查出现 `.next/types` 文件不存在（TS6053）；这是本轮检查顺序引入的竞争，已改为构建完成后串行重跑并通过。没有因此修改 tsconfig 或删除用户数据。

已有警告：Next 的 middleware 文件约定弃用；Node 测试识别 TS 模块时提示 `MODULE_TYPELESS_PACKAGE_JSON`。本轮未为清警告而改写原项目。

证据：

- [自动化测试输出](docs/audit-2026-10-20/tests.txt)
- [ESLint 完整诊断](docs/audit-2026-10-20/eslint.json)
- [接口响应（仅合成数据）](docs/audit-2026-10-20/http-smoke.json)
- [内存数据风险复现](docs/audit-2026-10-20/storage-risk.json)
- [构建/启动输出摘录](docs/audit-2026-10-20/run-results.txt)
- [演示解析截图](docs/audit-2026-10-20/demo-preview.jpg)、[手机首页截图](docs/audit-2026-10-20/mobile-home.jpg)

## 8. 问题清单

| 优先级 | 问题 | 处理建议 |
| --- | --- | --- |
| P1 | 500 条截断、损坏值覆盖、无备份 | 下一阶段先保护和恢复数据，再继续扩展功能 |
| P1（对外服务前） | 原 `/api/ai/chat` 只检查客户端 userId；apple-sync 将 userId 当 bearer；middleware 不做身份验证 | 统一服务端 ID Token 校验，不能仅凭 userId 判权限 |
| P1（对外服务前） | 新接口 Host 白名单不是真实鉴权；分析数据由浏览器直接提交 | 绑定用户并从受权存储读取；真实部署另做安全验收 |
| P1（对外服务前） | Firestore 通用更新规则只校验旧 owner，没有约束新 owner 不变/字段结构 | 在隔离环境完善规则并验证；当前不推测云端实际可利用性 |
| P1（商业化前） | AGPL 与闭源目标不相容的可能性、上游 Terms 语义冲突 | 按 OPEN_SOURCE_AUDIT.md 核查权利和交付方式 |
| P2 | 分类页、日历、自然页面过渡、图片上传没有完成 | 复用现有列表/接口逐项补齐，不重建应用 |
| P2 | 本月/上月/今年/去年被映射为滚动窗口，正则可误判；本地统计不按问题精确过滤类别 | 明确日期语义、意图和查询范围 |
| P2 | 分析最多接受2000条、AI细节最多120条；每次发送携带全部已加载记录 | 增加规模边界、查询及分段策略；保留真实数据来源说明 |
| P2 | 新旧集合分离；聊天不持久化；没有完整端到端/云规则测试 | 先定义兼容和验收范围 |
| P2 | 全项目 lint 未通过，依赖漏洞未能完成查询 | 分模块修复并重试审计，不盲目升级 |
| P3 | 欢迎文案/本地分析尚未覆盖饮食，部分文档仍用旧品牌；环境示例缺 vision model | 小范围同步文档和文案 |

## 9. Git 保护与本轮交付

- 检查点标签：`checkpoint/local-audit-2026-10-20`，对应包含此前开发成果与本轮审查文档的本地提交。
- 原有 38 个提交、开发分支、LICENSE 和 MIT 通知保留；未改 remote、未 push、未公开仓库。
- 本机没有配置 Git 作者姓名/邮箱。检查点使用命令级 `Codex <codex@localhost>` 标识自动化提交，不伪造用户身份，不改系统/全局 Git 配置。
- 提交排除 `.env`、生成输出、依赖、数据库导出和用户历史记录；截图只包含本轮合成草稿或无记录的首页。
- 参考副本没有嵌入主仓库；其固定来源/提交及复用范围记录在 OPEN_SOURCE_AUDIT.md。
- 本轮交付：本报告、OPEN_SOURCE_AUDIT.md、AGENTS.md、PROGRESS.md、NEXT_STEPS.md 和证据文件。

下一步建议先处理数据可靠性，再做安全和构建稳定性，最后补齐日历/图片交互。本轮到此停止，等待用户下一条指令。
