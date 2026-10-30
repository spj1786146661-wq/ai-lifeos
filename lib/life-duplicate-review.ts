import type { ReviewLifeRecordDraft } from './life-record-duplicates.ts'

export interface DuplicateReviewMatch {
  /** Index in the validated batch passed to the authoritative save service. */
  draftIndex: number
  /** Saved record that already matches this candidate. */
  existingRecordId: string
}

/**
 * Attach the matched saved-record ID to review cards without changing the
 * original candidate data. The pointer is UI-only and is stripped before
 * persistence by prepareAutoSaveBatch().
 */
export function annotateDuplicateReviewDrafts(
  drafts: readonly ReviewLifeRecordDraft[],
  preparedToOriginalIndexes: readonly number[],
  matches: readonly DuplicateReviewMatch[],
): ReviewLifeRecordDraft[] {
  const duplicateByOriginalIndex = new Map<number, string>()
  for (const match of matches) {
    const originalIndex = preparedToOriginalIndexes[match.draftIndex]
    if (Number.isInteger(originalIndex) && originalIndex >= 0) {
      duplicateByOriginalIndex.set(originalIndex, match.existingRecordId)
    }
  }

  return drafts.map((draft, index) => {
    const clean = { ...draft }
    delete clean.duplicateOfRecordId
    const existingRecordId = duplicateByOriginalIndex.get(index)
    return existingRecordId ? { ...clean, duplicateOfRecordId: existingRecordId } : clean
  })
}
