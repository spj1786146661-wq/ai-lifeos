import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import {
  createMigrationTarget,
  createRoutedLocalAdapter,
  hasIndexedDBSupport,
  isLocalWriteBlocked,
  runGuardedLocalWrite,
  resolveLocalStoreRoute,
} from '../lib/life-migration-routing.ts'
import { createIndexedDBAdapter } from '../lib/indexeddb-adapter.ts'
import { createLocalStorageAdapter } from '../lib/storage-adapter.ts'
import { MIGRATION_STATE_KEY, createInitialMigrationState } from '../lib/life-migration-state.ts'

const STORAGE_KEY = 'life-tracker:life-records:demo:v1'

function memoryStorage(records = []) {
  const map = new Map([[STORAGE_KEY, JSON.stringify(records)]])
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), raw: () => map.get(STORAGE_KEY) }
}

const state = overrides => ({
  ...createInitialMigrationState('2026-10-22T10:00:00.000Z'),
  ...overrides,
})

test('the route is localStorage unless the persisted state says SUCCEEDED', () => {
  for (const raw of [
    null,
    state({ status: 'NOT_STARTED' }),
    state({ status: 'IN_PROGRESS' }),
    state({ status: 'VERIFYING' }),
    state({ status: 'FAILED' }),
  ]) {
    assert.equal(resolveLocalStoreRoute(raw).store, 'localStorage', `status=${raw?.status}`)
  }
})

test('an environment without IndexedDB can never be migrated', () => {
  const original = globalThis.indexedDB
  try {
    globalThis.indexedDB = undefined
    assert.equal(hasIndexedDBSupport(), false)
    // 能力缺失时不需要读取状态即可确定路由。
    assert.equal(resolveLocalStoreRoute(null).store, 'localStorage')
  } finally {
    globalThis.indexedDB = original
  }
})

test('a present IndexedDB factory counts as supported', () => {
  const original = globalThis.indexedDB
  try {
    globalThis.indexedDB = {}
    assert.equal(hasIndexedDBSupport(), true)
    globalThis.indexedDB = null
    assert.equal(hasIndexedDBSupport(), false)
  } finally {
    globalThis.indexedDB = original
  }
})

test('READY_TO_SWITCH still keeps localStorage authoritative', () => {
  const route = resolveLocalStoreRoute(state({ status: 'READY_TO_SWITCH' }))
  assert.equal(route.store, 'localStorage')
  assert.match(route.reason, /尚未显式启用/)
})

test('only SUCCEEDED with indexedDB activeStore routes to IndexedDB', () => {
  assert.equal(resolveLocalStoreRoute(state({ status: 'SUCCEEDED', activeStore: 'indexedDB' })).store, 'indexedDB')
})

test('a SUCCEEDED state claiming localStorage stays on localStorage', () => {
  assert.equal(resolveLocalStoreRoute(state({ status: 'SUCCEEDED', activeStore: 'localStorage' })).store, 'localStorage')
})

test('populated IndexedDB data alone never changes the route', async () => {
  // 这是最关键的一条：不能通过「数据库里有记录」推断已迁移。
  const target = createMigrationTarget({ databaseName: `lifeos-route-${crypto.randomUUID()}` })
  await target.importRawRecordsForMigration([
    { id: 'r1', type: 'sleep', date: '2026-10-22', note: '', sourceText: 'slept', hours: 7 },
  ])
  const rawState = await target.readMigrationState()
  assert.equal(rawState, null)
  assert.equal(resolveLocalStoreRoute(rawState).store, 'localStorage')
})

test('writes are blocked while a migration is in progress', () => {
  assert.equal(isLocalWriteBlocked(state({ status: 'IN_PROGRESS' })).blocked, true)
  assert.equal(isLocalWriteBlocked(state({ status: 'VERIFYING' })).blocked, true)
  assert.equal(isLocalWriteBlocked(state({ status: 'READY_TO_SWITCH' })).blocked, false)
  assert.equal(isLocalWriteBlocked(state({ status: 'FAILED' })).blocked, false)
  assert.match(isLocalWriteBlocked(state({ status: 'IN_PROGRESS' })).message, /暂停/)
})

