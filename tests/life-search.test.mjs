import test from 'node:test'
import assert from 'node:assert/strict'
import { searchLifeRecords } from '../lib/life-search.ts'

/** @type {Array<import('../lib/life-records.ts').LifeRecord>} */
const records = [
  { id: 'a', type: 'exercise', date: '2026-10-22', note: '', sourceText: '今天练了胸，卧推60公斤做了4组', activity: '卧推', weightKg: 60, sets: 4 },
  { id: 'b', type: 'sleep', date: '2026-10-22', note: '半夜醒了一次', sourceText: '' },
  { id: 'c', type: 'expense', date: '2026-10-20', note: '午饭', sourceText: '午饭花了38元', amount: 38, currency: 'CNY' },
  { id: 'd', type: 'mood', date: '2026-10-19', note: '心情不错', sourceText: '', score: 4 },
  { id: 'e', type: 'learning', date: '2026-09-01', note: '', sourceText: '', subject: '英语', durationMinutes: 45 },
]

test('search finds a record by the words the user typed', () => {
  const hits = searchLifeRecords(records, '卧推')
  assert.deepEqual(hits.map(hit => hit.record.id), ['a'])
  assert.ok(hits[0].fields.includes('activity'))
})

test('search matches the original sentence, notes and type labels', () => {
  assert.deepEqual(searchLifeRecords(records, '练了胸').map(hit => hit.record.id), ['a'])
  assert.deepEqual(searchLifeRecords(records, '半夜').map(hit => hit.record.id), ['b'])
  assert.deepEqual(searchLifeRecords(records, '运动').map(hit => hit.record.id), ['a'])
  assert.deepEqual(searchLifeRecords(records, '午饭花了').map(hit => hit.record.id), ['c'])
})

test('search finds records by date', () => {
  assert.deepEqual(searchLifeRecords(records, '2026-10-22').map(hit => hit.record.id), ['a', 'b'])
  assert.deepEqual(searchLifeRecords(records, '2026-09').map(hit => hit.record.id), ['e'])
})

test('search ignores surrounding spaces and finds nothing for a blank query', () => {
  assert.deepEqual(searchLifeRecords(records, '  卧推 ').map(hit => hit.record.id), ['a'])
  assert.deepEqual(searchLifeRecords(records, ''), [])
  assert.deepEqual(searchLifeRecords(records, '   '), [])
})

test('search returns the stored records unchanged', () => {
  const hits = searchLifeRecords(records, '38')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].record, records[2])
})

test('search finds nothing when no record matches', () => {
  assert.deepEqual(searchLifeRecords(records, '游泳'), [])
})

test('search matches the same text regardless of full-width input', () => {
  const wide = searchLifeRecords(records, '３８')
  assert.deepEqual(wide.map(hit => hit.record.id), ['c'])
})
