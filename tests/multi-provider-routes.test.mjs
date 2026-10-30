import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  PROVIDER_REGISTRY,
  getProviderDefinition,
  resolveProviderModel,
} from '../lib/ai/provider-registry.ts'

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
  path.join(root, 'app/api/ai/providers/test/route.ts'),
).href)

process.env.AIOS_PERSONAL_ALPHA_BYOK = '1'
process.env.AIOS_PERSONAL_ALPHA_BYOK_HOST = 'localhost:3100'

const providers = PROVIDER_REGISTRY.map(provider => provider.providerId)

const syntheticRecords = {
  records: [
    {
      type: 'exercise',
      date: '2026-01-15',
      activity: '散步',
      durationMinutes: 20,
    },
    {
      type: 'learning',
      date: '2026-01-15',
      subject: '英语',
      durationMinutes: 30,
    },
  ],
  followUps: [],
}

function localRequest(body) {
  return new NextRequest('http://localhost:3100/api/ai/providers/test', {
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

function providerResponse(provider, content) {
  const definition = getProviderDefinition(provider)
  if (definition.protocol === 'gemini') {
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: content }] } }],
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 10,
        totalTokenCount: 30,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': `request-${provider}` },
    })
  }
  if (definition.protocol === 'anthropic') {
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: content }],
      usage: { input_tokens: 20, output_tokens: 10 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'request-id': `request-${provider}` },
    })
  }
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': `request-${provider}` },
  })
}

test('connection test performs one structured request for every registered provider', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const [index, provider] of providers.entries()) {
      const definition = getProviderDefinition(provider)
      const apiKey = `synthetic-multi-provider-key-${provider}-123456`
      const seen = []
      globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), init })
        return providerResponse(provider, JSON.stringify(syntheticRecords))
      }
      const response = await route.POST(localRequest({
        provider,
        model: definition.defaultModel,
        apiKey,
        clientSessionId: `multi-provider-session-${index}-0001`,
        actionId: `multi-provider-action-${index}-0001`,
      }))
      const payload = await response.json()
      assert.equal(response.status, 200, provider)
      assert.equal(payload.status, 'connected', provider)
      assert.equal(payload.provider, provider)
      assert.equal(payload.model, definition.defaultModel)
      assert.equal(seen.length, 1, `${provider} must make one upstream call`)
      assert.equal(JSON.stringify(payload).includes(apiKey), false)

      const request = seen[0]
      if (definition.protocol === 'gemini') {
        assert.match(request.url, /generativelanguage\.googleapis\.com/)
        assert.equal(new Headers(request.init.headers).get('x-goog-api-key'), apiKey)
        const body = JSON.parse(request.init.body)
        assert.equal(body.generationConfig.responseMimeType, 'application/json')
        assert.equal(body.generationConfig.maxOutputTokens, 600)
      } else if (definition.protocol === 'anthropic') {
        assert.equal(request.url, definition.endpoint)
        assert.equal(new Headers(request.init.headers).get('x-api-key'), apiKey)
        const body = JSON.parse(request.init.body)
        assert.equal(body.max_tokens, 600)
        assert.equal('response_format' in body, false)
      } else {
        assert.equal(request.url, definition.endpoint)
        assert.equal(new Headers(request.init.headers).get('authorization'), `Bearer ${apiKey}`)
        const body = JSON.parse(request.init.body)
        const tokenField = definition.maxOutputTokensField ?? 'max_tokens'
        assert.equal(body[tokenField], 600)
        if (resolveProviderModel(provider, definition.defaultModel).nativeJson) {
          assert.equal(body.response_format.type, 'json_object')
        } else {
          assert.equal('response_format' in body, false)
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('missing and rejected keys never reach a provider and never leak', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const [index, provider] of providers.entries()) {
      const definition = getProviderDefinition(provider)
      let upstreamCalls = 0
      globalThis.fetch = async () => {
        upstreamCalls += 1
        return new Response('{"error":{"message":"synthetic unauthorized"}}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }

      const missing = await route.POST(localRequest({
        provider,
        model: definition.defaultModel,
        apiKey: '',
        clientSessionId: `missing-key-session-${index}-0001`,
        actionId: `missing-key-action-${index}-0001`,
      }))
      assert.equal(missing.status, 400, provider)
      assert.equal(upstreamCalls, 0, provider)

      const rejectedKey = `synthetic-rejected-key-${provider}-123456`
      const rejected = await route.POST(localRequest({
        provider,
        model: definition.defaultModel,
        apiKey: rejectedKey,
        clientSessionId: `rejected-key-session-${index}-0001`,
        actionId: `rejected-key-action-${index}-0001`,
      }))
      const rejectedPayload = await rejected.json()
      assert.equal(
        rejected.status,
        401,
        `${provider}: ${JSON.stringify(rejectedPayload)}`,
      )
      assert.equal(rejectedPayload.status, 'invalid_key', provider)
      assert.equal(upstreamCalls, 1, provider)
      assert.equal(JSON.stringify(rejectedPayload).includes(rejectedKey), false)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('TokenHub-specific failures keep safe status, upstream code and request ID', async () => {
  const originalFetch = globalThis.fetch
  const definition = getProviderDefinition('tokenhub')
  try {
    const cases = [
      {
        response: () => new Response(
          '{"error":{"code":"region_denied","message":"synthetic"}}',
          {
            status: 403,
            headers: { 'content-type': 'application/json', 'x-request-id': 'safe-request-403' },
          },
        ),
        status: 403,
        connectionStatus: 'not_authorized',
        code: 'upstream_403',
      },
      {
        response: () => new Response(
          '{"error":{"code":"rate_limit","message":"synthetic"}}',
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'x-request-id': 'safe-request-429' },
          },
        ),
        status: 429,
        connectionStatus: 'quota_or_rate_limited',
        code: 'upstream_429',
      },
      {
        response: () => new Response(
          '{"choices":[{"message":{"content":""}}]}',
          {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-request-id': 'safe-request-empty' },
          },
        ),
        status: 422,
        connectionStatus: 'invalid_schema',
        code: 'tokenhub_empty_reply',
      },
    ]

    for (const [index, item] of cases.entries()) {
      globalThis.fetch = async () => item.response()
      const apiKey = `synthetic-tokenhub-error-key-${index}-123456`
      const response = await route.POST(localRequest({
        provider: 'tokenhub',
        model: definition.defaultModel,
        apiKey,
        clientSessionId: `tokenhub-error-session-${index}-0001`,
        actionId: `tokenhub-error-action-${index}-0001`,
      }))
      const payload = await response.json()
      assert.equal(response.status, item.status)
      assert.equal(payload.status, item.connectionStatus)
      assert.equal(payload.code, item.code)
      assert.match(payload.requestId, /^safe-request-/)
      assert.equal(JSON.stringify(payload).includes(apiKey), false)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
