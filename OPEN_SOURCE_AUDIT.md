# AI-LifeOS — 开源来源与商业授权审计

> 2026-10-26 更新：本文件保留 2026-10-20 首次审计正文作为历史证据，并在末尾追加当前网页版、微信小程序、实时锁文件和商业发行结论。两份日期不同的证据不得混为同一次扫描。

日期：2026-10-20。依据：本地 Git remote/提交、实际源码、LICENSE、TERMS_OF_USE.md、锁文件与已安装包元数据，并核对公开仓库和许可证发布方资料。本报告记录工程合规风险；具体商业发行方案需要结合交付方式确认。

## 1. 准确来源与版本

| 名称 | 确认的原始仓库 | 本地固定版本 | 许可证 | 当前作用 |
| --- | --- | --- | --- | --- |
| LifeTracker（用户所称 LifeTrack） | <https://github.com/ashishworkacc/life-tracker> | `1273bd9fb8005d10b03d5fedb9bdd66aee771844`；package 0.1.0；2026-03-26；原历史38提交 | 根 LICENSE 为 GNU AGPL v3；GitHub 标注 AGPL-3.0；另有 Terms | 当前应用主仓库 |
| Life OS | <https://github.com/karim-coder/life-os> | `052ae065dd53e603d034525b60eb14329130b8eb`；package 0.2.0；2026-08-26 | MIT；Copyright (c) 2026 Life OS | 工作区参考副本；圆环实现参考 |

