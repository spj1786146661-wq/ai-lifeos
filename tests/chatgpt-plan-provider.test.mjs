import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writePlanCredentials } from '../lib/ai/chatgpt-plan-credentials.ts'
import { chatgptPlanPreferred, resolveAiProviderState } from '../lib/ai/chatgpt-plan-provider.ts'
import { lifeAiMode, lifeAiUnavailableReason, parseLifeText } from '../lib/life-parse-server.ts'

const BASE = {
  email: 'user@example.com',
  issuer: 'https://auth.openai.com',
  subject: 'subject-1',
  clientId: 'oaiapp_client',
  extAgentHostId: 'urn:uuid:host',
  idToken: 'id-token',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenType: 'Bearer',
  expiresAt: Date.now() + 3600_000,
  scopes: ['openid', 'chatgpt.tokens.use.direct'],
  savedAt: new Date().toISOString(),
}

function writeCredentials(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-provider-'))
  const path = join(dir, 'credentials.json')
  writePlanCredentials({ ...BASE, ...overrides }, path)
  return { dir, path }
}

const originalFetch = globalThis.fetch
test.afterEach(() => { globalThis.fetch = originalFetch })

test('with no credentials and no OpenRouter key, the state is rule mode, not AI', () => {
  const state = resolveAiProviderState({ credentialsPath: join(tmpdir(), 'definitely-missing.json'), openRouterConfigured: false })
  assert.equal(state.kind, 'rule')
  assert.equal(state.remoteAvailable, false)
  assert.match(state.label, /未调用 AI/)
  assert.ok(state.reason)
})

