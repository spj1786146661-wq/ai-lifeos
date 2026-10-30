import { createHash, timingSafeEqual } from 'node:crypto'

export const LEGACY_HEALTH_API_FLAG = 'AIOS_ENABLE_LEGACY_HEALTH_API'
export const LEGACY_TELEGRAM_API_FLAG = 'AIOS_ENABLE_LEGACY_TELEGRAM_API'

export type ApiSecurityFailure = {
  ok: false
  status: 401 | 403 | 503
  code:
    | 'auth_not_configured'
    | 'auth_required'
    | 'invalid_auth'
    | 'user_mismatch'
}

export type ApiSecuritySuccess = {
  ok: true
  uid: string
}

export type ApiSecurityResult = ApiSecurityFailure | ApiSecuritySuccess

type TokenVerifier = (token: string) => Promise<{ uid: string }>

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function isLegacyApiEnabled(
  flagName: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[flagName] === 'true'
}

export function parseBearerToken(authorizationHeader: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader?.trim() ?? '')
  return match?.[1] ?? null
}

export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false
  return timingSafeEqual(digest(provided), digest(expected))
}

export function verifyBearerSecret(
  authorizationHeader: string | null,
  expectedSecret: string | null | undefined,
): ApiSecurityResult {
  if (!expectedSecret) {
    return { ok: false, status: 503, code: 'auth_not_configured' }
  }

  const token = parseBearerToken(authorizationHeader)
  if (!token) {
    return { ok: false, status: 401, code: 'auth_required' }
  }
  if (!secretsMatch(token, expectedSecret)) {
    return { ok: false, status: 401, code: 'invalid_auth' }
  }

  return { ok: true, uid: 'server' }
}

export function verifyConfiguredOwner(
  authorizationHeader: string | null,
  expectedSecret: string | null | undefined,
  configuredUserId: string | null | undefined,
): ApiSecurityResult {
  if (!expectedSecret || !configuredUserId) {
    return { ok: false, status: 503, code: 'auth_not_configured' }
  }

  const secretResult = verifyBearerSecret(authorizationHeader, expectedSecret)
  return secretResult.ok ? { ok: true, uid: configuredUserId } : secretResult
}

export function verifyWebhookSecret(
  providedSecret: string | null,
  expectedSecret: string | null | undefined,
): ApiSecurityResult {
  if (!expectedSecret) {
    return { ok: false, status: 503, code: 'auth_not_configured' }
  }
  if (!providedSecret) {
    return { ok: false, status: 401, code: 'auth_required' }
  }
  if (!secretsMatch(providedSecret, expectedSecret)) {
    return { ok: false, status: 401, code: 'invalid_auth' }
  }

  return { ok: true, uid: 'webhook' }
}

export async function verifyFirebaseBearer(
  authorizationHeader: string | null,
  verifyToken: TokenVerifier,
): Promise<ApiSecurityResult> {
  const token = parseBearerToken(authorizationHeader)
  if (!token) {
    return { ok: false, status: 401, code: 'auth_required' }
  }

  try {
    const decoded = await verifyToken(token)
    if (!decoded?.uid || typeof decoded.uid !== 'string') {
      return { ok: false, status: 401, code: 'invalid_auth' }
    }
    return { ok: true, uid: decoded.uid }
  } catch {
    return { ok: false, status: 401, code: 'invalid_auth' }
  }
}

export function requestedUserMatches(
  requestedUserId: unknown,
  authenticatedUserId: string,
): boolean {
  return typeof requestedUserId === 'string'
    && requestedUserId.length > 0
    && requestedUserId === authenticatedUserId
}
