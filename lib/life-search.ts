import { LIFE_RECORD_LABELS, type LifeRecord } from './life-records.ts'

export interface LifeSearchMatch {
  record: LifeRecord
  /** Which user-visible fields produced the hit, so the UI can show why. */
  fields: Array<'date' | 'type' | 'note' | 'sourceText' | 'activity' | 'subject' | 'food'>
}

/** Case- and width-insensitive matching against the fields a user remembers. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

function recordText(record: LifeRecord): { text: string; fields: LifeSearchMatch['fields'] } {
  const parts: Array<[string, LifeSearchMatch['fields'][number]]> = [
    [record.date, 'date'],
    [LIFE_RECORD_LABELS[record.type], 'type'],
    [record.activity ?? '', 'activity'],
    [record.subject ?? '', 'subject'],
    [record.food ?? '', 'food'],
    [record.note, 'note'],
    [record.sourceText, 'sourceText'],
  ]
  return { text: normalize(parts.map(([value]) => value).join(' ')), fields: parts.filter(([value]) => value !== '').map(([, field]) => field) }
}

/**
 * Pure search over already-loaded records. Matching is substring-based so a
 * user can find a record by what they typed, what the model extracted, the
 * original sentence, or the date. Records are returned unchanged.
 */
export function searchLifeRecords(records: readonly LifeRecord[], query: string): LifeSearchMatch[] {
  const needle = normalize(query.trim())
  if (needle === '') return []
  const matches: LifeSearchMatch[] = []
  for (const record of records) {
    const { text, fields } = recordText(record)
    if (text.includes(needle)) matches.push({ record, fields })
  }
  return matches
}
