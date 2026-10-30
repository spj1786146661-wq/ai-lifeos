import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLocalSource, validateLocalSource } from '../lib/life-migration-validation.ts'

/** 合成数据；本测试不读取、不写入任何真实用户记录。 */

const single = () => ({
  id: 'rec-1',
  type: 'exercise',
  date: '2026-10-22',
  note: '卧推进步了',
  sourceText: '今天练了胸，卧推60公斤做了4组',
  createdAt: '2026-10-22T13:00:00.000Z',
  activity: '卧推',
  weightKg: 60,
  sets: 4,
})

const sleep = () => ({ id: 'rec-2', type: 'sleep', date: '2026-10-22', note: '', sourceText: '睡了7小时', hours: 7 })

function codes(result) {
  return result.valid ? [] : result.errors.map(error => error.code)
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value))
}

test('a single well-formed record passes validation and is returned as the same reference', () => {
  const records = [single()]
  const result = validateLocalSource(records)
  assert.equal(result.valid, true)
  assert.equal(result.recordCount, 1)
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0], records[0], '校验不得改写或复制原始记录')
})

test('multiple well-formed records of every supported type pass validation', () => {
  const records = [
    single(),
    sleep(),
    { id: 'r3', type: 'learning', date: '2026-10-21', note: '', sourceText: '学了2小时电工', subject: '电工', durationMinutes: 120 },
    { id: 'r4', type: 'meal', date: '2026-10-21', note: '', sourceText: '午饭吃了肠粉', food: '肠粉' },
    { id: 'r5', type: 'expense', date: '2026-10-20', note: '', sourceText: '午饭花了38元', amount: 38, currency: 'CNY' },
    { id: 'r6', type: 'mood', date: '2026-10-20', note: '心情不错', sourceText: '', score: 4 },
  ]
  const result = validateLocalSource(records)
  assert.equal(result.valid, true)
  assert.equal(result.recordCount, 6)
})

test('an empty record array is valid empty data, not corrupted data', () => {
  const result = validateLocalSource([])
  assert.equal(result.valid, true)
  assert.equal(result.recordCount, 0)
  assert.deepEqual(result.records, [])
  assert.equal(result.unknownFields.length, 0)
})

test('unparsable JSON text is rejected with JSON_PARSE_FAILED', () => {
  const result = validateLocalSource('{"broken":')
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['JSON_PARSE_FAILED'])
  assert.equal(result.recordCount, null)
  assert.equal(result.errors[0].index, null)
})

test('an absent or empty localStorage value is valid empty data, not corruption', () => {
  for (const source of [null, undefined, '', '[]']) {
    const result = validateLocalSource(source)
    assert.equal(result.valid, true, `source=${JSON.stringify(source)} must be valid`)
    assert.equal(result.recordCount, 0)
    assert.deepEqual(result.records, [])
  }
})

test('a whitespace-only value is treated as corruption, matching readRawStorage()', () => {
  // lib/life-demo-store.ts 只把 null 和 '' 当空数据，其余都走 JSON.parse；
  // '   ' 解析失败，因此现有实现也会标记为损坏。校验必须与它保持一致，
  // 否则迁移会把应用认为损坏的数据判成安全可迁移。
  const result = validateLocalSource('   ')
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['JSON_PARSE_FAILED'])
})

test('valid JSON that is not an array is rejected with ROOT_NOT_ARRAY', () => {
  const result = validateLocalSource('{"records":[]}')
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['ROOT_NOT_ARRAY'])
  assert.equal(result.recordCount, null)
})

test('a non-array parsed value is rejected with ROOT_NOT_ARRAY', () => {
  assert.deepEqual(codes(validateLocalSource({ id: 'r1' })), ['ROOT_NOT_ARRAY'])
  assert.deepEqual(codes(validateLocalSource('null')), ['ROOT_NOT_ARRAY'])
  assert.deepEqual(codes(validateLocalSource('"text"')), ['ROOT_NOT_ARRAY'])
})

test('a missing record id is rejected without generating one', () => {
  const withoutId = { ...single() }
  delete withoutId.id
  const result = validateLocalSource([withoutId])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['ID_MISSING'])
  assert.equal(result.errors[0].index, 0)
  assert.equal(result.errors[0].id, null)
  assert.equal(result.recordCount, 1)
})

test('an empty string id is rejected as ID_EMPTY', () => {
  const result = validateLocalSource([{ ...single(), id: '' }])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['ID_EMPTY'])
})

test('a non-string id is rejected as ID_NOT_STRING', () => {
  const result = validateLocalSource([{ ...single(), id: 42 }])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['ID_NOT_STRING'])
})

test('duplicate ids are reported with both positions and never silently merged', () => {
  const result = validateLocalSource([single(), { ...single(), hours: 5 }])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['ID_DUPLICATE'])
  assert.equal(result.errors[0].index, 1)
  assert.equal(result.errors[0].id, 'rec-1')
  assert.match(result.errors[0].message, /第 1 条/)
})

