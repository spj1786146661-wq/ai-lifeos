import type { LifeRecord, LifeRecordDraft } from './life-records.ts'

/** An empty draft: every number stays blank until the user states it. */
export function emptyDraftForType(type: LifeRecordDraft['type'], date: string): LifeRecordDraft {
  return { type, date, note: '' }
}

function normalizedText(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/**
 * Review-only event intent. It is deliberately not part of LifeRecord and is
 * stripped before persistence by the page/attachment save path.
 */
export type ReviewLifeRecordDraft = LifeRecordDraft & {
  /** Review-only decision to keep this event even when an earlier copy exists. */
  forceNewRecord?: boolean
  /** Review-only pointer to the saved record which matched this candidate. */
  duplicateOfRecordId?: string
}

/**
 * Stable identity for a confirmed source fragment.
 *
 * A refresh destroys in-memory message IDs, so the stored text is included in
 * the fallback. confirmedType retains the user's chosen category after a model
 * correction; older records without it fall back to the saved record type.
 */
export function sourceFragmentFingerprint(draft: LifeRecordDraft, sourceText = ''): string {
  const source = draft.sourceRef
  const type = source?.confirmedType ?? draft.type
  // Character offsets are a UI hint, not identity. A remote model may locate
  // the same sentence differently on the next call, while the date, category
  // and source words still identify the same fact.
  if (source) return ['source', draft.date, type, normalizedText(source.text)].join('|')
  return ['record', type, draft.date, normalizedText(sourceText)].join('|')
}

export function findDuplicateRecord(
  draft: ReviewLifeRecordDraft,
  records: readonly LifeRecord[],
  fallbackSourceText = '',
): LifeRecord | undefined {
  if (draft.forceNewRecord) return undefined
  const fingerprint = sourceFragmentFingerprint(draft, fallbackSourceText)
  return records.find(record => sourceFragmentFingerprint(record, record.sourceText) === fingerprint)
}

/** Preserve order while removing duplicate records from the same review batch. */
export function uniqueReviewDrafts(
  drafts: readonly ReviewLifeRecordDraft[],
  sourceText = '',
): ReviewLifeRecordDraft[] {
  const seen = new Set<string>()
  const seenForced = new Set<number>()
  return drafts.filter((draft, index) => {
    // An explicit user decision to save another real event must survive both
    // batch and persisted-record duplicate checks. Repeated submissions of the
    // same array position are still collapsed so a double click cannot clone it.
    if (draft.forceNewRecord) {
      if (seenForced.has(index)) return false
      seenForced.add(index)
      return true
    }
    const fingerprint = sourceFragmentFingerprint(draft, sourceText)
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}
