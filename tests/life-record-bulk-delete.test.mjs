import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryAttachmentStorage } from '../lib/life-attachments.ts'
import { bulkDeleteOutcomeMessage, bulkDeleteSnapshot, deleteRecordsByIds } from '../lib/life-record-bulk-delete.ts'

function memoryRecordStorage(initial = [], options = {}) {
  let records = structuredClone(initial)
  let loads = 0
  return {
    async load() {
      loads += 1
      return structuredClone(records)
    },
    async create() { return [] },
    async update() {},
    async remove(_user, id) {
      if (options.failIds?.includes(id)) throw new Error(`write failed: ${id}`)
      records = records.filter(record => record.id !== id)
    },
    async isLocalDataCorrupted() { return false },
    async exportBackup() { throw new Error('not used') },
    async restoreBackup() { return 0 },
    counts: () => ({ loads, records: structuredClone(records) }),
  }
}

const record = (id, type, date, extra = {}) => ({
  id,
  type,
  date,
  note: '',
  sourceText: `${type} ${date}`,
  ...extra,
})

test('a selected-delete snapshot is frozen to unique record IDs', () => {
  const records = [
    record('a', 'exercise', '2026-10-22'),
    record('b', 'sleep', '2026-10-22'),
    record('c', 'meal', '2026-10-23'),
  ]
  const snapshot = bulkDeleteSnapshot(records, { kind: 'selected', ids: ['a', 'b', 'a', 'missing'] })
  assert.deepEqual(snapshot.ids, ['a', 'b'])
  assert.equal(snapshot.recordCount, 2)
  assert.equal(snapshot.dateCount, 1)
  assert.deepEqual(snapshot.typeCounts, { exercise: 1, sleep: 1 })
})

test('a day-delete snapshot cannot include another date', () => {
  const records = [
    record('a', 'exercise', '2026-10-22'),
    record('b', 'meal', '2026-10-22'),
    record('c', 'expense', '2026-10-23'),
  ]
  const snapshot = bulkDeleteSnapshot(records, { kind: 'day', date: '2026-10-22' })
  assert.deepEqual(snapshot.ids, ['a', 'b'])
  assert.equal(snapshot.recordCount, 2)
  assert.equal(snapshot.dateCount, 1)
  assert.equal(snapshot.date, '2026-10-22')
})

test('an all-records snapshot is limited to the authoritative records passed in', () => {
  const snapshot = bulkDeleteSnapshot([
    record('a', 'exercise', '2026-10-22'),
    record('b', 'sleep', '2026-10-23'),
  ], { kind: 'all' })
  assert.deepEqual(snapshot.ids, ['a', 'b'])
  assert.equal(snapshot.recordCount, 2)
  assert.equal(snapshot.dateCount, 2)
})

test('clearing all records removes only the frozen authoritative snapshot', async () => {
  const storage = memoryRecordStorage([
    record('a', 'exercise', '2026-10-22'),
    record('b', 'sleep', '2026-10-23'),
  ])
  const snapshot = bulkDeleteSnapshot(storage.counts().records, { kind: 'all' })
  const outcome = await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: snapshot.ids,
  })
  assert.deepEqual(outcome.deletedIds, ['a', 'b'])
  assert.equal(outcome.remainingCount, 0)
})

test('selected records are deleted while other dates remain', async () => {
  const storage = memoryRecordStorage([
    record('a', 'exercise', '2026-10-22'),
    record('b', 'meal', '2026-10-22'),
    record('c', 'expense', '2026-10-23'),
  ])
  const outcome = await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: ['a', 'b'],
  })
  assert.deepEqual(outcome.deletedIds, ['a', 'b'])
  assert.equal(outcome.remainingCount, 1)
  assert.deepEqual(storage.counts().records.map(item => item.id), ['c'])
})

