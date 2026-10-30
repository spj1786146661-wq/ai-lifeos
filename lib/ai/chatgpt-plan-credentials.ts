/**
 * @module ai/chatgpt-plan-credentials
 * @description Local credential store for the official "Sign in with ChatGPT"
 * open-source OAuth flow.
 *
 * Rules enforced here:
 * - Tokens live only in a user-controlled local file, never in Git and never in
 *   any browser-readable storage.
 * - Nothing is logged. Errors never contain a token value.
 * - The file is written atomically (temp file + rename) so a crash mid-write
 *   cannot leave a truncated credential file.
 *
 * The file location defaults to the user profile config directory. It can be
 * overridden for tests with CHATGPT_PLAN_CREDENTIALS_FILE.
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const CHATGPT_PLAN_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export const CHATGPT_PLAN_RESOURCE = 'https://api.openai.com/v1'
export const CHATGPT_AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize'
export const CHATGPT_TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
export const CHATGPT_REVOKE_URL = 'https://auth.openai.com/api/accounts/oauth/revoke'
export const CHATGPT_JWKS_URL = 'https://auth.openai.com/.well-known/jwks.json'
export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'

/** Default file: ~/.config/ai-lifeos/chatgpt-plan.json (user profile, not the repo). */
export function defaultCredentialsPath(): string {
  return process.env.CHATGPT_PLAN_CREDENTIALS_FILE
    ?? join(homedir(), '.config', 'ai-lifeos', 'chatgpt-plan.json')
}

/** Opaque installation metadata. It contains no credential or account identity. */
export function defaultInstallationStatePath(): string {
  return process.env.CHATGPT_PLAN_INSTALLATION_FILE
    ?? join(homedir(), '.config', 'ai-lifeos', 'chatgpt-plan-installation.json')
}

/**
 * Official host identifier formats, from the Sign in with ChatGPT documentation:
 *  - urn:uuid:<UUIDv4>          (preferred alternative, hyphenated string form)
 *  - urn:ietf:params:oauth:jwk-thumbprint:<base64url>
 *  - did:key:<multibase-key>
 * A host ID is an opaque per-host identifier, not a credential.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** A UUID of another version, used only to recognize a value worth normalizing. */
const UUID_ANY_VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const JWK_THUMBPRINT = /^urn:ietf:params:oauth:jwk-thumbprint:[A-Za-z0-9_-]{43,}$/
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{20,}$/

/** True when a value is already a complete, officially accepted host identifier. */
export function isAcceptedExtAgentHostId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (JWK_THUMBPRINT.test(value) || DID_KEY.test(value)) return true
  if (!value.startsWith('urn:uuid:')) return false
  // Only UUIDv4 is accepted for the urn:uuid scheme.
  return UUID_V4.test(value.slice('urn:uuid:'.length).toLowerCase())
}

/** Generate a UUIDv4 in its hyphenated string form, as the documentation requires. */
export function newUuidV4(): string {
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex: string[] = []
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'))
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
}

export interface HostIdResolution {
  hostId: string
  /** True when the previously stored value had to be replaced. */
  replaced: boolean
  /** Why the stored value was replaced, for logs and handoff notes. */
  reason?: 'invalid_format' | 'unreadable' | 'absent'
}

/**
 * Resolve a stable, officially accepted host identifier. A valid stored value is
 * always reused so one installation keeps one identity. A bare UUID gains the
 * `urn:uuid:` prefix instead of being regenerated. A value that can never be
 * accepted by the authorization endpoint (for example a base64url blob behind
 * the urn:uuid: prefix) is replaced by a fresh UUIDv4, because such a value was
 * never registered: the endpoint rejects it before any registration happens.
 */