test('three records sharing an id produce two duplicate errors', () => {
  const result = validateLocalSource([single(), single(), single()])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['ID_DUPLICATE', 'ID_DUPLICATE'])
  assert.equal(result.recordCount, 3)
})

test('an impossible calendar date such as 2026-02-30 is rejected as DATE_INVALID', () => {
  const result = validateLocalSource([{ ...single(), date: '2026-02-30' }])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['DATE_INVALID'])
})

test('dates that are not strict YYYY-MM-DD are rejected', () => {
  for (const date of ['2026-2-3', '2026/10/22', '20261022', 20261022, '', 'not-a-date']) {
    const result = validateLocalSource([{ ...single(), date }])
    assert.equal(result.valid, false, `date=${String(date)} must be invalid`)
    assert.ok(codes(result).includes('DATE_INVALID'))
  }
})

test('a missing date is rejected, not silently defaulted to today', () => {
  const withoutDate = { ...single() }
  delete withoutDate.date
  const result = validateLocalSource([withoutDate])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['DATE_INVALID'])
})

test('an unsupported record type is rejected as TYPE_INVALID', () => {
  const result = validateLocalSource([{ ...single(), type: 'habit' }])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['TYPE_INVALID'])
  assert.equal(result.errors[0].id, 'rec-1')
})

test('missing required fields for each type are reported separately', () => {
  const cases = [
    [{ ...single(), weightKg: undefined, sets: undefined }, 'REQUIRED_FIELD_MISSING'],
    [{ id: 's1', type: 'sleep', date: '2026-10-22', note: '', sourceText: '' }, 'REQUIRED_FIELD_MISSING'],
    [{ id: 'e1', type: 'expense', date: '2026-10-22', note: '', sourceText: '' }, 'REQUIRED_FIELD_MISSING'],
    [{ id: 'l1', type: 'learning', date: '2026-10-22', note: '', sourceText: '' }, 'REQUIRED_FIELD_MISSING'],
    [{ id: 'm1', type: 'meal', date: '2026-10-22', note: '', sourceText: '' }, 'REQUIRED_FIELD_MISSING'],
  ]
  for (const [record, code] of cases) {
    const result = validateLocalSource([record])
    assert.equal(result.valid, false, `type=${record.type} must be rejected`)
    assert.ok(codes(result).includes(code), `type=${record.type} should report ${code}`)
  }
})

test('an unrated mood is valid and preserves its description', () => {
  const result = validateLocalSource([
    { id: 'm1', type: 'mood', date: '2026-10-22', note: '心情一般', sourceText: '今天心情一般' },
  ])
  assert.equal(result.valid, true)
  assert.equal(result.records[0].note, '心情一般')
  assert.equal(result.records[0].score, undefined)
})

test('wrong field types are rejected as FIELD_TYPE_INVALID', () => {
  const cases = [
    { ...single(), weightKg: '60' },
    { ...single(), sets: 2.5 },
    { ...single(), durationMinutes: 0 },
    { ...sleep(), hours: 30 },
    { ...sleep(), hours: null },
    { id: 'e2', type: 'expense', date: '2026-10-22', note: '', sourceText: '', amount: 0 },
    { id: 'e3', type: 'expense', date: '2026-10-22', note: '', sourceText: '', amount: 38, currency: 'USD' },
    { id: 'd2', type: 'mood', date: '2026-10-22', note: '', sourceText: '', score: 6 },
    { id: 'd3', type: 'mood', date: '2026-10-22', note: '', sourceText: '', score: 4.5 },
    { ...single(), note: 5 },
    { ...single(), sourceText: ['a'] },
  ]
  for (const record of cases) {
    const result = validateLocalSource([record])
    assert.equal(result.valid, false, `record must be rejected`)
    assert.ok(codes(result).includes('FIELD_TYPE_INVALID'))
  }
})

test('a non-object entry inside the array is reported as RECORD_NOT_OBJECT', () => {
  const result = validateLocalSource([single(), 'oops', null, 7])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['RECORD_NOT_OBJECT', 'RECORD_NOT_OBJECT', 'RECORD_NOT_OBJECT'])
  assert.equal(result.recordCount, 4)
})

test('all problems in one batch are collected instead of stopping at the first', () => {
  const result = validateLocalSource([
    { ...single(), date: '2026-02-30', type: 'habit' },
    { id: '', type: 'sleep', date: '2026-10-22', note: '', sourceText: '', hours: 7 },
    { id: 'rec-1', type: 'mood', date: '2026-10-22', note: '', sourceText: '', score: 9 },
  ])
  assert.equal(result.valid, false)
  assert.ok(codes(result).includes('DATE_INVALID'))
  assert.ok(codes(result).includes('TYPE_INVALID'))
  assert.ok(codes(result).includes('ID_EMPTY'))
  assert.ok(codes(result).includes('FIELD_TYPE_INVALID'))
  assert.equal(result.recordCount, 3)
})

