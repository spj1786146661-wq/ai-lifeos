import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { createIndexedDBAdapter } from '../lib/indexeddb-adapter.ts'
import { canonicalize, collectMigrationDifferences, migrateLifeRecords } from '../lib/life-migration-engine.ts'

/** 全部为合成数据；本测试不读取 localStorage，也不连接正式 IndexedDB 数据库。 */

const uniqueName = () => `lifeos-migrate-${crypto.randomUUID()}`

const target = () => createIndexedDBAdapter({ databaseName: uniqueName() })

const exercise = (overrides = {}) => ({
  id: 'rec-ex-1',
  type: 'exercise',
  date: '2026-10-22',
  note: '卧推进步了',
  sourceText: '今天练了胸，卧推60公斤做了4组',
  createdAt: '2026-10-22T13:00:00.000Z',
  activity: '卧推',
  weightKg: 60,
  sets: 4,
  ...overrides,
})

const sleep = (overrides = {}) => ({
  id: 'rec-sl-1',
  type: 'sleep',
  date: '2026-10-22',
  note: '',
  sourceText: '睡了7小时',
  createdAt: '2026-10-22T13:00:00.000Z',
  hours: 7,
  ...overrides,
})

/** 可控的假目标：用于制造回读阶段的各类差异。 */
/** 可控的假目标：只实现迁移导入接口，用于制造回读阶段的各类差异。 */
function fakeTarget(options = {}) {
  const { initial = [], onLoad, onImport, throwOnImport } = options
  let store = initial.map(value => structuredClone(value))
  let loadCount = 0
  return {
    async load() {
      loadCount += 1
      const current = store.map(value => structuredClone(value))
      return onLoad ? onLoad(current, loadCount) : current
    },
    async importRawRecordsForMigration(records) {
      if (throwOnImport) throw throwOnImport
      if (onImport) return onImport(store, records)
      store = records.map(value => structuredClone(value))
      return { written: store.length }
    },
    snapshot() {
      return store.map(value => structuredClone(value))
    },
  }
}


const snapshot = value => JSON.parse(JSON.stringify(value))
const stages = result => (result.ok ? 'ok' : result.stage)
const fields = result => result.differences.map(difference => difference.field)

test('migrates a single record losslessly into an isolated IndexedDB database', async () => {
  const store = target()
  const source = [exercise()]
  const result = await migrateLifeRecords({ source, target: store })

  assert.equal(result.ok, true, result.message)
  assert.equal(result.recordCount, 1)
  assert.deepEqual(result.differences, [])

  const loaded = await store.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'rec-ex-1', '原始 ID 必须保留')
  assert.equal(loaded[0].sourceText, '今天练了胸，卧推60公斤做了4组')
  assert.equal(loaded[0].createdAt, '2026-10-22T13:00:00.000Z')
})

test('migrates multiple records covering every supported type', async () => {
  const store = target()
  const source = [
    exercise(),
    sleep(),
    { id: 'rec-le-1', type: 'learning', date: '2026-10-21', note: '', sourceText: '学了2小时电工', createdAt: '2026-10-21T10:00:00.000Z', subject: '电工', durationMinutes: 120 },
    { id: 'rec-me-1', type: 'meal', date: '2026-10-21', note: '', sourceText: '午饭吃了肠粉', createdAt: '2026-10-21T04:00:00.000Z', food: '肠粉' },
    { id: 'rec-sp-1', type: 'expense', date: '2026-10-20', note: '', sourceText: '午饭花了38元', createdAt: '2026-10-20T04:00:00.000Z', amount: 38, currency: 'CNY' },
    { id: 'rec-mo-1', type: 'mood', date: '2026-10-20', note: '心情不错', sourceText: '', createdAt: '2026-10-20T12:00:00.000Z', score: 4 },
  ]
  const result = await migrateLifeRecords({ source, target: store })

  assert.equal(result.ok, true, result.message)
  assert.equal(result.recordCount, 6)
  const loaded = await store.load(null)
  assert.deepEqual(loaded.map(record => record.id).sort(), source.map(record => record.id).sort())
})

test('a legitimately empty source migrates as an empty copy without inventing records', async () => {
  const store = target()
  const result = await migrateLifeRecords({ source: [], target: store })

  assert.equal(result.ok, true, result.message)
  assert.equal(result.recordCount, 0)
  assert.deepEqual(await store.load(null), [])
})

