import { NextRequest, NextResponse } from 'next/server'
import { isTrustedLocalRequest } from '@/lib/ai/local-request-security'
import { executeLifeChat } from '@/lib/life-chat-route'
import { validLifeClientSessionId } from '@/lib/life-client-session'
import {
  isLanAllowedApi,
  isPersonalAlphaByokHost,
  isPublicBetaApi,
  LAN_VERIFIED_HEADER,
  PERSONAL_ALPHA_BYOK_ENV,
  PERSONAL_ALPHA_BYOK_HOST_ENV,
  PUBLIC_BETA_VERIFIED_HEADER,
  requestHostname,
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

const chatIdempotency = new IdempotencyStore<Awaited<ReturnType<typeof executeLifeChat>>>({
  ttlMs: 15 * 60_000,
  maxEntries: 512,
})

function validActionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,160}$/.test(value.trim())
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
  if (!publicBeta
    && !['localhost', '127.0.0.1', '::1'].includes(hostname)
    && !isLanAllowedApi(hostname, req.nextUrl.pathname, req.headers.get(LAN_VERIFIED_HEADER))) {
    return NextResponse.json({ error: '仅供本机使用' }, { status: 403 })
  }
  if (personalAlphaByok && !isTrustedLocalRequest({
    protocol: req.nextUrl.protocol,
    hostHeader: req.headers.get('host'),
    originHeader: req.headers.get('origin'),
    refererHeader: req.headers.get('referer'),
    secFetchSite: req.headers.get('sec-fetch-site'),
    stateChanging: true,
  })) {
    return NextResponse.json({ error: '个人 Alpha 只接受可信的本机页面请求' }, { status: 403 })
  }
  if (Number(req.headers.get('content-length') ?? 0) > 1_000_000) {
    return NextResponse.json({ error: '请求过大' }, { status: 413 })
  }
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: '请求格式无效' }, { status: 400 }) }
  if (JSON.stringify(body).length > 64_000) {
    return NextResponse.json({ error: '请求过大' }, { status: 413 })
  }
  const { text, date, records, messageId, clientSessionId, aiConnection } = (body ?? {}) as {
    text?: unknown
    date?: unknown
    records?: unknown
    messageId?: unknown
    clientSessionId?: unknown
    aiConnection?: unknown
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 500) {
    return NextResponse.json({ error: '请输入 1–500 字的内容' }, { status: 400 })
  }
  if (typeof date !== 'string') {
    return NextResponse.json({ error: '日期格式无效' }, { status: 400 })
  }
  if (!validActionId(messageId)) {
    return NextResponse.json({ error: '缺少稳定的请求 ID' }, { status: 400 })
  }
  if (!validLifeClientSessionId(clientSessionId)) {
    return NextResponse.json({ error: '缺少稳定的浏览器会话 ID' }, { status: 400 })
  }
  let byokConnection
  try {
    byokConnection = parseOptionalByokConnection(aiConnection)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI 连接信息无效' },
      { status: 400 },
    )
  }
  if ((publicBeta || personalAlphaByok) && !byokConnection) {
    return NextResponse.json(
      { error: '请先在“我的 → AI 连接”中连接你自己的 AI 服务商 API Key', code: 'byok_required' },
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

  const actionId = messageId.trim()
  const credentialFingerprint = byokConnection
    ? byokCredentialFingerprint(byokConnection)
    : 'personal-provider'
  const scope = publicBeta
    ? `${publicSessionId}:${credentialFingerprint}`
    : clientSessionId.trim()
  const fingerprint = fingerprintIdempotencyPayload({
    operation: 'life-chat',
    text: text.trim(),
    date,
    records: records ?? null,
    provider: byokConnection?.provider ?? 'personal-provider',
    model: byokConnection?.model ?? null,
    credentialFingerprint,
  })
  try {
    const outcome = await chatIdempotency.run({
      scope,
      actionId,
      fingerprint,
      // A transport/provider failure is not a terminal action. An explicit
      // user retry may execute again, but no automatic retry is introduced.
      shouldCache: result => result.status >= 200 && result.status < 300,
      operation: () => {
        const run = () => executeLifeChat({
          text,
          date,
          records,
          messageId: actionId,
          byokConnection: byokConnection ?? undefined,
          requireByok: publicBeta || personalAlphaByok,
        })
        return publicBeta
          ? withPublicBetaRequestBudget({
              operation: 'chat',
              sessionId: publicSessionId,
              credentialFingerprint,
              run,
            })
          : run()
      },
    })
    return NextResponse.json(outcome.value.body, {
      status: outcome.value.status,
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
    console.error('Life chat request failed before a safe response:', {
      code: error instanceof Error ? error.name : 'unknown_error',
    })
    return NextResponse.json({ error: '请求处理失败，本次没有自动重试' }, { status: 500 })
  }
}
