import test from 'node:test'
import assert from 'node:assert/strict'
import { saveNewRecordsWithAttachments } from '../lib/life-attachment-service.ts'
import { createMemoryAttachmentStorage } from '../lib/life-attachments.ts'
import { annotateDuplicateReviewDrafts } from '../lib/life-duplicate-review.ts'

function sourceRef(text, type, start = 0) {
  return {
    messageId: 'message-test',
    start,
    end: start + text.length,
    text,
    origin: 'rule',
    confirmedType: type,
  }
}

function memoryRecordStorage(initial = []) {
  let records = structuredClone(initial)
  let createCalls = 0
  return {
    get createCalls() { return createCalls },
    async load() { return structuredClone(records) },
    async create(_user, drafts, sourceText) {
      createCalls += 1
      let next = records.length + 1
      while (records.some(record => record.id === `record-${next}`)) next += 1
      const created = drafts.map((draft, index) => ({
        ...draft,
        id: `record-${next + index}`,
        sourceText,
        createdAt: '2026-10-23T00:00:00.000Z',
      }))
      records = [...created, ...records]
      return structuredClone(created)
    },
    async update(_user, id, draft) {
      records = records.map(record => record.id === id
        ? { ...record, ...draft, id, sourceText: record.sourceText, createdAt: record.createdAt }
        : record)
    },
    async remove(_user, id) {
      records = records.filter(record => record.id !== id)
    },
    async restoreBackup() { return records.length },
  }
}

const meal = {
  id: 'old-meal',
  type: 'meal',
  date: '2026-10-23',
  note: '',
  food: '牛肉面',
  sourceText: '中午吃了一碗牛肉面',
  createdAt: '2026-10-23T01:00:00.000Z',
  sourceRef: sourceRef('中午吃了一碗牛肉面', 'meal'),
}

test('a partially duplicate batch saves the other records and returns the matched old record', async () => {
  const storage = memoryRecordStorage([meal])
  const outcome = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: [
      {
        type: 'sleep',
        date: '2026-10-23',
        note: '',
        hours: 7.5,
        sourceRef: sourceRef('睡了7个半小时', 'sleep', 20),
      },
      {
        type: 'meal',
        date: '2026-10-23',
        note: '',
        food: '牛肉面',
        sourceRef: sourceRef('中午吃了一碗牛肉面', 'meal', 35),
      },
      {
        type: 'expense',
        date: '2026-10-23',
        note: '',
        amount: 28,
        currency: 'CNY',
        sourceRef: sourceRef('花了28元', 'expense', 50),
      },
    ],
    sourceText: '睡了7个半小时，中午吃了一碗牛肉面，花了28元',
    files: [],
    existingRecords: [meal],
  })

  assert.equal(outcome.createdCount, 2)
  assert.equal(outcome.skippedCount, 1)
  assert.deepEqual(outcome.skippedIndexes, [1])
  assert.deepEqual(outcome.duplicateMatches, [{ draftIndex: 1, existingRecordId: 'old-meal' }])
  assert.deepEqual((await storage.load()).map(record => record.type).sort(), ['expense', 'meal', 'sleep'])
})

test('the same food can be saved twice only after an explicit new-event confirmation', async () => {
  const storage = memoryRecordStorage()
  const draft = {
    type: 'meal',
    date: '2026-10-23',
    note: '',
    food: '牛肉面',
    sourceRef: sourceRef('牛肉面', 'meal'),
  }
  const first = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: [draft],
    sourceText: '牛肉面',
    files: [],
    existingRecords: [],
  })
  const repeated = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: [draft],
    sourceText: '牛肉面',
    files: [],
    existingRecords: [],
  })
  assert.equal(first.createdCount, 1)
  assert.equal(repeated.createdCount, 0)
  assert.equal(repeated.duplicateMatches[0].existingRecordId, first.records[0].id)

  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('confirmation must not call a model')
  }
  try {
    const confirmed = await saveNewRecordsWithAttachments({
      recordStorage: storage,
      attachmentStorage: createMemoryAttachmentStorage(),
      userId: null,
      drafts: [{ ...draft, forceNewRecord: true }],
      sourceText: '牛肉面',
      files: [],
      existingRecords: [],
    })
    assert.equal(confirmed.createdCount, 1)
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
  const stored = await storage.load()
  assert.equal(stored.length, 2)
  assert.equal(new Set(stored.map(record => record.id)).size, 2)
})

test('editing the matched record keeps one record and does not create a copy', async () => {
  const storage = memoryRecordStorage([meal])
  await storage.update(null, meal.id, {
    ...meal,
    food: '牛肉面加蛋',
    note: '补充：加了一个蛋',
  })
  const stored = await storage.load()
  assert.equal(storage.createCalls, 0)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].id, 'old-meal')
  assert.equal(stored[0].food, '牛肉面加蛋')
})

test('duplicate matches are annotated back to the original review-card indexes', () => {
  const drafts = [
    { type: 'sleep', date: '2026-10-23', note: '', hours: 7 },
    { type: 'meal', date: '2026-10-23', note: '', food: '牛肉面', duplicateOfRecordId: 'stale' },
    { type: 'expense', date: '2026-10-23', note: '', amount: 28 },
  ]
  const annotated = annotateDuplicateReviewDrafts(
    drafts,
    [0, 2],
    [{ draftIndex: 1, existingRecordId: 'old-expense' }],
  )
  assert.equal(annotated[0].duplicateOfRecordId, undefined)
  assert.equal(annotated[1].duplicateOfRecordId, undefined)
  assert.equal(annotated[2].duplicateOfRecordId, 'old-expense')
})
