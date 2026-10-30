/**
 * 本地数据库迁移状态机 v1。
 *
 * 状态与数据分开保存：状态在 IndexedDB 的 meta store，记录在 records store。
 * 关键区分：
 * - READY_TO_SWITCH = 数据已复制并逐字段校验通过，但权威数据源仍是 localStorage；
 * - SUCCEEDED = 用户显式启用，IndexedDB 成为唯一权威写入源。
 *
 * 复制验证成功绝不自动切换。状态不能由「数据库是否为空」推断。
 */

export type MigrationStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'VERIFYING'
  | 'READY_TO_SWITCH'
  | 'SUCCEEDED'
  | 'FAILED'

export type ActiveLocalStore = 'localStorage' | 'indexedDB'

export interface MigrationState {
  key: typeof MIGRATION_STATE_KEY
  status: MigrationStatus
  /** 当前权威本地数据源；只有 SUCCEEDED 才允许是 indexedDB。 */
  activeStore: ActiveLocalStore
  /** 迁移开始时来源记录的确定性指纹；切换前会重新计算比对。 */
  sourceFingerprint: string | null
  sourceRecordCount: number | null
  targetRecordCount: number | null
  /** 迁移前导出的 JSON 备份时间；未备份为 null。 */
  backupExportedAt: string | null
  startedAt: string | null
  updatedAt: string
  finishedAt: string | null
  attempt: number
  errorCode: string | null
  errorMessage: string | null
}

export const MIGRATION_STATE_KEY = 'migration:v1'

export const MIGRATION_STATUSES: readonly MigrationStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'VERIFYING',
  'READY_TO_SWITCH',
  'SUCCEEDED',
  'FAILED',
]

export const MIGRATION_STATUS_LABELS: Record<MigrationStatus, string> = {
  NOT_STARTED: '尚未升级',
  IN_PROGRESS: '正在复制数据',
  VERIFYING: '正在校验数据',
  READY_TO_SWITCH: '已校验，等待启用',
  SUCCEEDED: '已启用本地数据库',
  FAILED: '迁移失败',
}

/** 允许的状态转换；任何不在表内的转换都必须拒绝。 */
const ALLOWED_TRANSITIONS: Record<MigrationStatus, readonly MigrationStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS'],
  // 复制中断后可以重新开始（重新校验残留），也可以直接失败。
  IN_PROGRESS: ['VERIFYING', 'FAILED', 'IN_PROGRESS'],
  VERIFYING: ['READY_TO_SWITCH', 'FAILED'],
  // 已就绪后允许重新校验（来源可能变化）或直接失败，但只有显式激活才进 SUCCEEDED。
  READY_TO_SWITCH: ['SUCCEEDED', 'FAILED', 'VERIFYING'],
  // 已启用后不允许回到其它状态：避免权威源反复横跳。
  SUCCEEDED: [],
  // 失败可以从头再来。
  FAILED: ['IN_PROGRESS'],
}