export function resolveExtAgentHostId(stored: unknown): HostIdResolution {
  if (isAcceptedExtAgentHostId(stored)) return { hostId: stored, replaced: false }
  if (typeof stored === 'string' && stored.length > 0) {
    const trimmed = stored.trim()
    const bare = trimmed.replace(/^["']|["']$/g, '').toLowerCase()
    const uuidBody = bare.startsWith('urn:uuid:') ? bare.slice('urn:uuid:'.length) : bare
    // A bare UUIDv4 string form is normalized to its urn:uuid: URI form, so an
    // existing installation keeps its identity instead of being re-registered.
    if (UUID_V4.test(uuidBody)) {
      // uuidBody is already dequoted and lowercased, so the prefix is added
      // exactly once even when the stored value carried quotes or the prefix.
      return { hostId: `urn:uuid:${uuidBody}`, replaced: false }
    }
    return { hostId: `urn:uuid:${newUuidV4()}`, replaced: true, reason: 'invalid_format' }
  }
  return { hostId: `urn:uuid:${newUuidV4()}`, replaced: false, reason: stored === null || stored === undefined ? 'absent' : 'invalid_format' }
}

/** True when a value is any well-formed UUID, regardless of version. */
export function isAnyUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const bare = value.trim().replace(/^["']|["']$/g, '').toLowerCase()
  const body = bare.startsWith('urn:uuid:') ? bare.slice('urn:uuid:'.length) : bare
  return UUID_ANY_VERSION.test(body)
}

export interface PlanCredentials {
  email: string | null
  issuer: string
  subject: string
  clientId: string
  extAgentHostId: string
  idToken: string
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresAt: number
  scopes: string[]
  savedAt: string
}

/**
 * Version 2 stores only a Windows DPAPI CurrentUser protected blob. The blob can
 * be decrypted only by the same Windows account and this machine profile; there
 * is no application-derived key, weak fallback, or plaintext representation.
 */
interface DpapiStoredCredentials {
  v: 2
  scheme: 'dpapi-current-user'
  data: string
}

interface LegacyStoredCredentials {
  salt?: string
  iv?: string
  tag?: string
  data?: string
}

type StoredCredentials = DpapiStoredCredentials | LegacyStoredCredentials

export class CredentialProtectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialProtectionError'
  }
}

function writeProtectedPayload(path: string, payload: string, failureMessage: string): void {
  const temp = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temp, payload, { mode: 0o600 })
  } catch {
    try { rmSync(temp, { force: true }) } catch { /* nothing to clean up */ }
    throw new CredentialProtectionError(failureMessage)
  }
  try {
    renameSync(temp, path)
    return
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    // Some managed Windows sandboxes deny rename while permitting a same-user
    // file write. The payload is already DPAPI-encrypted, so a direct encrypted
    // write is safe against disclosure; a crash produces an unreadable envelope
    // that requires reauthorization. There is no plaintext or weak-crypto path.
    if (code !== 'EPERM' && code !== 'EXDEV') {
      try { rmSync(temp, { force: true }) } catch { /* nothing to clean up */ }
      throw new CredentialProtectionError(failureMessage)
    }
    try {
      writeFileSync(path, payload, { mode: 0o600 })
      rmSync(temp, { force: true })
    } catch {
      try { rmSync(temp, { force: true }) } catch { /* nothing to clean up */ }
      throw new CredentialProtectionError(failureMessage)
    }
  }
}

const POWERSHELL_ASSEMBLY = 'Add-Type -AssemblyName System.Security; '
const DPAPI_PROTECT_SCRIPT = `${POWERSHELL_ASSEMBLY}$value=[Console]::In.ReadToEnd().Trim(); if (-not $value) { throw 'empty input' }; $bytes=[Convert]::FromBase64String($value); $protected=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($protected)`
const DPAPI_UNPROTECT_SCRIPT = `${POWERSHELL_ASSEMBLY}$value=[Console]::In.ReadToEnd().Trim(); if (-not $value) { throw 'empty input' }; $bytes=[Convert]::FromBase64String($value); $plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($plain)`

function runDpapi(script: string, input: string, operation: 'encrypt' | 'decrypt'): string {
  if (process.platform !== 'win32') {
    throw new CredentialProtectionError('ChatGPT 授权凭据保护仅支持 Windows DPAPI，当前系统不受支持')
  }
  try {
    const output = execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], {
      input,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
    if (!output) throw new Error('empty output')
    return output
  } catch {
    // Never include command output or credential material in this message.
    throw new CredentialProtectionError(
      operation === 'encrypt'
        ? 'Windows DPAPI 加密失败，授权凭据没有写入'
        : 'Windows DPAPI 解密失败，授权凭据无法读取',
    )
  }
}

function encryptCredentials(credentials: PlanCredentials): DpapiStoredCredentials {
  const plain = Buffer.from(JSON.stringify(credentials), 'utf8').toString('base64')
  return {
    v: 2,
    scheme: 'dpapi-current-user',
    data: runDpapi(DPAPI_PROTECT_SCRIPT, plain, 'encrypt'),
  }
}

function decryptCredentials(stored: StoredCredentials): PlanCredentials {
  if (!('v' in stored) || stored.v !== 2 || stored.scheme !== 'dpapi-current-user' || !stored.data) {
    throw new CredentialProtectionError('旧版弱保护凭据格式已拒绝，请重新授权')
  }
  const plain = Buffer.from(runDpapi(DPAPI_UNPROTECT_SCRIPT, stored.data, 'decrypt'), 'base64').toString('utf8')
  return JSON.parse(plain) as PlanCredentials
}

