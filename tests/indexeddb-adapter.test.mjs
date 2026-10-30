import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { createIndexedDBAdapter, IDB_DEFAULT_DATABASE } from '../lib/indexeddb-adapter.ts'
import { BACKUP_SCHEMA, BACKUP_VERSION } from '../lib/life-demo-store.ts'

const sleepDraft = hours => ({ type: 'sleep', date: '2026-10-20', hours, note: '' })
const uniqueName = () => `lifeos-test-${crypto.randomUUID()}`

test('reads an empty database as an empty array', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  assert.deepEqual(await adapter.load(null), [])
})

test('creates a single record and loads it back', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const [created] = await adapter.create(null, [sleepDraft(7)], '睡了7小时')
  assert.ok(created.id)
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, created.id)
  assert.equal(loaded[0].sourceText, '睡了7小时')
})

test('creates multiple records in one transaction', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const created = await adapter.create(null, [sleepDraft(7), sleepDraft(6), sleepDraft(8)], '三觉')
  assert.equal(created.length, 3)
  assert.equal((await adapter.load(null)).length, 3)
})

test('updates a record keeping its id', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const [created] = await adapter.create(null, [sleepDraft(7)], '睡了7小时')
  await adapter.update(null, created.id, sleepDraft(8))
  const [loaded] = await adapter.load(null)
  assert.equal(loaded.id, created.id)
  assert.equal(loaded.hours, 8)
  assert.equal(await adapter.update(null, 'missing-id', sleepDraft(7)).catch(e => e.message), '记录不存在')
})

test('deletes exactly the target record', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const [a] = await adapter.create(null, [sleepDraft(7)], 'A')
  const [b] = await adapter.create(null, [sleepDraft(6)], 'B')
  await adapter.remove(null, a.id)
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, b.id)
  assert.equal(await adapter.remove(null, a.id).catch(e => e.message), '记录不存在')
})

test('records survive closing and reopening the database', async () => {
  const name = uniqueName()
  const first = createIndexedDBAdapter({ databaseName: name })
  const [created] = await first.create(null, [sleepDraft(7)], '持久化')
  const reopened = createIndexedDBAdapter({ databaseName: name })
  const loaded = await reopened.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, created.id)
  assert.equal(loaded[0].hours, 7)
})

test('schema contains indexes based on the actual record fields', async () => {
  const factory = globalThis.indexedDB
  const name = uniqueName()
  const adapter = createIndexedDBAdapter({ databaseName: name })
  await adapter.load(null)
  const db = await new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const tx = db.transaction('records', 'readonly')
  const indexNames = Array.from(tx.objectStore('records').indexNames).sort()
  db.close()
  assert.deepEqual(indexNames, ['by_date', 'by_type_date'])
})

test('restoring a backup with duplicate internal IDs is rejected without touching data', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const [existing] = await adapter.create(null, [sleepDraft(7)], '原始记录')
  const duplicated = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), records: [{ ...sleepDraft(2), id: 'dup-1', sourceText: '重复' }, { ...sleepDraft(3), id: 'dup-1', sourceText: '同ID' }] }
  await assert.rejects(() => adapter.restoreBackup(null, duplicated))
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, existing.id, '旧记录必须原样保留')
})

test('restore rolls back clear and every write when a later write fails', async () => {
  const name = uniqueName()
  const seed = createIndexedDBAdapter({ databaseName: name })
  const [existing] = await seed.create(null, [sleepDraft(7)], '已有记录')

  let addCalls = 0
  const realFactory = globalThis.indexedDB
  const failingFactory = {
    open(name2, version) {
      const request = realFactory.open(name2, version)
      request.addEventListener('success', () => {
        const db = request.result
        const origTransaction = db.transaction.bind(db)
        db.transaction = (stores, mode) => {
          const tx = origTransaction(stores, mode)
          const origObjectStore = tx.objectStore.bind(tx)
          tx.objectStore = storeName => {
            const store = origObjectStore(storeName)
            const origAdd = store.add.bind(store)
            store.add = value => {
              addCalls += 1
              if (addCalls === 2) throw new Error('模拟恢复写入失败')
              return origAdd(value)
            }
            return store
          }
          return tx
        }
      }, { once: true })
      return request
    },
  }

  const adapter = createIndexedDBAdapter({ databaseName: name, indexedDBFactory: failingFactory })
  const backup = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    records: [
      { ...sleepDraft(2), id: 'restore-1', sourceText: '一' },
      { ...sleepDraft(3), id: 'restore-2', sourceText: '二' },
    ],
  }
  await assert.rejects(() => adapter.restoreBackup(null, backup), /模拟恢复写入失败|中止/)
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, existing.id, 'clear 和第一条写入都必须随事务回滚')
})