test('a day operation only removes the frozen IDs for that date', async () => {
  const storage = memoryRecordStorage([
    record('a', 'exercise', '2026-10-22'),
    record('b', 'meal', '2026-10-22'),
    record('c', 'expense', '2026-10-23'),
  ])
  const snapshot = bulkDeleteSnapshot(storage.counts().records, { kind: 'day', date: '2026-10-22' })
  const outcome = await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: snapshot.ids,
  })
  assert.deepEqual(outcome.deletedIds, ['a', 'b'])
  assert.deepEqual(storage.counts().records.map(item => item.id), ['c'])
})

test('partial deletion reports the final state without claiming total success', async () => {
  const storage = memoryRecordStorage([
    record('a', 'exercise', '2026-10-22'),
    record('b', 'sleep', '2026-10-22'),
    record('c', 'meal', '2026-10-22'),
  ], { failIds: ['b'] })
  const outcome = await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: ['a', 'b', 'c'],
  })
  assert.deepEqual(outcome.deletedIds, ['a', 'c'])
  assert.deepEqual(outcome.failedIds, ['b'])
  assert.equal(outcome.remainingCount, 1)
  assert.match(bulkDeleteOutcomeMessage(outcome), /已删除 2 条/)
  assert.match(bulkDeleteOutcomeMessage(outcome), /1 条删除失败/)
})

test('records that disappeared before execution are reported as missing', async () => {
  const storage = memoryRecordStorage([record('a', 'exercise', '2026-10-22')])
  const outcome = await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: ['a', 'gone'],
  })
  assert.deepEqual(outcome.deletedIds, ['a'])
  assert.deepEqual(outcome.missingIds, ['gone'])
})

test('an empty delete request performs no record write', async () => {
  const storage = memoryRecordStorage([record('a', 'exercise', '2026-10-22')])
  const outcome = await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: [],
  })
  assert.deepEqual(outcome.deletedIds, [])
  assert.equal(storage.counts().records.length, 1)
})

test('shared images survive until their final record reference is deleted', async () => {
  const attachments = createMemoryAttachmentStorage()
  const shared = await attachments.save(new File([new Uint8Array([137, 80, 78, 71])], 'shared.png', { type: 'image/png' }))
  const storage = memoryRecordStorage([
    record('a', 'meal', '2026-10-22', { food: '午饭', attachments: [shared] }),
    record('b', 'meal', '2026-10-22', { food: '晚饭', attachments: [shared] }),
  ])
  await deleteRecordsByIds({ recordStorage: storage, attachmentStorage: attachments, userId: null, ids: ['a'] })
  assert.ok(await attachments.load(shared.id))
  await deleteRecordsByIds({ recordStorage: storage, attachmentStorage: attachments, userId: null, ids: ['b'] })
  assert.equal(await attachments.load(shared.id), null)
})

test('an image cleanup failure is reported after the record deletion is committed', async () => {
  const baseAttachments = createMemoryAttachmentStorage()
  const image = await baseAttachments.save(new File([new Uint8Array([137, 80, 78, 71])], 'meal.png', { type: 'image/png' }))
  const attachments = {
    ...baseAttachments,
    async removeUnreferenced() { throw new Error('attachment store unavailable') },
  }
  const storage = memoryRecordStorage([
    record('a', 'meal', '2026-10-22', { food: '午饭', attachments: [image] }),
  ])
  const outcome = await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: attachments,
    userId: null,
    ids: ['a'],
  })
  assert.deepEqual(outcome.deletedIds, ['a'])
  assert.deepEqual(outcome.failedIds, [])
  assert.deepEqual(outcome.attachmentCleanupFailedIds, ['a'])
  assert.equal(outcome.remainingCount, 0)
  assert.match(bulkDeleteOutcomeMessage(outcome), /图片清理失败/)
})

test('a retry only uses the IDs from its own snapshot', async () => {
  const storage = memoryRecordStorage([
    record('a', 'exercise', '2026-10-22'),
    record('b', 'sleep', '2026-10-22'),
  ])
  const firstSnapshot = bulkDeleteSnapshot(storage.counts().records, { kind: 'selected', ids: ['a'] })
  await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: firstSnapshot.ids,
  })
  await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: firstSnapshot.ids,
  })
  assert.deepEqual(storage.counts().records.map(item => item.id), ['b'])
})
