'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthChange, signInWithEmail, signOut } from '@/lib/firebase/auth'
import CapsuleDashboard from '@/components/life-records/CapsuleDashboard'
import AttachmentView from '@/components/life-records/AttachmentView'
import DuplicateReviewPrompt from '@/components/life-records/DuplicateReviewPrompt'
import ImageComposer from '@/components/life-records/ImageComposer'
import LifeCalendar from '@/components/life-records/LifeCalendar'
import OpenSourceNotice from '@/components/life-records/OpenSourceNotice'
import PendingImageReview from '@/components/life-records/PendingImageReview'
import RecordFields from '@/components/life-records/RecordFields'
import SmartFollowUps, { type SmartFollowUpItem } from '@/components/life-records/SmartFollowUps'
import SourceFragmentEditor from '@/components/life-records/SourceFragmentEditor'
import TotalRecordManager from '@/components/life-records/TotalRecordManager'
import AiModelConnection from '@/components/life-records/AiModelConnection'
import type { ByokConnection } from '@/lib/ai/byok-connection'
import { readRememberedByokConnection } from '@/lib/ai/byok-session-memory'
import {
  isByokProviderId,
  isLifeRecordProvider,
} from '@/lib/ai/provider-types'
import { exportBackupWithAttachments, getAttachmentStorage, hasFirebaseConfig, recordStorage, resetLocalStorageRoute, restoreBackupWithAttachments, withRecordWriteLock } from '@/lib/life-record-store'
import { attachFilesToExistingRecord, removeRecordAndUnusedAttachments, saveNewRecordsWithAttachments } from '@/lib/life-attachment-service'
import { bulkDeleteOutcomeMessage, deleteRecordsByIds, type BulkDeleteSnapshot } from '@/lib/life-record-bulk-delete'
import { readOrCreateLifeClientSessionId } from '@/lib/life-client-session'
import { isPersonalAlphaByokClientSurface } from '@/lib/lan-access'
import { LIFE_RECORD_LABELS, lifeRecordSummary, normalizeLifeRecord, toPersistedLifeRecordDraft, type LifeRecord, type LifeRecordDraft, type LifeRecordSourceRef, type LifeRecordType } from '@/lib/life-records'
import { sourceFragmentFingerprint, type ReviewLifeRecordDraft } from '@/lib/life-record-duplicates'
import { annotateDuplicateReviewDrafts } from '@/lib/life-duplicate-review'
import { lifeRecordSourceLabel } from '@/lib/life-record-source'
import { searchLifeRecords } from '@/lib/life-search'
import { LifeSendGuard } from '@/lib/life-send-guard'
import { locateDraftInSource } from '@/lib/life-source-fragments'
import { remapPendingImageTarget, reviewIndexesToKeep } from '@/lib/life-review-selection'
import { autoSaveResultText, prepareAutoSaveBatch } from '@/lib/life-auto-save'
import {
  applyFollowUpAnswer,
  canGenerateNextFollowUpRound,
  filterKnownFollowUps,
  historyFromMappedFollowUps,
  mapFollowUpsToSavedRecords,
  normalizeFollowUpQuestions,
  normalizeSavedRecordFollowUpQuestions,
  updateFollowUpHistoryStatus,
  type LifeFollowUpAnswer,
  type LifeFollowUpHistoryItem,
} from '@/lib/life-follow-up'
import {
  FOLLOW_UP_SESSION_STORAGE_KEY,
  followUpSessionRecordIds,
  parseFollowUpSessionSnapshot,
  serializeFollowUpSessionSnapshot,
} from '@/lib/life-follow-up-session'
import { createMigrationTarget } from '@/lib/life-migration-routing'
import { MIGRATION_STATUS_LABELS, type MigrationState } from '@/lib/life-migration-state'
import { activateMigration, prepareMigration, readMigrationStatus, recoverInterruptedMigration } from '@/lib/life-migration-service'

// ─── ChatGPT 套餐授权（官方 Sign in with ChatGPT）─────────────────────────────
type PlanStatus = {
  mode: 'rule' | 'chatgpt' | 'openrouter' | 'unconfigured' | import('@/lib/ai/provider-types').ByokProviderId
  label: string
  remoteAvailable: boolean
  reason?: string
  model?: string
  authorized: boolean
  account: string | null
  scopes: string[]
  planUsageGranted: boolean
  expiresAt: string | null
  expired: boolean
  needsRefresh: boolean
}

const planUsable = (status: PlanStatus | null): boolean =>
  !!status && (
    isByokProviderId(status.mode)
      ? status.remoteAvailable
      : status.mode === 'chatgpt' && status.authorized && status.planUsageGranted
        && (status.needsRefresh || !status.expired)
  )

const EMPTY_PLAN_STATUS: PlanStatus = {
  mode: 'rule', label: '规则演示解析 · 未调用 AI', remoteAvailable: false, authorized: false,
  account: null, scopes: [], planUsageGranted: false, expiresAt: null, expired: false,
  needsRefresh: false,
}

/**
 * LAN devices receive the same app shell but deliberately cannot reach
 * server-side credentials or the loopback-only management APIs. The label
 * must say so plainly instead of implying that phone data is synced.
 */
function isLanClient(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
}

function isPublicBetaClient(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host !== 'localhost'
    && host !== '127.0.0.1'
    && host !== '::1'
    && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
}

function isPersonalAlphaByokClient(): boolean {
  if (typeof window === 'undefined') return false
  return isPersonalAlphaByokClientSurface(
    window.location.hostname,
    document.body.dataset.aiosPersonalAlphaByok,
  )
}

/** Never show a token, only the fact that a credential exists. */
function planStatusText(status: PlanStatus): string {
  if (status.mode === 'chatgpt') return `ChatGPT 套餐（${status.account ?? '已授权账号'}）`
  if (isByokProviderId(status.mode)) return status.label
  if (status.mode === 'unconfigured') return status.reason ?? 'AI 未配置'
  return '未配置模型 · 演示规则解析'
}

type Tab = 'capture' | 'dashboard' | 'profile'
/**
 * Four states, never collapsed:
 *  loading        → the server has not answered yet.
 *  demo           → local rule parsing; no model was called.
 *  ai             → a real remote model produced the result.
 *  unconfigured   → no model is usable, and the user is told so.
 */
type ParseMode = 'loading' | 'demo' | 'ai' | 'fallback-rule' | 'unconfigured'
type CalendarScreen = { kind: 'total' } | { kind: 'type'; type: LifeRecordType } | null
type ChatTurn = { id: string; role: 'user' | 'assistant'; content: string; label?: string; imageName?: string }
type ReviewDraft = ReviewLifeRecordDraft
const firebaseEnabled = hasFirebaseConfig()
const LOCAL_WRITE_BLOCKED_MESSAGE = '数据升级正在进行，已暂停本地记录写入。请等待升级完成，或关闭其它页面后重试。'

