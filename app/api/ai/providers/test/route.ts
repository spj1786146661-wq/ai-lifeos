import { NextRequest, NextResponse } from 'next/server'
import {
  byokConnectionLabel,
  byokStatusFromErrorCode,
  validateByokConnection,
} from '@/lib/ai/byok-connection'
import { byokCredentialFingerprint } from '@/lib/ai/byok-server'
import { isTrustedLocalRequest } from '@/lib/ai/local-request-security'
import {
  ProviderRequestError,
  runProviderText,
} from '@/lib/ai/run-provider-text'
import {
  isPersonalAlphaByokHost,
  isPublicBetaApi,
  isTrustedPublicBrowserOrigin,
  PERSONAL_ALPHA_BYOK_ENV,
  PERSONAL_ALPHA_BYOK_HOST_ENV,
  PUBLIC_BETA_VERIFIED_HEADER,
  requestHostname,
} from '@/lib/lan-access'
import { validLifeClientSessionId } from '@/lib/life-client-session'
import { lifeRecordPrompt } from '@/lib/life-parse-server'
import { parseModelRecordPayload } from '@/lib/life-records'
import {
  PublicBetaBudgetError,
  publicBetaSessionFromHeaders,
  withPublicBetaRequestBudget,
} from '@/lib/public-beta-security'
import {
  fingerprintIdempotencyPayload,
  IdempotencyConflictError,
  IdempotencyStore,
} from '@/lib/request-idempotency'
import {
  ModelTestRateLimiter,
  ModelTestUpstreamError,
} from '@/lib/tokenhub-model-test'

export const runtime = 'nodejs'

const SYNTHETIC_DATE = '2026-01-15'
const SYNTHETIC_TEXT = '今天散步20分钟，学习英语30分钟。'
const rateLimiter = new ModelTestRateLimiter(4, 60_000)
const idempotency = new IdempotencyStore<Record<string, unknown>>({
  ttlMs: 10 * 60_000,
  maxEntries: 256,
})

function noStoreJson(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  })
}

function requestMode(req: NextRequest): 'personal-alpha' | 'public-beta' | null {
  const hostHeader = req.headers.get('host')
  const hostname = requestHostname(hostHeader)
  if (isPersonalAlphaByokHost(
    hostHeader,
    process.env[PERSONAL_ALPHA_BYOK_ENV],
    process.env[PERSONAL_ALPHA_BYOK_HOST_ENV],
  )) {
    return isTrustedLocalRequest({
      protocol: req.nextUrl.protocol,
      hostHeader,
      originHeader: req.headers.get('origin'),
      refererHeader: req.headers.get('referer'),
      secFetchSite: req.headers.get('sec-fetch-site'),
      stateChanging: true,
    }) ? 'personal-alpha' : null
  }
  return isPublicBetaApi(
    hostname,
    req.nextUrl.pathname,
    req.headers.get(PUBLIC_BETA_VERIFIED_HEADER),
    process.env.AIOS_PUBLIC_BETA_HOSTS,
  ) && isTrustedPublicBrowserOrigin(req.headers.get('origin'), hostHeader)
    ? 'public-beta'
    : null
}

function responseStatus(value: Record<string, unknown>): number {
  if (value.status === 'connected') return 200
  if (value.status === 'invalid_key') return 401
  if (value.status === 'not_authorized') return 403
  if (value.status === 'quota_or_rate_limited') return 429
  if (value.status === 'network_timeout') return 504
  return 422
}

