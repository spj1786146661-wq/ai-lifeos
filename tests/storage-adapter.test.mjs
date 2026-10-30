import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalStorageAdapter } from '../lib/storage-adapter.ts'
import { BACKUP_SCHEMA, BACKUP_VERSION } from '../lib/life-demo-store.ts'

const KEY = 'life-tracker:life-records:demo:v1'

function storage(initial) {
  const map = new Map(initial === undefined ? [] : [[KEY, initial]])
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    raw: () => map.get(KEY) ?? null,
  }
}

const sleepDraft = hours => ({ type: 'sleep', date: '2026-10-20', hours, note: '' })

test('adapter loads saved records', async () => {
  const adapter = createLocalStorageAdapter(storage())
  const [created] = await adapter.create(null, [sleepDraft(7), sleepDraft(6)], '睡了两觉')
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 2)
  assert.equal(loaded[0].id, created.id)
})

test('adapter creates records and returns them', async () => {
  const adapter = createLocalStorageAdapter(storage())
  const created = await adapter.create(null, [sleepDraft(7)], '睡了7小时')
  assert.equal(created.length, 1)
  assert.ok(created[0].id)
  assert.equal(created[0].sourceText, '睡了7小时')
  assert.ok(created[0].createdAt)
})

test('adapter edits a record', async () => {
  const adapter = createLocalStorageAdapter(storage())
  const [created] = await adapter.create(null, [sleepDraft(7)], '睡了7小时')
  await adapter.update(null, created.id, sleepDraft(8))
  assert.equal((await adapter.load(null))[0].hours, 8)
})

test('adapter deletes a record', async () => {
  const adapter = createLocalStorageAdapter(storage())
  const [created] = await adapter.create(null, [sleepDraft(7)], '睡了7小时')
  await adapter.remove(null, created.id)
  assert.deepEqual(await adapter.load(null), [])
})

test('adapter keeps more than 500 records without truncation', async () => {
  const adapter = createLocalStorageAdapter(storage())
  const drafts = Array.from({ length: 501 }, (_, index) => sleepDraft((index % 20) + 1))
  await adapter.create(null, drafts, '批量')
  await adapter.create(null, [sleepDraft(9)], '第 502 条')
  assert.equal((await adapter.load(null)).length, 502)
})

test('adapter blocks writes when storage is corrupted', async () => {
  const raw = '{"broken":'
  const adapter = createLocalStorageAdapter(storage(raw))
  assert.equal(await adapter.isLocalDataCorrupted(null), true)
  await assert.rejects(() => adapter.create(null, [sleepDraft(7)], 'x'), /已停止写入/)
  await assert.rejects(() => adapter.update(null, 'any', sleepDraft(7)), /已停止写入/)
  await assert.rejects(() => adapter.remove(null, 'any'), /已停止写入/)
})

test('adapter never overwrites the corrupted raw string', async () => {
  const raw = '{"broken":'
  const db = storage(raw)
  const adapter = createLocalStorageAdapter(db)
  await assert.rejects(() => adapter.create(null, [sleepDraft(7)], 'x'))
  assert.equal(db.raw(), raw)
})

test('adapter imports a v1 backup file unchanged', async () => {
  const source = createLocalStorageAdapter(storage())
  await source.create(null, [sleepDraft(7)], '睡了7小时')
  const backup = await source.exportBackup(null)
  assert.equal(backup.schema, BACKUP_SCHEMA)
  assert.equal(backup.version, BACKUP_VERSION)

  const target = createLocalStorageAdapter(storage('{"broken":'))
  assert.equal(await target.restoreBackup(null, JSON.parse(JSON.stringify(backup))), 1)
  assert.equal(await target.isLocalDataCorrupted(null), false)
  assert.equal((await target.load(null))[0].hours, 7)
})

test('adapter export contains every record', async () => {
  const adapter = createLocalStorageAdapter(storage())
  await adapter.create(null, Array.from({ length: 41 }, (_, index) => sleepDraft((index % 8) + 1)), '导出前')
  const backup = await adapter.exportBackup(null)
  assert.equal(backup.records.length, 41)
  assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)))
})

test('adapter async export resolves and async errors reject cleanly', async () => {
  const adapter = createLocalStorageAdapter(storage())
  const backup = await adapter.exportBackup(null)
  assert.equal(backup.schema, BACKUP_SCHEMA)
  assert.equal(await adapter.isLocalDataCorrupted(null), false)
})

test('adapter surfaces quota errors without data loss', async () => {
  const db = storage()
  await createLocalStorageAdapter(db).create(null, [sleepDraft(7)], '已有记录')
  const full = { getItem: db.getItem, setItem() { throw new Error('QuotaExceededError') } }
  await assert.rejects(() => createLocalStorageAdapter(full).create(null, [sleepDraft(8)], 'x'), /存储空间不足/)
  assert.equal((await createLocalStorageAdapter(db).load(null)).length, 1, '写入失败后原记录仍在')
})
