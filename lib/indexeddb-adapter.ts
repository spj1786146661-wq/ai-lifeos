import { BACKUP_SCHEMA, BACKUP_VERSION, DemoStorageError, type DemoBackup } from './life-demo-store.ts'
import { normalizeLifeRecord, validLifeDate, type LifeRecord } from './life-records.ts'
import type { LifeRecordStorage } from './storage-adapter.ts'

export const IDB_RECORDS_STORE = 'records'
export const IDB_META_STORE = 'meta'
export const IDB_DEFAULT_DATABASE = 'life-tracker-life-records'
export const MIGRATION_META_KEY = 'migration:v1'
const IDB_VERSION = 1

export interface IndexedDBAdapterOptions {
  /** Defaults to the production database name; tests pass their own isolated name. */
  databaseName?: string
  /** Defaults to the browser indexedDB; tests may inject an isolated factory. */
  indexedDBFactory?: IDBFactory
  /** Test-only seam for deterministic IDs; production always uses crypto.randomUUID(). */
  createRecordId?: () => string
}

/** 迁移导入要求目标库为空；携带现有记录数便于调用方报告。 */
export class MigrationTargetNotEmptyError extends Error {
  readonly existingCount: number
  constructor(existingCount: number) {
    super(`目标数据库已有 ${existingCount} 条记录，迁移导入要求目标为空，已拒绝写入`)
    this.name = 'MigrationTargetNotEmptyError'
    this.existingCount = existingCount
  }
}

/**
 * 迁移专用原样写入的结果。
 * 刻意不放进 LifeRecordStorage：那是对页面暴露的正式接口，
 * 增加方法会影响所有实现方，而迁移写入只应由迁移引擎显式调用。
 */
export interface MigrationImportResult {
  /** 实际写入的记录数，与传入数量一致才算成功。 */
  written: number
}

/** 带迁移写入能力的适配器；仍是 LifeRecordStorage，现有调用方不受影响。 */
export interface MigrationCapableStorage extends LifeRecordStorage {
  /**
   * 把来源记录原样写入目标库，供 localStorage → IndexedDB 迁移使用。
   *
   * 硬约束：
   * - 不调用 normalizeLifeRecord()，因此未知字段、用户原话和全部结构化字段都不丢失；
   * - 保留原始 id 与 createdAt，不生成新 ID，不改写时间；
   * - 不静默删除字段，不修改来源对象；
   * - 目标判空与批量写入在同一个 readwrite 事务内完成，不使用 clear()；
   * - 目标非空、写入冲突或事务失败都会抛错，且不会留下部分写入。
   */
  importRawRecordsForMigration(records: readonly unknown[]): Promise<MigrationImportResult>
  /** 读取持久化迁移状态；不存在时返回 null。 */
  readMigrationState(): Promise<unknown | null>
  /** 写入持久化迁移状态。 */
  writeMigrationState(state: unknown): Promise<void>
}

/** 迁移前结构预检：不补 ID、不改日期、不删字段，只拒绝无法无损写入的输入。 */
function checkMigrationRecords(records: readonly unknown[]): void {
  if (!Array.isArray(records)) throw new DemoStorageError('迁移数据必须是记录数组')
  const seen = new Set<string>()
  records.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new DemoStorageError(`迁移第 ${index + 1} 条记录不是记录对象`)
    }
    const id = (entry as Record<string, unknown>).id
    if (typeof id !== 'string' || id === '') {
      throw new DemoStorageError(`迁移第 ${index + 1} 条记录缺少有效 ID；迁移导入不会自动生成 ID`)
    }
    if (seen.has(id)) {
      throw new DemoStorageError(`迁移第 ${index + 1} 条记录 ID 与前面重复（${id}）；已拒绝写入以避免覆盖`)
    }
    seen.add(id)
  })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new DemoStorageError('IndexedDB 请求失败：' + String(request.error?.message ?? request.error)))
  })
}

function idbTransactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new DemoStorageError('IndexedDB 事务失败：' + String(tx.error?.message ?? tx.error)))
    tx.onabort = () => reject(new DemoStorageError('IndexedDB 事务被中止，本次改动已整体回滚：' + String(tx.error?.message ?? '未知原因')))
  })
}