/**
 * Structural check only: does a credential envelope exist at this path?
 * This deliberately does NOT decrypt, so a file that exists but cannot be read
 * is still reported as "present" and the caller can say so explicitly instead of
 * silently treating the machine as unauthenticated.
 */
export function hasPlanCredentials(path = defaultCredentialsPath()): boolean {
  if (!existsSync(path)) return false
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredCredentials>
    return Boolean(
      ('v' in stored && stored.v === 2 && stored.scheme === 'dpapi-current-user' && stored.data)
      || ('salt' in stored && stored.salt && 'iv' in stored && stored.iv && 'tag' in stored && stored.tag && stored.data),
    )
  } catch { return false }
}

/** Read credentials without refreshing. Returns null when absent or unreadable. */
export function readPlanCredentials(path = defaultCredentialsPath()): PlanCredentials | null {
  if (!existsSync(path)) return null
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as StoredCredentials
    const credentials = decryptCredentials(stored)
    if (
      !credentials?.accessToken
      || !credentials?.refreshToken
      || !credentials?.idToken
      || !credentials?.clientId
      || !credentials?.subject
      || !Array.isArray(credentials?.scopes)
    ) return null
    return credentials
  } catch { return null }
}

export function writePlanCredentials(credentials: PlanCredentials, path = defaultCredentialsPath()): void {
  const payload = JSON.stringify(encryptCredentials(credentials))
  writeProtectedPayload(path, payload, 'ChatGPT 授权凭据无法安全写入本地文件')
}

export function clearPlanCredentials(path = defaultCredentialsPath()): void {
  if (!existsSync(path)) return
  try {
    rmSync(path)
  } catch {
    throw new CredentialProtectionError('无法删除本地 ChatGPT 授权凭据')
  }
}

export function getOrCreateExtAgentHostId(
  existing = process.env.CHATGPT_PLAN_HOST_ID,
  path = defaultInstallationStatePath(),
): string {
  // Priority: a valid explicit override, then the persisted host identity, then
  // a fresh UUIDv4. Anything else must be normalized or replaced, never passed
  // to the authorization endpoint as-is.
  if (isAcceptedExtAgentHostId(existing)) return existing

  let stored: unknown = null
  let readable = false
  if (existsSync(path)) {
    try {
      const state = JSON.parse(readFileSync(path, 'utf8')) as { hostId?: unknown }
      stored = state.hostId
      readable = true
    } catch {
      // A damaged metadata file is replaced below with a fresh opaque id.
    }
  }

  // An already-accepted stored value is returned untouched: the file is not
  // rewritten, so one installation keeps a stable identity on disk.
  if (readable && isAcceptedExtAgentHostId(stored)) return stored

  // A stored bare UUID is normalized in place; anything the endpoint cannot
  // accept is replaced with a fresh UUIDv4.
  const normalized = resolveExtAgentHostId(stored)
  const hostId = normalized.hostId
  const reason = readable
    ? (normalized.reason === 'absent' ? 'absent' : 'invalid_format')
    : 'unreadable'
  const payload = JSON.stringify({ v: 2, hostId, previousReason: reason })
  writeProtectedPayload(path, payload, '无法保存 ChatGPT 本机安装标识')
  return hostId
}

/** The first sign-in uses dynamic registration; reauthorization reuses the issued client. */
export function isDynamicClientId(clientId: string | null | undefined): boolean {
  return !clientId || clientId === DYNAMIC_CLIENT_ID
}

/** A stable label for the account, safe to show in logs and UI. */
export function planAccountLabel(credentials: PlanCredentials): string {
  if (credentials.email) return credentials.email
  return credentials.subject ? `ChatGPT 账号 ${credentials.subject.slice(0, 8)}…` : 'ChatGPT 账号'
}

export function planUsageGranted(credentials: PlanCredentials): boolean {
  return credentials.scopes.includes('chatgpt.tokens.use.direct')
}

export function credentialSummary(credentials: PlanCredentials) {
  return {
    email: credentials.email,
    subject: credentials.subject,
    clientId: credentials.clientId,
    scopes: credentials.scopes,
    planUsageGranted: planUsageGranted(credentials),
    expiresAt: new Date(credentials.expiresAt).toISOString(),
    expired: credentials.expiresAt <= Date.now(),
  }
}

export function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}
