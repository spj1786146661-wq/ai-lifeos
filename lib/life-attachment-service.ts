import {
  AttachmentStorageError,
  attachmentRef,
  collectReferencedAttachmentIds,
  type AttachmentBackupV1,
  type AttachmentStorage,
} from './life-attachments.ts'
import {
  normalizeLifeRecord,
  toPersistedLifeRecordDraft,
  type LifeRecord,
  type LifeRecordAttachmentRef,
  type LifeRecordDraft,
} from './life-records.ts'
import type { DuplicateReviewMatch } from './life-duplicate-review.ts'
import type { ReviewLifeRecordDraft } from './life-record-duplicates.ts'

export interface AttachmentRecordStorage {
  load(userId: string | null): Promise<LifeRecord[]>
  create(userId: string | null, drafts: LifeRecordDraft[], sourceText: string): Promise<LifeRecord[]>
  update(userId: string | null, id: string, draft: LifeRecordDraft): Promise<void>
  remove(userId: string | null, id: string): Promise<void>
  restoreBackup(userId: string | null, backup: unknown): Promise<number>
}

export interface AttachmentBackupExport {
  records: LifeRecord[]
  attachments: AttachmentBackupV1 | null
}

export interface AttachmentBatchSaveResult {
  records: LifeRecord[]
  createdCount: number
  skippedCount: number
  /** Indexes in the supplied review batch that were skipped as duplicates. */
  skippedIndexes: number[]
  /** Saved records which matched skipped candidates, for explicit user review. */
  duplicateMatches: DuplicateReviewMatch[]
  /** True only when files were requested and attached to a newly saved target. */
  attachmentSaved: boolean
}

export interface RestoreBackupWithAttachmentsOptions {
  recordStorage: AttachmentRecordStorage
  attachmentStorage: AttachmentStorage
  userId: string | null
  backup: unknown
  /** Records must be validated before any attachment payload is written. */
  validateRecords: (backup: unknown) => void
}

/**
 * Validate the record backup first, then attachments, then write records.
 *
 * A corrupt record backup is rejected before the attachment store is touched,
 * so a failed restore can never leave unreferenced images behind.
 */
export async function restoreBackupWithAttachments(options: RestoreBackupWithAttachmentsOptions): Promise<number> {
  options.validateRecords(options.backup)
  const attachmentBackup = attachmentBackupFrom(options.backup)
  const referencedIds = new Set(referencedIdsInBackup(options.backup))
  if (referencedIds.size === 0) return options.recordStorage.restoreBackup(options.userId, options.backup)
  if (!attachmentBackup) {
    throw new AttachmentStorageError('备份包含图片附件引用，但缺少附件数据，已拒绝恢复')
  }
  await options.attachmentStorage.restoreBackup(attachmentBackup)
  return options.recordStorage.restoreBackup(options.userId, options.backup)
}