function idbOpen(name: string, factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    let settled = false
    const fail = (cause: unknown) => {
      if (settled) return
      settled = true
      reject(new DemoStorageError('IndexedDB 数据库打开失败：' + String(cause instanceof Error ? cause.message : cause)))
    }
    try {
      request = factory.open(name, IDB_VERSION)
    } catch (cause) {
      fail(cause)
      return
    }
    request.onupgradeneeded = () => {
      try {
        const db = request.result
        if (!db.objectStoreNames.contains(IDB_RECORDS_STORE)) {
          const store = db.createObjectStore(IDB_RECORDS_STORE, { keyPath: 'id' })
          store.createIndex('by_date', 'date')
          store.createIndex('by_type_date', ['type', 'date'])
        }
        if (!db.objectStoreNames.contains(IDB_META_STORE)) {
          db.createObjectStore(IDB_META_STORE, { keyPath: 'key' })
        }
      } catch (cause) {
        fail(cause)
        try { request.transaction?.abort() } catch { /* open request will settle */ }
      }
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => fail(request.error ?? '未知错误')
    request.onblocked = () => fail(new Error('数据库被其他标签页占用，请关闭其他本应用窗口后重试。'))
  })
}

function validateBackup(backup: unknown): LifeRecord[] {
  if (!backup || typeof backup !== 'object') throw new DemoStorageError('备份文件格式无效')
  const input = backup as Record<string, unknown>
  if (input.schema !== BACKUP_SCHEMA) throw new DemoStorageError('这不是本应用导出的备份文件')
  if (input.version !== BACKUP_VERSION) throw new DemoStorageError('备份版本不受支持，请使用当前版本导出的备份')
  if (!Array.isArray(input.records)) throw new DemoStorageError('备份中的记录列表无效')
  const seen = new Set<string>()
  return input.records.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new DemoStorageError(`备份第 ${index + 1} 条记录无效`)
    const raw = entry as Record<string, unknown>
    const id = typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID()
    if (seen.has(id)) throw new DemoStorageError(`备份中存在重复的记录 ID（第 ${index + 1} 条），已拒绝恢复以避免覆盖`)
    seen.add(id)
    if (!validLifeDate(raw.date)) throw new DemoStorageError(`备份第 ${index + 1} 条记录的日期无效`)
    const draft = normalizeLifeRecord(raw, raw.date)
    return {
      ...draft,
      id,
      sourceText: typeof raw.sourceText === 'string' ? raw.sourceText : '',
      ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
    }
  })
}

/**
 * IndexedDB Adapter v1 — independent implementation of LifeRecordStorage.
 * NOT wired into the page yet: the production flow still uses localStorage.
 * The database opens lazily on the first call, never at import time.
 * Data-integrity note: JSON-level corruption does not exist in IndexedDB; this
 * adapter surfaces open/transaction failures as explicit errors instead of
 * pretending the store is healthy. Structural health checks belong to a future
 * getMigrationStatus(), deliberately outside this interface.
 */
