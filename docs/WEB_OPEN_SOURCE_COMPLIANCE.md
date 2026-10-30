# AI-LifeOS 网页版开源合规整改记录

任务：003-C
日期：2026-10-26
分支：`feature/ren-sheng-shu-ju-cang-v1`
HEAD：`c9cb724ddd30d1cb6674f1d9794f4c45316b8721`

依据文档：`OPEN_SOURCE_AUDIT.md`、`SOURCE_PROVENANCE_MATRIX.md`、
`COMMERCIAL_LICENSE_PLAN.md`、`docs/AI_SERVICE_BOUNDARY.md`。

## 1. 结论摘要

| 项目 | 状态 |
| --- | --- |
| AGPL-3.0 许可证全文与版权声明 | 保留，未修改（`LICENSE`，35184 B） |
| README 上游来源与致谢 | 已完成 |
| 界面内「开源与致谢」 | 已完成（「我的」页） |
| Life OS MIT 通知 | 保留并提供界面查看 |
| 第三方许可证清单 | 已补齐索引（`docs/third-party-notices/INVENTORY.md`） |
| 未使用的四候选仓库 | 未列为依赖 |
| `TERMS_OF_USE.md` | 原样保留，歧义已登记 |
| 运行版本对应源码提供 | **未完成，正式上线阻断项** |
| 记录、保存、AI 调用、数据处理逻辑 | 未改动 |

本任务的定位是**披露与准备**，不是完成 AGPL 履行。当前仍未建立公开源码托管地址，
因此不得对外宣称已经满足 AGPL-3.0 第 13 条。

## 2. 已完成的整改

### 2.1 许可证与上游来源

- LifeTracker：<https://github.com/ashishworkacc/life-tracker>，AGPL-3.0。
- 上游基线提交：`1273bd9fb8005d10b03d5fedb9bdd66aee771844`。
- 根目录 `LICENSE` 为 GNU AGPL v3 全文，本任务未修改、未删除其任何条款。
- 未删除、未替换任何上游版权声明。

### 2.2 README

在「本机自述」之后新增「开源来源与致谢」章节，内容包括：

- 明确 AI-LifeOS 是基于 LifeTracker 二次开发的独立项目。
- 上方原文链接、许可证类型、上游基线提交。
- 与原作者无隶属关系和官方背书。
- Life OS 仅作为 UI 设计参考，适用 MIT 通知及存放路径。
- 明确四个候选仓库未被使用。
- 明确源码提供义务尚未完成。

上游原有说明部分完整保留，未删改。

### 2.3 界面作者致谢

新增 `components/life-records/OpenSourceNotice.tsx`，挂载于「03 / 我的」页底部
（`app/page.tsx` 第 10 行 import，第 1078 行渲染）。区块内容：

- 感谢项目 LifeTracker 及其上游贡献者。
- 链接原仓库，标注 GNU AGPL v3.0。
- 明示 AI-LifeOS 为独立二次开发项目，不隶属、未获官方认可或授权背书。
- 列出 Life OS（MIT）作为设计参考，并在可展开区域提供 MIT 全文。
- 提供本版本对应源码入口的位置；地址为空时只显示"尚未建立"，不渲染占位链接。

组件为纯展示组件，无 hooks、无网络请求、无存储访问，不影响首页记录体验。

### 2.4 第三方许可证清单

新增 `docs/third-party-notices/INVENTORY.md`，覆盖：

- 源码级开源项目（LifeTracker、Life OS）。
- 15 个 npm 直接依赖的许可证与义务。
- 传递依赖中需特别履行的许可证（LGPL、MPL、CC-BY、BSD 等）。
- UI、图标、字体、素材。
- 通知原文存放位置。
- 尚未补齐的内容。

该文件是索引与摘要，逐项证据仍以 `OPEN_SOURCE_AUDIT.md` 第 14–15 节为准。

### 2.5 未使用项目的排除

以下四个仓库曾被讨论但**未实际使用**，本轮明确不写入依赖与致谢清单：

- `gunnar0022/lifeboard`
- `sushil766/life-os`
- `lunanoir21/Life-os-project`
- `edrisranjbar/lifeos`