function todayLocal() {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

const recordDescription = lifeRecordSummary

function emptyDraft(type: LifeRecordType, date: string): LifeRecordDraft {
  return { type, date, note: '' }
}

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('capture')
  const [mode, setMode] = useState<ParseMode>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!firebaseEnabled)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [text, setText] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([])
  const [sourceEditorTurn, setSourceEditorTurn] = useState<string | null>(null)
  const [date, setDate] = useState(todayLocal)
  const [preview, setPreview] = useState<ReviewDraft[] | null>(null)
  const [previewEditingIndex, setPreviewEditingIndex] = useState<number | null>(null)
  const [previewNotice, setPreviewNotice] = useState('')
  const [previewSource, setPreviewSource] = useState('')
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null)
  // Which review card the pending image belongs to. null means "not decided",
  // so a batch of candidates never shares one image by default.
  const [pendingImageTarget, setPendingImageTarget] = useState<number | null>(null)
  const [imageStatus, setImageStatus] = useState('')
  const [records, setRecords] = useState<LifeRecord[]>([])
  const [savedBatch, setSavedBatch] = useState<LifeRecord[]>([])
  const [followUpItems, setFollowUpItems] = useState<SmartFollowUpItem[]>([])
  const [followUpRound, setFollowUpRound] = useState<1 | 2 | 3>(1)
  const [followUpHistory, setFollowUpHistory] = useState<LifeFollowUpHistoryItem[]>([])
  const [followUpMessageId, setFollowUpMessageId] = useState('')
  const [followUpRecordIds, setFollowUpRecordIds] = useState<string[]>([])
  const [followUpEnded, setFollowUpEnded] = useState(true)
  const [followUpBusy, setFollowUpBusy] = useState(false)
  const [followUpGenerating, setFollowUpGenerating] = useState(false)
  const [followUpNotice, setFollowUpNotice] = useState('')
  const [followUpError, setFollowUpError] = useState('')
  const [savedDeleteTarget, setSavedDeleteTarget] = useState<string | null>(null)
  const [pendingImageAttachingId, setPendingImageAttachingId] = useState<string | null>(null)
  const [historyFilter, setHistoryFilter] = useState<LifeRecordType | null>(null)
  const [calendarScreen, setCalendarScreen] = useState<CalendarScreen>(null)
  const [manageDate, setManageDate] = useState(todayLocal)
  const [historyManageOpen, setHistoryManageOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ id: string; draft: LifeRecordDraft } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [message, setMessage] = useState('')
  const [modeReason, setModeReason] = useState('')
  const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planNotice, setPlanNotice] = useState('')
  const [planError, setPlanError] = useState('')
  const [error, setError] = useState('')
  const [migrationState, setMigrationState] = useState<MigrationState | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [migrationNotice, setMigrationNotice] = useState('')
  const [migrationError, setMigrationError] = useState('')
  const [lanClient, setLanClient] = useState(false)
  const [publicBetaClient, setPublicBetaClient] = useState(false)
  const [personalAlphaByokClient, setPersonalAlphaByokClient] = useState(false)
  const [byokConnection, setByokConnection] = useState<ByokConnection | null>(null)
  const [byokRestoredFromSession, setByokRestoredFromSession] = useState(false)
  const savedFingerprints = useRef(new Set<string>())
  const sendLock = useRef(false)
  const confirmDuplicateLock = useRef(false)
  const sendGuard = useRef<LifeSendGuard | null>(null)
  const clientSessionId = useRef('')
  const byokClient = publicBetaClient || personalAlphaByokClient
  const followUpLock = useRef(false)
  const followUpGenerateLock = useRef(false)
  const followUpRestoreAttempted = useRef(false)
  // 正式迁移入口默认关闭，需显式设置 NEXT_PUBLIC_ENABLE_LOCAL_DB_MIGRATION=true。
  const migrationEnabled = process.env.NEXT_PUBLIC_ENABLE_LOCAL_DB_MIGRATION === 'true'

  function currentSendGuard(): LifeSendGuard {
    if (!sendGuard.current) sendGuard.current = new LifeSendGuard()
    return sendGuard.current
  }

  function currentClientSessionId(): string {
    clientSessionId.current = readOrCreateLifeClientSessionId(
      window.sessionStorage,
      clientSessionId.current,
    )
    return clientSessionId.current
  }

  function editDraftText(next: string): void {
    currentSendGuard().markDraftEdited()
    setText(next)
  }

  useEffect(() => {
    const lan = isLanClient()
    const publicBeta = isPublicBetaClient()
    const personalAlphaByok = isPersonalAlphaByokClient()
    setLanClient(lan)
    setPublicBetaClient(publicBeta)
    setPersonalAlphaByokClient(personalAlphaByok)
    if (lan) {
      // Server-side model and OAuth status stay loopback-only by policy.
      setMode('demo')
      setModeReason('局域网设备只保存自己的本地记录，不调用电脑上的模型凭据')
      return
    }
    const rememberedByokConnection = publicBeta || personalAlphaByok
      ? readRememberedByokConnection(window.sessionStorage)
      : null
    if (rememberedByokConnection) {
      setByokConnection(rememberedByokConnection)
      setByokRestoredFromSession(true)
      setMode('ai')
      setModeReason('已从本次浏览会话恢复 AI 服务商连接；本页面尚未重新执行连接测试')
    }
    if (publicBeta) {
      if (!rememberedByokConnection) {
        setMode('unconfigured')
        setModeReason('请在“我的 → AI 连接”中选择服务商、模型并填写自己的 API Key')
      }
    } else if (personalAlphaByok) {
      if (!rememberedByokConnection) {
        setMode('unconfigured')
        setModeReason('个人 Alpha 需要先完成 AI 服务商三步连接')
      }
    }
    if (!personalAlphaByok && !(publicBeta && rememberedByokConnection)) {
      fetch('/api/life-records/parse').then(response => response.json())
        .then(data => {
          const next = data?.mode
          setMode(next === 'ai' || next === 'demo' || next === 'unconfigured' ? next : 'demo')
          if (typeof data?.reason === 'string' && data.reason) setModeReason(data.reason)
        })
        .catch(() => setMode('demo'))
    }
    if (!firebaseEnabled) return
    try { return onAuthChange(current => { setUser(current); setAuthReady(true) }) }
    catch { setError('Firebase 配置无效，请检查本地环境变量。'); setAuthReady(true) }
  }, [])

  const localMode = !user
  const refresh = useCallback(async () => {
    setLoadingRecords(true)
    try {
      const loaded = await recordStorage.load(localMode ? null : user?.uid ?? null)
      setRecords(loaded)
      if (localMode && await recordStorage.isLocalDataCorrupted(null)) setError('检测到无法解析的本地记录数据，已停止写入以保护原始数据。请到「我的」页导出备份，或导入有效备份恢复。')
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '加载记录失败') }
    finally { setLoadingRecords(false) }
  }, [localMode, user?.uid])

  useEffect(() => { if (authReady && (!firebaseEnabled || user)) void refresh() }, [authReady, user, refresh])

  useEffect(() => {
    if (loadingRecords || followUpRestoreAttempted.current) return
    followUpRestoreAttempted.current = true
    let raw: string | null = null
    try {
      raw = window.sessionStorage.getItem(FOLLOW_UP_SESSION_STORAGE_KEY)
    } catch {
      return
    }
    const snapshot = parseFollowUpSessionSnapshot(raw)
    if (!snapshot) return
    const recordIds = new Set(followUpSessionRecordIds(snapshot))
    const sessionRecords = records.filter(record => recordIds.has(record.id))
    if (!sessionRecords.length) {
      try { window.sessionStorage.removeItem(FOLLOW_UP_SESSION_STORAGE_KEY) } catch { /* no-op */ }
      return
    }
    const questions = normalizeSavedRecordFollowUpQuestions(
      snapshot.items.map(item => item.question),
      sessionRecords,
      snapshot.round,
      snapshot.history,
    )
    const recordById = new Map(sessionRecords.map(record => [record.id, record]))
    const restoredItems = questions.flatMap(question => {
      const record = question.targetRecordId ? recordById.get(question.targetRecordId) : undefined
      return record ? [{
        question,
        recordId: record.id,
        recordType: record.type,
        recordSummary: recordDescription(record),
        round: question.round,
      }] : []
    })
    setFollowUpMessageId(snapshot.messageId)
    setFollowUpRecordIds([...recordIds])
    setFollowUpRound(snapshot.round)
    setFollowUpItems(restoredItems)
    setFollowUpHistory(snapshot.history)
    const canResumeRound = !snapshot.ended
      && snapshot.round < 3
      && snapshot.history.some(item => item.round === snapshot.round)
    setFollowUpEnded(snapshot.ended || (restoredItems.length === 0 && !canResumeRound))
    setFollowUpNotice(restoredItems.length
      ? '已恢复上次未完成的智能补充进度。'
      : '')
  }, [loadingRecords, records])

  useEffect(() => {
    if (!followUpMessageId) return
    try {
      window.sessionStorage.setItem(FOLLOW_UP_SESSION_STORAGE_KEY, serializeFollowUpSessionSnapshot({
        version: 1,
        messageId: followUpMessageId,
        round: followUpRound,
        ended: followUpEnded,
        recordIds: followUpRecordIds,
        items: followUpItems.map(item => ({ question: item.question, recordId: item.recordId })),
        history: followUpHistory,
      }))
    } catch {
      // Session persistence is a convenience; record writes remain authoritative.
    }
  }, [followUpMessageId, followUpRound, followUpEnded, followUpRecordIds, followUpItems, followUpHistory])

  // ChatGPT 套餐授权状态：只读取服务端摘要，绝不接触令牌本身。
  const refreshPlanStatus = useCallback(async () => {
    if (lanClient || byokClient) {
      setPlanStatus(EMPTY_PLAN_STATUS)
      return
    }
    try {
      const response = await fetch('/api/life-records/chatgpt-plan')
      const data = await response.json()
      if (response.ok) setPlanStatus(data as PlanStatus)
    } catch { setPlanStatus(EMPTY_PLAN_STATUS) }
  }, [lanClient, byokClient])

  useEffect(() => { void refreshPlanStatus() }, [refreshPlanStatus])

  /**
   * 由用户本人在浏览器完成官方授权。
   * 这里只打开发起地址并轮询回调节点，绝不代用户批准，也不读取任何已有登录缓存。
   */
  async function startChatgptPlanAuthorization() {
    setPlanBusy(true); setPlanError(''); setPlanNotice('')
    const authWindow = window.open('about:blank', '_blank')
    if (authWindow) authWindow.opener = null
    try {
      if (!authWindow) throw new Error('浏览器阻止了授权窗口，请允许此站点打开新窗口后重试')
      const response = await fetch('/api/life-records/chatgpt-plan/authorize', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '无法开始授权')
      authWindow.location.replace(data.authorizeUrl as string)
      setPlanNotice('已打开官方授权页面，请在弹出的浏览器窗口中登录并批准；完成后这里会自动更新。')
      const sessionId = data.sessionId as string
      const started = Date.now()
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        const poll = await fetch(`/api/life-records/chatgpt-plan/authorize?sessionId=${encodeURIComponent(sessionId)}`)
        const state = await poll.json()
        if (state.status === 'succeeded') break
        if (state.status === 'failed') throw new Error(state.error ?? '授权未完成')
        if (state.status === 'unknown') throw new Error('授权会话已失效，请重新开始')
        if (Date.now() - started > 10 * 60 * 1000) throw new Error('授权等待超时，请重新开始')
      }
      await refreshPlanStatus()
      setPlanNotice('授权已完成。现在可以使用你自己的 ChatGPT 套餐进行真实 AI 解析。')
    } catch (cause) {
      try { authWindow?.close() } catch { /* the browser may already have closed it */ }
      setPlanError(cause instanceof Error ? cause.message : '授权失败')
    } finally { setPlanBusy(false) }
  }

  async function disconnectChatgptPlan() {
    setPlanBusy(true); setPlanError(''); setPlanNotice('')
    try {
      const response = await fetch('/api/life-records/chatgpt-plan', { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '无法断开 ChatGPT 授权')
      await refreshPlanStatus()
      setPlanNotice(data.remoteRevoked
        ? '已撤销远程会话并删除本机授权。'
        : '本机授权已删除；远程撤销未确认，请稍后在 ChatGPT 设置的已连接应用检查。')
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : '断开授权失败')
    } finally { setPlanBusy(false) }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await signInWithEmail(email.trim(), password) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败') }
    finally { setBusy(false) }
  }

  function resetFollowUpSession() {
    followUpRestoreAttempted.current = true
    setFollowUpItems([])
    setFollowUpHistory([])
    setFollowUpMessageId('')
    setFollowUpRecordIds([])
    setFollowUpRound(1)
    setFollowUpEnded(true)
    setFollowUpNotice('')
    setFollowUpError('')
    try { window.sessionStorage.removeItem(FOLLOW_UP_SESSION_STORAGE_KEY) } catch { /* no-op */ }
  }

  async function sendMessage() {
    if ((!text.trim() && !imageFile) || busy || sendLock.current) return
    if (byokClient && !byokConnection) {
      setError('请先到“我的 → AI 连接 → 免费开启 AI”完成三步连接。')
      setTab('profile')
      return
    }
    if (byokClient && imageFile) {
      setError('当前 BYOK 模式暂未开放图片 AI，请先发送文字生活记录。')
      return
    }
    const guard = currentSendGuard()
    const begin = guard.begin({
      text,
      date,
      image: imageFile
        ? {
            name: imageFile.name,
            size: imageFile.size,
            lastModified: imageFile.lastModified,
          }
        : null,
    })
    if (begin.status !== 'accepted') return
    sendLock.current = true
    let actionSucceeded = false
    const submitted = text.trim()
    setBusy(true); setError(''); setMessage('')
    resetFollowUpSession()
    setText('')
    const messageId = begin.actionId
    setChatTurns(turns => [...turns, { id: messageId, role: 'user', content: submitted || (imageFile ? '识别这张图片' : ''), ...(imageFile ? { imageName: imageFile.name } : {}) }])
    setImageStatus(imageFile ? '正在识别图片；明确归属的记录会自动保存并关联图片。' : '')
    const pendingImage = imageFile
    try {
      const form = new FormData()
      if (pendingImage) { form.set('image', pendingImage); form.set('date', date); form.set('text', submitted) }
      const response = pendingImage
        ? await fetch('/api/life-records/image', { method: 'POST', body: form })
        : await fetch('/api/life-records/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: submitted,
              date,
              messageId,
              clientSessionId: currentClientSessionId(),
              records: records.map(record => normalizeLifeRecord(record, date)),
              ...(byokConnection ? { aiConnection: byokConnection } : {}),
            }),
          })
      const data = await response.json()
      // A 503 from the image route means "vision is not configured". The image is
      // kept for the user to label manually, so it must not become a dead end.
      const imageUnavailable = pendingImage !== null && response.status === 503
      if (!response.ok && !imageUnavailable) throw new Error(data.error ?? '处理失败')
      actionSucceeded = true
      if (data.intent === 'analysis') {
        setChatTurns(turns => [...turns, { id: crypto.randomUUID(), role: 'assistant', content: data.answer, label: `${data.periodLabel} · ${data.mode === 'ai' ? 'AI 分析' : data.mode === 'data' ? '无数据 · 未调用 AI' : '本地统计 · 未调用 AI'}` }])
      } else {
        // The server is the only authority on which source answered.
        setMode(data.mode === 'ai' || data.mode === 'demo' || data.mode === 'fallback-rule' || data.mode === 'unconfigured' ? data.mode : 'demo')
        if (typeof data.reason === 'string') setModeReason(data.reason)
        if (typeof data.notice === 'string' && data.notice) setMessage(data.notice)
        const parsed = ((data.records ?? []) as LifeRecordDraft[]).map(draft => ({
          ...draft,
          ...(pendingImage ? { candidate: true } : {}),
          sourceRef: draft.sourceRef ? {
            ...draft.sourceRef,
            ...(isLifeRecordProvider(data.provider)
              ? { provider: data.provider }
              : {}),
            ...(typeof data.model === 'string' && data.model ? { model: data.model } : {}),
          } : (() => {
            const span = locateDraftInSource(submitted, draft)
            return span ? {
              messageId,
              start: span.start,
              end: span.end,
              text: span.text,
              origin: data.mode === 'ai' ? 'ai' as const : 'rule' as const,
              ...(isLifeRecordProvider(data.provider)
                ? { provider: data.provider }
                : {}),
              ...(typeof data.model === 'string' && data.model ? { model: data.model } : {}),
            } satisfies LifeRecordSourceRef : undefined
          })(),
        }))
        setPreviewEditingIndex(null); setPreviewNotice('')
        setPreviewSource(pendingImage ? `${submitted ? submitted + ' · ' : ''}图片识别` : submitted)
        setPendingImageFile(pendingImage)
        // A single image is never spread across several candidates: the user
        // picks the one card it belongs to before saving.
        setPendingImageTarget(parsed.length === 1 ? 0 : null)
        if (pendingImage) setImageFile(null)
        if (imageUnavailable) {
          const review = parsed.length ? parsed : pendingImage ? [{ ...emptyDraft('meal', date), candidate: true }] : []
          setPreview(review.length ? review : null)
          setImageStatus('视觉识别尚未配置：未调用 AI，也未生成任何识别内容。请在下方为图片选择分类并补全字段，确认后图片才会写入本机附件库。')
          setChatTurns(turns => [...turns, { id: crypto.randomUUID(), role: 'assistant', content: submitted
            ? '这张图片没有调用 AI。你可以在上面原话中选择片段并指定分类，或展开下方「为图片添加记录」；确认后图片和记录才会保存。'
            : '这张图片没有调用 AI。请在下方选择分类并补全必要字段，确认后才会保存。', label: '图片识别未配置 · 未调用 AI' }])
          return
        }
        if (!parsed.length) {
          setPreview(null)
          setPendingImageFile(null)
          setPendingImageTarget(null)
          setChatTurns(turns => [...turns, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: pendingImage ? '图片里没有可靠识别出的饮食信息。请换一张更清晰的图片，或手动添加记录。' : '这句话暂未识别出可保存的数据。可以换种说法，或展开「手动添加」。',
            label: data.mode === 'ai'
              ? `真实 AI 提取${data.model ? ' · ' + data.model : ''}`
              : data.mode === 'fallback-rule'
                ? '真实模型不完整/不可用 · 本地规则补回 · 未冒充 AI'
                : data.mode === 'unconfigured'
                  ? 'AI 未配置 · 未调用 AI'
                  : '本地规则解析 · 未调用 AI',
          }])
          return
        }
        const saveOutcome = await persistReviewBatch(parsed, {
          sourceText: pendingImage ? `${submitted ? submitted + ' · ' : ''}图片识别` : submitted,
          files: pendingImage ? [pendingImage] : [],
          imageTargetIndex: pendingImage ? (parsed.length === 1 ? 0 : null) : undefined,
        })
        const mappedFollowUps = mapFollowUpsToSavedRecords(
          filterKnownFollowUps(
            normalizeFollowUpQuestions(data.followUps, parsed),
            parsed,
          ),
          saveOutcome.originalIndexes,
          saveOutcome.skippedIndexes,
          saveOutcome.records,
        )
        const initialFollowUpItems = mappedFollowUps.map(item => ({
          question: item.question,
          recordId: item.recordId,
          recordType: item.record.type,
          recordSummary: recordDescription(item.record),
          round: item.question.round,
        }))
        setFollowUpItems(initialFollowUpItems)
        setFollowUpHistory(historyFromMappedFollowUps(mappedFollowUps))
        setFollowUpMessageId(messageId)
        setFollowUpRecordIds(saveOutcome.records.map(record => record.id).filter(Boolean))
        setFollowUpRound(1)
        setFollowUpEnded(initialFollowUpItems.length === 0)
        setFollowUpNotice(data.mode === 'ai' && initialFollowUpItems.some(item => item.question.origin === 'ai')
          ? '第一轮问题由真实 AI 联合评估本次全部已保存记录后生成。'
          : initialFollowUpItems.length
            ? '当前问题来自规则降级；只有你主动继续下一轮时才可能调用 AI。'
            : '')
        const incompleteCount = saveOutcome.incompleteIndexes.length
        const skippedPreviewIndexes = saveOutcome.skippedIndexes.map(index => saveOutcome.originalIndexes[index])
        const remainingOriginalIndexes = reviewIndexesToKeep(
          parsed.length,
          saveOutcome.incompleteIndexes,
          skippedPreviewIndexes,
        )
        const annotated = annotateDuplicateReviewDrafts(
          parsed,
          saveOutcome.originalIndexes,
          saveOutcome.duplicateMatches,
        )
        const remaining = annotated.filter((_, index) => remainingOriginalIndexes.includes(index))
        setPreview(remaining.length ? remaining : null)
        if (pendingImage && !saveOutcome.attachmentSaved) {
          setPendingImageTarget(remapPendingImageTarget(remainingOriginalIndexes, pendingImageTarget))
          setImageStatus(pendingImageTarget === null
            ? '图片尚未保存：多条候选未明确图片归属。请选择一条需要调整或重复的记录，或取消图片。'
            : '图片尚未保存：它关联的记录被判定为重复。可选择该记录并标记为另一次真实事件后重试。')
        } else {
          setPendingImageFile(null)
          setPendingImageTarget(null)
          setImageStatus('')
        }
        if (saveOutcome.skippedCount) {
          setPreviewNotice('识别成功，但发现已有相似记录。可查看或修改旧记录，也可以明确确认这是新事件后再添加。')
        }
        const resultText = autoSaveResultText(saveOutcome.createdCount, saveOutcome.skippedCount, incompleteCount)
        setMessage(resultText)
        setChatTurns(turns => [...turns, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: resultText + (remaining.length
            ? ' 需要调整或确认的原文仍保留在下方。'
            : saveOutcome.createdCount
              ? ' 已写入当前权威存储。'
              : ' 没有新增副本。'),
          label: data.mode === 'ai'
            ? `真实 AI 提取${data.model ? ' · ' + data.model : ''}`
            : data.mode === 'fallback-rule'
              ? '真实模型不完整/不可用 · 本地规则补回 · 未冒充 AI'
              : data.mode === 'unconfigured'
                ? 'AI 未配置 · 未调用 AI'
                : '本地规则解析 · 未调用 AI',
        }])
      }
    } catch (cause) {
      actionSucceeded = false
      setError(cause instanceof Error ? cause.message : '处理失败')
      if (submitted) setText(current => current || submitted)
    }
    finally {
      guard.finish(begin.draftKey, actionSucceeded)
      sendLock.current = false
      setBusy(false)
    }
  }

  async function persistReviewBatch(
    candidates: readonly ReviewDraft[],
    options: {
      sourceText: string
      files: readonly File[]
      imageTargetIndex?: number | null
      appendSavedBatch?: boolean
    },
  ) {
    if (localMode && (migrationState?.status === 'IN_PROGRESS' || migrationState?.status === 'VERIFYING')) {
      throw new Error(LOCAL_WRITE_BLOCKED_MESSAGE)
    }
    const prepared = prepareAutoSaveBatch(candidates, date)
    if (prepared.drafts.length === 0) {
      return {
        records: [],
        createdCount: 0,
        skippedCount: 0,
        skippedIndexes: [],
        duplicateMatches: [],
        originalIndexes: prepared.originalIndexes,
        incompleteIndexes: prepared.incompleteIndexes,
        attachmentSaved: false,
      }
    }
    const userId = localMode ? null : user?.uid ?? null
    const outcome = await saveNewRecordsWithAttachments({
      recordStorage,
      attachmentStorage: getAttachmentStorage(),
      userId,
      drafts: prepared.drafts,
      sourceText: options.sourceText,
      files: options.files,
      existingRecords: records,
      attachmentTargetIndex: options.imageTargetIndex,
      withAuthoritativeWriteLock: write => withRecordWriteLock(userId, async storage => {
        const guardedRecordStorage = {
          ...recordStorage,
          load: storage.load.bind(storage),
          create: storage.create.bind(storage),
        }
        return write(guardedRecordStorage)
      }),
    })
    const createdFingerprints = outcome.records.flatMap(record => record.sourceRef ? [sourceFragmentFingerprint(record)] : [])
    savedFingerprints.current = new Set([...savedFingerprints.current, ...createdFingerprints])
    await refresh()
    setSavedBatch(current => options.appendSavedBatch
      ? [...outcome.records, ...current]
      : outcome.records)
    return {
      records: outcome.records,
      createdCount: outcome.createdCount,
      skippedCount: outcome.skippedCount,
      skippedIndexes: outcome.skippedIndexes,
      duplicateMatches: outcome.duplicateMatches,
      originalIndexes: prepared.originalIndexes,
      incompleteIndexes: prepared.incompleteIndexes,
      attachmentSaved: outcome.attachmentSaved,
    }
  }

  async function confirmSave() {
    if (!preview?.length || busy) return
    setBusy(true); setError('')
    try {
      const imageTargetDraft = pendingImageTarget === null ? null : preview[pendingImageTarget] ?? null
      const imageTargetFingerprint = imageTargetDraft
        ? sourceFragmentFingerprint(imageTargetDraft, previewSource)
        : null
      const mappedImageTarget = pendingImageFile && pendingImageTarget !== null && imageTargetFingerprint
        ? preview.findIndex(draft => sourceFragmentFingerprint(draft, previewSource) === imageTargetFingerprint)
        : null
      if (pendingImageFile && pendingImageTarget !== null && mappedImageTarget !== null && mappedImageTarget < 0) {
        setError('这张图片关联的记录还缺必要字段，请先补全，或重新选择图片归属。')
        return
      }
      const outcome = await persistReviewBatch(preview, {
        sourceText: previewSource,
        files: pendingImageFile ? [pendingImageFile] : [],
        imageTargetIndex: mappedImageTarget !== null && mappedImageTarget >= 0 ? mappedImageTarget : undefined,
      })
      const skippedPreviewIndexes = outcome.skippedIndexes.map(index => outcome.originalIndexes[index])
      const remainingOriginalIndexes = reviewIndexesToKeep(
        preview.length,
        outcome.incompleteIndexes,
        skippedPreviewIndexes,
      )
      const annotated = annotateDuplicateReviewDrafts(
        preview,
        outcome.originalIndexes,
        outcome.duplicateMatches,
      )
      const remaining = annotated.filter((_, index) => remainingOriginalIndexes.includes(index))
      setPreview(remaining.length ? remaining : null)
      setPreviewEditingIndex(null)
      if (pendingImageFile && !outcome.attachmentSaved) {
        setPendingImageTarget(remapPendingImageTarget(remainingOriginalIndexes, pendingImageTarget))
        setImageStatus('图片尚未保存：请为它选择一条已成功保存的记录，或取消图片。')
      } else {
        setPendingImageFile(null)
        setPendingImageTarget(null)
        setImageStatus('')
      }
      setMessage(autoSaveResultText(outcome.createdCount, outcome.skippedCount, outcome.incompleteIndexes.length))
      setPreviewNotice(outcome.skippedCount
        ? '识别成功，但发现已有相似记录。可查看或修改旧记录，也可以明确确认这是新事件后再添加。'
        : '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
      if (cause instanceof Error && cause.name === 'LocalWriteBlockedError') await refreshMigrationStatus()
    } finally { setBusy(false) }
  }

  function updatePreviewDraft(index: number, next: LifeRecordDraft) {
    setPreview(items => items?.map((item, i) => {
      if (i !== index) return item
      const merged: ReviewDraft = {
        ...next,
        sourceRef: item.sourceRef,
        attachments: item.attachments,
        ...(item.forceNewRecord ? { forceNewRecord: true } : {}),
      }
      try {
        normalizeLifeRecord(merged, date)
        return { ...merged, needsFields: false, missingReason: undefined }
      } catch {
        return merged
      }
    }) ?? null)
  }

  function markForcedNewEvent(index: number) {
    setPreview(items => items?.map((item, current) => current === index
      ? {
          ...item,
          forceNewRecord: !item.forceNewRecord,
          needsFields: item.needsFields,
          missingReason: item.missingReason,
        }
      : item) ?? null)
    setPreviewNotice('已标记为另一次真实事件。只有你确认后才会作为新记录保存。')
  }

  function removePreviewDraft(index: number) {
    const remainingIndexes = preview?.map((_, current) => current).filter(current => current !== index) ?? []
    setPreview(items => {
      const remaining = items?.filter((_, current) => current !== index) ?? null
      return remaining?.length ? remaining : null
    })
    if (pendingImageFile && pendingImageTarget !== null) {
      setPendingImageTarget(remapPendingImageTarget(remainingIndexes, pendingImageTarget))
      if (!remainingIndexes.includes(pendingImageTarget)) {
        setImageStatus('图片尚未保存：原来的关联候选已移除，请重新选择图片归属或取消图片。')
      }
    }
    setPreviewEditingIndex(null)
    setPreviewNotice('')
  }

  function editDuplicateExistingRecord(recordId: string) {
    const existing = records.find(record => record.id === recordId)
    if (!existing) {
      setError('疑似重复的已有记录已被修改或删除，请刷新后重新确认。')
      return
    }
    setError('')
    setEditing({ id: existing.id, draft: { ...existing } })
    setSearch('')
    setHistoryFilter(null)
    setTab('dashboard')
    setMessage('正在修改已有记录；保存修改不会新增副本。')
  }

  async function confirmDuplicateAsNew(index: number) {
    if (!preview || busy || confirmDuplicateLock.current) return
    const candidate = preview[index]
    if (!candidate?.duplicateOfRecordId) return
    const remainingOriginalIndexes = preview.map((_, current) => current).filter(current => current !== index)
    const attachPendingImage = pendingImageFile !== null && pendingImageTarget === index
    confirmDuplicateLock.current = true
    setBusy(true)
    setError('')
    try {
      const outcome = await persistReviewBatch([{ ...candidate, forceNewRecord: true }], {
        sourceText: previewSource,
        files: attachPendingImage && pendingImageFile ? [pendingImageFile] : [],
        imageTargetIndex: attachPendingImage ? 0 : undefined,
        appendSavedBatch: true,
      })
      if (outcome.createdCount !== 1) throw new Error('新记录没有写入权威存储，请刷新后重试。')
      const remaining = preview.filter((_, current) => current !== index)
      setPreview(remaining.length ? remaining : null)
      setPreviewEditingIndex(null)
      if (attachPendingImage && outcome.attachmentSaved) {
        setPendingImageFile(null)
        setPendingImageTarget(null)
        setImageStatus('')
      } else if (pendingImageFile) {
        setPendingImageTarget(remapPendingImageTarget(remainingOriginalIndexes, pendingImageTarget))
      }
      setPreviewNotice(remaining.length
        ? '已确认新增 1 条；其他疑似重复或待调整内容仍保留。'
        : '')
      setMessage('已确认新增 1 条；复用了本次识别结果，没有再次调用 AI。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '确认新增失败')
      if (cause instanceof Error && cause.name === 'LocalWriteBlockedError') await refreshMigrationStatus()
    } finally {
      confirmDuplicateLock.current = false
      setBusy(false)
    }
  }

  async function confirmEdit() {
    if (!editing || busy) return
    if (localMode && (migrationState?.status === 'IN_PROGRESS' || migrationState?.status === 'VERIFYING')) {
      setError(LOCAL_WRITE_BLOCKED_MESSAGE); return
    }
    setBusy(true); setError('')
    try {
      const original = records.find(record => record.id === editing.id)
      await recordStorage.update(localMode ? null : user?.uid ?? null, editing.id, toPersistedLifeRecordDraft({
        ...editing.draft,
        sourceRef: editing.draft.sourceRef ?? original?.sourceRef,
        attachments: editing.draft.attachments ?? original?.attachments,
      }, todayLocal()))
      setEditing(null); setMessage('记录已更新。'); await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '修改失败')
      if (cause instanceof Error && cause.name === 'LocalWriteBlockedError') await refreshMigrationStatus()
    }
    finally { setBusy(false) }
  }

  async function confirmDelete(id: string): Promise<boolean> {
    if (localMode && (migrationState?.status === 'IN_PROGRESS' || migrationState?.status === 'VERIFYING')) {
      setError(LOCAL_WRITE_BLOCKED_MESSAGE); return false
    }
    setBusy(true); setError('')
    try {
      await removeRecordAndUnusedAttachments({
        recordStorage,
        attachmentStorage: getAttachmentStorage(),
        userId: localMode ? null : user?.uid ?? null,
        id,
      })
      setDeleteTarget(null); setMessage('记录已删除。'); await refresh()
      return true
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败')
      if (cause instanceof Error && cause.name === 'LocalWriteBlockedError') await refreshMigrationStatus()
      return false
    }
    finally { setBusy(false) }
  }

  async function confirmBulkDelete(snapshot: BulkDeleteSnapshot) {
    if (busy) return
    if (localMode && (migrationState?.status === 'IN_PROGRESS' || migrationState?.status === 'VERIFYING')) {
      setError(LOCAL_WRITE_BLOCKED_MESSAGE)
      return
    }
    setBusy(true); setError(''); setMessage('')
    try {
      const userId = localMode ? null : user?.uid ?? null
      const outcome = await deleteRecordsByIds({
        recordStorage,
        attachmentStorage: getAttachmentStorage(),
        userId,
        ids: snapshot.ids,
        withAuthoritativeWriteLock: write => withRecordWriteLock(userId, write),
      })
      setMessage(bulkDeleteOutcomeMessage(outcome))
      await refresh()
      return outcome
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量删除失败')
      if (cause instanceof Error && cause.name === 'LocalWriteBlockedError') await refreshMigrationStatus()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function undoSavedBatch() {
    if (busy || savedBatch.length === 0) return
    const ids = savedBatch.map(record => record.id).filter(Boolean)
    if (ids.length !== savedBatch.length) {
      setError('本次记录缺少可确认的记录 ID，不能安全撤销。请在下方逐条删除。')
      return
    }
    setBusy(true); setError(''); setMessage('')
    try {
      const userId = localMode ? null : user?.uid ?? null
      const outcome = await deleteRecordsByIds({
        recordStorage,
        attachmentStorage: getAttachmentStorage(),
        userId,
        ids,
        withAuthoritativeWriteLock: write => withRecordWriteLock(userId, write),
      })
      setMessage(`撤销完成：${bulkDeleteOutcomeMessage(outcome)}`)
      setSavedBatch([])
      resetFollowUpSession()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '撤销失败')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function attachPendingImageToSaved(recordId: string) {
    if (!pendingImageFile || busy) return
    setBusy(true); setError(''); setImageStatus('正在把图片关联到已保存记录…')
    try {
      const userId = localMode ? null : user?.uid ?? null
      const updated = await attachFilesToExistingRecord({
        recordStorage,
        attachmentStorage: getAttachmentStorage(),
        userId,
        recordId,
        files: [pendingImageFile],
        withAuthoritativeWriteLock: write => withRecordWriteLock(userId, write),
      })
      setSavedBatch(current => current.map(record => record.id === updated.id ? updated : record))
      setPendingImageFile(null)
      setPendingImageTarget(null)
      setImageStatus('图片已关联到选中的已保存记录。')
      setMessage('图片关联已写入当前权威存储。')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片关联失败')
      setImageStatus('图片尚未关联；原文件仍保留，可重试或取消。')
      await refresh()
    } finally {
      setPendingImageAttachingId(null)
      setBusy(false)
    }
  }

  async function submitSmartFollowUp(item: SmartFollowUpItem, answer: string): Promise<boolean> {
    if (followUpLock.current || followUpBusy) return false
    if (localMode && (migrationState?.status === 'IN_PROGRESS' || migrationState?.status === 'VERIFYING')) {
      setFollowUpError(LOCAL_WRITE_BLOCKED_MESSAGE)
      return false
    }
    followUpLock.current = true
    setFollowUpBusy(true); setFollowUpError('')
    try {
      const userId = localMode ? null : user?.uid ?? null
      const updatedRecord = await withRecordWriteLock(userId, async storage => {
        const currentRecords = await storage.load(userId)
        const original = currentRecords.find(record => record.id === item.recordId)
        if (!original) throw new Error('原记录已不存在或已被删除，本次回答没有写入')
        if (original.type !== item.question.type) throw new Error('原记录分类已经变化，请发送一条新消息重新识别')
        const followUpAnswer: LifeFollowUpAnswer = {
          questionId: item.question.questionId,
          recordIndex: item.question.recordIndex,
          type: item.question.type,
          field: item.question.field,
          question: item.question.question,
          answer,
          round: item.round,
        }
        const sourceProvider = original.sourceRef?.provider
        const draft = applyFollowUpAnswer(original, followUpAnswer, new Date().toISOString(), {
          origin: item.question.origin,
          ...(item.question.origin === 'rule'
            ? { provider: 'rule' as const }
            : isLifeRecordProvider(sourceProvider) && sourceProvider !== 'rule'
              ? { provider: sourceProvider }
              : {}),
          ...(item.question.origin === 'ai' && original.sourceRef?.model
            ? { model: original.sourceRef.model }
            : {}),
        })
        const persisted = toPersistedLifeRecordDraft(draft, original.date)
        await storage.update(userId, original.id, persisted)
        return {
          ...original,
          ...persisted,
          id: original.id,
          sourceText: original.sourceText,
        } satisfies LifeRecord
      })
      setSavedBatch(current => current.map(record => record.id === updatedRecord.id ? updatedRecord : record))
      setFollowUpItems(current => current.filter(candidate => (
        candidate.question.questionId !== item.question.questionId
      )))
      setFollowUpHistory(current => updateFollowUpHistoryStatus(
        current,
        item.question.questionId,
        'answered',
        answer,
      ))
      setFollowUpNotice('补充信息已写入对应原记录。本轮其他问题仍保留；只有你主动点击继续，才会发起下一轮 AI 评估。')
      setMessage('补充信息已写入原记录，记录数量没有增加。')
      await refresh()
      return true
    } catch (cause) {
      setFollowUpError(cause instanceof Error ? cause.message : '补充信息保存失败')
      if (cause instanceof Error && cause.name === 'LocalWriteBlockedError') await refreshMigrationStatus()
      return false
    } finally {
      followUpLock.current = false
      setFollowUpBusy(false)
    }
  }

  function skipSmartFollowUp(item: SmartFollowUpItem) {
    setFollowUpItems(current => current.filter(candidate => (
      candidate.question.questionId !== item.question.questionId
    )))
    setFollowUpHistory(current => updateFollowUpHistoryStatus(
      current,
      item.question.questionId,
      'skipped',
    ))
    setFollowUpNotice('已跳过这个问题；其他记录问题保持不变。')
    setFollowUpError('')
  }

  function skipAllSmartFollowUps() {
    const currentQuestionIds = new Set(followUpItems
      .filter(item => item.round === followUpRound)
      .map(item => item.question.questionId))
    setFollowUpItems([])
    setFollowUpHistory(current => current.map(item => currentQuestionIds.has(item.questionId)
      ? { ...item, status: 'skipped' as const }
      : item))
    setFollowUpNotice('本轮问题已全部跳过。你可以主动继续下一轮，也可以结束补充。')
    setFollowUpError('')
  }

  function endSmartFollowUps() {
    const pendingIds = new Set(followUpItems.map(item => item.question.questionId))
    setFollowUpHistory(current => current.map(item => pendingIds.has(item.questionId)
      ? { ...item, status: 'skipped' as const }
      : item))
    setFollowUpItems([])
    setFollowUpEnded(true)
    setFollowUpNotice('智能补充已结束；所有已保存记录保持不变。')
    setMessage('已结束智能补充；所有已保存记录保持不变。')
  }

  async function continueSmartFollowUpRound() {
    if (
      followUpGenerateLock.current
      || followUpGenerating
      || followUpBusy
      || followUpEnded
      || followUpRound >= 3
      || followUpItems.some(item => item.round === followUpRound)
    ) return
    if (lanClient) {
      setFollowUpError('局域网设备不调用电脑上的 AI 凭据；请在本机个人版继续动态追问。')
      return
    }
    if (byokClient && !byokConnection) {
      setFollowUpError('当前浏览会话没有可用的 API Key，请重新连接后再继续智能补充。')
      return
    }
    followUpGenerateLock.current = true
    setFollowUpGenerating(true)
    setFollowUpError('')
    setFollowUpNotice('')
    const nextRound = (followUpRound + 1) as 2 | 3
    try {
      const recordIds = new Set<string>([
        ...followUpRecordIds,
        ...followUpHistory.map(item => item.targetRecordId),
        ...followUpItems.map(item => item.recordId),
      ])
      const authoritative = await recordStorage.load(localMode ? null : user?.uid ?? null)
      const sessionRecords = authoritative.filter(record => recordIds.has(record.id))
      if (!sessionRecords.length) throw new Error('本次追问关联的记录已不存在，无法继续生成问题')
      const response = await fetch('/api/life-records/follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: followUpMessageId,
          clientSessionId: currentClientSessionId(),
          round: nextRound,
          records: sessionRecords,
          history: followUpHistory,
          ...(byokConnection ? { aiConnection: byokConnection } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? `第 ${nextRound} 轮追问生成失败`)
      const questions = normalizeSavedRecordFollowUpQuestions(
        data.followUps,
        sessionRecords,
        nextRound,
        followUpHistory,
      )
      const recordById = new Map(sessionRecords.map(record => [record.id, record]))
      const nextItems = questions.flatMap(question => {
        const record = question.targetRecordId ? recordById.get(question.targetRecordId) : undefined
        return record ? [{
          question,
          recordId: record.id,
          recordType: record.type,
          recordSummary: recordDescription(record),
          round: question.round,
        }] : []
      })
      const nextHistory = historyFromMappedFollowUps(nextItems.map(item => ({
        question: item.question,
        recordId: item.recordId,
      })))
      const nextQuestionIds = new Set(nextHistory.map(item => item.questionId))
      setFollowUpHistory(current => [
        ...current.filter(item => !nextQuestionIds.has(item.questionId)),
        ...nextHistory,
      ])
      setFollowUpRound(nextRound)
      setFollowUpItems(nextItems)
      setFollowUpEnded(nextItems.length === 0)
      setFollowUpNotice(nextItems.length
        ? data.mode === 'ai'
          ? String(data.notice ?? `第 ${nextRound} 轮由真实 AI 生成。`)
          : '真实 AI 续轮不可用，已明确降级为规则问题。'
        : '')
    } catch (cause) {
      setFollowUpError(cause instanceof Error ? cause.message : '下一轮追问生成失败')
    } finally {
      followUpGenerateLock.current = false
      setFollowUpGenerating(false)
    }
  }

  const nav: { id: Tab; label: string; icon: string }[] = [
    { id: 'capture', label: '记录', icon: '01' },
    { id: 'dashboard', label: '数据', icon: '02' },
    { id: 'profile', label: '我的', icon: '03' },
  ]
  const quickTypes: { type: LifeRecordType; english: string; color: string; background: string }[] = [
    { type: 'exercise', english: 'Exercise', color: '#35f2ce', background: '#123a41' },
    { type: 'sleep', english: 'Sleep', color: '#a58cff', background: '#2a2350' },
    { type: 'learning', english: 'Study', color: '#61b9ff', background: '#183451' },
    { type: 'meal', english: 'Food', color: '#a7ef89', background: '#29402f' },
    { type: 'expense', english: 'Bill', color: '#ffb46a', background: '#433127' },
    { type: 'mood', english: 'Emotion', color: '#ff79bc', background: '#482542' },
  ]

  function startManual(type: LifeRecordType) {
    setPreview([emptyDraft(type, date)])
    setPreviewEditingIndex(0)
    setPreviewSource('')
    setError('')
    setMessage('')
  }

  function showHistory(type: LifeRecordType | null) {
    setHistoryFilter(type)
    setSearch('')
    setCalendarScreen(type ? { kind: 'type', type } : { kind: 'total' })
    // 独立日历页位于数据首页之上；分类入口再压入一层，确保后退先回到总日历。
    window.history.replaceState(null, '', window.location.pathname)
    window.history.pushState({ marker: 'ai-lifeos-calendar-screen-v1', calendar: 'total', type: null }, '', '#calendar')
    if (type) {
      window.history.pushState({ marker: 'ai-lifeos-calendar-screen-v1', calendar: 'type', type }, '', `#calendar-${type}`)
    }
  }

  function leaveCalendarScreen() {
    const state = window.history.state as { marker?: string; calendar?: string } | null
    if (state?.marker === 'ai-lifeos-calendar-screen-v1') {
      // 分类页有两层（总日历、分类日历）；总日历页只有一层。
      window.history.go(state.calendar === 'type' ? -2 : -1)
      return
    }
    setCalendarScreen(null)
    setHistoryFilter(null)
    window.history.replaceState(null, '', window.location.pathname)
  }

  useEffect(() => {
    function handleCalendarScreenPop(event: PopStateEvent) {
      const state = event.state as { marker?: string; calendar?: string; type?: LifeRecordType } | null
      if (state?.marker !== 'ai-lifeos-calendar-screen-v1') {
        setCalendarScreen(null)
        setHistoryFilter(null)
        return
      }
      // 已挂载时由 LifeCalendar 处理总日历/分类日历之间的内部切换，避免组件重挂载打断动画。
      setCalendarScreen(current => current ?? (state.calendar === 'type' && state.type ? { kind: 'type', type: state.type } : { kind: 'total' }))
      if (state.calendar === 'type' && state.type) setHistoryFilter(state.type)
    }
    window.addEventListener('popstate', handleCalendarScreenPop)
    return () => window.removeEventListener('popstate', handleCalendarScreenPop)
  }, [])

  function selectDashboardTab() {
    setTab('dashboard')
    setCalendarScreen(null)
    setHistoryFilter(null)
    if (window.history.state?.marker === 'ai-lifeos-calendar-screen-v1') window.history.replaceState(null, '', window.location.pathname)
  }

  function selectTab(next: Tab) {
    if (next === 'dashboard') {
      selectDashboardTab()
      return
    }
    setCalendarScreen(null)
    setHistoryFilter(null)
    setTab(next)
  }

  async function exportBackup() {
    setError(''); setMessage('')
    try {
      const backup = await exportBackupWithAttachments(null)
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `life-records-backup-${backup.exportedAt.slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(backup.corruptedRaw ? '已导出备份，其中包含无法解析的原始数据，请妥善保存以便恢复。' : `已导出全部 ${backup.records.length} 条记录。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败') }
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(''); setMessage('')
    if (!window.confirm('导入备份会覆盖当前浏览器中的全部本地记录，确定继续？')) { event.target.value = ''; return }
    try {
      const count = await restoreBackupWithAttachments(null, JSON.parse(await file.text()))
      setMessage(`已恢复 ${count} 条记录。`)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复失败，当前记录未改动'); await refresh() }
    finally { event.target.value = '' }
  }

  // 只读刷新迁移状态；失败时保留上一条已知状态并显示错误，不猜测状态。
  const refreshMigrationStatus = useCallback(async () => {
    if (!localMode) { setMigrationState(null); return }
    try {
      const view = await readMigrationStatus({ source: recordStorage, target: createMigrationTarget() })
      setMigrationState(view.state)
    } catch (cause) {
      setMigrationError(cause instanceof Error ? cause.message : '无法读取本地数据库升级状态')
    }
  }, [localMode])

  useEffect(() => {
    if (!localMode || tab !== 'profile') return
    void refreshMigrationStatus()
  }, [localMode, tab, refreshMigrationStatus])

  async function downloadMigrationBackup(backup: { exportedAt: string } & Record<string, unknown>) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `life-records-premigration-${backup.exportedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function runMigration() {
    if (!migrationEnabled || migrationBusy) return
    if (!window.confirm('即将把本地记录复制到浏览器 IndexedDB，并逐字段校验。升级前会先导出备份，旧 localStorage 数据不会被删除。继续？')) return
    setMigrationBusy(true); setMigrationError(''); setMigrationNotice('')
    try {
      // Web Locks 是协作锁：拿不到就拒绝执行，而不是退回时间戳方案。
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
      if (!locks) {
        setMigrationError('当前浏览器不支持 Web Locks，无法保证迁移期间只有一个页面在执行。请更换浏览器后重试。')
        return
      }
      const collected: Array<Awaited<ReturnType<typeof prepareMigration>>> = []
      const acquired = await locks.request('ai-lifeos:local-db-migration:v1', { ifAvailable: true }, async lock => {
        if (!lock) return
        collected.push(await prepareMigration({ source: recordStorage, target: createMigrationTarget() }))
      })
      const outcome = collected[0] ?? null
      if (acquired === undefined || outcome === null) {
        setMigrationError('另一个页面正在执行数据升级。请关闭其它本应用页面后重试。')
        return
      }
      if (outcome.backup) await downloadMigrationBackup(outcome.backup as unknown as { exportedAt: string } & Record<string, unknown>)
      setMigrationState(outcome.state)
      if (outcome.ok) setMigrationNotice(outcome.message)
      else setMigrationError(outcome.message)
    } catch (cause) {
      setMigrationError(cause instanceof Error ? cause.message : '升级失败')
    } finally {
      setMigrationBusy(false)
    }
  }

  async function enableIndexedDB() {
    if (!migrationEnabled || migrationBusy) return
    if (!window.confirm('确认启用本地数据库？启用后 IndexedDB 将成为唯一权威本地数据源，旧 localStorage 数据仍会保留但不再写入。')) return
    setMigrationBusy(true); setMigrationError(''); setMigrationNotice('')
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
      if (!locks) {
        setMigrationError('当前浏览器不支持 Web Locks，无法安全启用。')
        return
      }
      const collected: Array<Awaited<ReturnType<typeof activateMigration>>> = []
      const acquired = await locks.request('ai-lifeos:local-db-migration:v1', { ifAvailable: true }, async lock => {
        if (!lock) return
        collected.push(await activateMigration({ source: recordStorage, target: createMigrationTarget() }))
      })
      const outcome = collected[0] ?? null
      if (acquired === undefined || outcome === null) {
        setMigrationError('另一个页面正在操作数据升级，请稍后重试。')
        return
      }
      setMigrationState(outcome.state)
      if (outcome.ok) { setMigrationNotice(outcome.message); resetLocalStorageRoute(); await refresh() }
      else setMigrationError(outcome.message)
    } catch (cause) {
      setMigrationError(cause instanceof Error ? cause.message : '启用失败')
    } finally {
      setMigrationBusy(false)
    }
  }

  async function recoverMigration() {
    if (!migrationEnabled || migrationBusy) return
    if (!window.confirm('将只读检查来源和目标数据：内容一致才恢复为“等待启用”；目标为空才重新复制；内容不一致会停止且不删除任何记录。继续？')) return
    setMigrationBusy(true); setMigrationError(''); setMigrationNotice('')
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
      if (!locks) {
        setMigrationError('当前浏览器不支持 Web Locks，无法安全恢复迁移。')
        return
      }
      const collected: Array<Awaited<ReturnType<typeof recoverInterruptedMigration>>> = []
      const acquired = await locks.request('ai-lifeos:local-db-migration:v1', { ifAvailable: true }, async lock => {
        if (!lock) return
        collected.push(await recoverInterruptedMigration({ source: recordStorage, target: createMigrationTarget() }))
      })
      const outcome = collected[0] ?? null
      if (acquired === undefined || outcome === null) {
        setMigrationError('另一个页面正在操作数据升级，请关闭其它页面后重试。')
        return
      }
      if (outcome.backup) await downloadMigrationBackup(outcome.backup as unknown as { exportedAt: string } & Record<string, unknown>)
      setMigrationState(outcome.state)
      if (outcome.ok) setMigrationNotice(outcome.message)
      else setMigrationError(outcome.message)
    } catch (cause) {
      setMigrationError(cause instanceof Error ? cause.message : '恢复失败')
    } finally {
      setMigrationBusy(false)
    }
  }

  const visibleRecords = historyFilter ? records.filter(record => record.type === historyFilter) : records
  const searchQuery = search.trim()
  const searchMatches = searchQuery ? searchLifeRecords(visibleRecords, searchQuery) : []
  const listRecords = searchQuery ? searchMatches.map(match => match.record) : visibleRecords
  const pendingCurrentRoundCount = followUpItems.filter(item => item.round === followUpRound).length
  const canContinueFollowUpRound = canGenerateNextFollowUpRound(
    followUpRound,
    pendingCurrentRoundCount,
    followUpEnded,
  )
  const followUpHistoryCounts = followUpHistory.reduce(
    (counts, item) => {
      if (item.status === 'answered') counts.answered += 1
      if (item.status === 'skipped') counts.skipped += 1
      return counts
    },
    { answered: 0, skipped: 0 },
  )

  return <main className="capsule-shell min-h-screen bg-[#070d1b] text-slate-100" style={{ '--surface': '#0d1a32', '--surface-2': '#1d2c49', '--border': 'rgba(103, 232, 249, 0.2)', '--muted': '#a9bad2' } as React.CSSProperties}>
    <div className="relative z-[1] mx-auto flex min-h-screen w-full max-w-5xl flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-cyan-300/15 bg-[#081326]/90 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/jayc-brand-logo.png" alt="Jayc看世界 JaycGo 主品牌标志" className="h-[72px] w-auto shrink-0 self-stretch rounded-lg object-contain" width={128} height={72} />
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.25em] text-cyan-300">AI / LIFE DATABASE</p>
            <h1 className="text-xl font-black tracking-tight">AI人生数据库 <span className="text-cyan-300">◉</span></h1>
            <p className="text-[11px] text-muted">AI记录人生，AI改变人生</p>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] font-bold text-cyan-100 sm:flex">Jayc看世界 · JaycGo</div>
        {firebaseEnabled && user && <button className="text-xs text-muted underline" onClick={() => void signOut()}>退出</button>}
      </header>
      <div className="mx-4 mt-4 rounded-xl border border-cyan-300/20 bg-[#0d1b34]/90 px-3 py-2 text-xs text-cyan-100 sm:mx-6">
        <strong>{mode === 'ai' ? 'AI 记录与分析' : mode === 'fallback-rule' ? '真实模型不完整/不可用 · 本地规则补回 · 未冒充 AI' : mode === 'unconfigured' ? 'AI 未配置 · 未调用 AI' : mode === 'demo' ? '演示规则解析与本地统计 · 未调用 AI' : '正在检查处理模式'}</strong>
        {(mode === 'unconfigured' || lanClient) && modeReason && <span className="block text-amber-200"> · {modeReason}</span>}
        <span> · {firebaseEnabled ? 'Firebase 保存' : lanClient ? '手机浏览器独立本地记录' : '浏览器本地演示数据'}</span>
        {!firebaseEnabled && <span> · {lanClient ? '与电脑记录不互通 · 清除浏览器数据会丢失' : '清除浏览器数据会丢失记录'}</span>}
      </div>
      {error && <div role="alert" className="mx-4 mt-3 rounded-xl border border-red-400/40 bg-red-950/70 px-4 py-3 text-sm text-red-100 sm:mx-6">{error}</div>}
      {message && <div role="status" className="mx-4 mt-3 rounded-xl border border-cyan-400/30 bg-cyan-950/60 px-4 py-3 text-sm text-cyan-100 sm:mx-6">{message}</div>}

      {!authReady ? <div className="flex flex-1 items-center justify-center text-sm text-muted">正在检查登录状态…</div>
        : firebaseEnabled && !user ? <form onSubmit={login} className="card mx-4 my-12 w-auto max-w-sm space-y-4 self-center sm:w-full">
          <h2 className="text-lg font-bold">登录你的本地测试账号</h2>
          <p className="text-xs text-muted">第一版不提供公开注册。请先在自己的 Firebase 项目中创建测试用户。</p>
          <label className="block text-sm">邮箱<input type="email" required className="mt-1 w-full rounded-xl border p-3 text-slate-900" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="block text-sm">密码<input type="password" required className="mt-1 w-full rounded-xl border p-3 text-slate-900" value={password} onChange={event => setPassword(event.target.value)} /></label>
          <button disabled={busy} className="w-full rounded-xl bg-teal-600 p-3 font-semibold text-white disabled:opacity-50">{busy ? '登录中…' : '登录'}</button>
        </form> : <>
          <nav className="hidden gap-2 px-6 pt-5 sm:flex" aria-label="主导航">
            {nav.map(item => <button key={item.id} onClick={() => selectTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={'rounded-xl border px-5 py-2 text-sm font-semibold transition-colors ' + (tab === item.id ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-200 shadow-[0_0_20px_rgba(0,221,255,.12)]' : 'border-cyan-300/15 bg-[#0d1a32] text-slate-300')}>{item.icon} / {item.label}</button>)}
          </nav>
          <section className={'flex-1 px-4 py-5 sm:px-6 ' + (tab === 'capture' ? 'capture-scroll pb-[calc(24rem+env(safe-area-inset-bottom))] sm:pb-56' : 'pb-24')}>
            {tab === 'capture' && <div className="mx-auto max-w-2xl space-y-4">
              <div className="rounded-[1.6rem] border border-cyan-300/25 bg-gradient-to-br from-[#102b45] via-[#101b34] to-[#251735] p-5 shadow-[0_12px_45px_rgba(0,223,255,.08)]">
                <p className="font-mono text-[10px] tracking-[0.2em] text-cyan-300">ONE MESSAGE / TWO CAPABILITIES</p>
                <h2 className="mt-2 text-2xl font-black">说一句，记录或复盘</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">直接描述今天，或问一周、一个月、一年的变化。记录会自动识别并保存，完成后可修改或撤销；分析只使用已保存的数据。</p>
                <div className="mt-4 flex flex-wrap gap-2" aria-label="分析提问示例">
                  {['分析最近一周', '分析最近一个月', '分析最近一年'].map(prompt => <button key={prompt} type="button" onClick={() => { editDraftText(`${prompt}的记录，我有哪些变化？`); document.getElementById('life-text')?.focus() }} className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-300/60">{prompt}</button>)}
                </div>
                <p className="mt-2 text-[11px] text-muted">点示例只会填入输入框，仍需按「发送」。</p>
                <details className="mt-4 border-t border-cyan-300/15 pt-3"><summary className="cursor-pointer text-xs text-muted">手动添加记录</summary><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{quickTypes.map(item => <button key={item.type} type="button" onClick={() => startManual(item.type)} className="flex min-h-16 flex-col items-center justify-center rounded-xl border border-cyan-300/15 bg-[#0b1830]/80 px-2 py-2 text-xs font-bold hover:border-cyan-300/50" style={{ color: item.color, backgroundColor: item.background }}>{LIFE_RECORD_LABELS[item.type]}<span className="font-mono text-[10px]">{item.english}</span></button>)}</div></details>
              </div>
              <div className="rounded-3xl rounded-tl-md border border-cyan-300/20 bg-[#102940] px-4 py-3 text-sm leading-6 text-cyan-50">我可以把生活描述拆成运动、睡眠、学习、消费和心情，也可以根据已保存记录帮你复盘。试试：「今天学英语45分钟」或「分析最近一周的学习」。</div>
              {chatTurns.map(turn => <div key={turn.id} className={'max-w-[94%] rounded-3xl border px-4 py-3 text-sm leading-6 ' + (turn.role === 'user' ? 'ml-auto rounded-tr-md border-violet-300/20 bg-[#211b3e]' : 'rounded-tl-md border-cyan-300/20 bg-[#102940]')}>
                {turn.label && <p className="mb-1 text-[11px] font-bold text-cyan-300">{turn.label}</p>}
                {turn.imageName && <p className="mb-1 text-[11px] text-cyan-200">图片：{turn.imageName}</p>}
                <p className="whitespace-pre-line">{turn.content}</p>
                {turn.role === 'user' && turn.content && <button type="button" onClick={() => setSourceEditorTurn(current => current === turn.id ? null : turn.id)} className="mt-2 rounded-lg border border-cyan-300/30 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200">在原文上纠错 / 添加</button>}
                {turn.role === 'user' && sourceEditorTurn === turn.id && <div className="mt-3"><SourceFragmentEditor
                  messageId={turn.id}
                  text={turn.content}
                  date={date}
                  onClose={() => setSourceEditorTurn(null)}
                  onAdd={draft => {
                    setPreview(current => [...(current ?? []), draft])
                    setPreviewSource(current => current || turn.content)
                    setMessage('已把原文片段加入下方待处理列表；补全后可继续保存。')
                  }}
                  pendingImage={pendingImageFile !== null}
                /></div>}
              </div>)}
              {savedBatch.length > 0 && <div className="rounded-2xl border border-emerald-300/30 bg-emerald-950/30 p-4" role="status">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] tracking-[0.18em] text-emerald-300">SAVED / 已写入权威存储</p>
                    <h2 className="mt-1 font-bold">本次已保存 {savedBatch.length} 条</h2>
                  </div>
                  <button type="button" disabled={busy} onClick={() => void undoSavedBatch()} className="rounded-lg border border-red-300/35 px-3 py-1.5 text-xs font-bold text-red-200 disabled:opacity-40">撤销本次记录</button>
                </div>
                <div className="mt-3 space-y-2">
                  {savedBatch.map(record => <div key={record.id} className="rounded-xl border border-emerald-300/15 bg-[#0b1d2b] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-emerald-200">{LIFE_RECORD_LABELS[record.type]} · {record.date} · 已保存</p>
                        <p className="mt-1 break-words text-sm font-semibold">{recordDescription(record)}</p>
                        {record.sourceRef && <p className="mt-1 text-[11px] text-muted">原文：{record.sourceRef.text}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-2 text-xs">
                        <button type="button" onClick={() => { setEditing({ id: record.id, draft: { ...record } }); setTab('dashboard') }} className="text-cyan-300">编辑</button>
                        <button type="button" disabled={busy} onClick={() => setSavedDeleteTarget(record.id)} className="text-red-300 disabled:opacity-40">删除</button>
                      </div>
                    </div>
                    {savedDeleteTarget === record.id && <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-red-400/30 bg-red-950/60 p-3 text-xs text-red-100">
                      <span className="flex-1">确定删除这条本次新增记录？共享图片会保留。</span>
                      <button type="button" onClick={() => setSavedDeleteTarget(null)} className="rounded-lg border border-red-200/30 px-2.5 py-1.5">取消</button>
                      <button type="button" disabled={busy} onClick={async () => {
                        const deleted = await confirmDelete(record.id)
                        if (deleted) {
                          setSavedBatch(current => current.filter(item => item.id !== record.id))
                          setSavedDeleteTarget(null)
                        }
                      }} className="rounded-lg bg-red-500 px-2.5 py-1.5 font-bold text-white disabled:opacity-40">确认删除</button>
                    </div>}
                  </div>)}
                </div>
              </div>}
              <SmartFollowUps
                items={followUpItems}
                busy={followUpBusy || followUpGenerating || busy}
                currentRound={followUpRound}
                canContinue={canContinueFollowUpRound}
                ended={followUpEnded}
                hasSession={Boolean(followUpMessageId)}
                continueBusy={followUpGenerating}
                historyCounts={followUpHistoryCounts}
                notice={followUpNotice}
                error={followUpError}
                onSubmit={submitSmartFollowUp}
                onSkip={skipSmartFollowUp}
                onSkipAll={skipAllSmartFollowUps}
                onContinue={() => void continueSmartFollowUpRound()}
                onEnd={endSmartFollowUps}
              />
              {preview && <div id="pending-review" className="card scroll-mt-24 space-y-4 !border-cyan-300/40 shadow-[0_0_35px_rgba(0,221,255,.08)]">
                <div><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] tracking-[0.2em] text-cyan-300">NEEDS ADJUSTMENT / {preview.length} EVENTS</p><h2 className="mt-1 font-bold">{previewSource ? '需要调整的原文' : '待补充记录'}</h2></div><button type="button" onClick={() => document.getElementById('review-actions')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="rounded-lg border border-cyan-300/30 px-3 py-2 text-[11px] text-cyan-200">跳到保存按钮 ↓</button></div><p className="mt-1 text-xs text-muted">发送后已经自动保存合法记录；这里只保留缺字段、疑似重复或用户主动加入的条目。修改后再保存不会影响已完成记录。</p></div>
                {previewNotice && <p role="status" className="rounded-xl border border-amber-300/30 bg-amber-950/35 px-3 py-2 text-xs text-amber-100">{previewNotice}</p>}
                {preview.map((draft, index) => (
                  <div key={index} className="space-y-3 rounded-2xl border border-cyan-300/10 bg-[#091428] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-mono text-[10px] text-cyan-300">{String(index + 1).padStart(2, '0')} / {LIFE_RECORD_LABELS[draft.type]} · {draft.date}</span>
                        <p className="mt-1 break-words text-sm font-semibold">{recordDescription(draft)}</p>
                        {draft.sourceRef && <p className="mt-1 text-[11px] text-cyan-200">原文片段：{draft.sourceRef.text} · {lifeRecordSourceLabel(draft.sourceRef)}{draft.sourceRef.userEdited ? ' · 已改分类' : ''}</p>}
                        {draft.needsFields && <p className="mt-1 text-[11px] text-amber-200">待补充：{draft.missingReason ?? '缺少必要字段'}。这一条不会阻塞其他记录。</p>}
                        {draft.forceNewRecord && <p className="mt-1 text-[11px] font-semibold text-violet-200">已标记：另一次真实事件</p>}
                      </div>
                      {!draft.duplicateOfRecordId && <div className="flex shrink-0 gap-3 text-xs">
                        <button type="button" className="text-cyan-300" onClick={() => setPreviewEditingIndex(current => current === index ? null : index)}>{previewEditingIndex === index ? '收起' : '修改'}</button>
                        <button type="button" className={draft.forceNewRecord ? 'text-violet-200' : 'text-slate-400'} onClick={() => markForcedNewEvent(index)}>{draft.forceNewRecord ? '取消新事件' : '仍作为新事件保存'}</button>
                        <button type="button" className="text-red-300" onClick={() => removePreviewDraft(index)}>移除</button>
                      </div>}
                    </div>
                    {draft.duplicateOfRecordId && <DuplicateReviewPrompt
                      existingRecord={records.find(record => record.id === draft.duplicateOfRecordId) ?? null}
                      busy={busy}
                      onEditExisting={() => editDuplicateExistingRecord(draft.duplicateOfRecordId!)}
                      onConfirmNew={() => void confirmDuplicateAsNew(index)}
                      onEditCandidate={() => setPreviewEditingIndex(current => current === index ? null : index)}
                      onCancel={() => removePreviewDraft(index)}
                    />}
                    {previewEditingIndex === index && <div className="border-t border-cyan-300/15 pt-3"><RecordFields record={draft} onChange={next => updatePreviewDraft(index, next)} /></div>}
                  </div>
                ))}
                <div id="review-actions" className="scroll-mt-4 flex flex-col gap-2 sm:flex-row"><button className="flex-1 rounded-xl border border-cyan-300/20 p-3 text-sm" onClick={() => { setPreview(null); setPreviewEditingIndex(null); setPreviewNotice(''); setPendingImageFile(null); setPendingImageTarget(null); setImageStatus('') }}>取消</button><button disabled={busy || preview.length === 0} className="flex-1 rounded-xl bg-cyan-300 p-3 text-sm font-bold text-[#071326] disabled:opacity-50" onClick={() => void confirmSave()}>{busy ? '保存中…' : '保存调整后的 ' + preview.length + ' 条'}</button></div>
              </div>}
              {pendingImageFile && <PendingImageReview
                file={pendingImageFile}
                preview={preview ?? []}
                savedRecords={savedBatch}
                selectedIndex={pendingImageTarget}
                onSelect={setPendingImageTarget}
                onAttachToSaved={recordId => {
                  setPendingImageAttachingId(recordId)
                  void attachPendingImageToSaved(recordId)
                }}
                attachingRecordId={pendingImageAttachingId}
                onAddRecord={() => {
                  setPreview(current => [...(current ?? []), { ...emptyDraft('meal', date), candidate: true }])
                  setPendingImageTarget(preview?.length ?? 0)
                }}
                onCancel={() => { setPendingImageFile(null); setPendingImageTarget(null); setImageStatus('') }}
              />}
            </div>}
            {tab === 'dashboard' && !calendarScreen && <div className="mx-auto max-w-5xl space-y-6">
              <CapsuleDashboard records={records} selectedType={historyFilter} onSelectType={showHistory} />
              <section className="rounded-[1.6rem] border border-cyan-300/25 bg-gradient-to-br from-[#102b45] via-[#101b34] to-[#251735] p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] tracking-[0.2em] text-cyan-300">TOTAL CALENDAR / ALL RECORDS</p>
                    <h2 className="mt-2 text-xl font-black">总日历 · 总记录</h2>
                    <p className="mt-1 text-sm text-muted">按月查看全部 {records.length} 条生活记录，点击日期回看当天内容。</p>
                  </div>
                  <button type="button" onClick={() => showHistory(null)} className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-3 text-sm font-bold text-cyan-200 hover:bg-cyan-300/20">打开总日历 →</button>
                </div>
              </section>
              <div id="record-history" className="space-y-4 scroll-mt-24 border-t border-cyan-300/20 pt-6">
              <div><p className="font-mono text-[10px] tracking-[0.2em] text-cyan-300">ARCHIVE / 已保存记录</p><div className="mt-1 flex items-center justify-between gap-3"><h2 className="text-xl font-bold">{historyFilter ? LIFE_RECORD_LABELS[historyFilter] + '记录' : '全部历史记录'}</h2><div className="flex items-center gap-2">{historyFilter && <button type="button" onClick={() => setHistoryFilter(null)} className="rounded-lg border border-cyan-300/30 px-3 py-1.5 text-xs text-cyan-200">查看全部</button>}<button type="button" aria-expanded={historyManageOpen} onClick={() => setHistoryManageOpen(current => !current)} className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-200">{historyManageOpen ? '关闭管理' : '管理'}</button></div></div><p className="mt-1 text-sm text-muted">{searchQuery ? `匹配 ${listRecords.length} 条` : historyFilter ? `该类共 ${visibleRecords.length} 条` : `总计 ${records.length} 条`}，可修改或删除。</p></div>
              {historyManageOpen && <TotalRecordManager date={manageDate} dayRecords={records.filter(record => record.date === manageDate)} allRecords={records} busy={busy} onDeleteSnapshot={confirmBulkDelete} compactLauncher initialManaging onDateChange={setManageDate} onClose={() => setHistoryManageOpen(false)} />}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"><label className="sr-only" htmlFor="record-search">搜索历史记录</label><input id="record-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索原话、备注、类别或日期，例如「卧推」或 2026-10" className="w-full rounded-xl border border-cyan-300/25 bg-[#101e38] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300" />{searchQuery && <button type="button" onClick={() => setSearch(String())} className="shrink-0 rounded-lg border border-cyan-300/30 px-3 py-2.5 text-xs text-cyan-200 hover:bg-cyan-300/10">清除搜索</button>}</div>
              {searchQuery && <p className="mt-2 text-xs text-muted">{listRecords.length === 0 ? '没有匹配的记录。可换一个关键词，或清除搜索查看全部。' : `搜索「${searchQuery}」：${listRecords.length} 条。搜索只读取已保存记录，不会调用 AI。`}</p>}
              {loadingRecords && <p className="text-sm text-muted">加载中…</p>}
              {!loadingRecords && listRecords.length === 0 && <p className="card text-sm text-muted">{searchQuery ? '没有匹配的记录。' : historyFilter ? '该类别暂无记录。' : '暂无记录。'}</p>}
              {listRecords.map(record => <article key={record.id} className="card space-y-2"><div className="flex items-start justify-between gap-3"><div><span className="text-xs text-muted">{record.date} · {LIFE_RECORD_LABELS[record.type]}</span><p className="mt-1 font-semibold">{recordDescription(record)}</p></div><div className="-my-2 flex shrink-0 items-center gap-1 text-xs"><button className="flex min-h-11 min-w-11 items-center justify-center px-2 text-cyan-300" onClick={() => setEditing({ id: record.id, draft: { ...record } })}>修改</button><button disabled={busy} className="flex min-h-11 min-w-11 items-center justify-center px-2 text-red-300 disabled:opacity-50" onClick={() => setDeleteTarget(record.id)}>删除</button></div></div>{record.sourceRef && <p className="text-xs text-cyan-200">原文片段：{record.sourceRef.text} · {lifeRecordSourceLabel(record.sourceRef, true)}</p>}{record.sourceText && <p className="text-xs text-muted">原话：{record.sourceText}</p>}{record.attachments?.length ? <div className="flex flex-wrap gap-2">{record.attachments.map(attachment => <AttachmentView key={attachment.id} attachment={attachment} compact />)}</div> : null}{deleteTarget === record.id && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-400/30 bg-red-950/70 p-3 text-sm text-red-100"><span className="flex-1">确定删除这条记录？此操作无法撤销。图片只在没有其他记录使用时删除。</span><button className="rounded-lg border border-red-300/30 px-3 py-2" onClick={() => setDeleteTarget(null)}>取消删除</button><button disabled={busy} className="rounded-lg bg-red-500 px-3 py-2 text-white disabled:opacity-50" onClick={() => void confirmDelete(record.id)}>确认删除</button></div>}{editing?.id === record.id && <div className="space-y-3 border-t border-cyan-300/20 pt-3"><RecordFields record={editing.draft} onChange={draft => setEditing({ id: record.id, draft: { ...draft, sourceRef: record.sourceRef, attachments: record.attachments } })} /><div className="flex gap-2"><button className="rounded-xl border border-cyan-300/20 px-4 py-2 text-sm" onClick={() => setEditing(null)}>取消</button><button disabled={busy} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-bold text-[#071326] disabled:opacity-50" onClick={() => void confirmEdit()}>保存修改</button></div></div>}</article>)}
              </div>
            </div>}
            {tab === 'dashboard' && calendarScreen && <div className="mx-auto max-w-5xl space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={leaveCalendarScreen} className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-bold text-cyan-200 hover:bg-cyan-300/20">← 返回数据</button>
                <p className="text-right text-xs text-muted">日历只读取已保存记录</p>
              </div>
              <LifeCalendar
                key={calendarScreen.kind === 'type' ? calendarScreen.type : 'total'}
                records={records}
                busy={busy}
                initialView={calendarScreen}
                onEdit={record => setEditing({ id: record.id, draft: { ...record } })}
                onDelete={record => setDeleteTarget(record.id)}
              />
            </div>}
            {tab === 'profile' && <div className="mx-auto max-w-2xl space-y-4">
              <div className="rounded-[1.6rem] border border-cyan-300/25 bg-gradient-to-br from-[#102b45] via-[#101b34] to-[#251735] p-5"><p className="font-mono text-[10px] tracking-[0.2em] text-cyan-300">IDENTITY / LOCAL PREVIEW</p><h2 className="mt-2 text-2xl font-black">我的</h2><p className="mt-2 text-sm text-muted">个人信息与隐私入口。本机测试版暂不提供公开账号和模型设置。</p></div>
              <section className="card space-y-3"><h3 className="font-bold">当前使用状态</h3><div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">账号</span><strong>{firebaseEnabled ? (user?.email ?? '测试账号') : lanClient ? '局域网设备' : '本机访客'}</strong></div><div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">数据保存</span><strong>{firebaseEnabled ? 'Firebase' : lanClient ? '此手机浏览器本地' : '当前浏览器本地'}</strong></div><div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">文字解析</span><strong>{lanClient ? '规则解析 · 不调用电脑模型' : mode === 'ai' ? 'AI 模式' : mode === 'unconfigured' ? 'AI 未配置 · 未调用 AI' : '演示规则 · 未调用 AI'}</strong></div></section>
              {lanClient && <p className="rounded-xl border border-amber-300/30 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">这是通过 Wi-Fi 打开的独立网页。手机上新增、修改和删除的记录只保存在这台手机的浏览器中，不会出现在电脑端；电脑上的记录也不会自动出现在手机端。请不要把这里当成已同步的数据仓。清除手机浏览器数据会丢失这些记录。</p>}
              {byokClient && <AiModelConnection
                connection={byokConnection}
                restoredFromSession={byokRestoredFromSession}
                onConnected={connection => {
                  setByokConnection(connection)
                  setByokRestoredFromSession(false)
                  setMode('ai')
                  setModeReason('')
                }}
                onDisconnected={() => {
                  setByokConnection(null)
                  setByokRestoredFromSession(false)
                  setMode('unconfigured')
                  setModeReason('API Key 已从页面内存和本次浏览会话清除，需要重新连接')
                }}
                onStartRecording={() => setTab('capture')}
              />}
              {!byokClient && <section className="card space-y-3"><h3 className="font-bold">AI 连接方式</h3>
                <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">当前来源</span><strong>{planStatus ? planStatusText(planStatus) : '正在检查…'}</strong></div>
                <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">真实模型调用</span><strong>{planUsable(planStatus) ? '可用' : '不可用 · 未调用 AI'}</strong></div>
                {planStatus?.mode === 'chatgpt' && <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">授权账号</span><strong>{planStatus.account ?? '已授权账号'}</strong></div>}
                {planStatus?.mode === 'chatgpt' && <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">套餐调用权限</span><strong>{planStatus.planUsageGranted ? (planStatus.needsRefresh ? '已授予 · 下次调用自动续期' : '已授予') : '未授予'}</strong></div>}
                {planStatus?.mode === 'chatgpt' && planStatus.needsRefresh && <p className="rounded-xl border border-cyan-300/30 bg-cyan-950/40 p-3 text-xs leading-5 text-cyan-100">访问令牌刚过期，但刷新令牌仍然有效。下次发送记录时会自动续期，不需要重新授权。</p>}
                {planStatus?.model && <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">模型</span><strong>{planStatus.model}</strong></div>}
                {planStatus && isByokProviderId(planStatus.mode)
                  ? <p className="text-xs leading-5 text-muted">当前正式文字记录解析使用服务端配置的 AI Provider。API Key 不会发送到浏览器；Public Beta 使用请求级 BYOK。</p>
                  : <p className="text-xs leading-5 text-muted">使用官方「Sign in with ChatGPT」连接你自己的 ChatGPT 套餐。授权由你本人在浏览器完成，访问令牌只保存在这台电脑的本地文件里，不会提交到 Git，也不会发送到浏览器。连接后文字与图片解析都由你自己的套餐额度完成。</p>}
                <div className="flex flex-wrap gap-2">
                  <button disabled={planBusy} onClick={() => void startChatgptPlanAuthorization()} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-bold text-[#071326] disabled:opacity-40">{planBusy ? '等待授权…' : planStatus?.authorized ? '重新授权' : '连接 ChatGPT 套餐'}</button>
                  <button disabled={planBusy} onClick={() => void refreshPlanStatus()} className="rounded-xl border border-cyan-300/25 px-4 py-2 text-sm text-slate-200 disabled:opacity-40">刷新状态</button>
                  {planStatus?.authorized && <button disabled={planBusy} onClick={() => void disconnectChatgptPlan()} className="rounded-xl border border-red-300/25 px-4 py-2 text-sm text-red-200 disabled:opacity-40">断开授权</button>}
                </div>
                {planNotice && <p className="rounded-xl border border-cyan-300/30 bg-cyan-950/40 p-3 text-xs leading-5 text-cyan-100">{planNotice}</p>}
                {planError && <p className="rounded-xl border border-red-400/30 bg-red-950/60 p-3 text-xs leading-5 text-red-100">{planError}</p>}
                {(planStatus?.mode === 'rule' || planStatus?.mode === 'unconfigured') && <p className="rounded-xl border border-amber-300/25 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">当前没有可用的正式文字解析 Provider，文字解析走本地规则演示；界面会明确标注「未调用 AI」，不会把规则结果说成 AI 结果。</p>}
              </section>}
              <section className="card space-y-2"><h3 className="font-bold">隐私与数据</h3><p className="text-sm leading-6 text-muted">{firebaseEnabled ? '记录保存在你配置的 Firebase 项目中；文字解析请求会发送到本机 Next.js 服务端，AI 模式下再由服务端发送给所配置的模型服务。' : '记录仅保存在当前浏览器的本地存储。清除站点数据会删除这些记录。演示规则解析不会调用 AI 服务。'}</p><p className="text-sm leading-6 text-muted">本页是本地测试说明，不是正式隐私政策。公开发布前需要依据实际服务和数据处理方式补充正式文件。</p></section>
              {!user && <section className="card space-y-3"><h3 className="font-bold">备份与恢复</h3><p className="text-sm leading-6 text-muted">定期导出 JSON 备份文件并妥善保存；清除浏览器数据前请务必先导出。导入备份会覆盖当前本地记录。</p><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void exportBackup()} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-bold text-[#071326] disabled:opacity-50">导出全部生活记录</button><label className="inline-flex cursor-pointer items-center rounded-xl border border-cyan-300/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-300/10">从备份恢复<input type="file" accept="application/json,.json" className="sr-only" onChange={event => void importBackup(event)} /></label></div></section>}
              {!user && <section className="card space-y-3">
                <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">本地数据库升级</h3><p className="mt-1 text-xs text-muted">把浏览器 localStorage 记录复制到 IndexedDB，并在启用前逐字段校验。</p></div><span className="shrink-0 rounded-full border border-cyan-300/30 px-2 py-1 font-mono text-[10px] text-cyan-200">{migrationState ? MIGRATION_STATUS_LABELS[migrationState.status] : '读取中'}</span></div>
                <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">当前权威数据源</span><strong>{migrationState?.activeStore === 'indexedDB' ? 'IndexedDB（已启用）' : 'localStorage'}</strong></div>
                <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm"><span className="text-muted">本地记录</span><strong>{records.length} 条</strong></div>
                <p className="rounded-xl border border-amber-300/25 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">升级不等于云端同步。IndexedDB 仍然只保存在这个浏览器里，清除站点数据同样会丢失。升级前必须导出 JSON 备份。</p>
                {!migrationEnabled && <p className="text-xs leading-5 text-muted">开发功能开关未开启，升级入口处于关闭状态。需要显式设置 NEXT_PUBLIC_ENABLE_LOCAL_DB_MIGRATION=true 才能在本机测试。</p>}
                {migrationNotice && <p className="rounded-xl border border-cyan-300/30 bg-cyan-950/40 p-3 text-xs leading-5 text-cyan-100">{migrationNotice}</p>}
                {migrationError && <p className="rounded-xl border border-red-400/30 bg-red-950/60 p-3 text-xs leading-5 text-red-100">{migrationError}</p>}
                {migrationState?.status === 'FAILED' && migrationState.errorMessage && <p className="text-xs leading-5 text-red-200">上次失败原因：{migrationState.errorMessage}</p>}
                {migrationState?.status === 'IN_PROGRESS' || migrationState?.status === 'VERIFYING' ? <p className="text-xs leading-5 text-amber-200">升级可能已中断。先关闭其它本应用页面，再使用下方「安全恢复」；不会覆盖或删除无法确认归属的目标数据。</p> : null}
                <div className="flex flex-wrap gap-2">
                  <button disabled={!migrationEnabled || migrationBusy || migrationState?.status === 'SUCCEEDED' || migrationState?.status === 'IN_PROGRESS' || migrationState?.status === 'VERIFYING'} onClick={() => void runMigration()} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-bold text-[#071326] disabled:opacity-40">{migrationBusy ? '处理中…' : migrationState?.status === 'READY_TO_SWITCH' ? '重新校验' : '开始升级并校验'}</button>
                  <button disabled={!migrationEnabled || migrationBusy || migrationState?.status !== 'READY_TO_SWITCH'} onClick={() => void enableIndexedDB()} className="rounded-xl border border-cyan-300/40 px-4 py-2 text-sm font-semibold text-cyan-200 disabled:opacity-40">启用本地数据库</button>
                  <button disabled={!migrationEnabled || migrationBusy || (migrationState?.status !== 'IN_PROGRESS' && migrationState?.status !== 'VERIFYING')} onClick={() => void recoverMigration()} className="rounded-xl border border-amber-300/40 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-40">安全恢复</button>
                  <button disabled={migrationBusy} onClick={() => void exportBackup()} className="rounded-xl border border-cyan-300/25 px-4 py-2 text-sm text-slate-200 disabled:opacity-40">先导出备份</button>
                </div>
                <p className="text-[11px] leading-5 text-muted">升级期间请关闭其它 AI人生数据库标签页。旧版页面可能绕过新版页面的写入保护，因此检测到来源变化时会拒绝启用。</p>
              </section>}              <section className="card space-y-2"><h3 className="font-bold">后续功能</h3><p className="text-sm text-muted">个人资料、账号管理、模型连接与设置将在后续阶段设计；当前没有可操作的空壳按钮。</p></section>
              <OpenSourceNotice />
            </div>}
          </section>
          {tab === 'capture' && <div id="life-composer" className="capture-composer fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-10 max-h-[42dvh] overflow-y-auto border-t border-cyan-300/20 bg-[#081326]/95 p-3 backdrop-blur-xl sm:bottom-0 sm:max-h-[34dvh]"><div className="mx-auto max-w-2xl space-y-2">{!byokClient && <ImageComposer file={imageFile} onChange={file => { currentSendGuard().markDraftEdited(); setImageFile(file) }} disabled={busy} />}<div className="flex items-end gap-2"><label className="sr-only" htmlFor="life-text">输入记录或分析问题</label><textarea id="life-text" rows={2} maxLength={500} value={text} disabled={busy} onChange={event => editDraftText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage() } }} placeholder={byokClient && !byokConnection ? '请先到“我的”选择 AI 服务商并连接' : '说一件事，或问一个分析问题…'} className="max-h-32 min-h-14 flex-1 resize-none rounded-2xl border border-cyan-300/25 bg-[#101e38] px-4 py-3 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:opacity-60" /><button disabled={busy || (!text.trim() && !imageFile)} onClick={() => void sendMessage()} className="h-14 rounded-2xl bg-cyan-300 px-5 font-bold text-[#071326] disabled:opacity-50">{busy ? '处理中…' : '发送'}</button></div></div>{imageStatus && <p className="mx-auto mt-2 max-w-2xl text-xs text-cyan-200">{imageStatus}</p>}<div className="mx-auto mt-2 flex max-w-2xl items-center justify-between text-xs text-muted"><span>Enter 发送 · Shift+Enter 换行</span><input aria-label="记录日期" type="date" disabled={busy} value={date} onChange={event => { currentSendGuard().markDraftEdited(); setDate(event.target.value) }} className="rounded-lg border border-cyan-300/20 bg-[#101e38] px-2 py-1 text-slate-100 disabled:opacity-60" /></div></div>}
          <nav className="fixed bottom-0 left-0 z-20 flex h-[4.5rem] w-full max-w-[100vw] items-center justify-around overflow-hidden border-t border-cyan-300/20 bg-[#081326]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden" aria-label="主导航">{nav.map(item => <button key={item.id} onClick={() => selectTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={'flex w-1/3 flex-col items-center gap-0.5 text-xs ' + (tab === item.id ? 'font-bold text-cyan-300' : 'text-muted')}><span className="relative flex h-8 w-8 items-center justify-center"><span className="font-mono text-lg">{item.icon}</span></span>{item.label}</button>)}
          </nav>
        </>}
    </div>
  </main>
}
