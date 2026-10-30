/**
 * @module ai/chatgpt-plan-oauth
 * @description Official "Sign in with ChatGPT" open-source OAuth 2.0 + PKCE flow
 * for the ChatGPT plan usage path.
 *
 * Flow implemented exactly as documented:
 * 1. First registration: client_id=dynamic_agent_client + agent_name_hint +
 *    ext_agent_host_id, loopback redirect_uri on 127.0.0.1.
 * 2. Callback returns code, state and the issued client_id (oaiapp_...).
 * 3. Exchange the code at the token endpoint (no client secret).
 * 4. Validate the ID token signature against JWKS, issuer, audience, expiry, nonce.
 * 5. Confirm the granted scopes contain chatgpt.tokens.use.direct before inference.
 *
 * No password, cookie, Codex token or backend-api call is ever involved.
 */
import { createPublicKey, createVerify, randomBytes } from 'node:crypto'
import {
  CHATGPT_AUTHORIZE_URL,
  CHATGPT_ISSUER,
  CHATGPT_JWKS_URL,
  CHATGPT_PLAN_RESOURCE,
  CHATGPT_PLAN_SCOPE,
  CHATGPT_REVOKE_URL,
  CHATGPT_TOKEN_URL,
  DYNAMIC_CLIENT_ID,
  isAcceptedExtAgentHostId,
  resolveExtAgentHostId,
  clearPlanCredentials,
  readPlanCredentials,
  sha256Base64Url,
  writePlanCredentials,
  type PlanCredentials,
} from './chatgpt-plan-credentials.ts'

export interface PendingAuthorization {
  state: string
  nonce: string
  codeVerifier: string
  codeChallenge: string
  redirectUri: string
  clientId: string
  extAgentHostId: string
  createdAt: number
}

export interface AuthorizationStart {
  authorizeUrl: string
  pending: PendingAuthorization
}

const STATE_TTL_MS = 10 * 60 * 1000

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

export function randomUrlSafe(bytes = 32): string {
  return base64Url(randomBytes(bytes))
}

export function pkceChallenge(verifier: string): string {
  return sha256Base64Url(verifier)
}

/**
 * The host id must be stable per machine and distinct per installation. Only the
 * officially accepted formats are returned: urn:uuid:<UUIDv4>, a JWK thumbprint
 * URI, or did:key. A bare UUID gains its urn:uuid: prefix. Anything else is
 * replaced by a fresh UUIDv4, because the authorization endpoint rejects a
 * non-conforming host id before any registration happens.
 */
export function ensureExtAgentHostId(existing?: string | null): string {
  const value = typeof existing === 'string' ? normalizeExtAgentHostId(existing) : existing
  if (isAcceptedExtAgentHostId(value)) return value
  // A bare UUID keeps its identity and only gains the urn:uuid: prefix; a value
  // the endpoint cannot accept is replaced with a fresh UUIDv4.
  return resolveExtAgentHostId(value).hostId
}

/** Guard so no request is ever built with a host id the endpoint would reject. */
export function assertExtAgentHostId(hostId: string): void {
  if (!isAcceptedExtAgentHostId(hostId)) throw new Error('ext_agent_host_id 格式不被官方接受，请使用 UUIDv4、JWK thumbprint 或 did:key')
}

