import test from 'node:test'
import assert from 'node:assert/strict'
import { autoSaveResultText, prepareAutoSaveBatch } from '../lib/life-auto-save.ts'
import { saveNewRecordsWithAttachments } from '../lib/life-attachment-service.ts'
import { createMemoryAttachmentStorage } from '../lib/life-attachments.ts'
import { deleteRecordsByIds } from '../lib/life-record-bulk-delete.ts'

function memoryRecordStorage(initial = []) {
  let records = structuredClone(initial)
  return {
    async load() { return structuredClone(records) },
    async create(_user, drafts, sourceText) {
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
    async update() {},
    async remove(_user, id) {
      records = records.filter(record => record.id !== id)
    },
    async restoreBackup() { return records.length },
  }
}

const sourceRef = (text, start, type) => ({
  messageId: 'message-1',
  start,
  end: start + text.length,
  text,
  origin: 'rule',
  confirmedType: type,
})

test('a multi-intent message prepares all six categories for automatic save', async () => {
  const candidates = [
    { type: 'exercise', date: '2026-10-23', note: '', activity: '卧推', weightKg: 60, sets: 4, sourceRef: sourceRef('卧推60公斤4组', 0, 'exercise') },
    { type: 'sleep', date: '2026-10-23', note: '', hours: 7, sourceRef: sourceRef('睡了7小时', 20, 'sleep') },
    { type: 'meal', date: '2026-10-23', note: '', food: '牛肉面', sourceRef: sourceRef('吃了一碗牛肉面', 30, 'meal') },
    { type: 'expense', date: '2026-10-23', note: '', amount: 28, currency: 'CNY', sourceRef: sourceRef('花了28元', 40, 'expense') },
    { type: 'learning', date: '2026-10-23', note: '', subject: '英语', durationMinutes: 120, sourceRef: sourceRef('学英语2小时', 50, 'learning') },
    { type: 'mood', date: '2026-10-23', note: '心情不错', sourceRef: sourceRef('心情不错', 60, 'mood') },
  ]
  const prepared = prepareAutoSaveBatch(candidates, '2026-10-23')
  assert.equal(prepared.drafts.length, 6)
  assert.deepEqual(prepared.drafts.map(draft => draft.type), ['exercise', 'sleep', 'meal', 'expense', 'learning', 'mood'])
  assert.equal(prepared.drafts[5].score, undefined)

  const storage = memoryRecordStorage()
  const outcome = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: prepared.drafts,
    sourceText: '综合测试',
    files: [],
    existingRecords: [],
  })
  assert.equal(outcome.createdCount, 6)
  assert.equal(outcome.skippedCount, 0)
  assert.equal((await storage.load()).length, 6)
})

test('a meaningful exercise can auto-save without an invented duration or set count', () => {
  const prepared = prepareAutoSaveBatch([
    { type: 'sleep', date: '2026-10-23', note: '', hours: 7 },
    {
      type: 'exercise',
      date: '2026-10-23',
      note: '',
      activity: '卧推',
      needsFields: true,
      missingReason: '可补充运动时长或训练组数',
    },
    { type: 'mood', date: '2026-10-23', note: '心情一般' },
  ], '2026-10-23')
  assert.deepEqual(prepared.drafts.map(draft => draft.type), ['sleep', 'exercise', 'mood'])
  assert.equal(prepared.drafts[1].durationMinutes, undefined)
  assert.equal(prepared.drafts[1].sets, undefined)
  assert.deepEqual(prepared.incompleteIndexes, [])
  assert.deepEqual(prepared.originalIndexes, [0, 1, 2])
})

test('the same automatic batch is skipped on an immediate retry', async () => {
  const prepared = prepareAutoSaveBatch([
    {
      type: 'meal',
      date: '2026-10-23',
      note: '',
      food: '牛肉面',
      sourceRef: sourceRef('牛肉面', 0, 'meal'),
    },
  ], '2026-10-23')
  const storage = memoryRecordStorage()
  const first = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: prepared.drafts,
    sourceText: '牛肉面',
    files: [],
    existingRecords: [],
  })
  const second = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: prepared.drafts,
    sourceText: '牛肉面',
    files: [],
    existingRecords: [],
  })
  assert.equal(first.createdCount, 1)
  assert.equal(second.createdCount, 0)
  assert.equal(second.skippedCount, 1)
  assert.equal((await storage.load()).length, 1)
})

test('a skipped automatic batch remains actionable as an explicit new event', async () => {
  const prepared = prepareAutoSaveBatch([
    {
      type: 'meal',
      date: '2026-10-23',
      note: '',
      food: '牛肉面',
      sourceRef: sourceRef('牛肉面', 0, 'meal'),
    },
  ], '2026-10-23')
  const storage = memoryRecordStorage()
  await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: prepared.drafts,
    sourceText: '牛肉面',
    files: [],
    existingRecords: [],
  })
  const repeated = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: prepared.drafts,
    sourceText: '牛肉面',
    files: [],
    existingRecords: [],
  })
  assert.deepEqual(repeated.skippedIndexes, [0])
  const forced = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: prepared.drafts.map(draft => ({ ...draft, forceNewRecord: true })),
    sourceText: '牛肉面',
    files: [],
    existingRecords: [],
  })
  assert.equal(forced.createdCount, 1)
  assert.equal((await storage.load()).length, 2)
})

test('result text distinguishes saved, duplicate and adjustment states', () => {
  assert.equal(autoSaveResultText(2, 1, 1), '已保存 2 条，疑似重复 1 条，1 条需要调整。')
  assert.equal(autoSaveResultText(0, 1, 0), '已保存 0 条，疑似重复 1 条。')
})

test('undo uses only IDs returned for this automatic save', async () => {
  const older = {
    id: 'older',
    type: 'sleep',
    date: '2026-10-22',
    note: '',
    hours: 7,
    sourceText: '昨晚睡了7小时',
  }
  const storage = memoryRecordStorage([older])
  const prepared = prepareAutoSaveBatch([
    {
      type: 'meal',
      date: '2026-10-23',
      note: '',
      food: '牛肉面',
      sourceRef: sourceRef('牛肉面', 0, 'meal'),
    },
  ], '2026-10-23')
  const outcome = await saveNewRecordsWithAttachments({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: prepared.drafts,
    sourceText: '牛肉面',
    files: [],
    existingRecords: [older],
  })
  const undo = await deleteRecordsByIds({
    recordStorage: storage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    ids: outcome.records.map(record => record.id),
  })
  assert.deepEqual(undo.deletedIds, outcome.records.map(record => record.id))
  assert.deepEqual((await storage.load()).map(record => record.id), ['older'])
})
