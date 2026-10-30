import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryAttachmentStorage, collectReferencedAttachmentIds } from '../lib/life-attachments.ts'
import { attachFilesToExistingRecord, removeRecordAndUnusedAttachments, restoreBackupWithAttachments, saveNewRecordsWithAttachments, saveRecordsWithAttachments } from '../lib/life-attachment-service.ts'

function memoryRecordStorage(initial = [], options = {}) {
  let records = structuredClone(initial)
  return {
    async load() { return structuredClone(records) },
    async create(_user, drafts, sourceText) {
      if (options.failCreate) throw new Error('record write failed')
      const created = drafts.map((draft, index) => ({
        ...draft,
        id: `record-${records.length + index + 1}`,
        sourceText,
        createdAt: '2026-10-22T00:00:00.000Z',
      }))
      records = [...created, ...records]
      return structuredClone(created)
    },
    async update(_user, id, draft) {
      if (options.failUpdate) throw new Error('record update failed')
      const existing = records.find(record => record.id === id)
      if (!existing) throw new Error('记录不存在')
      records = records.map(record => record.id === id
        ? { ...draft, id, sourceText: existing.sourceText, createdAt: existing.createdAt }
        : record)
    },
    async remove(_user, id) { records = records.filter(record => record.id !== id) },
    async restoreBackup() { return records.length },
  }
}

function pngFile(name = 'meal.png', marker = 1) {
  return new File([new Uint8Array([137, 80, 78, 71, marker])], name, { type: 'image/png' })
}

const mealDraft = {
  type: 'meal',
  date: '2026-10-22',
  note: '',
  food: '牛肉面',
}

function pngAttachment() {
  return { id: 'att-1', name: 'meal.png', mimeType: 'image/png', size: 8, sha256: 'c'.repeat(64) }
}

test('record save and attachment save are linked without Base64 in the record', async () => {
  const recordStorage = memoryRecordStorage()
  const attachments = createMemoryAttachmentStorage()
  const [created] = await saveRecordsWithAttachments({
    recordStorage,
    attachmentStorage: attachments,
    userId: null,
    drafts: [mealDraft],
    sourceText: '午饭吃了牛肉面',
    files: [pngFile()],
    existingRecords: [],
  })
  assert.equal(created.attachments.length, 1)
  assert.equal('dataUrl' in created.attachments[0], false)
  assert.ok(await attachments.load(created.attachments[0].id))
})

test('a failed record write removes only attachments created by that attempt', async () => {
  const records = []
  const recordStorage = memoryRecordStorage(records, { failCreate: true })
  const attachments = createMemoryAttachmentStorage()
  await assert.rejects(() => saveRecordsWithAttachments({
    recordStorage,
    attachmentStorage: attachments,
    userId: null,
    drafts: [mealDraft],
    sourceText: '午饭吃了牛肉面',
    files: [pngFile()],
    existingRecords: [],
  }), /record write failed/)
  assert.deepEqual([...collectReferencedAttachmentIds(await recordStorage.load())], [])
})

test('deleting one record keeps an attachment referenced by another record', async () => {
  const attachments = createMemoryAttachmentStorage()
  const ref = await attachments.save(pngFile('shared.png'))
  const records = [
    { ...mealDraft, id: 'a', sourceText: '午饭', attachments: [ref] },
    { ...mealDraft, id: 'b', sourceText: '晚饭', attachments: [ref] },
  ]
  const recordStorage = memoryRecordStorage(records)
  await removeRecordAndUnusedAttachments({ recordStorage, attachmentStorage: attachments, userId: null, id: 'a' })
  assert.ok(await attachments.load(ref.id))
  await removeRecordAndUnusedAttachments({ recordStorage, attachmentStorage: attachments, userId: null, id: 'b' })
  assert.equal(await attachments.load(ref.id), null)
})

