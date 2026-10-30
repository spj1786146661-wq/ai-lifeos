import {
  collectReferencedAttachmentIds,
  type AttachmentStorage,
} from './life-attachments.ts'
import type { LifeRecord, LifeRecordType } from './life-records.ts'
import type { LifeRecordStorage } from './storage-adapter.ts'

export type BulkDeleteScope =
  | { kind: 'selected'; ids: readonly string[] }
  | { kind: 'day'; date: string; ids: readonly string[] }
  | { kind: 'all'; ids: readonly string[] }

export interface BulkDeleteSnapshot {
  scope: BulkDeleteScope['kind']
  ids: string[]
  recordCount: number
  dateCount: number
  /** Frozen day shown in the confirmation UI for a day-scoped delete. */
  date?: string
  typeCounts: Partial<Record<LifeRecordType, number>>
}

export interface BulkDeleteFailure {
  id: string
  message: string
}

export interface BulkDeleteOutcome {
  requestedIds: string[]
  deletedIds: string[]
  missingIds: string[]
  failedIds: string[]
  failures: BulkDeleteFailure[]
  /** Record removal succeeded, but unreferenced attachment cleanup reported an error. */
  attachmentCleanupErrors: BulkDeleteFailure[]
  attachmentCleanupFailedIds: string[]
  remainingCount: number
}

/**
 * Freeze the user-visible confirmation scope into record IDs. The execution
 * path never recalculates "all" or "today" from newer state, so a repeated
 * confirmation cannot expand beyond what the user reviewed.
 */
export function bulkDeleteSnapshot(
  records: readonly LifeRecord[],
  scope: Pick<BulkDeleteScope, 'kind'> & {
    ids?: readonly string[]
    date?: string
  },
): BulkDeleteSnapshot {
  const requested = new Set(scope.ids ?? [])
  const targets = records.filter(record => {
    if (scope.kind === 'all') return true
    if (scope.kind === 'day') return record.date === scope.date
    return requested.has(record.id)
  })
  const ids = [...new Set(targets.map(record => record.id))]
  const typeCounts: Partial<Record<LifeRecordType, number>> = {}
  for (const record of targets) {
    typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1
  }
  return {
    scope: scope.kind,
    ids,
    recordCount: ids.length,
    dateCount: new Set(targets.map(record => record.date)).size,
    ...(scope.kind === 'day' && typeof scope.date === 'string' ? { date: scope.date } : {}),
    typeCounts,
  }
}

/**
 * Delete a frozen set of IDs through the authoritative storage route.
 *
 * A storage interface without native batch transactions cannot promise an
 * all-or-nothing delete. This function therefore reports the final state
 * accurately instead of claiming every record disappeared when only some did.
 * Each record is removed through the same attachment-reference safety rule as
 * a single delete; shared images remain until their last reference is gone.
 */
export async function deleteRecordsByIds(options: {
  recordStorage: LifeRecordStorage
  attachmentStorage: AttachmentStorage
  userId: string | null
  ids: readonly string[]
  withAuthoritativeWriteLock?: <T>(
    write: (recordStorage: LifeRecordStorage) => Promise<T>,
  ) => Promise<T>
}): Promise<BulkDeleteOutcome> {
  const requestedIds = [...new Set(options.ids.filter(id => typeof id === 'string' && id !== ''))]
  if (requestedIds.length === 0) {
    const current = await options.recordStorage.load(options.userId)
    return {
      requestedIds: [],
      deletedIds: [],
      missingIds: [],
      failedIds: [],
      failures: [],
      attachmentCleanupErrors: [],
      attachmentCleanupFailedIds: [],
      remainingCount: current.length,
    }
  }

  const execute = async (storage: LifeRecordStorage): Promise<BulkDeleteOutcome> => {
    const before = await storage.load(options.userId)
    const presentBefore = new Set(before.map(record => record.id))
    const missingIds = requestedIds.filter(id => !presentBefore.has(id))
    const attemptedIds = requestedIds.filter(id => presentBefore.has(id))
    const targetsById = new Map(before.map(record => [record.id, record]))
    const failures: BulkDeleteFailure[] = []
    const attachmentCleanupErrors: BulkDeleteFailure[] = []

    for (const id of attemptedIds) {
      const target = targetsById.get(id)
      if (!target) continue
      try {
        await storage.remove(options.userId, id)
      } catch (cause) {
        failures.push({
          id,
          message: cause instanceof Error ? cause.message : '记录删除失败',
        })
        continue
      }

      // The record write has committed. Attachment cleanup is a separate,
      // non-authoritative step; its failure must not hide the deletion.
      try {
        const after = await storage.load(options.userId)
        const referenced = collectReferencedAttachmentIds(after)
        for (const attachment of target.attachments ?? []) {
          await options.attachmentStorage.removeUnreferenced(attachment.id, referenced)
        }
      } catch (cause) {
        attachmentCleanupErrors.push({
          id,
          message: `记录已删除，但图片清理失败：${cause instanceof Error ? cause.message : '未知错误'}`,
        })
      }
    }

    const after = await storage.load(options.userId)
    const remaining = new Set(after.map(record => record.id))
    const deletedIds = attemptedIds.filter(id => !remaining.has(id))
    const failedIds = attemptedIds.filter(id => remaining.has(id))
    const attachmentCleanupFailedIds = attachmentCleanupErrors.map(failure => failure.id)
    return {
      requestedIds,
      deletedIds,
      missingIds,
      failedIds,
      failures,
      attachmentCleanupErrors,
      attachmentCleanupFailedIds,
      remainingCount: after.length,
    }
  }

  if (options.withAuthoritativeWriteLock) {
    return options.withAuthoritativeWriteLock(execute)
  }
  return execute(options.recordStorage)
}

export function bulkDeleteOutcomeMessage(outcome: BulkDeleteOutcome): string {
  const parts = [`已删除 ${outcome.deletedIds.length} 条`]
  if (outcome.missingIds.length) parts.push(`${outcome.missingIds.length} 条已不存在`)
  if (outcome.failedIds.length) parts.push(`${outcome.failedIds.length} 条删除失败`)
  if (outcome.attachmentCleanupFailedIds.length) {
    parts.push(`${outcome.attachmentCleanupFailedIds.length} 条图片清理失败`)
  }
  parts.push(`剩余 ${outcome.remainingCount} 条`)
  return `${parts.join('，')}。`
}