LifeBoard 的 LICENSE（MIT）与 README 再分发描述的冲突，已在
`OPEN_SOURCE_AUDIT.md` 第 21.2 节登记；因未使用，不构成本项目当前义务。

### 2.6 TERMS_OF_USE

`TERMS_OF_USE.md` 原样保留，未删改任何条款。其第 2 节标题 `Non-Commercial Use`
与正文关于满足 AGPL 源码共享要求的商业产品、以及 significant functional transformation
的表述之间存在解释冲突，已登记为需向权利人澄清的问题。

在获得书面澄清前，本项目不得依据该文件自行推定可以进行商业发布。

## 3. Corresponding Source（对应源代码）准备

### 3.1 必须提供的范围

依据 `COMMERCIAL_LICENSE_PLAN.md` 第 15.1 节，与当前 HEAD 对比上游基线：

`app`、`components`、`lib` 范围共 50 个文件变动（新增 9775 行、删除 169 行），
其中 4 个文件修改、46 个新增；扩大到全树为 111 个文件变动。

对应源代码至少包括：

1. 上游 109 个文件的全部内容，含未修改部分。
2. 对上游文件的修改：`app/page.tsx`、`app/globals.css`、`app/layout.tsx`、
   `app/(auth)/signup/page.tsx`。
3. 本项目新增的 47 个源文件（`lib/life-*.ts`、`lib/ai/chatgpt-plan-*.ts`、
   `lib/storage-adapter.ts`、`lib/indexeddb-adapter.ts`、`app/api/life-records/**`、
   `components/life-records/**` 及相关测试）。
4. 构建与运行所需配置（见 3.2）。

### 3.2 构建脚本与配置模板

| 文件 | 说明 |
| --- | --- |
| `package.json` | 依赖与脚本 |
| `package-lock.json` | 锁定版本，用于可重复构建 |
| `next.config.ts` | Next.js 构建配置 |
| `tsconfig.json` | TypeScript 配置 |
| `postcss.config.mjs` | 样式构建配置 |
| `eslint.config.mjs` | 静态检查配置 |
| `.env.example` | 环境变量名模板，仅含变量名 |
| `proxy.ts` / `middleware.ts` | **必须在发布版本前决定保留哪一个**（见 3.6） |
| `public/manifest.json`、`public/llms.txt` | 运行时静态资源 |

### 3.3 不得公开的内容

