import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  byokStatusFromErrorCode,
  normalizeTokenHubApiKey,
  validateByokConnection,
} from '../lib/ai/byok-connection.ts'
import {
  forgetRememberedTokenHubApiKey,
  readRememberedTokenHubConnection,
  rememberTokenHubConnection,
  TOKENHUB_BYOK_SESSION_STORAGE_KEY,
  updateRememberedTokenHubConnection,
} from '../lib/ai/byok-session-memory.ts'
import { byokCredentialFingerprint } from '../lib/ai/byok-server.ts'

function createSessionStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

test('TokenHub BYOK accepts one request-scoped key and fixes provider/model server-side', () => {
  const parsed = validateByokConnection({
    provider: 'tokenhub',
    apiKey: '  synthetic-user-key-1234567890  ',
  })
  assert.equal(parsed.provider, 'tokenhub')
  assert.equal(parsed.apiKey, 'synthetic-user-key-1234567890')
  assert.ok(parsed.model.length > 0)
  assert.equal(JSON.stringify({ ...parsed, apiKey: undefined }).includes(parsed.apiKey), false)
})

test('BYOK transport validation rejects empty, oversized and line-broken credentials', () => {
  assert.throws(() => normalizeTokenHubApiKey(''), /格式无效/)
  assert.throws(() => normalizeTokenHubApiKey('x'.repeat(513)), /格式无效/)
  assert.throws(() => normalizeTokenHubApiKey('abc\ndef'), /格式无效/)
})

test('credential fingerprints are stable but never contain the original key', () => {
  const key = 'synthetic-user-key-one'
  const first = byokCredentialFingerprint(key)
  const second = byokCredentialFingerprint(key)
  assert.equal(first, second)
  assert.notEqual(first, byokCredentialFingerprint('synthetic-user-key-two'))
  assert.equal(first.includes(key), false)
})

test('TokenHub errors map to explicit connection states', () => {
  assert.equal(byokStatusFromErrorCode('upstream_401'), 'invalid_key')
  assert.equal(byokStatusFromErrorCode('upstream_403'), 'not_authorized')
  assert.equal(byokStatusFromErrorCode('upstream_429'), 'quota_or_rate_limited')
  assert.equal(byokStatusFromErrorCode('tokenhub_timeout'), 'network_timeout')
  assert.equal(byokStatusFromErrorCode('tokenhub_invalid_json'), 'invalid_schema')
})

test('session memory is opt-in, refresh-restorable and isolated per browser origin store', () => {
  const firstOrigin = createSessionStorage()
  const secondOrigin = createSessionStorage()
  const connection = {
    provider: 'tokenhub',
    apiKey: 'synthetic-session-key-1234567890',
    model: 'deepseek-v4.1-flash-1017',
  }

  assert.equal(readRememberedTokenHubConnection(firstOrigin), null)
  assert.equal(rememberTokenHubConnection(firstOrigin, connection), true)
  assert.deepEqual(readRememberedTokenHubConnection(firstOrigin), connection)
  assert.equal(readRememberedTokenHubConnection(secondOrigin), null)
})

test('session memory writes only when the user explicitly opts in', () => {
  const storage = createSessionStorage()
  const connection = {
    provider: 'tokenhub',
    apiKey: 'synthetic-session-key-1234567890',
    model: 'deepseek-v4.1-flash-1017',
  }

  assert.equal(updateRememberedTokenHubConnection(storage, false, connection), true)
  assert.equal(readRememberedTokenHubConnection(storage), null)
  assert.equal(updateRememberedTokenHubConnection(storage, true, connection), true)
  assert.deepEqual(readRememberedTokenHubConnection(storage), connection)
})

test('remembered TokenHub keys can be actively forgotten', () => {
  const storage = createSessionStorage()
  const connection = {
    provider: 'tokenhub',
    apiKey: 'synthetic-session-key-1234567890',
    model: 'deepseek-v4.1-flash-1017',
  }
  assert.equal(rememberTokenHubConnection(storage, connection), true)
  assert.equal(forgetRememberedTokenHubApiKey(storage), true)
  assert.equal(readRememberedTokenHubConnection(storage), null)
})

test('session memory rejects malformed, invalid and oversized values without leaking them', () => {
  for (const value of [
    '{bad-json',
    JSON.stringify({ version: 2, provider: 'tokenhub', apiKey: 'synthetic-session-key-1234567890', model: 'deepseek-v4.1-flash-1017' }),
    JSON.stringify({ version: 1, provider: 'other', apiKey: 'synthetic-session-key-1234567890', model: 'deepseek-v4.1-flash-1017' }),
    JSON.stringify({ version: 1, provider: 'tokenhub', apiKey: 'short', model: 'deepseek-v4.1-flash-1017' }),
    JSON.stringify({ version: 1, provider: 'tokenhub', apiKey: 'synthetic-session-key-1234567890', model: 'https://invalid model' }),
    'x'.repeat(1_025),
  ]) {
    const storage = createSessionStorage()
    storage.setItem(TOKENHUB_BYOK_SESSION_STORAGE_KEY, value)
    assert.equal(readRememberedTokenHubConnection(storage), null)
    assert.equal(storage.getItem(TOKENHUB_BYOK_SESSION_STORAGE_KEY), null)
  }
})

test('connection UI defaults session memory off and never puts the key in persistent storage, URL or cookies', () => {
  const source = fs.readFileSync(
    new URL('../components/life-records/AiModelConnection.tsx', import.meta.url),
    'utf8',
  )
  const pageSource = fs.readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /localStorage\.(?:setItem|getItem)\([^)]*apiKey/i)
  assert.doesNotMatch(source, /document\.cookie[^\\n]*apiKey/i)
  assert.doesNotMatch(source, /URLSearchParams[^\\n]*apiKey/i)
  assert.match(source, /const \[apiKey, setApiKey\] = useState\(''\)/)
  assert.match(source, /const \[rememberForSession, setRememberForSession\] = useState\(restoredFromSession\)/)
  assert.match(pageSource, /const \[byokRestoredFromSession, setByokRestoredFromSession\] = useState\(false\)/)
  assert.match(pageSource, /readRememberedByokConnection\(window\.sessionStorage\)/)
  assert.match(source, /updateRememberedByokConnection\(/)
  assert.match(source, /forgetRememberedByokApiKey\(window\.sessionStorage\)/)
  assert.match(source, /已从本次浏览会话恢复 Key；本页面尚未重新执行连接测试/)
  assert.match(source, /providerDefinition\.keyUrl/)
  assert.match(source, /providerDefinition\.documentationUrl/)
  assert.match(source, /bigmodel\.cn\/invite\?icode=/)
  assert.match(source, /推广邀请/)
})
