'use client'

import { collection, deleteField, doc } from 'firebase/firestore'
import { db, deleteDocument, getBatch, queryDocuments, serverTimestamp, updateDocument, where } from '@/lib/firebase/db'
import { DemoStorageError } from '@/lib/life-demo-store'
import { createLocalStorageAdapter, type LifeRecordStorage } from '@/lib/storage-adapter'
import { createIndexedDBAdapter } from '@/lib/indexeddb-adapter'
import { createRoutedLocalAdapter, hasIndexedDBSupport, resolveLocalStoreRoute, runGuardedLocalWrite } from '@/lib/life-migration-routing'
import { restoreBackupWithAttachments as restoreBackupWithAttachmentsService } from '@/lib/life-attachment-service'
import type { LifeRecord } from '@/lib/life-records'
import {
  createIndexedDBAttachmentStorage,
  mergeAttachmentBackup,
  type AttachmentStorage,
} from '@/lib/life-attachments'
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/lib/life-demo-store'

const COLLECTION = 'life_entries'

export function hasFirebaseConfig() {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  return Boolean(project && key && !project.startsWith('your-') && !key.startsWith('your-'))
}

/** Guest/local mode: the existing localStorage safety net, unchanged.
 *  Created lazily because this module also evaluates during SSR. */
let localAdapter: LifeRecordStorage | null = null
function getLocalAdapter(): LifeRecordStorage {
  if (localAdapter === null) localAdapter = createLocalStorageAdapter(localStorage)
  return localAdapter
}

/**
 * 迁移成功后 IndexedDB 才成为未登录本地路径的权威存储。
 * 判据只有持久化迁移状态；IndexedDB 里有数据不代表已启用。
 * 已登录 Firebase 路由在 recordStorage 中优先判断，完全不受影响。
 *
 * 每次读取都重新确认状态，不缓存路由。否则另一个标签页启用 IndexedDB 后，
 * 本标签页仍可能从旧 localStorage 读取或导出过期数据。状态无法读取时直接
 * 报错并停止，不能猜测后回退到 localStorage，否则可能形成两个写入源。
 */
async function getRoutedLocalAdapter(): Promise<LifeRecordStorage> {
  // 没有 IndexedDB 能力时不可能存在已启用的迁移状态，localStorage 是唯一可能
  // 的权威源。这不是猜状态，而是由状态存放位置决定的结论。
  if (!hasIndexedDBSupport()) {
    return createRoutedLocalAdapter(
      { store: 'localStorage', reason: '当前环境不支持 IndexedDB，迁移不可能已启用' },
      getLocalAdapter(),
    )
  }
  const target = createIndexedDBAdapter()
  let rawState: unknown
  try {
    rawState = await target.readMigrationState()
  } catch (cause) {
    throw new Error(
      '无法读取本地数据库迁移状态，已停止访问本地记录以保护数据。'
      + (cause instanceof Error ? `（${cause.message}）` : ''),
    )
  }
  return createRoutedLocalAdapter(resolveLocalStoreRoute(rawState), getLocalAdapter())
}

/**
 * 保留显式调用入口。路由不再缓存，因此下一次读取会自然观察到最新状态。
 */
export function resetLocalStorageRoute() {
  // Intentionally empty: route reads are no longer cached.
}

/**
 * 本地写入统一经过迁移锁和持久化状态检查。
 * 取得锁后重新解析路由，避免另一个标签页启用 IndexedDB 后，
 * 本标签页仍用缓存的 localStorage 适配器继续写入。
 */
async function runLocalWrite<T>(write: (adapter: LifeRecordStorage) => Promise<T>): Promise<T> {
  const target = createIndexedDBAdapter()
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  return runGuardedLocalWrite(locks, () => target.readMigrationState(), async rawState => {
    const route = resolveLocalStoreRoute(rawState)
    const adapter = createRoutedLocalAdapter(route, getLocalAdapter())
    return write(adapter)
  })
}

/** Logged-in mode: Firestore `life_entries`, exactly the previous cloud behaviour. */
const firebaseAdapter: LifeRecordStorage = {
  async load(userId) {
    const docs = await queryDocuments(COLLECTION, [where('userId', '==', userId)])
    return docs.map(doc => ({
      id: doc.id, type: doc.type, date: doc.date, note: doc.note ?? '',
      activity: doc.activity, durationMinutes: doc.durationMinutes, weightKg: doc.weightKg, sets: doc.sets, hours: doc.hours,
      amount: doc.amount, currency: doc.currency, score: doc.score,
      subject: doc.subject, quantity: doc.quantity, unit: doc.unit, food: doc.food,
      sourceRef: doc.sourceRef, attachments: doc.attachments, supplements: doc.supplements,
      sourceText: doc.sourceText ?? '',
    } as LifeRecord)).sort((a, b) => b.date.localeCompare(a.date))
  },
  async create(userId, drafts, sourceText) {
    const batch = getBatch()
    const ids: string[] = []
    for (const draft of drafts) {
      const reference = doc(collection(db(), COLLECTION))
      ids.push(reference.id)
      batch.set(reference, { ...draft, userId, sourceText, createdAt: serverTimestamp() })
    }
    await batch.commit()
    return drafts.map((draft, index) => ({ ...draft, id: ids[index], sourceText }))
  },
  async update(userId, id, draft) {
    // Firestore updateDoc leaves omitted fields untouched. Explicitly delete
    // an old mood score when the user chooses "不评分", otherwise the UI would
    // appear to clear it while the cloud record silently kept the old value.
    await updateDocument(COLLECTION, id, draft.score === undefined
      ? { ...draft, score: deleteField() }
      : draft)
  },
  async remove(userId, id) {
    await deleteDocument(COLLECTION, id)
  },
  async isLocalDataCorrupted() {
    return false
  },
  exportBackup() {
    return Promise.reject(new DemoStorageError('云登录模式下记录保存在 Firestore，请使用 Firebase 控制台导出数据。'))
  },
  async restoreBackup() {
    throw new DemoStorageError('云登录模式不支持本地备份恢复。')
  },
}

