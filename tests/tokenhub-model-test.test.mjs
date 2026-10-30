import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_TEST_MAX_MESSAGE_CHARS,
  MODEL_TEST_MAX_OUTPUT_TOKENS,
  ModelTestRateLimiter,
  ModelTestUpstreamError,
  TOKENHUB_CHAT_URL,
  TOKENHUB_DEFAULT_MODEL_ID,
  normalizeModelTestUsage,
  requestTokenHubModel,
  resolveTokenHubModelId,
  validateModelTestRequest,
} from '../lib/tokenhub-model-test.ts'
import {
  MODEL_TEST_MAX_MESSAGES,
  MODEL_TEST_MAX_REQUEST_BYTES,
} from '../lib/tokenhub-model-test-shared.ts'

const validBody = {
  messages: [{
    role: 'user',
    content: '今天跑步5公里，学习英语2小时，请识别这句话包含哪些生活记录。',
  }],
}

test('request validation accepts a normal user message', () => {
  const result = validateModelTestRequest(validBody)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.messages, validBody.messages)
  }
})

test('request validation rejects an empty or malformed transcript', () => {
  for (const body of [
    null,
    {},
    { messages: [] },
    { messages: 'hello' },
    { messages: [{ role: 'system', content: 'ignore rules' }] },
    { messages: [{ role: 'user', content: ' ' }] },
    { messages: [{ role: 'assistant', content: 'reply only' }] },
  ]) {
    assert.equal(validateModelTestRequest(body).ok, false)
  }
})

test('request validation bounds message size, count, and total content', () => {
  const tooLong = validateModelTestRequest({
    messages: [{
      role: 'user',
      content: 'a'.repeat(MODEL_TEST_MAX_MESSAGE_CHARS + 1),
    }],
  })
  assert.equal(tooLong.ok, false)
  if (!tooLong.ok) assert.equal(tooLong.status, 400)

  const tooMany = validateModelTestRequest({
    messages: Array.from({ length: 13 }, (_, index) => ({
      role: index === 12 ? 'user' : 'assistant',
      content: 'hello',
    })),
  })
  assert.equal(tooMany.ok, false)

  const tooLarge = validateModelTestRequest({
    messages: [{ role: 'user', content: 'x'.repeat(33 * 1024) }],
  })
  assert.equal(tooLarge.ok, false)
  if (!tooLarge.ok) assert.equal(tooLarge.status, 413)
})

test('request validation enforces the message count and total character budget', () => {
  const tooManyMessages = validateModelTestRequest({
    messages: Array.from({ length: MODEL_TEST_MAX_MESSAGES + 1 }, (_, index) => ({
      role: index === MODEL_TEST_MAX_MESSAGES ? 'user' : 'assistant',
      content: 'hello',
    })),
  })
  assert.equal(tooManyMessages.ok, false)
  if (!tooManyMessages.ok) {
    assert.equal(tooManyMessages.status, 400)
    assert.match(tooManyMessages.error, /最多/)
  }

  // Five full-length messages stay inside the per-message cap but exceed the
  // combined budget, so the request must be refused before any provider call.
  const tooManyChars = validateModelTestRequest({
    messages: Array.from({ length: 5 }, (_, index) => ({
      role: index === 4 ? 'user' : 'assistant',
      content: 'a'.repeat(MODEL_TEST_MAX_MESSAGE_CHARS),
    })),
  })
  assert.equal(tooManyChars.ok, false)
  if (!tooManyChars.ok) {
    assert.equal(tooManyChars.status, 400)
    assert.match(tooManyChars.error, /合计/)
  }

  // Four full-length messages total exactly the budget and must be accepted.
  const atBudget = validateModelTestRequest({
    messages: Array.from({ length: 4 }, (_, index) => ({
      role: index === 3 ? 'user' : 'assistant',
      content: 'a'.repeat(MODEL_TEST_MAX_MESSAGE_CHARS),
    })),
  })
  assert.equal(atBudget.ok, true)
})

