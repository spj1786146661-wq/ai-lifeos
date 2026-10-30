import { NextRequest, NextResponse } from 'next/server'
import {
  isLanAllowedApi,
  isPublicTestApi,
  isTrustedPublicBrowserOrigin,
  isTrustedBrowserOrigin,
  LAN_VERIFIED_HEADER,
  PUBLIC_TEST_VERIFIED_HEADER,
  requestHostname,
} from '@/lib/lan-access'
import {
  MODEL_TEST_MAX_REQUEST_BYTES,
  ModelTestRateLimiter,
  ModelTestUpstreamError,
  requestTokenHubModel,
  validateModelTestRequest,
} from '@/lib/tokenhub-model-test'
import { MODEL_TEST_TIMEOUT_MS } from '@/lib/tokenhub-model-test-shared'

export const runtime = 'nodejs'

const rateLimiter = new ModelTestRateLimiter(8, 60_000)

function noStoreJson(
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  })
}

/**
 * Accepts loopback requests, or a verified LAN request. LAN requests must also
 * have an exact same-origin browser Origin; a Wi-Fi access cookie alone is not
 * enough to invoke a paid model endpoint.
 */
function authorized(req: NextRequest): boolean {
  const hostHeader = req.headers.get('host')
  const hostname = requestHostname(hostHeader)
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return true
  const publicApi = isPublicTestApi(
    hostname,
    req.nextUrl.pathname,
    req.headers.get(PUBLIC_TEST_VERIFIED_HEADER),
    process.env.AIOS_PUBLIC_TEST_HOSTS,
  )
  if (publicApi) {
    return isTrustedPublicBrowserOrigin(req.headers.get('origin'), hostHeader)
  }
  if (!isLanAllowedApi(
    hostname,
    req.nextUrl.pathname,
    req.headers.get(LAN_VERIFIED_HEADER),
  )) return false
  return isTrustedBrowserOrigin(req.headers.get('origin'), hostHeader)
}

function rateLimitKey(req: NextRequest): string {
  // This development server does not expose a trustworthy remote address to
  // route handlers. A single process-wide bucket is conservative and prevents
  // one local client from bursting requests.
  void req
  return 'model-test-local-process'
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return noStoreJson({ error: '该测试接口仅允许本机或已验证的局域网设备使用。' }, 403)
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MODEL_TEST_MAX_REQUEST_BYTES) {
    return noStoreJson({ error: '请求内容过大，请缩短后再试。' }, 413)
  }

  const limit = rateLimiter.take(rateLimitKey(req))
  if (!limit.allowed) {
    return noStoreJson(
      { error: '请求过于频繁，请稍后再试。', code: 'local_rate_limited' },
      429,
      { 'Retry-After': String(limit.retryAfterSeconds) },
    )
  }

  let body: unknown
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > MODEL_TEST_MAX_REQUEST_BYTES) {
      return noStoreJson({ error: '请求内容过大，请缩短后再试。' }, 413)
    }
    body = JSON.parse(raw) as unknown
  } catch {
    return noStoreJson({ error: '请求格式无效，请发送 JSON。' }, 400)
  }

  const validation = validateModelTestRequest(body)
  if (!validation.ok) {
    return noStoreJson({ error: validation.error }, validation.status)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MODEL_TEST_TIMEOUT_MS)
  try {
    const result = await requestTokenHubModel(validation.messages, {
      signal: controller.signal,
    })
    return noStoreJson(result)
  } catch (error) {
    if (error instanceof ModelTestUpstreamError) {
      return noStoreJson({
        error: error.message,
        code: error.code,
        ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}),
        ...(error.requestId ? { requestId: error.requestId } : {}),
      }, error.status)
    }
    // Never log the request body or headers here.
    return noStoreJson({
      error: '模型测试请求失败，请稍后重试。',
      code: 'model_test_internal_error',
    }, 500)
  } finally {
    clearTimeout(timeout)
  }
}
