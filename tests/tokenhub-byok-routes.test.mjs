import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') return nextResolve('next/server.js', context)
    if (specifier.startsWith('@/')) {
      return nextResolve(pathToFileURL(`${path.join(root, specifier.slice(2))}.ts`).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { NextRequest } = await import('next/server.js')
const route = await import(pathToFileURL(
  path.join(root, 'app/api/ai/providers/tokenhub/test/route.ts'),
).href)

process.env.AIOS_PERSONAL_ALPHA_BYOK = '1'
process.env.AIOS_PERSONAL_ALPHA_BYOK_HOST = 'localhost:3100'

function localRequest(body) {
  return new NextRequest('http://localhost:3100/api/ai/providers/tokenhub/test', {
    method: 'POST',
    headers: {
      host: 'localhost:3100',
      origin: 'http://localhost:3100',
      referer: 'http://localhost:3100/',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function crossOriginLocalRequest(body) {
  return new NextRequest('http://localhost:3100/api/ai/providers/tokenhub/test', {
    method: 'POST',
    headers: {
      host: 'localhost:3100',
      origin: 'http://evil.example',
      referer: 'http://evil.example/',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

test('personal Alpha connection test is closed unless explicitly enabled', async () => {
  delete process.env.AIOS_PERSONAL_ALPHA_BYOK
  const originalFetch = globalThis.fetch
  let upstreamCalls = 0
  globalThis.fetch = async () => {
    upstreamCalls += 1
    throw new Error('upstream must not be called')
  }
  try {
    const response = await route.POST(localRequest({
      apiKey: 'synthetic-user-key-disabled-alpha',
      clientSessionId: 'byok-test-session-disabled',
      actionId: 'byok-test-action-disabled',
    }))
    assert.equal(response.status, 403)
    assert.equal(upstreamCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    process.env.AIOS_PERSONAL_ALPHA_BYOK = '1'
  }
})

test('personal Alpha connection test rejects cross-origin callers', async () => {
  const originalFetch = globalThis.fetch
  let upstreamCalls = 0
  globalThis.fetch = async () => {
    upstreamCalls += 1
    throw new Error('upstream must not be called')
  }
  try {
    const response = await route.POST(crossOriginLocalRequest({
      apiKey: 'synthetic-user-key-cross-origin',
      clientSessionId: 'byok-test-session-cross-origin',
      actionId: 'byok-test-action-cross-origin',
    }))
    assert.equal(response.status, 403)
    assert.equal(upstreamCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('BYOK connection test uses only the submitted key and validates structured records', async () => {
  const originalFetch = globalThis.fetch
  const developerKey = process.env.TENCENT_TOKENHUB_API_KEY
  let authorization = null
  let body = null
  process.env.TENCENT_TOKENHUB_API_KEY = 'developer-key-must-not-be-used'
  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init.headers).get('authorization')
    body = JSON.parse(init.body)
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        records: [
          { type: 'exercise', date: '2026-10-28', activity: '散步', durationMinutes: 20 },
          { type: 'learning', date: '2026-10-28', subject: '英语', durationMinutes: 30 },
        ],
        followUps: [],
      }) } }],
      usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const response = await route.POST(localRequest({
      apiKey: 'synthetic-user-key-byok-one',
      clientSessionId: 'byok-test-session-0001',
      actionId: 'byok-test-action-0001',
    }))
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.status, 'connected')
    assert.equal(authorization, 'Bearer synthetic-user-key-byok-one')
    assert.equal(authorization.includes('developer-key'), false)
    assert.equal(body.response_format.type, 'json_object')
    assert.equal(body.thinking.type, 'disabled')
    assert.equal(JSON.stringify(payload).includes('synthetic-user-key'), false)
  } finally {
    globalThis.fetch = originalFetch
    if (developerKey === undefined) delete process.env.TENCENT_TOKENHUB_API_KEY
    else process.env.TENCENT_TOKENHUB_API_KEY = developerKey
  }
})

test('BYOK connection test classifies invalid schema and never retries', async () => {
  const originalFetch = globalThis.fetch
  let upstreamCalls = 0
  globalThis.fetch = async () => {
    upstreamCalls += 1
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"records":[],"followUps":[]}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const response = await route.POST(localRequest({
      apiKey: 'synthetic-user-key-byok-two',
      clientSessionId: 'byok-test-session-0002',
      actionId: 'byok-test-action-0002',
    }))
    const payload = await response.json()
    assert.equal(response.status, 422)
    assert.equal(payload.status, 'invalid_schema')
    assert.equal(upstreamCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('completed connection-test action replays without another model call', async () => {
  const originalFetch = globalThis.fetch
  let upstreamCalls = 0
  globalThis.fetch = async () => {
    upstreamCalls += 1
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        records: [
          { type: 'exercise', date: '2026-10-28', activity: '散步', durationMinutes: 20 },
          { type: 'learning', date: '2026-10-28', subject: '英语', durationMinutes: 30 },
        ],
      }) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const body = {
    apiKey: 'synthetic-user-key-byok-three',
    clientSessionId: 'byok-test-session-0003',
    actionId: 'byok-test-action-0003',
  }
  try {
    const first = await route.POST(localRequest(body))
    const second = await route.POST(localRequest(body))
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(first.headers.get('x-ai-lifeos-idempotency'), 'executed')
    assert.equal(second.headers.get('x-ai-lifeos-idempotency'), 'replayed')
    assert.equal(upstreamCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('connection-test route classifies invalid key, missing permission, quota and timeout', async () => {
  const originalFetch = globalThis.fetch
  const cases = [
    {
      name: 'invalid-key',
      fetch: async () => new Response('{"error":{"code":"invalid_key"}}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
      httpStatus: 401,
      status: 'invalid_key',
    },
    {
      name: 'not-authorized',
      fetch: async () => new Response('{"error":{"code":"model_not_authorized"}}', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
      httpStatus: 403,
      status: 'not_authorized',
    },
    {
      name: 'quota',
      fetch: async () => new Response('{"error":{"code":"quota_exceeded"}}', {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      httpStatus: 429,
      status: 'quota_or_rate_limited',
    },
    {
      name: 'timeout',
      fetch: async () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      },
      httpStatus: 504,
      status: 'network_timeout',
    },
  ]
  try {
    for (const [index, item] of cases.entries()) {
      globalThis.fetch = item.fetch
      const response = await route.POST(localRequest({
        apiKey: `synthetic-user-key-error-${item.name}`,
        clientSessionId: `byok-error-session-000${index}`,
        actionId: `byok-error-action-000${index}`,
      }))
      const payload = await response.json()
      assert.equal(response.status, item.httpStatus, item.name)
      assert.equal(payload.status, item.status, item.name)
      assert.equal(JSON.stringify(payload).includes('synthetic-user-key'), false)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
