import {
  normalizeByokApiKey,
  validateByokConnection,
  type ByokConnection,
} from './byok-connection.ts'
import { isByokProviderId } from './provider-types.ts'

export const BYOK_SESSION_STORAGE_KEY = 'aios:byok-session:v2'
export const TOKENHUB_BYOK_SESSION_STORAGE_KEY = 'aios:tokenhub-byok-session:v1'

const SESSION_MEMORY_VERSION = 2
const LEGACY_SESSION_MEMORY_VERSION = 1
const MAX_SERIALIZED_LENGTH = 1_024

export type ByokSessionStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

interface StoredByokSession {
  version: typeof SESSION_MEMORY_VERSION
  provider: ByokConnection['provider']
  apiKey: string
  model: string
}

interface StoredLegacyTokenHubSession {
  version: typeof LEGACY_SESSION_MEMORY_VERSION
  provider: 'tokenhub'
  apiKey: string
  model: string
}

function discardInvalidValue(storage: ByokSessionStorage, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // Storage may be unavailable. Never expose the rejected value in an error.
  }
}

function readLegacyTokenHubConnection(
  storage: ByokSessionStorage,
): ByokConnection | null {
  try {
    const serialized = storage.getItem(TOKENHUB_BYOK_SESSION_STORAGE_KEY)
    if (
      serialized === null
      || serialized.length === 0
      || serialized.length > MAX_SERIALIZED_LENGTH
    ) {
      if (serialized !== null) {
        discardInvalidValue(storage, TOKENHUB_BYOK_SESSION_STORAGE_KEY)
      }
      return null
    }

    const parsed = JSON.parse(serialized) as Partial<StoredLegacyTokenHubSession> | null
    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || parsed.version !== LEGACY_SESSION_MEMORY_VERSION
      || parsed.provider !== 'tokenhub'
    ) {
      discardInvalidValue(storage, TOKENHUB_BYOK_SESSION_STORAGE_KEY)
      return null
    }
    return validateByokConnection({
      provider: 'tokenhub',
      apiKey: parsed.apiKey,
      model: parsed.model,
    })
  } catch {
    discardInvalidValue(storage, TOKENHUB_BYOK_SESSION_STORAGE_KEY)
    return null
  }
}

export function readRememberedByokConnection(
  storage: ByokSessionStorage,
): ByokConnection | null {
  try {
    const serialized = storage.getItem(BYOK_SESSION_STORAGE_KEY)
    if (serialized !== null) {
      if (serialized.length === 0 || serialized.length > MAX_SERIALIZED_LENGTH) {
        discardInvalidValue(storage, BYOK_SESSION_STORAGE_KEY)
        return null
      }
      const parsed = JSON.parse(serialized) as Partial<StoredByokSession> | null
      if (
        !parsed
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
        || parsed.version !== SESSION_MEMORY_VERSION
        || !isByokProviderId(parsed.provider)
      ) {
        discardInvalidValue(storage, BYOK_SESSION_STORAGE_KEY)
        return null
      }
      return validateByokConnection(parsed)
    }
  } catch {
    discardInvalidValue(storage, BYOK_SESSION_STORAGE_KEY)
    return null
  }
  return readLegacyTokenHubConnection(storage)
}

export function rememberByokConnection(
  storage: ByokSessionStorage,
  value: ByokConnection,
): boolean {
  try {
    const validated = validateByokConnection(value)
    const stored: StoredByokSession = {
      version: SESSION_MEMORY_VERSION,
      provider: validated.provider,
      apiKey: normalizeByokApiKey(validated.apiKey),
      model: validated.model,
    }
    const serialized = JSON.stringify(stored)
    if (serialized.length > MAX_SERIALIZED_LENGTH) return false
    storage.setItem(BYOK_SESSION_STORAGE_KEY, serialized)
    try {
      storage.removeItem(TOKENHUB_BYOK_SESSION_STORAGE_KEY)
    } catch {
      // The current v2 value remains usable even if legacy cleanup is blocked.
    }
    return true
  } catch {
    return false
  }
}

export function updateRememberedByokConnection(
  storage: ByokSessionStorage,
  remember: boolean,
  value: ByokConnection,
): boolean {
  if (!remember) return forgetRememberedByokApiKey(storage)
  return rememberByokConnection(storage, value)
}

export function forgetRememberedByokApiKey(
  storage: ByokSessionStorage,
): boolean {
  try {
    storage.removeItem(BYOK_SESSION_STORAGE_KEY)
    storage.removeItem(TOKENHUB_BYOK_SESSION_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/** Compatibility aliases for existing TokenHub UI and tests. */
export const readRememberedTokenHubConnection = readRememberedByokConnection
export const rememberTokenHubConnection = rememberByokConnection
export const updateRememberedTokenHubConnection = updateRememberedByokConnection
export const forgetRememberedTokenHubApiKey = forgetRememberedByokApiKey
