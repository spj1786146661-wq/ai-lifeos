import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLifeText,
  resolveLifeAiProviderState,
  tokenHubLifeOutputBudget,
} from '../lib/life-parse-server.ts'
import { prepareAutoSaveBatch } from '../lib/life-auto-save.ts'
import { applyFollowUpAnswer } from '../lib/life-follow-up.ts'
import { lifeRecordSourceLabel } from '../lib/life-record-source.ts'
import { normalizeLifeRecord } from '../lib/life-records.ts'
import {
  TOKENHUB_CHAT_URL,
  TOKENHUB_DEFAULT_MODEL_ID,
  resolveTokenHubModelId,
} from '../lib/tokenhub-model-test-shared.ts'

const date = '2026-10-26'
const syntheticText = '昨晚睡了7小时，今天卧推60公斤做4组，中午吃了一碗牛肉面。'
const syntheticTokenHubKey = 'test-server-key-1234567890'

function envSnapshot(names) {
  return Object.fromEntries(names.map(name => [name, process.env[name]]))
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

async function withTokenHubEnvironment(run) {
  const names = [
    'LIFE_AI_PROVIDER',
    'TENCENT_TOKENHUB_API_KEY',
    'TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS',
    'TENCENT_TOKENHUB_MODEL_ID',
  ]
  const snapshot = envSnapshot(names)
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const originalWarn = console.warn
  process.env.LIFE_AI_PROVIDER = 'tokenhub'
  process.env.TENCENT_TOKENHUB_API_KEY = syntheticTokenHubKey
  process.env.TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS = '1200'
  process.env.TENCENT_TOKENHUB_MODEL_ID = 'deepseek-v4.1-flash-1017'
  try {
    return await run({
      setFetch(value) { globalThis.fetch = value },
      setInfo(value) { console.info = value },
      setWarn(value) { console.warn = value },
    })
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
    console.warn = originalWarn
    restoreEnv(snapshot)
  }
}

test('formal parser selects TokenHub explicitly without exposing the key', () => {
  const state = resolveLifeAiProviderState({
    LIFE_AI_PROVIDER: 'tokenhub',
    TENCENT_TOKENHUB_API_KEY: 'test-tokenhub-key-not-returned',
  })
  assert.equal(state.kind, 'tokenhub')
  assert.equal(state.model, TOKENHUB_DEFAULT_MODEL_ID)
  assert.match(state.label, new RegExp(TOKENHUB_DEFAULT_MODEL_ID.replace(/[/.]/g, '\\$&')))
  assert.equal(JSON.stringify(state).includes('test-tokenhub-key-not-returned'), false)
})

test('formal TokenHub model comes from one validated environment setting', () => {
  assert.equal(resolveTokenHubModelId(undefined), 'deepseek/deepseek-flash')
  assert.equal(resolveTokenHubModelId(''), 'deepseek/deepseek-flash')
  assert.equal(resolveTokenHubModelId('  deepseek-v4.1-flash-1017  '), 'deepseek-v4.1-flash-1017')

  const state = resolveLifeAiProviderState({
    LIFE_AI_PROVIDER: 'tokenhub',
    TENCENT_TOKENHUB_API_KEY: syntheticTokenHubKey,
    TENCENT_TOKENHUB_MODEL_ID: 'deepseek-v4.1-flash-1017',
  })
  assert.equal(state.kind, 'tokenhub')
  assert.equal(state.model, 'deepseek-v4.1-flash-1017')
  assert.match(state.label, /deepseek-v4\.1-flash-1017/)

  for (const invalid of [
    'model with spaces',
    '../model',
    'model\ninjected',
    'x'.repeat(161),
  ]) {
    assert.throws(
      () => resolveLifeAiProviderState({
        LIFE_AI_PROVIDER: 'tokenhub',
        TENCENT_TOKENHUB_API_KEY: syntheticTokenHubKey,
        TENCENT_TOKENHUB_MODEL_ID: invalid,
      }),
      /TENCENT_TOKENHUB_MODEL_ID/,
    )
  }
})

test('formal TokenHub output budget is configurable and bounded', () => {
  assert.equal(tokenHubLifeOutputBudget(undefined), 900)
  assert.equal(tokenHubLifeOutputBudget('1200'), 1200)
  assert.equal(tokenHubLifeOutputBudget('1'), 128)
  assert.equal(tokenHubLifeOutputBudget('999999'), 2000)
  assert.equal(tokenHubLifeOutputBudget('invalid'), 900)
})

test('formal parsing uses configured model, JSON output and disabled thinking once', async () => {
  await withTokenHubEnvironment(async ({ setFetch, setInfo, setWarn }) => {
    let calls = 0
    let request
    const telemetry = []
    setInfo((message, value) => telemetry.push({ message, value }))
    setWarn(() => assert.fail('successful request must not log a warning'))
    setFetch(async (url, init) => {
      calls += 1
      request = { url: String(url), init }
      return new Response(JSON.stringify({
        model: 'deepseek-v4.1-flash-1017',
        choices: [{
          message: {
            content: JSON.stringify({
              records: [
                { type: 'sleep', date, hours: 7, note: '' },
                { type: 'exercise', date, activity: '卧推', weightKg: 60, sets: 4, note: '' },
                { type: 'meal', date, food: '牛肉面', note: '' },
              ],
              followUps: [{
                id: 'exercise-duration',
                recordIndex: 1,
                type: 'exercise',
                field: 'durationMinutes',
                question: '这次卧推训练持续了多少分钟？',
                round: 1,
              }],
            }),
          },
        }],
        usage: { prompt_tokens: 500, completion_tokens: 150, total_tokens: 650 },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'safe-request-id',
        },
      })
    })

    const result = await parseLifeText(syntheticText, date, 'message-tokenhub')
    assert.equal(calls, 1, 'formal parsing must not retry or call another provider')
    assert.equal(request.url, TOKENHUB_CHAT_URL)
    assert.equal(request.init.headers.Authorization, `Bearer ${syntheticTokenHubKey}`)
    const body = JSON.parse(request.init.body)
    assert.equal(body.model, 'deepseek-v4.1-flash-1017')
    assert.equal(body.max_tokens, 1200)
    assert.deepEqual(body.thinking, { type: 'disabled' })
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(body.stream, false)
    assert.equal(body.messages[0].role, 'system')
    assert.match(body.messages[0].content, /"records".*"followUps"/)
    assert.equal(body.messages[1].content, syntheticText)

    assert.equal(result.mode, 'ai')
    assert.equal(result.provider, 'tokenhub')
    assert.equal(result.model, 'deepseek-v4.1-flash-1017')
    assert.deepEqual(result.records.map(item => item.draft.type), ['sleep', 'exercise', 'meal'])
    assert.equal(result.followUps.length, 1)
    assert.equal(result.followUps[0].origin, 'ai')
    assert.equal(result.followUps[0].field, 'durationMinutes')
    assert.equal(
      result.records
        .filter(item => item.draft.sourceRef)
        .every(item => item.draft.sourceRef.provider === 'tokenhub'),
      true,
    )

    assert.equal(telemetry.length, 1)
    assert.equal(telemetry[0].value.success, true)
    assert.equal(telemetry[0].value.correlationId, 'message-tokenhub')
    assert.equal(telemetry[0].value.usage.totalTokens, 650)
    assert.equal(JSON.stringify(telemetry).includes(syntheticText), false)
    assert.equal(JSON.stringify(telemetry).includes(syntheticTokenHubKey), false)
  })
})

test('a successful AI response may deliberately return no follow-up questions', async () => {
  await withTokenHubEnvironment(async ({ setFetch, setInfo }) => {
    setInfo(() => {})
    setFetch(async () => new Response(JSON.stringify({
      model: 'deepseek-v4.1-flash-1017',
      choices: [{
        message: {
          content: JSON.stringify({
            records: [
              { type: 'sleep', date, hours: 7, note: '' },
              { type: 'exercise', date, activity: '卧推', weightKg: 60, sets: 4, durationMinutes: 45, note: '' },
              { type: 'meal', date, food: '牛肉面', note: '' },
            ],
            followUps: [],
          }),
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await parseLifeText(syntheticText, date, 'message-no-questions')
    assert.equal(result.mode, 'ai')
    assert.equal(result.followUps.length, 0)
  })
})

test('empty TokenHub content degrades to rules without retrying or claiming AI', async () => {
  await withTokenHubEnvironment(async ({ setFetch, setInfo, setWarn }) => {
    let calls = 0
    const warnings = []
    setInfo(() => assert.fail('failed request must not log success'))
    setWarn((message, value) => warnings.push({ message, value }))
    setFetch(async () => {
      calls += 1
      return new Response(JSON.stringify({
        model: 'deepseek-v4.1-flash-1017',
        choices: [{ message: { content: '' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const result = await parseLifeText('昨晚睡了7小时', date, 'message-empty')
    assert.equal(calls, 1)
    assert.equal(result.mode, 'fallback-rule')
    assert.equal(result.provider, 'rule')
    assert.match(result.notice, /TokenHub 模型不可用/)
    assert.equal(result.records.some(item => item.draft.type === 'sleep'), true)
    assert.equal(result.followUps.every(question => question.origin === 'rule'), true)
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].value.code, 'tokenhub_empty_reply')
  })
})

test('invalid record JSON degrades safely and never creates a remote candidate', async () => {
  await withTokenHubEnvironment(async ({ setFetch, setInfo, setWarn }) => {
    let calls = 0
    setInfo(() => {})
    setWarn(() => {})
    setFetch(async () => {
      calls += 1
      return new Response(JSON.stringify({
        model: 'deepseek-v4.1-flash-1017',
        choices: [{ message: { content: '{"records":[{"type":"sleep","hours":"many"}]}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const result = await parseLifeText('昨晚睡了7小时', date, 'message-invalid')
    assert.equal(calls, 1)
    assert.equal(result.mode, 'fallback-rule')
    assert.equal(result.provider, 'rule')
    assert.match(result.notice, /JSON 未通过结构校验/)
    assert.equal(result.records.every(item => item.draft.sourceRef?.provider === 'rule'), true)
  })
})

test('an upstream 401 falls back once and preserves all known facts for automatic save', async () => {
  await withTokenHubEnvironment(async ({ setFetch, setInfo, setWarn }) => {
    const text = '昨晚睡了7个半小时，睡醒感觉一般。今天在健身房卧推60公斤，做了4组。中午吃了一碗牛肉面。'
    let calls = 0
    const warnings = []
    setInfo(() => assert.fail('a rejected upstream request must not log success'))
    setWarn((message, value) => warnings.push({ message, value }))
    setFetch(async () => {
      calls += 1
      return new Response(JSON.stringify({
        error: {
          message: 'The API Key does not exist or signature verification failed.',
          code: '401002',
          request_id: 'request-from-body',
        },
      }), { status: 401, headers: { 'content-type': 'application/json' } })
    })

    const result = await parseLifeText(text, date, 'message-upstream-401')
    assert.equal(calls, 1, 'the formal parser must not retry a failed paid request')
    assert.equal(result.mode, 'fallback-rule')
    assert.equal(result.provider, 'rule')
    assert.match(result.notice, /未获得 AI 结果/)
    assert.deepEqual(result.records.map(item => item.draft.type), ['sleep', 'exercise', 'meal'])
    assert.equal(result.records[0].draft.hours, 7.5)
    assert.equal(result.records[1].draft.weightKg, 60)
    assert.equal(result.records[1].draft.sets, 4)
    assert.equal(result.records[1].draft.durationMinutes, undefined)
    assert.equal(result.records[2].draft.food, '一碗牛肉面')
    assert.equal(result.records.every(item => item.draft.sourceRef?.provider === 'rule'), true)
    assert.equal(result.followUps.every(question => question.origin === 'rule'), true)

    const prepared = prepareAutoSaveBatch(result.records.map(item => item.draft), date)
    assert.deepEqual(prepared.drafts.map(item => item.type), ['sleep', 'exercise', 'meal'])
    assert.deepEqual(prepared.incompleteIndexes, [])
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].value.code, 'upstream_401')
    assert.equal(warnings[0].value.upstreamCode, '401002')
    assert.equal(warnings[0].value.requestId, 'request-from-body')
    assert.equal(warnings[0].value.correlationId, 'message-upstream-401')
    assert.equal(JSON.stringify(warnings).includes(text), false)
    assert.equal(JSON.stringify(warnings).includes(syntheticTokenHubKey), false)
  })
})

test('TokenHub provenance survives normalization and follow-up updates the original record', () => {
  const record = normalizeLifeRecord({
    id: 'record-exercise',
    type: 'exercise',
    date,
    activity: '卧推',
    weightKg: 60,
    sets: 4,
    note: '',
    sourceText: '卧推60公斤做4组',
    sourceRef: {
      messageId: 'message-tokenhub',
      start: 0,
      end: 10,
      text: '卧推60公斤做4组',
      origin: 'ai',
      provider: 'tokenhub',
      model: 'deepseek-v4.1-flash-1017',
    },
  }, date)
  assert.equal(record.sourceRef.provider, 'tokenhub')
  assert.match(lifeRecordSourceLabel(record.sourceRef), /TokenHub/)

  const updated = applyFollowUpAnswer(record, {
    questionId: 'duration',
    recordIndex: 0,
    type: 'exercise',
    field: 'durationMinutes',
    question: '持续了多久？',
    answer: '45分钟',
    round: 1,
  }, '2026-10-26T12:00:00.000Z', {
    origin: 'ai',
    provider: 'tokenhub',
    model: 'deepseek-v4.1-flash-1017',
  })
  assert.equal(updated.durationMinutes, 45)
  assert.equal(updated.supplements[0].provider, 'tokenhub')
  assert.equal('id' in updated, false, 'follow-up returns an update draft, not a duplicate record')
})

test('explicit provider selection does not silently switch to another remote provider', () => {
  const missingTokenHub = resolveLifeAiProviderState({
    LIFE_AI_PROVIDER: 'tokenhub',
    TENCENT_TOKENHUB_API_KEY: '',
    OPENROUTER_API_KEY: 'test-openrouter-key-not-used',
  })
  assert.equal(missingTokenHub.kind, 'unconfigured')
  assert.match(missingTokenHub.reason, /TENCENT_TOKENHUB_API_KEY/)

  const openrouter = resolveLifeAiProviderState({
    LIFE_AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'configured',
    OPENROUTER_DEFAULT_MODEL: 'test/model',
  })
  assert.equal(openrouter.kind, 'openrouter')
  assert.equal(openrouter.model, 'test/model')
})
