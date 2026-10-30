import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BYOK_PROVIDER_IDS,
  isByokProviderId,
  isLifeRecordProvider,
} from '../lib/ai/provider-types.ts'
import {
  getProviderDefinition,
  normalizeProviderModelId,
  resolveProviderModel,
} from '../lib/ai/provider-registry.ts'
import { validateByokConnection } from '../lib/ai/byok-connection.ts'
import { byokCredentialFingerprint } from '../lib/ai/byok-server.ts'

test('all 17 provider registry entries are resolvable with fixed HTTPS endpoints', () => {
  assert.equal(BYOK_PROVIDER_IDS.length, 17)
  for (const id of BYOK_PROVIDER_IDS) {
    const provider = getProviderDefinition(id)
    assert.equal(provider.providerId, id)
    assert.match(provider.endpoint, /^https:\/\//)
    assert.ok(provider.defaultModel)
    assert.ok(provider.models.some(model => model.id === provider.defaultModel))
    assert.equal(provider.supportsText, true)
    assert.equal(isByokProviderId(id), true)
    assert.equal(isLifeRecordProvider(id), true)
  }
  assert.equal(isByokProviderId('unknown'), false)
  assert.equal(isLifeRecordProvider('rule'), true)
  assert.equal(isLifeRecordProvider('chatgpt'), true)
})

test('reviewed model capability metadata is conservative and manual IDs are text-only', () => {
  assert.equal(resolveProviderModel('openai', 'gpt-4o-mini').supportsVision, true)
  assert.equal(resolveProviderModel('openai', 'custom-text-model').supportsVision, false)
  assert.equal(resolveProviderModel('gemini', 'gemini-2.5-flash').supportsVision, true)
  assert.equal(resolveProviderModel('anthropic', 'claude-sonnet-4-20250514').supportsVision, true)
  for (const provider of [
    'tokenhub',
    'bigmodel',
    'deepseek',
    'qwen',
    'openrouter',
    'openai',
    'gemini',
  ]) {
    const definition = getProviderDefinition(provider)
    assert.equal(
      resolveProviderModel(provider, definition.defaultModel).nativeJson,
      true,
      `${provider} should use its reviewed structured-output capability`,
    )
  }
  assert.equal(
    resolveProviderModel('anthropic', 'claude-sonnet-4-20250514').nativeJson,
    false,
  )
  assert.equal(
    resolveProviderModel('siliconflow', 'Qwen/Qwen3-8B').nativeJson,
    false,
    'unreviewed providers must stay conservative',
  )
  assert.equal(
    resolveProviderModel('openai', 'custom-text-model').nativeJson,
    false,
  )
  assert.equal(getProviderDefinition('qwen').maxOutputTokensField, 'max_completion_tokens')
  assert.equal(getProviderDefinition('openai').maxOutputTokensField, 'max_completion_tokens')
  assert.equal(getProviderDefinition('deepseek').maxOutputTokensField, 'max_tokens')
  assert.throws(() => normalizeProviderModelId('https://evil.example/model'), /格式无效/)
  assert.throws(() => getProviderDefinition('not-a-provider'), /不支持/)
})

test('generic BYOK accepts provider/model/key but rejects client endpoint overrides', () => {
  const parsed = validateByokConnection({
    provider: 'bigmodel',
    model: 'glm-5.3',
    apiKey: 'synthetic-bigmodel-key-123456',
  })
  assert.deepEqual(parsed, {
    provider: 'bigmodel',
    model: 'glm-5.3',
    apiKey: 'synthetic-bigmodel-key-123456',
  })
  for (const field of ['baseUrl', 'base_url', 'endpoint', 'url']) {
    assert.throws(() => validateByokConnection({
      provider: 'bigmodel',
      model: 'glm-5.3',
      apiKey: 'synthetic-bigmodel-key-123456',
      [field]: 'https://127.0.0.1/private',
    }), /Base URL/)
  }
})

test('credential fingerprints separate identical keys across providers', () => {
  const apiKey = 'same-synthetic-key-value-123456'
  const tokenhub = byokCredentialFingerprint({ provider: 'tokenhub', apiKey })
  const openai = byokCredentialFingerprint({ provider: 'openai', apiKey })
  assert.notEqual(tokenhub, openai)
  assert.equal(tokenhub.includes(apiKey), false)
  assert.equal(openai.includes(apiKey), false)
})
