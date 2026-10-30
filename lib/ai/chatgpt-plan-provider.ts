/**
 * @module ai/chatgpt-plan-provider
 * @description Provider abstraction that decides where an AI request goes.
 *
 * The three providers are selected by environment and authorization state, and
 * the caller always receives the provider that actually answered, so the UI can
 * never present rule parsing as a real model call.
 *
 *  - rule      : local deterministic parsing, no network call at all.
 *  - chatgpt   : the user's own ChatGPT plan through the official OAuth flow.
 *  - unconfigured : a provider was requested but nothing is available.
 */
import { defaultCredentialsPath, hasPlanCredentials, planUsageGranted, readPlanCredentials } from './chatgpt-plan-credentials.ts'
import { PlanNotAuthorizedError, PlanUsageError, callResponsesStream, resolvePlanAccess } from './chatgpt-plan-responses.ts'

export type AiProviderKind = 'rule' | 'chatgpt' | 'openrouter' | 'unconfigured'

export interface AiProviderState {
  kind: AiProviderKind
  /** Human label for the UI banner and the "我的" page. */
  label: string
  /** True only when a real remote model can be called right now. */
  remoteAvailable: boolean
  /** Why the provider is not usable, when it is not. */
  reason?: string
  model?: string
  account?: string
  /**
   * The stored access token is expired but a refresh token exists, so the call
   * path refreshes before requesting. UI uses this to say "will refresh"
   * instead of "unavailable".
   */
  needsRefresh?: boolean
}

export interface AiTextRequest {
  instructions: string
  input: Array<{ role: 'user' | 'assistant'; content: string }>
  model?: string
}

export interface AiImageRequest {
  instructions: string
  text: string
  imageUrl: string
  model?: string
}

export interface AiTextResult {
  text: string
  provider: 'chatgpt'
  model: string
}

function normalizedPlanFailure(cause: unknown, stage: string): PlanNotAuthorizedError | PlanUsageError {
  if (cause instanceof PlanNotAuthorizedError || cause instanceof PlanUsageError) return cause
  const detail = cause instanceof Error ? cause.message : '未知错误'
  return new PlanUsageError(`${stage}暂不可用：${detail}`, 'provider_unavailable')
}

/**
 * Report which providers are usable, without calling any model.
 * Order matters: ChatGPT plan first (user's own subscription), then OpenRouter,
 * otherwise rule parsing.
 */
export function resolveAiProviderState(options: {
  credentialsPath?: string
  openRouterConfigured: boolean
  openRouterModel?: string
}): AiProviderState {
  const credentialsPath = options.credentialsPath ?? defaultCredentialsPath()
  const credentials = readPlanCredentials(credentialsPath)
  if (credentials) {
    if (credentials.expiresAt <= Date.now()) {
      // The stored access token is expired, but a refresh token may still be
      // valid. Report the plan as unavailable for display, yet let the call
      // path try the refresh: resolvePlanAccess() refreshes and persists a new
      // token before any request. Only a genuinely unusable credential (no
      // refresh token, or a missing plan scope) must fall back to rules.
      if (!credentials.refreshToken || !planUsageGranted(credentials)) {
        return {
          kind: 'unconfigured',
          label: `ChatGPT 套餐授权已过期（${credentials.email ?? '已授权账号'}）`,
          remoteAvailable: false,
          reason: '本地 ChatGPT 授权已过期，需要重新授权后才能调用真实模型',
        }
      }
      return {
        kind: 'chatgpt',
        label: `ChatGPT 套餐（${credentials.email ?? '已授权账号'}）· 访问令牌已过期，调用时自动刷新`,
        remoteAvailable: true,
        model: process.env.CHATGPT_PLAN_MODEL ?? 'gpt-6.1-sol',
        account: credentials.email ?? undefined,
        needsRefresh: true,
      }
    }
    if (!planUsageGranted(credentials)) {
      return {
        kind: 'unconfigured',
        label: 'ChatGPT 授权缺少套餐调用权限',
        remoteAvailable: false,
        reason: '已保存的授权没有 chatgpt.tokens.use.direct 范围，需要重新授权',
      }
    }
    return {
      kind: 'chatgpt',
      label: `ChatGPT 套餐（${credentials.email ?? '已授权账号'}）`,
      remoteAvailable: true,
      model: process.env.CHATGPT_PLAN_MODEL ?? 'gpt-6.1-sol',
      account: credentials.email ?? undefined,
    }
  }
  if (hasPlanCredentials(credentialsPath)) {
    // The envelope exists but decryption failed, so the file was written by
    // another machine or is damaged. Never guess that it is usable.
    return {
      kind: 'unconfigured',
      label: 'ChatGPT 授权文件无法读取',
      remoteAvailable: false,
      reason: '本地授权文件存在但无法解密，请重新授权',
    }
  }
  if (options.openRouterConfigured) {
    return {
      kind: 'openrouter',
      label: `OpenRouter（${options.openRouterModel ?? '默认模型'}）`,
      remoteAvailable: true,
      model: options.openRouterModel,
    }
  }
  return {
    kind: 'rule',
    label: '规则演示解析 · 未调用 AI',
    remoteAvailable: false,
    // No model is configured at all. This is the honest default state: the
    // rule parser answers locally and the UI says so.
    reason: '未配置任何可用模型：没有 ChatGPT 套餐授权，也没有 OPENROUTER_API_KEY',
  }
}

