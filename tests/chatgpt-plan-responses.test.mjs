import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writePlanCredentials } from '../lib/ai/chatgpt-plan-credentials.ts'
import {
  PlanNotAuthorizedError,
  PlanUsageError,
  buildImageInput,
  buildTextInput,
  callResponsesStream,
  resolvePlanAccess,
} from '../lib/ai/chatgpt-plan-responses.ts'

const CREDENTIAL = {
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

function credentialFile() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-resp-'))
  const path = join(dir, 'credentials.json')
  writePlanCredentials(CREDENTIAL, path)
  return { dir, path }
}

/** Build an SSE body the way the real endpoint streams it. */
function sseBody(events) {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
}

const originalFetch = globalThis.fetch

test.afterEach(() => { globalThis.fetch = originalFetch })

test('a completed stream is the only thing reported as success', async () => {
  globalThis.fetch = async () => new Response(sseBody([
    { type: 'response.created' },
    { type: 'response.output_text.delta', delta: '{"records":' },
    { type: 'response.output_text.delta', delta: '[]}' },
    { type: 'response.completed', response: { id: 'resp_1', model: 'gpt-6.1-sol', usage: { input_tokens: 10, output_tokens: 4 } } },
  ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

  const result = await callResponsesStream({
    model: 'gpt-6.1-sol',
    instructions: 'extract records',
    input: buildTextInput([{ role: 'user', content: '今天练了胸' }]),
    accessToken: 'access-token',
  })
  assert.equal(result.text, '{"records":[]}')
  assert.equal(result.model, 'gpt-6.1-sol')
  assert.equal(result.responseId, 'resp_1')
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4 })
})

test('the request never sends an unsupported field and never targets backend-api', async () => {
  let seenUrl = ''
  let seenBody = null
  let seenHeaders = null
  globalThis.fetch = async (input, init) => {
    seenUrl = String(input)
    seenHeaders = init.headers
    seenBody = JSON.parse(init.body)
    return new Response(sseBody([{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed', response: { id: 'r' } }]), { status: 200 })
  }
  await callResponsesStream({
    model: 'gpt-6.1-sol',
    instructions: 'system text',
    input: buildTextInput([{ role: 'user', content: 'hello' }]),
    accessToken: 'access-token',
  })
  assert.equal(seenUrl, 'https://api.openai.com/v1/responses')
  assert.equal(seenHeaders.Authorization, 'Bearer access-token')
  // Preview limitations: store=false and stream=true are mandatory.
  assert.equal(seenBody.store, false)
  assert.equal(seenBody.stream, true)
  // instructions are used instead of a system message item.
  assert.equal(seenBody.instructions, 'system text')
  assert.equal(seenBody.input.some(item => item.role === 'system'), false)
  // Unsupported fields must be absent, not merely null.
  for (const forbidden of ['temperature', 'top_p', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'background', 'conversation', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'truncation', 'user', 'previous_response_id', 'multi_agent', 'top_logprobs']) {
    assert.equal(forbidden in seenBody, false, `${forbidden} must not be sent`)
  }
})

test('a stream that ends without response.completed is not a success', async () => {
  globalThis.fetch = async () => new Response(sseBody([
    { type: 'response.output_text.delta', delta: 'partial text' },
  ]), { status: 200 })
  await assert.rejects(
    () => callResponsesStream({ model: 'm', instructions: 'i', input: [], accessToken: 't' }),
    error => error instanceof PlanUsageError && error.code === 'no_completion_event',
  )
})

test('response.failed with a usage-limit code surfaces the quota problem', async () => {
  globalThis.fetch = async () => new Response(sseBody([
    { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'quota gone' } } },
  ]), { status: 200 })
  await assert.rejects(
    () => callResponsesStream({ model: 'm', instructions: 'i', input: [], accessToken: 't' }),
    error => error instanceof PlanUsageError && error.code === 'subscription_sharing_usage_limit_exceeded',
  )
})

test('response.incomplete is separated from a completed success', async () => {
  globalThis.fetch = async () => new Response(sseBody([{ type: 'response.incomplete', response: { status: 'incomplete' } }]), { status: 200 })
  await assert.rejects(
    () => callResponsesStream({ model: 'm', instructions: 'i', input: [], accessToken: 't' }),
    error => error instanceof PlanUsageError && error.code === 'response_incomplete',
  )
})

test('an empty model output is refused rather than treated as a valid answer', async () => {
  globalThis.fetch = async () => new Response(sseBody([{ type: 'response.completed', response: { id: 'r' } }]), { status: 200 })
  await assert.rejects(
    () => callResponsesStream({ model: 'm', instructions: 'i', input: [], accessToken: 't' }),
    error => error instanceof PlanUsageError && error.code === 'empty_output',
  )
})

test('HTTP 429 and 401/403 map to the documented error meanings', async () => {
  globalThis.fetch = async () => new Response('too many', { status: 429 })
  await assert.rejects(
    () => callResponsesStream({ model: 'm', instructions: 'i', input: [], accessToken: 't' }),
    error => error instanceof PlanUsageError && error.code === 'subscription_sharing_usage_limit_exceeded',
  )
  globalThis.fetch = async () => new Response('denied', { status: 403 })
  await assert.rejects(
    () => callResponsesStream({ model: 'm', instructions: 'i', input: [], accessToken: 't' }),
    error => error instanceof PlanNotAuthorizedError,
  )
})

test('image input uses input_image items and keeps the data URL intact', () => {
  const input = buildImageInput('', 'data:image/jpeg;base64,AAAA')
  assert.equal(input.length, 1)
  assert.equal(input[0].role, 'user')
  assert.deepEqual(input[0].content[0], { type: 'input_text', text: '请识别这张图片里的饮食信息。' })
  assert.deepEqual(input[0].content[1], { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' })
})

test('resolvePlanAccess reuses a fresh token and refuses an unauthorized machine', async () => {
  const { dir, path } = credentialFile()
  try {
    const access = await resolvePlanAccess({ credentialsPath: path, model: 'gpt-6.1-sol', now: Date.now() })
    assert.equal(access.accessToken, 'access-token')
    assert.equal(access.model, 'gpt-6.1-sol')
    await assert.rejects(() => resolvePlanAccess({ credentialsPath: join(dir, 'missing.json'), model: 'm' }), PlanNotAuthorizedError)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an expired access token is refreshed before the request is made', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-resp-'))
  const path = join(dir, 'credentials.json')
  writePlanCredentials({ ...CREDENTIAL, expiresAt: Date.now() - 1000 }, path)
  let tokenBody = null
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/oauth/token')) {
      tokenBody = Object.fromEntries(new URLSearchParams(init.body))
      return new Response(JSON.stringify({
        access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'new-id',
        token_type: 'Bearer', expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('', { status: 500 })
  }
  try {
    // The refresh happens inside resolvePlanAccess, so the returned token is the
    // refreshed one and the whole set was persisted together.
    const access = await resolvePlanAccess({ credentialsPath: path, model: 'm', now: Date.now() })
    assert.equal(access.accessToken, 'new-access')
    assert.equal(tokenBody.grant_type, 'refresh_token')
    assert.equal(tokenBody.client_id, CREDENTIAL.clientId)
    assert.equal(tokenBody.refresh_token, 'refresh-token')
    assert.equal(tokenBody.resource, 'https://api.openai.com/v1')
    // The refreshed credential is persisted so a restart resumes with it.
    const { readPlanCredentials } = await import('../lib/ai/chatgpt-plan-credentials.ts')
    const stored = readPlanCredentials(path)
    assert.equal(stored.accessToken, 'new-access')
    assert.equal(stored.refreshToken, 'new-refresh')
  } finally { rmSync(dir, { recursive: true, force: true }); globalThis.fetch = originalFetch }
})