test('a mid-transaction write failure rolls back the whole batch', async () => {
  const name = uniqueName()
  const seed = createIndexedDBAdapter({ databaseName: name })
  const [existing] = await seed.create(null, [sleepDraft(7)], '已有记录')

  // Wrap the real factory so the 2nd `add` request throws mid-transaction.
  let addCalls = 0
  const realFactory = globalThis.indexedDB
  const failingFactory = {
    open(name2, version) {
      const request = realFactory.open(name2, version)
      request.addEventListener('success', () => {
        const db = request.result
        const origTransaction = db.transaction.bind(db)
        db.transaction = (stores, mode) => {
          const tx = origTransaction(stores, mode)
          const origObjectStore = tx.objectStore.bind(tx)
          tx.objectStore = storeName => {
            const store = origObjectStore(storeName)
            const origAdd = store.add.bind(store)
            store.add = value => {
              addCalls += 1
              if (addCalls === 2) throw new Error('模拟写入失败')
              return origAdd(value)
            }
            return store
          }
          return tx
        }
      }, { once: true })
      return request
    },
  }

  const adapter = createIndexedDBAdapter({ databaseName: name, indexedDBFactory: failingFactory })
  await assert.rejects(() => adapter.create(null, [sleepDraft(5), sleepDraft(6)], '两笔'), /模拟写入失败|中止/)
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, existing.id, '事务必须整体回滚，第一笔也不得提交')
})

test('an injected duplicate ID aborts the whole batch without overwriting', async () => {
  const adapter = createIndexedDBAdapter({
    databaseName: uniqueName(),
    createRecordId: () => 'fixed-id',
  })
  const [existing] = await adapter.create(null, [sleepDraft(7)], '原始记录')
  await assert.rejects(
    () => adapter.create(null, [sleepDraft(8), sleepDraft(9)], '冲突批次'),
  )
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, existing.id)
  assert.equal(loaded[0].hours, 7)
})

test('exports every record in backup v1 format', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  await adapter.create(null, [sleepDraft(7), sleepDraft(6)], '导出')
  const backup = await adapter.exportBackup(null)
  assert.equal(backup.schema, BACKUP_SCHEMA)
  assert.equal(backup.version, BACKUP_VERSION)
  assert.equal(backup.records.length, 2)
  assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)))
})

test('restores an existing v1 backup file unchanged', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const legacyBackup = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, exportedAt: '2026-10-21T00:00:00.000Z', records: [{ type: 'sleep', date: '2026-10-20', hours: 7, note: '', id: 'legacy-1', sourceText: '睡了7小时', createdAt: '2026-10-20T22:00:00.000Z' }] }
  assert.equal(await adapter.restoreBackup(null, legacyBackup), 1)
  const loaded = await adapter.load(null)
  assert.equal(loaded[0].id, 'legacy-1')
  assert.equal(loaded[0].sourceText, '睡了7小时')
  assert.equal(await adapter.restoreBackup(null, { schema: 'other', version: 1, records: [] }).catch(e => e.message), '这不是本应用导出的备份文件')
})

test('restore rejects impossible dates instead of replacing them with today', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  await adapter.create(null, [sleepDraft(7)], '已有记录')
  const invalidDate = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: '2026-10-21T00:00:00.000Z',
    records: [{ ...sleepDraft(8), id: 'invalid-date', date: '2026-02-30' }],
  }
  await assert.rejects(() => adapter.restoreBackup(null, invalidDate), /日期无效/)
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].hours, 7)
})

test('invalid backups never overwrite existing data', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  await adapter.create(null, [sleepDraft(7)], '已有记录')
  const cases = [
    { schema: 'other', version: 1, records: [] },
    { schema: BACKUP_SCHEMA, version: 99, records: [] },
    { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, records: [{ type: 'nope', date: '2026-10-20', note: '' }] },
    { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, records: [{ ...sleepDraft(1), id: 'x' }, { ...sleepDraft(2), id: 'x' }] },
  ]
  for (const bad of cases) {
    await assert.rejects(() => adapter.restoreBackup(null, bad))
  }
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].hours, 7)
})

test('open failures surface as explicit errors, never as empty data', async () => {
  const brokenFactory = { open() { throw new Error('模拟打开失败') } }
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName(), indexedDBFactory: brokenFactory })
  await assert.rejects(() => adapter.load(null), /IndexedDB/)
  await assert.rejects(() => adapter.create(null, [sleepDraft(7)], 'x'), /IndexedDB/)
  await assert.rejects(() => adapter.isLocalDataCorrupted(null), /IndexedDB/)
})

test('missing IndexedDB environment reports clearly', async () => {
  const saved = globalThis.indexedDB
  delete globalThis.indexedDB
  try {
    const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
    await assert.rejects(() => adapter.load(null), /不支持 IndexedDB/)
  } finally {
    globalThis.indexedDB = saved
  }
})

