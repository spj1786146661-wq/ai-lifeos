/**
 * Pure helpers for LAN mode.
 *
 * The middleware and the launcher share this module so the policy can be
 * tested without starting Next.js. Nothing here reads a credential file.
 */

export const LAN_ACCESS_COOKIE = 'aios_lan_access'
export const LAN_VERIFIED_HEADER = 'x-aios-lan-verified'
export const PUBLIC_TEST_VERIFIED_HEADER = 'x-aios-public-test-verified'
export const PUBLIC_BETA_VERIFIED_HEADER = 'x-aios-public-beta-verified'
export const PERSONAL_ALPHA_BYOK_ENV = 'AIOS_PERSONAL_ALPHA_BYOK'
export const PERSONAL_ALPHA_BYOK_HOST_ENV = 'AIOS_PERSONAL_ALPHA_BYOK_HOST'

export const PUBLIC_TEST_PAGE_PATH = '/model-test'
export const PUBLIC_TEST_API_PATH = '/api/model-test/chat'
export const PUBLIC_BETA_TOKENHUB_TEST_PATH = '/api/ai/providers/tokenhub/test'
export const PUBLIC_BETA_PROVIDER_TEST_PATH = '/api/ai/providers/test'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const PRIVATE_IPV4 =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/

/** Normalises a Host header to a bare hostname without a port. */
export function requestHostname(hostHeader: string | null): string {
  if (!hostHeader) return ''
  const value = hostHeader.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 0 ? value.slice(0, end + 1) : value
  }
  return value.split(':', 1)[0]
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase())
}

export function isPrivateIpv4(hostname: string): boolean {
  return PRIVATE_IPV4.test(hostname)
}

/**
 * Personal Alpha BYOK is opt-in and bound to one exact loopback Host header.
 * This keeps the SSH-tunnel workflow available without widening Public Beta,
 * LAN mode, or another local port.
 */
export function isPersonalAlphaByokHost(
  hostHeader: string | null,
  enabled: string | null | undefined,
  configuredHost: string | null | undefined,
): boolean {
  if (enabled?.trim().toLowerCase() !== '1') return false
  const host = hostHeader?.trim().toLowerCase() ?? ''
  const expected = configuredHost?.trim().toLowerCase() ?? ''
  if (!host || !expected || host !== expected) return false
  const match = /^(localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})$/.exec(host)
  if (!match) return false
  const port = Number(match[2])
  return Number.isInteger(port) && port > 0 && port <= 65_535
}

/** Browser-side display gate. Server routes independently enforce the same mode. */
export function isPersonalAlphaByokClientSurface(
  hostname: string,
  serverMarker: string | null | undefined,
): boolean {
  return serverMarker === 'true' && isLoopbackHostname(hostname)
}

/**
 * The only APIs a verified LAN device may use. A private IP by itself is not
 * authorization; the proxy must also attach its internal header.
 */
export function isLanAllowedApi(
  hostname: string,
  pathname: string,
  verifiedHeader: string | null,
): boolean {
  if (!isPrivateIpv4(hostname) || verifiedHeader !== 'verified') return false
  return pathname === '/api/life-records/parse'
    || pathname === '/api/life-records/chat'
    || pathname === '/api/life-records/image'
    || pathname === '/api/model-test/chat'
}

/**
 * LAN mode is only enabled for an explicit private IPv4 host. A Host header
 * such as localhost or a public domain must never widen the scope.
 */
export function isLanHostname(hostname: string): boolean {
  return isPrivateIpv4(hostname)
}

/**
 * Public mode is an explicit, narrow deployment mode for the isolated model
 * test page. The allowlist is a comma-separated list of exact hostnames, with
 * no wildcard support. It must be configured separately from LAN mode.
 */
export function isPublicTestHostname(
  hostname: string,
  allowlist: string | null | undefined,
): boolean {
  if (!hostname || !allowlist) return false
  const candidate = hostname.trim().toLowerCase()
  if (!candidate) return false
  return allowlist
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .some(value => value === candidate)
}

/**
 * Only the isolated model-test page and its single API may be reached in
 * public mode. This helper deliberately has no route for life-record, OAuth,
 * backup, Telegram or other product APIs.
 */
export function isPublicTestRoute(pathname: string, method: string): boolean {
  const upperMethod = method.toUpperCase()
  if (pathname === PUBLIC_TEST_PAGE_PATH) {
    return upperMethod === 'GET' || upperMethod === 'HEAD'
  }
  return pathname === PUBLIC_TEST_API_PATH && upperMethod === 'POST'
}

export function isPublicTestApi(
  hostname: string,
  pathname: string,
  verifiedHeader: string | null,
  allowlist: string | null | undefined,
): boolean {
  return verifiedHeader === 'verified'
    && pathname === PUBLIC_TEST_API_PATH
    && isPublicTestHostname(hostname, allowlist)
}

