import {
  normalizeByokApiKey,
  type ValidatedByokConnection,
} from './byok-connection.ts'
import { ProviderRequestError } from './provider-error.ts'
import { resolveProviderModel } from './provider-registry.ts'
import { runProviderAdapter, type ProviderTextResult } from './provider-adapters.ts'
import { requestTokenHubModel } from '../tokenhub-model-test.ts'

export interface RunProviderTextInput {
  connection: Pick<ValidatedByokConnection, 'provider' | 'model' | 'apiKey'>
  instructions: string
  userText: string
  maxOutputTokens?: number
  temperature?: number
  jsonOutput?: boolean
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export async function runProviderText(
  input: RunProviderTextInput,
): Promise<ProviderTextResult> {
  const resolved = resolveProviderModel(
    input.connection.provider,
    input.connection.model,
  )
  const apiKey = normalizeByokApiKey(input.connection.apiKey)
  const maxOutputTokens = Number.isFinite(input.maxOutputTokens)
    ? Math.max(128, Math.min(2_000, Math.trunc(input.maxOutputTokens ?? 900)))
    : 900
  const temperature = Number.isFinite(input.temperature)
    ? Math.max(0, Math.min(1, input.temperature ?? 0.1))
    : 0.1

  // TokenHub keeps its verified request body, including explicit thinking
  // disablement, while every other provider goes through the same adapter
  // boundary and result shape.
  if (resolved.provider.providerId === 'tokenhub') {
    const startedAt = Date.now()
    const result = await requestTokenHubModel([
      { role: 'system', content: input.instructions },
      { role: 'user', content: input.userText },
    ], {
      apiKey,
      model: resolved.model,
      maxOutputTokens,
      temperature,
      jsonOutput: input.jsonOutput !== false,
      disableThinking: true,
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    })
    return {
      content: result.content,
      provider: 'tokenhub',
      model: resolved.model,
      usage: result.usage,
      requestId: result.requestId,
      latencyMs: Date.now() - startedAt,
    }
  }

  return runProviderAdapter({
    connection: {
      provider: resolved.provider.providerId,
      model: resolved.model,
      apiKey,
    },
    instructions: input.instructions,
    userText: input.userText,
    maxOutputTokens,
    temperature,
    jsonOutput: input.jsonOutput !== false,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
  })
}

export { ProviderRequestError }