test('corrupted JSON is rejected before anything is written', async () => {
  const store = target()
  const result = await migrateLifeRecords({ source: '{"broken":', target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'source_validation')
  assert.deepEqual(result.sourceErrors.map(error => error.code), ['JSON_PARSE_FAILED'])
  assert.deepEqual(await store.load(null), [], '校验失败时目标库必须仍为空')
})

test('a record without an id is rejected and the target stays empty', async () => {
  const store = target()
  const broken = exercise()
  delete broken.id
  const result = await migrateLifeRecords({ source: [broken], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'source_validation')
  assert.deepEqual(result.sourceErrors.map(error => error.code), ['ID_MISSING'])
  assert.deepEqual(await store.load(null), [])
})

test('duplicate ids are rejected before the write stage', async () => {
  const store = target()
  const result = await migrateLifeRecords({ source: [exercise(), exercise()], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'source_validation')
  assert.deepEqual(result.sourceErrors.map(error => error.code), ['ID_DUPLICATE'])
  assert.deepEqual(await store.load(null), [])
})

test('an impossible date is rejected rather than corrected', async () => {
  const store = target()
  const result = await migrateLifeRecords({ source: [exercise({ date: '2026-02-30' })], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'source_validation')
  assert.deepEqual(result.sourceErrors.map(error => error.code), ['DATE_INVALID'])
  assert.deepEqual(await store.load(null), [])
})

test('a non-empty target is refused and its existing records are left untouched', async () => {
  const store = target()
  await store.restoreBackup(null, {
    schema: 'life-tracker.life-records-backup',
    version: 1,
    exportedAt: '2026-10-22T00:00:00.000Z',
    records: [sleep({ id: 'already-there' })],
  })

  const result = await migrateLifeRecords({ source: [exercise()], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'target_not_empty')
  assert.match(result.message, /未写入、未删除、未覆盖/)
  const loaded = await store.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'already-there', '目标库原有记录不得被改动')
})

test('a mid-transaction write failure rolls back and leaves the target empty', async () => {
  const name = uniqueName()
  const seed = createIndexedDBAdapter({ databaseName: name })
  assert.deepEqual(await seed.load(null), [])

  let addCalls = 0
  const realFactory = globalThis.indexedDB
  const failingFactory = {
    open(name2, version) {
      const request = realFactory.open(name2, version)
      request.addEventListener('success', () => {
        const db = request.result
        const originalTransaction = db.transaction.bind(db)
        db.transaction = (stores, mode) => {
          const tx = originalTransaction(stores, mode)
          const originalObjectStore = tx.objectStore.bind(tx)
          tx.objectStore = storeName => {
            const objectStore = originalObjectStore(storeName)
            const originalAdd = objectStore.add.bind(objectStore)
            objectStore.add = value => {
              addCalls += 1
              if (addCalls === 2) throw new Error('模拟迁移写入失败')
              return originalAdd(value)
            }
            return objectStore
          }
          return tx
        }
      }, { once: true })
      return request
    },
  }

  const store = createIndexedDBAdapter({ databaseName: name, indexedDBFactory: failingFactory })
  const result = await migrateLifeRecords({
    source: [exercise(), sleep()],
    target: store,
  })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'write')
  assert.match(result.message, /回滚/)
  assert.deepEqual(await store.load(null), [], '第一条写入也必须随事务回滚')
})

test('a record count difference after writing is reported as a failed verification', async () => {
  const store = fakeTarget({
    onImport(current, records) {
      current.length = 0
      current.push(...records.map(value => structuredClone(value)))
      return { written: records.length }
    },
    onLoad(current) {
      // 引擎现在不再预读目标（判空已移入写入事务），因此这里就是回读：
      // 故意少返回一条，模拟「写进去的比读回来的多」。
      return current.slice(0, 1)
    },
  })

  const result = await migrateLifeRecords({ source: [exercise(), sleep()], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'verify')
  assert.ok(result.differences.some(difference => difference.kind === 'count'))
  assert.match(result.message, /差异/)
})

test('an id difference after writing is reported with the affected id', async () => {
  const store = fakeTarget({
    onImport(_current, records) {
      const renamed = records.map(record => ({ ...record, id: `${record.id}-renamed` }))
      _current.length = 0
      _current.push(...renamed.map(record => structuredClone(record)))
      return { written: renamed.length }
    },
  })

  const result = await migrateLifeRecords({ source: [exercise()], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'verify')
  const kinds = result.differences.map(difference => difference.kind)
  assert.ok(kinds.includes('id_missing'))
  assert.ok(kinds.includes('id_extra'))
  assert.ok(result.differences.some(difference => difference.id === 'rec-ex-1'))
})

test('a changed business field after writing is reported field by field', async () => {
  const store = fakeTarget({
    onImport(_current, records) {
      const changed = records.map(record => ({ ...record, hours: (record.hours ?? 0) + 1 }))
      _current.length = 0
      _current.push(...changed.map(record => structuredClone(record)))
      return { written: changed.length }
    },
  })

  const result = await migrateLifeRecords({ source: [sleep()], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'verify')
  assert.ok(fields(result).includes('hours'))
  const hours = result.differences.find(difference => difference.field === 'hours')
  assert.equal(hours.expected, 'n:7')
  assert.equal(hours.actual, 'n:8')
})

test('a lost original sentence after writing is detected', async () => {
  const store = fakeTarget({
    onImport(_current, records) {
      const changed = records.map(record => ({ ...record, sourceText: '' }))
      _current.length = 0
      _current.push(...changed.map(record => structuredClone(record)))
      return { written: changed.length }
    },
  })

  const result = await migrateLifeRecords({ source: [exercise()], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'verify')
  assert.ok(fields(result).includes('sourceText'))
})

test('unknown fields, nested objects and arrays survive a real migration import', async () => {
  // 本轮修复前 restoreBackup() 会经 normalizeLifeRecord() 重建记录，未知字段必然丢失。
  // 迁移专用写入路径原样保存，因此未知字段、嵌套对象和数组都必须完整保留。
  const store = target()
  const withUnknown = {
    ...exercise(),
    moodTag: 'positive',
    legacyBlob: { nested: [1, 2], tags: ['a', 'b'] },
  }
  const result = await migrateLifeRecords({ source: [withUnknown], target: store })

  assert.equal(result.ok, true, result.message)
  assert.equal(result.recordCount, 1)
  assert.deepEqual(result.differences, [])
  assert.ok(result.unknownFields.some(note => note.fields.includes('moodTag')))

  const [loaded] = await store.load(null)
  assert.equal(loaded.moodTag, 'positive')
  assert.deepEqual(loaded.legacyBlob, { nested: [1, 2], tags: ['a', 'b'] })
  assert.equal(loaded.id, 'rec-ex-1')
  assert.equal(loaded.createdAt, '2026-10-22T13:00:00.000Z')
})

test('a field dropped by the target is still detected and never reported as success', async () => {
  // 如果目标端丢了字段，引擎必须报差异，不能因为「迁移路径本身无损」就默认成功。
  const store = fakeTarget({
    onImport(_current, records) {
      const stripped = records.map(record => {
        const copy = { ...record }
        delete copy.moodTag
        return copy
      })
      _current.length = 0
      _current.push(...stripped.map(record => structuredClone(record)))
      return { written: stripped.length }
    },
  })

  const result = await migrateLifeRecords({ source: [{ ...exercise(), moodTag: 'positive' }], target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'verify')
  assert.ok(fields(result).includes('moodTag'), `expected moodTag in ${JSON.stringify(fields(result))}`)
})

test('a nested value change after writing is reported with a path', async () => {
  const store = fakeTarget({
    onImport(_current, records) {
      const changed = records.map(record => ({
        ...record,
        legacyBlob: { nested: [9, 2] },
      }))
      _current.length = 0
      _current.push(...changed.map(record => structuredClone(record)))
      return { written: changed.length }
    },
  })

  const source = [{ ...exercise(), legacyBlob: { nested: [1, 2] } }]
  const result = await migrateLifeRecords({ source, target: store })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'verify')
  assert.ok(fields(result).includes('legacyBlob.nested[0]'), `expected nested path in ${JSON.stringify(fields(result))}`)
})

test('the old data source is left byte-for-byte unchanged', async () => {
  const raw = JSON.stringify([exercise(), sleep(), { ...exercise(), id: 'rec-ex-2', moodTag: 'x' }])
  const before = raw
  const parsedBefore = snapshot(JSON.parse(raw))

  await migrateLifeRecords({ source: raw, target: target() })

  assert.equal(raw, before)
  assert.deepEqual(snapshot(JSON.parse(raw)), parsedBefore)

  const objects = [exercise(), sleep()]
  const objectsBefore = snapshot(objects)
  await migrateLifeRecords({ source: objects, target: target() })
  assert.deepEqual(snapshot(objects), objectsBefore)
})

test('importing the engine module performs no database work', async () => {
  const before = typeof globalThis.indexedDB.databases === 'function'
    ? (await globalThis.indexedDB.databases()).length
    : null

  const fresh = await import(`../lib/life-migration-engine.ts?probe=${crypto.randomUUID()}`)
  assert.equal(typeof fresh.migrateLifeRecords, 'function')
  assert.equal(typeof fresh.canonicalize, 'function')

  const after = typeof globalThis.indexedDB.databases === 'function'
    ? (await globalThis.indexedDB.databases()).length
    : null
  assert.equal(after, before, '导入模块不得创建任何数据库')
})

test('values that cannot be stored or compared reliably are rejected before writing', async () => {
  const store = target()
  // 未知字段里的 Date 能通过结构校验，但既不能可靠序列化也不能可靠比较。
  const result = await migrateLifeRecords({
    source: [{ ...sleep(), legacyDate: new Date('2026-10-22T13:00:00.000Z') }],
    target: store,
  })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'unsafe_value')
  assert.ok(result.unsafeValues.some(problem => problem.includes('legacyDate')))
  assert.deepEqual(await store.load(null), [], '不可比较的数据不得写进目标库')
})

test('a Date in a known field is caught earlier by structural validation', async () => {
  const store = target()
  const result = await migrateLifeRecords({
    source: [{ ...sleep(), createdAt: new Date('2026-10-22T13:00:00.000Z') }],
    target: store,
  })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'source_validation')
  assert.ok(result.sourceErrors.some(error => error.code === 'FIELD_TYPE_INVALID'))
  assert.deepEqual(await store.load(null), [])
})

test('an interruption before writing leaves the target untouched', async () => {
  const store = target()
  const controller = { aborted: true }
  const result = await migrateLifeRecords({ source: [exercise()], target: store, signal: controller })

  assert.equal(result.ok, false)
  assert.equal(stages(result), 'interrupted')
  assert.deepEqual(await store.load(null), [])
})

test('field order differences do not create false differences', async () => {
  // 同一份数据、不同的键写入顺序，必须判为一致；否则字段顺序会变成假差异。
  const store = target()
  const reordered = Object.fromEntries(Object.entries(exercise()).reverse())
  const result = await migrateLifeRecords({ source: [reordered], target: store })

  assert.equal(result.ok, true, result.message)
  assert.deepEqual(result.differences, [])
})

test('two concurrent migration imports cannot overwrite each other', async () => {
  // 并发导入同一个空库：只允许一个成功，另一个必须因目标非空被拒绝，
  // 且最终库内必须正好是一批完整记录，不存在两批混合或互相覆盖。
  const name = uniqueName()
  const storeA = createIndexedDBAdapter({ databaseName: name })
  const storeB = createIndexedDBAdapter({ databaseName: name })

  const batchA = [exercise({ id: 'batch-a' }), sleep({ id: 'batch-a-sleep' })]
  const batchB = [exercise({ id: 'batch-b' }), sleep({ id: 'batch-b-sleep' })]

  const results = await Promise.allSettled([
    migrateLifeRecords({ source: batchA, target: storeA }),
    migrateLifeRecords({ source: batchB, target: storeB }),
  ])

  const settled = results.map(entry => entry.status === 'fulfilled' ? entry.value : { ok: false, stage: 'write', message: String(entry.reason?.message ?? entry.reason) })
  const succeeded = settled.filter(result => result.ok)
  const refused = settled.filter(result => !result.ok)

  assert.equal(succeeded.length, 1, `只允许一个导入成功，实际 ${succeeded.length} 个`)
  assert.equal(refused.length, 1)
  assert.equal(refused[0].stage, 'target_not_empty', `被拒绝方应报告目标非空，实际 ${refused[0].stage}`)

  const loaded = await storeA.load(null)
  const expectedIds = (succeeded[0].ok ? (loaded.some(record => record.id === 'batch-a') ? batchA : batchB) : []).map(record => record.id).sort()
  assert.deepEqual(loaded.map(record => record.id).sort(), expectedIds, '库内必须正好是一批完整记录')
  assert.equal(loaded.length, 2, '不允许两批混合写入')
})

test('importing the adapter module performs no database work', async () => {
  const countDatabases = async () => (typeof globalThis.indexedDB.databases === 'function' ? (await globalThis.indexedDB.databases()).length : null)
  const before = await countDatabases()

  const fresh = await import(`../lib/indexeddb-adapter.ts?probe=${crypto.randomUUID()}`)

  assert.equal(typeof fresh.createIndexedDBAdapter, 'function')
  assert.equal(typeof fresh.MigrationTargetNotEmptyError, 'function')
  assert.equal(await countDatabases(), before, '导入适配器不得创建任何数据库')
})

test('the migration import writes without calling normalizeLifeRecord', async () => {
  // 证明：经迁移导入的记录，字段集合与来源完全一致（既不多也不少）。
  const store = target()
  const source = [{ ...exercise(), moodTag: 'positive', extraNumber: 3 }]
  const result = await migrateLifeRecords({ source, target: store })

  assert.equal(result.ok, true, result.message)
  const [loaded] = await store.load(null)
  assert.deepEqual(Object.keys(loaded).sort(), Object.keys(source[0]).sort())
})

test('an existing JSON backup export and restore still behave as before', async () => {
  // 本轮只新增迁移导入方法，不得改变现有用户恢复语义。
  const store = target()
  await store.importRawRecordsForMigration([exercise(), sleep()])
  const backup = await store.exportBackup(null)
  assert.equal(backup.schema, 'life-tracker.life-records-backup')
  assert.equal(backup.version, 1)
  assert.equal(backup.records.length, 2)

  // 用户恢复仍然会重建记录、替换整个库，语义与 v1 一致。
  const restored = await store.restoreBackup(null, {
    schema: backup.schema,
    version: backup.version,
    exportedAt: new Date().toISOString(),
    records: [{ id: 'kept-1', type: 'sleep', date: '2026-10-21', note: '', sourceText: '睡了6小时', hours: 6, createdAt: '2026-10-21T22:00:00.000Z' }],
  })
  assert.equal(restored, 1)
  const loaded = await store.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'kept-1')
})

test('the migration import refuses to overwrite records created by normal writes', async () => {
  // 普通写入产生的记录同样受保护：迁移导入不得覆盖它们。
  const store = target()
  const [created] = await store.create(null, [{ type: 'sleep', date: '2026-10-22', hours: 7, note: '' }], '睡了7小时')
  assert.ok(created.id)

  await assert.rejects(() => store.importRawRecordsForMigration([exercise()]), error => {
    assert.equal(error.name, 'MigrationTargetNotEmptyError')
    assert.equal(error.existingCount, 1)
    return true
  })

  const loaded = await store.load(null)
  assert.equal(loaded.length, 1, '拒绝后不得留下任何迁移写入')
  assert.equal(loaded[0].id, created.id)
})
test('canonical serialization is key-order independent but type strict', () => {
  assert.equal(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }))
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: '1' }))
  assert.notEqual(canonicalize({ a: undefined }), canonicalize({}))
  assert.equal(canonicalize({ list: [1, 2] }), canonicalize({ list: [1, 2] }))
  assert.notEqual(canonicalize({ list: [1, 2] }), canonicalize({ list: [2, 1] }))
})

test('difference detection compares every field, not just count and id', () => {
  const expected = [{ id: 'a', hours: 7, note: 'x' }]
  const actual = [{ id: 'a', hours: 7, note: 'y' }]
  const differences = collectMigrationDifferences(expected, actual)

  assert.equal(differences.length, 1)
  assert.equal(differences[0].kind, 'field')
  assert.equal(differences[0].field, 'note')
  assert.equal(differences[0].id, 'a')
})
