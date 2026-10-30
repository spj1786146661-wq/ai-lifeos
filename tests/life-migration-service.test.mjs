import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { createIndexedDBAdapter } from '../lib/indexeddb-adapter.ts'
import { createLocalStorageAdapter } from '../lib/storage-adapter.ts'
import {
  MIGRATION_LOCK_NAME,
  activateMigration,
  createWebLockAcquirer,
  prepareMigration,
  readMigrationStatus,
  recoverInterruptedMigration,
  resetFailedMigration,
} from '../lib/life-migration-service.ts'

/** 全部合成数据；不读取真实 localStorage，也不连接正式 IndexedDB。 */

const uniqueName = () => `lifeos-svc-${crypto.randomUUID()}`
const STORAGE_KEY = 'life-tracker:life-records:demo:v1'

function memoryStorage(initialRecords) {
  const map = new Map()
  if (initialRecords !== undefined) map.set(STORAGE_KEY, JSON.stringify(initialRecords))
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    raw: () => map.get(STORAGE_KEY) ?? null,
  }
}

const exercise = (overrides = {}) => ({
  id: 'ex-1',
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
  id: 'sl-1',
  type: 'sleep',
  date: '2026-10-22',
  note: '',
  sourceText: '睡了7小时',
  createdAt: '2026-10-22T13:00:00.000Z',
  hours: 7,
  ...overrides,
})

function deps({ records = [exercise(), sleep()], now } = {}) {
  const storage = memoryStorage(records)
  return {
    storage,
    source: createLocalStorageAdapter(storage),
    target: createIndexedDBAdapter({ databaseName: uniqueName() }),
    now,
  }
}

test('the initial status is NOT_STARTED with localStorage authoritative', async () => {
  const d = deps()
  const view = await readMigrationStatus(d)
  assert.equal(view.state.status, 'NOT_STARTED')
  assert.equal(view.state.activeStore, 'localStorage')
  assert.equal(view.targetRecordCount, 0)
})

test('a full prepare copies every record and stops at READY_TO_SWITCH', async () => {
  const d = deps()
  const result = await prepareMigration(d)

  assert.equal(result.ok, true, result.message)
  assert.equal(result.state.status, 'READY_TO_SWITCH')
  assert.equal(result.state.activeStore, 'localStorage', '校验通过不得自动切换')
  assert.equal(result.engineResult.recordCount, 2)
  assert.ok(result.backup, '迁移前必须生成备份')
  assert.equal(result.backup.records.length, 2)

  const targetRecords = await d.target.load(null)
  assert.deepEqual(targetRecords.map(r => r.id).sort(), ['ex-1', 'sl-1'])
})

test('custom and nested fields survive the full service path', async () => {
  const custom = exercise({ moodTag: 'positive', legacyBlob: { nested: [1, 2] } })
  const d = deps({ records: [custom] })
  const result = await prepareMigration(d)

  assert.equal(result.ok, true, result.message)
  const [loaded] = await d.target.load(null)
  assert.equal(loaded.moodTag, 'positive')
  assert.deepEqual(loaded.legacyBlob, { nested: [1, 2] })
})

test('an empty source migrates to an empty target and can be activated', async () => {
  const d = deps({ records: [] })
  const prepared = await prepareMigration(d)
  assert.equal(prepared.ok, true, prepared.message)
  assert.equal(prepared.state.status, 'READY_TO_SWITCH')

  const activated = await activateMigration(d)
  assert.equal(activated.ok, true, activated.message)
  assert.equal(activated.state.status, 'SUCCEEDED')
  assert.equal(activated.state.activeStore, 'indexedDB')
})

test('corrupted source data is rejected and nothing is written', async () => {
  const d = deps()
  d.storage.setItem(STORAGE_KEY, '{"broken":')

  const result = await prepareMigration(d)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SOURCE_CORRUPTED')
  assert.deepEqual(await d.target.load(null), [])
  assert.equal(result.state.status, 'FAILED')
})

test('duplicate ids are rejected without writing to the target', async () => {
  const d = deps({ records: [exercise(), exercise()] })
  const result = await prepareMigration(d)

  assert.equal(result.ok, false)
  assert.equal(result.state.status, 'FAILED')
  assert.deepEqual(await d.target.load(null), [])
})

test('activation requires READY_TO_SWITCH and cannot be forced early', async () => {
  const d = deps()
  const result = await activateMigration(d)

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'NOT_READY')
  assert.equal(result.state.status, 'NOT_STARTED')
})

test('activation enables indexedDB only after a successful prepare', async () => {
  const d = deps()
  await prepareMigration(d)
  const result = await activateMigration(d)

  assert.equal(result.ok, true, result.message)
  assert.equal(result.state.status, 'SUCCEEDED')
  assert.equal(result.state.activeStore, 'indexedDB')
  assert.match(result.message, /旧 localStorage 数据仍然保留/)
})

