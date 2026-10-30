import { IDB_DEFAULT_DATABASE, createIndexedDBAdapter, type MigrationCapableStorage } from './indexeddb-adapter.ts'
import type { LifeRecordStorage } from './storage-adapter.ts'
import { normalizeMigrationState } from './life-migration-state.ts'

export const MIGRATION_LOCK_NAME = 'ai-lifeos:local-db-migration:v1'

/**
 * 能力判断，不是状态推断：迁移状态存放在 IndexedDB meta store，
 * 因此环境根本不支持 IndexedDB 时，迁移不可能已被启用，localStorage 仍是权威源。
 * IndexedDB 存在但打开或读取失败属于另一回事，必须报错而不是猜。
 */
export function hasIndexedDBSupport(): boolean {
  return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null
}

/**
 * 本地存储路由选择 v1。
 *
 * 只有一个判据：持久化迁移状态是否已显式进入 SUCCEEDED 且 activeStore 为
 * indexedDB。绝不通过「IndexedDB 里有数据」推断已经迁移。
 *
 * 这是纯函数，不打开数据库；调用方必须先读取状态再调用它。
 */
export interface LocalStoreRoute {
  store: 'localStorage' | 'indexedDB'
  reason: string
}

export function resolveLocalStoreRoute(rawState: unknown): LocalStoreRoute {
  const state = normalizeMigrationState(rawState)
  if (state.status === 'SUCCEEDED' && state.activeStore === 'indexedDB') {
    return { store: 'indexedDB', reason: '迁移状态为 SUCCEEDED，IndexedDB 是唯一权威本地数据源' }
  }
  if (state.status === 'READY_TO_SWITCH') {
    return {
      store: 'localStorage',
      reason: '数据已复制并校验，但尚未显式启用；localStorage 仍是权威数据源',
    }
  }
  return { store: 'localStorage', reason: `迁移状态为 ${state.status}；localStorage 仍是权威数据源` }
}

/**
 * 迁移写入闸门：迁移进行中禁止通过新版页面继续写 localStorage。
 * 这只能约束遵守本协议的新版页面，无法阻止旧标签页。
 */
export function isLocalWriteBlocked(rawState: unknown): { blocked: boolean; message: string } {
  const state = normalizeMigrationState(rawState)
  if (state.status === 'IN_PROGRESS' || state.status === 'VERIFYING') {
    return {
      blocked: true,
      message: '数据升级正在进行，已暂停本地记录写入。请等待升级完成或关闭其它页面后重试。',
    }
  }
  return { blocked: false, message: '' }
}

export class LocalWriteBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalWriteBlockedError'
  }
}

/**
 * 让新版页面的本地写入与迁移共用同一把 Web Lock。
 *
 * - 迁移持有锁时，写入会等待，不会与复制/校验并发；
 * - 取得锁后重新读取持久化状态，迁移中直接拒绝；
 * - 不支持 Web Locks 时不伪造锁；迁移入口本身也会拒绝运行。
 *
 * 状态读取失败时向调用方抛错，不猜测应写入哪个数据库。
 */
export async function runGuardedLocalWrite<T>(
  locks: LockManager | undefined,
  readState: () => Promise<unknown>,
  write: (rawState: unknown) => Promise<T>,
): Promise<T> {
  const execute = async () => {
    if (!hasIndexedDBSupport()) return write(null)
    const rawState = await readState()
    const gate = isLocalWriteBlocked(rawState)
    if (gate.blocked) throw new LocalWriteBlockedError(gate.message)
    return write(rawState)
  }
  if (!locks) return execute()
  return locks.request(MIGRATION_LOCK_NAME, execute)
}

/**
 * 按已确定的路由包装本地适配器。
 * 登录用户不经过这里：Firebase 路由在 life-record-store 中优先判断，保持不变。
 */
export function createRoutedLocalAdapter(
  route: LocalStoreRoute,
  localStorageAdapter: LifeRecordStorage,
  options: { databaseName?: string } = {},
): LifeRecordStorage {
  if (route.store === 'localStorage') return localStorageAdapter
  // 显式使用默认库名；调用方传入数据库名时（隔离测试）以传入值为准。
  return createIndexedDBAdapter({ databaseName: options.databaseName ?? IDB_DEFAULT_DATABASE })
}

/** 供迁移入口使用的目标适配器工厂；数据库名必须由调用方明确给出或走默认。 */
export function createMigrationTarget(options: { databaseName?: string } = {}): MigrationCapableStorage {
  return createIndexedDBAdapter({ databaseName: options.databaseName ?? IDB_DEFAULT_DATABASE })
}
