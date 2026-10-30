# AI-LifeOS 文件来源对照表（SOURCE_PROVENANCE_MATRIX）

> 生成日期：2026-10-26。任务：001-B 全部开源代码来源复核。
> 上游基线：`1273bd9fb8005d10b03d5fedb9bdd66aee771844`（life-tracker 共同祖先）。
> 当前 HEAD：`c9cb724ddd30d1cb6674f1d9794f4c45316b8721`，分支 `feature/ren-sheng-shu-ju-cang-v1`。
> 本文只做来源登记，不修改任何业务文件。

## 分类定义

| 类别 | 含义 |
| --- | --- |
| A | 直接复制第三方代码 |
| B | 修改、移植第三方代码 |
| C | 仅参考功能、界面设计或实现思路 |
| D | 自主实现，未发现第三方复制证据 |
| E | 来源不明，需补充核实 |

## 一、网页版：上游 AGPL 派生（类别 A/B）

判定依据：`git diff --numstat 1273bd9 HEAD -- app components lib`，共 50 个文件变动，新增 9775 行、删除 169 行；其中 3 个文件被修改，47 个文件为新增，0 个删除。

上游基线树共 109 个文件。以下文件在上游基线中已存在，属于 AGPL-3.0 衍生代码：

| 文件 | 类别 | 证据 | 许可证 |
| --- | --- | --- | --- |
| `app/layout.tsx` | A/B | 上游基线存在，8 增 13 删 | AGPL-3.0 |
| `app/page.tsx` | A/B | 上游基线存在，1057 增 5 删 | AGPL-3.0 |
| `app/globals.css` | A/B | 上游基线存在，129 增 0 删 | AGPL-3.0 |
| `app/(auth)/signup/page.tsx` | A/B | 上游基线存在，4 增 151 删 | AGPL-3.0 |
| `app/(app)/` 其余 28 个页面 | A | 上游基线存在，diff 为 0 增 0 删，原样保留 | AGPL-3.0 |
| `app/api/ai/` 12 个路由 | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `app/api/telegram/` 6 个路由 | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `app/api/health/` 2 个路由 | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `lib/ai/client.ts` | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `lib/ai/prompts.ts` | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `lib/ai/rateLimit.ts` | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `lib/firebase/` 4 个文件 | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `lib/hooks/` 3 个文件 | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `lib/xp.ts` | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `components/command-center/QuickAddDrawer.tsx` | A | 上游基线存在，原样保留 | AGPL-3.0 |
| `components/layout/` 7 个组件 | A | 上游基线存在，原样保留 | AGPL-3.0 |

注：上游基线中不含 `middleware.ts`，当前工作区为删除状态，属此前阶段改动，本轮未改动。

## 二、网页版：本项目新增（类别 D，与 AGPL 代码结合分发）

以下文件不在上游基线中，为本项目从零编写。它们与上游代码在同一 Next.js 应用中结合分发，因此整体仍按 AGPL 处理；表中「自主性」仅表示未发现复制第三方代码：