const rawRecord = overrides => ({
  id: 'raw-1',
  type: 'exercise',
  date: '2026-10-22',
  note: '卧推进步了',
  sourceText: '今天练了胸，卧推60公斤做了4组',
  createdAt: '2026-10-22T13:00:00.000Z',
  activity: '卧推',
  weightKg: 60,
  sets: 4,
  moodTag: 'positive',
  legacyBlob: { nested: [1, 2], tags: ['a', 'b'] },
  ...overrides,
})

test('the migration import writes records exactly as they were given', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const records = [rawRecord(), { ...rawRecord({ id: 'raw-2', type: 'sleep', hours: 7 }) }]

  const result = await adapter.importRawRecordsForMigration(records)

  assert.deepEqual(result, { written: 2 })
  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 2)

  const first = loaded.find(record => record.id === 'raw-1')
  assert.equal(first.createdAt, '2026-10-22T13:00:00.000Z', 'createdAt 必须原样保留')
  assert.equal(first.sourceText, '今天练了胸，卧推60公斤做了4组')
  assert.equal(first.note, '卧推进步了')
  assert.equal(first.moodTag, 'positive', '未知字段必须保留')
  assert.deepEqual(first.legacyBlob, { nested: [1, 2], tags: ['a', 'b'] }, '嵌套对象和数组必须保留')
})

test('the migration import keeps the exact field set without normalizeLifeRecord', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const record = rawRecord({ extraNumber: 3 })
  await adapter.importRawRecordsForMigration([record])

  const [loaded] = await adapter.load(null)
  assert.deepEqual(Object.keys(loaded).sort(), Object.keys(record).sort())
})

test('the migration import does not mutate the source records', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const record = rawRecord()
  const before = JSON.stringify(record)

  await adapter.importRawRecordsForMigration([record])

  assert.equal(JSON.stringify(record), before, '来源对象不得被改写')
})

test('the migration import refuses a non-empty target inside the same transaction', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  await adapter.importRawRecordsForMigration([rawRecord({ id: 'first' })])

  await assert.rejects(() => adapter.importRawRecordsForMigration([rawRecord({ id: 'second' })]), error => {
    assert.equal(error.name, 'MigrationTargetNotEmptyError')
    assert.equal(error.existingCount, 1)
    return true
  })

  const loaded = await adapter.load(null)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'first', '拒绝后不得写入或覆盖任何记录')
})

test('the migration import rejects records without a usable id before touching the database', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  const cases = [
    rawRecord({ id: undefined }),
    rawRecord({ id: '' }),
    rawRecord({ id: 42 }),
  ]

  for (const [index, record] of cases.entries()) {
    await assert.rejects(() => adapter.importRawRecordsForMigration([record]), /ID/, `case ${index}`)
  }
  assert.deepEqual(await adapter.load(null), [], '非法输入不得创建或写入数据库')
})

test('the migration import rejects duplicate ids without writing anything', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  await assert.rejects(() => adapter.importRawRecordsForMigration([rawRecord(), rawRecord()]), /重复/)
  assert.deepEqual(await adapter.load(null), [])
})

test('the migration import rejects a non-array input', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  await assert.rejects(() => adapter.importRawRecordsForMigration('not-an-array'), /记录数组/)
  await assert.rejects(() => adapter.importRawRecordsForMigration(null), /记录数组/)
  assert.deepEqual(await adapter.load(null), [])
})

test('the migration import rolls back completely when a write fails midway', async () => {
  const name = uniqueName()
  const adapter = createIndexedDBAdapter({ databaseName: name })
  assert.deepEqual(await adapter.load(null), [])

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

  const failing = createIndexedDBAdapter({ databaseName: name, indexedDBFactory: failingFactory })
  await assert.rejects(
    () => failing.importRawRecordsForMigration([rawRecord({ id: 'x-1' }), rawRecord({ id: 'x-2' })]),
    /模拟迁移写入失败|中止/,
  )

  assert.deepEqual(await adapter.load(null), [], '第一条写入也必须随事务回滚')
})

test('an empty migration import leaves the target empty without creating data', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  assert.deepEqual(await adapter.importRawRecordsForMigration([]), { written: 0 })
  assert.deepEqual(await adapter.load(null), [])
})

test('the migration import is not part of the LifeRecordStorage surface', async () => {
  const adapter = createIndexedDBAdapter({ databaseName: uniqueName() })
  for (const method of ['load', 'create', 'update', 'remove', 'isLocalDataCorrupted', 'exportBackup', 'restoreBackup']) {
    assert.equal(typeof adapter[method], 'function', `${method} 必须仍然存在`)
  }
  assert.equal(typeof adapter.importRawRecordsForMigration, 'function')
})
test('production database name is never used by tests', () => {
  assert.notEqual(uniqueName(), IDB_DEFAULT_DATABASE)
  assert.match(IDB_DEFAULT_DATABASE, /^life-tracker-life-records$/)
})