/** Guard so a host id never contains stray whitespace or quotes that break encoding. */
export function normalizeExtAgentHostId(hostId: string): string {
  return hostId.trim().replace(/^["']|["']$/g, '')
}

function assertLoopbackRedirect(redirectUri: string): void {
  let url: URL
  try { url = new URL(redirectUri) } catch { throw new Error('授权回调地址无效') }
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || !url.port
    || url.pathname !== '/auth/callback'
    || url.search
    || url.hash
    || url.username
    || url.password
  ) {
    throw new Error('授权回调必须使用 http://127.0.0.1:<port>/auth/callback')
  }
}

export function startAuthorization(options: {
  extAgentHostId: string
  redirectUri: string
  clientId?: string
  agentNameHint?: string
  idTokenHint?: string | null
}): AuthorizationStart {
  assertLoopbackRedirect(options.redirectUri)
  const extAgentHostId = normalizeExtAgentHostId(options.extAgentHostId)
  assertExtAgentHostId(extAgentHostId)
  const state = randomUrlSafe(32)
  const nonce = randomUrlSafe(32)
  const codeVerifier = randomUrlSafe(48)
  const isFirstRegistration = !options.clientId
  // The redirect_uri is encoded once by URLSearchParams; the host id must not be
  // re-encoded or wrapped in quotes, which is what a raw string concatenation or
  // a previously stored base64url value would cause.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId ?? DYNAMIC_CLIENT_ID,
    redirect_uri: options.redirectUri,
    scope: CHATGPT_PLAN_SCOPE,
    resource: CHATGPT_PLAN_RESOURCE,
    // Required host identifier, distinct for each host.
    ext_agent_host_id: extAgentHostId,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: pkceChallenge(codeVerifier),
  })
  // agent_name_hint is only sent on the initial dynamic-registration request.
  if (isFirstRegistration && options.agentNameHint) params.set('agent_name_hint', options.agentNameHint)
  if (options.idTokenHint) params.set('id_token_hint', options.idTokenHint)
  return {
    authorizeUrl: `${CHATGPT_AUTHORIZE_URL}?${params.toString()}`,
    pending: {
      state,
      nonce,
      codeVerifier,
      codeChallenge: pkceChallenge(codeVerifier),
      redirectUri: options.redirectUri,
      clientId: options.clientId ?? DYNAMIC_CLIENT_ID,
      extAgentHostId,
      createdAt: Date.now(),
    },
  }
}

export function assertPendingFresh(pending: PendingAuthorization): void {
  if (!pending?.state || !pending?.nonce || !pending?.codeVerifier) throw new Error('授权会话无效，请重新开始')
  if (Date.now() - pending.createdAt > STATE_TTL_MS) throw new Error('授权已超时，请重新开始')
}

export interface CallbackResult {
  code: string
  state: string
  clientId: string | null
  scope: string | null
}

/** Parse and validate the loopback callback before any token request. */
export function parseCallback(callbackUrl: string, pending: PendingAuthorization): CallbackResult {
  assertPendingFresh(pending)
  const url = new URL(callbackUrl)
  if (`${url.origin}${url.pathname}` !== pending.redirectUri) {
    throw new Error('授权回调地址与本次授权不一致')
  }
  const error = url.searchParams.get('error')
  if (error) {
    const description = url.searchParams.get('error_description')
    throw new Error(description ? `授权被拒绝：${description}` : `授权被拒绝：${error}`)
  }
  const state = url.searchParams.get('state')
  if (!state || state !== pending.state) throw new Error('回调 state 不匹配，本次授权已作废')
  const code = url.searchParams.get('code')
  if (!code) throw new Error('回调缺少授权码')
  const clientId = url.searchParams.get('client_id')
  // On reauthorization the callback may omit client_id; keep the saved one. A
  // different client_id means the result belongs to another registration.
  if (clientId && clientId !== pending.clientId && pending.clientId !== DYNAMIC_CLIENT_ID) {
    throw new Error('回调 client_id 与本次授权不一致，已拒绝')
  }
  return { code, state, clientId, scope: url.searchParams.get('scope') }
}

/**
 * Safe, non-secret diagnostics for an authorization-code exchange failure.
 * Every field here is either a boolean/enum describing our own request or a
 * short, redacted string returned by OpenAI. No code, verifier, token or
 * authorization header is ever captured.
 */
export interface TokenExchangeDiagnostics {
  stage: 'authorization_code_exchange'
  status: number
  /** Which client_id the exchange actually sent. */
  clientIdKind: 'issued' | 'saved' | 'missing'
  /** Whether the sent client_id looks like an OpenAI-issued `oaiapp_` value. */
  clientIdFormatOk: boolean
  redirectScheme: 'http' | 'other'
  redirectLoopback: boolean
  redirectHasPort: boolean
  redirectPathOk: boolean
  resourceOk: boolean
  pkcePresent: boolean
  errorCode?: string
  errorType?: string
  errorParam?: string
  errorMessage?: string
  requestId?: string
  /** Official OpenAI restriction: the request left from a blocked region. */
  regionBlocked: boolean
}

