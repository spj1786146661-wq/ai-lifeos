import test from 'node:test'
import assert from 'node:assert/strict'
import { generateFollowUpRound, followUpRoundPrompt } from '../lib/life-follow-up-server.ts'
import { TOKENHUB_CHAT_URL } from '../lib/tokenhub-model-test-shared.ts'

const date = '2026-10-26'
const records = [
  {
    id: 'exercise-1',
    type: 'exercise',
    date,
    note: '',
    activity: '卧推',
    weightKg: 60,
    sets: 4,
    sourceText: '今天卧推60公斤4组',
  },
  {
    id: 'mood-1',
    type: 'mood',
    date,
    note: '感觉一般',
    sourceText: '睡醒感觉一般',
  },
  {
    id: 'meal-1',
    type: 'meal',
    date,
    note: '',
    food: '牛肉面',
    sourceText: '中午牛肉面',
  },
]

function snapshotEnv(names) {
  return Object.fromEntries(names.map(name => [name, process.env[name]]))
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

async function withTokenHub(run) {
  const names = [
    'LIFE_AI_PROVIDER',
    'TENCENT_TOKENHUB_API_KEY',
    'TENCENT_TOKENHUB_MODEL_ID',
    'TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS',
  ]
  const snapshot = snapshotEnv(names)
  const originalFetch = globalThis.fetch
  const originalInfo = console.info
  const originalWarn = console.warn
  process.env.LIFE_AI_PROVIDER = 'tokenhub'
  process.env.TENCENT_TOKENHUB_API_KEY = 'test-follow-up-key'
  process.env.TENCENT_TOKENHUB_MODEL_ID = 'deepseek-v4.1-flash-1017'
  process.env.TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS = '900'
  try {
    await run({
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

test('one explicit round call evaluates all records and returns cross-record questions', async () => {
  await withTokenHub(async ({ setFetch, setInfo, setWarn }) => {
    let calls = 0
    let requestBody
    const telemetry = []
    setInfo((message, value) => telemetry.push({ message, value }))
    setWarn(() => assert.fail('successful follow-up planning must not warn'))
    setFetch(async (url, init) => {
      calls += 1
      assert.equal(String(url), TOKENHUB_CHAT_URL)
      requestBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        model: 'deepseek-v4.1-flash-1017',
        choices: [{
          message: {
            content: JSON.stringify({
              followUps: [
                {
                  questionId: 'mood-score',
                  targetRecordId: 'mood-1',
                  recordType: 'mood',
                  targetField: 'score',
                  question: '如果愿意，可以用 1–5 分描述这次心情吗？',
                  round: 2,
                  priority: 2,
                },
                {
                  questionId: 'exercise-duration',
                  targetRecordId: 'exercise-1',
                  recordType: 'exercise',
                  targetField: 'durationMinutes',
                  question: '这次卧推训练持续了多少分钟？',
                  round: 2,
                  priority: 1,
                },
                {
                  questionId: 'known-food',
                  targetRecordId: 'meal-1',
                  recordType: 'meal',
                  targetField: 'food',
                  question: '吃了什么？',
                  round: 2,
                  priority: 1,
                },
              ],
            }),
          },
        }],
        usage: { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500 },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'follow-up-request-id',
        },
      })
    })

    const result = await generateFollowUpRound({
      records,
      history: [],
      round: 2,
      messageId: 'message-follow-up-2',
    })
    assert.equal(calls, 1, 'one user-triggered round must make exactly one upstream call')
    assert.equal(result.mode, 'ai')
    assert.equal(result.provider, 'tokenhub')
    assert.equal(result.model, 'deepseek-v4.1-flash-1017')
    assert.deepEqual(result.followUps.map(item => item.questionId), [
      'exercise-duration',
      'mood-score',
    ])
    assert.deepEqual(result.followUps.map(item => item.targetRecordId), [
      'exercise-1',
      'mood-1',
    ])
    assert.equal(requestBody.model, 'deepseek-v4.1-flash-1017')
    assert.equal(requestBody.messages[0].role, 'system')
    assert.match(requestBody.messages[0].content, /联合检查全部记录/)
    const promptPayload = JSON.parse(requestBody.messages[1].content)
    assert.deepEqual(promptPayload.records.map(record => record.id), [
      'exercise-1',
      'mood-1',
      'meal-1',
    ])
    assert.equal(telemetry.length, 1)
    assert.equal(telemetry[0].value.questionCount, 2)
    assert.equal(telemetry[0].value.correlationId, 'message-follow-up-2')
    assert.equal(JSON.stringify(telemetry).includes('test-follow-up-key'), false)
    assert.equal(JSON.stringify(telemetry).includes('今天卧推'), false)
  })
})

test('an invalid model response falls back once and never retries', async () => {
  await withTokenHub(async ({ setFetch, setInfo, setWarn }) => {
    let calls = 0
    const warnings = []
    setInfo(() => assert.fail('invalid model output must not be labelled as AI success'))
    setWarn((message, value) => warnings.push({ message, value }))
    setFetch(async () => {
      calls += 1
      return new Response(JSON.stringify({
        model: 'deepseek-v4.1-flash-1017',
        choices: [{ message: { content: 'not-json' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const result = await generateFollowUpRound({
      records,
      history: [],
      round: 3,
      messageId: 'message-fallback',
    })
    assert.equal(calls, 1)
    assert.equal(result.mode, 'fallback-rule')
    assert.equal(result.provider, 'rule')
    assert.match(result.notice, /失败.*规则/)
    assert.equal(result.followUps.every(item => item.origin === 'rule'), true)
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].value.success, false)
  })
})

test('history prevents answered or skipped fields from being asked again', async () => {
  await withTokenHub(async ({ setFetch, setInfo, setWarn }) => {
    setInfo(() => {})
    setWarn(() => {})
    setFetch(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            followUps: [
              {
                questionId: 'repeat-duration',
                targetRecordId: 'exercise-1',
                targetField: 'durationMinutes',
                question: '训练多久？',
                round: 2,
                priority: 1,
              },
              {
                questionId: 'repeat-mood',
                targetRecordId: 'mood-1',
                targetField: 'score',
                question: '心情几分？',
                round: 2,
                priority: 2,
              },
            ],
          }),
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const history = [
      {
        questionId: 'duration-old',
        targetRecordId: 'exercise-1',
        recordType: 'exercise',
        targetField: 'durationMinutes',
        question: '训练多久？',
        round: 1,
        priority: 1,
        status: 'answered',
        answer: '45分钟',
      },
      {
        questionId: 'mood-old',
        targetRecordId: 'mood-1',
        recordType: 'mood',
        targetField: 'score',
        question: '心情几分？',
        round: 1,
        priority: 2,
        status: 'skipped',
      },
    ]
    const result = await generateFollowUpRound({
      records: [
        { ...records[0], durationMinutes: 45 },
        records[1],
        records[2],
      ],
      history,
      round: 2,
      messageId: 'message-history',
    })
    assert.equal(result.mode, 'ai')
    assert.deepEqual(result.followUps, [])
    assert.match(result.notice, /没有值得继续补充/)
  })
})

test('round prompt permits zero to three cross-record questions and is bounded to rounds two or three', () => {
  const prompt = followUpRoundPrompt(3)
  assert.match(prompt, /第 3 轮/)
  assert.match(prompt, /最多返回三个问题/)
  assert.match(prompt, /允许.*空数组|没有值得补充的信息，返回空数组/)
  assert.match(prompt, /不得重复询问/)
  assert.match(prompt, /targetRecordId/)
  assert.match(prompt, /priority/)
})