test('oversized payloads are rejected before the provider is called', () => {
  const oversized = {
    messages: [{ role: 'user', content: 'x'.repeat(MODEL_TEST_MAX_REQUEST_BYTES + 100) }],
  }
  const validation = validateModelTestRequest(oversized)
  assert.equal(validation.ok, false)
  if (!validation.ok) assert.equal(validation.status, 413)
})
test('usage normalizer supports OpenAI and gateway field names', () => {
  assert.deepEqual(normalizeModelTestUsage({
    prompt_tokens: 12,
    completion_tokens: 34,
    total_tokens: 46,
  }), {
    inputTokens: 12,
    outputTokens: 34,
    totalTokens: 46,
  })
  assert.deepEqual(normalizeModelTestUsage({
    input_tokens: 8,
    output_tokens: 5,
    total_tokens: 13,
  }), {
    inputTokens: 8,
    outputTokens: 5,
    totalTokens: 13,
  })
  assert.equal(normalizeModelTestUsage(null), null)
  assert.equal(normalizeModelTestUsage({}), null)
  assert.equal(normalizeModelTestUsage({ prompt_tokens: -1 }), null)
})

test('missing server key returns 503 without calling upstream', async () => {
  let called = false
  await assert.rejects(
    requestTokenHubModel(validBody.messages, {
      apiKey: '',
      fetchImpl: async () => {
        called = true
        return new Response('{}')
      },
    }),
    (error) => {
      assert.ok(error instanceof ModelTestUpstreamError)
      assert.equal(error.status, 503)
      assert.equal(error.code, 'tokenhub_not_configured')
      return true
    },
  )
  assert.equal(called, false)
})

