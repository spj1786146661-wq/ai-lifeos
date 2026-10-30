import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  LAN_ACCESS_COOKIE,
  LAN_VERIFIED_HEADER,
  PUBLIC_BETA_VERIFIED_HEADER,
  PUBLIC_TEST_VERIFIED_HEADER,
  decideLanRoute,
  isLanHostname,
  isLoopbackHostname,
  isPublicBetaHostname,
  isPublicBetaRoute,
  isPublicTestHostname,
  isPublicTestRoute,
  isTrustedPublicBrowserOrigin,
  isTrustedBrowserOrigin,
  readCookie,
  requestHostname,
} from '@/lib/lan-access'
import {
  issuePublicBetaSession,
  PUBLIC_BETA_INGRESS_HEADER,
  PUBLIC_BETA_NONCE_HEADER,
  PUBLIC_BETA_SESSION_COOKIE,
  PUBLIC_BETA_SESSION_HEADER,
  publicBetaIngressAuthorized,
  publicBetaRuntimeStatus,
  verifyPublicBetaSession,
} from '@/lib/public-beta-security'

const LOGIN_PATH = '/__lan/login'

function securityHeaders(response: NextResponse, noStore = false): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  if (noStore) response.headers.set('Cache-Control', 'no-store')
  return response
}

function publicBetaSecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  securityHeaders(response, true)
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "manifest-src 'self'",
      "worker-src 'self' blob:",
      'upgrade-insecure-requests',
    ].join('; '),
  )
  return response
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character))
}