test('a corrupt record backup is rejected before the attachment store is touched', async () => {
  const attachments = createMemoryAttachmentStorage()
  const recordStorage = memoryRecordStorage()
  const ref = await attachments.save(pngFile())
  const backup = {
    schema: 'life-tracker.life-records-backup',
    version: 1,
    exportedAt: '2026-10-22T00:00:00.000Z',
    records: [{ ...mealDraft, id: 'r1', sourceText: '午饭吃了牛肉面', attachments: [ref] }],
    attachmentBackup: await attachments.exportBackup([ref.id]),
  }
  const broken = { ...backup, version: 99 }

  await assert.rejects(() => restoreBackupWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null, backup: broken,
    validateRecords: () => { throw new Error('备份版本不受支持') },
  }), /备份版本不受支持/)

  // A rejected restore must not leave the attachment payload behind.
  const fresh = createMemoryAttachmentStorage()
  await assert.rejects(() => restoreBackupWithAttachments({
    recordStorage, attachmentStorage: fresh, userId: null, backup: broken,
    validateRecords: () => { throw new Error('备份版本不受支持') },
  }), /备份版本不受支持/)
  assert.equal(await fresh.load(ref.id), null, '记录备份校验失败时不得写入附件')
})

test('a backup that references attachments without an image payload is refused', async () => {
  const attachments = createMemoryAttachmentStorage()
  const recordStorage = memoryRecordStorage()
  const backup = {
    schema: 'life-tracker.life-records-backup',
    version: 1,
    exportedAt: '2026-10-22T00:00:00.000Z',
    records: [{ ...mealDraft, id: 'r1', sourceText: '午饭吃了牛肉面', attachments: [pngAttachment()] }],
  }
  await assert.rejects(() => restoreBackupWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null, backup,
    validateRecords: () => {},
  }), /缺少附件数据/)
  assert.deepEqual(await recordStorage.load(), [], '拒绝恢复时不得写入记录')
})

test('a valid backup with attachments restores images before the records', async () => {
  const attachments = createMemoryAttachmentStorage()
  const ref = await attachments.save(pngFile())
  const attachmentBackup = await attachments.exportBackup([ref.id])
  const recordStorage = memoryRecordStorage()
  const backup = {
    schema: 'life-tracker.life-records-backup',
    version: 1,
    exportedAt: '2026-10-22T00:00:00.000Z',
    records: [{ ...mealDraft, id: 'r1', sourceText: '午饭吃了牛肉面', attachments: [ref] }],
    attachmentBackup,
  }
  const target = createMemoryAttachmentStorage()
  const order = []
  const observed = {
    ...target,
    async restoreBackup(value) {
      order.push('attachments')
      return target.restoreBackup(value)
    },
  }
  const counting = {
    ...recordStorage,
    async restoreBackup() {
      order.push('records')
      return 1
    },
  }
  const count = await restoreBackupWithAttachments({
    recordStorage: counting, attachmentStorage: observed, userId: null, backup,
    validateRecords: () => {},
  })
  assert.equal(count, 1)
  assert.deepEqual(order, ['attachments', 'records'])
  assert.ok(await target.load(ref.id))
})

test('a pure text backup still restores without any attachment work', async () => {
  const attachments = createMemoryAttachmentStorage()
  const recordStorage = memoryRecordStorage()
  const backup = {
    schema: 'life-tracker.life-records-backup',
    version: 1,
    exportedAt: '2026-10-22T00:00:00.000Z',
    records: [{ ...mealDraft, id: 'r1', sourceText: '午饭吃了牛肉面' }],
  }
  let attachmentCalls = 0
  const observed = {
    ...attachments,
    async restoreBackup() { attachmentCalls += 1; return 0 },
  }
  let recordRestores = 0
  const counting = {
    ...recordStorage,
    async restoreBackup() { recordRestores += 1; return 1 },
  }
  const count = await restoreBackupWithAttachments({
    recordStorage: counting, attachmentStorage: observed, userId: null, backup,
    validateRecords: () => {},
  })
  assert.equal(count, 1)
  assert.equal(recordRestores, 1, '旧版纯文字备份必须仍然恢复记录')
  assert.equal(attachmentCalls, 0, '旧版纯文字备份不得触发附件恢复')
})

