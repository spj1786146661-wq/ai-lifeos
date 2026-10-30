'use client'

import { useMemo, useState } from 'react'
import {
  byokConnectionLabel,
  byokStatusFromErrorCode,
  type ByokConnection,
  type ByokConnectionStatus,
} from '@/lib/ai/byok-connection'
import {
  forgetRememberedByokApiKey,
  updateRememberedByokConnection,
} from '@/lib/ai/byok-session-memory'
import {
  getProviderDefinition,
  resolveProviderModel,
} from '@/lib/ai/provider-registry'
import {
  BYOK_PROVIDER_IDS,
  type ByokProviderId,
} from '@/lib/ai/provider-types'
import { readOrCreateLifeClientSessionId } from '@/lib/life-client-session'

const WIZARD_STEP_KEY = 'aios:byok-wizard-step:v2'
const THIRD_PARTY_AI_NOTICE_KEY = 'aios:third-party-ai-notice:v2'
const THIRD_PARTY_AI_NOTICE_VERSION = '2026-10-30-v1'
const BIGMODEL_INVITE = 'https://www.bigmodel.cn/invite?icode=5PuOaYn30hiiicmd1LCQhXHEaazDlIZGj9HxftzTbt4%3D'

type Step = 1 | 2 | 3

function secureKeyTransportAvailable(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'https:'
    || ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
}

function statusMessage(status: ByokConnectionStatus, providerName: string): string {
  if (status === 'invalid_key') return `API Key 无效，请回到${providerName}控制台重新复制。`
  if (status === 'not_authorized') return '账号、地区或当前模型尚未获得调用权限。'
  if (status === 'quota_or_rate_limited') return '额度不足、计费受限或请求过于频繁，请检查服务商控制台。'
  if (status === 'network_timeout') return '连接超时或网络不可达，请稍后重试。'
  if (status === 'invalid_schema') return '模型已响应，但结果未通过 AI-LifeOS 生活记录结构校验。'
  return ''
}

