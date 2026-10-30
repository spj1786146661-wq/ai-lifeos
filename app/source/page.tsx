import Link from 'next/link'

const LIFE_TRACKER_URL = 'https://github.com/ashishworkacc/life-tracker'
const LIFE_OS_URL = 'https://github.com/karim-coder/life-os'
const AGPL_URL = 'https://www.gnu.org/licenses/agpl-3.0.html'

export const metadata = {
  title: '源代码与许可证 · AI-LifeOS',
}

export default function SourcePage() {
  const sourceUrl = process.env.AIOS_PUBLIC_BETA_SOURCE_URL?.trim() ?? ''
  const releaseId = process.env.AIOS_PUBLIC_BETA_RELEASE_ID?.trim() ?? ''
  return <main className="mx-auto min-h-screen max-w-3xl space-y-6 px-5 py-10 text-slate-100">
    <Link href="/" className="text-sm text-cyan-300 underline">返回 AI-LifeOS</Link>
    <header className="space-y-2">
      <p className="font-mono text-xs tracking-[0.2em] text-cyan-300">SOURCE / LICENSES</p>
      <h1 className="text-3xl font-black">源代码与许可证</h1>
      <p className="text-sm leading-6 text-muted">AI-LifeOS 是基于 LifeTracker 二次开发的独立项目，与上游作者不存在官方合作或授权背书关系。</p>
    </header>
    <section className="card space-y-3">
      <h2 className="text-xl font-bold">当前运行版本对应源码</h2>
      {sourceUrl && releaseId ? <>
        <a href={sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex rounded-xl bg-cyan-300 px-4 py-3 font-bold text-[#071326]">获取当前运行版本 Corresponding Source</a>
        <p className="font-mono text-xs text-muted">发布版本：{releaseId}</p>
      </> : <p className="rounded-xl border border-red-300/30 bg-red-950/30 p-4 text-sm leading-6 text-red-100">尚未配置真实源码地址和对应发布版本。此状态是正式公开 Beta 的发布阻断项；系统不会生成或展示虚假链接。</p>}
      <p className="text-xs leading-5 text-muted">源码包或仓库必须与当前部署版本对应，包含构建与运行所需的源文件、配置模板、许可证、修改说明和第三方通知，但不包含 API Key、用户记录、OAuth 凭据或部署秘密。</p>
    </section>
    <section className="card space-y-3">
      <h2 className="text-xl font-bold">上游与许可证</h2>
      <p className="text-sm leading-6 text-muted">主要上游：<a href={LIFE_TRACKER_URL} target="_blank" rel="noreferrer noopener" className="text-cyan-300 underline">LifeTracker</a>，适用 GNU Affero General Public License v3.0。<a href={AGPL_URL} target="_blank" rel="noreferrer noopener" className="text-cyan-300 underline">查看 AGPL-3.0 许可证全文</a>。</p>
      <p className="text-sm leading-6 text-muted">仪表盘圆环视觉实现参考 <a href={LIFE_OS_URL} target="_blank" rel="noreferrer noopener" className="text-cyan-300 underline">Life OS</a>，适用 MIT 许可证。完整 MIT 通知和 npm 依赖清单随 Corresponding Source 一并提供。</p>
    </section>
    <section className="card space-y-3">
      <h2 className="text-xl font-bold">构建与运行</h2>
      <p className="text-sm leading-6 text-muted">项目使用 Next.js 16、React 19 和 TypeScript。对应源码中的 README、package.json、锁文件、环境变量模板及 Public Beta 部署说明共同构成构建与运行准备材料。</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <a href="/privacy" className="text-cyan-300 underline">隐私说明</a>
        <a href="/terms" className="text-cyan-300 underline">使用说明</a>
      </div>
    </section>
  </main>
}