/** 文字 + 图片同时发送，一句话可能产生多条候选；图片只能属于一条。 */
test('an image is never spread across every candidate of one message', async () => {
  const recordStorage = memoryRecordStorage()
  const attachments = createMemoryAttachmentStorage()
  const drafts = [
    { type: 'meal', date: '2026-10-22', note: '', food: '牛肉面' },
    { type: 'expense', date: '2026-10-22', note: '', amount: 28, currency: 'CNY' },
    { type: 'mood', date: '2026-10-22', note: '', score: 4 },
  ]
  const created = await saveRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null, drafts,
    sourceText: '午饭吃了牛肉面花了28块，心情不错', files: [pngFile()], existingRecords: [],
    attachmentTargetIndex: 0,
  })
  const withImages = created.filter(record => record.attachments?.length)
  assert.equal(withImages.length, 1)
  assert.equal(withImages[0].type, 'meal')
})

test('a different target index attaches the image to that record only', async () => {
  const recordStorage = memoryRecordStorage()
  const attachments = createMemoryAttachmentStorage()
  const drafts = [
    { type: 'meal', date: '2026-10-22', note: '', food: '牛肉面' },
    { type: 'expense', date: '2026-10-22', note: '', amount: 28, currency: 'CNY' },
  ]
  const created = await saveRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null, drafts,
    sourceText: '午饭吃了牛肉面花了28块', files: [pngFile()], existingRecords: [],
    attachmentTargetIndex: 1,
  })
  assert.equal(created[0].attachments?.length ?? 0, 0)
  assert.equal(created[1].attachments?.length, 1)
})

test('an undecided target saves the records without inventing an attachment', async () => {
  const recordStorage = memoryRecordStorage()
  const attachments = createMemoryAttachmentStorage()
  const drafts = [
    { type: 'meal', date: '2026-10-22', note: '', food: '牛肉面' },
    { type: 'expense', date: '2026-10-22', note: '', amount: 28, currency: 'CNY' },
  ]
  const created = await saveRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null, drafts,
    sourceText: '午饭吃了牛肉面花了28块', files: [pngFile()], existingRecords: [],
    attachmentTargetIndex: null,
  })
  assert.equal(created.length, 2)
  assert.ok(created.every(record => (record.attachments?.length ?? 0) === 0))
  assert.deepEqual([...collectReferencedAttachmentIds(await recordStorage.load())], [])
})

test('the same image shared by two records is stored once', async () => {
  const recordStorage = memoryRecordStorage()
  const attachments = createMemoryAttachmentStorage()
  const file = pngFile('shared.png')
  await saveRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null,
    drafts: [{ type: 'meal', date: '2026-10-22', note: '', food: '午饭' }],
    sourceText: '午饭', files: [file], existingRecords: [], attachmentTargetIndex: 0,
  })
  const second = await saveRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null,
    drafts: [{ type: 'meal', date: '2026-10-22', note: '', food: '晚饭' }],
    sourceText: '晚饭', files: [file], existingRecords: await recordStorage.load(), attachmentTargetIndex: 0,
  })
  const refs = (await recordStorage.load()).flatMap(record => record.attachments ?? [])
  assert.equal(new Set(refs.map(ref => ref.sha256)).size, 1)
  assert.equal(second[0].attachments?.length, 1)
})