/**
 * Same routing the page always had: no logged-in user → localStorage,
 * logged in → Firestore. Future backends only replace this object.
 */
export const recordStorage: LifeRecordStorage = {
  async load(userId) {
    if (userId !== null) return firebaseAdapter.load(userId)
    return (await getRoutedLocalAdapter()).load(null)
  },
  async create(userId, drafts, sourceText) {
    if (userId !== null) return firebaseAdapter.create(userId, drafts, sourceText)
    return runLocalWrite(adapter => adapter.create(null, drafts, sourceText))
  },
  async update(userId, id, draft) {
    if (userId !== null) return firebaseAdapter.update(userId, id, draft)
    return runLocalWrite(adapter => adapter.update(null, id, draft))
  },
  async remove(userId, id) {
    if (userId !== null) return firebaseAdapter.remove(userId, id)
    return runLocalWrite(adapter => adapter.remove(null, id))
  },
  async isLocalDataCorrupted(userId) {
    if (userId !== null) return firebaseAdapter.isLocalDataCorrupted(userId)
    return (await getRoutedLocalAdapter()).isLocalDataCorrupted(null)
  },
  async exportBackup(userId) {
    if (userId !== null) return firebaseAdapter.exportBackup(userId)
    return (await getRoutedLocalAdapter()).exportBackup(null)
  },
  async restoreBackup(userId, backup) {
    if (userId !== null) return firebaseAdapter.restoreBackup(userId, backup)
    return runLocalWrite(adapter => adapter.restoreBackup(null, backup))
  },
}

/**
 * Re-read and write the local records inside the same migration-aware write
 * guard. The caller receives the authoritative adapter only for the duration
 * of the callback. Firestore keeps its existing route.
 */
export async function withRecordWriteLock<T>(
  userId: string | null,
  write: (storage: LifeRecordStorage) => Promise<T>,
): Promise<T> {
  if (userId !== null) return write(firebaseAdapter)
  return runLocalWrite(write)
}

/** Attachment storage is independent from the record authority route. */
let attachmentAdapter: AttachmentStorage | null = null
export function getAttachmentStorage(): AttachmentStorage {
  if (!attachmentAdapter) attachmentAdapter = createIndexedDBAttachmentStorage()
  return attachmentAdapter
}

/**
 * New exports keep the v1 envelope and add a sibling `attachmentBackup`.
 * Old readers continue to see exactly the same required fields.
 */
export async function exportBackupWithAttachments(userId: string | null) {
  if (userId !== null) return recordStorage.exportBackup(userId)
  const backup = await recordStorage.exportBackup(null)
  const ids = [...new Set(backup.records.flatMap(record => record.attachments?.map(item => item.id) ?? []))]
  if (ids.length === 0) return backup
  const attachmentBackup = await getAttachmentStorage().exportBackup(ids)
  return mergeAttachmentBackup(backup, attachmentBackup) as typeof backup & { attachmentBackup: typeof attachmentBackup }
}

/**
 * Restore order: validate the record backup, then write attachments, then write
 * records. A corrupt record backup is rejected before the attachment store is
 * touched, so a failed restore can never leave unreferenced images behind.
 */
export async function restoreBackupWithAttachments(userId: string | null, backup: unknown) {
  if (userId !== null) return recordStorage.restoreBackup(userId, backup)
  return restoreBackupWithAttachmentsService({
    recordStorage,
    attachmentStorage: getAttachmentStorage(),
    userId: null,
    backup,
    validateRecords: validateRecordBackup,
  })
}

/** Record-level validation shared by both local adapters; runs before any write. */
function validateRecordBackup(backup: unknown) {
  if (!backup || typeof backup !== 'object') throw new DemoStorageError('备份文件格式无效')
  const input = backup as Record<string, unknown>
  if (input.schema !== BACKUP_SCHEMA) throw new DemoStorageError('这不是本应用导出的备份文件')
  if (input.version !== BACKUP_VERSION) throw new DemoStorageError('备份版本不受支持，请使用当前版本导出的备份')
  if (!Array.isArray(input.records)) throw new DemoStorageError('备份中的记录列表无效')
}