| 文件 | 类别 | 自主性说明 |
| --- | --- | --- |
| `lib/life-records.ts` | D | 自主定义六大分类、规范化、摘要 |
| `lib/life-intent-parse.ts` | D | 自主实现规则解析与片段定位 |
| `lib/life-parse-server.ts` | D | 自主实现服务端解析入口 |
| `lib/life-source-fragments.ts` | D | 自主实现原文分句与片段定位 |
| `lib/life-chat.ts` | D | 自主实现意图识别与统计事实 |
| `lib/life-search.ts` | D | 自主实现关键词搜索 |
| `lib/life-calendar.ts` | D | 自主实现月份网格与聚合 |
| `lib/life-record-duplicates.ts` | D | 自主实现去重指纹 |
| `lib/life-auto-save.ts` | D | 自主实现自动保存批次 |
| `lib/life-review-selection.ts` | D | 自主实现候选选择 |
| `lib/life-record-source.ts` | D | 自主实现来源标记 |
| `lib/storage-adapter.ts` | D | 自主实现存储抽象 |
| `lib/life-demo-store.ts` | D | 自主实现本地存储与备份格式 |
| `lib/indexeddb-adapter.ts` | D | 自主实现 IndexedDB 适配器 |
| `lib/life-attachments.ts` | D | 自主实现附件引用与备份 |
| `lib/life-attachment-display.ts` | D | 自主实现附件展示辅助 |
| `lib/life-attachment-service.ts` | D | 自主实现附件恢复 |
| `lib/life-record-bulk-delete.ts` | D | 自主实现批量删除 |
| `lib/life-migration-state.ts` | D | 自主实现迁移状态机 |
| `lib/life-migration-routing.ts` | D | 自主实现迁移路由与写保护 |
| `lib/life-migration-validation.ts` | D | 自主实现迁移前校验 |
| `lib/life-migration-engine.ts` | D | 自主实现迁移与回读校验 |
| `lib/life-migration-service.ts` | D | 自主实现迁移编排 |
| `lib/ai/chatgpt-plan-oauth.ts` | D | 自主实现 OAuth、PKCE、JWKS |
| `lib/ai/chatgpt-plan-credentials.ts` | D | 自主实现 DPAPI 凭据保护 |
| `lib/ai/chatgpt-plan-responses.ts` | D | 自主实现 Responses API 调用 |
| `lib/ai/chatgpt-plan-provider.ts` | D | 自主实现 Provider 状态与降级 |
| `lib/ai/local-request-security.ts` | D | 自主实现本机请求校验 |
| `lib/lan-access.ts` | D | 自主实现局域网访问码 |
| `lib/tokenhub-model-test.ts`、`lib/tokenhub-model-test-shared.ts` | D | 自主实现 TokenHub 测试接入，未提交 |
| `app/api/life-records/chat/route.ts` | D | 自主实现聊天 API，同时 import 上游 `lib/ai/client` 与自研 Provider |
| `app/api/life-records/parse/route.ts` | D | 自主实现解析 API |
| `app/api/life-records/image/route.ts` | D | 自主实现图片 API，import 上游 `lib/ai/client` |
| `app/api/life-records/chatgpt-plan/route.ts` 与 `authorize/route.ts` | D | 自主实现授权状态接口 |
| `app/api/model-test/chat/route.ts` | D | 自主实现模型测试接口，未提交 |
| `app/model-test/page.tsx` 与 `model-test.module.css` | D | 自主实现测试页面，未提交 |
| `app/dev/migration-test/page.tsx` | D | 自主实现迁移测试页，545 行新增 |
| `components/life-records/` 10 个组件 | D | 自主实现生活记录界面，见 2.1 节 |
| `tests/` 各测试文件 | D | 自主实现测试，使用合成数据 |

### 2.1 CapsuleDashboard 的 LifeOS 参考（类别 C）

`components/life-records/CapsuleDashboard.tsx` 第 9 行有明确注释：

> Circular SVG progress follows the focus timer in karim-coder/life-os (MIT) and the original LifeTracker command center. The ring measures days logged, not a goal.

已核实的复用点：`radius = 43`、`circumference = 2 * Math.PI * radius`、`strokeDasharray`、`strokeDashoffset`、`-rotate-90` 这套 SVG 圆环数学。这是通用几何计算，不是可保护的表达；本项目自行实现了 `RecordRing` 组件、颜色体系、交互和文案。

结论：类别 C，参考实现思路，圆环公式属通用技术方案。项目已保留通知文件 `docs/third-party-notices/life-os-MIT.txt`。

未发现导入 LifeOS 的 Prisma、Zustand、Radix、Framer Motion 或其页面组件。

## 三、网页版：来源待核实（类别 E）

| 文件 | 类别 | 原因 |
| --- | --- | --- |
| `public/screenshot.jpg`（189989 B） | E | 由上游提交 `1273bd9` 引入，未核实图中素材、字体、图标与商标授权 |
| `public/screenshot.png`（1598077 B） | E | 同上 |
| `public/file.svg`、`globe.svg`、`next.svg`、`vercel.svg`、`window.svg` | E | 来自 Create Next App 初始模板，随上游引入；Vercel SVG 可能涉及品牌标志 |
| `public/manifest.json` | D | 本项目 PWA 配置 |
| `public/llms.txt` | E | 需确认生成方式与内容来源 |

## 四、微信小程序：五个 AGPL 来源模块（类别 B）

小程序工程位置：AI-LifeOS 同级目录的 `ai-lifeos-miniprogram`。

逐文件比对结果，SHA-256 均不同，行数有差异，说明经过改写而非原样复制：

