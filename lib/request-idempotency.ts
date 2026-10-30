import { createHash } from 'node:crypto'

export type IdempotencyExecutionMode = 'executed' | 'replayed'

export interface IdempotencyOutcome<T> {
  value: T
  mode: IdempotencyExecutionMode
}

export interface IdempotencyRunOptions<T> {
  scope: string
  actionId: string
  fingerprint: string
  operation: () => Promise<T>
  shouldCache?: (value: T) => boolean
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED'

  constructor() {
    super('同一请求 ID 已用于不同内容；请为新操作生成新的请求 ID。')
    this.name = 'IdempotencyConflictError'
  }
}

interface IdempotencyEntry<T> {
  fingerprint: string
  promise: Promise<T>
  completed: boolean
  value?: T
  createdAt: number
  expiresAt: number
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'undefined') return 'null'
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const fields = Object.keys(object)
      .filter(key => object[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    return `{${fields.join(',')}}`
  }
  throw new TypeError(`无法为 ${typeof value} 建立幂等指纹`)
}

/**
 * Hash the complete logical request before it reaches an upstream provider.
 * The digest is held by the idempotency store; raw user text is not retained
 * there for diagnostics or replay.
 */
export function fingerprintIdempotencyPayload(payload: unknown): string {
  return createHash('sha256').update(stableSerialize(payload)).digest('hex')
}

export class IdempotencyStore<T> {
  private readonly entries = new Map<string, IdempotencyEntry<T>>()
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = Math.max(1, options.ttlMs ?? 15 * 60_000)
    this.maxEntries = Math.max(16, options.maxEntries ?? 512)
  }

  get size(): number {
    this.prune()
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  async run(options: IdempotencyRunOptions<T>): Promise<IdempotencyOutcome<T>> {
    const scope = options.scope.trim()
    const actionId = options.actionId.trim()
    if (!scope || !actionId || !options.fingerprint) {
      throw new Error('幂等请求必须包含作用域、动作 ID 和内容指纹')
    }
    const key = `${scope}\u0000${actionId}`
    this.prune()
    const existing = this.entries.get(key)
    if (existing) {
      if (existing.fingerprint !== options.fingerprint) {
        throw new IdempotencyConflictError()
      }
      if (existing.completed) {
        return { value: existing.value as T, mode: 'replayed' }
      }
      return { value: await existing.promise, mode: 'replayed' }
    }

    this.ensureCapacity()
    const createdAt = Date.now()
    const entry = {
      fingerprint: options.fingerprint,
      promise: Promise.resolve(undefined as T),
      completed: false,
      createdAt,
      expiresAt: Number.POSITIVE_INFINITY,
    } as IdempotencyEntry<T>
    entry.promise = Promise.resolve()
      .then(options.operation)
      .then(value => {
        if (options.shouldCache && !options.shouldCache(value)) {
          this.entries.delete(key)
          return value
        }
        entry.completed = true
        entry.value = value
        entry.expiresAt = Date.now() + this.ttlMs
        return value
      })
      .catch(error => {
        this.entries.delete(key)
        throw error
      })
    this.entries.set(key, entry)
    return { value: await entry.promise, mode: 'executed' }
  }

  private prune(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.completed && entry.expiresAt <= now) this.entries.delete(key)
    }
  }

  private ensureCapacity(): void {
    if (this.entries.size < this.maxEntries) return
    for (const [key, entry] of this.entries) {
      if (!entry.completed) continue
      this.entries.delete(key)
      if (this.entries.size < this.maxEntries) return
    }
  }
}