固定源树：[LifeTracker 源码](https://github.com/ashishworkacc/life-tracker/tree/1273bd9fb8005d10b03d5fedb9bdd66aee771844)、[LifeOS 源码](https://github.com/karim-coder/life-os/tree/052ae065dd53e603d034525b60eb14329130b8eb)。

这里的版本号来自 package.json，不代表已确认对应同名正式 Release。没有重新 fetch/pull；不声称本地 SHA 是上游当前最新版本。没有找到另一个单独名为 LifeTrack 的来源证据，因此不猜测其他同名仓库。

此前提到的 <https://github.com/gunnar0022/lifeboard>：当前工作区没有其克隆、固定版本或可验证的复用映射，本轮不把它列作已整合代码来源，也不推测许可证。

## 2. 实际复用范围

### LifeTracker：真实主项目，不是重建的独立应用

审查开始时，原有109个跟踪文件中100个相对原HEAD未变，9个修改；另有14个新文件。原始 Git 历史和路由保留。以下可通过 `git diff 1273bd9... -- <path>` 核对：

| 当前路径 | 复用情况 |
| --- | --- |
| `lib/firebase/config.ts`、`auth.ts`、`db.ts` | 保留原 Firebase 初始化、认证、数据库 helpers；新 `lib/life-record-store.ts` 直接导入调用 |
| `lib/ai/client.ts` | 保留原 OpenRouter/OpenAI-compatible 客户端；新解析/分析使用 `aiComplete`，图片接口使用 `openrouter` |
| `app/(app)/**` | 原仪表盘、习惯、任务、目标、专注、健康、食物/睡眠等页面保留；这些文件不是本轮新增 |
| `app/api/ai/**`、`app/api/telegram/**`、`app/api/health/**` | 原接口保留；不等于新首页所有功能已接通 |
| `components/layout/**`、原 lib hooks/工具 | 保留原页面所用组件与逻辑 |
| `app/page.tsx` | 在现有 Next 根路由内修改为中文记录/数据/我的首页 |
| `app/globals.css`、`app/layout.tsx`、manifest、signup | 在原项目内调整样式、品牌及本地测试注册入口 |
| `package-lock.json` | 相对原HEAD未变；未引入 LifeOS 整套依赖 |
| `LICENSE`、`TERMS_OF_USE.md` | 原样保留 |

后续开发代码：`app/api/life-records/{parse,chat,image}/route.ts`、`components/life-records/{CapsuleDashboard,RecordFields}.tsx`、`lib/life-*.ts` 及 `tests/*.test.mjs`。这些不是上游已经实现的中文生活记录模块，必须明确标作本地新增/修改。

### LifeOS：局部参考，不是整套后台移植

可核验的参考点是 `components/life-records/CapsuleDashboard.tsx` 的来源注释和 SVG 圆环写法：

- 参考上游 [focus-view.tsx](https://github.com/karim-coder/life-os/blob/052ae065dd53e603d034525b60eb14329130b8eb/src/components/life-os/views/focus-view.tsx) 的周长计算、底环/进度环、strokeDasharray / strokeDashoffset；本地改成“近7天记录天数”。
- 本地圆环为普通 SVG + CSS 过渡；上游焦点计时器使用 `motion.circle`。未直接导入整个 LifeOS 组件。
- 参考副本有 dashboard-view.tsx、constants.ts 等，但现有新首页中没有足够证据确定逐段复制关系；不能把相近视觉样式算作完整模块复用。
- 没有把 LifeOS 的 Prisma 数据库、账户系统、Zustand store、Framer Motion、Radix 等依赖并入本项目。
- 现有 LifeTracker 自带 `app/(app)/life-os/page.tsx` 与 karim-coder/LifeOS 是不同来源，名称相同不代表复用。

已有通知 `docs/third-party-notices/life-os-MIT.txt` 保留完整 MIT 正文和版权，前面另加了来源网址。整个文件并非与上游 LICENSE 字节相同（有这一行来源说明），正文一致。

## 3. 主项目 AGPL 风险

AGPL 允许商业使用和收费；它不等于“禁止商用”。但修改版提供网络交互时，需要向相应远程用户显著提供获得该运行版本 Corresponding Source 的机会；分发时也需遵守相应源码、许可、版权及修改通知义务。不能因为只用了部分代码、改了品牌或接入 MIT 组件就假定能闭源。[AGPL 正文（OSI）](https://opensource.org/license/agpl-3.0)、[GNU 对网络源码义务的说明](https://www.gnu.org/licenses/why-affero-gpl.en.html)。

当前用途是本机单用户测试；本轮不因此自动公开 GitHub，也没有授权发布。未来是否发行源代码包、安装包或提供远程服务，需要分别确认履约方式。“向用户提供相应源码”不等同于“必须把仓库直接设为公开”；但闭源收费服务目标与本项目继承的义务可能冲突。[GNU FAQ](https://www.gnu.org/licenses/gpl-faq.en.html)。

本地 `TERMS_OF_USE.md` 第2节标题为 **Non-Commercial Use**，正文又讨论满足 AGPL 源码共享要求的商业产品，并附加“significant functional transformation”表述。该文件措辞与标准 AGPL 的商用许可边界存在需要澄清之处：

- 不能简单宣布项目绝对禁止商用，也不能忽略作者声明。
- 不能推断“改动足够大”自动免除 AGPL。
- 商业化前向权利人确认补充声明的意图及是否提供独立商业许可，必要时做具体法律审查。
- 本轮原样保留所有许可证和 Terms，没有删除或替换相关代码。

未来分发/提供网络服务还应核查显著的修改说明、源码提供入口与版权显示。当前首页没有完整开源声明/对应源码下载入口；当前本机用途不表示已经完成未来公开服务合规。

## 4. LifeOS MIT 义务

MIT 允许商用、修改和分发，要求保留版权及许可通知；现有通知文件已经保存对应全文。来源为 [MIT 标准文本](https://opensource.org/license/mit) 与本地固定版本 LICENSE。

将这部分参考代码与 AGPL 主项目组合，不会把主项目改成 MIT。LifeOS 商业化可选性只适用于其自身及具体合规组合，不能替代现有 LifeTracker 代码的授权。这里未提出替换现有系统的行动。

## 5. 直接依赖核验

证据来自已安装 package.json；不是仅凭版本范围推断。完整清单见 [dependency-licenses.json](docs/audit-2026-10-20/dependency-licenses.json)。

| 依赖 | 安装版本 | 声明许可证 |
| --- | --- | --- |
| next / eslint-config-next | 16.1.6 | MIT |
| react / react-dom | 19.2.3 | MIT |
| firebase | 12.10.0 | Apache-2.0 |
| firebase-admin | 13.7.0 | Apache-2.0 |
| openai | 6.29.0 | Apache-2.0 |
| recharts | 3.8.0 | MIT |
| date-fns | 4.1.0 | MIT |
| xlsx | 0.18.5 | Apache-2.0 |
| jszip | 3.10.1 | MIT OR GPL-3.0-or-later |
| @ducanh2912/next-pwa | 10.2.6 | MIT |
| tailwindcss / @tailwindcss/postcss | 4.2.1 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| eslint | 9.39.4 | MIT |
| @types/jszip / @types/xlsx | 3.4.0 / 0.0.35 | MIT |
| @types/node | 20.19.37 | MIT |
| @types/react / @types/react-dom | 19.2.14 / 19.2.3 | MIT |

双许可证中的 `OR` 表示可选择适用分支，不能把 jszip 单独当作强制 GPL；`AND` 则需要满足组合中的全部适用条款。这里没有更改任何包的声明。

## 6. 传递依赖与分发义务

锁文件扫描包含所有平台可选包，不等于本机安装集合，也不等于浏览器/最终发行物实际携带集合。

重点：

| 包/类别 | 锁定情况 | 需要注意 |
| --- | --- | --- |
| `@img/sharp-win32-x64` | 0.34.5，Apache-2.0 AND LGPL-3.0-or-later；本机已安装 | 不能只看 sharp 主包的 Apache 声明；分发原生库时核查 LGPL 部分 |
| sharp/libvips 其他平台包 | libvips 1.2.4，LGPL-3.0-or-later；部分 sharp wasm/windows 包为组合许可证 | 多平台锁文件条目不代表都分发，但做安装包/镜像时必须逐平台确认 |
| lightningcss 及平台包 | 1.31.1，MPL-2.0 | 通常构建链使用；是否分发取决于打包方式 |
| axe-core | 4.11.1，MPL-2.0 | 开发工具依赖与产品分发需分开清点 |
| caniuse-lite | 1.0.30001779，CC-BY-4.0 | 随工具/数据分发时核对署名要求 |
| limiter | 1.1.5，锁文件 license 缺失 | 已读取安装包 LICENSE.txt，正文为 MIT，Copyright 2011 John Hurliman |
| 根 lock 条目 | license 缺失 | 根 LICENSE 已明确 AGPL；不能把元数据缺失当作无许可证 |

MIT/BSD/ISC 等通常要求保留对应版权/许可文本。Apache-2.0 的再分发需附许可证、保留适用声明与 NOTICE，并对修改文件作说明；还包含专利条款。[Apache-2.0 正文](https://www.apache.org/licenses/LICENSE-2.0)。

MPL 是文件级 copyleft；分发所覆盖代码时需确保对应源码和通知义务，不能笼统推断整个产品都必须采用 MPL。只使用未分发的构建工具与分发相关二进制需区分。[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)。

LGPL 的组合/二进制分发还可能涉及库的相应源码、修改库的权利、重新链接/替换机制及许可通知，需结合实际原生库打包方式判断。不能简单写成“所有依赖都是 MIT，可随意闭源”。[LGPL-3.0 正文](https://opensource.org/license/lgpl-3-0)。

目前只有 LifeOS 专门通知，没有面向最终发行物的完整第三方 NOTICE/SBOM。商业化前应从实际交付产物生成清单，核对包内嵌组件及版权；本轮元数据扫描不替代该工作。

## 7. 服务条款与漏洞审计边界

- Firebase、OpenRouter、Telegram 是外部服务；开源许可证不包含这些服务额度、模型使用权或数据处理许可。
- 模型 API key 只应留在服务端；真正接入后的数据传输和保留规则需反映到隐私说明。
- npm audit 访问 `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` 返回连接重置 ECONNRESET。未得到漏洞统计；没有执行 audit fix、软件安装或版本替换。
- 本轮未做完整版权相似度扫描、商标核验或每个包的内嵌许可证审计。仓库公开可访问不代表任何使用方式都无条件合法。

## 8. 后续决策

1. 继续保留当前 Git 检查点与原许可证，先修复数据可靠性问题。
2. 若计划仅本机自用，按当前范围继续增量开发。
3. 若计划远程服务或商业发行，先决定是否接受 AGPL 相应源码提供方式，并澄清 Terms；需要其他授权时向权利人确认，不自行删码换许可。
4. 对最终交付物建立许可证/NOTICE/SBOM，重试依赖漏洞查询。

本轮只记录风险，不替换开源底座、不删除代码、不发布仓库。

---

# 2026-10-26 复核：网页版、微信小程序与商业发行

## 9. 审计范围与事实边界

本次复核依据本地 Git 历史、remote、源码、README、LICENSE、Terms、锁文件、已安装包元数据及实际文件比对。它记录工程与许可证风险，不构成法律意见。“未发现”表示本轮没有取得证据，不表示已经证明不存在。

已检查：

- 网页版 Git 历史、remote、当前分支、上游共同祖先及根许可证。
- 网页版实际源码与 LifeOS 参考副本之间的可核验复用。
- 微信小程序独立 Git 历史，以及 `miniprogram/shared/` 与网页版同名模块的差异。
- `package.json`、`package-lock.json` 和已安装直接依赖的包元数据。
- 锁文件中的 930 个包条目，包括可选平台包；没有对大型 `node_modules` 做无限制递归扫描。
- `public/` 图片、字体和 SVG；小程序源码目录中的图片和字体。
- 现有第三方通知和旧依赖审计快照。

未检查或不能由本报告证明：

- 未对 930 个包逐个执行版权相似度、内嵌二进制、NOTICE 和最终构建产物扫描。
- 未安装、升级、删除或替换依赖。
- 未访问 OpenAI、腾讯云、Firebase、微信等服务后台，不判断其服务条款或地区资格。
- 未执行 `npm audit`、生产构建或发布，不把许可证检查等同于安全漏洞审计。
- 未读取、修改、迁移或删除真实生活记录、OAuth 凭据、备份或用户数据。
- 未读取或处理 `$null`、`tools-build-stage/`、`.next-model-test-prod-audit/`。
- 未修改 Git 历史，未提交、打标签或推送。

## 10. 来源、版本与许可证

| 来源 | 仓库 URL | 固定证据 | 许可证 | 当前作用 |
| --- | --- | --- | --- | --- |
| LifeTracker | <https://github.com/ashishworkacc/life-tracker> | 本地 `origin`；共同祖先 `1273bd9fb8005d10b03d5fedb9bdd66aee771844`；该提交之后 15 个提交；当前 HEAD `c9cb724ddd30d1cb6674f1d9794f4c45316b8721` | GNU AGPL v3 | 网页版真实主仓库和派生基础 |
| Life OS | <https://github.com/karim-coder/life-os> | 参考副本 HEAD `052ae065dd53e603d034525b60eb14329130b8eb`；package 0.2.0 | MIT，`Copyright (c) 2026 Life OS` | 分类圆环的局部实现参考 |
| LifeBoard | <https://github.com/gunnar0022/lifeboard> | 未发现本地克隆、固定提交或可验证代码映射 | 未确认 | 不能认定为已使用来源 |

网页版根目录没有 `NOTICE`。`LICENSE` 是完整 AGPL-3.0 正文；README 标注 AGPL-3.0；`TERMS_OF_USE.md` 保留原有声明。以上文件当前均未删除或替换。

小程序是独立 Git 仓库，当前没有配置 remote；本地提交为 `31386892410d2b00dc84925d06f3c8c96e601f19`。其 `package.json` 没有第三方运行时依赖，但这不改变它移植网页源码所继承的许可证关系。

## 11. 实际复用证据

### 11.1 网页版：LifeTracker 派生项目

当前分支和 upstream 共享同一 Git 祖先，原始 Next.js、Firebase、页面、组件、API、依赖和许可证仍在工作树中。品牌、首页、存储、AI 和交互新增代码是在该代码库上修改，因此网页产品整体应按 AGPL 派生项目审查，不能只给新增文件单独贴 MIT 标签。

上游原有 `public/screenshot.jpg`、`public/screenshot.png` 来自提交 `1273bd9`，README 仍引用截图。该提交本身受上游项目许可证覆盖，但截图中的品牌、第三方标志或展示素材是否需要单独许可，本轮没有取得额外授权证据。

### 11.2 网页版：LifeOS 局部复用

`components/life-records/CapsuleDashboard.tsx:9` 明确注明圆环实现参考 `karim-coder/life-os`。可核验复用是 SVG 圆周、`strokeDasharray` 和 `strokeDashoffset` 的进度环思路；当前实现已改为“近 7 天记录天数”，没有导入 LifeOS 的 Prisma、Zustand、Radix、Framer Motion、数据库或整套后台。

`docs/third-party-notices/life-os-MIT.txt` 保留了 LifeOS 仓库 URL、MIT 正文和版权行。其正文与参考副本 LICENSE 一致，前面额外加了来源说明；这满足保留通知的工程要求。

### 11.3 微信小程序：实际移植网页代码

以下同名文件哈希均不同，但 diff 显示共享函数、常量和实现结构，属于为微信环境删减或改写的移植，不能按独立实现排除来源：

| 网页文件 | 小程序文件 | 差异摘要 |
| --- | --- | --- |
| `lib/life-records.ts` | `miniprogram/shared/life-records.ts` | 六分类、`normalizeLifeRecord`、规则解析和字段校验大面积同源，删除附件和网页字段 |
| `lib/life-search.ts` | `miniprogram/shared/life-search.ts` | 搜索字段、宽度规范化函数和过滤逻辑同源，简化返回类型 |
| `lib/life-calendar.ts` | `miniprogram/shared/life-calendar.ts` | 月份、闰年、周一起始网格、聚合函数同源，删除部分网页辅助函数 |
| `lib/life-record-duplicates.ts` | `miniprogram/shared/life-record-duplicates.ts` | 原文指纹和重复检测同源，为小程序重写部分辅助分支 |
| `lib/life-auto-save.ts` | `miniprogram/shared/life-auto-save.ts` | 自动保存批次准备和结果文本同源，缩减平台相关能力 |

小程序另有 `wechat-storage-adapter.ts`、`life-ai-gateway.ts` 和原生页面等本地新增代码，但这些文件不能切裂共享业务模块与网页 AGPL 代码的衍生关系。当前小程序没有 LICENSE 文件，也未附 AGPL 文本或相应源码获取说明。

LifeBoard 未找到可验证复用证据，本报告不把它列为正式产品依赖，也不猜测其许可证。

## 12. 网页版 AGPL 商业使用结论

已证实：

- AGPL-3.0 允许商业使用和收费，本身不是“禁止商用许可证”。
- 修改后的程序通过远程网络供用户交互时，应向这些用户显著提供获得 Corresponding Source 的机会；分发时还需保留许可证、版权和修改信息。
- 当前代码是 LifeTracker 的修改版，不能因增加品牌、本地模块或 MIT 参考代码，就把整个网页应用改成闭源商业许可。
- 仅把源码放在私人仓库或让用户看到项目 URL，不当然等于已经向远程用户提供该运行版本的相应源码。

需要特别确认：

`TERMS_OF_USE.md` 第 2 节标题是 `Non-Commercial Use`，正文又讨论符合 AGPL 源码共享要求的商业产品及 “significant functional transformation”。这两段不能由工程审计自动解释成额外商业许可，也不能据此宣称“改动足够大即可闭源”。商业化前应向权利人确认其意图，并请法律专业人员结合 AGPL 与实际交付方式判断。

当前本机个人使用不自动触发公开部署义务；一旦向公网用户提供修改后的网页服务，就应按正式产品处理 AGPL 源码提供、版权保留、修改说明和用户可见入口。现有个人版首页尚未提供完整的开源源码入口，不能把本地验收状态当作公网发布合规证明。

## 13. 微信小程序分发义务

小程序共享模块来自 AGPL 网页项目，存在衍生作品风险。正式上架、体验版分发给他人或公开分发前，应至少完成：

- 保留 AGPL 文本及上游版权、来源和修改说明。
- 明确向小程序用户提供 Corresponding Source 的获取方式。
- 确认小程序打包、服务端 API、审核包和实际源码提供方式能否满足 AGPL。
- 如不愿承担该义务，应替换共享模块或向权利人取得单独商业许可。

“小程序没有第三方 npm 依赖”不等于“没有第三方开源代码义务”。微信平台规则、审核、主体资格、域名与隐私要求是另一套外部条款，不属于 AGPL 本身；未获类目确认前保持规则演示是产品边界，不会消除已有代码的许可证关系。

## 14. 第三方依赖

### 14.1 直接依赖

本机安装元数据与 `package.json` 对应如下：

| 依赖 | 安装版本 | 声明许可证 | 商业使用 | 闭源产品中的主要义务 |
| --- | --- | --- | --- | --- |
| `next`、`eslint-config-next` | 16.1.6 | MIT | 允许 | 保留版权与许可文本 |
| `react`、`react-dom` | 19.2.3 | MIT | 允许 | 保留版权与许可文本 |
| `firebase` | 12.10.0 | Apache-2.0 | 允许 | 附许可、保留适用声明与 NOTICE；修改文件需说明 |
| `firebase-admin` | 13.7.0 | Apache-2.0 | 允许 | 同上 |
| `openai` | 6.29.0 | Apache-2.0 | 允许 | 同上 |
| `recharts` | 3.8.0 | MIT | 允许 | 保留版权与许可文本 |
| `date-fns` | 4.1.0 | MIT | 允许 | 保留版权与许可文本 |
| `xlsx` | 0.18.5 | Apache-2.0 | 允许 | 附许可、NOTICE 和修改说明 |
| `jszip` | 3.10.1 | MIT OR GPL-3.0-or-later | 允许 | 选择 MIT 分支并保留通知 |
| `@ducanh2912/next-pwa` | 10.2.6 | MIT | 允许 | 保留版权与许可文本 |
| `tailwindcss`、`@tailwindcss/postcss` | 4.2.1 | MIT | 允许 | 保留版权与许可文本 |
| `typescript` | 5.9.3 | Apache-2.0 | 允许 | 通常为开发工具；如随产物分发则履行 Apache 义务 |
| `eslint` | 9.39.4 | MIT | 允许 | 通常为开发工具；如分发则保留通知 |
| `fake-indexeddb` | 6.2.6 | Apache-2.0 | 允许 | 开发依赖；如分发则履行 Apache 义务 |
| `@types/*` | 锁定版本 | MIT | 允许 | 通常为开发类型声明；如分发则保留通知 |

### 14.2 传递依赖与需履行的特殊许可证

锁文件共有 930 个包条目，不能把全部可选平台包都视为最终浏览器产物，但以下类别需要在构建 SBOM 中逐项核对：

| 包或类别 | 版本/数量 | 许可证 | 主要风险与义务 |
| --- | --- | --- | --- |
| `@img/sharp-libvips-*` | 1.2.4，10 个平台包 | LGPL-3.0-or-later | 如分发原生库，保留许可、提供对应源码并确保可替换/重新链接；浏览器远程服务是否分发需按部署形态确认 |
| `@img/sharp-win32-*`、`@img/sharp-wasm32` | 0.34.5，4 个包 | Apache-2.0 AND LGPL-3.0-or-later，其中 wasm 包还含 MIT | 必须同时满足组合中的全部许可证，不能只看 `sharp` 主包的 Apache 声明 |
| `sharp` | 0.34.5 | Apache-2.0 | 主包声明不等于原生平台包的全部义务 |
| `lightningcss` 及平台包 | 1.31.1，13 个包 | MPL-2.0 | 文件级 copyleft；分发所覆盖文件时需提供对应源码并保留通知，通常不要求整个项目采用 MPL |
| `axe-core` | 4.11.1 | MPL-2.0 | 如进入分发产物，按 MPL 文件级义务处理 |
| `caniuse-lite` | 1.0.30001779 | CC-BY-4.0 | 如分发其数据，保留署名与许可证说明 |
| `limiter` | 1.1.5 | 锁文件无元数据；已安装 `LICENSE.txt` 为 MIT | 以包内文本为准保留 `Copyright (C) 2011 by John Hurliman` |
| `node-forge` | 1.3.3 | BSD-3-Clause OR GPL-2.0 | 选择 BSD-3-Clause 分支并履行通知义务 |
| 其余锁文件条目 | 680 MIT、124 Apache-2.0、50 ISC、21 BSD-3-Clause、15 BSD-2-Clause 等 | 各类宽松许可证 | 按最终实际分发集合保留版权与许可证文本 |

`OR` 表示可选择其中一个分支；`AND` 表示组合义务同时适用。上述计数是锁文件包条目，不是本机安装或最终产物中的文件数，也不是完整 SBOM。

旧快照 `docs/audit-2026-10-20/dependency-licenses.json` 的哈希早于当前锁文件，本轮已用当前 `package-lock.json` 重新核对。旧快照保留作历史证据，不能单独证明当前构建合规。

## 15. 第三方 UI、图标、字体与素材

| 来源/位置 | 使用证据 | 许可证/归属状态 | 风险 | 建议 |
| --- | --- | --- | --- | --- |
| LifeOS SVG 圆环思路 | `CapsuleDashboard.tsx:9`、现有 MIT 通知 | MIT；版权行已保留 | 低 | 继续保留通知，不删除来源注释 |
| `public/file.svg`、`globe.svg`、`next.svg`、`vercel.svg`、`window.svg` | Git 历史追溯到 Create Next App 初始提交 | 未在本地单独找到逐文件许可证，通常属于脚手架素材 | 中低，待核实 | 发布前确认来源与分发许可；如无必要可替换 |
| `public/screenshot.jpg`、`screenshot.png` | 上游提交 `1273bd9` 引入，README 引用 | 受上游项目整体许可证覆盖；截图内部素材未单列证据 | 中，待核实 | 保留上游归属；商业发布前核对截图内品牌、标志和人物权利 |
| `docs/audit-2026-10-20/demo-preview.jpg`、`mobile-home.jpg` | 本地审计产物 | 未发现第三方图库声明 | 低至中，待核实 | 如公开发布，确认是否为自产截图及是否含第三方标志 |
| 网页字体 | CSS 使用系统字体栈，未发现 Google Fonts 或字体文件 | 无需随项目分发字体许可证；系统字体受操作系统条款约束 | 低 | 保持不打包第三方字体 |
| 小程序图标/图片/字体 | 递归检查未发现 `.png/.jpg/.svg/.woff` 等素材文件，界面以 CSS 和文字/emoji 为主 | 本地未发现第三方素材 | 低 | 后续新增素材时单独登记来源和许可 |

没有证据证明项目通过 CDN 加载第三方 UI 组件、图标库或图片服务。README 的徽章来自 Shields.io，属于外链服务内容，不构成随源码分发的软件依赖。

## 16. 分场景商业义务

### A. 网页版 SaaS

- 如继续基于当前 LifeTracker 派生代码提供修改后的远程服务，需履行 AGPL-3.0 §13 的相应源码提供义务，并保留版权、许可与修改说明。
- 需为最终服务端/浏览器产物生成实际第三方许可证清单，确认 LGPL/MPL 包是否被分发，以及 Apache 包的 NOTICE 与修改说明。
- 商业收费本身可讨论，但不能以“收费”或“闭源前端”替代许可证义务。
- 公网发布前仍需单独完成隐私、数据处理、服务商条款和地区资格审查；这些不是开源许可证结论。

### B. 微信小程序分发

- 共享业务模块如继续使用网页 AGPL 代码，正式分发时按可能的衍生作品处理，保留源码获取机会和相应通知。
- 小程序本地存储、平台审核、隐私保护指引、域名备案与微信服务条款是额外合规层，不能由 npm 依赖清单替代。
- 若希望闭源小程序且不愿承担 AGPL，应替换同源模块，或取得上游权利人的明确商业授权；工程团队不能自行假定“界面重写”即可清除义务。

## 17. 已证实的授权风险

| 风险 | 等级 | 已证实事实 | 处理建议 |
| --- | --- | --- | --- |
| 网页版整体为 AGPL 派生项目 | 高 | Git 共享上游祖先，原代码仍在，README/LICENSE 明确 AGPL | 商业发布前决定公开相应源码或取得商业授权 |
| 小程序共享模块来自 AGPL 网页代码 | 高 | 文件 diff 显示同源移植，小程序没有 LICENSE | 正式分发前补齐许可证和源码提供方案，或替换/取得授权 |
| Terms 的商业使用措辞需澄清 | 高 | `Non-Commercial Use` 与 AGPL 商业源码义务并置 | 向权利人确认并请律师审查 |
| 缺少完整发行 SBOM/NOTICE | 中高 | 只有 LifeOS 专门通知，没有最终产物清单 | 上线前生成 SBOM 与 NOTICE 包 |
| LGPL/MPL/CC-BY 依赖的实际分发范围未确认 | 中 | 锁文件有 10 个 LGPL libvips、13 个 MPL、1 个 CC-BY 条目 | 按实际部署镜像/安装包逐项核验 |
| 上游截图与脚手架 SVG 的素材权利未单列 | 中低 | 来源可追溯，但没有逐文件许可说明 | 发布前核实或替换 |

## 18. 尚待核实的问题

- 上游作者对 `TERMS_OF_USE.md` 第 2 节的真实意图，以及是否提供独立商业许可。
- “显著功能改造”在具体 AGPL 案例中的法律效果，工程审计不能自行裁定。
- 网页 SaaS、容器镜像、Vercel/CloudBase 产物是否包含或分发 `sharp/libvips`、`lightningcss`、`axe-core` 等包。
- 小程序审核包、服务端 API 和源码下载入口如何组合才满足 AGPL 的源码提供要求。
- 小程序 AppID、微信主体、服务类目、隐私指引和域名备案是否能获批；这些不是开源许可证问题。
- 产品名、徽章、品牌和截图中的标志是否涉及商标或第三方宣传素材授权。
- 所有第三方包的 NOTICE、内嵌许可证和二进制版权文件是否已进入最终发行包。

## 19. A–D 最终回答

### A. 现有代码是否存在阻止商业发布的明确授权问题？

**存在明确阻断风险。** 当前网页版是 AGPL-3.0 派生项目，不能把闭源商业 SaaS 当作已获许可。商业使用本身不被禁止，但必须履行 AGPL 的相应源码、版权、许可和修改说明义务；小程序共享代码也存在相同衍生作品风险。Terms 的商用措辞需要权利人澄清。是否构成法律上的“阻断”最终仍需律师结合实际发布方式判断。

### B. 哪些代码可能需要替换、公开源码或购买商业授权？

- LifeTracker 上游主体及当前网页版基于它形成的派生代码。
- 小程序中与网页版同源的 `life-records`、`life-search`、`life-calendar`、重复检测和自动保存模块。
- `TERMS_OF_USE.md` 所覆盖、需要额外商业许可的部分。

LifeOS 的 MIT 圆环参考通常不需要购买商业授权，但必须保留通知。MIT、Apache-2.0 等第三方依赖通常允许商业使用和闭源，前提是履行各自通知、NOTICE 和修改说明义务；LGPL/MPL 是否触发更重义务取决于最终分发形态。

### C. 哪些许可证条件需要在正式上线前履行？

1. 保留 AGPL LICENSE、上游版权、来源和修改说明。
2. 向远程用户提供当前运行版本 Corresponding Source 的显著获取机会。
3. 保留 LifeOS MIT 通知。
4. 为实际网页/小程序发行物生成第三方许可证、NOTICE 和 SBOM。
5. 对 Apache-2.0 包附许可证、NOTICE 和修改说明。
6. 确认 LGPL 原生库、MPL 文件、CC-BY 数据的实际分发范围并履行相应源码、通知或署名义务。
7. 为小程序补齐其代码来源、许可证和源码获取说明。
8. 发布前完成第三方服务条款、隐私与用户数据处理披露。

### D. 哪些结论仍需人工或法律专业人员确认？

- Terms 与 AGPL 的组合效力、是否提供商业授权。
- 当前功能改造是否改变衍生作品范围。
- 网页 SaaS 与小程序打包各自的 Corresponding Source 提供方式。
- LGPL/MPL 在最终部署镜像、服务端产物和小程序包中的具体义务。
- 上游截图、脚手架 SVG、商标、品牌和第三方标志的素材权利。
- 微信平台、Firebase、OpenAI、腾讯云等服务条款和数据处理合规。

## 20. 复核结论

当前项目可以继续本机个人开发和内部测试，但不能在未处理 AGPL 义务的情况下直接作为闭源收费公网产品发布。最优先的工程动作是：保存现有许可证与通知，建立最终产物 SBOM/NOTICE，给小程序补齐同源代码关系，并在公开部署前设计用户可见的源码获取入口。替换依赖或重写底座应作为经法律与产品决策后的独立任务，本轮不执行。

本轮只更新本报告；未修改业务代码、依赖、Git 历史、真实数据或服务配置。
## 21. 补充审计（2026-10-26，任务 001-B 全部来源复核）

本节为追加内容，不修改上文 2026-10-20 与 2026-10-26 首轮复核的结论。新增检查日期、工具、证据与未覆盖范围。

### 21.1 本轮新增核查的四个 GitHub 仓库

用户提供了四个此前未核实的候选仓库。本轮对每个仓库执行浅克隆或 GitHub API 只读查询，记录 HEAD、提交时间、LICENSE 与文件构成：

| 仓库 | HEAD | 提交时间 | 许可证 | 主要语言 | 是否使用 |
| --- | --- | --- | --- | --- | --- |
| `gunnar0022/lifeboard` | `ce2f51fcd1721941342e548c33caab957bf66db2` | 2026-07-03 | LICENSE 为 MIT；README 声明不允许再分发 | Python | 否 |
| `sushil766/life-os` | `29ebdef3f9075768598b6caedf91b126e245eb1a` | 2026-05-12 | 未发现 LICENSE 文件 | 配置文件集合 | 否 |
| `lunanoir21/Life-os-project` | `c82946e0fc95994488be5d19127c60c9652b7ee3` | 2026-10-11 | MIT | Rust | 否 |
| `edrisranjbar/lifeos` | `7db27fa00c937088f3b9a54fbe945621ca388819` | API 查询 | MIT | JavaScript | 否 |

判定未使用的证据：

1. 在网页版与小程序全库检索 `lifeboard`、`gunnar`、`sushil`、`lunanoir`、`edrisranjbar`，业务代码零命中，命中仅出现在本报告自身文字中。
2. 四个仓库技术栈分别为 Python 后端与 DnD 代理、Claude agents 配置集合、Rust 后端与 Prisma、JavaScript 自托管应用，与网页版 Next.js/TypeScript 和小程序 TypeScript 无可对位同源文件。
3. 未发现这些仓库的文件被复制进 `app`、`components`、`lib`、`hooks` 或 `miniprogram/`。

因此这四个仓库不属于 AI-LifeOS 的已使用来源，不构成本项目许可证义务。这不排除早期开发时曾阅读其公开界面作为设计参考；设计参考不产生代码复制义务，但已在对照表中按类别 C 与用户说明区分。

### 21.2 LifeBoard 的 LICENSE 与 README 冲突

已证实存在冲突：

- `LICENSE` 文件是标准 MIT 文本，Copyright (c) 2026 Gunnar Anderson。
- `README.md` 第 292 至 294 行 `## License` 一节写的是 Personal project. Not currently licensed for redistribution.

提交时间核查结果：本轮使用 `--depth 1` 浅克隆，`git log -- LICENSE` 与 `git log --diff-filter=A -- LICENSE` 均只返回最新提交 `ce2f51f`，因此**无法从当前克隆确定 LICENSE 文件的首次引入时间**。要确认该冲突是作者笔误还是后期改口，需要完整 Git 历史或作者说明。

对 AI-LifeOS 的影响：无。本项目未使用 LifeBoard 代码，该冲突不改变本项目授权状态。此处记录仅为避免未来误用该仓库。

### 21.3 网页版与上游基线的量化比对

以上游共同祖先 `1273bd9fb8005d10b03d5fedb9bdd66aee771844`（109 个文件）为基线，对比当前 HEAD：

- `app`、`components`、`lib` 范围共 50 个文件变动。
- 新增 9775 行，删除 169 行。
- 其中 3 个文件为修改，47 个文件为新增，0 个删除。

被修改的 3 个上游文件是 `app/page.tsx`（1057 增 5 删）、`app/globals.css`（129 增 0 删）、`app/layout.tsx`（8 增 13 删）与 `app/(auth)/signup/page.tsx`（4 增 151 删）中的一部分；其余上游文件原样保留。

这一量化结果支持第 3 节结论：网页版是 AGPL 派生项目，且新增代码占多数，但新增代码与上游代码在同一应用中结合分发。

### 21.4 LifeOS 复用的精确边界

唯一已证实的第三方代码参考点是 `components/life-records/CapsuleDashboard.tsx` 第 9 行注释所声明的圆环实现思路，来源为 `karim-coder/life-os`（MIT）。

实际复用内容是 `radius`、`2 * Math.PI * radius` 周长计算、`strokeDasharray`、`strokeDashoffset` 与 `-rotate-90` 这套 SVG 圆环数学，属通用技术方案。`RecordRing` 组件本身、六分类颜色、交互、文案、`summarizeLifeRecords` 统计均自主实现。

未发现导入 LifeOS 的 Prisma、Zustand、Radix、Framer Motion 或其后台页面。通知文件 `docs/third-party-notices/life-os-MIT.txt` 已存在并保留。

### 21.5 小程序五个共享模块的逐文件比对

对五个可疑模块计算 SHA-256 并统计行数，全部哈希不同、行数有差异，证明经过改写：

| 小程序文件 | 网页版来源 | 小程序行数 | 网页行数 | 哈希相同 |
| --- | --- | --- | --- | --- |
| `miniprogram/shared/life-records.ts` | `lib/life-records.ts` | 442 | 395 | 否 |
| `miniprogram/shared/life-calendar.ts` | `lib/life-calendar.ts` | 108 | 158 | 否 |
| `miniprogram/shared/life-record-duplicates.ts` | `lib/life-record-duplicates.ts` | 51 | 66 | 否 |
| `miniprogram/shared/life-auto-save.ts` | `lib/life-auto-save.ts` | 41 | 76 | 否 |
| `miniprogram/shared/life-search.ts` | `lib/life-search.ts` | 22 | 44 | 否 |

同源逻辑包括六分类枚举与标签、`normalizeLifeRecord` 规范化流程、搜索规范化与匹配、日历月份天数与闰年计算、周一起始网格、重复指纹算法、自动保存批次整理。差异主要来自微信环境 API 替换与功能删减。

结论不变：这五个模块属于对 AGPL 代码的修改移植，应按衍生作品处理。小程序仍无 LICENSE、无源码获取说明。

### 21.6 素材与其他第三方权利

网页版 `public/` 共 8 个文件：`screenshot.jpg`（189989 B）、`screenshot.png`（1598077 B）、`file.svg`、`globe.svg`、`next.svg`、`vercel.svg`、`window.svg`、`manifest.json`、`llms.txt`。

- 截图与脚手架 SVG 由上游提交 `1273bd9` 引入，来源可追溯，但逐文件素材授权未核实。
- `vercel.svg` 可能涉及 Vercel 品牌标志，需按商标规则处理。
- 未发现 Google Fonts、第三方图标库或 CDN UI 依赖，CSS 使用系统字体栈。

小程序按扩展名统计只有 `.ts`、`.json`、`.wxss`、`.wxml`、`.md`、`.mjs`，无图片、SVG 或字体文件。

直接依赖 19 个，许可证分布见第 14 节。需区分四类权利：软件许可证、素材授权、商标与品牌、服务条款。不能全部归为 MIT 或 AGPL。

### 21.7 本轮工具与方法

- Git：`ls-tree`、`diff --numstat`、`log`、`ls-remote`。
- 哈希：`Get-FileHash -Algorithm SHA256`。
- 检索：`rg` 关键词与导入关系扫描，排除 `node_modules`、`.next`、`tools-build-stage/`。
- 网络：GitHub REST API `Invoke-RestMethod` 查询仓库元数据。
- 文件清单：PowerShell `Get-ChildItem` 按扩展名分组统计。

### 21.8 未覆盖范围

- `node_modules` 内每个包的 LICENSE 原文未逐份打开核对，采用锁文件元数据统计。
- 未使用自动化代码相似度工具做跨仓库逐行比对；判断基于 Git diff、导入关系、文件结构和技术栈差异。
- LifeBoard 完整 Git 历史未拉取，LICENSE 首次引入时间未确认。
- `edrisranjbar/lifeos` 未完成完整克隆，仅获取元数据。
- 截图与 SVG 的逐文件素材授权未核实。
- 未扫描 `tools-build-stage/`、`.next-model-test-prod-audit/`、`.next`。
- 未读取任何真实用户数据、密钥或私人资料。

本节不改变第 17 至 20 节的风险等级与结论。完整的逐文件来源对照见 `SOURCE_PROVENANCE_MATRIX.md`。

本轮只追加本报告与生成来源对照表；未修改业务代码、未安装依赖、未删除文件、未改 Git 历史、未提交或推送。