export function canTransition(from: MigrationStatus, to: MigrationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function createInitialMigrationState(now: string = new Date().toISOString()): MigrationState {
  return {
    key: MIGRATION_STATE_KEY,
    status: 'NOT_STARTED',
    activeStore: 'localStorage',
    sourceFingerprint: null,
    sourceRecordCount: null,
    targetRecordCount: null,
    backupExportedAt: null,
    startedAt: null,
    updatedAt: now,
    finishedAt: null,
    attempt: 0,
    errorCode: null,
    errorMessage: null,
  }
}

function isStatus(value: unknown): value is MigrationStatus {
  return typeof value === 'string' && (MIGRATION_STATUSES as readonly string[]).includes(value)
}

/**
 * 读取持久化状态并做结构校验。任何无法确认的字段都回落到初始状态，
 * 不把损坏的状态记录解释成「已完成」。
 */
export function normalizeMigrationState(raw: unknown, now: string = new Date().toISOString()): MigrationState {
  if (!raw || typeof raw !== 'object') return createInitialMigrationState(now)
  const input = raw as Record<string, unknown>
  if (input.key !== MIGRATION_STATE_KEY || !isStatus(input.status)) {
    return createInitialMigrationState(now)
  }
  // SUCCEEDED 必须与显式 activeStore=indexedDB 成对出现。损坏或手工篡改的
  // 状态不能继续冒充“已启用”，否则路由会落到 localStorage 且拒绝重试。
  if (input.status === 'SUCCEEDED' && input.activeStore !== 'indexedDB') {
    return {
      ...createInitialMigrationState(now),
      status: 'FAILED',
      errorCode: 'INVALID_ACTIVE_STORE',
      errorMessage: '持久化状态声称迁移已完成，但没有指向 IndexedDB；已停止自动切换。',
    }
  }
  const status = input.status
  // 只有 SUCCEEDED 才可能指向 IndexedDB；其它状态一律视为 localStorage。
  const activeStore: ActiveLocalStore = status === 'SUCCEEDED' && input.activeStore === 'indexedDB'
    ? 'indexedDB'
    : 'localStorage'
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  const count = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null

  return {
    key: MIGRATION_STATE_KEY,
    status,
    activeStore,
    sourceFingerprint: text(input.sourceFingerprint),
    sourceRecordCount: count(input.sourceRecordCount),
    targetRecordCount: count(input.targetRecordCount),
    backupExportedAt: text(input.backupExportedAt),
    startedAt: text(input.startedAt),
    updatedAt: text(input.updatedAt) ?? now,
    finishedAt: text(input.finishedAt),
    attempt: count(input.attempt) ?? 0,
    errorCode: text(input.errorCode),
    errorMessage: text(input.errorMessage),
  }
}

/**
 * 生成状态变更结果。非法转换直接抛错，避免把状态机当成可随意赋值的字段。
 */
export function transitionMigrationState(
  current: MigrationState,
  next: MigrationStatus,
  patch: Partial<Omit<MigrationState, 'key' | 'status' | 'activeStore'>> & {
    activeStore?: ActiveLocalStore
  } = {},
  now: string = new Date().toISOString(),
): MigrationState {
  if (!canTransition(current.status, next)) {
    throw new Error(`不允许的迁移状态转换：${current.status} → ${next}`)
  }
  const activeStore = patch.activeStore ?? current.activeStore
  if (next === 'SUCCEEDED' && activeStore !== 'indexedDB') {
    throw new Error('只有显式启用 IndexedDB 时才能进入 SUCCEEDED')
  }
  if (next !== 'SUCCEEDED' && activeStore === 'indexedDB') {
    throw new Error('未启用 IndexedDB 时 activeStore 不得为 indexedDB')
  }
  return {
    ...current,
    ...patch,
    key: MIGRATION_STATE_KEY,
    status: next,
    activeStore,
    updatedAt: now,
  }
}

/**
 * 记录的确定性指纹：对象键排序、保留数组顺序、给值带类型前缀，
 * 因此字段顺序不同不会产生假差异，而 1 与 "1" 一定不同。
 */
export function canonicalizeForFingerprint(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`
  if (typeof value === 'number') return `n:${String(value)}`
  if (typeof value === 'boolean') return `b:${String(value)}`
  if (Array.isArray(value)) return `[${value.map(canonicalizeForFingerprint).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalizeForFingerprint(record[key])}`).join(',')}}`
  }
  return `x:${String(value)}`
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 计算一批记录的 SHA-256 指纹。迁移前后各算一次，任何字段变化都会改变指纹。
 * 依赖 Web Crypto（浏览器与 Node 18+ 均提供）；不可用时明确报错，不返回假指纹。
 */
export async function fingerprintRecords(records: readonly unknown[]): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前环境不支持 Web Crypto，无法计算迁移数据指纹')
  // 按 ID 排序，使指纹不依赖数组顺序，只反映记录内容集合。
  const sorted = [...records].sort((left, right) => {
    const a = typeof (left as { id?: unknown })?.id === 'string' ? (left as { id: string }).id : ''
    const b = typeof (right as { id?: unknown })?.id === 'string' ? (right as { id: string }).id : ''
    return a < b ? -1 : a > b ? 1 : 0
  })
  const payload = new TextEncoder().encode(sorted.map(canonicalizeForFingerprint).join('\n'))
  const digest = await subtle.digest('SHA-256', payload)
  return toHex(digest)
}
