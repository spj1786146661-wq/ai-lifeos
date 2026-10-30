export const TOKENHUB_CHAT_URL =
  'https://tokenhub.tencentmaas.com/v1/chat/completions'
export const TOKENHUB_DEFAULT_MODEL_ID = 'deepseek/deepseek-flash'
export const TOKENHUB_MODEL_ID_ENV = 'TENCENT_TOKENHUB_MODEL_ID'
export const TOKENHUB_MODEL_LABEL = 'DeepSeek-V4.1-Flash-1017'

/**
 * Resolve the server-side TokenHub model once per request. The environment
 * value is trimmed and must be a bounded model identifier; malformed values
 * never become an arbitrary URL, header, or log value.
 */
export function resolveTokenHubModelId(
  raw = process.env.TENCENT_TOKENHUB_MODEL_ID,
): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return TOKENHUB_DEFAULT_MODEL_ID
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value)) {
    throw new Error(
      `${TOKENHUB_MODEL_ID_ENV} 必须是 1–160 位的模型 ID，只能包含字母、数字、点、下划线、冒号、斜杠和连字符`,
    )
  }
  return value
}

export const MODEL_TEST_MAX_REQUEST_BYTES = 32 * 1024
export const MODEL_TEST_MAX_MESSAGE_CHARS = 2_000
export const MODEL_TEST_MAX_MESSAGES = 12
export const MODEL_TEST_MAX_TOTAL_CHARS = 8_000
export const MODEL_TEST_MAX_OUTPUT_TOKENS = 600
export const MODEL_TEST_TIMEOUT_MS = 45_000

export type ModelTestRole = 'user' | 'assistant'

export interface ModelTestMessage {
  role: ModelTestRole
  content: string
}

export interface ModelTestUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}