| 内容 | 位置 | 原因 |
| --- | --- | --- |
| 真实生活记录 | 浏览器 localStorage / IndexedDB | 用户隐私，从不属于源代码 |
| OAuth 凭据 | `%USERPROFILE%\.config\ai-lifeos\` | 访问令牌，DPAPI 保护 |
| 实际环境变量值 | `.env.local` | 含 API Key、服务账号 |
| 备份文件 | 用户导出 JSON/ZIP | 用户数据 |
| 构建产物 | `.next`、`.next-model-test-prod-audit/` | 非源代码，可重新生成 |
| 依赖目录 | `node_modules` | 按各自许可证分发 |
| 误生成文件 | `$null`、`tools-build-stage/`、`dev-3000.*.log` | 非源码、可能含本机信息 |

源码发布前必须用显式文件清单打包，不得直接压缩工作目录。

### 3.4 独立服务与 AGPL 修改版的区分

`lib/ai/chatgpt-plan-*.ts` 与 `lib/ai/local-request-security.ts` 五个模块的技术边界
已由 `tests/ai-service-boundary.test.mjs` 与 `docs/AI_SERVICE_BOUNDARY.md` 固定：
这五个模块不直接或间接 import `life-*` 等 AGPL 来源模块，不依赖第三方运行时包。

**这仅是技术前提，不是法律结论。** 本轮未据此把这些模块排除在对应源代码范围之外。
是否构成独立作品，需要法律专业确认，见第 7 节。

### 3.5 用户显著访问源码的方案

设计：在「我的」页「开源与致谢」区块内，紧邻 AGPL-3.0 许可证信息处，
提供「下载当前运行版本对应源码」链接，指向与该构建提交一致的发布页或源码包。

实现状态：

- `OpenSourceNotice.tsx` 已定义 `CORRESPONDING_SOURCE_URL` 常量。
- 当前值为 `null`，页面只显示"尚未建立"，不渲染任何链接。
- 填入真实地址后立即生效，无需改动其他代码。

**当前状态：未完成。** 在填入真实地址并通过人工核对前，不得公开上线。

### 3.6 阻断项：`middleware.ts` 与 `proxy.ts`

工作区中 `middleware.ts` 显示为删除（`D`），同时存在未跟踪的 `proxy.ts`。
发布版本必须明确：是计划内的 Next.js 16 迁移，还是未完成的改动。
在澄清之前，对应源代码的构建配置清单不完整。

## 4. 正式上线前阻断检查清单

- [ ] 建立与发布版本一致的源码公开托管地址，并填入 `CORRESPONDING_SOURCE_URL`。
- [ ] 源码包包含上游 109 个文件、全部修改与新增、构建脚本与配置。
- [ ] 源码包不含 `.env.local`、凭据、备份、真实记录、`node_modules`、`.next`。
- [ ] 明确 `middleware.ts` / `proxy.ts` 的最终归属（见 3.6）。
- [ ] 生成当前锁文件对应的完整 SBOM。
- [ ] 汇总各依赖 `LICENSE` / `NOTICE` 原文进发布产物。
- [ ] 确认 `public/*.svg` 与 `screenshot.*` 的逐文件授权。
- [ ] 就 `TERMS_OF_USE.md` 第 2 节歧义取得权利人书面澄清。
- [ ] 就 AI 模块是否构成独立作品取得法律意见。
- [ ] 用户可见入口可访问、可点击、链接有效（自动化或人工验证）。

在全部勾选完成前，产品只能作为本地或受限测试环境使用。

## 5. 本次改动文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `components/life-records/OpenSourceNotice.tsx` | 新增 | 界面对应致谢区块 |
| `app/page.tsx` | 修改（2 行） | import 与「我的」页渲染 |
| `README.md` | 修改（新增 1 章节） | 开源来源与致谢 |
| `docs/third-party-notices/INVENTORY.md` | 新增 | 第三方许可证清单 |
| `docs/WEB_OPEN_SOURCE_COMPLIANCE.md` | 新增 | 本文件 |

未修改：`LICENSE`、`TERMS_OF_USE.md`、`lib/ai/**`、任何 API 路由、任何存储实现。

## 6. 验证记录

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全量测试 | `node --test --test-concurrency=1 "tests/*.test.mjs"` | 424 / 424 通过，0 失败、0 跳过，约 30.5 s |
| 类型检查 | `.node_modules\.bin\tsc.cmd --noEmit` | 退出码 0 |
| 定向 ESLint | `.node_modules\.bin\eslint.cmd app/page.tsx components/life-records/OpenSourceNotice.tsx` | 退出码 0，无告警 |
| 空白检查 | `git diff --check` | 见第 8 节 |

串行执行测试是本机既有要求：并发运行 `npm run test:life` 曾触发 Node 24 资源错误
（`spawn UNKNOWN`、堆内存不足），与代码缺陷无关。

## 7. 需要法律确认的事项

1. `TERMS_OF_USE.md` 第 2 节 `Non-Commercial Use` 与 AGPL 商用能力的冲突。
2. AI 模块虽与 AGPL 应用技术解耦，是否构成独立作品。
3. 通过 HTTP API 通信是否足以构成程序边界。
4. 微信小程序移植模块作为独立分发物的履行方式。
5. `public/screenshot.*` 内含品牌、标志、人物时的素材权利。

## 8. 本次未做的事

- 未建立公开仓库、未上传源码包、未生成 `SOURCE_URL`。
- 未修改任何业务逻辑、AI 调用、存储或迁移代码。
- 未安装依赖、未使用会自动下载包的 `npx`。
- 未提交 Git、未打标签、未推送、未部署。
- 未读取或输出真实生活记录、OAuth 凭据、API Key。
- 未触碰 `$null`、`tools-build-stage/`、`.next-model-test-prod-audit/`。
- 未执行任务 003-D。
