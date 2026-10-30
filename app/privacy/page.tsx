import Link from 'next/link'

export const metadata = {
  title: '隐私说明 · AI-LifeOS',
}

export default function PrivacyPage() {
  return <main className="mx-auto min-h-screen max-w-3xl space-y-6 px-5 py-10 text-slate-100">
    <Link href="/" className="text-sm text-cyan-300 underline">返回 AI-LifeOS</Link>
    <header className="space-y-2">
      <p className="font-mono text-xs tracking-[0.2em] text-cyan-300">PUBLIC BETA / PRIVACY</p>
      <h1 className="text-3xl font-black">隐私与数据说明</h1>
      <p className="text-sm leading-6 text-muted">更新日期：2026 年 10 月 28 日。此说明适用于 AI-LifeOS Web Public Beta。</p>
    </header>

    <section className="card space-y-3">
      <h2 className="text-xl font-bold">生活记录存在哪里</h2>
      <p className="text-sm leading-6 text-muted">Public Beta 的生活记录、聊天结果和设置默认保存在你当前浏览器的本地存储中；图片附件保存在当前浏览器的 IndexedDB。当前版本不提供账号云同步，也不会自动把记录复制到另一台设备或另一个浏览器。</p>
      <p className="text-sm leading-6 text-amber-100">清理浏览器数据、卸载浏览器、使用无痕窗口后关闭窗口，或设备损坏，都可能导致本地记录无法恢复。</p>
    </section>

    <section className="card space-y-3">
      <h2 className="text-xl font-bold">备份、恢复与删除</h2>
      <p className="text-sm leading-6 text-muted">你可以在“我的”页导出 JSON 或包含附件的备份，并在隔离验证后恢复。长期使用前建议定期把备份保存到你控制的位置。</p>
      <p className="text-sm leading-6 text-muted">应用提供单条删除、按日期删除、多选删除和“清空全部生活记录”。清空全部需要输入指定确认文字。断开 AI 连接不会删除生活记录；删除记录也不会替你撤销腾讯云账户或 API Key。</p>
    </section>

    <section className="card space-y-3">
      <h2 className="text-xl font-bold">使用第三方 AI 时会发送什么</h2>
      <p className="text-sm leading-6 text-muted">只有你明确连接并发起 AI 解析、数据分析或后续追问时，完成该请求所需的生活描述、相关结构化记录和追问上下文会通过 AI-LifeOS 服务端发送给你在连接页面选择的 AI 服务商。第三方 AI 服务商独立处理这些数据，其地域、保留和计费规则以该服务商公布的条款为准。</p>
      <p className="text-sm leading-6 text-muted">AI-LifeOS 的普通诊断日志不记录 API Key 或生活原文；会记录模型、成功状态、耗时、Token 用量、脱敏错误码和关联 ID，用于排查重复调用及故障。</p>
    </section>

    <section className="card space-y-3">
      <h2 className="text-xl font-bold">你的 API Key</h2>
      <p className="text-sm leading-6 text-muted">你选择的 AI 服务商 API Key 默认只保存在当前页面内存中。只有你主动勾选“在本次浏览会话中记住 API Key”时，Key 才会写入当前标签页、当前网站来源的 sessionStorage，供同一标签页刷新恢复；关闭标签页、断开连接或主动清除后失效。请只在可信设备使用该选项。</p>
      <p className="text-sm leading-6 text-muted">Key 会随当前 HTTPS 请求发送到 AI-LifeOS 服务端。服务端只用它访问你所选服务商经审核的固定官方地址，不持久化到数据库、文件、Cookie 或普通日志。Key 不写入 localStorage、IndexedDB、URL 或分析事件；只有你主动选择记住时，才写入当前标签页的 sessionStorage。</p>
      <p className="text-sm leading-6 text-amber-100">免费额度可能有限，也可能有期限或模型限制。是否产生费用由你所选 AI 服务商账户的实际配置决定；AI-LifeOS 不承诺永久免费或绝对零费用。</p>
    </section>

    <section className="card space-y-3">
      <h2 className="text-xl font-bold">Public Beta 边界</h2>
      <p className="text-sm leading-6 text-muted">这是小规模测试版本。请不要输入不希望发送给所选 AI 服务商的高度敏感信息。发现数据或安全问题时，请停止使用 AI 连接、导出本地备份，并联系测试组织者。</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <a href="/terms" className="text-cyan-300 underline">使用说明</a>
        <a href="/source" className="text-cyan-300 underline">源代码与许可证</a>
      </div>
    </section>
  </main>
}
