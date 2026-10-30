import test from 'node:test'
import assert from 'node:assert/strict'
import { addDemoRecords, deleteDemoRecord, exportDemoBackup, isDemoStorageCorrupted, readDemoRecords, restoreDemoBackup, updateDemoRecord, BACKUP_SCHEMA, BACKUP_VERSION } from '../lib/life-demo-store.ts'

function storage(initial) {
  const map = new Map(initial === undefined ? [] : [['life-tracker:life-records:demo:v1', initial]])
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    raw: () => map.get('life-tracker:life-records:demo:v1') ?? null,
  }
}

const sleepDraft = hours => ({ type: 'sleep', date: '2026-10-20', hours, note: '' })

test('confirmed demo records can be created, edited and deleted', () => {
  const db = storage()
  const [created] = addDemoRecords(db, [sleepDraft(7)], '睡了7小时')
  assert.equal(readDemoRecords(db)[0].hours, 7)
  updateDemoRecord(db, created.id, { type: 'sleep', date: '2026-10-20', hours: 8, note: '补觉' })
  assert.equal(readDemoRecords(db)[0].hours, 8)
  deleteDemoRecord(db, created.id)
  assert.deepEqual(readDemoRecords(db), [])
})

test('valid JSON records are read back unchanged', () => {
  const db = storage()
  addDemoRecords(db, [sleepDraft(7), sleepDraft(6)], '睡了两觉')
  assert.equal(readDemoRecords(db).length, 2)
  assert.equal(readDemoRecords(db)[0].hours, 7)
  assert.equal(readDemoRecords(db)[1].hours, 6)
})

test('more than 500 records are not silently truncated', () => {
  const db = storage()
  const drafts = Array.from({ length: 501 }, (_, index) => sleepDraft((index % 20) + 1))
  addDemoRecords(db, drafts, '批量')
  addDemoRecords(db, [sleepDraft(9)], '第 502 条')
  assert.equal(readDemoRecords(db).length, 502)
})

test('corrupted JSON is never overwritten by later writes', () => {
  const raw = '{"broken":'
  const db = storage(raw)
  assert.equal(isDemoStorageCorrupted(db), true)
  assert.deepEqual(readDemoRecords(db), [])
  assert.throws(() => addDemoRecords(db, [sleepDraft(7)], 'x'), /已停止写入/)
  assert.throws(() => updateDemoRecord(db, 'any', sleepDraft(7)), /已停止写入/)
  assert.throws(() => deleteDemoRecord(db, 'any'), /已停止写入/)
  assert.equal(db.raw(), raw, '原始损坏字符串必须原样保留')
})

test('exported backup contains every record and recovery metadata', () => {
  const db = storage()
  addDemoRecords(db, Array.from({ length: 37 }, (_, index) => sleepDraft((index % 8) + 1)), '导出前')
  const backup = exportDemoBackup(db)
  assert.equal(backup.schema, BACKUP_SCHEMA)
  assert.equal(backup.version, BACKUP_VERSION)
  assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)))
  assert.equal(backup.records.length, 37)
})

test('exported backup keeps corrupted raw data for manual recovery', () => {
  const backup = exportDemoBackup(storage('{"broken":'))
  assert.equal(backup.records.length, 0)
  assert.equal(backup.corruptedRaw, '{"broken":')
})

test('restoreDemoBackup recovers records and rejects invalid files', () => {
  const source = storage()
  addDemoRecords(source, [sleepDraft(7)], '睡了7小时')
  const backup = exportDemoBackup(source)

  const target = storage('{"broken":')
  assert.equal(restoreDemoBackup(target, backup), 1)
  assert.equal(isDemoStorageCorrupted(target), false)
  assert.equal(readDemoRecords(target)[0].hours, 7)

  assert.throws(() => restoreDemoBackup(target, { schema: 'other', version: 1, records: [] }), /不是本应用/)
  assert.throws(() => restoreDemoBackup(target, { schema: BACKUP_SCHEMA, version: 99, records: [] }), /版本不受支持/)
  assert.throws(() => restoreDemoBackup(target, { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, records: [{ type: 'nope' }] }), /无效/)
  assert.equal(restoreDemoBackup(target, backup), 1, '失败的恢复不得破坏存储')
})

test('storage quota errors surface as clear failures without data loss', () => {
  const db = storage()
  addDemoRecords(db, [sleepDraft(7)], '已有记录')
  const full = { getItem: db.getItem, setItem() { throw new Error('QuotaExceededError') } }
  assert.throws(() => addDemoRecords(full, [sleepDraft(8)], 'x'), /存储空间不足/)
  assert.equal(readDemoRecords(db).length, 1, '写入失败后原记录仍在')
})

test('an unrated mood survives backup export and restore without a fabricated score', () => {
  const db = storage()
  addDemoRecords(db, [{ type: 'mood', date: '2026-10-20', note: '心情一般' }], '今天心情一般')
  const backup = exportDemoBackup(db)
  assert.equal('score' in backup.records[0], false)
  const target = storage()
  restoreDemoBackup(target, backup)
  assert.equal(readDemoRecords(target)[0].note, '心情一般')
  assert.equal(readDemoRecords(target)[0].score, undefined)
})
