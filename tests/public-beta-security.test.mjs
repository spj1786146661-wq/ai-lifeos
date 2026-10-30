import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const {
  issuePublicBetaSession,
  publicBetaIngressAuthorized,
  publicBetaRuntimeStatus,
  verifyPublicBetaSession,
  withPublicBetaRequestBudget,
} = await import(pathToFileURL(path.join(root, 'lib/public-beta-security.ts')).href)

function validEnv(overrides = {}) {
  return {
    AIOS_PUBLIC_BETA_HOSTS: 'beta.example.test',
    AIOS_PUBLIC_BETA_DEPLOYMENT_MODE: 'single-instance',
    AIOS_PUBLIC_BETA_INSTANCE_COUNT: '1',
    AIOS_PUBLIC_BETA_STATE_BACKEND: 'memory-single-instance',
    AIOS_PUBLIC_BETA_INSTANCE_ID: 'test-instance-01',
    AIOS_PUBLIC_BETA_RELEASE_ID: 'beta-test-abcdef1',
    AIOS_PUBLIC_BETA_SOURCE_URL: 'https://example.test/source/beta-test-abcdef1',
    AIOS_PUBLIC_BETA_INGRESS_SECRET: 'test-ingress-secret-00000000000000000001',
    AIOS_PUBLIC_BETA_SESSION_SECRET: 'test-session-secret-00000000000000000001',
    ...overrides,
  }
}

test('single-instance Public Beta configuration passes and multi-instance fails closed', () => {
  assert.equal(publicBetaRuntimeStatus(validEnv()).ok, true)
  assert.equal(publicBetaRuntimeStatus(validEnv({
    AIOS_PUBLIC_BETA_INSTANCE_COUNT: '2',
  })).ok, false)
  assert.equal(publicBetaRuntimeStatus(validEnv({
    AIOS_PUBLIC_BETA_STATE_BACKEND: 'redis',
  })).ok, false)
})

test('Public Beta rejects developer AI and Firebase credentials', () => {
  assert.equal(publicBetaRuntimeStatus(validEnv({
    TENCENT_TOKENHUB_API_KEY: 'must-not-be-present',
  })).ok, false)
  assert.equal(publicBetaRuntimeStatus(validEnv({
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'must-not-be-present',
  })).ok, false)
})

test('signed anonymous sessions cannot be forged, altered or used after expiry', () => {
  const env = validEnv()
  const now = Date.UTC(2026, 9, 28, 12, 0, 0)
  const issued = issuePublicBetaSession(now, env)
  assert.equal(verifyPublicBetaSession(issued.value, now + 1_000, env), issued.id)
  assert.equal(verifyPublicBetaSession(`${issued.value}x`, now + 1_000, env), null)
  assert.equal(verifyPublicBetaSession(issued.value, now + 25 * 60 * 60_000, env), null)
  assert.equal(verifyPublicBetaSession(issued.value, now + 1_000, validEnv({
    AIOS_PUBLIC_BETA_SESSION_SECRET: 'different-session-secret-000000000000001',
  })), null)
})

test('trusted ingress requires the exact server secret', () => {
  const env = validEnv()
  assert.equal(publicBetaIngressAuthorized(env.AIOS_PUBLIC_BETA_INGRESS_SECRET, env), true)
  assert.equal(publicBetaIngressAuthorized('wrong-secret-000000000000000000000000', env), false)
  assert.equal(publicBetaIngressAuthorized(null, env), false)
})

test('Public Beta budgets cover connection test, chat and follow-up per session', async () => {
  const run = async () => 'ok'
  for (const [operation, allowed] of [
    ['connection-test', 3],
    ['chat', 4],
    ['follow-up', 2],
  ]) {
    const sessionId = `session-${crypto.randomUUID()}`
    const shared = {
      operation,
      credentialFingerprint: `credential-${crypto.randomUUID()}`,
      run,
    }
    for (let index = 0; index < allowed; index += 1) {
      assert.equal(await withPublicBetaRequestBudget({ ...shared, sessionId }), 'ok')
    }
    await assert.rejects(
      () => withPublicBetaRequestBudget({ ...shared, sessionId }),
      error => error?.name === 'PublicBetaBudgetError' && error?.status === 429,
    )
    assert.equal(await withPublicBetaRequestBudget({
      ...shared,
      sessionId: `session-${crypto.randomUUID()}`,
    }), 'ok')
  }
})

test('privacy, terms and source pages expose the required notices without a fake source URL', async () => {
  const fs = await import('node:fs/promises')
  const privacy = await fs.readFile(path.join(root, 'app/privacy/page.tsx'), 'utf8')
  const terms = await fs.readFile(path.join(root, 'app/terms/page.tsx'), 'utf8')
  const source = await fs.readFile(path.join(root, 'app/source/page.tsx'), 'utf8')
  const connection = await fs.readFile(
    path.join(root, 'components/life-records/AiModelConnection.tsx'),
    'utf8',
  )
  assert.match(privacy, /浏览器的本地存储/)
  assert.match(privacy, /所选 AI 服务商/)
  assert.match(privacy, /第三方 AI 服务商/)
  assert.match(privacy, /不承诺永久免费或绝对零费用/)
  assert.match(terms, /测试版本/)
  assert.match(source, /AIOS_PUBLIC_BETA_SOURCE_URL/)
  assert.match(source, /不会生成或展示虚假链接/)
  assert.match(connection, /THIRD_PARTY_AI_NOTICE_VERSION/)
  assert.match(connection, /请先阅读并确认第三方 AI/)
})
