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

const {
  LEGACY_HEALTH_API_FLAG,
  LEGACY_TELEGRAM_API_FLAG,
  isLegacyApiEnabled,
  parseBearerToken,
  requestedUserMatches,
  secretsMatch,
  verifyBearerSecret,
  verifyConfiguredOwner,
  verifyFirebaseBearer,
  verifyWebhookSecret,
} = await import('../lib/api-security.ts')

const { NextRequest } = await import('next/server.js')
const healthAppleSync = await import(pathToFileURL(
  path.join(root, 'app/api/health/apple-sync/route.ts'),
).href)
const healthImport = await import(pathToFileURL(
  path.join(root, 'app/api/health/import/route.ts'),
).href)
const telegramLink = await import(pathToFileURL(
  path.join(root, 'app/api/telegram/link/route.ts'),
).href)
const telegramSetup = await import(pathToFileURL(
  path.join(root, 'app/api/telegram/setup/route.ts'),
).href)
const telegramFoodSetup = await import(pathToFileURL(
  path.join(root, 'app/api/telegram/food-setup/route.ts'),
).href)
const telegramCron = await import(pathToFileURL(
  path.join(root, 'app/api/telegram/cron/route.ts'),
).href)
const telegramWebhook = await import(pathToFileURL(
  path.join(root, 'app/api/telegram/webhook/route.ts'),
).href)
const telegramFoodWebhook = await import(pathToFileURL(
  path.join(root, 'app/api/telegram/food-webhook/route.ts'),
).href)

const SECURITY_ENV_NAMES = [
  LEGACY_HEALTH_API_FLAG,
  LEGACY_TELEGRAM_API_FLAG,
  'AIOS_HEALTH_SYNC_TOKEN',
  'AIOS_HEALTH_SYNC_USER_ID',
  'TELEGRAM_SETUP_SECRET',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_FOOD_WEBHOOK_SECRET',
  'CRON_SECRET',
]

