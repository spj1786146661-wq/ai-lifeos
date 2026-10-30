/**
 * Server-only helpers for the isolated TokenHub model test page.
 *
 * This module deliberately does not import life-record, storage, Firebase or
 * OAuth code. A model reply is returned to the test page and is never saved.
 */

import {
  MODEL_TEST_MAX_MESSAGE_CHARS,
  MODEL_TEST_MAX_MESSAGES,
  MODEL_TEST_MAX_OUTPUT_TOKENS,
  MODEL_TEST_MAX_REQUEST_BYTES,
  MODEL_TEST_MAX_TOTAL_CHARS,
  TOKENHUB_CHAT_URL,
  TOKENHUB_MODEL_LABEL,
  resolveTokenHubModelId,
  type ModelTestMessage,
  type ModelTestUsage,
} from './tokenhub-model-test-shared.ts'

export {
  MODEL_TEST_MAX_MESSAGE_CHARS,
  MODEL_TEST_MAX_MESSAGES,
  MODEL_TEST_MAX_OUTPUT_TOKENS,
  MODEL_TEST_MAX_REQUEST_BYTES,
  MODEL_TEST_MAX_TOTAL_CHARS,
  MODEL_TEST_TIMEOUT_MS,
  TOKENHUB_CHAT_URL,
  TOKENHUB_MODEL_LABEL,
  TOKENHUB_DEFAULT_MODEL_ID,
  TOKENHUB_MODEL_ID_ENV,
  resolveTokenHubModelId,
  type ModelTestMessage,
  type ModelTestRole,
  type ModelTestUsage,
} from './tokenhub-model-test-shared.ts'

export interface ModelTestReply {
  content: string
  model: string
  usage: ModelTestUsage | null
  requestId: string | null
}

export type TokenHubMessage = ModelTestMessage | {
  role: 'system'
  content: string
}

export interface ModelTestValidationSuccess {
  ok: true
  messages: ModelTestMessage[]
}

export interface ModelTestValidationFailure {
  ok: false
  error: string
  status: 400 | 413
}

export type ModelTestValidation =
  | ModelTestValidationSuccess
  | ModelTestValidationFailure

export class ModelTestUpstreamError extends Error {
  readonly status: number
  readonly code: string
  readonly upstreamCode: string | null
  readonly requestId: string | null

  constructor(
    message: string,
    status: number,
    code: string,
    requestId: string | null = null,
    upstreamCode: string | null = null,
  ) {
    super(message)
    this.name = 'ModelTestUpstreamError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.upstreamCode = upstreamCode
  }
}

function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * Validates untrusted browser input before it can reach the provider.
 * The final message must be from the user so the test cannot request a reply
 * to an assistant-only transcript.
 */
export function validateModelTestRequest(body: unknown): ModelTestValidation {
  if (jsonByteLength(body) > MODEL_TEST_MAX_REQUEST_BYTES) {
    return { ok: false, status: 413, error: '请求内容过大，请缩短后再试。' }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: '请求格式无效。' }
  }
  const rawMessages = (body as { messages?: unknown }).messages
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return { ok: false, status: 400, error: '请至少输入一条消息。' }
  }
  if (rawMessages.length > MODEL_TEST_MAX_MESSAGES) {
    return {
      ok: false,
      status: 400,
      error: `对话最多保留 ${MODEL_TEST_MAX_MESSAGES} 条消息，请刷新页面后重试。`,
    }
  }

  const messages: ModelTestMessage[] = []
  let totalChars = 0
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, status: 400, error: '消息格式无效。' }
    }
    const role = (raw as { role?: unknown }).role
    const content = (raw as { content?: unknown }).content
    if (role !== 'user' && role !== 'assistant') {
      return { ok: false, status: 400, error: '消息角色必须是 user 或 assistant。' }
    }
    if (typeof content !== 'string' || !content.trim()) {
      return { ok: false, status: 400, error: '消息内容不能为空。' }
    }
    const trimmed = content.trim()
    if (trimmed.length > MODEL_TEST_MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        status: 400,
        error: `单条消息最多 ${MODEL_TEST_MAX_MESSAGE_CHARS} 个字符。`,
      }
    }
    totalChars += trimmed.length
    messages.push({ role, content: trimmed })
  }
  if (totalChars > MODEL_TEST_MAX_TOTAL_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `全部消息合计最多 ${MODEL_TEST_MAX_TOTAL_CHARS} 个字符。`,
    }
  }
  if (messages[messages.length - 1]?.role !== 'user') {
    return { ok: false, status: 400, error: '最后一条消息必须来自用户。' }
  }
  return { ok: true, messages }
}

function finiteToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null
}

/**
 * Supports both OpenAI's prompt/completion usage names and the
 * input/output names used by some compatible gateways.
 */
export function normalizeModelTestUsage(value: unknown): ModelTestUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const usage = value as Record<string, unknown>
  const inputTokens =
    finiteToken(usage.prompt_tokens) ?? finiteToken(usage.input_tokens)
  const outputTokens =
    finiteToken(usage.completion_tokens) ?? finiteToken(usage.output_tokens)
  const totalTokens = finiteToken(usage.total_tokens)
  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null
  }
  return { inputTokens, outputTokens, totalTokens }
}

function safeDiagnostic(value: unknown, maxLength = 300): string | null {
  if (typeof value !== 'string') return null
  const withoutControls = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return withoutControls ? withoutControls.slice(0, maxLength) : null
}

function upstreamErrorDetails(body: unknown): {
  message: string | null
  code: string | null
  requestId: string | null
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { message: null, code: null, requestId: null }
  }
  const root = body as Record<string, unknown>
  const error =
    root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? root.error as Record<string, unknown>
      : root
  return {
    message:
      safeDiagnostic(error.message) ??
      safeDiagnostic(error.error_description) ??
      safeDiagnostic(root.message),
    code:
      safeDiagnostic(error.code, 80) ??
      safeDiagnostic(root.code, 80),
    requestId:
      safeDiagnostic(error.request_id, 160) ??
      safeDiagnostic(error.requestId, 160) ??
      safeDiagnostic(root.request_id, 160) ??
      safeDiagnostic(root.requestId, 160),
  }
}

async function readSafeJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > 64 * 1024) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function statusError(status: number, body: unknown, headerRequestId: string | null): ModelTestUpstreamError {
  const details = upstreamErrorDetails(body)
  const requestId = headerRequestId ?? details.requestId
  if (status === 401 || status === 403) {
    return new ModelTestUpstreamError(
      'TokenHub 拒绝了请求，请检查服务端 API Key、账号权限或地区限制。',
      status,
      `upstream_${status}`,
      requestId,
      details.code,
    )
  }
  if (status === 429) {
    return new ModelTestUpstreamError(
      'TokenHub 请求过于频繁或额度不足，请稍后再试。',
      429,
      'upstream_429',
      requestId,
      details.code,
    )
  }
  if (status >= 500) {
    return new ModelTestUpstreamError(
      'TokenHub 服务暂时不可用，请稍后重试。',
      502,
      'upstream_5xx',
      requestId,
      details.code,
    )
  }
  return new ModelTestUpstreamError(
    details.message
      ? `TokenHub 请求失败：${details.message}`
      : 'TokenHub 请求失败，请检查模型配置。',
    502,
    details.code ?? `upstream_${status}`,
    requestId,
    details.code,
  )
}

/**
 * Calls only the fixed official endpoint. The API key is read from the
 * server environment and is never included in an error or return value.
 */