function loginPage(error = ''): NextResponse {
  const message = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : '<p class="hint">输入电脑启动窗口显示的局域网访问码。访问码只在本机终端显示，不会发送到互联网。</p>'
  return securityHeaders(new NextResponse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>AI人生数据库 · 局域网访问</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050b16;color:#e8fbff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
main{width:min(420px,100%);border:1px solid #164e63;background:linear-gradient(160deg,#071827,#04101d);border-radius:24px;padding:28px;box-shadow:0 24px 80px #00d3ff1f}
.eyebrow{letter-spacing:.22em;color:#67e8f9;font-size:11px;font-weight:700}
h1{font-size:26px;line-height:1.2;margin:10px 0 8px}
p{color:#a5c7d4;font-size:14px}
.hint{background:#082f49;border:1px solid #155e75;border-radius:14px;padding:12px;color:#bae6fd}
.error{background:#450a0a;border:1px solid #991b1b;border-radius:14px;padding:12px;color:#fecaca}
label{display:block;margin:22px 0 8px;color:#bae6fd;font-size:13px}
input{width:100%;border:1px solid #155e75;border-radius:14px;background:#020a13;color:#ecfeff;font:600 22px/1 ui-monospace,monospace;letter-spacing:.18em;padding:16px;text-align:center}
button{width:100%;margin-top:14px;border:0;border-radius:14px;background:#22d3ee;color:#04111d;font:800 16px system-ui;padding:14px;cursor:pointer}
small{display:block;margin-top:16px;color:#5f8796;font-size:11px}
</style></head><body><main>
<div class="eyebrow">AI / LIFE DATABASE</div>
<h1>局域网访问验证</h1>
<p>这台设备正在通过 Wi-Fi 访问电脑上的 AI人生数据库。验证通过后，页面会正常打开。</p>
${message}
<form method="post" action="${LOGIN_PATH}">
<label for="key">局域网访问码</label>
<input id="key" name="key" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required>
<button type="submit">验证并进入</button>
</form>
<small>只允许受信任的私有 Wi-Fi。不要输入 OpenAI、ChatGPT 或其他账号密码。</small>
</main></body></html>`, {
    status: error ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }), true)
}

function cookieValue(request: NextRequest): string {
  return readCookie(request.headers.get('cookie'), LAN_ACCESS_COOKIE)
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!left || !right) return false
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

async function handleLogin(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.AIOS_LAN_ACCESS_KEY?.trim() ?? ''
  if (!expected) return loginPage('电脑没有启用局域网访问。请用 start-dev.ps1 -Lan 重新启动。')
  let submitted = ''
  try {
    const form = await request.formData()
    submitted = String(form.get('key') ?? '').trim().toUpperCase()
  } catch {
    return loginPage('提交内容无效，请重试。')
  }
  if (!constantTimeEqual(submitted, expected.toUpperCase())) {
    return loginPage('访问码不正确。请查看电脑启动窗口，不要猜测或反复尝试。')
  }
  const response = NextResponse.redirect(new URL('/', request.url), 303)
  response.cookies.set(LAN_ACCESS_COOKIE, submitted, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return securityHeaders(response, true)
}

export async function proxy(request: NextRequest) {
  const hostHeader = request.headers.get('host')
  const hostname = requestHostname(hostHeader)
  const { pathname } = request.nextUrl
  // Never trust a browser-supplied verification marker. Only the proxy below
  // may add these headers, after the applicable host, device and route policy
  // passes. Strip both regardless of which mode the current host uses.
  const incomingHeaders = new Headers(request.headers)
  incomingHeaders.delete(LAN_VERIFIED_HEADER)
  incomingHeaders.delete(PUBLIC_TEST_VERIFIED_HEADER)
  incomingHeaders.delete(PUBLIC_BETA_VERIFIED_HEADER)
  incomingHeaders.delete(PUBLIC_BETA_SESSION_HEADER)
  incomingHeaders.delete(PUBLIC_BETA_NONCE_HEADER)

  // The existing personal mode is unchanged: loopback requests stay local-only.
  if (isLoopbackHostname(hostname)) {
    return securityHeaders(NextResponse.next({ request: { headers: incomingHeaders } }))
  }

  const publicBetaAllowlist = process.env.AIOS_PUBLIC_BETA_HOSTS
  if (isPublicBetaHostname(hostname, publicBetaAllowlist)) {
    const runtime = publicBetaRuntimeStatus()
    if (!runtime.ok) {
      return securityHeaders(
        NextResponse.json({ error: 'Public Beta 尚未完成安全配置', code: 'public_beta_not_ready' }, { status: 503 }),
        true,
      )
    }
    if (!publicBetaIngressAuthorized(request.headers.get(PUBLIC_BETA_INGRESS_HEADER))) {
      return securityHeaders(
        NextResponse.json({ error: '请求未经过受信任的 HTTPS 入口' }, { status: 403 }),
        true,
      )
    }
    const publicRoute = isPublicBetaRoute(pathname, request.method)
    const publicOrigin = isTrustedPublicBrowserOrigin(
      request.headers.get('origin'),
      hostHeader,
    )
    const publicRead =
      (request.method === 'GET' || request.method === 'HEAD')
      && (
        pathname === '/'
        || pathname === '/privacy'
        || pathname === '/terms'
        || pathname === '/source'
        || pathname === '/api/life-records/parse'
      )
    if (!publicRoute || (!publicRead && !publicOrigin)) {
      return securityHeaders(
        NextResponse.json({ error: '该接口未在 Public Beta 开放' }, { status: 403 }),
        true,
      )
    }
    const cookieSession = verifyPublicBetaSession(
      readCookie(request.headers.get('cookie'), PUBLIC_BETA_SESSION_COOKIE),
    )
    const readOnlyPage =
      (request.method === 'GET' || request.method === 'HEAD')
      && !pathname.startsWith('/api/')
    const issuedSession = cookieSession
      ? null
      : readOnlyPage
        ? issuePublicBetaSession()
        : null
    const sessionId = cookieSession ?? issuedSession?.id ?? null
    if (!sessionId) {
      return securityHeaders(
        NextResponse.json({ error: '匿名会话无效，请刷新页面后重试' }, { status: 401 }),
        true,
      )
    }
    const nonce = crypto.randomUUID().replace(/-/g, '')
    const forwarded = new Headers(incomingHeaders)
    forwarded.set(PUBLIC_BETA_VERIFIED_HEADER, 'verified')
    forwarded.set(PUBLIC_BETA_SESSION_HEADER, sessionId)
    forwarded.set(PUBLIC_BETA_NONCE_HEADER, nonce)
    forwarded.delete(PUBLIC_BETA_INGRESS_HEADER)
    const downstream = NextResponse.next({ request: { headers: forwarded } })
    downstream.headers.set('X-AIOS-Public-Beta-Mode', 'enabled')
    if (issuedSession) {
      downstream.cookies.set(PUBLIC_BETA_SESSION_COOKIE, issuedSession.value, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: issuedSession.maxAge,
      })
    }
    return publicBetaSecurityHeaders(downstream, nonce)
  }

  // Public mode is deliberately independent from LAN mode. It only exposes the
  // isolated model-test page and API on an exact, explicitly configured host.
  // If that host is not allowed, execution falls through to the existing LAN
  // policy, which rejects every non-private host by default.
  const publicAllowlist = process.env.AIOS_PUBLIC_TEST_HOSTS
  if (isPublicTestHostname(hostname, publicAllowlist)) {
    const publicRoute = isPublicTestRoute(pathname, request.method)
    const publicOrigin = isTrustedPublicBrowserOrigin(
      request.headers.get('origin'),
      hostHeader,
    )
    const publicRead =
      (request.method === 'GET' || request.method === 'HEAD') &&
      pathname === '/model-test'
    if (!publicRoute || (!publicRead && !publicOrigin)) {
      return securityHeaders(
        NextResponse.json({ error: '该接口未在此公网测试实例开放' }, { status: 403 }),
        true,
      )
    }
    const forwarded = new Headers(incomingHeaders)
    forwarded.set(PUBLIC_TEST_VERIFIED_HEADER, 'verified')
    const downstream = NextResponse.next({ request: { headers: forwarded } })
    downstream.headers.set('X-AIOS-Public-Test-Mode', 'enabled')
    return securityHeaders(downstream, pathname.startsWith('/api/'))
  }

  // Never trust a public hostname or a DNS name in this first LAN phase.
  if (!isLanHostname(hostname)) {
    return securityHeaders(NextResponse.json({ error: '局域网访问必须使用电脑的私有 IPv4 地址' }, { status: 403 }), true)
  }

  if (pathname === LOGIN_PATH) {
    if (request.method === 'POST') return handleLogin(request)
    return loginPage()
  }

  const expected = process.env.AIOS_LAN_ACCESS_KEY?.trim() ?? ''
  const hasValidDeviceCookie =
    Boolean(expected) &&
    constantTimeEqual(cookieValue(request), expected.toUpperCase())

  if (!hasValidDeviceCookie) {
    if (request.method === 'GET' || request.method === 'HEAD') return loginPage()
    return securityHeaders(NextResponse.json({ error: '局域网设备未验证' }, { status: 401 }), true)
  }

  const trustedOrigin = isTrustedBrowserOrigin(
    request.headers.get('origin'),
    hostHeader,
  )
  const decision = decideLanRoute({
    pathname,
    method: request.method,
    hostname,
    hasValidDeviceCookie,
    hasTrustedBrowserOrigin: trustedOrigin,
  })

  if (decision === 'deny') {
    return securityHeaders(
      NextResponse.json({ error: '该接口仅允许在电脑本机使用' }, { status: 403 }),
      true,
    )
  }

  const forwarded = new Headers(incomingHeaders)
  forwarded.set(LAN_VERIFIED_HEADER, 'verified')
  const requestHeaders = new Headers(forwarded)
  const downstream = NextResponse.next({ request: { headers: requestHeaders } })
  downstream.headers.set('X-AIOS-LAN-Mode', 'device-authorized')
  securityHeaders(downstream, pathname.startsWith('/api/'))
  return downstream
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)',
  ],
}
