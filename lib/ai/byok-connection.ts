import {
  getProviderDefinition,
  resolveProviderModel,
} from './provider-registry.ts'
import type { ByokProviderId } from './provider-types.ts'

export const TOKENHUB_PROVIDER_ID = 'tokenhub' as const

export type ByokConnectionStatus =
  | 'disconnected'
  | 'testing'
  | 'invalid_key'
  | 'not_authorized'
  | 'quota_or_rate_limited'
  | 'network_timeout'
  | 'invalid_schema'
  | 'connected'

export interface ByokConnection {
  provider: ByokProviderId
  apiKey: string
  model: string
}

/** Backward-compatible name retained for existing personal TokenHub callers. */
export type TokenHubByokConnection = ByokConnection

export interface PublicByokConnection {
  provider: ByokProviderId
  apiKey: string
  model?: string
}

export type ValidatedByokConnection = ByokConnection

const API_KEY_MIN_LENGTH = 16
const API_KEY_MAX_LENGTH = 512
const CLIENT_URL_FIELDS = [
  'baseUrl',
  'baseURL',
  'base_url',
  'endpoint',
  'endpointUrl',
  'url',
] as const

/**
 * Provider keys are opaque credentials. Validate only transport safety and
 * bounded length; vendor-specific formats may change over time.
 */
export function normalizeByokApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请输入所选 AI 服务商的 API Key')
  const apiKey = value.trim()
  if (
    apiKey.length < API_KEY_MIN_LENGTH
    || apiKey.length > API_KEY_MAX_LENGTH
    || /[\u0000-\u0020\u007f]/.test(apiKey)
  ) {
    throw new Error('API Key 格式无效，请从所选服务商控制台重新复制')
  }
  return apiKey
}

/** Backward-compatible alias used by the original TokenHub implementation. */
export const normalizeTokenHubApiKey = normalizeByokApiKey

export function validateByokConnection(value: unknown): ValidatedByokConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('尚未连接 AI 服务')
  }
  const raw = value as Record<string, unknown>
  if (CLIENT_URL_FIELDS.some(field => raw[field] !== undefined)) {
    throw new Error('客户端不得指定 Base URL；AI-LifeOS 只使用服务端审核的官方端点')
  }
  const resolved = resolveProviderModel(raw.provider, raw.model)
  return {
    provider: resolved.provider.providerId,
    apiKey: normalizeByokApiKey(raw.apiKey),
    model: resolved.model,
  }
}

export function byokStatusFromErrorCode(
  code: string | undefined,
): Exclude<ByokConnectionStatus, 'disconnected' | 'testing' | 'connected'> {
  if (code === 'upstream_401' || code === 'provider_401') return 'invalid_key'
  if (code === 'upstream_403' || code === 'provider_403') return 'not_authorized'
  if (
    code === 'upstream_429'
    || code === 'provider_429'
    || code === 'local_rate_limited'
    || code === 'public_beta_rate_limited'
  ) {
    return 'quota_or_rate_limited'
  }
  if (
    code === 'tokenhub_timeout'
    || code === 'tokenhub_network_error'
    || code === 'provider_timeout'
    || code === 'provider_network_error'
  ) {
    return 'network_timeout'
  }
  return 'invalid_schema'
}

export function byokConnectionLabel(
  connection: Pick<ByokConnection, 'provider' | 'model'>,
): string {
  return `${getProviderDefinition(connection.provider).displayName} · ${connection.model}`
}
