import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIGRATION_STATE_KEY,
  canTransition,
  canonicalizeForFingerprint,
  createInitialMigrationState,
  fingerprintRecords,
  normalizeMigrationState,
  transitionMigrationState,
} from '../lib/life-migration-state.ts'

const NOW = '2026-10-22T10:00:00.000Z'
const later = offset => new Date(Date.parse(NOW) + offset).toISOString()

test('the initial state is NOT_STARTED and localStorage is authoritative', () => {
  const state = createInitialMigrationState(NOW)
  assert.equal(state.key, MIGRATION_STATE_KEY)
  assert.equal(state.status, 'NOT_STARTED')
  assert.equal(state.activeStore, 'localStorage')
  assert.equal(state.sourceFingerprint, null)
  assert.equal(state.attempt, 0)
})

test('the happy path moves NOT_STARTED → IN_PROGRESS → VERIFYING → READY_TO_SWITCH → SUCCEEDED', () => {
  let state = createInitialMigrationState(NOW)
  state = transitionMigrationState(state, 'IN_PROGRESS', { attempt: 1 }, later(1))
  state = transitionMigrationState(state, 'VERIFYING', {}, later(2))
  state = transitionMigrationState(state, 'READY_TO_SWITCH', { targetRecordCount: 3 }, later(3))
  assert.equal(state.activeStore, 'localStorage', '校验通过不等于已启用')
  state = transitionMigrationState(state, 'SUCCEEDED', { activeStore: 'indexedDB' }, later(4))
  assert.equal(state.activeStore, 'indexedDB')
  assert.equal(state.status, 'SUCCEEDED')
})

test('illegal transitions are rejected', () => {
  const initial = createInitialMigrationState(NOW)
  assert.throws(() => transitionMigrationState(initial, 'SUCCEEDED', { activeStore: 'indexedDB' }), /不允许/)
  assert.throws(() => transitionMigrationState(initial, 'VERIFYING'), /不允许/)
  assert.throws(() => transitionMigrationState(initial, 'READY_TO_SWITCH'), /不允许/)
})

test('SUCCEEDED cannot go back to another state', () => {
  for (const target of ['NOT_STARTED', 'IN_PROGRESS', 'VERIFYING', 'READY_TO_SWITCH', 'FAILED']) {
    assert.equal(canTransition('SUCCEEDED', target), false, `SUCCEEDED → ${target} must be rejected`)
  }
})

test('entering SUCCEEDED requires an explicit indexedDB activeStore', () => {
  let state = createInitialMigrationState(NOW)
  state = transitionMigrationState(state, 'IN_PROGRESS', {}, later(1))
  state = transitionMigrationState(state, 'VERIFYING', {}, later(2))
  state = transitionMigrationState(state, 'READY_TO_SWITCH', {}, later(3))

  assert.throws(() => transitionMigrationState(state, 'SUCCEEDED', {}, later(4)), /只有显式启用/)
})

test('a non-SUCCEEDED state cannot claim indexedDB is authoritative', () => {
  const initial = createInitialMigrationState(NOW)
  assert.throws(
    () => transitionMigrationState(initial, 'IN_PROGRESS', { activeStore: 'indexedDB' }),
    /不得为 indexedDB/,
  )
})

test('FAILED can restart, and reset never fabricates a successful state', () => {
  assert.equal(canTransition('FAILED', 'IN_PROGRESS'), true)
  assert.equal(canTransition('FAILED', 'SUCCEEDED'), false)
})

test('normalizeMigrationState treats missing or corrupted state as NOT_STARTED', () => {
  for (const raw of [null, undefined, {}, { key: 'wrong', status: 'SUCCEEDED' }, { key: MIGRATION_STATE_KEY, status: 'BOGUS' }]) {
    const state = normalizeMigrationState(raw, NOW)
    assert.equal(state.status, 'NOT_STARTED', `raw=${JSON.stringify(raw)}`)
    assert.equal(state.activeStore, 'localStorage')
  }
})

test('a SUCCEEDED state without indexedDB activeStore is rejected as invalid', () => {
  // 防止手工篡改的持久化数据让界面误以为已经启用，或阻断安全重试。
  const tampered = { key: MIGRATION_STATE_KEY, status: 'SUCCEEDED', activeStore: 'localStorage', updatedAt: NOW }
  const state = normalizeMigrationState(tampered, NOW)
  assert.equal(state.status, 'FAILED')
  assert.equal(state.activeStore, 'localStorage')
  assert.equal(state.errorCode, 'INVALID_ACTIVE_STORE')
})

test('fingerprints are stable across key order and record order', async () => {
  const a = { id: 'a', type: 'sleep', date: '2026-10-22', hours: 7, note: '' }
  const b = { note: '', hours: 7, date: '2026-10-22', type: 'sleep', id: 'b' }
  const reordered = [{ ...b }, { ...a }]

  const first = await fingerprintRecords([a, b])
  const second = await fingerprintRecords(reordered)
  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{64}$/)
})

test('any field change alters the fingerprint', async () => {
  const base = [{ id: 'a', type: 'sleep', date: '2026-10-22', hours: 7, note: '' }]
  const changed = [{ id: 'a', type: 'sleep', date: '2026-10-22', hours: 8, note: '' }]
  const added = [{ ...base[0], extra: 1 }]

  const original = await fingerprintRecords(base)
  assert.notEqual(await fingerprintRecords(changed), original)
  assert.notEqual(await fingerprintRecords(added), original)
})

test('fingerprint distinguishes types that JSON would collapse', async () => {
  const withNumber = [{ id: 'a', v: 1 }]
  const withString = [{ id: 'a', v: '1' }]
  assert.notEqual(await fingerprintRecords(withNumber), await fingerprintRecords(withString))
  assert.notEqual(canonicalizeForFingerprint(1), canonicalizeForFingerprint('1'))
  assert.notEqual(canonicalizeForFingerprint(undefined), canonicalizeForFingerprint(null))
})

test('an empty record set has a stable fingerprint', async () => {
  const empty = await fingerprintRecords([])
  assert.match(empty, /^[0-9a-f]{64}$/)
  assert.equal(empty, await fingerprintRecords([]))
})
