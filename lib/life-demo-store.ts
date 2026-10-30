import { normalizeLifeRecord, validLifeDate, type LifeRecord, type LifeRecordDraft } from './life-records.ts'

export const DEMO_STORAGE_KEY = 'life-tracker:life-records:demo:v1'
export const BACKUP_SCHEMA = 'life-tracker.life-records-backup'
export const BACKUP_VERSION = 1

export interface LifeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Raised instead of silently dropping or overwriting local records. */
export class DemoStorageError extends Error {}

interface RawStorageRead {
  records: LifeRecord[]
  /** Original unparsable string, kept untouched so it can be recovered. */
  corruptedRaw: string | null
}

function readRawStorage(storage: LifeStorage): RawStorageRead {
  const raw = storage.getItem(DEMO_STORAGE_KEY)
  if (raw === null || raw === '') return { records: [], corruptedRaw: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { records: [], corruptedRaw: raw }
    return { records: parsed as LifeRecord[], corruptedRaw: null }
  } catch { return { records: [], corruptedRaw: raw } }
}

export function isDemoStorageCorrupted(storage: LifeStorage): boolean {
  return readRawStorage(storage).corruptedRaw !== null
}

/** Normal reads keep returning records (empty when corrupted) so the UI still works. */
export function readDemoRecords(storage: LifeStorage): LifeRecord[] {
  return readRawStorage(storage).records
}

function requireWritableStorage(storage: LifeStorage): RawStorageRead {
  const read = readRawStorage(storage)
  if (read.corruptedRaw !== null) {
    throw new DemoStorageError('检测到无法解析的本地记录数据，已停止写入以保护原始数据。请先在「我的」页导出备份或导入有效备份恢复。')
  }
  return read
}

function writeRecords(storage: LifeStorage, records: LifeRecord[]) {
  try { storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(records)) }
  catch {
    // setItem failed, so the previous value is still intact in storage.
    throw new DemoStorageError('浏览器存储空间不足，保存未完成，原有记录未受影响。请先导出备份并清理浏览器空间后重试。')
  }
}

export function addDemoRecords(storage: LifeStorage, drafts: LifeRecordDraft[], sourceText: string): LifeRecord[] {
  requireWritableStorage(storage)
  const created = drafts.map(draft => ({
    ...draft, id: crypto.randomUUID(), sourceText, createdAt: new Date().toISOString(),
  }))
  writeRecords(storage, [...created, ...readDemoRecords(storage)])
  return created
}

export function updateDemoRecord(storage: LifeStorage, id: string, draft: LifeRecordDraft) {
  requireWritableStorage(storage)
  const records = readDemoRecords(storage)
  if (!records.some(record => record.id === id)) throw new Error('记录不存在')
  writeRecords(storage, records.map(record => record.id === id ? {
    ...draft,
    id,
    sourceText: record.sourceText,
    createdAt: record.createdAt,
    sourceRef: draft.sourceRef ?? record.sourceRef,
    attachments: draft.attachments ?? record.attachments,
  } : record))
}

export function deleteDemoRecord(storage: LifeStorage, id: string) {
  requireWritableStorage(storage)
  writeRecords(storage, readDemoRecords(storage).filter(record => record.id !== id))
}

export interface DemoBackup {
  schema: typeof BACKUP_SCHEMA
  version: typeof BACKUP_VERSION
  exportedAt: string
  records: LifeRecord[]
  /** Present only when storage held unparsable data; keeps it recoverable. */
  corruptedRaw?: string
}

export function exportDemoBackup(storage: LifeStorage): DemoBackup {
  const { records, corruptedRaw } = readRawStorage(storage)
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    records,
    ...(corruptedRaw === null ? {} : { corruptedRaw }),
  }
}

export function restoreDemoBackup(storage: LifeStorage, backup: unknown): number {
  if (!backup || typeof backup !== 'object') throw new DemoStorageError('备份文件格式无效')
  const input = backup as Record<string, unknown>
  if (input.schema !== BACKUP_SCHEMA) throw new DemoStorageError('这不是本应用导出的备份文件')
  if (input.version !== BACKUP_VERSION) throw new DemoStorageError('备份版本不受支持，请使用当前版本导出的备份')
  if (!Array.isArray(input.records)) throw new DemoStorageError('备份中的记录列表无效')
  const restored: LifeRecord[] = input.records.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new DemoStorageError(`备份第 ${index + 1} 条记录无效`)
    const raw = entry as Record<string, unknown>
    if (!validLifeDate(raw.date)) throw new DemoStorageError(`备份第 ${index + 1} 条记录的日期无效`)
    const draft = normalizeLifeRecord(raw, raw.date)
    return {
      ...draft,
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      sourceText: typeof raw.sourceText === 'string' ? raw.sourceText : '',
      ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
    }
  })
  writeRecords(storage, restored)
  return restored.length
}
