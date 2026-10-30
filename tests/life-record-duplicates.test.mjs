import test from 'node:test'
import assert from 'node:assert/strict'
import { findDuplicateRecord, sourceFragmentFingerprint, uniqueReviewDrafts } from '../lib/life-record-duplicates.ts'
import { normalizeLifeRecord } from '../lib/life-records.ts'
import { parseMessageCandidates } from '../lib/life-intent-parse.ts'

const sourceRef = (overrides = {}) => ({
  messageId: 'message-1',
  start: 0,
  end: 7,
  text: '今天练了胸',
  origin: 'user',
  ...overrides,
})

const draft = (overrides = {}) => normalizeLifeRecord({
  type: 'exercise',
  date: '2026-10-22',
  activity: '卧推',
  sets: 4,
  note: '',
  ...overrides,
}, '2026-10-22')

const mealDraft = (overrides = {}) => normalizeLifeRecord({
  type: 'meal',
  date: '2026-10-22',
  food: '胸肉',
  note: '',
  ...overrides,
}, '2026-10-22')

const saved = (draftValue, overrides = {}) => ({
  ...draftValue,
  id: 'record-1',
  sourceText: '今天练了胸，卧推60公斤做了4组',
  createdAt: '2026-10-22T12:00:00.000Z',
  ...overrides,
})

/** The same review item saved on a different day is a different fact, not a duplicate. */
const sameFragmentOtherDay = (draftValue) => ({
  ...draftValue,
  date: '2026-10-21',
  id: 'record-2',
  sourceText: '昨天练了胸，卧推60公斤做了4组',
})

test('the same source fragment keeps its identity after a refresh', () => {
  const before = draft({ sourceRef: sourceRef() })
  // A refresh generates a new message id; the stored text must still identify it.
  const after = draft({ sourceRef: sourceRef({ messageId: 'message-2' }) })
  assert.equal(sourceFragmentFingerprint(before), sourceFragmentFingerprint(after))
  assert.ok(findDuplicateRecord(before, [saved(after)]))
})

test('a corrected category does not create a second record for the same fragment', () => {
  const corrected = mealDraft({
    sourceRef: sourceRef({ candidateType: 'exercise', confirmedType: 'meal', userEdited: true }),
  })
  const stored = saved(corrected)
  assert.ok(findDuplicateRecord(corrected, [stored]))
})

test('the same fragment saved under two different categories stays distinct', () => {
  const exercise = draft({ sourceRef: sourceRef() })
  const meal = mealDraft({
    sourceRef: sourceRef({ candidateType: 'exercise', confirmedType: 'meal', userEdited: true }),
  })
  assert.notEqual(sourceFragmentFingerprint(exercise), sourceFragmentFingerprint(meal))
  assert.equal(findDuplicateRecord(meal, [saved(exercise)]), undefined)
})

test('repeated fragments inside one review batch collapse to a single entry', () => {
  const items = [draft({ sourceRef: sourceRef() }), draft({ sourceRef: sourceRef() })]
  assert.equal(uniqueReviewDrafts(items).length, 1)
})

test('different fragments of the same message are never merged', () => {
  const exercise = draft({ sourceRef: sourceRef({ start: 0, end: 7, text: '今天练了胸' }) })
  const sleep = normalizeLifeRecord({ type: 'sleep', date: '2026-10-22', hours: 7, note: '', sourceRef: sourceRef({ start: 8, end: 13, text: '睡了7小时' }) }, '2026-10-22')
  assert.equal(uniqueReviewDrafts([exercise, sleep]).length, 2)
  assert.equal(findDuplicateRecord(sleep, [saved(exercise)]), undefined)
})

test('records without source metadata still fall back to text and date', () => {
  const plain = normalizeLifeRecord({ type: 'sleep', date: '2026-10-22', hours: 7, note: '' }, '2026-10-22')
  const record = saved(plain, { sourceText: '' })
  assert.equal(sourceFragmentFingerprint(plain, ''), sourceFragmentFingerprint(record))
  assert.ok(findDuplicateRecord(plain, [record]))
  const other = normalizeLifeRecord({ type: 'sleep', date: '2026-10-21', hours: 7, note: '' }, '2026-10-21')
  assert.equal(findDuplicateRecord(other, [record]), undefined)
})

