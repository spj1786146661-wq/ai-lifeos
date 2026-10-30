import test from 'node:test'
import assert from 'node:assert/strict'
import { attachmentTypeFromName } from '../lib/life-attachments.ts'
import { emptyDraftForType } from '../lib/life-record-duplicates.ts'

test('an empty MIME type is recovered from the file extension', () => {
  assert.equal(attachmentTypeFromName('meal.jpg'), 'image/jpeg')
  assert.equal(attachmentTypeFromName('meal.JPEG'), 'image/jpeg')
  assert.equal(attachmentTypeFromName('meal.png'), 'image/png')
  assert.equal(attachmentTypeFromName('meal.webp'), 'image/webp')
  assert.equal(attachmentTypeFromName('meal.gif'), null)
  assert.equal(attachmentTypeFromName('meal'), null)
})

test('a new draft never invents a value the user did not state', () => {
  // No key: the image still needs a record, but every number must stay empty
  // until the user types it. A fabricated 8h sleep or ¥1 expense is a false fact.
  for (const type of ['exercise', 'sleep', 'learning', 'meal', 'expense', 'mood']) {
    const draft = emptyDraftForType(type, '2026-10-22')
    assert.equal(draft.type, type)
    assert.equal(draft.date, '2026-10-22')
    for (const field of ['durationMinutes', 'weightKg', 'sets', 'hours', 'amount', 'score', 'quantity']) {
      assert.equal(draft[field], undefined, `${type} 不得预填 ${field}`)
    }
    assert.equal(draft.note, '')
  }
})

test('a switch to sleep still requires the user to enter hours', () => {
  const draft = emptyDraftForType('sleep', '2026-10-22')
  assert.equal(draft.hours, undefined)
})
