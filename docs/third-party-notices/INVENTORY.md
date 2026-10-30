# AI-LifeOS 第三方许可证清单（网页版）

最后核对日期：2026-10-26

本文件是**清单与索引**，不替代任何许可证原文。权威的逐项审计证据、版本号和判定理由见
`OPEN_SOURCE_AUDIT.md`、`SOURCE_PROVENANCE_MATRIX.md` 和 `COMMERCIAL_LICENSE_PLAN.md`。

分发任何构建产物时，必须同时附上本清单所列的全部适用许可证原文与版权声明。

## 1. 源码级开源项目

| 项目 | 仓库 | 许可证 | 本仓库许可证文件 | 使用方式 |
| --- | --- | --- | --- | --- |
| LifeTracker | <https://github.com/ashishworkacc/life-tracker> | AGPL-3.0 | `LICENSE`（全文，35184 B） | 上游基础代码，AI-LifeOS 由其二次开发 |
| Life OS | <https://github.com/karim-coder/life-os> | MIT | `docs/third-party-notices/life-os-MIT.txt` | 仅参考仪表盘圆环的视觉实现，结合 LifeTracker 原有进度圆环重新实现 |

上游基线提交：`1273bd9fb8005d10b03d5fedb9bdd66aee771844`。

以下四个曾被讨论、但**未实际使用**的仓库不得列入依赖或致谢清单：
LifeBoard（`gunnar0022/lifeboard`）、`sushil766/life-os`、`lunanoir21/Life-os-project`、
`edrisranjbar/lifeos`。

## 2. npm 直接依赖

安装元数据核对结果（详情与证据见 `OPEN_SOURCE_AUDIT.md` 第 14.1 节）：

| 依赖 | 版本 | 许可证 | 主要义务 |
| --- | --- | --- | --- |
| `next`、`eslint-config-next` | 16.1.6 | MIT | 保留版权与许可文本 |
| `react`、`react-dom` | 19.2.3 | MIT | 保留版权与许可文本 |
| `firebase`、`firebase-admin` | 12.10.0 / 13.7.0 | Apache-2.0 | 附许可、保留声明与 NOTICE；修改文件需说明 |
| `openai` | 6.29.0 | Apache-2.0 | 同上 |
| `recharts` | 3.8.0 | MIT | 保留版权与许可文本 |
| `date-fns` | 4.1.0 | MIT | 保留版权与许可文本 |
| `xlsx` | 0.18.5 | Apache-2.0 | 附许可、NOTICE 与修改说明 |
| `jszip` | 3.10.1 | MIT OR GPL-3.0-or-later | 选择 MIT 分支并保留通知 |
| `@ducanh2912/next-pwa` | 10.2.6 | MIT | 保留版权与许可文本 |
| `tailwindcss`、`@tailwindcss/postcss` | 4.2.1 | MIT | 保留版权与许可文本 |
| `typescript` | 5.9.3 | Apache-2.0 | 开发工具；若随产物分发则履行 Apache 义务 |
| `eslint` | 9.39.4 | MIT | 开发工具；若分发则保留通知 |
| `fake-indexeddb` | 6.2.6 | Apache-2.0 | 开发依赖；若分发则履行 Apache 义务 |
| `@types/*` | 锁定版本 | MIT | 开发类型声明；若分发则保留通知 |

## 3. 传递依赖中需特别履行的许可证

下列条目来自当前 `package-lock.json`（930 个包条目）核对结果。
它们**不全是**最终浏览器产物的一部分，需在构建 SBOM 中按实际分发集合逐项确认。

| 包或类别 | 版本/数量 | 许可证 | 注意事项 |
| --- | --- | --- | --- |
| `@img/sharp-libvips-*` | 1.2.4，10 个平台包 | LGPL-3.0-or-later | 如分发原生库，需保留许可、提供对应源码并确保可替换/重新链接 |
| `@img/sharp-win32-*`、`@img/sharp-wasm32` | 0.34.5，4 个包 | Apache-2.0 AND LGPL-3.0-or-later（wasm 另含 MIT） | 组合义务同时适用 |
| `sharp` | 0.34.5 | Apache-2.0 | 主包声明不覆盖原生平台包义务 |
| `lightningcss` 及平台包 | 1.31.1，13 个包 | MPL-2.0 | 文件级 copyleft，需提供被覆盖文件的对应源码 |
| `axe-core` | 4.11.1 | MPL-2.0 | 若进入分发产物按 MPL 文件级义务处理 |
| `caniuse-lite` | 1.0.30001779 | CC-BY-4.0 | 分发其数据时保留署名与许可证说明 |
| `limiter` | 1.1.5 | MIT（以包内 `LICENSE.txt` 为准） | 保留 `Copyright (C) 2011 by John Hurliman` |
| `node-forge` | 1.3.3 | BSD-3-Clause OR GPL-2.0 | 选择 BSD-3-Clause 分支并履行通知义务 |
| 其余条目 | 680 MIT / 124 Apache-2.0 / 50 ISC / 21 BSD-3-Clause / 15 BSD-2-Clause 等 | 宽松许可证 | 按最终分发集合保留版权与许可文本 |

`OR` 表示可选择其中一个分支；`AND` 表示组合义务同时适用。

## 4. 第三方 UI、图标、字体与素材

| 来源/位置 | 状态 | 处理建议 |
| --- | --- | --- |
| Life OS SVG 圆环思路（`components/life-records/CapsuleDashboard.tsx`） | MIT，版权行已保留 | 保留现有来源注释与 MIT 通知 |
| `public/file.svg`、`globe.svg`、`next.svg`、`vercel.svg`、`window.svg` | 追溯至 Create Next App 初始提交，未找到逐文件许可证 | 发布前确认或替换 |
| `public/screenshot.jpg`、`screenshot.png` | 上游 `1273bd9` 引入，受上游整体许可证覆盖 | 发布前核对截图内品牌、标志与人物权利 |
| 网页字体 | 使用系统字体栈，未打包字体文件 | 无需随项目分发字体许可证 |
| 小程序图标/图片/字体 | 本地未发现第三方素材 | 后续新增素材时单独登记 |

未发现通过 CDN 加载第三方 UI 组件、图标库或图片服务。README 徽章来自 Shields.io，属外链内容。

## 5. 通知原文的存放位置

| 项目 | 义务原文位置 |
| --- | --- |
| AGPL-3.0 | 仓库根目录 `LICENSE` |
| Life OS MIT | `docs/third-party-notices/life-os-MIT.txt` |
| 其余 npm 依赖 | 各包自带 `LICENSE` / `NOTICE`，需在发布产物中汇总 |

用户可见的开源声明入口：`components/life-records/OpenSourceNotice.tsx`（「我的」页）。

## 6. 尚未补齐、属于发布阻断项的内容

1. 当前锁文件对应的完整机器可读 SBOM 尚未生成。
2. 各依赖自带的 `LICENSE` / `NOTICE` 原文尚未汇总进发布产物。
3. `public/*.svg` 与截图的逐文件授权仍需确认。
4. 当前运行版本对应源码的公开托管地址尚未建立。

这些项目在正式公开上线前必须全部关闭，详见 `docs/WEB_OPEN_SOURCE_COMPLIANCE.md`。