test('activation refuses when the source changed after verification', async () => {
  const d = deps()
  await prepareMigration(d)

  // 模拟另一个旧标签页在校验后又写了一条记录。
  const current = JSON.parse(d.storage.raw())
  current.push(sleep({ id: 'late-write' }))
  d.storage.setItem(STORAGE_KEY, JSON.stringify(current))

  const result = await activateMigration(d)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SOURCE_CHANGED')
  assert.equal(result.state.activeStore, 'localStorage', '拒绝后权威源不得改变')
})

test('activation refuses when the target changed after verification', async () => {
  const d = deps()
  await prepareMigration(d)

  // 目标库被外部改写（不是通过来源），指纹会不一致。
  const tampered = createIndexedDBAdapter({ databaseName: 'tamper-placeholder' })
  assert.ok(tampered)
  const original = await d.target.load(null)
  await d.target.remove(null, original[0].id)

  const result = await activateMigration(d)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'TARGET_CHANGED')
  assert.equal(result.state.activeStore, 'localStorage')
})

test('a second prepare while SUCCEEDED is refused', async () => {
  const d = deps()
  await prepareMigration(d)
  await activateMigration(d)

  const result = await prepareMigration(d)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'ALREADY_ENABLED')
})

test('revalidating READY_TO_SWITCH succeeds without trying to rewrite a non-empty target', async () => {
  const d = deps()
  const first = await prepareMigration(d)
  assert.equal(first.ok, true, first.message)

  const second = await prepareMigration(d)
  assert.equal(second.ok, true, second.message)
  assert.equal(second.state.status, 'READY_TO_SWITCH')
  assert.equal(second.state.activeStore, 'localStorage')
  assert.equal(second.engineResult, null)
  assert.match(second.message, /重新校验/)
  assert.equal((await d.target.load(null)).length, 2)
})

test('revalidating READY_TO_SWITCH fails safely if the source changed', async () => {
  const d = deps()
  await prepareMigration(d)
  const current = JSON.parse(d.storage.raw())
  current.push(sleep({ id: 'changed-before-revalidate' }))
  d.storage.setItem(STORAGE_KEY, JSON.stringify(current))

  const result = await prepareMigration(d)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SOURCE_CHANGED')
  assert.equal(result.state.status, 'FAILED')
  assert.equal(result.state.activeStore, 'localStorage')
  assert.equal((await d.target.load(null)).length, 2, '目标现场不得被覆盖或删除')
})

test('a failed migration can be reset and retried without deleting records', async () => {
  const d = deps({ records: [exercise()] })
  // 先制造一个失败：让目标库非空。
  await d.target.importRawRecordsForMigration([sleep({ id: 'pre-existing' })])

  const failed = await prepareMigration(d)
  assert.equal(failed.ok, false)
  assert.equal(failed.state.status, 'FAILED')

  const reset = await resetFailedMigration(d)
  assert.equal(reset.ok, true)
  assert.equal(reset.state.status, 'NOT_STARTED')
  assert.match(reset.message, /不会被自动删除/)

  const stillThere = await d.target.load(null)
  assert.equal(stillThere.length, 1, '重置不得删除残留记录')
  assert.equal(stillThere[0].id, 'pre-existing')
})

test('reset is refused unless the state is FAILED', async () => {
  const d = deps()
  const result = await resetFailedMigration(d)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'NOT_FAILED')
})

test('the source localStorage is never modified by a successful migration', async () => {
  const d = deps()
  const before = d.storage.raw()
  await prepareMigration(d)
  await activateMigration(d)
  assert.equal(d.storage.raw(), before, '旧 localStorage 必须原样保留')
})

test('migration state survives re-reading through a fresh adapter', async () => {
  const name = uniqueName()
  const storage = memoryStorage([exercise()])
  const source = createLocalStorageAdapter(storage)
  const target = createIndexedDBAdapter({ databaseName: name })
  await prepareMigration({ source, target })

  const reopened = createIndexedDBAdapter({ databaseName: name })
  const view = await readMigrationStatus({ source, target: reopened })
  assert.equal(view.state.status, 'READY_TO_SWITCH')
  assert.equal(view.sourceUnchanged, true)
})

test('the source unchanged flag turns false after a later local write', async () => {
  const d = deps()
  await prepareMigration(d)

  const current = JSON.parse(d.storage.raw())
  current.push(sleep({ id: 'after' }))
  d.storage.setItem(STORAGE_KEY, JSON.stringify(current))

  const view = await readMigrationStatus(d)
  assert.equal(view.sourceUnchanged, false)
})