test('a partially saved batch reports created and skipped records and retry is idempotent', async () => {
  const existing = {
    ...mealDraft,
    id: 'existing',
    sourceText: '午饭吃了牛肉面花了28块',
    sourceRef: { messageId: 'old', start: 0, end: 5, text: '午饭吃了牛肉面', origin: 'rule' },
  }
  const recordStorage = memoryRecordStorage([existing])
  const attachments = createMemoryAttachmentStorage()
  const drafts = [
    { ...mealDraft, sourceRef: { messageId: 'new', start: 0, end: 5, text: '午饭吃了牛肉面', origin: 'rule' } },
    { type: 'expense', date: '2026-10-22', note: '', amount: 28, currency: 'CNY',
      sourceRef: { messageId: 'new', start: 6, end: 11, text: '花了28块', origin: 'rule' } },
  ]
  const first = await saveNewRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null, drafts,
    sourceText: '午饭吃了牛肉面花了28块', files: [], existingRecords: [],
  })
  assert.equal(first.createdCount, 1)
  assert.equal(first.skippedCount, 1)
  assert.deepEqual(first.skippedIndexes, [0])
  assert.equal(first.attachmentSaved, false)
  const second = await saveNewRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null, drafts,
    sourceText: '午饭吃了牛肉面花了28块', files: [], existingRecords: [],
  })
  assert.equal(second.createdCount, 0)
  assert.equal(second.skippedCount, 2)
  assert.deepEqual(second.skippedIndexes, [0, 1])
  assert.equal(second.attachmentSaved, false)
  assert.equal((await recordStorage.load()).length, 2)
})

test('an attachment follows the intended target after an earlier duplicate is skipped', async () => {
  const existing = {
    ...mealDraft,
    id: 'existing',
    sourceText: '午饭吃了牛肉面花了28块',
    sourceRef: { messageId: 'old', start: 0, end: 5, text: '午饭吃了牛肉面', origin: 'rule' },
  }
  const recordStorage = memoryRecordStorage([existing])
  const attachments = createMemoryAttachmentStorage()
  const meal = { ...mealDraft, sourceRef: { messageId: 'new', start: 0, end: 5, text: '午饭吃了牛肉面', origin: 'rule' } }
  const expense = { type: 'expense', date: '2026-10-22', note: '', amount: 28, currency: 'CNY',
    sourceRef: { messageId: 'new', start: 6, end: 11, text: '花了28块', origin: 'rule' } }
  const result = await saveNewRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null,
    drafts: [meal, expense], sourceText: '午饭吃了牛肉面花了28块',
    files: [pngFile()], existingRecords: [existing], attachmentTargetIndex: 1,
  })
  assert.equal(result.createdCount, 1)
  assert.equal(result.skippedCount, 1)
  assert.deepEqual(result.skippedIndexes, [0])
  assert.equal(result.attachmentSaved, true)
  assert.equal(result.records[0].type, 'expense')
  assert.equal(result.records[0].attachments?.length, 1)
  assert.equal(result.records[0].attachments[0].name, 'meal.png')
})

test('a forced real event bypasses duplicate filtering and keeps its attachment', async () => {
  const original = { ...mealDraft, id: 'existing', sourceText: '午饭吃了牛肉面' }
  const recordStorage = memoryRecordStorage([original])
  const attachments = createMemoryAttachmentStorage()
  const draft = { ...mealDraft, forceNewRecord: true }
  const result = await saveNewRecordsWithAttachments({
    recordStorage, attachmentStorage: attachments, userId: null,
    drafts: [draft], sourceText: '午饭吃了牛肉面', files: [pngFile()],
    existingRecords: [original], attachmentTargetIndex: 0,
  })
  assert.equal(result.createdCount, 1)
  assert.equal(result.attachmentSaved, true)
  assert.equal(result.records[0].attachments?.length, 1)
})