test('a credential file that lacks the plan scope is reported as unconfigured', () => {
  const { dir, path } = writeCredentials({ scopes: ['openid', 'email', 'offline_access'] })
  try {
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    // A valid ID token alone does not authorize ChatGPT plan usage.
    assert.equal(state.kind, 'unconfigured')
    assert.equal(state.remoteAvailable, false)
    assert.match(state.reason ?? '', /chatgpt.tokens.use.direct/)
    assert.equal(chatgptPlanPreferred({ credentialsPath: path }), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// An expired token that can still be refreshed stays on the AI path: the call
// refreshes it. Only a token that cannot be refreshed is "not usable".
test('an expired token that can still be refreshed stays on the AI path', () => {
  const { dir, path } = writeCredentials({ expiresAt: Date.now() - 60_000 })
  try {
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    assert.equal(state.kind, 'chatgpt')
    assert.equal(state.needsRefresh, true)
    assert.equal(chatgptPlanPreferred({ credentialsPath: path }), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// A token that cannot be refreshed must never be presented as usable.
test('an expired token missing the plan scope is never a usable AI provider', () => {
  // Uses a missing scope rather than an empty refresh token: the credentials
  // writer rejects an empty refresh token, so that is not a reachable state.
  const { dir, path } = writeCredentials({
    expiresAt: Date.now() - 60_000,
    scopes: ['openid', 'email', 'offline_access'],
  })
  try {
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    assert.equal(state.kind, 'unconfigured')
    assert.equal(state.remoteAvailable, false)
    assert.equal(state.needsRefresh, undefined)
    assert.equal(lifeAiModeFor(path), 'unconfigured')
    assert.equal(chatgptPlanPreferred({ credentialsPath: path }), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('a valid plan credential makes the ChatGPT plan the preferred provider', () => {
  const { dir, path } = writeCredentials()
  try {
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    assert.equal(state.kind, 'chatgpt')
    assert.equal(state.remoteAvailable, true)
    assert.equal(state.account, 'user@example.com')
    assert.equal(chatgptPlanPreferred({ credentialsPath: path }), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an unreadable credential file never silently degrades to AI mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-provider-'))
  const path = join(dir, 'credentials.json')
  try {
    // A file that exists but cannot be decrypted must not look like a login.
    writeFileSync(path, '{"salt":"AA","iv":"AA","tag":"AA","data":"AA"}')
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    assert.equal(state.kind, 'unconfigured')
    assert.equal(state.remoteAvailable, false)
    assert.equal(lifeAiModeFor(path), 'unconfigured')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

/** Reads the parse mode against a specific credential file. */
function lifeAiModeFor(path) {
  const previous = process.env.CHATGPT_PLAN_CREDENTIALS_FILE
  process.env.CHATGPT_PLAN_CREDENTIALS_FILE = path
  try { return lifeAiMode() } finally {
    if (previous === undefined) delete process.env.CHATGPT_PLAN_CREDENTIALS_FILE
    else process.env.CHATGPT_PLAN_CREDENTIALS_FILE = previous
  }
}

test('parse mode is demo with nothing configured, and never claims AI', () => {
  const previous = process.env.OPENROUTER_API_KEY
  const previousFile = process.env.CHATGPT_PLAN_CREDENTIALS_FILE
  delete process.env.OPENROUTER_API_KEY
  process.env.CHATGPT_PLAN_CREDENTIALS_FILE = join(tmpdir(), 'no-such-credentials.json')
  try {
    assert.equal(lifeAiMode(), 'demo')
    // The reason explains why no remote model is used, which the UI shows verbatim.
    assert.match(lifeAiUnavailableReason() ?? '', /未配置任何可用模型/)
  } finally {
    if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous
    if (previousFile !== undefined) process.env.CHATGPT_PLAN_CREDENTIALS_FILE = previousFile
  }
})

test('parse mode is unconfigured when a credential file exists but cannot be used', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-provider-'))
  const path = join(dir, 'credentials.json')
  const previous = process.env.OPENROUTER_API_KEY
  const previousFile = process.env.CHATGPT_PLAN_CREDENTIALS_FILE
  delete process.env.OPENROUTER_API_KEY
  try {
    writeFileSync(path, '{"salt":"AA","iv":"AA","tag":"AA","data":"AA"}')
    process.env.CHATGPT_PLAN_CREDENTIALS_FILE = path
    assert.equal(lifeAiMode(), 'unconfigured')
    assert.match(lifeAiUnavailableReason() ?? '', /无法解密/)
  } finally {
    if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous
    if (previousFile !== undefined) process.env.CHATGPT_PLAN_CREDENTIALS_FILE = previousFile
    else delete process.env.CHATGPT_PLAN_CREDENTIALS_FILE
    rmSync(dir, { recursive: true, force: true })
  }
})

test('demo parsing never makes a network call', async () => {
  const previous = process.env.OPENROUTER_API_KEY
  const previousFile = process.env.CHATGPT_PLAN_CREDENTIALS_FILE
  delete process.env.OPENROUTER_API_KEY
  process.env.CHATGPT_PLAN_CREDENTIALS_FILE = join(tmpdir(), 'no-such-credentials.json')
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('no network allowed in demo mode') }
  try {
    const result = await parseLifeText('今天练了胸，卧推60公斤做了4组，睡了7小时', '2026-10-23')
    assert.equal(result.mode, 'demo')
    assert.equal(calls, 0)
    assert.ok(result.records.length >= 2)
    // Every candidate is a candidate until the user confirms it.
    assert.equal(result.records.every(record => record.candidate === true), true)
  } finally {
    if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous
    if (previousFile !== undefined) process.env.CHATGPT_PLAN_CREDENTIALS_FILE = previousFile
  }
})

test('when the plan is authorized, parsing goes to the real model and keeps candidates', async () => {
  const { dir, path } = writeCredentials()
  const previousFile = process.env.CHATGPT_PLAN_CREDENTIALS_FILE
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.CHATGPT_PLAN_CREDENTIALS_FILE = path
  delete process.env.OPENROUTER_API_KEY
  let requestUrl = ''
  let requestBody = null
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input)
    requestBody = JSON.parse(init.body)
    const sse = [
      { type: 'response.output_text.delta', delta: '{"records":[' },
      { type: 'response.output_text.delta', delta: '{"type":"sleep","date":"2026-10-23","hours":7,"note":""},' },
      { type: 'response.output_text.delta', delta: '{"type":"exercise","date":"2026-10-23","activity":"卧推","weightKg":60,"sets":4,"note":""}]}' },
      { type: 'response.completed', response: { id: 'resp_9', model: 'gpt-6.1-sol' } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
    return new Response(sse, { status: 200 })
  }
  try {
    const result = await parseLifeText('昨晚睡了7个小时，上午卧推60公斤做了4组', '2026-10-23')
    assert.equal(result.mode, 'ai')
    assert.equal(requestUrl, 'https://api.openai.com/v1/responses')
    assert.equal(requestBody.store, false)
    assert.equal(requestBody.stream, true)
    assert.equal(requestBody.instructions.includes('信息提取器'), true)
    assert.equal(result.records.length, 2)
    assert.equal(result.records.every(record => record.candidate === true), true)
    assert.equal(result.records.every(record => record.draft.candidate === true), true)
    // The model's own values are kept; nothing is invented or rounded.
    const sleep = result.records.find(record => record.draft.type === 'sleep')
    assert.equal(sleep.draft.hours, 7)
    const exercise = result.records.find(record => record.draft.type === 'exercise')
    assert.equal(exercise.draft.weightKg, 60)
    assert.equal(exercise.draft.sets, 4)
  } finally {
    if (previousFile !== undefined) process.env.CHATGPT_PLAN_CREDENTIALS_FILE = previousFile
    else delete process.env.CHATGPT_PLAN_CREDENTIALS_FILE
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey
    rmSync(dir, { recursive: true, force: true })
  }
})

test('when the model quota is exhausted, parsing falls back to clearly labelled rules', async () => {
  const { dir, path } = writeCredentials()
  const previousFile = process.env.CHATGPT_PLAN_CREDENTIALS_FILE
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.CHATGPT_PLAN_CREDENTIALS_FILE = path
  delete process.env.OPENROUTER_API_KEY
  globalThis.fetch = async () => new Response('quota gone', { status: 429 })
  try {
    const result = await parseLifeText('今天睡了7小时', '2026-10-23')
    assert.equal(result.mode, 'fallback-rule')
    assert.equal(result.provider, 'rule')
    assert.match(result.notice ?? '', /用量已达上限/)
    assert.ok(result.records.some(record => record.draft.type === 'sleep'))
  } finally {
    if (previousFile !== undefined) process.env.CHATGPT_PLAN_CREDENTIALS_FILE = previousFile
    else delete process.env.CHATGPT_PLAN_CREDENTIALS_FILE
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an expired plan whose refresh fails falls back to rules without claiming an AI result', async () => {
  const { dir, path } = writeCredentials({ expiresAt: Date.now() - 60_000 })
  const previousFile = process.env.CHATGPT_PLAN_CREDENTIALS_FILE
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.CHATGPT_PLAN_CREDENTIALS_FILE = path
  delete process.env.OPENROUTER_API_KEY
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ error: 'authorization expired' }), { status: 403 })
  }
  try {
    const result = await parseLifeText('今天睡了7小时，心情不错', '2026-10-23')
    // The refresh is attempted once, it fails, and the run degrades honestly.
    assert.equal(requests, 1)
    assert.equal(result.mode, 'fallback-rule')
    assert.equal(result.provider, 'rule')
    assert.match(result.notice ?? '', /未获得 AI 结果|授权/)
    assert.ok(result.records.some(record => record.draft.type === 'sleep'))
    assert.ok(result.records.some(record => record.draft.type === 'mood'))
  } finally {
    if (previousFile !== undefined) process.env.CHATGPT_PLAN_CREDENTIALS_FILE = previousFile
    else delete process.env.CHATGPT_PLAN_CREDENTIALS_FILE
    if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── Expired access token with a valid refresh token ────────────────────────
// Regression: an expired access token used to be reported as "unconfigured",
// so parseLifeText() fell back to rules and never tried the refresh. Users
// with a valid refresh token were silently downgraded until they re-ran the
// whole OAuth flow.
test('an expired access token with a refresh token stays on the AI path', () => {
  const { dir, path } = writeCredentials({ expiresAt: Date.now() - 60_000 })
  try {
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    assert.equal(state.kind, 'chatgpt')
    assert.equal(state.needsRefresh, true)
    assert.equal(state.remoteAvailable, true)
    // The UI must not claim the plan is simply gone.
    assert.doesNotMatch(state.label, /需要重新授权/)
    assert.equal(state.reason, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an expired access token without a refresh token is unconfigured', () => {
  const { dir, path } = writeCredentials({ expiresAt: Date.now() - 60_000, refreshToken: '' })
  try {
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    assert.equal(state.kind, 'unconfigured')
    assert.equal(state.needsRefresh, undefined)
    assert.match(state.reason, /重新授权/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an expired token missing the plan scope is unconfigured, not refreshable', () => {
  const { dir, path } = writeCredentials({
    expiresAt: Date.now() - 60_000,
    scopes: ['openid', 'email', 'offline_access'],
  })
  try {
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    assert.equal(state.kind, 'unconfigured')
    assert.equal(state.needsRefresh, undefined)
    assert.match(state.reason, /chatgpt\.tokens\.use\.direct|重新授权/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a fresh token is not marked as needing refresh', () => {
  const { dir, path } = writeCredentials()
  try {
    const state = resolveAiProviderState({ credentialsPath: path, openRouterConfigured: false })
    assert.equal(state.kind, 'chatgpt')
    assert.equal(state.needsRefresh, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// End-to-end: the parse path must reach the model, not silently degrade.
// Uses a sentence the local rules cannot extract, so any rule output would be
// visible as a fallback rather than being masked by the model result.
test('parseLifeText refreshes an expired token instead of degrading to rules', async () => {
  const { dir, path } = writeCredentials({ expiresAt: Date.now() - 60_000 })
  try {
    process.env.CHATGPT_PLAN_CREDENTIALS_FILE = path
    let refreshCalled = false
    let modelCalled = false
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.includes('/oauth/token')) {
        refreshCalled = true
        return new Response(JSON.stringify({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      modelCalled = true
      // The Responses API streams SSE and only counts as success when
      // response.completed arrives. A sentence the deterministic rules cannot
      // parse proves the AI path was taken.
      const payload = JSON.stringify({ records: [{ type: 'meal', date: '2026-10-23', food: '越南河粉' }] })
      const sse = [
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: payload },
        { type: 'response.completed', response: { id: 'resp_1', model: 'gpt-6.1-sol' } },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    const result = await parseLifeText('午饭吃了一碗越南河粉', '2026-10-23', 'test-message')
    assert.equal(refreshCalled, true, 'the refresh endpoint must be called')
    assert.equal(modelCalled, true, 'the model must be called after refreshing')
    assert.equal(result.provider, 'chatgpt')
    assert.equal(result.records.length, 1)
    assert.equal(result.records[0].draft.type, 'meal')
    // The model answered, so this is not the "model unavailable" fallback.
    assert.doesNotMatch(result.notice ?? '', /真实模型不可用/)
  } finally {
    delete process.env.CHATGPT_PLAN_CREDENTIALS_FILE
    rmSync(dir, { recursive: true, force: true })
  }
})

// A refresh failure must degrade honestly, never claim an AI result.
test('a failed refresh degrades to rules and says the model was unavailable', async () => {
  const { dir, path } = writeCredentials({ expiresAt: Date.now() - 60_000 })
  try {
    process.env.CHATGPT_PLAN_CREDENTIALS_FILE = path
    globalThis.fetch = async (url) => {
      if (String(url).includes('/oauth/token')) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error('the model must not be called when the refresh failed')
    }
    const result = await parseLifeText('昨晚睡了7小时', '2026-10-23', 'test-message')
    assert.equal(result.mode, 'fallback-rule')
    assert.equal(result.provider, 'rule')
    assert.match(result.notice, /真实模型不可用/)
  } finally {
    delete process.env.CHATGPT_PLAN_CREDENTIALS_FILE
    rmSync(dir, { recursive: true, force: true })
  }
})
