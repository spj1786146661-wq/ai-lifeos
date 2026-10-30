# AI人生数据库 V1（本地单用户分支）

本分支直接修改原 LifeTracker 项目，保留原有 Git 历史、Next.js、Firebase、OpenRouter 与 Recharts。首页 `/` 是中文生活记录入口，产品签名为「AI记录人生，AI改变人生」；下方仍保留上游项目说明，原有页面及功能没有整体重写。

```powershell
npm install
npm run test:life
npm run dev -- --hostname 127.0.0.1
# 浏览器打开 http://127.0.0.1:3000
```

- 不配置密钥：页面明确显示「演示规则解析 · 未调用 AI」，记录仅保存在当前浏览器的 localStorage。规则演示只能识别少量明确措辞，不能代表模型效果。
- 力量训练可以记录项目、重量和组数；没有说出运动时长时不补造时长。仪表盘按训练次数统计运动，并单独显示已知时长。
- 学习支持内容、时长或完成数量（如题数）；确认后与其他记录一样可编辑、删除。解析预览按事件显示卡片，仅在点击「修改」时展开表单。底部导航为「记录 / 数据 / 我的」；历史在数据页内，点击分类圆环可筛选该类全部历史。
- 新版仪表盘先显示近 7 天各类记录的圆环覆盖天数，再显示实际数字；圆环不是健康目标或消费预算。品牌愿景中的 AI 反思功能尚未实现；未配置 API Key 时页面明确显示演示规则解析。
- 仪表盘布局和圆环参考 [Life OS](https://github.com/karim-coder/life-os) 的 Dashboard 与 Focus 视图，并结合原 LifeTracker 的进度圆环；MIT 版权声明见 `docs/third-party-notices/life-os-MIT.txt`。主项目仍沿用原 LifeTracker 的许可证。
- 使用真实 AI：在未提交到 Git 的 `.env.local` 中设置 `OPENROUTER_API_KEY`。该变量只由服务端解析路由读取，不使用 `NEXT_PUBLIC_` 前缀；模型失败会报错，不会悄悄切换演示解析。
- 使用 Firestore：填写 `.env.example` 中的 Firebase 客户端配置，在自己的 Firebase 项目开启邮箱登录、创建单个测试账号并部署仓库的 Firestore 规则。首页不提供注册。解析结果始终先预览、允许修改或取消，确认后才保存到 `life_entries` 集合。
- 第一版只在本机使用。原项目的其他 API、许可与依赖安全问题仍需处理后才能考虑公开部署。

## 开源来源与致谢

**AI-LifeOS 是基于 [LifeTracker](https://github.com/ashishworkacc/life-tracker) 二次开发的独立项目。**

- 上游项目：LifeTracker（`https://github.com/ashishworkacc/life-tracker`）
- 上游许可证：GNU Affero General Public License v3.0，全文见 [LICENSE](./LICENSE)
- 上游基线提交：`1273bd9fb8005d10b03d5fedb9bdd66aee771844`
- 感谢 LifeTracker 原作者及全部上游贡献者的开源工作。

AI-LifeOS 添加了中文六大分类生活记录、聊天即记录、日历、IndexedDB 适配与迁移、ChatGPT 套餐接入等修改。上述修改同样按 AGPL-3.0 发布，上游版权声明与许可证全文均予保留。

AI-LifeOS 与 LifeTracker 原作者**不存在官方合作关系，也未获得其授权背书**。本项目使用独立名称与界面，不代表上游项目立场。

### 设计参考

仪表盘圆环的视觉实现参考 [Life OS](https://github.com/karim-coder/life-os)（MIT 许可）的 Dashboard 与 Focus 视图，并结合 LifeTracker 原有进度圆环重新实现。仅参考界面思路，未复制其他模块。

Life OS 的 MIT 通知原文保留在 [`docs/third-party-notices/life-os-MIT.txt`](./docs/third-party-notices/life-os-MIT.txt)，同时在小程序外的网页界面「我的 → 开源与致谢」中可查看。

### 未使用的项目

开发过程中检索过 LifeBoard、Life OS Dashboard、Life OS Project、Edi Life OS 等仓库，但**未使用其源代码**，因此不作为依赖列出。详见 `SOURCE_PROVENANCE_MATRIX.md`。

### 源码提供状态

AGPL-3.0 要求向网络交互用户提供当前运行版本对应的完整源码。公开源码仓库为 [`spj1786146661-wq/ai-lifeos`](https://github.com/spj1786146661-wq/ai-lifeos)。每个正式发布版本还必须建立不可移动的版本标签，并让运行中的 `/source` 页面指向该标签对应的精确源码目录。首次版本标签和线上源码入口尚未完成，相关发布阻断项见 `docs/WEB_OPEN_SOURCE_COMPLIANCE.md`。

---

## 上游 LifeTracker 原说明

<p align="center">
  <img src="public/screenshot.jpg" alt="LifeTracker Dashboard" width="100%" />
</p>

<h1 align="center">LifeTracker — Open-Source Personal Life OS</h1>

<p align="center">
  <strong>Self-hosted habit tracker, time blocker, health logger, and AI productivity assistant — built with Next.js 16, Firebase, and Telegram bots.</strong>
</p>

<p align="center">
  <a href="https://github.com/ashishworkacc/life-tracker/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" />
  </a>
  <a href="https://nextjs.org">
    <img src="https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js" alt="Next.js 16" />
  </a>
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript" />
  <a href="https://firebase.google.com">
    <img src="https://img.shields.io/badge/Firebase-Firestore-orange?logo=firebase" alt="Firebase" />
  </a>
  <img src="https://img.shields.io/badge/AI-DeepSeek_V3-purple" alt="AI: DeepSeek V3" />
  <img src="https://img.shields.io/badge/deploy-Vercel-black?logo=vercel" alt="Deploy: Vercel" />
</p>

<p align="center">
  <a href="https://life-tracker-silk.vercel.app">Live Demo</a> ·
  <a href="#-quick-start-3-minutes">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#system-architecture">Architecture</a>
</p>

---

> **⭐ If this saves you from paying for 6 productivity apps, a star helps others find it.**

---

## What Is This?

**LifeTracker is a self-hosted, open-source life OS** — a single Next.js app that replaces Habitica, Toggl, Todoist, MyFitnessPal, and a journaling app simultaneously. All your data lives in your own Firebase project. No subscriptions. No vendor lock-in.

The killer feature: **two Telegram bots do the data entry for you.** Every 30 minutes, the check-in bot asks what you're working on. You reply in plain text — your Time Ledger updates without opening the app. The food bot works the same way: send *"2 eggs and coffee"*, AI estimates the macros and logs them.

**Built for developers and knowledge workers** who want AI-generated insights from their *own* data — not population averages from a SaaS product.

---

## 🚀 Quick Start (3 minutes)

```bash
# 1. Clone and install
git clone https://github.com/ashishworkacc/life-tracker.git
cd life-tracker && npm install

# 2. Configure (Firebase + OpenRouter keys)
cp .env.example .env.local
# Edit .env.local — minimum required: Firebase keys + OPENROUTER_API_KEY

# 3. Run
npm run dev
# Open http://localhost:3000 → sign up → you're in
```

The Telegram bots and Apple Health import are optional. The core app works with just Firebase + OpenRouter.

---

## Features

### Core Tracking
- **Habits** — Daily/weekly streaks, AI-suggested emoji, count-based or boolean, pause/resume all, difficulty ratings
- **Todos** — P1/P2/P3 priority, due dates, AI-generated sub-task breakdown per item
- **Goals & Milestones** — Long-horizon tracking with linked actions
- **Time Ledger** — 30-minute time blocking, bulk fill, gap detection, AI day analysis
- **Custom Counters** — Track anything countable with XP milestones and progress charts

### Health & Body
- **Food Log** — Plain-English Telegram input or manual entry; AI fills macros. Supports retrospective dates.
- **Sleep, Weight, Vitals** — Dedicated trackers with trend charts
- **Apple Health Import** — Upload the Health export ZIP; XML parsed client-side, bulk-imported to Firestore
- **Cravings Tracker** — Atomic Habits framework (Cue → Craving → Response → Reward) + 10-min urge surfing timer

### AI & Automation
- **Telegram Check-in Bot** — 30-min nudge → reply in plain text → Time Ledger updated passively
- **Food Logger Bot** — "2 eggs and toast" → AI parses → macros logged automatically
- **AI Habit Sort** — Re-orders habit list by AI-suggested optimal execution order
- **AI Sub-task Breakdown** — Paste any todo title → AI generates a concrete step list
- **Correlation Engine** — Surfaces relationships between your tracked variables (sleep ↔ focus, etc.)
- **Daily AI Summary** — Morning Telegram briefing on yesterday's stats

### Gamification
- **XP System** — Habits (+10), todos (+10), time blocks (+15), check-ins (+20), milestones (+100)
- **Levels & Streaks** — Exponential XP curve: `200 × 1.5^(level−1)` per level
- **Badges** — Automatically awarded on key milestones

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | Next.js 16.1.6 — App Router, TypeScript, Turbopack |
| Styling | Tailwind CSS v4, CSS custom properties |
| Auth | Firebase Authentication (Email/Password + Google OAuth) |
| Database | Cloud Firestore (`asia-south1`), 25+ collections |
| Server-side | Firebase Admin SDK (Node.js) |
| AI | OpenRouter API → DeepSeek V3 (`deepseek/deepseek-chat`) |
| Notifications | Telegram Bot API (two bots) |
| Deployment | Vercel serverless (`bom1` / Mumbai) |
| Charting | Recharts |
| Export | `xlsx`, `jszip` |

---

## System Architecture

```mermaid
flowchart TD
    subgraph Client["Browser / Mobile Web"]
        UI[Next.js App Router\nReact Client Components]
    end

    subgraph Server["Vercel Serverless"]
        API[Route Handlers\n/api/*]
        PROXY[proxy.ts\nAuth Middleware]
    end

    subgraph Firebase
        AUTH[Firebase Auth]
        DB[Firestore\nasia-south1]
        ADMIN[Firebase Admin SDK]
    end

    subgraph AI
        OR[OpenRouter API\nDeepSeek V3]
    end

    subgraph Telegram
        BOT1[Check-in Bot\nTime Ledger]
        BOT2[Food Logger Bot\nMacro Tracking]
        CRON[External Cron\n30-min trigger]
    end

    UI -->|Auth guard| PROXY
    UI -->|Firestore SDK| DB
    UI -->|Firebase Auth| AUTH
    UI -->|fetch| API
    API -->|Admin SDK| ADMIN
    ADMIN -->|Read/Write| DB
    API -->|AI requests| OR
    CRON -->|POST /api/telegram/cron| API
    API -->|sendMessage| BOT1
    API -->|sendMessage| BOT2
    BOT1 -->|Webhook POST| API
    BOT2 -->|Webhook POST| API
```

**Key decisions:**
- Firebase initialised lazily via getter functions (prevents Next.js SSR failures)
- Firebase Admin authenticates via a single `FIREBASE_SERVICE_ACCOUNT` env var (JSON string, no file)
- Telegram cron triggered by external scheduler — works on Vercel Hobby plan
- All Firestore documents carry `userId`; security rules enforce per-user isolation

---

## Getting Started

### Prerequisites

- Node.js 20+
- Firebase project (Firestore + Auth enabled — free Spark plan works)
- OpenRouter API key ([openrouter.ai/keys](https://openrouter.ai/keys) — free tier available)
- Telegram bots via @BotFather (optional)

### 1. Clone & Install

```bash
git clone https://github.com/ashishworkacc/life-tracker.git
cd life-tracker
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
# Fill in Firebase client keys + OPENROUTER_API_KEY at minimum
```

See [`.env.example`](./.env.example) for every variable with descriptions.

### 3. Firebase Setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** (Email/Password + Google)
3. Enable **Firestore** in `asia-south1`
4. Go to **Project Settings → Service Accounts → Generate new private key**
5. Minify the JSON (`jq -c . key.json`) and set it as `FIREBASE_SERVICE_ACCOUNT`
6. Deploy rules:

```bash
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

### 4. Run

```bash
npm run dev   # http://localhost:3000
```

Sign up — your account is automatically provisioned.

### 5. Deploy to Vercel

```bash
vercel env add OPENROUTER_API_KEY production
vercel env add FIREBASE_SERVICE_ACCOUNT production
# repeat for remaining keys
vercel --prod
```

### 6. Register Telegram Webhooks (optional)

```bash
# Check-in bot
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-app.vercel.app/api/telegram/webhook&secret_token=<WEBHOOK_SECRET>"

# Food bot
curl "https://api.telegram.org/bot<FOOD_TOKEN>/setWebhook" \
  -d "url=https://your-app.vercel.app/api/telegram/food-webhook"
```

Set up a cron job (cron-job.org, EasyCron) to call `/api/telegram/cron` with `Authorization: Bearer <CRON_SECRET>` every 30 minutes.

---

## Repository Governance

### Roadmap

- [ ] iOS PWA push notifications (replace Telegram check-ins with Web Push)
- [ ] Multi-user support with admin panel
- [ ] Guided weekly review workflow with AI coaching
- [ ] Pomodoro ↔ Todo automatic session linking

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Run `npx tsc --noEmit` before submitting a PR — zero type errors required.

### Code of Conduct

[Contributor Covenant](./CODE_OF_CONDUCT.md)

### License

**AGPL-3.0** — If you run a modified version as a web service, you must share the modified source with your users. See [LICENSE](./LICENSE).

### ⚖️ Legal & Ethics

Governed by [TERMS_OF_USE.md](./TERMS_OF_USE.md). Personal non-commercial use. Attribution required for public forks. Security vulnerabilities → [SECURITY.md](./SECURITY.md), not public Issues.

### Acknowledgments

- [OpenRouter](https://openrouter.ai) / [DeepSeek](https://deepseek.com) — AI inference
- [Firebase](https://firebase.google.com) — Auth and database
- [Recharts](https://recharts.org) — Charts
- [Next.js](https://nextjs.org) — Framework
- *Atomic Habits* by James Clear — Cravings module framework

---

<sub>Personal project. Not affiliated with any referenced services.</sub>