export const OAUTH_REGION_BLOCKED_CODE = 'unsupported_country_region_territory'

export class OAuthExchangeError extends Error {
  readonly diagnostics: TokenExchangeDiagnostics

  constructor(diagnostics: TokenExchangeDiagnostics) {
    super(describeExchangeFailure(diagnostics))
    this.name = 'OAuthExchangeError'
    this.diagnostics = diagnostics
  }
}

function pickSafeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Extract the standard OAuth error fields from a response body. Handles both the
 * nested `{"error":{...}}` shape and the flat RFC 6749 shape, and returns an
 * empty object for HTML or otherwise unparseable bodies. The raw body is never
 * kept or logged.
 */
export function parseOAuthErrorPayload(raw: string): {
  code?: string
  type?: string
  message?: string
  param?: string
} {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return {} }
  if (!parsed || typeof parsed !== 'object') return {}
  const root = parsed as Record<string, unknown>
  const nested = root.error
  const source = nested && typeof nested === 'object'
    ? nested as Record<string, unknown>
    : root
  return {
    code: pickSafeString(source.code) ?? pickSafeString(source.error),
    type: pickSafeString(source.type),
    message: pickSafeString(source.message) ?? pickSafeString(source.error_description),
    param: pickSafeString(source.param),
  }
}

const MAX_DIAGNOSTIC_TEXT = 240

/**
 * Strip anything that could carry a secret before a server message is shown in
 * the UI. Only the caller-supplied secrets plus common token shapes are removed.
 */
export function redactDiagnosticText(text: string | undefined, secrets: string[] = []): string | undefined {
  if (!text) return undefined
  let safe = text
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) safe = safe.split(secret).join('[redacted]')
  }
  safe = safe.replace(/\b(access_token|refresh_token|id_token|authorization_code|code_verifier|client_secret|authorization|password|verifier|secret|token|code)\b\s*[=:]\s*\S+/gi, '$1=[redacted]')
  safe = safe.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]')
  safe = safe.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!safe) return undefined
  return safe.length > MAX_DIAGNOSTIC_TEXT ? `${safe.slice(0, MAX_DIAGNOSTIC_TEXT)}…` : safe
}

export function describeExchangeFailure(diagnostics: TokenExchangeDiagnostics): string {
  if (diagnostics.clientIdKind === 'missing') {
    return '首次授权没有在回调中获得 OpenAI 签发的 client_id，已停止交换，且没有发送任何令牌请求。请重新发起授权。'
  }
  const codeSuffix = diagnostics.errorCode ? `，${diagnostics.errorCode}` : ''
  let message: string
  if (diagnostics.regionBlocked) {
    message = `授权码交换被 OpenAI 官方拒绝（HTTP ${diagnostics.status}${codeSuffix}）：当前网络出口所在的国家或地区不在 OpenAI 支持范围内。`
      + '这是官方区域限制，不是本项目 OAuth 参数错误。本项目不会通过更换账号、伪造身份或绕过限制处理此问题。'
  } else if (diagnostics.errorCode) {
    message = `授权码交换失败（HTTP ${diagnostics.status}${codeSuffix}）`
    if (diagnostics.errorMessage) message += `：${diagnostics.errorMessage}`
    message += '。'
  } else {
    message = `授权码交换失败（HTTP ${diagnostics.status}）。请稍后重新发起授权。`
  }
  if (diagnostics.requestId) message += ` 请求 ID：${diagnostics.requestId}。`
  return message
}