| 小程序文件 | 网页版来源 | 小程序行数 | 网页行数 | 哈希相同 | 类别 |
| --- | --- | --- | --- | --- | --- |
| `miniprogram/shared/life-records.ts` | `lib/life-records.ts` | 442 | 395 | 否 | B |
| `miniprogram/shared/life-calendar.ts` | `lib/life-calendar.ts` | 108 | 158 | 否 | B |
| `miniprogram/shared/life-record-duplicates.ts` | `lib/life-record-duplicates.ts` | 51 | 66 | 否 | B |
| `miniprogram/shared/life-auto-save.ts` | `lib/life-auto-save.ts` | 41 | 76 | 否 | B |
| `miniprogram/shared/life-search.ts` | `lib/life-search.ts` | 22 | 44 | 否 | B |

同源证据：六分类枚举与标签、`normalizeLifeRecord` 规范化流程、搜索规范化与匹配、日历月份天数与闰年、周一起始网格、重复指纹算法、自动保存批次整理逻辑均一致，差异来自微信环境删减与 API 替换。

判定：属于对 AGPL 代码的修改移植，类别 B，不是独立实现。小程序当前没有 LICENSE 文件，也没有 AGPL 文本或源码获取说明。

## 五、小程序：自主实现（类别 D）

| 文件 | 类别 | 说明 |
| --- | --- | --- |
| `miniprogram/shared/wechat-storage-adapter.ts` | D | 自主实现微信存储适配器 |
| `miniprogram/shared/life-ai-gateway.ts` | D | 自主实现 AI 网关接口，类型引用 `life-records.ts` |
| `miniprogram/utils/store.ts` | D | 自主实现页面存储封装 |
| `miniprogram/pages/record/index.*` | D | 自主实现记录页 |
| `miniprogram/pages/history/index.*` | D | 自主实现历史页 |
| `miniprogram/pages/data/index.*` | D | 自主实现数据页 |
| `miniprogram/app.ts`、`app.json`、`app.wxss`、`sitemap.json` | D | 微信小程序脚手架生成 |
| `miniprogram/types/wechat.d.ts` | D | 微信 API 类型声明 |
| `tests/shared-core.test.mjs` | D | 自主测试 |

素材核查：按扩展名统计，小程序工程只有 `.ts`、`.json`、`.wxss`、`.wxml`、`.md`、`.mjs`，没有 `.png`、`.jpg`、`.svg`、`.woff` 等图片或字体文件，未发现第三方素材。

## 六、四个候选 GitHub 仓库的核查结论

| 仓库 | HEAD（核查时） | 主要语言 | 许可证 | 技术栈 | 是否使用 |
| --- | --- | --- | --- | --- | --- |
| `gunnar0022/lifeboard` | `ce2f51fc`（2026-07-03） | Python | LICENSE 为 MIT；README 第 294 行写 Personal project. Not currently licensed for redistribution. | Python 后端 + DnD 代理 | 否 |
| `sushil766/life-os` | `29ebdef3`（2026-05-12） | 配置文件集合 | 未发现 LICENSE 文件 | Claude agents 配置与流程文档 | 否 |
| `lunanoir21/Life-os-project` | `c82946e0`（2026-10-11） | Rust | MIT，Copyright (c) 2025 Life OS Contributors | Rust 后端 + Prisma | 否 |
| `edrisranjbar/lifeos` | `7db27fa0`（API 查询，未完成克隆） | JavaScript | MIT | 自托管 life OS，含 MCP server | 否 |

核查方法：

- 对四个仓库执行浅克隆或 GitHub API 只读查询，记录 HEAD、提交时间、LICENSE 与文件构成。
- 在网页版和小程序全库检索 `lifeboard`、`gunnar`、`sushil`、`lunanoir`、`edrisranjbar` 等关键词，命中仅出现在 `OPEN_SOURCE_AUDIT.md` 自身的记录文字中，业务代码零命中。
- 技术栈比对：四个仓库分别为 Python、配置文件集合、Rust、JavaScript，与网页版 Next.js/TypeScript 和小程序 TypeScript 无可对位的同源文件。

### 6.1 LifeBoard 的许可证冲突（需记录）

已证实冲突：

- `LICENSE` 文件为标准 MIT，Copyright (c) 2026 Gunnar Anderson。
- `README.md` 第 292 至 294 行 `## License` 一节写的是 Personal project. Not currently licensed for redistribution.

