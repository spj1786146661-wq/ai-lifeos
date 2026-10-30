import { ProviderRequestError } from './provider-error.ts'
import {
  resolveProviderModel,
  type ResolvedProviderModel,
} from './provider-registry.ts'
import type {
  ByokProviderId,
  ProviderDefinition,
} from './provider-types.ts'

export interface ProviderUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface ProviderTextResult {
  content: string
  provider: ByokProviderId
  model: string
  usage: ProviderUsage | null
  requestId: string | null
  latencyMs: number
}

export interface ProviderAdapterInput {
  connection: {
    provider: ByokProviderId
    model: string
    apiKey: string
  }
  instructions: string
  userText: string
  maxOutputTokens: number
  temperature: number
  jsonOutput: boolean
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

function finiteToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null
}

export function normalizeProviderUsage(value: unknown): ProviderUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const usage = value as Record<string, unknown>
  const inputTokens =
    finiteToken(usage.prompt_tokens)
    ?? finiteToken(usage.input_tokens)
    ?? finiteToken(usage.promptTokenCount)
  const outputTokens =
    finiteToken(usage.completion_tokens)
    ?? finiteToken(usage.output_tokens)
    ?? finiteToken(usage.candidatesTokenCount)
  const totalTokens =
    finiteToken(usage.total_tokens)
    ?? finiteToken(usage.totalTokenCount)
  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null
  }
  return { inputTokens, outputTokens, totalTokens }
}

function safeDiagnostic(value: unknown, maxLength = 300): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return clean ? clean.slice(0, maxLength) : null
}

function responseRequestId(response: Response): string | null {
  return safeDiagnostic(response.headers.get('x-request-id'), 160)
    ?? safeDiagnostic(response.headers.get('request-id'), 160)
    ?? safeDiagnostic(response.headers.get('x-goog-request-id'), 160)
    ?? safeDiagnostic(response.headers.get('anthropic-request-id'), 160)
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > 64 * 1024) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function upstreamDetails(body: unknown): {
  message: string | null
  code: string | null
  requestId: string | null
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { message: null, code: null, requestId: null }
  }
  const root = body as Record<string, unknown>
  const nested = root.error
  const error =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : root
  return {
    message:
      safeDiagnostic(error.message)
      ?? safeDiagnostic(error.error_description)
      ?? safeDiagnostic(root.message),
    code:
      safeDiagnostic(error.code, 80)
      ?? safeDiagnostic(error.type, 80)
      ?? safeDiagnostic(root.code, 80),
    requestId:
      safeDiagnostic(error.request_id, 160)
      ?? safeDiagnostic(error.requestId, 160)
      ?? safeDiagnostic(root.request_id, 160)
      ?? safeDiagnostic(root.requestId, 160),
  }
}

function statusError(
  provider: ProviderDefinition,
  status: number,
  body: unknown,
  headerRequestId: string | null,
): ProviderRequestError {
  const details = upstreamDetails(body)
  const requestId = headerRequestId ?? details.requestId
  if (status === 401) {
    return new ProviderRequestError(
      `${provider.displayName} 拒绝了 API Key，请检查 Key 是否有效。`,
      401,
      'upstream_401',
      requestId,
      details.code,
    )
  }
  if (status === 403) {
    return new ProviderRequestError(
      `${provider.displayName} 拒绝访问，请检查账号、地区、模型授权或计费状态。`,
      403,
      'upstream_403',
      requestId,
      details.code,
    )
  }
  if (status === 404) {
    return new ProviderRequestError(
      `${provider.displayName} 未找到该模型，请检查模型 ID。`,
      422,
      'provider_model_not_found',
      requestId,
      details.code,
    )
  }
  if (status === 429) {
    return new ProviderRequestError(
      `${provider.displayName} 请求过于频繁、额度不足或计费受限。`,
      429,
      'upstream_429',
      requestId,
      details.code,
    )
  }
  if (status >= 500) {
    return new ProviderRequestError(
      `${provider.displayName} 服务暂时不可用，请稍后重试。`,
      502,
      'upstream_5xx',
      requestId,
      details.code,
    )
  }
  return new ProviderRequestError(
    details.message
      ? `${provider.displayName} 请求失败：${details.message}`
      : `${provider.displayName} 请求失败，请检查模型 ID 和账号权限。`,
    422,
    details.code ?? `provider_${status}`,
    requestId,
    details.code,
  )
}

async function postProvider(
  provider: ProviderDefinition,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: ProviderAdapterInput,
): Promise<{ body: Record<string, unknown>; requestId: string | null }> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), 45_000)
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderRequestError(
        `${provider.displayName} 响应超时，请稍后重试。`,
        504,
        'provider_timeout',
      )
    }
    throw new ProviderRequestError(
      `无法连接 ${provider.displayName}，请检查服务端网络。`,
      502,
      'provider_network_error',
    )
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }

  const requestId = responseRequestId(response)
  if (!response.ok) {
    throw statusError(provider, response.status, await readResponseJson(response), requestId)
  }
  const parsed = await readResponseJson(response)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderRequestError(
      `${provider.displayName} 返回了无法解析的响应。`,
      502,
      'provider_invalid_json',
      requestId,
    )
  }
  return { body: parsed as Record<string, unknown>, requestId }
}