function buildExchangeDiagnostics(input: {
  status: number
  text: string
  requestId: string | null
  clientIdKind: 'issued' | 'saved'
  clientId: string
  pending: PendingAuthorization
}): TokenExchangeDiagnostics {
  const parsed = parseOAuthErrorPayload(input.text)
  const secrets = [input.clientId]
  let redirectScheme: 'http' | 'other' = 'other'
  let redirectLoopback = false
  let redirectHasPort = false
  let redirectPathOk = false
  try {
    const redirect = new URL(input.pending.redirectUri)
    redirectScheme = redirect.protocol === 'http:' ? 'http' : 'other'
    redirectLoopback = redirect.hostname === '127.0.0.1'
    redirectHasPort = Boolean(redirect.port)
    redirectPathOk = redirect.pathname === '/auth/callback'
  } catch { /* leave the conservative defaults */ }
  return {
    stage: 'authorization_code_exchange',
    status: input.status,
    clientIdKind: input.clientIdKind,
    clientIdFormatOk: /^oaiapp_[A-Za-z0-9_-]+$/.test(input.clientId),
    redirectScheme,
    redirectLoopback,
    redirectHasPort,
    redirectPathOk,
    resourceOk: CHATGPT_PLAN_RESOURCE === 'https://api.openai.com/v1',
    pkcePresent: Boolean(input.pending.codeVerifier),
    errorCode: redactDiagnosticText(parsed.code, secrets),
    errorType: redactDiagnosticText(parsed.type, secrets),
    errorParam: redactDiagnosticText(parsed.param, secrets),
    errorMessage: redactDiagnosticText(parsed.message, secrets),
    requestId: redactDiagnosticText(input.requestId ?? undefined, secrets),
    regionBlocked: parsed.code === OAUTH_REGION_BLOCKED_CODE,
  }
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  id_token: string
  token_type: string
  expires_in: number
  scope?: string
}

export async function exchangeCode(code: string, pending: PendingAuthorization, issuedClientId?: string | null): Promise<TokenResponse> {
  assertPendingFresh(pending)
  // The first registration must exchange with the client_id OpenAI issued on the
  // callback; reauthorization uses the client_id saved with the previous grant.
  // The dynamic registration placeholder is never sent to the token endpoint.
  const issuedCandidate = typeof issuedClientId === 'string' && issuedClientId && issuedClientId !== DYNAMIC_CLIENT_ID
    ? issuedClientId
    : null
  const savedCandidate = pending.clientId && pending.clientId !== DYNAMIC_CLIENT_ID ? pending.clientId : null
  const clientId = issuedCandidate ?? savedCandidate
  const clientIdKind: 'issued' | 'saved' = issuedCandidate ? 'issued' : 'saved'
  if (!clientId) {
    // Fail before any network request: a code must never be sent with the
    // dynamic placeholder or an empty client id.
    const diagnostics: TokenExchangeDiagnostics = {
      stage: 'authorization_code_exchange',
      status: 0,
      clientIdKind: 'missing',
      clientIdFormatOk: false,
      redirectScheme: 'other',
      redirectLoopback: false,
      redirectHasPort: false,
      redirectPathOk: false,
      resourceOk: CHATGPT_PLAN_RESOURCE === 'https://api.openai.com/v1',
      pkcePresent: Boolean(pending.codeVerifier),
      regionBlocked: false,
    }
    throw new OAuthExchangeError(diagnostics)
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: pending.codeVerifier,
    redirect_uri: pending.redirectUri,
    resource: CHATGPT_PLAN_RESOURCE,
  })
  const response = await fetch(CHATGPT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  const text = await response.text()
  if (!response.ok) {
    // The raw body is parsed here and immediately discarded; only the redacted
    // diagnostic fields below survive into the error, the UI and any report.
    throw new OAuthExchangeError(buildExchangeDiagnostics({
      status: response.status,
      text,
      requestId: response.headers.get('x-request-id'),
      clientIdKind,
      clientId,
      pending,
    }))
  }
  let parsed: TokenResponse
  try { parsed = JSON.parse(text) as TokenResponse } catch { throw new Error('授权码交换响应无法解析') }
  if (!parsed?.access_token || !parsed?.refresh_token) throw new Error('授权响应缺少访问令牌')
  return parsed
}

