import Link from 'next/link'

export const metadata = {
  title: 'Public Beta 使用说明 · AI-LifeOS',
}

export default function TermsPage() {
  return <main className="mx-auto min-h-screen max-w-3xl space-y-6 px-5 py-10 text-slate-100">
    <Link href="/" className="text-sm text-cyan-300 underline">返回 AI-LifeOS</Link>
    <header className="space-y-2">
      <p className="font-mono text-xs tracking-[0.2em] text-cyan-300">PUBLIC BETA / TERMS</p>
      <h1 className="text-3xl font-black">Public Beta 使用说明</h1>
      <p className="text-sm leading-6 text-muted">更新日期：2026 年 10 月 28 日。本页补充说明测试版本的实际运行边界，不替代仓库中保留的上游 TERMS_OF_USE。</p>
    </header>
    <section className="card space-y-3">
      <h2 className="text-xl font-bold">测试版本</h2>
      <p className="text-sm leading-6 text-muted">AI-LifeOS Public Beta 用于小规模产品验证，可能出现模型不可用、解析不完整、浏览器数据丢失或功能调整。请在保存重要记录前核对内容，并定期导出备份。</p>
    </section>
    <section className="card space-y-3">
      <h2 className="text-xl font-bold">第三方服务和费用</h2>
      <p className="text-sm leading-6 text-muted">AI 由用户在连接页面自行选择的第三方服务商提供。用户负责自己的 API Key、模型权限、用量、费用限制及服务商账户安全。连接测试和正式解析都可能消耗 Tokens。</p>
    </section>
    <section className="card space-y-3">
      <h2 className="text-xl font-bold">使用限制</h2>
      <p className="text-sm leading-6 text-muted">不得利用本服务探测内网、绕过服务商权限、共享他人凭据、批量滥用模型或处理违法内容。生活记录与 AI 输出不能替代医疗、心理、法律、财务或其他专业建议。</p>
    </section>
    <section className="card space-y-3">
      <h2 className="text-xl font-bold">开源许可</h2>
      <p className="text-sm leading-6 text-muted">AI-LifeOS 网页应用包含 LifeTracker 的 AGPL-3.0 修改版本及其他第三方开源内容。运行版本对应源码、许可证和来源通知见“源代码与许可证”。</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <a href="/privacy" className="text-cyan-300 underline">隐私说明</a>
        <a href="/source" className="text-cyan-300 underline">源代码与许可证</a>
      </div>
    </section>
  </main>
}