/** Exact-host Public Beta mode; wildcard and private/loopback hosts are invalid. */
export function isPublicBetaHostname(
  hostname: string,
  allowlist: string | null | undefined,
): boolean {
  if (!hostname || !allowlist || isLoopbackHostname(hostname) || isPrivateIpv4(hostname)) {
    return false
  }
  const candidate = hostname.trim().toLowerCase()
  return allowlist
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .some(value => value === candidate)
}

/**
 * Minimal public product surface. Every future API remains denied until added
 * here deliberately and protected inside the route as well.
 */
export function isPublicBetaRoute(pathname: string, method: string): boolean {
  const upperMethod = method.toUpperCase()
  if (
    pathname === '/'
    || pathname === '/privacy'
    || pathname === '/terms'
    || pathname === '/source'
  ) {
    return upperMethod === 'GET' || upperMethod === 'HEAD'
  }
  if (pathname === '/api/life-records/parse') {
    return upperMethod === 'GET'
  }
  if (
    pathname === '/api/life-records/chat'
    || pathname === '/api/life-records/follow-up'
    || pathname === PUBLIC_BETA_PROVIDER_TEST_PATH
    || pathname === PUBLIC_BETA_TOKENHUB_TEST_PATH
  ) {
    return upperMethod === 'POST'
  }
  return false
}

export function isPublicBetaApi(
  hostname: string,
  pathname: string,
  verifiedHeader: string | null,
  allowlist: string | null | undefined,
): boolean {
  return verifiedHeader === 'verified'
    && pathname.startsWith('/api/')
    && (
      pathname === '/api/life-records/parse'
      || pathname === '/api/life-records/chat'
      || pathname === '/api/life-records/follow-up'
      || pathname === PUBLIC_BETA_PROVIDER_TEST_PATH
      || pathname === PUBLIC_BETA_TOKENHUB_TEST_PATH
    )
    && isPublicBetaHostname(hostname, allowlist)
}

/** Parses Cookie without trusting the URL or browser APIs. */
export function readCookie(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return ''
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() !== name) continue
    try { return decodeURIComponent(part.slice(index + 1).trim()) }
    catch { return '' }
  }
  return ''
}

export type LanRouteDecision = 'allow' | 'deny'

export interface LanRoutePolicyInput {
  pathname: string
  method: string
  hostname: string
  hasValidDeviceCookie: boolean
  hasTrustedBrowserOrigin: boolean
}

/**
 * Minimal LAN policy.
 *
 * - Read-only shell/static/asset endpoints are available after device auth.
 * - Only explicitly allowlisted pages and APIs can be called by a verified LAN
 *   device. The model test page is isolated from life-record storage.
 * - OAuth management, credentials, backups and every other API stay loopback.
 *
 * Denying by default is intentional: a future API route cannot silently
 * become reachable from Wi-Fi merely because it was added.
 */
export function decideLanRoute(input: LanRoutePolicyInput): LanRouteDecision {
  const pathname = input.pathname
  const method = input.method.toUpperCase()

  if (!input.hasValidDeviceCookie) return 'deny'

  const readOnlyMethod = method === 'GET' || method === 'HEAD'
  const isShell =
    pathname === '/' ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/icons/')

  if (isShell && readOnlyMethod) return 'allow'
  if (pathname === '/model-test' && readOnlyMethod) return 'allow'
  if (pathname === '/api/life-records/parse' && (readOnlyMethod || method === 'POST')) return 'allow'

  const lanRecordWrite =
    pathname === '/api/life-records/chat' ||
    pathname === '/api/life-records/image' ||
    pathname === '/api/model-test/chat'
  if (lanRecordWrite && method === 'POST') {
    return input.hasTrustedBrowserOrigin ? 'allow' : 'deny'
  }

  return 'deny'
}

/** The browser must not be able to turn a cross-site POST into a model call. */
export function isTrustedBrowserOrigin(originHeader: string | null, hostHeader: string | null): boolean {
  if (!originHeader || !hostHeader) return false
  try {
    const origin = new URL(originHeader)
    return origin.protocol === 'http:'
      && origin.host.toLowerCase() === hostHeader.toLowerCase()
      && isLanHostname(requestHostname(hostHeader))
  } catch {
    return false
  }
}

/** Public deployments are HTTPS-only and must match the exact request host. */
export function isTrustedPublicBrowserOrigin(
  originHeader: string | null,
  hostHeader: string | null,
): boolean {
  if (!originHeader || !hostHeader) return false
  try {
    const origin = new URL(originHeader)
    return origin.protocol === 'https:'
      && origin.host.toLowerCase() === hostHeader.toLowerCase()
  } catch {
    return false
  }
}
