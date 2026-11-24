import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context)
    }
    if (specifier.startsWith('@/')) {
      const target = path.join(root, specifier.slice(2))
      return nextResolve(pathToFileURL(`${target}.ts`).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { NextRequest } = await import('next/server.js')
const chatRoute = await import(pathToFileURL(
  path.join(root, 'app/api/life-records/chat/route.ts'),
).href)
const followUpRoute = await import(pathToFileURL(
  path.join(root, 'app/api/life-records/follow-up/route.ts'),
).href)

const ENV_NAMES = [
  'LIFE_AI_PROVIDER',
  'TENCENT_TOKENHUB_API_KEY',
  'TENCENT_TOKENHUB_MODEL_ID',
  'TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS',
  'OPENROUTER_API_KEY',
  'CHATGPT_PLAN_CREDENTIALS_FILE',
  'AIOS_PUBLIC_BETA_HOSTS',
  'AIOS_PERSONAL_ALPHA_BYOK',
  'AIOS_PERSONAL_ALPHA_BYOK_HOST',
]

function request(pathname, body) {
  return new NextRequest(`http://127.0.0.1:3051${pathname}`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3051',
      origin: 'http://127.0.0.1:3051',
      referer: `http://127.0.0.1:3051/`,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function publicBetaRequest(pathname, body, sessionId = '11111111-1111-4111-8111-111111111111') {
  return new NextRequest(`https://beta.example.test${pathname}`, {
    method: 'POST',
    headers: {
      host: 'beta.example.test',
      origin: 'https://beta.example.test',
      referer: 'https://beta.example.test/',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-aios-public-beta-verified': 'verified',
      'x-aios-public-beta-session': sessionId,
    },
    body: JSON.stringify(body),
  })
}

function personalAlphaRequest(pathname, body) {
  return new NextRequest(`http://localhost:3100${pathname}`, {
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

function crossOriginPersonalAlphaRequest(pathname, body) {
  return new NextRequest(`http://localhost:3100${pathname}`, {
    method: 'POST',
    headers: {
      host: 'localhost:3100',
      origin: 'https://evil.example',
      referer: 'https://evil.example/',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function withSyntheticTokenHub(fetchImplementation, run) {
  const previous = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]))
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error
  process.env.LIFE_AI_PROVIDER = 'tokenhub'
  process.env.TENCENT_TOKENHUB_API_KEY = 'synthetic-test-key-not-real'
  process.env.TENCENT_TOKENHUB_MODEL_ID = 'deepseek-v4.1-flash-1017'
  process.env.TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS = '900'
  delete process.env.OPENROUTER_API_KEY
  delete process.env.CHATGPT_PLAN_CREDENTIALS_FILE
  delete process.env.AIOS_PERSONAL_ALPHA_BYOK
  delete process.env.AIOS_PERSONAL_ALPHA_BYOK_HOST
  globalThis.fetch = fetchImplementation
  console.info = () => {}
  console.warn = () => {}
  console.error = () => {}
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    console.warn = originalWarn
    console.error = originalError
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

async function withPersonalAlphaEnvironment(fetchImplementation, run) {
  const previous = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]))
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error
  process.env.AIOS_PERSONAL_ALPHA_BYOK = '1'
  process.env.AIOS_PERSONAL_ALPHA_BYOK_HOST = 'localhost:3100'
  delete process.env.AIOS_PUBLIC_BETA_HOSTS
  process.env.LIFE_AI_PROVIDER = 'tokenhub'
  process.env.TENCENT_TOKENHUB_API_KEY = 'developer-key-must-not-be-used'
  process.env.TENCENT_TOKENHUB_MODEL_ID = 'deepseek-v4.1-flash-1017'
  process.env.TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS = '900'
  globalThis.fetch = fetchImplementation
  console.info = () => {}
  console.warn = () => {}
  console.error = () => {}
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    console.warn = originalWarn
    console.error = originalError
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

function chatBody(messageId, clientSessionId, text = '昨晚睡了7小时') {
  return {
    text,
    date: '2026-10-26',
    messageId,
    clientSessionId,
    records: [],
  }
}

test('chat route coalesces concurrent duplicates and replays a completed action', async () => {
  let upstreamCalls = 0
  await withSyntheticTokenHub(async () => {
    upstreamCalls += 1
    await new Promise(resolve => setTimeout(resolve, 20))
    return new Response(JSON.stringify({
      model: 'deepseek-v4.1-flash-1017',
      choices: [{
        message: {
          content: JSON.stringify({
            records: [{ type: 'sleep', date: '2026-10-26', hours: 7, note: '' }],
            followUps: [],
          }),
        },
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }, async () => {
    const body = chatBody('route-action-0001', 'route-session-0001')
    const [first, second] = await Promise.all([
      chatRoute.POST(request('/api/life-records/chat', body)),
      chatRoute.POST(request('/api/life-records/chat', body)),
    ])
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(upstreamCalls, 1)
    assert.deepEqual(
      [first.headers.get('x-ai-lifeos-idempotency'), second.headers.get('x-ai-lifeos-idempotency')]
        .sort(),
      ['executed', 'replayed'],
    )

    const afterCompletion = await chatRoute.POST(
      request('/api/life-records/chat', body),
    )
    assert.equal(afterCompletion.status, 200)
    assert.equal(afterCompletion.headers.get('x-ai-lifeos-idempotency'), 'replayed')
    assert.equal(upstreamCalls, 1)

    const newAction = await chatRoute.POST(request(
      '/api/life-records/chat',
      chatBody('route-action-0002', 'route-session-0001'),
    ))
    assert.equal(newAction.status, 200)
    assert.equal(newAction.headers.get('x-ai-lifeos-idempotency'), 'executed')
    assert.equal(upstreamCalls, 2)
  })
})

test('Public Beta chat requires BYOK and never falls back to a developer key', async () => {
  const previousHost = process.env.AIOS_PUBLIC_BETA_HOSTS
  const previousKey = process.env.TENCENT_TOKENHUB_API_KEY
  const originalFetch = globalThis.fetch
  let upstreamCalls = 0
  process.env.AIOS_PUBLIC_BETA_HOSTS = 'beta.example.test'
  process.env.TENCENT_TOKENHUB_API_KEY = 'developer-key-must-not-be-used'
  globalThis.fetch = async () => {
    upstreamCalls += 1
    throw new Error('must not call upstream without BYOK')
  }
  try {
    const response = await chatRoute.POST(publicBetaRequest(
      '/api/life-records/chat',
      chatBody('byok-required-action-0001', 'byok-required-session-0001'),
    ))
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, 'byok_required')
    assert.equal(upstreamCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (previousHost === undefined) delete process.env.AIOS_PUBLIC_BETA_HOSTS
    else process.env.AIOS_PUBLIC_BETA_HOSTS = previousHost
    if (previousKey === undefined) delete process.env.TENCENT_TOKENHUB_API_KEY
    else process.env.TENCENT_TOKENHUB_API_KEY = previousKey
  }
})

test('personal Alpha can fall back to the local ChatGPT plan without BYOK', async () => {
  let upstreamCalls = 0
  await withPersonalAlphaEnvironment(async () => {
    upstreamCalls += 1
    return new Response(JSON.stringify({
      model: 'gpt-6.1-sol',
      choices: [{ message: { content: JSON.stringify({
        records: [{ type: 'sleep', date: '2026-10-26', hours: 7 }],
        followUps: [],
      }) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }, async () => {
    const chat = await chatRoute.POST(personalAlphaRequest(
      '/api/life-records/chat',
      chatBody('alpha-plan-fallback-chat', 'alpha-plan-fallback-session'),
    ))
    assert.equal(chat.status, 200)

    const followUp = await followUpRoute.POST(personalAlphaRequest(
      '/api/life-records/follow-up',
      {
        messageId: 'alpha-plan-fallback-follow-up',
        clientSessionId: 'alpha-plan-fallback-session',
        round: 2,
        records: [{
          id: 'alpha-plan-fallback-record',
          type: 'sleep',
          date: '2026-10-26',
          hours: 7,
          note: '',
          sourceText: '昨晚睡了7小时',
        }],
        history: [],
      },
    ))
    assert.equal(followUp.status, 200)
    assert.equal(upstreamCalls, 2)
  })
})

test('personal Alpha chat rejects cross-origin callers before upstream inference', async () => {
  let upstreamCalls = 0
  await withPersonalAlphaEnvironment(async () => {
    upstreamCalls += 1
    throw new Error('cross-origin request must not reach upstream')
  }, async () => {
    const response = await chatRoute.POST(crossOriginPersonalAlphaRequest(
      '/api/life-records/chat',
      {
        ...chatBody('alpha-cross-origin-chat', 'alpha-cross-origin-session'),
        aiConnection: {
          provider: 'tokenhub',
          model: 'deepseek-v4.1-flash-1017',
          apiKey: 'synthetic-alpha-cross-origin-key',
        },
      },
    ))
    assert.equal(response.status, 403)
    assert.equal(upstreamCalls, 0)
  })
})

test('personal Alpha chat, analysis and follow-up use only request keys', async () => {
  const seenAuthorization = []
  await withPersonalAlphaEnvironment(async (_url, init) => {
    seenAuthorization.push(new Headers(init.headers).get('authorization'))
    const requestBody = JSON.parse(init.body)
    if (requestBody.response_format?.type === 'json_object') {
      return new Response(JSON.stringify({
        model: 'deepseek-v4.1-flash-1017',
        choices: [{ message: { content: JSON.stringify({
          records: [{ type: 'sleep', date: '2026-10-26', hours: 7 }],
          followUps: [],
        }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (requestBody.messages?.[0]?.content?.includes('生活记录分析助手')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: '近 7 天已记录 1 条睡眠记录，平均 7 小时。' } }],
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"followUps":[]}' } }],
      usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }, async () => {
    const chat = await chatRoute.POST(personalAlphaRequest('/api/life-records/chat', {
      ...chatBody('alpha-chat-action-0001', 'alpha-chat-session-0001'),
      aiConnection: {
        provider: 'tokenhub',
        model: 'deepseek-v4.1-flash-1017',
        apiKey: 'synthetic-alpha-chat-key',
      },
    }))
    assert.equal(chat.status, 200)

    const analysis = await chatRoute.POST(personalAlphaRequest('/api/life-records/chat', {
      text: '分析一下我的近 7 天睡眠',
      date: '2026-10-26',
      messageId: 'alpha-analysis-action-0001',
      clientSessionId: 'alpha-analysis-session-0001',
      records: [{
        id: 'alpha-analysis-sleep-0001',
        type: 'sleep',
        date: '2026-10-26',
        hours: 7,
        note: '',
        sourceText: '昨晚睡了7小时',
      }],
      aiConnection: {
        provider: 'tokenhub',
        model: 'deepseek-v4.1-flash-1017',
        apiKey: 'synthetic-alpha-analysis-key',
      },
    }))
    assert.equal(analysis.status, 200)
    assert.equal((await analysis.json()).mode, 'ai')

    const followUp = await followUpRoute.POST(personalAlphaRequest(
      '/api/life-records/follow-up',
      {
        messageId: 'alpha-follow-up-action-0001',
        clientSessionId: 'alpha-follow-up-session-0001',
        round: 2,
        records: [{
          id: 'alpha-follow-up-sleep-0001',
          type: 'sleep',
          date: '2026-10-26',
          hours: 7,
          note: '',
          sourceText: '昨晚睡了7小时',
        }],
        history: [],
        aiConnection: {
          provider: 'tokenhub',
          model: 'deepseek-v4.1-flash-1017',
          apiKey: 'synthetic-alpha-follow-up-key',
        },
      },
    ))
    assert.equal(followUp.status, 200)
    assert.deepEqual(seenAuthorization, [
      'Bearer synthetic-alpha-chat-key',
      'Bearer synthetic-alpha-analysis-key',
      'Bearer synthetic-alpha-follow-up-key',
    ])
    assert.equal(seenAuthorization.includes('Bearer developer-key-must-not-be-used'), false)
  })
})

test('two Public Beta users send only their own request-scoped keys', async () => {
  const previous = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]))
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const seenAuthorization = []
  process.env.AIOS_PUBLIC_BETA_HOSTS = 'beta.example.test'
  process.env.LIFE_AI_PROVIDER = 'tokenhub'
  process.env.TENCENT_TOKENHUB_MODEL_ID = 'deepseek-v4.1-flash-1017'
  process.env.TENCENT_TOKENHUB_API_KEY = 'developer-key-must-not-be-used'
  console.info = () => {}
  globalThis.fetch = async (_url, init) => {
    seenAuthorization.push(new Headers(init.headers).get('authorization'))
    return new Response(JSON.stringify({
      model: 'deepseek-v4.1-flash-1017',
      choices: [{ message: { content: JSON.stringify({
        records: [{ type: 'sleep', date: '2026-10-26', hours: 7 }],
        followUps: [],
      }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    for (const [index, [suffix, apiKey]] of [['one', 'synthetic-user-key-one'], ['two', 'synthetic-user-key-two']].entries()) {
      const response = await chatRoute.POST(publicBetaRequest('/api/life-records/chat', {
        ...chatBody(`byok-action-${suffix}-0001`, `byok-session-${suffix}-0001`),
        aiConnection: { provider: 'tokenhub', apiKey },
      }, index === 0
        ? '11111111-1111-4111-8111-111111111111'
        : '22222222-2222-4222-8222-222222222222'))
      assert.equal(response.status, 200)
    }
    assert.deepEqual(seenAuthorization, [
      'Bearer synthetic-user-key-one',
      'Bearer synthetic-user-key-two',
    ])
    assert.equal(seenAuthorization.includes('Bearer developer-key-must-not-be-used'), false)
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('Public Beta follow-up uses BYOK and one idempotent action calls upstream once', async () => {
  const previous = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]))
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  let upstreamCalls = 0
  let authorization = null
  process.env.AIOS_PUBLIC_BETA_HOSTS = 'beta.example.test'
  process.env.TENCENT_TOKENHUB_MODEL_ID = 'deepseek-v4.1-flash-1017'
  process.env.TENCENT_TOKENHUB_API_KEY = 'developer-key-must-not-be-used'
  console.info = () => {}
  globalThis.fetch = async (_url, init) => {
    upstreamCalls += 1
    authorization = new Headers(init.headers).get('authorization')
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"followUps":[]}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const body = {
    messageId: 'byok-follow-session-0001',
    clientSessionId: 'byok-browser-session-0001',
    round: 2,
    records: [{
      id: 'record-sleep-0001',
      type: 'sleep',
      date: '2026-10-26',
      sourceText: '昨晚睡了7小时',
      hours: 7,
      note: '',
    }],
    history: [],
    aiConnection: { provider: 'tokenhub', apiKey: 'synthetic-follow-key-one' },
  }
  try {
    const first = await followUpRoute.POST(publicBetaRequest('/api/life-records/follow-up', body))
    const second = await followUpRoute.POST(publicBetaRequest('/api/life-records/follow-up', body))
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(first.headers.get('x-ai-lifeos-idempotency'), 'executed')
    assert.equal(second.headers.get('x-ai-lifeos-idempotency'), 'replayed')
    assert.equal(upstreamCalls, 1)
    assert.equal(authorization, 'Bearer synthetic-follow-key-one')
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('chat route rejects one action ID reused for different content', async () => {
  let upstreamCalls = 0
  await withSyntheticTokenHub(async () => {
    upstreamCalls += 1
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            records: [{ type: 'sleep', date: '2026-10-26', hours: 7, note: '' }],
            followUps: [],
          }),
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }, async () => {
    const first = await chatRoute.POST(request(
      '/api/life-records/chat',
      chatBody('route-action-conflict', 'route-session-conflict'),
    ))
    assert.equal(first.status, 200)
    const conflict = await chatRoute.POST(request(
      '/api/life-records/chat',
      chatBody('route-action-conflict', 'route-session-conflict', '昨晚睡了8小时'),
    ))
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).code, 'IDEMPOTENCY_KEY_REUSED')
    assert.equal(upstreamCalls, 1)
  })
})

test('follow-up rounds are idempotent per round and remain independent', async () => {
  let upstreamCalls = 0
  await withSyntheticTokenHub(async () => {
    upstreamCalls += 1
    return new Response(JSON.stringify({
      model: 'deepseek-v4.1-flash-1017',
      choices: [{
        message: {
          content: JSON.stringify({ followUps: [] }),
        },
      }],
      usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }, async () => {
    const base = {
      messageId: 'follow-up-route-action',
      clientSessionId: 'follow-up-route-session',
      records: [{
        id: 'synthetic-exercise',
        type: 'exercise',
        date: '2026-10-26',
        note: '',
        activity: '卧推',
        weightKg: 60,
        sets: 4,
        sourceText: '卧推60公斤4组',
      }],
      history: [],
    }
    const round2Body = { ...base, round: 2 }
    const first = await followUpRoute.POST(request('/api/life-records/follow-up', round2Body))
    const duplicate = await followUpRoute.POST(request('/api/life-records/follow-up', round2Body))
    assert.equal(first.status, 200)
    assert.equal(duplicate.status, 200)
    assert.equal(first.headers.get('x-ai-lifeos-idempotency'), 'executed')
    assert.equal(duplicate.headers.get('x-ai-lifeos-idempotency'), 'replayed')
    assert.equal(upstreamCalls, 1)

    const round3Body = { ...base, round: 3 }
    const round3 = await followUpRoute.POST(request('/api/life-records/follow-up', round3Body))
    const round3Replay = await followUpRoute.POST(request('/api/life-records/follow-up', round3Body))
    assert.equal(round3.status, 200)
    assert.equal(round3Replay.status, 200)
    assert.equal(round3.headers.get('x-ai-lifeos-idempotency'), 'executed')
    assert.equal(round3Replay.headers.get('x-ai-lifeos-idempotency'), 'replayed')
    assert.equal(upstreamCalls, 2)
  })
})