/** Attachment ids referenced by a record backup; exported from the store module. */
function referencedIdsInBackup(backup: unknown): string[] {
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

/**
 * Save images first, then save records. If the record write fails, only the
 * attachments created by this call are removed; images already referenced by
 * another record are never deleted.
 */
export async function saveRecordsWithAttachments(options: {
  recordStorage: AttachmentRecordStorage
  attachmentStorage: AttachmentStorage
  userId: string | null
  drafts: LifeRecordDraft[]
  sourceText: string
  files: readonly File[]
  existingRecords: readonly LifeRecord[]
  /**
   * Index of the draft the images belong to. `null` means "not attached yet",
   * so files are kept untouched instead of being spread across every draft.
   * Without this option the first draft is used, which keeps single-record
   * callers working unchanged.
   */
  attachmentTargetIndex?: number | null
  /**
   * Called after taking the local write lock but immediately before the
   * authoritative record write. The page re-reads its active storage here so
   * two saves in the same tab cannot both pass an old in-memory snapshot.
   */
  beforeWrite?: (drafts: readonly LifeRecordDraft[]) => Promise<void>
}): Promise<LifeRecord[]> {
  const createdAttachmentIds: string[] = []
  try {
    const refs: LifeRecordAttachmentRef[] = []
    for (const file of options.files) {
      const ref = await options.attachmentStorage.save(file)
      refs.push(ref)
      const wasKnown = options.existingRecords.some(record => record.attachments?.some(item => item.id === ref.id))
      if (!wasKnown) createdAttachmentIds.push(ref.id)
    }
    const targetIndex = options.attachmentTargetIndex === undefined ? 0 : options.attachmentTargetIndex
    const attachRefs = (draft: LifeRecordDraft, index: number): LifeRecordDraft => {
      if (!refs.length || index !== targetIndex) return draft
      return { ...draft, attachments: [...(draft.attachments ?? []), ...refs] }
    }
    const drafts = options.drafts.map((draft, index) => toPersistedLifeRecordDraft(
      attachRefs(draft, index),
      draft.date,
    ))
    await options.beforeWrite?.(drafts)
    return await options.recordStorage.create(options.userId, drafts, options.sourceText)
  } catch (cause) {
    const current = await options.recordStorage.load(options.userId).catch(() => options.existingRecords)
    const referenced = collectReferencedAttachmentIds(current)
    for (const id of createdAttachmentIds) {
      await options.attachmentStorage.removeUnreferenced(id, referenced).catch(() => false)
    }
    throw cause
  }
}

/**
 * Persist only drafts not already represented in the authoritative store.
 * The read, duplicate filter and write execute inside the caller's local write
 * guard through beforeWrite, so a stale React snapshot is never the final
 * authority. Explicit `forceNewRecord` drafts remain valid real events.
 */
export async function saveNewRecordsWithAttachments(options: {
  recordStorage: AttachmentRecordStorage
  attachmentStorage: AttachmentStorage
  userId: string | null
  drafts: readonly ReviewLifeRecordDraft[]
  sourceText: string
  files: readonly File[]
  existingRecords: readonly LifeRecord[]
  attachmentTargetIndex?: number | null
  withAuthoritativeWriteLock?: <T>(
    write: (recordStorage: AttachmentRecordStorage) => Promise<T>,
  ) => Promise<T>
}): Promise<AttachmentBatchSaveResult> {
  let result: AttachmentBatchSaveResult = {
    records: [],
    createdCount: 0,
    skippedCount: options.drafts.length,
    skippedIndexes: options.drafts.map((_, index) => index),
    duplicateMatches: [],
    attachmentSaved: false,
  }
  const execute = async (authoritativeStorage: AttachmentRecordStorage = options.recordStorage) => {
    const current = await authoritativeStorage.load(options.userId)
    const { findDuplicateRecord, uniqueReviewDrafts } = await import('./life-record-duplicates.ts')
    const unique = uniqueReviewDrafts(options.drafts, options.sourceText)
    const assessed = unique
      .map(draft => ({
        draft,
        index: options.drafts.findIndex(candidate => candidate === draft),
      }))
      .map(item => ({
        ...item,
        duplicate: findDuplicateRecord(item.draft, current, options.sourceText),
      }))
    const freshWithSources = assessed.filter(item => !item.duplicate)
    const fresh = freshWithSources.map(item => item.draft)
    const freshIndexes = new Set(freshWithSources.map(item => item.index))
    const skippedIndexes = options.drafts
      .map((_, index) => index)
      .filter(index => !freshIndexes.has(index))
    const skippedCount = options.drafts.length - fresh.length
    if (fresh.length === 0) {
      const duplicateMatches = skippedIndexes.flatMap(index => {
        const duplicate = findDuplicateRecord(options.drafts[index], current, options.sourceText)
        return duplicate ? [{ draftIndex: index, existingRecordId: duplicate.id }] : []
      })
      result = {
        records: [],
        createdCount: 0,
        skippedCount,
        skippedIndexes,
        duplicateMatches,
        attachmentSaved: false,
      }
      return
    }
    const originalTarget = options.attachmentTargetIndex
    let mappedTarget: number | null | undefined = originalTarget
    if (originalTarget !== undefined && originalTarget !== null) {
      // The original target index survives duplicate filtering in
      // freshWithSources, so a forced real event still receives its image.
      const matching = freshWithSources.find(item => item.index === originalTarget)
      mappedTarget = matching ? fresh.indexOf(matching.draft) : null
      if (mappedTarget === -1) mappedTarget = null
    }
    // A skipped target must not cause its image to become an unreferenced
    // attachment or move to another record. Pass `null` explicitly; omitting
    // the option means "attach to the first draft" for legacy callers.
    const targetWillSave = mappedTarget !== null
      && mappedTarget !== undefined
      && mappedTarget >= 0
      && mappedTarget < fresh.length
    const files = targetWillSave ? options.files : []
    const created = await saveRecordsWithAttachments({
      recordStorage: authoritativeStorage,
      attachmentStorage: options.attachmentStorage,
      userId: options.userId,
      drafts: fresh,
      sourceText: options.sourceText,
      files,
      existingRecords: current,
      attachmentTargetIndex: targetWillSave ? mappedTarget : null,
    })
    const afterWrite = [...created, ...current]
    const duplicateMatches = skippedIndexes.flatMap(index => {
      const duplicate = findDuplicateRecord(options.drafts[index], afterWrite, options.sourceText)
      return duplicate ? [{ draftIndex: index, existingRecordId: duplicate.id }] : []
    })
    result = {
      records: created,
      createdCount: created.length,
      skippedCount,
      skippedIndexes,
      duplicateMatches,
      attachmentSaved: files.length > 0 && targetWillSave,
    }
  }
  if (options.withAuthoritativeWriteLock) await options.withAuthoritativeWriteLock(execute)
  else await execute()
  return result
}

/** Deleting a record only removes attachments that no remaining record references. */
export async function removeRecordAndUnusedAttachments(options: {
  recordStorage: AttachmentRecordStorage
  attachmentStorage: AttachmentStorage
  userId: string | null
  id: string
}) {
  const before = await options.recordStorage.load(options.userId)
  const target = before.find(record => record.id === options.id)
  if (!target) throw new Error('记录不存在')
  await options.recordStorage.remove(options.userId, options.id)
  const after = await options.recordStorage.load(options.userId)
  const referenced = collectReferencedAttachmentIds(after)
  for (const attachment of target.attachments ?? []) {
    await options.attachmentStorage.removeUnreferenced(attachment.id, referenced)
  }
}

/**
 * Attach images to an already saved record after an explicit user choice.
 * The record is re-read inside the caller's authoritative write lock, so a
 * stale page snapshot cannot attach the image to a deleted or replaced record.
 */
export async function attachFilesToExistingRecord(options: {
  recordStorage: AttachmentRecordStorage
  attachmentStorage: AttachmentStorage
  userId: string | null
  recordId: string
  files: readonly File[]
  withAuthoritativeWriteLock?: <T>(
    write: (recordStorage: AttachmentRecordStorage) => Promise<T>,
  ) => Promise<T>
}): Promise<LifeRecord> {
  let result: LifeRecord | null = null
  const createdAttachmentIds: string[] = []
  const execute = async (authoritativeStorage: AttachmentRecordStorage = options.recordStorage) => {
    const current = await authoritativeStorage.load(options.userId)
    const target = current.find(record => record.id === options.recordId)
    if (!target) throw new Error('要关联的已保存记录不存在，请刷新后重试')
    const refs: LifeRecordAttachmentRef[] = []
    for (const file of options.files) {
      const ref = await options.attachmentStorage.save(file)
      refs.push(ref)
      const wasKnown = current.some(record => record.attachments?.some(item => item.id === ref.id))
      if (!wasKnown) createdAttachmentIds.push(ref.id)
    }
    const merged = new Map((target.attachments ?? []).map(item => [item.id, item]))
    for (const ref of refs) merged.set(ref.id, ref)
    const draft: LifeRecordDraft = { ...target, attachments: [...merged.values()] }
    await authoritativeStorage.update(options.userId, target.id, draft)
    result = { ...target, ...draft, id: target.id, sourceText: target.sourceText, createdAt: target.createdAt }
  }
  try {
    if (options.withAuthoritativeWriteLock) await options.withAuthoritativeWriteLock(execute)
    else await execute()
  } catch (cause) {
    const current = await options.recordStorage.load(options.userId).catch(() => [])
    const referenced = collectReferencedAttachmentIds(current)
    for (const id of createdAttachmentIds) {
      await options.attachmentStorage.removeUnreferenced(id, referenced).catch(() => false)
    }
    throw cause
  }
  if (!result) throw new Error('图片关联未完成')
  return result
}

export function withAttachmentBackup<T extends object>(backup: T, attachments: AttachmentBackupV1): T & { attachmentBackup: AttachmentBackupV1 } {
  return { ...backup, attachmentBackup: attachments }
}

export function attachmentBackupFrom(value: unknown): AttachmentBackupV1 | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as Record<string, unknown>).attachmentBackup
  return candidate && typeof candidate === 'object' ? candidate as AttachmentBackupV1 : null
}

export function normalizeDraftsForSave(drafts: readonly LifeRecordDraft[], fallbackDate: string): LifeRecordDraft[] {
  return drafts.map(draft => {
    const normalized = normalizeLifeRecord(draft, fallbackDate)
    return toPersistedLifeRecordDraft(normalized, fallbackDate)
  })
}

export function attachmentErrorText(cause: unknown): string {
  if (cause instanceof AttachmentStorageError) return cause.message
  return cause instanceof Error ? cause.message : '图片处理失败'
}

export function attachmentRefFromStored(value: Parameters<typeof attachmentRef>[0]) {
  return attachmentRef(value)
}