test('outer whitespace differences do not break duplicate detection', () => {
  const a = draft({ sourceRef: sourceRef({ text: ' 今天练了胸 ' }) })
  const b = draft({ sourceRef: sourceRef({ text: '今天练了胸' }) })
  assert.equal(sourceFragmentFingerprint(a), sourceFragmentFingerprint(b))
})

test('model offset drift cannot defeat duplicate detection', () => {
  const first = draft({ sourceRef: sourceRef({ start: 0, end: 7, text: '今天练了胸' }) })
  const second = draft({ sourceRef: sourceRef({ messageId: 'message-2', start: 4, end: 11, text: ' 今天练了胸 ' }) })
  assert.equal(sourceFragmentFingerprint(first), sourceFragmentFingerprint(second))
  assert.ok(findDuplicateRecord(second, [saved(first)]))
})

test('a corrected fragment no longer matches the record saved with its old category', () => {
  const original = draft({ sourceRef: sourceRef() })
  const stored = saved(original)
  const recorrected = mealDraft({
    sourceRef: sourceRef({ candidateType: 'exercise', confirmedType: 'meal', userEdited: true }),
  })
  assert.ok(findDuplicateRecord(original, [stored]))
  assert.equal(findDuplicateRecord(original, [stored])?.id, stored.id)
  assert.equal(findDuplicateRecord(recorrected, [stored]), undefined)
})

test('the same fragment recorded on another day is not treated as a duplicate', () => {
  const original = draft({ sourceRef: sourceRef() })
  const otherDay = sameFragmentOtherDay(original)
  assert.equal(findDuplicateRecord(original, [otherDay]), undefined)
  assert.equal(sourceFragmentFingerprint(original), sourceFragmentFingerprint(draft({ sourceRef: sourceRef({ messageId: 'other' }) })))
  assert.notEqual(sourceFragmentFingerprint(original), sourceFragmentFingerprint(otherDay))
})

/**
 * The review batch comes straight from parseMessageCandidates, so the
 * fingerprints must separate categories that share one sentence while still
 * collapsing a repeated click.
 */
const parsedBatch = (text) => {
  return parseMessageCandidates(text, { messageId: 'message-1', date: '2026-10-22' }).candidates.map(c => c.draft)
}

test('one sentence with a meal and an expense saves as two records', () => {
  const drafts = parsedBatch('中午吃了一碗牛肉面花了28块')
  const unique = uniqueReviewDrafts(drafts)
  assert.equal(unique.length, 2)
  assert.deepEqual(unique.map(draft => draft.type).sort(), ['expense', 'meal'])
})

test('confirming the same batch twice does not add a second copy', () => {
  const source = '今天练了胸，卧推60公斤做了4组，睡了7小时，午饭花了38元，心情不错。'
  const drafts = parsedBatch(source)
  const first = uniqueReviewDrafts(drafts, source)
  const second = uniqueReviewDrafts(first, source)
  assert.deepEqual(second.map(draft => sourceFragmentFingerprint(draft, source)), first.map(draft => sourceFragmentFingerprint(draft, source)))
  const stored = first.map((draft, index) => ({ ...draft, id: `r${index}`, sourceText: source, createdAt: '2026-10-22T12:00:00.000Z' }))
  const resubmitted = uniqueReviewDrafts(first, source).filter(draft => !stored.some(record => sourceFragmentFingerprint(record) === sourceFragmentFingerprint(draft, source)))
  assert.equal(resubmitted.length, 0, '刷新后重新提交不得产生副本')
})

test('a batch with different categories is not collapsed by the fallback path', () => {
  const sleep = normalizeLifeRecord({ type: 'sleep', date: '2026-10-22', hours: 7, note: '' }, '2026-10-22')
  const spend = normalizeLifeRecord({ type: 'expense', date: '2026-10-22', amount: 38, note: '' }, '2026-10-22')
  const unique = uniqueReviewDrafts([sleep, spend], '睡了7小时，午饭花了38元')
  assert.equal(unique.length, 2)
})

test('an explicitly forced new event is neither batch-collapsed nor rejected as persisted duplicate', () => {
  const repeated = { ...draft({ sourceRef: sourceRef({ messageId: 'message-2' }) }), forceNewRecord: true }
  assert.equal(uniqueReviewDrafts([repeated]).length, 1)
  assert.equal(findDuplicateRecord(repeated, [saved(draft({ sourceRef: sourceRef() }))]), undefined)
})