test('an interrupted VERIFYING migration with a complete target is recovered without rewriting', async () => {
  const d = deps()
  const sourceRecords = await d.source.load(null)
  const fingerprint = await (await import('../lib/life-migration-state.ts')).fingerprintRecords(sourceRecords)
  await d.target.importRawRecordsForMigration(sourceRecords)
  const interrupted = {
    ...(await import('../lib/life-migration-state.ts')).createInitialMigrationState('2026-10-22T10:00:00.000Z'),
    status: 'VERIFYING',
    sourceFingerprint: fingerprint,
    sourceRecordCount: sourceRecords.length,
    startedAt: '2026-10-22T10:00:00.000Z',
    attempt: 1,
  }
  await d.target.writeMigrationState(interrupted)

  const result = await recoverInterruptedMigration(d)
  assert.equal(result.ok, true, result.message)
  assert.equal(result.state.status, 'READY_TO_SWITCH')
  assert.equal(result.state.activeStore, 'localStorage')
  assert.equal((await d.target.load(null)).length, sourceRecords.length)
})

test('an interrupted migration with a mismatched target is failed and left untouched', async () => {
  const d = deps()
  const sourceRecords = await d.source.load(null)
  const fingerprint = await (await import('../lib/life-migration-state.ts')).fingerprintRecords(sourceRecords)
  await d.target.importRawRecordsForMigration([exercise({ id: 'unrelated' })])
  const interrupted = {
    ...(await import('../lib/life-migration-state.ts')).createInitialMigrationState('2026-10-22T10:00:00.000Z'),
    status: 'VERIFYING',
    sourceFingerprint: fingerprint,
    sourceRecordCount: sourceRecords.length,
    startedAt: '2026-10-22T10:00:00.000Z',
    attempt: 1,
  }
  await d.target.writeMigrationState(interrupted)

  const result = await recoverInterruptedMigration(d)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'TARGET_MISMATCH')
  assert.equal(result.state.status, 'FAILED')
  assert.deepEqual((await d.target.load(null)).map(record => record.id), ['unrelated'])
})

test('recovery refuses when the source changed after interruption', async () => {
  const d = deps()
  const sourceRecords = await d.source.load(null)
  const fingerprint = await (await import('../lib/life-migration-state.ts')).fingerprintRecords(sourceRecords)
  const interrupted = {
    ...(await import('../lib/life-migration-state.ts')).createInitialMigrationState('2026-10-22T10:00:00.000Z'),
    status: 'IN_PROGRESS',
    sourceFingerprint: fingerprint,
    sourceRecordCount: sourceRecords.length,
    startedAt: '2026-10-22T10:00:00.000Z',
    attempt: 1,
  }
  await d.target.writeMigrationState(interrupted)
  const current = JSON.parse(d.storage.raw())
  current.push(sleep({ id: 'changed-after-interrupt' }))
  d.storage.setItem(STORAGE_KEY, JSON.stringify(current))

  const result = await recoverInterruptedMigration(d)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SOURCE_CHANGED')
  assert.equal(result.state.activeStore, 'localStorage')
  assert.deepEqual(await d.target.load(null), [])
})

test('Web Locks are used when available and reported unavailable otherwise', async () => {
  const calls = []
  const fakeLocks = {
    async request(name, options, callback) {
      calls.push({ name, ifAvailable: options?.ifAvailable })
      return callback({ name })
    },
  }
  const acquire = createWebLockAcquirer(fakeLocks)
  assert.ok(acquire)
  let ran = false
  const acquired = await acquire(MIGRATION_LOCK_NAME, async () => { ran = true })
  assert.equal(acquired, true)
  assert.equal(ran, true)
  assert.equal(calls[0].name, MIGRATION_LOCK_NAME)
  assert.equal(calls[0].ifAvailable, true)

  assert.equal(createWebLockAcquirer(undefined), null, '没有 Web Locks 时必须报告不可用')
})

test('a lock held elsewhere prevents the migration body from running', async () => {
  const fakeLocks = {
    async request(_name, _options, callback) {
      return callback(null) // 锁已被占用
    },
  }
  const acquire = createWebLockAcquirer(fakeLocks)
  let ran = false
  const acquired = await acquire(MIGRATION_LOCK_NAME, async () => { ran = true })
  assert.equal(acquired, false)
  assert.equal(ran, false, '拿不到锁时不得执行迁移')
})

test('two concurrent prepares on one target never both succeed', async () => {
  const name = uniqueName()
  const storage = memoryStorage([exercise()])
  const source = createLocalStorageAdapter(storage)
  const targetA = createIndexedDBAdapter({ databaseName: name })
  const targetB = createIndexedDBAdapter({ databaseName: name })

  const results = await Promise.all([
    prepareMigration({ source, target: targetA }),
    prepareMigration({ source, target: targetB }),
  ])

  const succeeded = results.filter(result => result.ok)
  assert.equal(succeeded.length, 1, `只允许一次成功，实际 ${succeeded.length}`)
  const records = await targetA.load(null)
  assert.equal(records.length, 1)
})

test('the status view reports target count without modifying anything', async () => {
  const d = deps()
  const before = d.storage.raw()
  const view = await readMigrationStatus(d)

  assert.equal(view.state.status, 'NOT_STARTED')
  assert.equal(view.targetRecordCount, 0)
  assert.equal(d.storage.raw(), before)
})
