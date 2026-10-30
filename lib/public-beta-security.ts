import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { ModelTestRateLimiter } from './tokenhub-model-test.ts'

export const PUBLIC_BETA_SESSION_COOKIE = 'aios_public_beta_session'
export const PUBLIC_BETA_SESSION_HEADER = 'x-aios-public-beta-session'
export const PUBLIC_BETA_INGRESS_HEADER = 'x-aios-ingress-secret'
export const PUBLIC_BETA_NONCE_HEADER = 'x-aios-csp-nonce'

const SESSION_TTL_SECONDS = 24 * 60 * 60
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i
const SOURCE_URL_PATTERN = /^https:\/\/[^\s/$.?#].[^\s]*$/i

export type PublicBetaOperation = 'connection-test' | 'chat' | 'follow-up'

export interface PublicBetaRuntimeStatus {
  ok: boolean
  reason?: string
}

function configuredHosts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Public Beta deliberately fails closed unless the deployment declares the
 * exact single-process topology used by the in-memory limiter/idempotency
 * implementation. This check does not claim to inspect Tencent Cloud itself;
 * the operator still has to disable auto-scaling in the control plane.
 */
export function publicBetaRuntimeStatus(
  env: NodeJS.ProcessEnv = process.env,
): PublicBetaRuntimeStatus {
  const hosts = configuredHosts(env.AIOS_PUBLIC_BETA_HOSTS)
  if (hosts.length === 0) return { ok: false, reason: '未配置 Public Beta HTTPS 主机' }
  if (hosts.some(host => host.includes('*') || host.includes(':') || host === 'localhost')) {
    return { ok: false, reason: 'Public Beta 主机必须是精确公网主机名' }
  }
  if (env.AIOS_PUBLIC_BETA_DEPLOYMENT_MODE !== 'single-instance') {
    return { ok: false, reason: 'Public Beta 仅允许显式 single-instance 部署' }
  }
  if (env.AIOS_PUBLIC_BETA_INSTANCE_COUNT !== '1') {
    return { ok: false, reason: 'Public Beta 必须显式配置为一个应用实例' }
  }
  if (env.AIOS_PUBLIC_BETA_STATE_BACKEND !== 'memory-single-instance') {
    return { ok: false, reason: '当前幂等与限流只支持单实例内存状态' }
  }
  if (!/^[A-Za-z0-9._:-]{3,80}$/.test(env.AIOS_PUBLIC_BETA_INSTANCE_ID ?? '')) {
    return { ok: false, reason: '缺少稳定的 Public Beta 实例 ID' }
  }
  if (!/^[A-Za-z0-9._/-]{7,120}$/.test(env.AIOS_PUBLIC_BETA_RELEASE_ID ?? '')) {
    return { ok: false, reason: '缺少与源码地址对应的 Public Beta 发布版本 ID' }
  }
  if ((env.AIOS_PUBLIC_BETA_SESSION_SECRET ?? '').length < 32) {
    return { ok: false, reason: '匿名会话签名密钥未配置或长度不足' }
  }
  if ((env.AIOS_PUBLIC_BETA_INGRESS_SECRET ?? '').length < 32) {
    return { ok: false, reason: '可信 HTTPS 入口密钥未配置或长度不足' }
  }
  if (!SOURCE_URL_PATTERN.test(env.AIOS_PUBLIC_BETA_SOURCE_URL ?? '')) {
    return { ok: false, reason: '当前运行版本的 Corresponding Source 地址尚未配置' }
  }
  const forbiddenSecrets = [
    'TENCENT_TOKENHUB_API_KEY',
    'OPENROUTER_API_KEY',
    'FIREBASE_SERVICE_ACCOUNT',
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'NEXT_PUBLIC_FIREBASE_APP_ID',
  ].filter(name => Boolean(env[name]?.trim()))
  if (forbiddenSecrets.length > 0) {
    return {
      ok: false,
      reason: `Public Beta 进程不得配置开发者 AI 或 Firebase 凭据：${forbiddenSecrets.join(', ')}`,
    }
  }
  return { ok: true }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
}

export function publicBetaIngressAuthorized(
  supplied: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env.AIOS_PUBLIC_BETA_INGRESS_SECRET ?? ''
  return expected.length >= 32 && Boolean(supplied) && safeEqual(supplied ?? '', expected)
}

function sessionSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function issuePublicBetaSession(
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): { id: string; value: string; maxAge: number } {
  const secret = env.AIOS_PUBLIC_BETA_SESSION_SECRET ?? ''
  if (secret.length < 32) throw new Error('Public Beta 会话签名密钥无效')
  const id = randomUUID()
  const expiresAt = Math.floor(now / 1_000) + SESSION_TTL_SECONDS
  const payload = `${id}.${expiresAt}`
  return {
    id,
    value: `${payload}.${sessionSignature(payload, secret)}`,
    maxAge: SESSION_TTL_SECONDS,
  }
}

export function verifyPublicBetaSession(
  value: string | null | undefined,
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!value) return null
  const [id, expiryText, signature, extra] = value.split('.')
  if (extra !== undefined || !SESSION_ID_PATTERN.test(id ?? '') || !/^\d{10}$/.test(expiryText ?? '')) {
    return null
  }
  const expiresAt = Number(expiryText)
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now / 1_000)) return null
  const secret = env.AIOS_PUBLIC_BETA_SESSION_SECRET ?? ''
  if (secret.length < 32) return null
  const payload = `${id}.${expiryText}`
  const expected = sessionSignature(payload, secret)
  return safeEqual(signature ?? '', expected) ? id : null
}