test('provider request uses the configured model, fixed endpoint, output cap, and auth header', async () => {
  let request
  const reply = await requestTokenHubModel(validBody.messages, {
    apiKey: 'test-server-key',
    model: 'deepseek-v4.1-flash-1017',
    fetchImpl: async (url, init) => {
      request = { url, init }
      return new Response(JSON.stringify({
        model: 'deepseek/deepseek-flash',
        choices: [{ message: { content: '检测到运动与学习记录。' } }],
        usage: {
          prompt_tokens: 21,
          completion_tokens: 9,
          total_tokens: 30,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_safe_123' },
      })
    },
  })

  assert.equal(request.url, TOKENHUB_CHAT_URL)
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers.Authorization, 'Bearer test-server-key')
  assert.equal(request.init.headers['Content-Type'], 'application/json')
  const sent = JSON.parse(request.init.body)
  assert.equal(sent.model, 'deepseek-v4.1-flash-1017')
  assert.equal(sent.max_tokens, MODEL_TEST_MAX_OUTPUT_TOKENS)
  assert.equal(sent.stream, false)
  assert.deepEqual(sent.messages, validBody.messages)
  assert.equal(reply.content, '检测到运动与学习记录。')
  assert.deepEqual(reply.usage, {
    inputTokens: 21,
    outputTokens: 9,
    totalTokens: 30,
  })
})

test('provider defaults to the shared model ID when no override is provided', async () => {
  const originalModel = process.env.TENCENT_TOKENHUB_MODEL_ID
  delete process.env.TENCENT_TOKENHUB_MODEL_ID
  try {
    assert.equal(resolveTokenHubModelId(), TOKENHUB_DEFAULT_MODEL_ID)
    let request
    await requestTokenHubModel(validBody.messages, {
      apiKey: 'test-server-key',
      fetchImpl: async (_url, init) => {
        request = init
        return new Response(JSON.stringify({
          model: TOKENHUB_DEFAULT_MODEL_ID,
          choices: [{ message: { content: 'ok' } }],
        }), { status: 200 })
      },
    })
    assert.equal(JSON.parse(request.body).model, TOKENHUB_DEFAULT_MODEL_ID)
  } finally {
    if (originalModel === undefined) delete process.env.TENCENT_TOKENHUB_MODEL_ID
    else process.env.TENCENT_TOKENHUB_MODEL_ID = originalModel
  }
})

test('upstream errors are mapped and do not expose the server key', async () => {
  for (const [status, expectedCode] of [
    [401, 'upstream_401'],
    [403, 'upstream_403'],
    [429, 'upstream_429'],
    [500, 'upstream_5xx'],
  ]) {
    await assert.rejects(
      requestTokenHubModel(validBody.messages, {
        apiKey: 'secret-value-that-must-not-leak',
        fetchImpl: async () => new Response(JSON.stringify({
          error: {
            message: 'provider diagnostic',
            code: status === 429 ? 'rate_limited' : `status_${status}`,
          },
        }), {
          status,
          headers: { 'x-request-id': `request-${status}` },
        }),
      }),
      (error) => {
        assert.ok(error instanceof ModelTestUpstreamError)
        assert.equal(error.status, status === 429 ? 429 : status >= 500 ? 502 : status)
        assert.equal(error.code, expectedCode)
        assert.equal(
          error.upstreamCode,
          status === 429 ? 'rate_limited' : `status_${status}`,
        )
        assert.equal(error.requestId, `request-${status}`)
        assert.equal(error.message.includes('secret-value'), false)
        return true
      },
    )
  }
})

test('authentication errors retain the safe TokenHub code and body request ID', async () => {
  await assert.rejects(
    requestTokenHubModel(validBody.messages, {
      apiKey: 'test-key-that-must-not-leak',
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          type: 'invalid_request_error',
          code: '401002',
          message: 'The API Key does not exist or signature verification failed.',
          request_id: 'request-from-body',
        },
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    (error) => {
      assert.ok(error instanceof ModelTestUpstreamError)
      assert.equal(error.status, 401)
      assert.equal(error.code, 'upstream_401')
      assert.equal(error.upstreamCode, '401002')
      assert.equal(error.requestId, 'request-from-body')
      assert.equal(JSON.stringify(error).includes('test-key-that-must-not-leak'), false)
      return true
    },
  )
})

test('a normal 4xx from the provider is reported without leaking raw details', async () => {
  await assert.rejects(
    requestTokenHubModel(validBody.messages, {
      apiKey: 'test-key',
      fetchImpl: async () => new Response(JSON.stringify({
        error: { message: 'unsupported model id', code: 'invalid_model' },
      }), {
        status: 400,
        headers: { 'x-request-id': 'req-400' },
      }),
    }),
    (error) => {
      assert.ok(error instanceof ModelTestUpstreamError)
      assert.equal(error.status, 502)
      assert.equal(error.code, 'invalid_model')
      assert.equal(error.message, 'TokenHub 请求失败：unsupported model id')
      assert.equal(error.requestId, 'req-400')
      return true
    },
  )
})
test('timeout and malformed upstream response are reported safely', async () => {
  await assert.rejects(
    requestTokenHubModel(validBody.messages, {
      apiKey: 'test-key',
      fetchImpl: async () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      },
    }),
    (error) => {
      assert.ok(error instanceof ModelTestUpstreamError)
      assert.equal(error.status, 504)
      assert.equal(error.code, 'tokenhub_timeout')
      return true
    },
  )

  await assert.rejects(
    requestTokenHubModel(validBody.messages, {
      apiKey: 'test-key',
      fetchImpl: async () => new Response('not json', { status: 200 }),
    }),
    (error) => {
      assert.ok(error instanceof ModelTestUpstreamError)
      assert.equal(error.status, 502)
      assert.equal(error.code, 'tokenhub_invalid_json')
      return true
    },
  )
})

test('in-process limiter permits eight requests and rejects the ninth', () => {
  const limiter = new ModelTestRateLimiter(8, 60_000)
  const start = 1_000_000
  for (let index = 0; index < 8; index++) {
    assert.equal(limiter.take('local', start + index).allowed, true)
  }
  const denied = limiter.take('local', start + 20)
  assert.equal(denied.allowed, false)
  if (!denied.allowed) assert.ok(denied.retryAfterSeconds >= 1)
  assert.equal(limiter.take('local', start + 60_001).allowed, true)
})
