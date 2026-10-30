import type { LifeRecordAttachmentRef } from './life-records.ts'

export const ATTACHMENT_SCHEMA = 'ai-lifeos.attachment'
export const ATTACHMENT_BACKUP_SCHEMA = 'ai-lifeos.attachments-backup'
export const ATTACHMENT_BACKUP_VERSION = 1
export const ATTACHMENT_DB_NAME = 'life-tracker-attachments'
export const ATTACHMENT_STORE_NAME = 'attachments'
export const MAX_ATTACHMENT_BYTES = 5_000_000
export const ALLOWED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export class AttachmentStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentStorageError'
  }
}

export interface StoredAttachment {
  schema: typeof ATTACHMENT_SCHEMA
  version: 1
  id: string
  name: string
  mimeType: string
  size: number
  sha256: string
  blob: Blob
  createdAt: string
}

export interface AttachmentBackupEntry {
  id: string
  name: string
  mimeType: string
  size: number
  sha256: string
  createdAt: string
  dataUrl: string
}

export interface AttachmentBackupV1 {
  schema: typeof ATTACHMENT_BACKUP_SCHEMA
  version: typeof ATTACHMENT_BACKUP_VERSION
  exportedAt: string
  attachments: AttachmentBackupEntry[]
}

export interface AttachmentStorage {
  save(file: File): Promise<LifeRecordAttachmentRef>
  load(id: string): Promise<StoredAttachment | null>
  removeUnreferenced(id: string, referencedIds: ReadonlySet<string>): Promise<boolean>
  exportBackup(ids: readonly string[]): Promise<AttachmentBackupV1>
  restoreBackup(backup: unknown): Promise<number>
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function validateAttachmentFile(file: Pick<File, 'name' | 'type' | 'size'>): void {
  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type as typeof ALLOWED_ATTACHMENT_TYPES[number])) {
    throw new AttachmentStorageError('仅支持 JPG、PNG 或 WebP 图片')
  }
  if (file.size <= 0) throw new AttachmentStorageError('图片内容为空')
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentStorageError('图片不能超过 5 MB')
}

export function attachmentTypeFromName(name: string): typeof ALLOWED_ATTACHMENT_TYPES[number] | null {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  return null
}

export async function attachmentSha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

export function attachmentRef(record: StoredAttachment): LifeRecordAttachmentRef {
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    sha256: record.sha256,
  }
}

export function createMemoryAttachmentStorage(): AttachmentStorage {
  const records = new Map<string, StoredAttachment>()
  return {
    async save(file) {
      validateAttachmentFile(file)
      const sha256 = await attachmentSha256(file)
      const existing = [...records.values()].find(record => record.sha256 === sha256 && record.size === file.size)
      if (existing) return attachmentRef(existing)
      const stored: StoredAttachment = {
        schema: ATTACHMENT_SCHEMA,
        version: 1,
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        sha256,
        blob: file,
        createdAt: new Date().toISOString(),
      }
      records.set(stored.id, stored)
      return attachmentRef(stored)
    },
    async load(id) {
      return records.get(id) ?? null
    },
    async removeUnreferenced(id, referencedIds) {
      if (referencedIds.has(id)) return false
      return records.delete(id)
    },
    async exportBackup(ids) {
      const selected: AttachmentBackupEntry[] = []
      for (const id of ids) {
        const record = records.get(id)
        if (!record) throw new AttachmentStorageError(`附件不存在：${id}`)
        selected.push({
          id: record.id,
          name: record.name,
          mimeType: record.mimeType,
          size: record.size,
          sha256: record.sha256,
          createdAt: record.createdAt,
          dataUrl: `data:${record.mimeType};base64,${bytesToBase64(new Uint8Array(await record.blob.arrayBuffer()))}`,
        })
      }
      return {
        schema: ATTACHMENT_BACKUP_SCHEMA,
        version: ATTACHMENT_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        attachments: selected,
      }
    },
    async restoreBackup(backup) {
      const validated = await validateAttachmentBackup(backup)
      for (const entry of validated) {
        const existing = records.get(entry.id)
        if (existing) {
          if (existing.sha256 !== entry.sha256) throw new AttachmentStorageError(`附件 ID 冲突：${entry.id}`)
          continue
        }
        records.set(entry.id, entry)
      }
      return validated.length
    },
  }
}

