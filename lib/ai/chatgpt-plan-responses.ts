/**
 * @module ai/chatgpt-plan-responses
 * @description Responses API caller for the ChatGPT plan usage flow.
 *
 * Hard constraints from the official preview limitations, enforced here:
 * - store: false and stream: true on every request.
 * - input is an array; history is sent inside input (no previous_response_id).
 * - instructions / developer messages are used; a {type:"message",role:"system"}
 *   item is rejected by the endpoint, so it is never sent.
 * - Unsupported fields are never sent: background, conversation,
 *   max_output_tokens, max_tool_calls, metadata, moderation, multi_agent, prompt,
 *   prompt_cache_retention, safety_identifier, temperature, top_logprobs, top_p,
 *   truncation, user.
 * - Success is only reported after response.completed. response.failed may carry
 *   subscription_sharing_usage_limit_exceeded / _unavailable.
 * - The public api.openai.com endpoint is used; ChatGPT backend-api is never
 *   contacted.
 */
import { defaultCredentialsPath, planUsageGranted, readPlanCredentials } from './chatgpt-plan-credentials.ts'
import { refreshPlanCredentials } from './chatgpt-plan-oauth.ts'

export interface ResponsesTextTurn {
  role: 'user' | 'assistant'
  content: string
}

type ResponsesInputItem =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'user'; content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> }

export interface ResponsesCallOptions {
  model: string
  instructions: string
  input: ResponsesInputItem[]
  accessToken: string
  signal?: AbortSignal
}

export class PlanUsageError extends Error {
  readonly code: string
  constructor(message: string, code = 'plan_usage_error') {
    super(message)
    this.name = 'PlanUsageError'
    this.code = code
  }
}

export class PlanNotAuthorizedError extends Error {
  constructor(message = '尚未完成 ChatGPT 套餐授权，或授权未包含套餐调用权限') {
    super(message)
    this.name = 'PlanNotAuthorizedError'
  }
}

export interface StreamedResponse {
  text: string
  model: string
  responseId: string | null
  usage: { inputTokens: number; outputTokens: number } | null
}

interface StreamEvent {
  type?: string
  delta?: string
  response?: {
    id?: string
    model?: string
    status?: string
    error?: { code?: string | null; message?: string } | null
    usage?: { input_tokens?: number; output_tokens?: number } | null
  }
  message?: string
  code?: string | null
}

/**
 * Call the Responses API with streaming and only treat response.completed as
 * success. Never sends a temperature or any other unsupported field.
 */
export async function callResponsesStream(options: ResponsesCallOptions): Promise<StreamedResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  if (options.signal) options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: options.model,
        instructions: options.instructions,
        input: options.input,
        store: false,
        stream: true,
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    if (response.status === 429) throw new PlanUsageError('ChatGPT 套餐用量已达上限，请稍后再试', 'subscription_sharing_usage_limit_exceeded')
    if (response.status === 401 || response.status === 403) throw new PlanNotAuthorizedError()
    throw new PlanUsageError(`模型请求失败（${response.status}）${detail ? '：' + detail.slice(0, 200) : ''}`, 'request_failed')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let model = options.model
  let responseId: string | null = null
  let usage: StreamedResponse['usage'] = null
  let completed = false

  const handleEvent = (raw: string) => {
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let event: StreamEvent
      try { event = JSON.parse(payload) as StreamEvent } catch { continue }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta
        continue
      }
      if (event.type === 'response.completed') {
        completed = true
        if (event.response?.model) model = event.response.model
        if (event.response?.id) responseId = event.response.id
        if (event.response?.usage) {
          usage = {
            inputTokens: event.response.usage.input_tokens ?? 0,
            outputTokens: event.response.usage.output_tokens ?? 0,
          }
        }
        continue
      }
      if (event.type === 'response.failed') {
        const code = event.response?.error?.code ?? 'response_failed'
        const message = event.response?.error?.message ?? '模型返回失败'
        throw new PlanUsageError(message, code)
      }
      if (event.type === 'error') {
        throw new PlanUsageError(event.message ?? '模型流式响应出错', event.code ?? 'stream_error')
      }
      if (event.type === 'response.incomplete') {
        throw new PlanUsageError('模型响应不完整，本次没有取得可用结果', 'response_incomplete')
      }
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE events are separated by a blank line.
      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        handleEvent(rawEvent)
        separator = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) handleEvent(buffer)
  } catch (cause) {
    if (cause instanceof PlanUsageError || cause instanceof PlanNotAuthorizedError) throw cause
    if (cause instanceof Error && cause.name === 'AbortError') throw new PlanUsageError('模型请求超时', 'timeout')
    throw new PlanUsageError('模型流式响应中断', 'stream_interrupted')
  } finally {
    reader.releaseLock()
  }

  if (!completed) throw new PlanUsageError('流式响应未返回 response.completed，不能视为成功', 'no_completion_event')
  if (!text.trim()) throw new PlanUsageError('模型没有返回任何文本内容', 'empty_output')
  return { text, model, responseId, usage }
}

// ─── Credential resolution ───────────────────────────────────────────────────

export interface ResolvedPlanAccess {
  credentialsPath: string
  accessToken: string
  model: string
  accountLabel: string
  scopes: string[]
}

/**
 * Resolve a usable access token. A token that is still valid is reused; an
 * expired one is refreshed and persisted as a whole set.
 */
export async function resolvePlanAccess(options: {
  credentialsPath?: string
  model: string
  now?: number
}): Promise<ResolvedPlanAccess> {
  const credentialsPath = options.credentialsPath ?? defaultCredentialsPath()
  const credentials = readPlanCredentials(credentialsPath)
  if (!credentials) throw new PlanNotAuthorizedError()
  if (!planUsageGranted(credentials)) throw new PlanNotAuthorizedError('已保存的授权不包含 ChatGPT 套餐调用权限，请重新授权')
  const now = options.now ?? Date.now()
  const fresh = credentials.expiresAt - now > 60_000
    ? credentials
    : await refreshPlanCredentials({ credentials, credentialsPath })
  return {
    credentialsPath,
    accessToken: fresh.accessToken,
    model: options.model,
    accountLabel: fresh.email ?? 'ChatGPT 账号',
    scopes: fresh.scopes,
  }
}

export function buildTextInput(history: ResponsesTextTurn[]): ResponsesInputItem[] {
  return history.map(item => ({ role: item.role, content: item.content }))
}

export function buildImageInput(text: string, imageUrl: string): ResponsesInputItem[] {
  return [{
    role: 'user',
    content: [
      { type: 'input_text', text: text || '请识别这张图片里的饮食信息。' },
      { type: 'input_image', image_url: imageUrl },
    ],
  }]
}

export const CHATGPT_PLAN_DEFAULT_MODEL = process.env.CHATGPT_PLAN_MODEL ?? 'gpt-6.1-sol'