function openAiCompatibleContent(body: Record<string, unknown>): string {
  const choices = body.choices
  const first = Array.isArray(choices) && choices[0] && typeof choices[0] === 'object'
    ? choices[0] as Record<string, unknown>
    : null
  const message =
    first?.message && typeof first.message === 'object'
      ? first.message as Record<string, unknown>
      : null
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .flatMap(part => {
        if (!part || typeof part !== 'object') return []
        const text = (part as Record<string, unknown>).text
        return typeof text === 'string' ? [text] : []
      })
      .join('')
      .trim()
  }
  return ''
}

async function runOpenAiCompatible(
  resolved: ResolvedProviderModel,
  input: ProviderAdapterInput,
): Promise<{ content: string; usage: ProviderUsage | null; requestId: string | null }> {
  const provider = resolved.provider
  const { body, requestId } = await postProvider(
    provider,
    provider.endpoint,
    {
      Authorization: `Bearer ${input.connection.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    {
      model: resolved.model,
      messages: [
        { role: 'system', content: input.instructions },
        { role: 'user', content: input.userText },
      ],
      temperature: input.temperature,
      [provider.maxOutputTokensField ?? 'max_tokens']: input.maxOutputTokens,
      stream: false,
      ...(input.jsonOutput && resolved.nativeJson
        ? { response_format: { type: 'json_object' } }
        : {}),
    },
    input,
  )
  const content = openAiCompatibleContent(body)
  if (!content) {
    throw new ProviderRequestError(
      `${provider.displayName} 没有返回可显示的文本回复。`,
      502,
      'provider_empty_reply',
      requestId,
    )
  }
  return {
    content,
    usage: normalizeProviderUsage(body.usage),
    requestId,
  }
}

async function runGemini(
  resolved: ResolvedProviderModel,
  input: ProviderAdapterInput,
): Promise<{ content: string; usage: ProviderUsage | null; requestId: string | null }> {
  const provider = resolved.provider
  const apiModel = resolved.model.replace(/^models\//, '')
  const url = provider.endpoint.replace('{model}', encodeURIComponent(apiModel))
  const { body, requestId } = await postProvider(
    provider,
    url,
    {
      'x-goog-api-key': input.connection.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    {
      systemInstruction: { parts: [{ text: input.instructions }] },
      contents: [{ role: 'user', parts: [{ text: input.userText }] }],
      generationConfig: {
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        ...(input.jsonOutput && resolved.nativeJson
          ? { responseMimeType: 'application/json' }
          : {}),
      },
    },
    input,
  )
  const candidates = body.candidates
  const first = Array.isArray(candidates) && candidates[0] && typeof candidates[0] === 'object'
    ? candidates[0] as Record<string, unknown>
    : null
  const contentObject =
    first?.content && typeof first.content === 'object'
      ? first.content as Record<string, unknown>
      : null
  const parts = contentObject?.parts
  const content = Array.isArray(parts)
    ? parts.flatMap(part => {
        if (!part || typeof part !== 'object') return []
        const text = (part as Record<string, unknown>).text
        return typeof text === 'string' ? [text] : []
      }).join('').trim()
    : ''
  if (!content) {
    throw new ProviderRequestError(
      `${provider.displayName} 没有返回可显示的文本回复。`,
      502,
      'provider_empty_reply',
      requestId,
    )
  }
  return {
    content,
    usage: normalizeProviderUsage(body.usageMetadata),
    requestId,
  }
}

async function runAnthropic(
  resolved: ResolvedProviderModel,
  input: ProviderAdapterInput,
): Promise<{ content: string; usage: ProviderUsage | null; requestId: string | null }> {
  const provider = resolved.provider
  const { body, requestId } = await postProvider(
    provider,
    provider.endpoint,
    {
      'x-api-key': input.connection.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    {
      model: resolved.model,
      system: input.instructions,
      messages: [{ role: 'user', content: input.userText }],
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
    },
    input,
  )
  const contentBlocks = body.content
  const content = Array.isArray(contentBlocks)
    ? contentBlocks.flatMap(block => {
        if (!block || typeof block !== 'object') return []
        const item = block as Record<string, unknown>
        return item.type === 'text' && typeof item.text === 'string' ? [item.text] : []
      }).join('').trim()
    : ''
  if (!content) {
    throw new ProviderRequestError(
      `${provider.displayName} 没有返回可显示的文本回复。`,
      502,
      'provider_empty_reply',
      requestId,
    )
  }
  return {
    content,
    usage: normalizeProviderUsage(body.usage),
    requestId,
  }
}

export async function runProviderAdapter(
  input: ProviderAdapterInput,
): Promise<ProviderTextResult> {
  const resolved = resolveProviderModel(input.connection.provider, input.connection.model)
  const startedAt = Date.now()
  const output = resolved.provider.protocol === 'gemini'
    ? await runGemini(resolved, input)
    : resolved.provider.protocol === 'anthropic'
      ? await runAnthropic(resolved, input)
      : await runOpenAiCompatible(resolved, input)
  return {
    content: output.content,
    provider: resolved.provider.providerId,
    model: resolved.model,
    usage: output.usage,
    requestId: output.requestId,
    latencyMs: Date.now() - startedAt,
  }
}