export async function validateAttachmentBackup(backup: unknown): Promise<StoredAttachment[]> {
  if (!backup || typeof backup !== 'object') throw new AttachmentStorageError('附件备份格式无效')
  const input = backup as Record<string, unknown>
  if (input.schema !== ATTACHMENT_BACKUP_SCHEMA || input.version !== ATTACHMENT_BACKUP_VERSION) {
    throw new AttachmentStorageError('附件备份版本不受支持')
  }
  if (!Array.isArray(input.attachments)) throw new AttachmentStorageError('附件备份列表无效')
  const seen = new Set<string>()
  return Promise.all(input.attachments.map(async (value, index) => {
    if (!value || typeof value !== 'object') throw new AttachmentStorageError(`附件备份第 ${index + 1} 项无效`)
    const entry = value as Record<string, unknown>
    if (
      typeof entry.id !== 'string' || !entry.id
      || typeof entry.name !== 'string'
      || typeof entry.mimeType !== 'string' || !ALLOWED_ATTACHMENT_TYPES.includes(entry.mimeType as typeof ALLOWED_ATTACHMENT_TYPES[number])
      || typeof entry.size !== 'number' || entry.size <= 0 || entry.size > MAX_ATTACHMENT_BYTES
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)
      || typeof entry.createdAt !== 'string'
      || typeof entry.dataUrl !== 'string' || !entry.dataUrl.startsWith(`data:${entry.mimeType};base64,`)
    ) throw new AttachmentStorageError(`附件备份第 ${index + 1} 项字段无效`)
    if (seen.has(entry.id)) throw new AttachmentStorageError(`附件备份存在重复 ID：${entry.id}`)
    seen.add(entry.id)
    const encoded = entry.dataUrl.slice(entry.dataUrl.indexOf(',') + 1)
    let bytes: Uint8Array
    try { bytes = base64ToBytes(encoded) } catch { throw new AttachmentStorageError(`附件备份第 ${index + 1} 项 Base64 无效`) }
    if (bytes.length !== entry.size) throw new AttachmentStorageError(`附件备份第 ${index + 1} 项大小不一致`)
    const blob = new Blob([new Uint8Array(bytes)], { type: entry.mimeType })
    const actualSha256 = await attachmentSha256(blob)
    if (actualSha256 !== entry.sha256.toLowerCase()) throw new AttachmentStorageError(`附件备份第 ${index + 1} 项校验值不一致`)
    return {
      schema: ATTACHMENT_SCHEMA,
      version: 1,
      id: entry.id,
      name: entry.name,
      mimeType: entry.mimeType,
      size: entry.size,
      sha256: entry.sha256.toLowerCase(),
      createdAt: entry.createdAt,
      blob,
    }
  }))
}

