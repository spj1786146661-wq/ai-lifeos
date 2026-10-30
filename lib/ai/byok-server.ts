import { createHash } from 'node:crypto'
import {
  validateByokConnection,
  type ValidatedByokConnection,
} from './byok-connection.ts'

export function byokCredentialFingerprint(
  value: string | Pick<ValidatedByokConnection, 'provider' | 'apiKey'>,
): string {
  const provider = typeof value === 'string' ? 'tokenhub' : value.provider
  const apiKey = typeof value === 'string' ? value : value.apiKey
  return createHash('sha256')
    .update('ai-lifeos-byok-v2\0')
    .update(provider)
    .update('\0')
    .update(apiKey)
    .digest('base64url')
}

export function parseOptionalByokConnection(
  value: unknown,
): ValidatedByokConnection | null {
  if (value === undefined || value === null) return null
  return validateByokConnection(value)
}