export function publicBetaSessionFromHeaders(headers: Headers): string {
  const value = headers.get(PUBLIC_BETA_SESSION_HEADER)?.trim() ?? ''
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new Error('缺少可信的 Public Beta 匿名会话')
  }
  return value
}

interface PublicBetaBudgetState {
  global: ModelTestRateLimiter
  bySession: Record<PublicBetaOperation, ModelTestRateLimiter>
  byCredential: ModelTestRateLimiter
  globalInFlight: number
  sessionInFlight: Map<string, number>
}

const BUDGET_STATE = Symbol.for('ai-lifeos.public-beta-budget.v1')

function budgetState(): PublicBetaBudgetState {
  const root = globalThis as typeof globalThis & { [BUDGET_STATE]?: PublicBetaBudgetState }
  if (!root[BUDGET_STATE]) {
    root[BUDGET_STATE] = {
      global: new ModelTestRateLimiter(120, 60_000),
      bySession: {
        'connection-test': new ModelTestRateLimiter(3, 60_000),
        chat: new ModelTestRateLimiter(4, 60_000),
        'follow-up': new ModelTestRateLimiter(2, 60_000),
      },
      byCredential: new ModelTestRateLimiter(12, 60_000),
      globalInFlight: 0,
      sessionInFlight: new Map(),
    }
  }
  return root[BUDGET_STATE] as PublicBetaBudgetState
}

export class PublicBetaBudgetError extends Error {
  readonly status = 429
  readonly retryAfterSeconds: number

  constructor(message: string, retryAfterSeconds = 60) {
    super(message)
    this.name = 'PublicBetaBudgetError'
    this.retryAfterSeconds = Math.max(1, retryAfterSeconds)
  }
}

/**
 * In-process Public Beta budget. It is intentionally guarded by the runtime
 * single-instance check and must be replaced by shared atomic storage before
 * enabling a second instance or serverless scaling.
 */
export async function withPublicBetaRequestBudget<T>(input: {
  operation: PublicBetaOperation
  sessionId: string
  credentialFingerprint: string
  run: () => Promise<T>
}): Promise<T> {
  const state = budgetState()
  const globalLimit = state.global.take('all-public-beta')
  if (!globalLimit.allowed) {
    throw new PublicBetaBudgetError('Public Beta 当前请求较多，请稍后再试。', globalLimit.retryAfterSeconds)
  }
  const sessionLimit = state.bySession[input.operation].take(input.sessionId)
  if (!sessionLimit.allowed) {
    throw new PublicBetaBudgetError('当前会话请求过于频繁，请稍后再试。', sessionLimit.retryAfterSeconds)
  }
  const credentialLimit = state.byCredential.take(input.credentialFingerprint)
  if (!credentialLimit.allowed) {
    throw new PublicBetaBudgetError('该 API Key 的请求过于频繁，请稍后再试。', credentialLimit.retryAfterSeconds)
  }
  if (state.globalInFlight >= 8) {
    throw new PublicBetaBudgetError('Public Beta 当前并发已满，请稍后再试。', 10)
  }
  const currentSessionInFlight = state.sessionInFlight.get(input.sessionId) ?? 0
  if (currentSessionInFlight >= 1) {
    throw new PublicBetaBudgetError('当前会话已有 AI 请求正在处理，请等待完成。', 5)
  }

  state.globalInFlight += 1
  state.sessionInFlight.set(input.sessionId, currentSessionInFlight + 1)
  try {
    return await input.run()
  } finally {
    state.globalInFlight -= 1
    const next = (state.sessionInFlight.get(input.sessionId) ?? 1) - 1
    if (next <= 0) state.sessionInFlight.delete(input.sessionId)
    else state.sessionInFlight.set(input.sessionId, next)
  }
}