async function withEnvironment(values, callback) {
  const previous = new Map()
  for (const name of SECURITY_ENV_NAMES) {
    previous.set(name, process.env[name])
    delete process.env[name]
  }
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name])
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  try {
    return await callback()
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

function request(pathname, options = {}) {
  return new NextRequest(`http://127.0.0.1:3000${pathname}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
    },
  })
}

function jsonRequest(pathname, body, options = {}) {
  return request(pathname, {
    ...options,
    method: options.method ?? 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
}

test('legacy APIs are disabled unless the exact string true is configured', () => {
  assert.equal(isLegacyApiEnabled('FLAG', {}), false)
  assert.equal(isLegacyApiEnabled('FLAG', { FLAG: 'false' }), false)
  assert.equal(isLegacyApiEnabled('FLAG', { FLAG: 'TRUE' }), false)
  assert.equal(isLegacyApiEnabled('FLAG', { FLAG: '1' }), false)
  assert.equal(isLegacyApiEnabled('FLAG', { FLAG: 'true' }), true)
})

test('bearer parsing is strict and does not accept malformed credentials', () => {
  assert.equal(parseBearerToken('Bearer secure-value'), 'secure-value')
  assert.equal(parseBearerToken('bearer secure-value'), 'secure-value')
  assert.equal(parseBearerToken('Basic secure-value'), null)
  assert.equal(parseBearerToken('Bearer'), null)
  assert.equal(parseBearerToken('Bearer one two'), null)
  assert.equal(parseBearerToken(null), null)
})

test('server secrets fail closed when unconfigured, missing or incorrect', () => {
  assert.deepEqual(
    verifyBearerSecret('Bearer provided', undefined),
    { ok: false, status: 503, code: 'auth_not_configured' },
  )
  assert.deepEqual(
    verifyBearerSecret(null, 'expected'),
    { ok: false, status: 401, code: 'auth_required' },
  )
  assert.deepEqual(
    verifyBearerSecret('Bearer incorrect', 'expected'),
    { ok: false, status: 401, code: 'invalid_auth' },
  )
  assert.deepEqual(
    verifyBearerSecret('Bearer expected', 'expected'),
    { ok: true, uid: 'server' },
  )
  assert.equal(secretsMatch('provided', 'provided'), true)
  assert.equal(secretsMatch('provided', 'different'), false)
})

test('configured owner identity cannot be supplied by the client', () => {
  assert.deepEqual(
    verifyConfiguredOwner('Bearer owner-token', 'owner-token', 'trusted-owner-id'),
    { ok: true, uid: 'trusted-owner-id' },
  )
  assert.deepEqual(
    verifyConfiguredOwner('Bearer owner-token', 'owner-token', undefined),
    { ok: false, status: 503, code: 'auth_not_configured' },
  )
  assert.equal(requestedUserMatches('trusted-owner-id', 'trusted-owner-id'), true)
  assert.equal(requestedUserMatches('another-user', 'trusted-owner-id'), false)
  assert.equal(requestedUserMatches(undefined, 'trusted-owner-id'), false)
})

test('Firebase identity comes from a verified token rather than a request field', async () => {
  const valid = await verifyFirebaseBearer('Bearer valid-id-token', async token => {
    assert.equal(token, 'valid-id-token')
    return { uid: 'server-verified-uid' }
  })
  assert.deepEqual(valid, { ok: true, uid: 'server-verified-uid' })

  const missing = await verifyFirebaseBearer(null, async () => ({ uid: 'never' }))
  assert.deepEqual(missing, { ok: false, status: 401, code: 'auth_required' })

  const invalid = await verifyFirebaseBearer('Bearer invalid', async () => {
    throw new Error('token verification failed')
  })
  assert.deepEqual(invalid, { ok: false, status: 401, code: 'invalid_auth' })
})

test('webhook verification fails closed and never includes the secret', () => {
  const secret = 'webhook-secret-that-must-not-be-serialized'
  const cases = [
    verifyWebhookSecret(secret, undefined),
    verifyWebhookSecret(null, secret),
    verifyWebhookSecret('wrong', secret),
  ]

  assert.deepEqual(cases.map(result => result.status), [503, 401, 401])
  assert.equal(JSON.stringify(cases).includes(secret), false)
  assert.deepEqual(
    verifyWebhookSecret(secret, secret),
    { ok: true, uid: 'webhook' },
  )
})

test('health APIs are absent by default and reject missing credentials when enabled', async () => {
  await withEnvironment({}, async () => {
    const appleSync = await healthAppleSync.POST(request('/api/health/apple-sync'))
    const appleGet = await healthAppleSync.GET(request('/api/health/apple-sync'))
    const imported = await healthImport.POST(request('/api/health/import'))
    assert.equal(appleSync.status, 404)
    assert.equal(appleGet.status, 404)
    assert.equal(imported.status, 404)
  })

  await withEnvironment({
    [LEGACY_HEALTH_API_FLAG]: 'true',
    AIOS_HEALTH_SYNC_TOKEN: 'owner-token',
    AIOS_HEALTH_SYNC_USER_ID: 'trusted-owner-id',
  }, async () => {
    const appleSync = await healthAppleSync.POST(request('/api/health/apple-sync'))
    const appleGet = await healthAppleSync.GET(request('/api/health/apple-sync'))
    const imported = await healthImport.POST(request('/api/health/import'))
    assert.equal(appleSync.status, 401)
    assert.equal(appleGet.status, 401)
    assert.equal(imported.status, 401)
  })
})

test('Apple Health owner token controls GET and forged userId is rejected', async () => {
  await withEnvironment({
    [LEGACY_HEALTH_API_FLAG]: 'true',
    AIOS_HEALTH_SYNC_TOKEN: 'owner-token',
    AIOS_HEALTH_SYNC_USER_ID: 'trusted-owner-id',
  }, async () => {
    const headers = { authorization: 'Bearer owner-token' }
    const getResponse = await healthAppleSync.GET(
      request('/api/health/apple-sync', { headers }),
    )
    assert.equal(getResponse.status, 200)
    const payload = await getResponse.json()
    assert.equal(payload.status, 'enabled')
    assert.equal(JSON.stringify(payload).includes('owner-token'), false)

    const forgedResponse = await healthAppleSync.POST(jsonRequest(
      '/api/health/apple-sync',
      { userId: 'another-user', date: '2026-10-26' },
      { headers },
    ))
    assert.equal(forgedResponse.status, 403)

    const invalidDate = await healthAppleSync.POST(jsonRequest(
      '/api/health/apple-sync',
      { userId: 'trusted-owner-id', date: 'not-a-date' },
      { headers },
    ))
    assert.equal(invalidDate.status, 400)
  })
})

test('Telegram management APIs are disabled by default', async () => {
  await withEnvironment({}, async () => {
    const responses = await Promise.all([
      telegramLink.POST(request('/api/telegram/link')),
      telegramSetup.GET(request('/api/telegram/setup')),
      telegramFoodSetup.GET(request('/api/telegram/food-setup')),
      telegramCron.GET(request('/api/telegram/cron')),
      telegramWebhook.POST(request('/api/telegram/webhook')),
      telegramFoodWebhook.POST(request('/api/telegram/food-webhook')),
    ])
    assert.deepEqual(responses.map(response => response.status), [404, 404, 404, 404, 404, 404])
  })
})

test('enabled Telegram management APIs reject requests without trusted credentials', async () => {
  await withEnvironment({
    [LEGACY_TELEGRAM_API_FLAG]: 'true',
    TELEGRAM_SETUP_SECRET: 'setup-secret',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_FOOD_WEBHOOK_SECRET: 'food-webhook-secret',
    CRON_SECRET: 'cron-secret',
  }, async () => {
    assert.equal(
      (await telegramLink.POST(request('/api/telegram/link'))).status,
      401,
    )
    assert.equal(
      (await telegramSetup.GET(request('/api/telegram/setup'))).status,
      401,
    )
    assert.equal(
      (await telegramFoodSetup.GET(request('/api/telegram/food-setup'))).status,
      401,
    )
    assert.equal(
      (await telegramCron.GET(request('/api/telegram/cron'))).status,
      401,
    )
    assert.equal(
      (await telegramWebhook.POST(request('/api/telegram/webhook'))).status,
      401,
    )
    assert.equal(
      (await telegramFoodWebhook.POST(request('/api/telegram/food-webhook'))).status,
      401,
    )
  })
})

test('webhooks reject missing configuration, missing headers and wrong secrets before parsing JSON', async () => {
  await withEnvironment({ [LEGACY_TELEGRAM_API_FLAG]: 'true' }, async () => {
    assert.equal(
      (await telegramWebhook.POST(request('/api/telegram/webhook'))).status,
      503,
    )
    assert.equal(
      (await telegramFoodWebhook.POST(request('/api/telegram/food-webhook'))).status,
      503,
    )
  })

  await withEnvironment({
    [LEGACY_TELEGRAM_API_FLAG]: 'true',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_FOOD_WEBHOOK_SECRET: 'food-webhook-secret',
  }, async () => {
    assert.equal(
      (await telegramWebhook.POST(request('/api/telegram/webhook'))).status,
      401,
    )
    assert.equal(
      (await telegramFoodWebhook.POST(request('/api/telegram/food-webhook'))).status,
      401,
    )
    assert.equal(
      (await telegramWebhook.POST(request('/api/telegram/webhook', {
        headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      }))).status,
      401,
    )
    assert.equal(
      (await telegramFoodWebhook.POST(request('/api/telegram/food-webhook', {
        headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      }))).status,
      401,
    )
  })
})

test('valid webhook secrets pass the security gate before malformed payload handling', async () => {
  await withEnvironment({
    [LEGACY_TELEGRAM_API_FLAG]: 'true',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_FOOD_WEBHOOK_SECRET: 'food-webhook-secret',
  }, async () => {
    const webhook = await telegramWebhook.POST(request('/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'webhook-secret',
      },
      body: '{',
    }))
    const foodWebhook = await telegramFoodWebhook.POST(request('/api/telegram/food-webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'food-webhook-secret',
      },
      body: '{',
    }))
    assert.equal(webhook.status, 200)
    assert.equal(foodWebhook.status, 200)
  })
})
