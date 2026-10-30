import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROVIDER_REGISTRY,
  getProviderDefinition,
} from '../lib/ai/provider-registry.ts'
import { parseLifeText } from '../lib/life-parse-server.ts'
import { generateFollowUpRound } from '../lib/life-follow-up-server.ts'
import { executeLifeChat } from '../lib/life-chat-route.ts'

const providers = PROVIDER_REGISTRY.map(provider => provider.providerId)

const date = '2026-10-30'
const text = '昨晚睡了7小时，今天散步20分钟，中午吃了一碗面。'
const savedRecords = [
  {
    id: 'sleep-provider-test',
    type: 'sleep',
    date,
    hours: 7,
    note: '',
    sourceText: '昨晚睡了7小时',
  },
  {
    id: 'meal-provider-test',
    type: 'meal',
    date,
    food: '面',
    note: '',
    sourceText: '中午吃了一碗面',
  },
]

function responseFor(provider, content) {
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
      headers: { 'content-type': 'application/json', 'x-goog-request-id': `request-${provider}` },
    })
  }
  if (definition.protocol === 'anthropic') {
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: content }],
      usage: { input_tokens: 20, output_tokens: 10 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'anthropic-request-id': `request-${provider}` },
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

function serializedBody(init) {
  return String(init?.body ?? '')
}

test('all registered providers stay selected across chat parsing, analysis and follow-up', async () => {
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const originalWarn = console.warn
  console.info = () => {}
  console.warn = () => {}
  try {
    for (const provider of providers) {
      const definition = getProviderDefinition(provider)
      const apiKey = `synthetic-flow-key-${provider}-123456`
      const connection = {
        provider,
        model: definition.defaultModel,
        apiKey,
      }
      const seen = []
      globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), init })
        const body = serializedBody(init)
        if (body.includes('生活记录分析助手')) {
          return responseFor(provider, '近 7 天已记录 1 条睡眠记录。')
        }
        if (body.includes('生活记录补充问题规划器')) {
          return responseFor(provider, JSON.stringify({ followUps: [] }))
        }
        return responseFor(provider, JSON.stringify({
          records: [
            { type: 'sleep', date, hours: 7, note: '' },
            { type: 'exercise', date, activity: '散步', durationMinutes: 20, note: '' },
            { type: 'meal', date, food: '面', note: '' },
          ],
          followUps: [],
        }))
      }

      const parsed = await parseLifeText(text, date, `chat-${provider}-0001`, {
        byokConnection: connection,
        requireByok: true,
      })
      assert.equal(parsed.mode, 'ai', `${provider}: ${parsed.notice ?? 'no notice'}`)
      assert.equal(parsed.provider, provider, provider)
      assert.equal(parsed.model, definition.defaultModel, provider)
      assert.equal(parsed.records.length, 3, provider)
      assert.equal(
        parsed.records.every(record => record.draft.sourceRef?.provider === provider),
        true,
        provider,
      )

      const analysis = await executeLifeChat({
        text: '分析一下我最近 7 天的睡眠',
        date,
        records: savedRecords,
        messageId: `analysis-${provider}-0001`,
        byokConnection: connection,
        requireByok: true,
      })
      assert.equal(analysis.status, 200, provider)
      assert.equal(analysis.body.mode, 'ai', provider)
      assert.equal(analysis.body.provider, provider, provider)
      assert.equal(analysis.body.model, definition.defaultModel, provider)

      const followUp = await generateFollowUpRound({
        records: savedRecords,
        history: [],
        round: 2,
        messageId: `follow-${provider}-0001`,
        byokConnection: connection,
        requireByok: true,
      })
      assert.equal(followUp.mode, 'ai', provider)
      assert.equal(followUp.provider, provider, provider)
      assert.equal(followUp.model, definition.defaultModel, provider)
      assert.deepEqual(followUp.followUps, [], provider)

      assert.equal(seen.length, 3, `${provider} must make exactly three deliberate calls`)
      assert.equal(
        seen.every(request => {
          if (definition.protocol === 'gemini') {
            return request.url.includes('generativelanguage.googleapis.com')
              && new Headers(request.init.headers).get('x-goog-api-key') === apiKey
          }
          if (definition.protocol === 'anthropic') {
            return request.url === definition.endpoint
              && new Headers(request.init.headers).get('x-api-key') === apiKey
          }
          return request.url === definition.endpoint
            && new Headers(request.init.headers).get('authorization') === `Bearer ${apiKey}`
        }),
        true,
        `${provider} must never fall back to another endpoint`,
      )
      assert.equal(
        seen.some(request => serializedBody(request.init).includes(apiKey)),
        false,
        `${provider} key must not appear in request bodies`,
      )
    }
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    console.warn = originalWarn
  }
})
