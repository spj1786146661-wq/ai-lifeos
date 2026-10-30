export const BYOK_PROVIDER_IDS = [
  'tokenhub',
  'bigmodel',
  'deepseek',
  'qwen',
  'openrouter',
  'openai',
  'gemini',
  'siliconflow',
  'volcano',
  'anthropic',
  'moonshot',
  'minimax',
  'hunyuan',
  'xai',
  'mistral',
  'groq',
  'together',
] as const

export type ByokProviderId = typeof BYOK_PROVIDER_IDS[number]
export type LifeRecordProvider = ByokProviderId | 'chatgpt' | 'rule'
export type ProviderProtocol = 'openai-compatible' | 'gemini' | 'anthropic'
export type MaxOutputTokensField = 'max_tokens' | 'max_completion_tokens'

export interface ProviderModelDefinition {
  id: string
  label: string
  supportsVision: boolean
  nativeJson: boolean
}

export interface ProviderDefinition {
  providerId: ByokProviderId
  displayName: string
  documentationUrl: string
  keyUrl: string
  protocol: ProviderProtocol
  /** Fixed official endpoint. A client-supplied Base URL is never accepted. */
  endpoint: string
  defaultModel: string
  models: readonly ProviderModelDefinition[]
  allowCustomModel: boolean
  supportsText: true
  /** Request field used by OpenAI-compatible text endpoints. */
  maxOutputTokensField?: MaxOutputTokensField
}

const BYOK_PROVIDER_ID_SET = new Set<string>(BYOK_PROVIDER_IDS)

export function isByokProviderId(value: unknown): value is ByokProviderId {
  return typeof value === 'string' && BYOK_PROVIDER_ID_SET.has(value)
}

export function isLifeRecordProvider(value: unknown): value is LifeRecordProvider {
  return value === 'chatgpt' || value === 'rule' || isByokProviderId(value)
}
