import {
  isByokProviderId,
  type ProviderDefinition,
  type ProviderModelDefinition,
} from './provider-types.ts'

const textModel = (
  id: string,
  label = id,
  nativeJson = false,
): ProviderModelDefinition => ({
  id,
  label,
  supportsVision: false,
  nativeJson,
})

const visionModel = (
  id: string,
  label = id,
  nativeJson = false,
): ProviderModelDefinition => ({
  id,
  label,
  supportsVision: true,
  nativeJson,
})

/**
 * Public metadata only. API keys and server-side environment values never
 * belong in this registry. Every endpoint is fixed so the BYOK API cannot be
 * turned into an arbitrary URL proxy.
 */
export const PROVIDER_REGISTRY: readonly ProviderDefinition[] = [
  {
    providerId: 'tokenhub',
    displayName: '腾讯云 TokenHub',
    documentationUrl: 'https://cloud.tencent.com/document/product/1850',
    keyUrl: 'https://console.cloud.tencent.com/tokenhub/apikey',
    protocol: 'openai-compatible',
    endpoint: 'https://tokenhub.tencentmaas.com/v1/chat/completions',
    defaultModel: 'deepseek/deepseek-flash',
    models: [
      textModel('deepseek/deepseek-flash', 'DeepSeek Flash', true),
      textModel('deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash 1017', true),
    ],
    allowCustomModel: true,
    supportsText: true,
    maxOutputTokensField: 'max_tokens',
  },
  {
    providerId: 'bigmodel',
    displayName: '智谱 BigModel',
    documentationUrl: 'https://docs.bigmodel.cn/api-reference/模型-api/对话补全',
    keyUrl: 'https://www.bigmodel.cn/usercenter/apikeys',
    protocol: 'openai-compatible',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-5.3',
    models: [
      textModel('glm-5.3', 'GLM-5.3', true),
    ],
    allowCustomModel: true,
    supportsText: true,
    maxOutputTokensField: 'max_tokens',
  },
  {
    providerId: 'deepseek',
    displayName: 'DeepSeek 官方',
    documentationUrl: 'https://api-docs.deepseek.com/api/create-chat-completion',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    protocol: 'openai-compatible',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    models: [
      textModel('deepseek-chat', 'DeepSeek Chat', true),
      textModel('deepseek-reasoner', 'DeepSeek Reasoner', true),
    ],
    allowCustomModel: true,
    supportsText: true,
    maxOutputTokensField: 'max_tokens',
  },
  {
    providerId: 'qwen',
    displayName: '阿里云百炼 Qwen',
    documentationUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
    keyUrl: 'https://bailian.console.aliyun.com/',
    protocol: 'openai-compatible',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    models: [
      textModel('qwen-plus', 'Qwen Plus', true),
      textModel('qwen-max', 'Qwen Max', true),
      textModel('qwen-turbo', 'Qwen Turbo', true),
      visionModel('qwen-vl-max', 'Qwen VL Max', true),
    ],
    allowCustomModel: true,
    supportsText: true,
    maxOutputTokensField: 'max_completion_tokens',
  },
  {
    providerId: 'openrouter',
    displayName: 'OpenRouter',
    documentationUrl: 'https://openrouter.ai/docs/api-reference/chat-completion',
    keyUrl: 'https://openrouter.ai/settings/keys',
    protocol: 'openai-compatible',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openrouter/auto',
    models: [
      textModel('openrouter/auto', 'OpenRouter Auto', true),
      textModel('openai/gpt-4.1-mini', 'OpenAI GPT-4.1 Mini', true),
    ],
    allowCustomModel: true,
    supportsText: true,
    maxOutputTokensField: 'max_tokens',
  },
  {
    providerId: 'openai',
    displayName: 'OpenAI API',
    documentationUrl: 'https://platform.openai.com/docs/api-reference/chat/create',
    keyUrl: 'https://platform.openai.com/api-keys',
    protocol: 'openai-compatible',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4.1-mini',
    models: [
      textModel('gpt-4.1-mini', 'GPT-4.1 Mini', true),
      visionModel('gpt-4o-mini', 'GPT-4o Mini', true),
    ],
    allowCustomModel: true,
    supportsText: true,
    maxOutputTokensField: 'max_completion_tokens',
  },
  {
    providerId: 'gemini',
    displayName: 'Google Gemini',
    documentationUrl: 'https://ai.google.dev/api/generate-content',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    protocol: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    defaultModel: 'gemini-2.5-flash',
    models: [
      visionModel('gemini-2.5-flash', 'Gemini 2.5 Flash', true),
      visionModel('gemini-2.5-pro', 'Gemini 2.5 Pro', true),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'siliconflow',
    displayName: '硅基流动 SiliconFlow',
    documentationUrl: 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    protocol: 'openai-compatible',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen3-8B',
    models: [
      textModel('Qwen/Qwen3-8B', 'Qwen3 8B'),
      textModel('deepseek-ai/DeepSeek-V3', 'DeepSeek V3'),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'volcano',
    displayName: '火山方舟',
    documentationUrl: 'https://www.volcengine.com/docs/82379/1494384',
    keyUrl: 'https://console.volcengine.com/ark',
    protocol: 'openai-compatible',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: 'doubao-seed-1-6-flash-250828',
    models: [
      textModel('doubao-seed-1-6-flash-250828', 'Doubao Seed 1.6 Flash', false),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'anthropic',
    displayName: 'Anthropic Claude',
    documentationUrl: 'https://docs.anthropic.com/en/api/messages',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    protocol: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      visionModel('claude-sonnet-4-20250514', 'Claude Sonnet 4', false),
      visionModel('claude-3-5-haiku-latest', 'Claude 3.5 Haiku', false),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'moonshot',
    displayName: 'Moonshot Kimi',
    documentationUrl: 'https://platform.moonshot.cn/docs/api/chat',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    protocol: 'openai-compatible',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'moonshot-v1-8k',
    models: [
      textModel('moonshot-v1-8k', 'Moonshot v1 8K'),
      textModel('kimi-k2-0905-preview', 'Kimi K2'),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'minimax',
    displayName: 'MiniMax',
    documentationUrl: 'https://platform.minimaxi.com/document/ChatCompletion%20v2',
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    protocol: 'openai-compatible',
    endpoint: 'https://api.minimax.chat/v1/chat/completions',
    defaultModel: 'MiniMax-M2.1',
    models: [
      textModel('MiniMax-M2.1', 'MiniMax M2.1'),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'hunyuan',
    displayName: '腾讯混元',
    documentationUrl: 'https://cloud.tencent.com/document/product/1729/111007',
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    protocol: 'openai-compatible',
    endpoint: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
    defaultModel: 'hunyuan-turbos-latest',
    models: [
      textModel('hunyuan-turbos-latest', '混元 TurboS', false),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'xai',
    displayName: 'xAI Grok',
    documentationUrl: 'https://docs.x.ai/docs/api-reference',
    keyUrl: 'https://console.x.ai/',
    protocol: 'openai-compatible',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    defaultModel: 'grok-4-fast',
    models: [
      textModel('grok-4-fast', 'Grok 4 Fast'),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'mistral',
    displayName: 'Mistral AI',
    documentationUrl: 'https://docs.mistral.ai/api/#tag/chat',
    keyUrl: 'https://console.mistral.ai/api-keys/',
    protocol: 'openai-compatible',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-small-latest',
    models: [
      textModel('mistral-small-latest', 'Mistral Small'),
      textModel('mistral-large-latest', 'Mistral Large'),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'groq',
    displayName: 'Groq',
    documentationUrl: 'https://console.groq.com/docs/api-reference#chat',
    keyUrl: 'https://console.groq.com/keys',
    protocol: 'openai-compatible',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      textModel('llama-3.3-70b-versatile', 'Llama 3.3 70B'),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
  {
    providerId: 'together',
    displayName: 'Together AI',
    documentationUrl: 'https://docs.together.ai/reference/chat-completions',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    protocol: 'openai-compatible',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      textModel('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo'),
    ],
    allowCustomModel: true,
    supportsText: true,
  },
]

const providerById = new Map(
  PROVIDER_REGISTRY.map(provider => [provider.providerId, provider]),
)

export function getProviderDefinition(providerId: unknown): ProviderDefinition {
  if (!isByokProviderId(providerId)) throw new Error('不支持该 AI 服务商')
  const provider = providerById.get(providerId)
  if (!provider) throw new Error('AI 服务商配置不可用')
  return provider
}

export function normalizeProviderModelId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请选择或填写模型 ID')
  const model = value.trim()
  if (
    !model
    || model.length > 160
    || model.includes('://')
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)
  ) {
    throw new Error('模型 ID 格式无效，只能包含字母、数字、点、下划线、冒号、斜杠和连字符')
  }
  return model
}

export interface ResolvedProviderModel {
  provider: ProviderDefinition
  model: string
  modelDefinition: ProviderModelDefinition | null
  supportsVision: boolean
  nativeJson: boolean
}

/**
 * Model IDs can be entered manually because provider catalogs change often.
 * The endpoint remains fixed; capability flags stay conservative unless the
 * selected model is present in the reviewed registry.
 */
export function resolveProviderModel(
  providerId: unknown,
  requestedModel?: unknown,
): ResolvedProviderModel {
  const provider = getProviderDefinition(providerId)
  const model = normalizeProviderModelId(requestedModel ?? provider.defaultModel)
  const modelDefinition = provider.models.find(item => item.id === model) ?? null
  if (!modelDefinition && !provider.allowCustomModel) {
    throw new Error('该服务商不允许使用未登记的模型 ID')
  }
  return {
    provider,
    model,
    modelDefinition,
    supportsVision: modelDefinition?.supportsVision ?? false,
    nativeJson: modelDefinition?.nativeJson ?? false,
  }
}

export function providerDisplayName(providerId: unknown): string {
  if (providerId === 'chatgpt') return 'ChatGPT 套餐'
  if (providerId === 'rule') return '本地规则'
  return isByokProviderId(providerId)
    ? providerById.get(providerId)?.displayName ?? 'AI 服务商'
    : 'AI 服务商'
}