export default function AiModelConnection({
  connection,
  restoredFromSession,
  onConnected,
  onDisconnected,
  onStartRecording,
}: {
  connection: ByokConnection | null
  restoredFromSession: boolean
  onConnected: (connection: ByokConnection) => void
  onDisconnected: () => void
  onStartRecording: () => void
}) {
  const [step, setStep] = useState<Step>(() => {
    if (typeof window === 'undefined') return 1
    try {
      const saved = Number(window.sessionStorage.getItem(WIZARD_STEP_KEY))
      return saved === 2 || saved === 3 ? saved : 1
    } catch {
      return 1
    }
  })
  const [provider, setProvider] = useState<ByokProviderId>(
    connection?.provider ?? 'tokenhub',
  )
  const providerDefinition = getProviderDefinition(provider)
  const [model, setModel] = useState(
    connection?.model ?? providerDefinition.defaultModel,
  )
  const [manualModel, setManualModel] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [rememberForSession, setRememberForSession] = useState(restoredFromSession)
  const [restoredConnectionUnverified, setRestoredConnectionUnverified] = useState(restoredFromSession)
  const [status, setStatus] = useState<ByokConnectionStatus>(
    connection ? 'connected' : 'disconnected',
  )
  const [notice, setNotice] = useState('')
  const [noticeAccepted, setNoticeAccepted] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(THIRD_PARTY_AI_NOTICE_KEY)
        === THIRD_PARTY_AI_NOTICE_VERSION
    } catch {
      return false
    }
  })
  const [usage, setUsage] = useState<{
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
  } | null>(null)
  const selectedModel = useMemo(
    () => providerDefinition.models.find(item => item.id === model) ?? null,
    [model, providerDefinition.models],
  )

  function selectStep(next: Step) {
    setStep(next)
    try { window.sessionStorage.setItem(WIZARD_STEP_KEY, String(next)) } catch { /* no-op */ }
  }

  function selectProvider(nextProvider: ByokProviderId) {
    const next = getProviderDefinition(nextProvider)
    setProvider(nextProvider)
    setModel(next.defaultModel)
    setManualModel(false)
    setStatus(connection?.provider === nextProvider ? 'connected' : 'disconnected')
    setNotice('')
    setUsage(null)
    selectStep(1)
  }

  async function testConnection() {
    if (!secureKeyTransportAvailable()) {
      setStatus('network_timeout')
      setNotice('公网输入 API Key 必须使用 HTTPS。当前页面未启用安全传输。')
      return
    }
    const submittedKey = apiKey.trim()
    if (!noticeAccepted) {
      setStatus('disconnected')
      setNotice('请先阅读并确认第三方 AI、隐私和费用说明。')
      return
    }
    if (!submittedKey) {
      setStatus('invalid_key')
      setNotice(`请先粘贴自己的${providerDefinition.displayName} API Key。`)
      return
    }
    let resolved
    try {
      resolved = resolveProviderModel(provider, model)
    } catch (error) {
      setStatus('invalid_schema')
      setNotice(error instanceof Error ? error.message : '模型配置无效')
      return
    }
    setStatus('testing')
    setNotice('正在用合成生活记录验证真实模型；不会读取或写入你的生活记录。')
    setUsage(null)
    try {
      const clientSessionId = readOrCreateLifeClientSessionId(window.sessionStorage, '')
      const response = await fetch('/api/ai/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: resolved.model,
          apiKey: submittedKey,
          clientSessionId,
          actionId: crypto.randomUUID(),
        }),
      })
      const data = await response.json() as {
        status?: ByokConnectionStatus
        error?: string
        code?: string
        provider?: ByokProviderId
        model?: string
        usage?: {
          inputTokens: number | null
          outputTokens: number | null
          totalTokens: number | null
        } | null
      }
      if (
        !response.ok
        || data.status !== 'connected'
        || data.provider !== provider
        || !data.model
      ) {
        const nextStatus = data.status
          && data.status !== 'connected'
          && data.status !== 'testing'
          && data.status !== 'disconnected'
          ? data.status
          : byokStatusFromErrorCode(data.code)
        setStatus(nextStatus)
        setNotice(data.error ?? statusMessage(nextStatus, providerDefinition.displayName))
        return
      }
      const nextConnection: ByokConnection = {
        provider,
        apiKey: submittedKey,
        model: data.model,
      }
      const sessionMemoryUpdated = updateRememberedByokConnection(
        window.sessionStorage,
        rememberForSession,
        nextConnection,
      )
      if (!sessionMemoryUpdated && rememberForSession) {
        setNotice('连接测试通过，但浏览器未能记住 Key；刷新后需要重新连接。')
      }
      onConnected(nextConnection)
      setModel(data.model)
      setApiKey('')
      setRestoredConnectionUnverified(false)
      setStatus('connected')
      setUsage(data.usage ?? null)
      if (!rememberForSession) {
        setNotice('连接测试通过。Key 只保存在当前页面内存中；刷新页面后需要重新连接。')
      } else if (sessionMemoryUpdated) {
        setNotice('连接测试通过。Key 已按你的选择记住到本标签页的浏览会话。')
      }
      selectStep(3)
    } catch {
      setStatus('network_timeout')
      setNotice('网络请求失败或超时，请检查连接后重试。')
    }
  }

  function setThirdPartyNoticeAccepted(accepted: boolean) {
    setNoticeAccepted(accepted)
    try {
      if (accepted) {
        window.localStorage.setItem(THIRD_PARTY_AI_NOTICE_KEY, THIRD_PARTY_AI_NOTICE_VERSION)
      } else {
        window.localStorage.removeItem(THIRD_PARTY_AI_NOTICE_KEY)
      }
    } catch {
      // Consent remains effective for the mounted page when storage is unavailable.
    }
  }

  function setRememberPreference(remember: boolean) {
    setRememberForSession(remember)
    if (remember) return
    forgetRememberedByokApiKey(window.sessionStorage)
    if (connection) {
      setNotice('已清除浏览会话中的 Key；当前页面连接仍可继续使用，刷新后需要重新连接。')
    }
  }

  function clearRememberedKey() {
    forgetRememberedByokApiKey(window.sessionStorage)
    setRememberForSession(false)
    setNotice(connection
      ? '已清除浏览会话中的 Key；当前页面连接仍可继续使用，刷新后需要重新连接。'
      : '已清除本次浏览会话中记住的 Key。')
  }

  function disconnect() {
    forgetRememberedByokApiKey(window.sessionStorage)
    setApiKey('')
    setRememberForSession(false)
    setRestoredConnectionUnverified(false)
    setUsage(null)
    setStatus('disconnected')
    setNotice('连接已清除。当前页面内存和本次浏览会话中都不再保留该 API Key。')
    onDisconnected()
  }

  return <section className="card space-y-4" aria-labelledby="ai-connection-title">
    <div>
      <p className="font-mono text-[10px] tracking-[0.2em] text-cyan-300">3 STEPS / BYOK</p>
      <h3 id="ai-connection-title" className="mt-1 text-lg font-black">AI 连接 · 选择你自己的模型</h3>
      <p className="mt-2 text-sm leading-6 text-muted">选择服务商和模型，填写自己的 API Key。Base URL 固定为服务商官方地址，不能自定义。</p>
    </div>

    <ol className="grid gap-3" aria-label="AI 连接步骤">
      <li className={`rounded-2xl border p-4 ${step === 1 ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-cyan-300/15 bg-[#0b1830]/70'}`}>
        <div className="flex items-center justify-between gap-3"><strong>1. 选择服务商与模型</strong><span className="font-mono text-xs text-cyan-300">STEP 01</span></div>
        <label className="mt-3 block text-xs font-semibold text-cyan-100">AI 服务商
          <select
            value={provider}
            onChange={event => selectProvider(event.target.value as ByokProviderId)}
            className="mt-2 w-full rounded-xl border border-cyan-300/25 bg-[#071326] px-3 py-3 text-base text-slate-100 outline-none focus:border-cyan-300"
          >
            {BYOK_PROVIDER_IDS.map(id => (
              <option key={id} value={id}>{getProviderDefinition(id).displayName}</option>
            ))}
          </select>
        </label>
        {!manualModel && <label className="mt-3 block text-xs font-semibold text-cyan-100">模型
          <select
            value={model}
            onChange={event => {
              setModel(event.target.value)
              setStatus('disconnected')
              setNotice('')
            }}
            className="mt-2 w-full rounded-xl border border-cyan-300/25 bg-[#071326] px-3 py-3 text-base text-slate-100 outline-none focus:border-cyan-300"
          >
            {providerDefinition.models.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}{item.supportsVision ? ' · 模型支持图片' : ' · 文字'}
              </option>
            ))}
          </select>
        </label>}
        {manualModel && <label className="mt-3 block text-xs font-semibold text-cyan-100">模型 ID
          <input
            value={model}
            onChange={event => setModel(event.target.value)}
            placeholder={providerDefinition.defaultModel}
            className="mt-2 w-full rounded-xl border border-cyan-300/25 bg-[#071326] px-3 py-3 text-base text-slate-100 outline-none focus:border-cyan-300"
          />
        </label>}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button type="button" onClick={() => setManualModel(value => !value)} className="font-semibold text-cyan-200 underline">
            {manualModel ? '使用推荐模型列表' : '手动填写模型 ID'}
          </button>
          <span className="text-muted">
            {selectedModel?.supportsVision
              ? '模型标注支持图片；当前文字记录流程暂未开放图片上传'
              : '当前流程使用文字记录能力'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <a href={providerDefinition.keyUrl} target="_blank" rel="noreferrer noopener" onClick={() => selectStep(2)} className="font-semibold text-cyan-200 underline">打开官方 API Key 管理</a>
          <a href={providerDefinition.documentationUrl} target="_blank" rel="noreferrer noopener" className="text-muted underline">官方 API 文档</a>
        </div>
        {provider === 'bigmodel' && <a href={BIGMODEL_INVITE} target="_blank" rel="noreferrer noopener sponsored" className="mt-3 inline-flex text-xs font-semibold text-cyan-200 underline">智谱 BigModel 推广邀请链接</a>}
      </li>

      <li className={`rounded-2xl border p-4 ${step === 2 ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-cyan-300/15 bg-[#0b1830]/70'}`}>
        <div className="flex items-center justify-between gap-3"><strong>2. 粘贴连接密钥</strong><span className="font-mono text-xs text-cyan-300">STEP 02</span></div>
        <p className="mt-2 text-xs leading-5 text-muted">API Key 由你申请和管理。请检查 {providerDefinition.displayName} 的计费状态、消费限制和模型授权范围。</p>
        <label className="mt-3 block text-xs font-semibold text-cyan-100">粘贴 API Key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onFocus={() => selectStep(2)}
            onChange={event => {
              setApiKey(event.target.value)
              setStatus('disconnected')
              setNotice('')
            }}
            placeholder="默认仅保存在当前页面内存"
            className="mt-2 w-full rounded-xl border border-cyan-300/25 bg-[#071326] px-3 py-3 text-base text-slate-100 outline-none focus:border-cyan-300"
          />
        </label>
        <label className="mt-3 flex items-start gap-2 rounded-xl border border-cyan-300/15 bg-black/10 p-3 text-xs leading-5 text-slate-200">
          <input
            type="checkbox"
            checked={rememberForSession}
            onChange={event => setRememberPreference(event.target.checked)}
            className="mt-1"
          />
          <span>
            在本次浏览会话中记住 API Key
            <span className="mt-1 block text-muted">仅写入此标签页、此网站来源的 sessionStorage；默认关闭。关闭标签页或主动清除后失效。</span>
          </span>
        </label>
        {rememberForSession && <button type="button" onClick={clearRememberedKey} className="mt-2 text-xs font-semibold text-amber-200 underline">清除已记住的 Key</button>}
      </li>

      <li className={`rounded-2xl border p-4 ${step === 3 ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-cyan-300/15 bg-[#0b1830]/70'}`}>
        <div className="flex items-center justify-between gap-3"><strong>3. 连接并测试</strong><span className="font-mono text-xs text-cyan-300">STEP 03</span></div>
        <p className="mt-2 text-xs leading-5 text-muted">测试会发送合成文本并消耗少量第三方 Tokens；通过真实推理及结构校验后才会显示连接成功。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={!noticeAccepted || status === 'testing' || (!apiKey.trim() && !connection)} onClick={() => void testConnection()} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-bold text-[#071326] disabled:opacity-40">{status === 'testing' ? '正在验证…' : connection ? '使用新 Key 重新测试' : '连接并测试'}</button>
          {connection && <button type="button" onClick={disconnect} className="rounded-xl border border-red-300/30 px-4 py-2 text-sm text-red-200">断开连接</button>}
          {connection && <button type="button" onClick={onStartRecording} className="rounded-xl border border-cyan-300/40 px-4 py-2 text-sm font-semibold text-cyan-100">开始生活记录</button>}
        </div>
        <p className={`mt-3 rounded-xl border p-3 text-xs leading-5 ${status === 'connected' ? 'border-emerald-300/30 bg-emerald-950/30 text-emerald-100' : status === 'disconnected' || status === 'testing' ? 'border-cyan-300/20 bg-cyan-950/20 text-cyan-100' : 'border-amber-300/30 bg-amber-950/30 text-amber-100'}`} role="status">
          {status === 'connected' && connection
            ? restoredConnectionUnverified
              ? `已恢复浏览会话连接 · ${byokConnectionLabel(connection)}`
              : `已验证连接可用 · ${byokConnectionLabel(connection)}`
            : notice || '尚未连接'}
        </p>
        {restoredConnectionUnverified && status === 'connected'
          ? <p className="mt-2 text-xs leading-5 text-muted">{notice || '已从本次浏览会话恢复 Key；本页面尚未重新执行连接测试。'}</p>
          : notice && status !== 'connected' && <p className="mt-2 text-xs leading-5 text-muted">{notice}</p>}
        {usage && <p className="mt-2 font-mono text-[11px] text-muted">测试 Tokens：输入 {usage.inputTokens ?? '未知'} / 输出 {usage.outputTokens ?? '未知'} / 合计 {usage.totalTokens ?? '未知'}</p>}
      </li>
    </ol>

    <div className="rounded-xl border border-amber-300/25 bg-amber-950/25 p-3 text-xs leading-5 text-amber-100">
      <p>AI 模型由 {providerDefinition.displayName} 提供。使用 AI 解析时，相应生活描述会发送给该服务商。</p>
      <p className="mt-1">免费额度、期限、模型限制及费用由服务商决定。AI-LifeOS 不承诺永久免费或绝不扣费。</p>
      <p className="mt-1">Key 不写入 localStorage、IndexedDB、Cookie 或 URL。默认只在当前页面内存；只有你主动勾选时，才写入当前标签页的 sessionStorage。</p>
      <p className="mt-1">详细说明见 <a href="/privacy" className="font-semibold text-cyan-200 underline">隐私说明</a> 和 <a href="/terms" className="font-semibold text-cyan-200 underline">Public Beta 使用说明</a>。</p>
      <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200/20 bg-black/10 p-3 text-sm">
        <input
          type="checkbox"
          checked={noticeAccepted}
          onChange={event => setThirdPartyNoticeAccepted(event.target.checked)}
          className="mt-1"
        />
        <span>我已了解：AI 解析会把本次相关生活描述发送给 {providerDefinition.displayName}；费用、免费权益和计费限制由服务商决定。</span>
      </label>
    </div>
  </section>
}