test('guarded local writes re-read state inside the shared migration lock', async () => {
  const calls = []
  const locks = {
    async request(name, callback) {
      calls.push(['lock', name])
      return callback({ name })
    },
  }
  let wrote = false
  const result = await runGuardedLocalWrite(
    locks,
    async () => {
      calls.push(['state'])
      return state({ status: 'NOT_STARTED' })
    },
    async rawState => {
      calls.push(['write', rawState.status])
      wrote = true
      return 'saved'
    },
  )

  assert.equal(result, 'saved')
  assert.equal(wrote, true)
  assert.deepEqual(calls, [
    ['lock', 'ai-lifeos:local-db-migration:v1'],
    ['state'],
    ['write', 'NOT_STARTED'],
  ])
})

test('guarded local writes do not reach storage while migration is running', async () => {
  let wrote = false
  await assert.rejects(
    () => runGuardedLocalWrite(
      undefined,
      async () => state({ status: 'VERIFYING' }),
      async () => {
        wrote = true
      },
    ),
    error => error?.name === 'LocalWriteBlockedError' && /暂停/.test(error.message),
  )
  assert.equal(wrote, false)
})

test('the routed adapter returns the localStorage adapter before activation', () => {
  const storage = memoryStorage()
  const local = createLocalStorageAdapter(storage)
  const routed = createRoutedLocalAdapter({ store: 'localStorage', reason: 'test' }, local)
  assert.equal(routed, local, '未启用时必须原样返回 localStorage 适配器')
})

test('the routed adapter returns an IndexedDB adapter after activation', async () => {
  const storage = memoryStorage()
  const local = createLocalStorageAdapter(storage)
  const routed = createRoutedLocalAdapter({ store: 'indexedDB', reason: 'test' }, local, {
    databaseName: `lifeos-route-${crypto.randomUUID()}`,
  })
  assert.notEqual(routed, local)
  assert.deepEqual(await routed.load(null), [])
})

test('migration state is stored in the meta store and survives reopening', async () => {
  const name = `lifeos-meta-${crypto.randomUUID()}`
  const first = createIndexedDBAdapter({ databaseName: name })
  const written = state({ status: 'READY_TO_SWITCH', sourceRecordCount: 3 })
  await first.writeMigrationState(written)

  const reopened = createIndexedDBAdapter({ databaseName: name })
  const read = await reopened.readMigrationState()
  assert.equal(read.status, 'READY_TO_SWITCH')
  assert.equal(read.sourceRecordCount, 3)
  assert.equal(read.key, MIGRATION_STATE_KEY)
})

test('reading migration state on a fresh database returns null, not a fabricated state', async () => {
  const target = createIndexedDBAdapter({ databaseName: `lifeos-meta-${crypto.randomUUID()}` })
  assert.equal(await target.readMigrationState(), null)
})

test('writing migration state does not touch the records store', async () => {
  const target = createIndexedDBAdapter({ databaseName: `lifeos-meta-${crypto.randomUUID()}` })
  await target.importRawRecordsForMigration([
    { id: 'r1', type: 'sleep', date: '2026-10-22', note: '', sourceText: '', hours: 7 },
  ])
  await target.writeMigrationState(state({ status: 'VERIFYING' }))

  const records = await target.load(null)
  assert.equal(records.length, 1)
  assert.equal(records[0].id, 'r1')
})

test('a state write failure is surfaced rather than swallowed', async () => {
  const target = createIndexedDBAdapter({ databaseName: `lifeos-meta-${crypto.randomUUID()}` })
  await target.readMigrationState() // 确保数据库已打开
  // 传入不可结构化克隆的值会失败，验证错误能冒出来。
  await assert.rejects(() => target.writeMigrationState({ key: MIGRATION_STATE_KEY, bad: () => 1 }))
})