export async function requestTokenHubModel(
  messages: readonly TokenHubMessage[],
  options: {
    apiKey?: string
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    maxOutputTokens?: number
    temperature?: number
    jsonOutput?: boolean
    disableThinking?: boolean
    model?: string
  } = {},
): Promise<ModelTestReply> {
  const apiKey = (options.apiKey ?? process.env.TENCENT_TOKENHUB_API_KEY ?? '').trim()
  if (!apiKey) {
    throw new ModelTestUpstreamError(
      '服务器尚未配置 TENCENT_TOKENHUB_API_KEY。',
      503,
      'tokenhub_not_configured',
    )
  }
  const fetchImpl = options.fetchImpl ?? fetch
  const maxOutputTokens = Number.isFinite(options.maxOutputTokens)
    ? Math.max(128, Math.min(2_000, Math.trunc(options.maxOutputTokens ?? MODEL_TEST_MAX_OUTPUT_TOKENS)))
    : MODEL_TEST_MAX_OUTPUT_TOKENS
  const temperature = Number.isFinite(options.temperature)
    ? Math.max(0, Math.min(1, options.temperature ?? 0.3))
    : 0.3
  const model = options.model ?? resolveTokenHubModelId()
  let response: Response
  try {
    response = await fetchImpl(TOKENHUB_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
        stream: false,
        ...(options.jsonOutput
          ? { response_format: { type: 'json_object' } }
          : {}),
        ...(options.disableThinking
          ? { thinking: { type: 'disabled' } }
          : {}),
      }),
      cache: 'no-store',
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ModelTestUpstreamError(
        'TokenHub 响应超时，请稍后重试。',
        504,
        'tokenhub_timeout',
      )
    }
    throw new ModelTestUpstreamError(
      '无法连接 TokenHub，请检查服务端网络。',
      502,
      'tokenhub_network_error',
    )
  }

  const requestId =
    safeDiagnostic(response.headers.get('x-request-id'), 160) ??
    safeDiagnostic(response.headers.get('request-id'), 160)
  if (!response.ok) {
    throw statusError(response.status, await readSafeJson(response), requestId)
  }

  const body = await readSafeJson(response)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ModelTestUpstreamError(
      'TokenHub 返回了无法解析的响应。',
      502,
      'tokenhub_invalid_json',
      requestId,
    )
  }
  const record = body as Record<string, unknown>
  const choices = record.choices
  const firstChoice =
    Array.isArray(choices) && choices[0] && typeof choices[0] === 'object'
      ? choices[0] as Record<string, unknown>
      : null
  const message =
    firstChoice?.message && typeof firstChoice.message === 'object'
      ? firstChoice.message as Record<string, unknown>
      : null
  const content = typeof message?.content === 'string' ? message.content.trim() : ''
  if (!content) {
    throw new ModelTestUpstreamError(
      'TokenHub 响应中没有可显示的文本回复。',
      502,
      'tokenhub_empty_reply',
      requestId,
    )
  }
  return {
    content,
    model:
      typeof record.model === 'string' && record.model.trim()
        ? record.model.trim()
        : TOKENHUB_MODEL_LABEL,
    usage: normalizeModelTestUsage(record.usage),
    requestId,
  }
}

interface RateLimitEntry {
  startedAt: number
  count: number
}

/**
 * Basic in-process limit for local development. It is intentionally not
 * presented as a production-grade distributed limiter.
 */
export class ModelTestRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>()
  private readonly limit: number
  private readonly windowMs: number

  constructor(limit = 8, windowMs = 60_000) {
    this.limit = limit
    this.windowMs = windowMs
  }

  take(key: string, now = Date.now()): { allowed: true } | {
    allowed: false
    retryAfterSeconds: number
  } {
    if (this.entries.size > 256) {
      for (const [entryKey, entry] of this.entries) {
        if (now - entry.startedAt >= this.windowMs) this.entries.delete(entryKey)
      }
    }
    const existing = this.entries.get(key)
    if (!existing || now - existing.startedAt >= this.windowMs) {
      this.entries.set(key, { startedAt: now, count: 1 })
      return { allowed: true }
    }
    if (existing.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.startedAt + this.windowMs - now) / 1_000),
        ),
      }
    }
    existing.count += 1
    return { allowed: true }
  }
}