export function createIndexedDBAttachmentStorage(options: {
  databaseName?: string
  indexedDBFactory?: IDBFactory
} = {}): AttachmentStorage {
  const databaseName = options.databaseName ?? ATTACHMENT_DB_NAME
  const factory = options.indexedDBFactory ?? (globalThis.indexedDB as IDBFactory | undefined)
  let cached: Promise<IDBDatabase> | null = null

  function open(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new AttachmentStorageError('当前浏览器不支持 IndexedDB，无法保存图片附件'))
    if (cached) return cached
    cached = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try { request = factory.open(databaseName, 1) } catch (cause) { reject(cause); return }
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(ATTACHMENT_STORE_NAME)) {
          const store = db.createObjectStore(ATTACHMENT_STORE_NAME, { keyPath: 'id' })
          store.createIndex('by_sha256', 'sha256')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new AttachmentStorageError(`附件数据库打开失败：${String(request.error?.message ?? request.error)}`))
      request.onblocked = () => reject(new AttachmentStorageError('附件数据库被其他页面占用，请关闭其他标签页后重试'))
    }).catch(cause => {
      cached = null
      throw cause
    })
    return cached as Promise<IDBDatabase>
  }

  function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new AttachmentStorageError(`附件存储请求失败：${String(request.error?.message ?? request.error)}`))
    })
  }

  function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(new AttachmentStorageError(`附件事务失败：${String(tx.error?.message ?? tx.error)}`))
      tx.onabort = () => reject(new AttachmentStorageError('附件事务已回滚'))
    })
  }

  return {
    async save(file) {
      validateAttachmentFile(file)
      const sha256 = await attachmentSha256(file)
      const db = await open()
      const existingTx = db.transaction(ATTACHMENT_STORE_NAME, 'readonly')
      const existing = await requestResult(existingTx.objectStore(ATTACHMENT_STORE_NAME).index('by_sha256').get(sha256) as IDBRequest<StoredAttachment | undefined>)
      await transactionDone(existingTx)
      if (existing) return attachmentRef(existing)
      const stored: StoredAttachment = {
        schema: ATTACHMENT_SCHEMA,
        version: 1,
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        sha256,
        blob: file,
        createdAt: new Date().toISOString(),
      }
      const tx = db.transaction(ATTACHMENT_STORE_NAME, 'readwrite')
      await requestResult(tx.objectStore(ATTACHMENT_STORE_NAME).add(stored))
      await transactionDone(tx)
      return attachmentRef(stored)
    },
    async load(id) {
      const db = await open()
      const tx = db.transaction(ATTACHMENT_STORE_NAME, 'readonly')
      const record = await requestResult(tx.objectStore(ATTACHMENT_STORE_NAME).get(id) as IDBRequest<StoredAttachment | undefined>)
      await transactionDone(tx)
      return record ?? null
    },
    async removeUnreferenced(id, referencedIds) {
      if (referencedIds.has(id)) return false
      const db = await open()
      const tx = db.transaction(ATTACHMENT_STORE_NAME, 'readwrite')
      await requestResult(tx.objectStore(ATTACHMENT_STORE_NAME).delete(id))
      await transactionDone(tx)
      return true
    },
    async exportBackup(ids) {
      const selected: AttachmentBackupEntry[] = []
      for (const id of [...new Set(ids)]) {
        const record = await this.load(id)
        if (!record) throw new AttachmentStorageError(`附件不存在：${id}`)
        selected.push({
          id: record.id,
          name: record.name,
          mimeType: record.mimeType,
          size: record.size,
          sha256: record.sha256,
          createdAt: record.createdAt,
          dataUrl: `data:${record.mimeType};base64,${bytesToBase64(new Uint8Array(await record.blob.arrayBuffer()))}`,
        })
      }
      return { schema: ATTACHMENT_BACKUP_SCHEMA, version: ATTACHMENT_BACKUP_VERSION, exportedAt: new Date().toISOString(), attachments: selected }
    },
    async restoreBackup(backup) {
      const records = await validateAttachmentBackup(backup)
      const db = await open()
      const tx = db.transaction(ATTACHMENT_STORE_NAME, 'readwrite')
      try {
        for (const record of records) {
          const existing = await requestResult(tx.objectStore(ATTACHMENT_STORE_NAME).get(record.id) as IDBRequest<StoredAttachment | undefined>)
          if (existing && existing.sha256 !== record.sha256) throw new AttachmentStorageError(`附件 ID 冲突：${record.id}`)
          if (!existing) await requestResult(tx.objectStore(ATTACHMENT_STORE_NAME).add(record))
        }
        await transactionDone(tx)
      } catch (cause) {
        try { tx.abort() } catch { /* already aborted */ }
        throw cause
      }
      return records.length
    },
  }
}

export function collectReferencedAttachmentIds(records: readonly { attachments?: readonly { id: string }[] }[]): Set<string> {
  return new Set(records.flatMap(record => record.attachments?.map(attachment => attachment.id) ?? []))
}

export function mergeAttachmentBackup(backup: unknown, attachments: AttachmentBackupV1) {
  if (!backup || typeof backup !== 'object') throw new AttachmentStorageError('记录备份格式无效')
  return {
    ...(backup as Record<string, unknown>),
    attachmentBackup: attachments,
  }
}

export function extractAttachmentBackup(backup: unknown): unknown | null {
  if (!backup || typeof backup !== 'object') return null
  return (backup as Record<string, unknown>).attachmentBackup ?? null
}

export function referencedIdsFromBackup(backup: unknown): string[] {
  if (!backup || typeof backup !== 'object') return []
  const records = (backup as Record<string, unknown>).records
  if (!Array.isArray(records)) return []
  const ids = new Set<string>()
  for (const value of records) {
    if (!value || typeof value !== 'object') continue
    const attachments = (value as Record<string, unknown>).attachments
    if (!Array.isArray(attachments)) continue
    for (const item of attachments) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string') {
        ids.add((item as Record<string, unknown>).id as string)
      }
    }
  }
  return [...ids]
}

export function objectUrlForAttachment(record: StoredAttachment): string {
  return URL.createObjectURL(record.blob)
}

export function revokeObjectUrl(url: string | null) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}
