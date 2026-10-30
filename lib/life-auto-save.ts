import {
  normalizeLifeRecord,
  toPersistedLifeRecordDraft,
  type LifeRecordDraft,
} from './life-records.ts'
import type { ReviewLifeRecordDraft } from './life-record-duplicates.ts'

export interface PreparedAutoSaveBatch {
  /** Persistable drafts in their original review order. */
  drafts: ReviewLifeRecordDraft[]
  /** Maps each prepared draft back to its source review-card index. */
  originalIndexes: number[]
  /** Review cards which still need user input and must remain visible. */
  incompleteIndexes: number[]
}

/**
 * Validate and prepare a parsed chat batch for automatic persistence.
 *
 * A card which lacks a required field stays in the review UI. Valid cards in
 * the same message continue to save. Review-only flags are retained here and
 * stripped by the storage-facing save service.
 */
export function prepareAutoSaveBatch(
  candidates: readonly ReviewLifeRecordDraft[],
  fallbackDate: string,
): PreparedAutoSaveBatch {
  const drafts: ReviewLifeRecordDraft[] = []
  const originalIndexes: number[] = []
  const incompleteIndexes: number[] = []

  candidates.forEach((candidate, index) => {
    try {
      const normalized = normalizeLifeRecord(candidate, fallbackDate)
      const sourceRef = normalized.sourceRef ?? candidate.sourceRef
      const confirmedSourceRef = sourceRef
        ? {
            ...sourceRef,
            candidateType: sourceRef.candidateType ?? normalized.type,
            confirmedType: sourceRef.confirmedType ?? normalized.type,
          }
        : undefined
      const persisted = toPersistedLifeRecordDraft({
        ...normalized,
        ...(confirmedSourceRef ? { sourceRef: confirmedSourceRef } : {}),
        ...(normalized.attachments?.length
          ? { attachments: normalized.attachments }
          : candidate.attachments
            ? { attachments: candidate.attachments }
            : {}),
      }, fallbackDate)
      drafts.push(candidate.forceNewRecord
        ? { ...persisted, forceNewRecord: true }
        : persisted)
      originalIndexes.push(index)
    } catch {
      incompleteIndexes.push(index)
    }
  })

  return { drafts, originalIndexes, incompleteIndexes }
}

export function autoSaveResultText(createdCount: number, skippedCount: number, incompleteCount: number): string {
  const details = [
    `已保存 ${createdCount} 条`,
    skippedCount ? `疑似重复 ${skippedCount} 条` : '',
    incompleteCount ? `${incompleteCount} 条需要调整` : '',
  ].filter(Boolean)
  return `${details.join('，')}。`
}

/** Values used by the result cards after a successful authoritative write. */
export function autoSaveRecordSummary(record: Pick<LifeRecordDraft, 'type' | 'date'>): string {
  return `${record.type} · ${record.date}`
}
