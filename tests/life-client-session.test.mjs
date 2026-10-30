import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIFE_CLIENT_SESSION_STORAGE_KEY,
  readOrCreateLifeClientSessionId,
  validLifeClientSessionId,
} from '../lib/life-client-session.ts'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    value(key) {
      return values.get(key)
    },
  }
}

test('a browser session ID is generated once and reused after refresh', () => {
  const storage = memoryStorage()
  let calls = 0
  const factory = () => `session-${++calls}-synthetic`
  const first = readOrCreateLifeClientSessionId(storage, '', factory)
  const afterRefresh = readOrCreateLifeClientSessionId(storage, '', factory)
  assert.equal(first, 'session-1-synthetic')
  assert.equal(afterRefresh, first)
  assert.equal(storage.value(LIFE_CLIENT_SESSION_STORAGE_KEY), first)
  assert.equal(calls, 1)
})

test('an in-memory valid session remains stable when storage is unavailable', () => {
  const storage = {
    getItem() { throw new Error('storage blocked') },
    setItem() { throw new Error('storage blocked') },
  }
  const first = readOrCreateLifeClientSessionId(storage, 'session-memory-0001')
  const second = readOrCreateLifeClientSessionId(storage, first)
  assert.equal(first, 'session-memory-0001')
  assert.equal(second, first)
})

test('session IDs are bounded to a safe stable token format', () => {
  assert.equal(validLifeClientSessionId('session-0001'), true)
  assert.equal(validLifeClientSessionId('short'), false)
  assert.equal(validLifeClientSessionId('has spaces'), false)
  assert.equal(validLifeClientSessionId('x'.repeat(161)), false)
  assert.equal(validLifeClientSessionId(null), false)
})
