import test from 'node:test'
import assert from 'node:assert/strict'
import {
  locateDraftInSource,
  spanFromOffsets,
  splitSourceSentences,
} from '../lib/life-source-fragments.ts'
import { normalizeLifeRecord, parseDemoLifeText } from '../lib/life-records.ts'

const message = '今天练了胸，吃了一碗面，下午看了两个小时书，晚上心情不太好。'

test('the complete original message is split into stable, trimmed fragments', () => {
  const fragments = splitSourceSentences(message)
  assert.deepEqual(fragments.map(fragment => fragment.text), [
    '今天练了胸',
    '吃了一碗面',
    '下午看了两个小时书',
    '晚上心情不太好',
  ])
  for (const fragment of fragments) {
    assert.equal(message.slice(fragment.start, fragment.end), fragment.text)
  }
})

test('offsets distinguish repeated text and reject invalid selections', () => {
  const repeated = '吃饭，然后吃饭'
  const fragments = splitSourceSentences(repeated)
  assert.equal(fragments[1].start, 3)
  assert.deepEqual(spanFromOffsets(repeated, 3, 5), { start: 3, end: 5, text: '然后' })
  assert.equal(spanFromOffsets(repeated, -1, 2), null)
  assert.equal(spanFromOffsets(repeated, 4, 4), null)
  assert.equal(spanFromOffsets(repeated, 0, 99), null)
})

test('a parsed record can be tied back to the exact source sentence', () => {
  const draft = parseDemoLifeText(message, '2026-10-22').find(record => record.type === 'meal')
  assert.ok(draft)
  assert.deepEqual(locateDraftInSource(message, draft), {
    start: 6,
    end: 11,
    text: '吃了一碗面',
  })
})

test('source metadata and attachment references survive schema normalization', () => {
  const sourceRef = { messageId: 'message-1', start: 0, end: 7, text: '今天练了胸', origin: 'user', userEdited: true }
  const attachments = [{
    id: 'attachment-1',
    name: 'meal.jpg',
    mimeType: 'image/jpeg',
    size: 42,
    sha256: 'a'.repeat(64),
  }]
  const normalized = normalizeLifeRecord({
    type: 'exercise',
    date: '2026-10-22',
    activity: '卧推',
    sets: 4,
    note: '',
    sourceRef,
    attachments,
    candidate: true,
  }, '2026-10-22')
  assert.deepEqual(normalized.sourceRef, sourceRef)
  assert.deepEqual(normalized.attachments, attachments)
  assert.equal('candidate' in normalized, false)
})