export async function refreshAccessToken(credentials: PlanCredentials): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: credentials.clientId,
    refresh_token: credentials.refreshToken,
    resource: CHATGPT_PLAN_RESOURCE,
  })
  const response = await fetch(CHATGPT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`刷新访问令牌失败（${response.status}）`)
  let parsed: TokenResponse
  try { parsed = JSON.parse(text) as TokenResponse } catch { throw new Error('刷新响应无法解析') }
  if (!parsed?.access_token) throw new Error('刷新响应缺少访问令牌')
  // A refresh may rotate the refresh token; keep the old one when absent.
  return { ...parsed, refresh_token: parsed.refresh_token ?? credentials.refreshToken }
}

// ─── ID token validation ─────────────────────────────────────────────────────

interface JwksCache { keys: JsonWebKey[]; fetchedAt: number }
let jwksCache: JwksCache | null = null

async function fetchJwks(): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 10 * 60 * 1000) return jwksCache.keys
  const response = await fetch(CHATGPT_JWKS_URL, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`无法获取 JWKS（${response.status}）`)
  const parsed = await response.json() as { keys?: JsonWebKey[] }
  if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) throw new Error('JWKS 不包含任何密钥')
  jwksCache = { keys: parsed.keys, fetchedAt: Date.now() }
  return parsed.keys
}

interface JsonWebKey {
  kid?: string
  kty: string
  n?: string
  e?: string
  use?: string
  alg?: string
}

export interface IdTokenClaims {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  iat?: number
  nonce?: string
  email?: string
  email_verified?: boolean
}

function decodeSegment(segment: string): Buffer {
  return Buffer.from(segment, 'base64url')
}

/**
 * Validate the ID token exactly as the documentation requires: signature against
 * JWKS, issuer, audience equal to the issued client_id, expiry and nonce.
 */
