import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fingerprintIdempotencyPayload,
  IdempotencyConflictError,
  IdempotencyStore,
} from '../lib/request-idempotency.ts'

const scope = 'synthetic-client-session'
const actionId = 'synthetic-action-0001'
const payload = {
  text: '昨晚睡了7小时',
  date: '2026-10-26',
  records: [],
}
const fingerprint = fingerprintIdempotencyPayload(payload)

test('concurrent requests for one action execute upstream work once', async () => {
  const store = new IdempotencyStore()
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const operation = async () => {
    calls += 1
    await gate
    return { status: 200, body: { saved: 1 } }
  }

  const first = store.run({ scope, actionId, fingerprint, operation })
  const second = store.run({ scope, actionId, fingerprint, operation })
  await Promise.resolve()
  assert.equal(calls, 1)
  release()
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.equal(calls, 1)
  assert.equal(firstResult.mode, 'executed')
  assert.equal(secondResult.mode, 'replayed')
  assert.deepEqual(firstResult.value, secondResult.value)
})

test('a completed action is replayed without repeating upstream work', async () => {
  const store = new IdempotencyStore()
  let calls = 0
  const operation = async () => {
    calls += 1
    return { status: 200, body: { call: calls } }
  }

  const first = await store.run({ scope, actionId, fingerprint, operation })
  const second = await store.run({ scope, actionId, fingerprint, operation })

  assert.equal(calls, 1)
  assert.equal(first.mode, 'executed')
  assert.equal(second.mode, 'replayed')
  assert.deepEqual(second.value, first.value)
})

test('different action IDs may intentionally process identical content', async () => {
  const store = new IdempotencyStore()
  let calls = 0
  const operation = async () => {
    calls += 1
    return { status: 200 }
  }

  await store.run({ scope, actionId: 'synthetic-action-0001', fingerprint, operation })
  await store.run({ scope, actionId: 'synthetic-action-0002', fingerprint, operation })

  assert.equal(calls, 2)
})

test('reusing an action ID for different content is rejected before execution', async () => {
  const store = new IdempotencyStore()
  let calls = 0
  const operation = async () => {
    calls += 1
    return { status: 200 }
  }

  await store.run({ scope, actionId, fingerprint, operation })
  await assert.rejects(
    store.run({
      scope,
      actionId,
      fingerprint: fingerprintIdempotencyPayload({ ...payload, text: '不同内容' }),
      operation,
    }),
    error => error instanceof IdempotencyConflictError
      && error.code === 'IDEMPOTENCY_KEY_REUSED',
  )
  assert.equal(calls, 1)
})

test('a failed operation is removed so an explicit retry can run once', async () => {
  const store = new IdempotencyStore()
  let calls = 0
  const operation = async () => {
    calls += 1
    if (calls === 1) throw new Error('synthetic transport failure')
    return { status: 200 }
  }

  await assert.rejects(
    store.run({ scope, actionId, fingerprint, operation }),
    /synthetic transport failure/,
  )
  const retry = await store.run({ scope, actionId, fingerprint, operation })
  assert.equal(calls, 2)
  assert.equal(retry.mode, 'executed')
})

test('non-cacheable results remain explicitly retryable', async () => {
  const store = new IdempotencyStore()
  let calls = 0
  const operation = async () => {
    calls += 1
    return { status: calls === 1 ? 502 : 200 }
  }
  const shouldCache = result => result.status >= 200 && result.status < 300

  const first = await store.run({ scope, actionId, fingerprint, operation, shouldCache })
  const retry = await store.run({ scope, actionId, fingerprint, operation, shouldCache })
  const replay = await store.run({ scope, actionId, fingerprint, operation, shouldCache })

  assert.equal(first.value.status, 502)
  assert.equal(retry.value.status, 200)
  assert.equal(replay.mode, 'replayed')
  assert.equal(calls, 2)
})

test('completed entries expire after the configured TTL', async () => {
  const store = new IdempotencyStore({ ttlMs: 5 })
  let calls = 0
  const operation = async () => {
    calls += 1
    return { status: 200 }
  }
  await store.run({ scope, actionId, fingerprint, operation })
  await new Promise(resolve => setTimeout(resolve, 15))
  await store.run({ scope, actionId, fingerprint, operation })
  assert.equal(calls, 2)
})

test('separate process-like stores do not share idempotency state', async () => {
  const firstStore = new IdempotencyStore()
  const secondStore = new IdempotencyStore()
  let calls = 0
  const operation = async () => {
    calls += 1
    return { status: 200 }
  }
  await firstStore.run({ scope, actionId, fingerprint, operation })
  await secondStore.run({ scope, actionId, fingerprint, operation })
  assert.equal(calls, 2, 'multi-instance strict idempotency needs shared atomic storage')
})

test('fingerprints are deterministic across object key order', () => {
  assert.equal(
    fingerprintIdempotencyPayload({ text: '记录', records: [{ id: 'r1', date: '2026-10-26' }] }),
    fingerprintIdempotencyPayload({ records: [{ date: '2026-10-26', id: 'r1' }], text: '记录' }),
  )
})