/** True when the ChatGPT plan path is the one that will answer. */
export function chatgptPlanPreferred(options: { credentialsPath?: string } = {}): boolean {
  return resolveAiProviderState({ credentialsPath: options.credentialsPath, openRouterConfigured: false }).kind === 'chatgpt'
}

/**
 * Run a text request on the ChatGPT plan. Throws PlanNotAuthorizedError when
 * the user has not authorized, so callers can degrade to rule parsing with an
 * explicit message instead of pretending a model answered.
 */
export async function runChatgptPlanText(request: AiTextRequest, options: {
  credentialsPath?: string
  now?: number
} = {}): Promise<AiTextResult> {
  try {
    const access = await resolvePlanAccess({ credentialsPath: options.credentialsPath, model: request.model ?? process.env.CHATGPT_PLAN_MODEL ?? 'gpt-6.1-sol', now: options.now })
    const result = await callResponsesStream({
      model: access.model,
      instructions: request.instructions,
      input: request.input,
      accessToken: access.accessToken,
    })
    return { text: result.text, provider: 'chatgpt', model: result.model }
  } catch (cause) {
    throw normalizedPlanFailure(cause, 'ChatGPT 套餐文字解析')
  }
}

export async function runChatgptPlanImage(request: AiImageRequest, options: {
  credentialsPath?: string
  now?: number
} = {}): Promise<AiTextResult> {
  try {
    const access = await resolvePlanAccess({ credentialsPath: options.credentialsPath, model: request.model ?? process.env.CHATGPT_PLAN_VISION_MODEL ?? process.env.CHATGPT_PLAN_MODEL ?? 'gpt-6.1-sol', now: options.now })
    const result = await callResponsesStream({
      model: access.model,
      instructions: request.instructions,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: request.text || '请识别这张图片里的饮食信息。' },
          { type: 'input_image', image_url: request.imageUrl },
        ],
      }],
      accessToken: access.accessToken,
    })
    return { text: result.text, provider: 'chatgpt', model: result.model }
  } catch (cause) {
    throw normalizedPlanFailure(cause, 'ChatGPT 套餐图片解析')
  }
}

/**
 * List the models available to the signed-in account, using the account's
 * access token. Only models with visibility "list" are shown.
 */
export async function listChatgptPlanModels(options: { credentialsPath?: string } = {}): Promise<Array<{ slug: string; displayName: string }>> {
  const access = await resolvePlanAccess({ credentialsPath: options.credentialsPath, model: process.env.CHATGPT_PLAN_MODEL ?? 'gpt-6.1-sol' })
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${access.accessToken}`, Accept: 'application/json' },
  })
  if (!response.ok) throw new PlanUsageError(`获取模型列表失败（${response.status}）`, 'models_failed')
  const parsed = await response.json() as { data?: Array<{ id?: string; slug?: string; display_name?: string; visibility?: string }> }
  const models = parsed.data ?? []
  return models
    .filter(model => model.visibility === 'list')
    .map(model => ({ slug: model.slug ?? model.id ?? '', displayName: model.display_name ?? model.slug ?? model.id ?? '' }))
    .filter(model => model.slug)
}

export { PlanNotAuthorizedError, PlanUsageError }
