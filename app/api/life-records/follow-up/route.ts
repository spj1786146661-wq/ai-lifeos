import { NextRequest, NextResponse } from 'next/server'
import { isTrustedLocalRequest } from '@/lib/ai/local-request-security'
import { validLifeClientSessionId } from '@/lib/life-client-session'
import { normalizeFollowUpHistory } from '@/lib/life-follow-up'
import { generateFollowUpRound } from '@/lib/life-follow-up-server'
import { normalizeLifeRecord, validLifeDate, type LifeRecord } from '@/lib/life-records'
import { requestHostname } from '@/lib/lan-access'
import {
  isPersonalAlphaByokHost,
  isPublicBetaApi,
  PERSONAL_ALPHA_BYOK_ENV,
  PERSONAL_ALPHA_BYOK_HOST_ENV,
  PUBLIC_BETA_VERIFIED_HEADER,
} from '@/lib/lan-access'
import { byokCredentialFingerprint, parseOptionalByokConnection } from '@/lib/ai/byok-server'
import {
  fingerprintIdempotencyPayload,
  IdempotencyConflictError,
  IdempotencyStore,
} from '@/lib/request-idempotency'
import {
  PublicBetaBudgetError,
  publicBetaSessionFromHeaders,
  withPublicBetaRequestBudget,
} from '@/lib/public-beta-security'

export const runtime = 'nodejs'

const followUpIdempotency = new IdempotencyStore<Record<string, unknown>>({
  ttlMs: 15 * 60_000,
  maxEntries: 256,
})

function sanitizeRecords(value: unknown): LifeRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new Error('追问记录范围无效')
  }
  const seen = new Set<string>()
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('追问记录格式无效')
    const item = raw as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 160) : ''
    if (!id || seen.has(id) || !validLifeDate(item.date)) throw new Error('追问记录 ID 或日期无效')
    seen.add(id)
    const normalized = normalizeLifeRecord(item, String(item.date))
    return {
      ...normalized,
      id,
      sourceText: typeof item.sourceText === 'string' ? item.sourceText.slice(0, 500) : '',
    }
  })
}

export async function POST(req: NextRequest) {
  const hostname = requestHostname(req.headers.get('host'))
  const publicBeta = isPublicBetaApi(
    hostname,
    req.nextUrl.pathname,
    req.headers.get(PUBLIC_BETA_VERIFIED_HEADER),
    process.env.AIOS_PUBLIC_BETA_HOSTS,
  )
  const personalAlphaByok = isPersonalAlphaByokHost(
    req.headers.get('host'),
    process.env[PERSONAL_ALPHA_BYOK_ENV],
    process.env[PERSONAL_ALPHA_BYOK_HOST_ENV],
  )
  if (
    !publicBeta
    && (
      !['localhost', '127.0.0.1', '::1'].includes(hostname)
      || !isTrustedLocalRequest({
      protocol: req.nextUrl.protocol,
      hostHeader: req.headers.get('host'),
      originHeader: req.headers.get('origin'),
      refererHeader: req.headers.get('referer'),
      secFetchSite: req.headers.get('sec-fetch-site'),
      stateChanging: true,
      })
    )
  ) {
    return NextResponse.json({ error: '动态 AI 追问仅供本机个人版使用' }, { status: 403 })
  }
  if (Number(req.headers.get('content-length') ?? 0) > 250_000) {
    return NextResponse.json({ error: '请求过大' }, { status: 413 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 })
  }
  if (JSON.stringify(body).length > 96_000) {
    return NextResponse.json({ error: '请求过大' }, { status: 413 })
  }
  const payload = (body ?? {}) as Record<string, unknown>
  let byokConnection
  try {
    byokConnection = parseOptionalByokConnection(payload.aiConnection)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI 连接信息无效' },
      { status: 400 },
    )
  }
  if ((publicBeta || personalAlphaByok) && !byokConnection) {
    return NextResponse.json(
      { error: 'AI 连接已丢失，请重新连接你自己的 AI 服务商 API Key', code: 'byok_required' },
      { status: 401 },
    )
  }
  let publicSessionId = ''
  if (publicBeta) {
    try {
      publicSessionId = publicBetaSessionFromHeaders(req.headers)
    } catch {
      return NextResponse.json({ error: '匿名会话无效，请刷新页面后重试' }, { status: 401 })
    }
  }
  const roundValue = Number(payload.round)
  if (roundValue !== 2 && roundValue !== 3) {
    return NextResponse.json({ error: '只允许生成第 2 或第 3 轮追问' }, { status: 400 })
  }
  const messageId = typeof payload.messageId === 'string' ? payload.messageId.trim().slice(0, 160) : ''
  if (!messageId) return NextResponse.json({ error: '缺少追问会话标识' }, { status: 400 })
  if (!validLifeClientSessionId(payload.clientSessionId)) {
    return NextResponse.json({ error: '缺少稳定的浏览器会话 ID' }, { status: 400 })
  }
  let records: LifeRecord[]
  try {
    records = sanitizeRecords(payload.records)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '追问记录范围无效' },
      { status: 400 },
    )
  }
  const history = normalizeFollowUpHistory(payload.history)
  const actionId = `${messageId}:round-${roundValue}`
  const credentialFingerprint = byokConnection
    ? byokCredentialFingerprint(byokConnection)
    : 'personal-provider'
  const scope = publicBeta
    ? `${publicSessionId}:${credentialFingerprint}`
    : payload.clientSessionId.trim()
  const fingerprint = fingerprintIdempotencyPayload({
    operation: 'life-follow-up',
    round: roundValue,
    records,
    history,
    provider: byokConnection?.provider ?? 'personal-provider',
    model: byokConnection?.model ?? null,
    credentialFingerprint,
  })
  try {
    const outcome = await followUpIdempotency.run({
      scope,
      actionId,
      fingerprint,
      operation: () => {
        const run = async () => {
          const result = await generateFollowUpRound({
            records,
            history,
            round: roundValue,
            messageId,
            byokConnection: byokConnection ?? undefined,
            requireByok: publicBeta || personalAlphaByok,
          })
          return {
            ...result,
            correlationId: messageId,
          }
        }
        return publicBeta
          ? withPublicBetaRequestBudget({
              operation: 'follow-up',
              sessionId: publicSessionId,
              credentialFingerprint,
              run,
            })
          : run()
      },
    })
    return NextResponse.json(outcome.value, {
      headers: { 'x-ai-lifeos-idempotency': outcome.mode },
    })
  } catch (error) {
    if (error instanceof PublicBetaBudgetError) {
      return NextResponse.json(
        { error: error.message, code: 'public_beta_rate_limited' },
        { status: error.status, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
      )
    }
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      )
    }
    return NextResponse.json({
      error: '追问生成失败；原记录没有发生变化',
      mode: 'fallback-rule',
    }, { status: 502 })
  }
}