提交时间核查：浅克隆为 `--depth 1`，`git log -- LICENSE` 与 `git log --diff-filter=A -- LICENSE` 均只返回最新提交 `ce2f51f`（2026-07-03），因此无法从当前克隆确定 LICENSE 的首次引入时间，需完整历史才能确认。

影响判断：本项目没有使用 LifeBoard 的任何代码，该冲突不影响 AI-LifeOS 的授权状态。仅作为候选来源登记，避免未来误用。

## 七、npm 依赖与其他第三方权利

### 7.1 直接依赖（19 个）

| 包 | 用途 |
| --- | --- |
| `next@16.1.6`、`react@19.2.3`、`react-dom@19.2.3` | 框架 |
| `@ducanh2912/next-pwa@^10.2.6` | PWA 支持 |
| `firebase@^12.10.0`、`firebase-admin@^13.7.0` | 认证与数据库 |
| `openai@^6.29.0` | OpenAI SDK |
| `recharts@^3.8.0` | 图表 |
| `date-fns@^4.1.0` | 日期处理 |
| `xlsx@^0.18.5`、`jszip@^3.10.1` | 表格与压缩 |
| `@types/jszip`、`@types/xlsx`、`@types/node`、`@types/react`、`@types/react-dom` | 类型定义 |
| `tailwindcss@^4`、`@tailwindcss/postcss@^4` | 样式 |
| `eslint@^9`、`eslint-config-next@16.1.6`、`typescript@^5.9.3`、`fake-indexeddb@^6.2.6` | 开发工具 |

`jszip` 为 `MIT OR GPL-3.0-or-later`，可选择 MIT 分支。

### 7.2 传递依赖许可证分布（来自锁文件统计）

680 MIT、124 Apache-2.0、50 ISC、21 BSD-3-Clause、15 BSD-2-Clause、13 MPL-2.0、10 LGPL-3.0-or-later、3 Apache-2.0 AND LGPL-3.0-or-later、1 Apache-2.0 AND LGPL-3.0-or-later AND MIT、1 CC-BY-4.0、1 `MIT OR GPL-3.0-or-later`、1 `BSD-3-Clause OR GPL-2.0`。

需重点关注：`@img/sharp-libvips-*`（LGPL-3.0-or-later）、`@img/sharp-win32-*`（Apache-2.0 AND LGPL-3.0-or-later）、`lightningcss` 及平台包（MPL-2.0）、`axe-core`（MPL-2.0）、`caniuse-lite`（CC-BY-4.0）、`node-forge`（BSD-3-Clause OR GPL-2.0）。

详细许可证分析见 `OPEN_SOURCE_AUDIT.md` 第 14 节，本文不重复。

### 7.3 权利类型区分

| 类型 | 内容 | 处理方式 |
| --- | --- | --- |
| 软件许可证 | MIT、Apache-2.0、ISC、BSD、MPL、LGPL、AGPL | 按各自义务保留声明与源码 |
| 素材授权 | 截图、SVG、图标、字体 | 需单独核实，见第三节 |
| 商标与品牌 | Vercel、Next.js、Firebase、微信等标志 | 不得暗示官方认可 |
| 服务条款 | OpenAI、Firebase、腾讯云、微信平台 | 与许可证无关，单独合规 |

## 八、覆盖率与限制

已覆盖：

- 网页版 `app`、`components`、`lib` 全量源码，以 Git 树清单为准，未递归扫描 `node_modules`。
- 小程序全量源码，34 个文件，按扩展名统计。
- `public` 目录 8 个文件清单。
- `package.json` 19 个直接依赖与锁文件许可证统计。
- 六个候选 GitHub 仓库的 HEAD、许可证、技术栈与关键词检索。
- Git 上游基线与当前 HEAD 的逐文件 diff。

未覆盖：

- `node_modules` 内每个包的 LICENSE 原文未逐份打开核对，采用锁文件元数据统计。
- `tools-build-stage/`、`.next-model-test-prod-audit/`、`.next` 未扫描。
- 未使用自动化代码相似度工具做跨仓库逐行比对；判断基于 Git diff、导入关系、文件结构和技术栈差异。
- LifeBoard 的完整 Git 历史未拉取，LICENSE 首次引入时间未确认。
- `edrisranjbar/lifeos` 未完成完整克隆，仅通过 GitHub API 与 `ls-remote` 获取元数据。
- 截图与 SVG 的逐文件素材授权未核实。

本文只做来源登记，未修改任何业务文件、未安装依赖、未提交 Git。