export function createIndexedDBAdapter(options: IndexedDBAdapterOptions = {}): MigrationCapableStorage {
  const databaseName = options.databaseName ?? IDB_DEFAULT_DATABASE
  const factory = options.indexedDBFactory ?? (globalThis.indexedDB as IDBFactory | undefined)
  const createRecordId = options.createRecordId ?? (() => crypto.randomUUID())
  let cached: Promise<IDBDatabase> | null = null

  function open(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new DemoStorageError('当前环境不支持 IndexedDB，无法使用该存储适配器。'))
    if (cached === null) {
      cached = idbOpen(databaseName, factory).catch(cause => {
        cached = null // allow retrying after a transient failure
        throw cause
      })
    }
    return cached
  }

  return {
    async load() {
      const db = await open()
      const tx = db.transaction(IDB_RECORDS_STORE, 'readonly')
      const records = await idbRequest(tx.objectStore(IDB_RECORDS_STORE).getAll() as IDBRequest<LifeRecord[]>)
      await idbTransactionDone(tx)
      return records.sort((a, b) => b.date.localeCompare(a.date))
    },
    async create(_userId, drafts, sourceText) {
      if (drafts.length === 0) return []
      const db = await open()
      const tx = db.transaction(IDB_RECORDS_STORE, 'readwrite')
      const store = tx.objectStore(IDB_RECORDS_STORE)
      const createdAt = new Date().toISOString()
      const created: LifeRecord[] = []
      try {
        // `add` (not `put`): an ID conflict fails the request, which aborts the
        // whole transaction, so a partial batch can never be committed.
        for (const draft of drafts) {
          const record: LifeRecord = { ...draft, id: createRecordId(), sourceText, createdAt }
          await idbRequest(store.add(record))
          created.push(record)
        }
        await idbTransactionDone(tx)
      } catch (cause) {
        try { tx.abort() } catch { /* already aborted; nothing left to roll back */ }
        throw cause
      }
      return created
    },
    async update(_userId, id, draft) {
      const db = await open()
      const tx = db.transaction(IDB_RECORDS_STORE, 'readwrite')
      const store = tx.objectStore(IDB_RECORDS_STORE)
      try {
        const existing = await idbRequest(store.get(id))
        if (!existing) {
          tx.abort()
          throw new Error('记录不存在')
        }
        // Same id preserved; sourceText/createdAt carried over like localStorage.
        await idbRequest(store.put({
          ...draft,
          id,
          sourceText: existing.sourceText,
          createdAt: existing.createdAt,
          sourceRef: draft.sourceRef ?? existing.sourceRef,
          attachments: draft.attachments ?? existing.attachments,
        }))
        await idbTransactionDone(tx)
      } catch (cause) {
        if (cause instanceof Error && cause.message === '记录不存在') throw cause
        try { tx.abort() } catch { /* nothing to roll back */ }
        throw cause
      }
    },
    async remove(_userId, id) {
      const db = await open()
      const tx = db.transaction(IDB_RECORDS_STORE, 'readwrite')
      const store = tx.objectStore(IDB_RECORDS_STORE)
      try {
        const existing = await idbRequest(store.get(id))
        if (!existing) {
          tx.abort()
          throw new Error('记录不存在')
        }
        await idbRequest(store.delete(id))
        await idbTransactionDone(tx)
      } catch (cause) {
        if (cause instanceof Error && cause.message === '记录不存在') throw cause
        try { tx.abort() } catch { /* nothing to roll back */ }
        throw cause
      }
    },
    /**
     * IndexedDB has no "corrupted JSON" state. Explicit open/transaction errors
     * are thrown to the caller instead of silently reporting a healthy store.
     */
    async isLocalDataCorrupted() {
      await open()
      return false
    },
    async exportBackup(): Promise<DemoBackup> {
      const db = await open()
      const tx = db.transaction(IDB_RECORDS_STORE, 'readonly')
      const records = await idbRequest(tx.objectStore(IDB_RECORDS_STORE).getAll() as IDBRequest<LifeRecord[]>)
      await idbTransactionDone(tx)
      return {
        schema: BACKUP_SCHEMA,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        records: records.sort((a, b) => b.date.localeCompare(a.date)),
      }
    },
    async restoreBackup(_userId, backup) {
      // Full validation happens BEFORE any write: an invalid backup can never
      // touch the existing store. The restore itself is one transaction —
      // either the complete backup replaces the store or nothing changes.
      const restored = validateBackup(backup)
      const db = await open()
      const tx = db.transaction(IDB_RECORDS_STORE, 'readwrite')
      const store = tx.objectStore(IDB_RECORDS_STORE)
      try {
        await idbRequest(store.clear())
        for (const record of restored) {
          await idbRequest(store.add(record))
        }
        await idbTransactionDone(tx)
      } catch (cause) {
        try { tx.abort() } catch { /* already aborted: original data intact */ }
        throw cause
      }
      return restored.length
    },

    async importRawRecordsForMigration(records) {
      // 结构预检发生在任何数据库操作之前：非法输入不会接触目标库。
      checkMigrationRecords(records)
      const db = await open()
      const tx = db.transaction(IDB_RECORDS_STORE, 'readwrite')
      const store = tx.objectStore(IDB_RECORDS_STORE)
      try {
        // 判空与写入在同一个 readwrite 事务内，其他事务无法在两者之间插入记录。
        // 目标非空时直接 abort，因此不会发生任何写入。
        const existingCount = await idbRequest(store.count())
        if (existingCount > 0) {
          tx.abort()
          throw new MigrationTargetNotEmptyError(existingCount)
        }
        // `add`（非 `put`）：与 keyPath 'id' 冲突即失败并中止整个事务，
        // 因此不可能覆盖已有记录，也不可能只提交一部分。
        for (const record of records) {
          await idbRequest(store.add(record))
        }
        await idbTransactionDone(tx)
      } catch (cause) {
        if (cause instanceof MigrationTargetNotEmptyError) throw cause
        try { tx.abort() } catch { /* already aborted: nothing left to roll back */ }
        throw cause
      }
      return { written: records.length }
    },
    async readMigrationState() {
      const db = await open()
      const tx = db.transaction(IDB_META_STORE, 'readonly')
      const record = await idbRequest(tx.objectStore(IDB_META_STORE).get(MIGRATION_META_KEY) as IDBRequest<unknown>)
      await idbTransactionDone(tx)
      return record ?? null
    },
    async writeMigrationState(state) {
      const db = await open()
      const tx = db.transaction(IDB_META_STORE, 'readwrite')
      try {
        await idbRequest(tx.objectStore(IDB_META_STORE).put(state))
        await idbTransactionDone(tx)
      } catch (cause) {
        try { tx.abort() } catch { /* already aborted */ }
        throw cause
      }
    },
  }
}