export async function POST(req: NextRequest) {
  const mode = requestMode(req)
  if (!mode) {
    return noStoreJson({ error: '连接测试只允许从当前 AI-LifeOS 页面发起' }, 403)
  }
  if (Number(req.headers.get('content-length') ?? 0) > 4_096) {
    return noStoreJson({ error: '请求过大' }, 413)
  }
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return noStoreJson({ error: '请求格式无效' }, 400)
  }
  if (JSON.stringify(body).length > 8_000) {
    return noStoreJson({ error: '请求过大' }, 413)
  }
  if (!validLifeClientSessionId(body.clientSessionId)) {
    return noStoreJson({ error: '缺少稳定的浏览器会话 ID' }, 400)
  }
  const actionId = typeof body.actionId === 'string' ? body.actionId.trim() : ''
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(actionId)) {
    return noStoreJson({ error: '缺少稳定的连接测试 ID' }, 400)
  }

  let connection
  try {
    connection = validateByokConnection(body)
  } catch (error) {
    return noStoreJson({
      status: 'invalid_key',
      error: error instanceof Error ? error.message : '连接配置无效',
      code: 'invalid_connection',
    }, 400)
  }

  const credentialId = byokCredentialFingerprint(connection)
  let publicSessionId = ''
  if (mode === 'public-beta') {
    try {
      publicSessionId = publicBetaSessionFromHeaders(req.headers)
    } catch {
      return noStoreJson({ error: '匿名会话无效，请刷新页面后重试' }, 401)
    }
  } else {
    const limit = rateLimiter.take(`${body.clientSessionId}:${credentialId}`)
    if (!limit.allowed) {
      return noStoreJson({
        status: 'quota_or_rate_limited',
        error: '连接测试过于频繁，请稍后再试。',
        code: 'local_rate_limited',
      }, 429, { 'Retry-After': String(limit.retryAfterSeconds) })
    }
  }

  const fingerprint = fingerprintIdempotencyPayload({
    operation: 'byok-connection-test',
    provider: connection.provider,
    model: connection.model,
    credentialId,
  })
  try {
    const outcome = await idempotency.run({
      scope: `${mode === 'public-beta' ? publicSessionId : body.clientSessionId}:${credentialId}`,
      actionId,
      fingerprint,
      shouldCache: result => result.status === 'connected',
      operation: () => {
        const run = async () => {
          const startedAt = Date.now()
          try {
            const result = await runProviderText({
              connection,
              instructions: lifeRecordPrompt(SYNTHETIC_DATE),
              userText: SYNTHETIC_TEXT,
              maxOutputTokens: 600,
              temperature: 0.1,
              jsonOutput: true,
            })
            const parsed = parseModelRecordPayload(
              result.content,
              SYNTHETIC_DATE,
              SYNTHETIC_TEXT,
            )
            const types = new Set(parsed.records.map(record => record.type))
            if (!types.has('exercise') || !types.has('learning')) {
              return {
                status: 'invalid_schema',
                error: '模型响应通过 JSON 解析，但未正确识别合成测试记录。',
                code: 'provider_schema_mismatch',
              }
            }
            return {
              status: 'connected',
              provider: result.provider,
              providerLabel: byokConnectionLabel(connection),
              model: result.model,
              usage: result.usage,
              latencyMs: Date.now() - startedAt,
              requestId: result.requestId,
            }
          } catch (error) {
            if (error instanceof ModelTestUpstreamError) {
              return {
                status: byokStatusFromErrorCode(error.code),
                error: error.message,
                code: error.code,
                ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}),
                ...(error.requestId ? { requestId: error.requestId } : {}),
              }
            }
            if (error instanceof ProviderRequestError) {
              return {
                status: byokStatusFromErrorCode(error.code),
                error: error.message,
                code: error.code,
                ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}),
                ...(error.requestId ? { requestId: error.requestId } : {}),
              }
            }
            return {
              status: 'invalid_schema',
              error: '模型输出无法满足 AI-LifeOS 的生活记录结构要求。',
              code: 'provider_invalid_schema',
            }
          }
        }
        return mode === 'public-beta'
          ? withPublicBetaRequestBudget({
              operation: 'connection-test',
              sessionId: publicSessionId,
              credentialFingerprint: credentialId,
              run,
            })
          : run()
      },
    })
    return noStoreJson(outcome.value, responseStatus(outcome.value), {
      'x-ai-lifeos-idempotency': outcome.mode,
    })
  } catch (error) {
    if (error instanceof PublicBetaBudgetError) {
      return noStoreJson({
        status: 'quota_or_rate_limited',
        error: error.message,
        code: 'public_beta_rate_limited',
      }, error.status, { 'Retry-After': String(error.retryAfterSeconds) })
    }
    if (error instanceof IdempotencyConflictError) {
      return noStoreJson({ error: error.message, code: error.code }, 409)
    }
    return noStoreJson({
      status: 'invalid_schema',
      error: '连接测试失败，本次没有自动重试。',
      code: 'connection_test_failed',
    }, 500)
  }
}
