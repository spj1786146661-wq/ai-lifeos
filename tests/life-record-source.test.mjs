import test from 'node:test'
import assert from 'node:assert/strict'
import { lifeRecordSourceLabel } from '../lib/life-record-source.ts'

const ref = (overrides = {}) => ({
  messageId: 'm1',
  start: 0,
  end: 4,
  text: '心情不错',
  origin: 'rule',
  ...overrides,
})

test('source labels distinguish real models, local rules and manual corrections', () => {
  assert.match(lifeRecordSourceLabel(ref({ origin: 'ai', provider: 'chatgpt', model: 'gpt-test' })), /ChatGPT 套餐/)
  assert.match(lifeRecordSourceLabel(ref({ origin: 'ai', provider: 'openrouter' })), /OpenRouter/)
  assert.match(lifeRecordSourceLabel(ref({ origin: 'rule', provider: 'rule' })), /本地规则解析/)
  assert.match(lifeRecordSourceLabel(ref({ origin: 'fallback-rule', provider: 'rule' })), /本地规则补回/)
  assert.match(lifeRecordSourceLabel(ref({ origin: 'user' })), /手动/)
})

test('legacy ai labels without a provider are not presented as verified model output', () => {
  const label = lifeRecordSourceLabel(ref({ origin: 'ai' }))
  assert.match(label, /来源未标注/)
  assert.doesNotMatch(label, /ChatGPT|真实模型/)
})

test('confirmed history labels keep the same provenance', () => {
  assert.match(lifeRecordSourceLabel(ref({ origin: 'ai', provider: 'chatgpt' }), true), /已确认/)
  assert.match(lifeRecordSourceLabel(ref({ origin: 'rule', provider: 'rule' }), true), /未调用 AI/)
})