export async function validateIdToken(idToken: string, options: {
  expectedClientId: string
  expectedNonce: string
  expectedIssuer?: string
  now?: number
}): Promise<IdTokenClaims> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('ID token 格式无效')
  const [headerSegment, payloadSegment, signatureSegment] = parts
  let header: { kid?: string; alg?: string }
  let claims: IdTokenClaims
  try {
    header = JSON.parse(decodeSegment(headerSegment).toString('utf8'))
    claims = JSON.parse(decodeSegment(payloadSegment).toString('utf8'))
  } catch { throw new Error('ID token 无法解析') }
  if (header.alg !== 'RS256') throw new Error('ID token 签名算法不受支持')
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('ID token 已过期')
  if (claims.iss !== (options.expectedIssuer ?? CHATGPT_ISSUER)) throw new Error('ID token 签发者不匹配')
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audience.includes(options.expectedClientId)) throw new Error('ID token audience 不是本次签发的 client_id')
  if (options.expectedNonce && claims.nonce !== options.expectedNonce) throw new Error('ID token nonce 不匹配')
  if (!claims.sub) throw new Error('ID token 缺少账号标识')

  const keys = await fetchJwks()
  if (!header.kid) throw new Error('ID token 缺少签名密钥标识')
  const key = keys.find(candidate =>
    candidate.kid === header.kid
    && (!candidate.alg || candidate.alg === 'RS256')
    && (!candidate.use || candidate.use === 'sig'),
  )
  if (!key) throw new Error('没有找到匹配的 JWKS 公钥')
  const publicKey = createPublicKey({ key: key as JsonWebKeyWithKty, format: 'jwk' })
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${headerSegment}.${payloadSegment}`)
  verifier.end()
  if (!verifier.verify(publicKey, decodeSegment(signatureSegment))) throw new Error('ID token 签名校验失败')
  return claims
}

type JsonWebKeyWithKty = { kty: 'RSA'; n: string; e: string }

// ─── Credential assembly ─────────────────────────────────────────────────────

export function scopesFromResponse(response: { scope?: string }): string[] {
  return (response.scope ?? '').split(/[\s]+/).filter(Boolean)
}

export async function completeAuthorization(input: {
  code: string
  pending: PendingAuthorization
  issuedClientId?: string | null
  credentialsPath: string
  expectedIssuer?: string
}): Promise<PlanCredentials> {
  const tokens = await exchangeCode(input.code, input.pending, input.issuedClientId)
  const clientId = input.issuedClientId ?? input.pending.clientId
  if (clientId === DYNAMIC_CLIENT_ID) throw new Error('注册未完成：没有获得签发的 client_id')
  const claims = await validateIdToken(tokens.id_token, {
    expectedClientId: clientId,
    expectedNonce: input.pending.nonce,
    expectedIssuer: input.expectedIssuer,
  })
  const scopes = scopesFromResponse(tokens)
  if (!scopes.includes('chatgpt.tokens.use.direct')) {
    // A valid ID token alone does not authorize ChatGPT plan usage.
    throw new Error('本次授权没有获得 ChatGPT 套餐调用权限（缺少 chatgpt.tokens.use.direct）')
  }
  const credentials: PlanCredentials = {
    email: claims.email ?? null,
    issuer: claims.iss,
    subject: claims.sub,
    clientId,
    extAgentHostId: input.pending.extAgentHostId,
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type || 'Bearer',
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scopes,
    savedAt: new Date().toISOString(),
  }
  writePlanCredentials(credentials, input.credentialsPath)
  return credentials
}

const refreshFlights = new Map<string, Promise<PlanCredentials>>()

/**
 * Refresh and persist the whole credential set together, as documented. Calls
 * for the same credential file are serialized in this single Next.js process so
 * no two requests race a rotating refresh token.
 */
export async function refreshPlanCredentials(input: {
  credentials: PlanCredentials
  credentialsPath: string
}): Promise<PlanCredentials> {
  const key = `${input.credentialsPath}\0${input.credentials.clientId}`
  const existing = refreshFlights.get(key)
  if (existing) return existing

  const flight = (async () => {
    const tokens = await refreshAccessToken(input.credentials)
    const scopes = scopesFromResponse(tokens)
    const next: PlanCredentials = {
      ...input.credentials,
      idToken: tokens.id_token ?? input.credentials.idToken,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenType: tokens.token_type || input.credentials.tokenType,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scopes: scopes.length ? scopes : input.credentials.scopes,
      savedAt: new Date().toISOString(),
    }
    writePlanCredentials(next, input.credentialsPath)
    return next
  })()
  refreshFlights.set(key, flight)
  try {
    return await flight
  } finally {
    if (refreshFlights.get(key) === flight) refreshFlights.delete(key)
  }
}

export interface RevokeResult {
  localCleared: true
  remoteRevoked: boolean
  reason?: string
}

/**
 * Revoke the renewable session before deleting local tokens. Local credentials
 * are removed even if the network fails; the result says clearly whether remote
 * revocation was confirmed.
 */
export async function revokePlanCredentials(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RevokeResult> {
  // If a token refresh is already rotating the credential, wait for it so the
  // current refresh token is the one revoked and no refresh can recreate the
  // file after disconnect.
  const outstanding = [...refreshFlights.entries()]
    .filter(([key]) => key.startsWith(`${path}\0`))
    .map(([, flight]) => flight)
  if (outstanding.length) await Promise.allSettled(outstanding)
  const credentials = readPlanCredentials(path)
  if (!credentials) {
    clearPlanCredentials(path)
    return { localCleared: true, remoteRevoked: true }
  }
  let remoteRevoked = false
  let reason: string | undefined
  try {
    const body = new URLSearchParams({
      token: credentials.refreshToken,
      token_type_hint: 'refresh_token',
      client_id: credentials.clientId,
    })
    const response = await fetchImpl(CHATGPT_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    })
    remoteRevoked = response.ok
    if (!response.ok) reason = `撤销服务返回 ${response.status}`
  } catch {
    reason = '网络错误'
  } finally {
    clearPlanCredentials(path)
  }
  return reason
    ? { localCleared: true, remoteRevoked, reason }
    : { localCleared: true, remoteRevoked }
}

/** Small helper so callers can build a public key object in tests. */
export function jwkToPublicKey(jwk: JsonWebKeyWithKty) {
  return createPublicKey({ key: jwk, format: 'jwk' })
}
