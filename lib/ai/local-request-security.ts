/**
 * Sensitive ChatGPT-plan endpoints are usable only by a same-origin page served
 * from this machine. Host and Origin checks prevent a remote website from making
 * a browser submit state-changing requests to the loopback service.
 */
export interface LocalRequestSecurityInput {
  protocol: string
  hostHeader: string | null
  originHeader: string | null
  refererHeader?: string | null
  secFetchSite?: string | null
  stateChanging: boolean
}

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])

function parseUrl(value: string): URL | null {
  try { return new URL(value) } catch { return null }
}

export function isTrustedLocalRequest(input: LocalRequestSecurityInput): boolean {
  if (!input.hostHeader) return false
  const requestUrl = parseUrl(`${input.protocol}//${input.hostHeader}`)
  if (!requestUrl || !LOCAL_HOSTNAMES.has(requestUrl.hostname)) return false
  if (requestUrl.username || requestUrl.password || requestUrl.pathname !== '/') return false

  const fetchSite = input.secFetchSite?.toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false

  const origin = input.originHeader ? parseUrl(input.originHeader) : null
  if (input.originHeader && !origin) return false
  if (origin && origin.origin !== requestUrl.origin) return false

  const referer = input.refererHeader ? parseUrl(input.refererHeader) : null
  if (input.refererHeader && !referer) return false
  if (referer && referer.origin !== requestUrl.origin) return false

  if (input.stateChanging && !origin && !referer && fetchSite !== 'same-origin') return false
  return true
}
