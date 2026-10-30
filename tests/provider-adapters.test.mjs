import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ProviderRequestError,
  runProviderText,
} from '../lib/ai/run-provider-text.ts'
import { BYOK_PROVIDER_IDS } from '../lib/ai/provider-types.ts'
import { getProviderDefinition } from '../lib/ai/provider-registry.ts'

const apiKey = 'synthetic-provider-key-1234567890'

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function openAiResponse(content = '{"records":[],"followUps":[]}') {
  return jsonResponse({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
  }, 200, { 'x-request-id': 'synthetic-request-id' })
}

test('every registered text provider reaches its own fixed endpoint through the unified runner', async () => {
  for (const providerId of BYOK_PROVIDER_IDS) {
    const provider = getProviderDefinition(providerId)
    let calledUrl = ''
    let calledInit = null
    const result = await runProviderText({
      connection: {
        provider: providerId,
        model: provider.defaultModel,
        apiKey,
      },
      instructions: 'synthetic system prompt',
      userText: 'synthetic user text',
      jsonOutput: true,
      fetchImpl: async (url, init) => {
        calledUrl = String(url)
        calledInit = init
        if (provider.protocol === 'gemini') {
          return jsonResponse({
            candidates: [{ content: { parts: [{ text: '{"records":[]}' }] } }],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
          })
        }
        if (provider.protocol === 'anthropic') {
          return jsonResponse({
            content: [{ type: 'text', text: '{"records":[]}' }],
            usage: { input_tokens: 2, output_tokens: 3 },
          })
        }
        return openAiResponse()
      },
    })
    assert.equal(result.provider, providerId)
    assert.equal(result.model, provider.defaultModel)
    assert.ok(calledUrl.startsWith('https://'))
    if (provider.protocol === 'gemini') {
      assert.match(calledUrl, new RegExp(`/models/${provider.defaultModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:generateContent`))
      assert.equal(new Headers(calledInit.headers).get('x-goog-api-key'), apiKey)
    } else if (provider.protocol === 'anthropic') {
      assert.equal(calledUrl, provider.endpoint)
      assert.equal(new Headers(calledInit.headers).get('x-api-key'), apiKey)
      assert.equal(new Headers(calledInit.headers).get('anthropic-version'), '2023-06-01')
    } else {
      assert.equal(calledUrl, provider.endpoint)
      assert.equal(new Headers(calledInit.headers).get('authorization'), `Bearer ${apiKey}`)
      assert.equal(JSON.parse(calledInit.body).model, provider.defaultModel)
    }
  }
})

test('OpenAI-compatible adapters preserve structured-output capability metadata', async () => {
  let requestBody
  await runProviderText({
    connection: { provider: 'bigmodel', model: 'glm-5.3', apiKey },
    instructions: 'system',
    userText: 'user',
    jsonOutput: true,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body)
      return openAiResponse()
    },
  })
  assert.equal(requestBody.response_format.type, 'json_object')
  assert.equal(requestBody.stream, false)
  assert.equal(requestBody.max_tokens, 900)
})

test('reviewed providers use their official output-token field and unreviewed JSON modes stay off', async () => {
  const requests = new Map()
  for (const [provider, model] of [
    ['qwen', 'qwen-plus'],
    ['openai', 'gpt-4.1-mini'],
    ['deepseek', 'deepseek-chat'],
    ['siliconflow', 'Qwen/Qwen3-8B'],
  ]) {
    await runProviderText({
      connection: { provider, model, apiKey },
      instructions: 'system must return JSON',
      userText: 'user',
      jsonOutput: true,
      fetchImpl: async (_url, init) => {
        requests.set(provider, JSON.parse(init.body))
        return openAiResponse()
      },
    })
  }
  assert.equal(requests.get('qwen').max_completion_tokens, 900)
  assert.equal('max_tokens' in requests.get('qwen'), false)
  assert.equal(requests.get('qwen').response_format.type, 'json_object')
  assert.equal(requests.get('openai').max_completion_tokens, 900)
  assert.equal('max_tokens' in requests.get('openai'), false)
  assert.equal(requests.get('openai').response_format.type, 'json_object')
  assert.equal(requests.get('deepseek').max_tokens, 900)
  assert.equal('max_completion_tokens' in requests.get('deepseek'), false)
  assert.equal(requests.get('deepseek').response_format.type, 'json_object')
  assert.equal(requests.get('siliconflow').max_tokens, 900)
  assert.equal('response_format' in requests.get('siliconflow'), false)
})

test('upstream authentication, quota and empty replies become safe typed errors', async () => {
  const cases = [
    [401, 'upstream_401'],
    [403, 'upstream_403'],
    [404, 'provider_model_not_found'],
    [429, 'upstream_429'],
  ]
  for (const [status, code] of cases) {
    await assert.rejects(() => runProviderText({
      connection: { provider: 'deepseek', model: 'deepseek-chat', apiKey },
      instructions: 'system',
      userText: 'user',
      fetchImpl: async () => jsonResponse({
        error: { message: `synthetic ${status}`, code: 'synthetic_code' },
      }, status, { 'x-request-id': `request-${status}` }),
    }), error => {
      assert.ok(error instanceof ProviderRequestError)
      assert.equal(error.code, code)
      assert.equal(error.requestId, `request-${status}`)
      assert.equal(error.message.includes(apiKey), false)
      return true
    })
  }
  await assert.rejects(() => runProviderText({
    connection: { provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey },
    instructions: 'system',
    userText: 'user',
    fetchImpl: async () => openAiResponse(''),
  }), /没有返回可显示的文本/)
})

test('a provider failure never cascades to TokenHub or another provider', async () => {
  const urls = []
  await assert.rejects(() => runProviderText({
    connection: { provider: 'qwen', model: 'qwen-plus', apiKey },
    instructions: 'system',
    userText: 'user',
    fetchImpl: async url => {
      urls.push(String(url))
      return jsonResponse({ error: { message: 'synthetic quota' } }, 429)
    },
  }), ProviderRequestError)
  assert.deepEqual(urls, [
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  ])
})
