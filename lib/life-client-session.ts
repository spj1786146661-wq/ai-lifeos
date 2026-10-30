export const LIFE_CLIENT_SESSION_STORAGE_KEY = 'ai-lifeos:client-session:v1'

const CLIENT_SESSION_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/

export function validLifeClientSessionId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_SESSION_PATTERN.test(value.trim())
}

export function readOrCreateLifeClientSessionId(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  current: string,
  idFactory: () => string = () => crypto.randomUUID(),
): string {
  if (validLifeClientSessionId(current)) return current.trim()
  try {
    const stored = storage.getItem(LIFE_CLIENT_SESSION_STORAGE_KEY)
    if (validLifeClientSessionId(stored)) return stored.trim()
  } catch {
    // A generated per-tab value still prevents duplicate submission.
  }
  const generated = idFactory().trim()
  if (!validLifeClientSessionId(generated)) {
    throw new Error('无法生成安全的浏览器会话标识')
  }
  try {
    storage.setItem(LIFE_CLIENT_SESSION_STORAGE_KEY, generated)
  } catch {
    // The in-memory current value remains stable for this mounted page.
  }
  return generated
}