test('a duplicate image target is never moved to another saved record', async () => {
  const existing = {
    ...mealDraft,
    id: 'existing',
    sourceText: '午饭吃了牛肉面花了28块',
    sourceRef: { messageId: 'old', start: 0, end: 5, text: '午饭吃了牛肉面', origin: 'rule' },
  }
  const recordStorage = memoryRecordStorage([existing])
  const attachments = createMemoryAttachmentStorage()
  const duplicateMeal = {
    ...mealDraft,
    sourceRef: { messageId: 'new', start: 0, end: 5, text: '午饭吃了牛肉面', origin: 'rule' },
  }
  const freshExpense = {
    type: 'expense',
    date: '2026-10-22',
    note: '',
    amount: 28,
    currency: 'CNY',
    sourceRef: { messageId: 'new', start: 6, end: 11, text: '花了28块', origin: 'rule' },
  }
  const result = await saveNewRecordsWithAttachments({
    recordStorage,
    attachmentStorage: attachments,
    userId: null,
    drafts: [duplicateMeal, freshExpense],
    sourceText: '午饭吃了牛肉面花了28块',
    files: [pngFile()],
    existingRecords: [existing],
    attachmentTargetIndex: 0,
  })
  assert.equal(result.createdCount, 1)
  assert.deepEqual(result.skippedIndexes, [0])
  assert.equal(result.attachmentSaved, false)
  assert.equal(result.records[0].type, 'expense')
  assert.equal(result.records[0].attachments, undefined)
  assert.equal((await recordStorage.load()).every(record => !record.attachments?.length), true)
})

test('a pending multi-candidate image can be attached explicitly to one saved record', async () => {
  const recordStorage = memoryRecordStorage([
    { ...mealDraft, id: 'meal-1', sourceText: '午饭吃了牛肉面花了28块' },
    { type: 'expense', date: '2026-10-22', note: '', amount: 28, currency: 'CNY', id: 'expense-1', sourceText: '午饭吃了牛肉面花了28块' },
  ])
  const attachments = createMemoryAttachmentStorage()
  const updated = await attachFilesToExistingRecord({
    recordStorage,
    attachmentStorage: attachments,
    userId: null,
    recordId: 'meal-1',
    files: [pngFile('pending.png')],
  })
  assert.equal(updated.id, 'meal-1')
  assert.equal(updated.attachments?.length, 1)
  const records = await recordStorage.load()
  assert.equal(records.find(record => record.id === 'meal-1').attachments?.length, 1)
  assert.equal(records.find(record => record.id === 'expense-1').attachments, undefined)
})

test('attaching a pending image to a missing record leaves no orphan attachment', async () => {
  const recordStorage = memoryRecordStorage([
    { ...mealDraft, id: 'meal-1', sourceText: '午饭吃了牛肉面' },
  ])
  const attachments = createMemoryAttachmentStorage()
  await assert.rejects(() => attachFilesToExistingRecord({
    recordStorage,
    attachmentStorage: attachments,
    userId: null,
    recordId: 'missing',
    files: [pngFile('pending.png')],
  }), /记录不存在/)
  const records = await recordStorage.load()
  assert.equal(records[0].attachments, undefined)
})

test('a failed attachment association removes only its newly written image', async () => {
  const recordStorage = memoryRecordStorage([
    { ...mealDraft, id: 'meal-1', sourceText: '午饭吃了牛肉面' },
  ], { failUpdate: true })
  const attachments = createMemoryAttachmentStorage()
  const file = pngFile('pending.png', 9)
  const savedRef = await attachments.save(file)
  await assert.rejects(() => attachFilesToExistingRecord({
    recordStorage,
    attachmentStorage: attachments,
    userId: null,
    recordId: 'meal-1',
    files: [file],
  }), /record update failed/)
  assert.equal(await attachments.load(savedRef.id), null)
})

test('an all-duplicate batch returns its original indexes so the review can remain visible', async () => {
  const original = { ...mealDraft, id: 'existing', sourceText: '午饭吃了牛肉面' }
  const recordStorage = memoryRecordStorage([original])
  const result = await saveNewRecordsWithAttachments({
    recordStorage,
    attachmentStorage: createMemoryAttachmentStorage(),
    userId: null,
    drafts: [mealDraft],
    sourceText: '午饭吃了牛肉面',
    files: [pngFile()],
    existingRecords: [original],
    attachmentTargetIndex: 0,
  })
  assert.equal(result.createdCount, 0)
  assert.equal(result.skippedCount, 1)
  assert.deepEqual(result.skippedIndexes, [0])
  assert.equal(result.attachmentSaved, false)
})