test('validation never mutates the input, including nested objects and arrays', () => {
  const records = [
    single(),
    { id: 'bad', type: 'mood', date: '2026-02-30', note: 'x', sourceText: 'y', score: 9, extra: { nested: [1, 2] } },
  ]
  const before = snapshot(records)
  const result = validateLocalSource(records)
  assert.equal(result.valid, false)
  assert.deepEqual(snapshot(records), before, '输入对象必须逐字段保持一致')
  assert.equal(records[0].weightKg, 60)
  assert.equal(records[1].extra.nested.length, 2)
})

test('the original sentence and all structured fields survive validation unchanged', () => {
  const original = {
    id: 'rec-keep',
    type: 'exercise',
    date: '2026-10-22',
    note: '状态很好',
    sourceText: '今天练了胸，卧推60公斤做了4组，心情不错',
    createdAt: '2026-10-22T13:00:00.000Z',
    activity: '卧推',
    weightKg: 60,
    sets: 4,
    durationMinutes: 50,
  }
  const result = validateLocalSource([original])
  assert.equal(result.valid, true)
  const record = result.records[0]
  assert.equal(record.sourceText, '今天练了胸，卧推60公斤做了4组，心情不错')
  assert.equal(record.note, '状态很好')
  assert.equal(record.activity, '卧推')
  assert.equal(record.weightKg, 60)
  assert.equal(record.sets, 4)
  assert.equal(record.durationMinutes, 50)
  assert.equal(record.createdAt, '2026-10-22T13:00:00.000Z')
  assert.equal(record, original, '不得通过 normalize 丢弃任何字段')
})

test('unknown fields are reported as notes but do not block migration', () => {
  const result = validateLocalSource([{ ...single(), moodTag: 'positive', legacyFlag: true }])
  assert.equal(result.valid, true)
  assert.equal(result.unknownFields.length, 1)
  assert.equal(result.unknownFields[0].id, 'rec-1')
  assert.deepEqual(result.unknownFields[0].fields, ['moodTag', 'legacyFlag'])
})

test('records written by the current app pass validation unchanged', () => {
  // 结构与 lib/life-demo-store.ts 的 addDemoRecords 输出一致。
  const stored = [
    { ...single(), createdAt: new Date('2026-10-22T05:00:00.000Z').toISOString() },
    { ...sleep(), createdAt: new Date('2026-10-22T05:00:00.000Z').toISOString() },
  ]
  const raw = JSON.stringify(stored)
  const result = validateLocalSource(raw)
  assert.equal(result.valid, true)
  assert.equal(result.recordCount, 2)
  assert.equal(result.records[0].id, 'rec-1')
  assert.equal(result.records[1].id, 'rec-2')
})

test('a backup produced by exportDemoBackup passes validation through its records array', () => {
  const backup = {
    schema: 'life-tracker.life-records-backup',
    version: 1,
    exportedAt: '2026-10-22T05:00:00.000Z',
    records: [single(), sleep()],
  }
  assert.equal(validateLocalSource(backup.records).valid, true)
  assert.equal(validateLocalSource(backup).valid, false, '整个备份对象不是记录数组，必须被拒绝')
})

test('parseLocalSource separates parse failure from an empty-but-legal value', () => {
  assert.deepEqual(parseLocalSource('[]'), { ok: true, value: [] })
  assert.deepEqual(parseLocalSource(''), { ok: true, value: [] })
  assert.deepEqual(parseLocalSource(null), { ok: true, value: [] })
  const failed = parseLocalSource('{')
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'JSON_PARSE_FAILED')
})

test('the readRawStorage() shape is accepted and its corruptedRaw is treated as corruption', () => {
  const healthy = validateLocalSource({ records: [single(), sleep()], corruptedRaw: null })
  assert.equal(healthy.valid, true)
  assert.equal(healthy.recordCount, 2)

  const corrupted = validateLocalSource({ records: [], corruptedRaw: '{"broken":' })
  assert.equal(corrupted.valid, false)
  assert.deepEqual(codes(corrupted), ['JSON_PARSE_FAILED'])
  assert.equal(corrupted.recordCount, null)
})

test('records missing an id are rejected even though the current restore path would generate one', () => {
  // 说明：restoreDemoBackup() 与 IndexedDB validateBackup() 会为缺失 ID 补 UUID。
  // 迁移校验必须比恢复路径更严格，否则记录身份会被悄悄改变。
  const withoutId = { ...sleep() }
  delete withoutId.id
  const result = validateLocalSource([withoutId])
  assert.equal(result.valid, false)
  assert.deepEqual(codes(result), ['ID_MISSING'])
})
