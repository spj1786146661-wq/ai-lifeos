import test from 'node:test'
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHATGPT_AUTHORIZE_URL,
  CHATGPT_ISSUER,
  CHATGPT_JWKS_URL,
  CHATGPT_PLAN_RESOURCE,
  CHATGPT_PLAN_SCOPE,
  CHATGPT_REVOKE_URL,
  CHATGPT_TOKEN_URL,
  DYNAMIC_CLIENT_ID,
  clearPlanCredentials,
  defaultCredentialsPath,
  getOrCreateExtAgentHostId,
  hasPlanCredentials,
  isAcceptedExtAgentHostId,
  newUuidV4,
  planAccountLabel,
  planUsageGranted,
  readPlanCredentials,
  writePlanCredentials,
} from '../lib/ai/chatgpt-plan-credentials.ts'
import {
  OAuthExchangeError,
  ensureExtAgentHostId,
  exchangeCode,
  parseCallback,
  parseOAuthErrorPayload,
  redactDiagnosticText,
  pkceChallenge,
  randomUrlSafe,
  refreshPlanCredentials,
  revokePlanCredentials,
  startAuthorization,
  validateIdToken,
} from '../lib/ai/chatgpt-plan-oauth.ts'

const UUID_V4_REGEX = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('the host id is a hyphenated UUIDv4 inside the urn:uuid namespace', () => {
  const value = newUuidV4()
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(value.length, 36)
  assert.equal(value.includes('+'), false)
  assert.equal(value.includes('/'), false)
  assert.equal(value.includes('='), false)
  const ids = new Set()
  for (let index = 0; index < 500; index += 1) {
    const generated = newUuidV4()
    assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    ids.add(generated)
  }
  assert.equal(ids.size, 500)
})

test('the previously stored base64url host id is rejected, not reused', () => {
  // This is the exact value shape that produced the OpenAI
  // invalid_authorize_request error on ext_agent_host_id.
  const stored = 'urn:uuid:pK-XDBDl8Um1OCe0YVXtPA'
  assert.equal(isAcceptedExtAgentHostId(stored), false)
  const resolved = ensureExtAgentHostId(stored)
  assert.notEqual(resolved, stored)
  assert.match(resolved, UUID_V4_REGEX)
})

test('a bare UUID string form gains the urn:uuid prefix without a new value', () => {
  const bare = '550e8400-e29b-41d4-a716-446655440000'
  const resolved = ensureExtAgentHostId(bare)
  assert.equal(resolved, `urn:uuid:${bare}`)
  assert.equal(isAcceptedExtAgentHostId(resolved), true)
})

test('stray whitespace or quotes around a host id are removed', () => {
  const quoted = '"urn:uuid:550e8400-e29b-41d4-a716-446655440000"'
  assert.equal(ensureExtAgentHostId(quoted), 'urn:uuid:550e8400-e29b-41d4-a716-446655440000')
})

test('the other official host id formats are accepted as-is', () => {
  const jwk = 'urn:ietf:params:oauth:jwk-thumbprint:sha256-NfNQmRUxMTlGLTlPWUJPXXE3Z0tITUJLVFVVSFZZMTg'
  assert.equal(isAcceptedExtAgentHostId(jwk), true)
  assert.equal(ensureExtAgentHostId(jwk), jwk)
  const did = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiE2S8uxvGzTB6jM2fjUg'
  assert.equal(isAcceptedExtAgentHostId(did), true)
  assert.equal(ensureExtAgentHostId(did), did)
})

test('a non-UUID or empty host id is replaced rather than sent', () => {
  for (const bad of ['urn:uuid:not-a-uuid', 'urn:uuid:', 'some-machine-name', 'urn:uuid:550e8400-e29b-11d4-a716-446655440000']) {
    const resolved = ensureExtAgentHostId(bad)
    assert.match(resolved, UUID_V4_REGEX, `expected a valid UUIDv4 for ${bad}`)
  }
})

test('the persisted host id stays stable across repeated calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-hostid-'))
  const path = join(dir, 'installation.json')
  try {
    const first = getOrCreateExtAgentHostId(undefined, path)
    assert.match(first, UUID_V4_REGEX)
    assert.equal(getOrCreateExtAgentHostId(undefined, path), first)
    assert.equal(getOrCreateExtAgentHostId(undefined, path), first)
    // A previously stored non-conforming value is normalized to a valid UUIDv4.
    writeFileSync(path, JSON.stringify({ v: 1, hostId: 'urn:uuid:pK-XDBDl8Um1OCe0YVXtPA' }))
    const replaced = getOrCreateExtAgentHostId(undefined, path)
    assert.match(replaced, UUID_V4_REGEX)
    assert.notEqual(replaced, 'urn:uuid:pK-XDBDl8Um1OCe0YVXtPA')
    assert.equal(getOrCreateExtAgentHostId(undefined, path), replaced)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the installation state file records why a value was replaced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-hostid-'))
  const path = join(dir, 'installation.json')
  try {
    writeFileSync(path, JSON.stringify({ v: 1, hostId: 'urn:uuid:pK-XDBDl8Um1OCe0YVXtPA' }))
    getOrCreateExtAgentHostId(undefined, path)
    const state = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(state.v, 2)
    assert.equal(state.previousReason, 'invalid_format')
    assert.match(state.hostId, UUID_V4_REGEX)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a valid host id is never rewritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-hostid-'))
  const path = join(dir, 'installation.json')
  const good = 'urn:uuid:550e8400-e29b-41d4-a716-446655440000'
  try {
    writeFileSync(path, JSON.stringify({ v: 2, hostId: good }))
    const before = readFileSync(path, 'utf8')
    assert.equal(getOrCreateExtAgentHostId(undefined, path), good)
    assert.equal(readFileSync(path, 'utf8'), before)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an explicit valid override wins over the stored value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-hostid-'))
  const path = join(dir, 'installation.json')
  const override = 'urn:uuid:6ba7b810-9dad-41d1-80b4-00c04fd430c8'
  try {
    writeFileSync(path, JSON.stringify({ v: 2, hostId: 'urn:uuid:550e8400-e29b-41d4-a716-446655440000' }))
    assert.equal(getOrCreateExtAgentHostId(override, path), override)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the authorize URL carries a conforming ext_agent_host_id', () => {
  const hostId = 'urn:uuid:550e8400-e29b-41d4-a716-446655440000'
  const { authorizeUrl } = startAuthorization({
    extAgentHostId: hostId,
    redirectUri: 'http://127.0.0.1:1455/auth/callback',
    agentNameHint: 'AI-LifeOS',
  })
  const url = new URL(authorizeUrl)
  const sent = url.searchParams.get('ext_agent_host_id')
  assert.equal(sent, hostId)
  assert.match(sent, UUID_V4_REGEX)
  // Exactly one encoded value, no quotes and no double encoding.
  assert.equal(decodeURIComponent(sent), sent)
  assert.equal(sent.includes('"'), false)
  assert.equal(sent.includes(' '), false)
})

test('a non-conforming host id cannot reach the authorize URL', () => {
  assert.throws(
    () => startAuthorization({ extAgentHostId: 'urn:uuid:pK-XDBDl8Um1OCe0YVXtPA', redirectUri: 'http://127.0.0.1:1455/auth/callback' }),
    /ext_agent_host_id 格式/,
  )
  assert.throws(
    () => startAuthorization({ extAgentHostId: '  ', redirectUri: 'http://127.0.0.1:1455/auth/callback' }),
    /ext_agent_host_id 格式/,
  )
})

test('the host id is identical across repeated authorization attempts', () => {
  const hostId = ensureExtAgentHostId(null)
  const first = new URL(startAuthorization({ extAgentHostId: hostId, redirectUri: 'http://127.0.0.1:1455/auth/callback' }).authorizeUrl).searchParams.get('ext_agent_host_id')
  const second = new URL(startAuthorization({ extAgentHostId: hostId, redirectUri: 'http://127.0.0.1:1455/auth/callback' }).authorizeUrl).searchParams.get('ext_agent_host_id')
  assert.equal(first, hostId)
  assert.equal(second, hostId)
  assert.equal(first, second)
})

test('state and nonce stay unique per attempt while the host id stays fixed', () => {
  const hostId = 'urn:uuid:550e8400-e29b-41d4-a716-446655440000'
  const first = startAuthorization({ extAgentHostId: hostId, redirectUri: 'http://127.0.0.1:1455/auth/callback' })
  const second = startAuthorization({ extAgentHostId: hostId, redirectUri: 'http://127.0.0.1:1455/auth/callback' })
  assert.notEqual(first.pending.state, second.pending.state)
  assert.notEqual(first.pending.nonce, second.pending.nonce)
  assert.notEqual(first.pending.codeVerifier, second.pending.codeVerifier)
  assert.equal(first.pending.extAgentHostId, second.pending.extAgentHostId)
})

const CREDENTIAL = {
  email: 'user@example.com',
  issuer: 'https://auth.openai.com',
  subject: 'user-subject',
  clientId: 'oaiapp_test_client',
  extAgentHostId: 'urn:uuid:11111111-2222-4333-8444-555555555555',
  idToken: 'header.payload.signature',
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  tokenType: 'Bearer',
  expiresAt: Date.now() + 3600_000,
  scopes: ['openid', 'chatgpt.tokens.use.direct'],
  savedAt: new Date().toISOString(),
}

function tempPath() {
  return join(mkdtempSync(join(tmpdir(), 'ai-lifeos-plan-')), 'credentials.json')
}

test('the documented constants match the official endpoints', () => {
  assert.equal(CHATGPT_AUTHORIZE_URL, 'https://auth.openai.com/api/accounts/authorize')
  assert.equal(CHATGPT_TOKEN_URL, 'https://auth.openai.com/api/accounts/oauth/token')
  assert.equal(CHATGPT_REVOKE_URL, 'https://auth.openai.com/api/accounts/oauth/revoke')
  assert.equal(CHATGPT_JWKS_URL, 'https://auth.openai.com/.well-known/jwks.json')
  assert.equal(CHATGPT_ISSUER, 'https://auth.openai.com')
  assert.equal(CHATGPT_PLAN_RESOURCE, 'https://api.openai.com/v1')
  assert.equal(CHATGPT_PLAN_SCOPE, 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct')
  assert.equal(DYNAMIC_CLIENT_ID, 'dynamic_agent_client')
})

test('credentials are stored outside the repository and never in plain text', () => {
  const path = tempPath()
  try {
    assert.equal(hasPlanCredentials(path), false)
    writePlanCredentials(CREDENTIAL, path)
    assert.equal(hasPlanCredentials(path), true)
    // No credential value may appear anywhere on disk in this directory.
    const dir = join(path, '..')
    for (const name of readdirSync(dir)) {
      const raw = readFileSync(join(dir, name), 'utf8')
      assert.equal(raw.includes('access-token-value'), false)
      assert.equal(raw.includes('refresh-token-value'), false)
      assert.equal(raw.includes('user@example.com'), false)
    }
    const raw = readFileSync(path, 'utf8')
    const envelope = JSON.parse(raw)
    // The token values must not be recoverable from the file contents.
    assert.equal(raw.includes('access-token-value'), false)
    assert.equal(raw.includes('refresh-token-value'), false)
    assert.equal(raw.includes('user@example.com'), false)
    assert.equal(envelope.v, 2)
    assert.equal(envelope.scheme, 'dpapi-current-user')
    assert.equal(typeof envelope.data, 'string')
    assert.ok(envelope.data.length > 100)
    const restored = readPlanCredentials(path)
    assert.equal(restored.accessToken, CREDENTIAL.accessToken)
    assert.equal(restored.refreshToken, CREDENTIAL.refreshToken)
    assert.equal(restored.clientId, CREDENTIAL.clientId)
    assert.equal(restored.email, CREDENTIAL.email)
  } finally { rmSync(join(path, '..'), { recursive: true, force: true }) }
})

test('a truncated or foreign credential file is not treated as a valid login', () => {
  const path = tempPath()
  try {
    // A structurally complete envelope is "present", so the UI can say a file
    // exists; but it must never decrypt into a usable credential.
    writeFileSync(path, '{"salt":"x","iv":"y","tag":"z","data":"broken"}')
    assert.equal(hasPlanCredentials(path), true)
    assert.equal(readPlanCredentials(path), null)
    // A file that is not even an envelope is absent.
    writeFileSync(path, 'not json at all')
    assert.equal(hasPlanCredentials(path), false)
    assert.equal(readPlanCredentials(path), null)
    // A structurally incomplete envelope is absent too.
    writeFileSync(path, '{"salt":"x"}')
    assert.equal(hasPlanCredentials(path), false)
  } finally { rmSync(join(path, '..'), { recursive: true, force: true }) }
})

test('clearing credentials removes the usable credential and all token material', () => {
  const path = tempPath()
  try {
    writePlanCredentials(CREDENTIAL, path)
    assert.equal(hasPlanCredentials(path), true)
    clearPlanCredentials(path)
    assert.equal(hasPlanCredentials(path), false)
    assert.equal(readPlanCredentials(path), null)
    assert.equal(existsSync(path), false)
    assert.equal(existsSync(`${path}.revoked`), false)
  } finally { rmSync(join(path, '..'), { recursive: true, force: true }) }
})

test('credential write failures are explicit and never fall back to plaintext', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-plan-'))
  const blocker = join(dir, 'not-a-directory')
  writeFileSync(blocker, 'blocked')
  try {
    assert.throws(
      () => writePlanCredentials(CREDENTIAL, join(blocker, 'credentials.json')),
      /无法安全写入/,
    )
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the default credentials path lives in the user profile, not in the project', () => {
  const path = defaultCredentialsPath()
  assert.equal(path.includes('life-tracker'), false)
  assert.equal(path.includes('node_modules'), false)
})

test('plan usage is only reported when the direct scope was granted', () => {
  assert.equal(planUsageGranted(CREDENTIAL), true)
  assert.equal(planUsageGranted({ ...CREDENTIAL, scopes: ['openid', 'email'] }), false)
  assert.equal(planAccountLabel(CREDENTIAL), 'user@example.com')
  assert.match(planAccountLabel({ ...CREDENTIAL, email: null }), /ChatGPT 账号/)
})

test('PKCE challenge is the unpadded base64url SHA-256 of the verifier', () => {
  const verifier = randomUrlSafe(48)
  const challenge = pkceChallenge(verifier)
  assert.equal(challenge.includes('='), false)
  assert.equal(challenge.includes('+'), false)
  assert.equal(challenge.includes('/'), false)
  assert.equal(pkceChallenge(verifier), challenge)
  assert.notEqual(pkceChallenge(randomUrlSafe(48)), challenge)
})

test('the host id is stable once issued and unique per host', () => {
  const first = ensureExtAgentHostId(null)
  assert.match(first, UUID_V4_REGEX)
  assert.equal(ensureExtAgentHostId(first), first)
  assert.notEqual(ensureExtAgentHostId(null), first)
})

test('the installation host id persists outside the repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lifeos-host-'))
  const path = join(dir, 'installation.json')
  try {
    const first = getOrCreateExtAgentHostId(undefined, path)
    const again = getOrCreateExtAgentHostId(undefined, path)
    assert.equal(first, again)
    assert.match(first, UUID_V4_REGEX)
    assert.equal(readFileSync(path, 'utf8').includes('life-tracker'), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the first authorization registers dynamically and carries the required parameters', () => {
  const { authorizeUrl, pending } = startAuthorization({
    extAgentHostId: 'urn:uuid:11111111-2222-4333-8444-555555555555',
    redirectUri: 'http://127.0.0.1:1455/auth/callback',
    agentNameHint: 'AI人生数据库',
  })
  const url = new URL(authorizeUrl)
  assert.equal(url.origin + url.pathname, CHATGPT_AUTHORIZE_URL)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('client_id'), DYNAMIC_CLIENT_ID)
  assert.equal(url.searchParams.get('agent_name_hint'), 'AI人生数据库')
  assert.equal(url.searchParams.get('ext_agent_host_id'), 'urn:uuid:11111111-2222-4333-8444-555555555555')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:1455/auth/callback')
  assert.equal(url.searchParams.get('scope'), CHATGPT_PLAN_SCOPE)
  assert.equal(url.searchParams.get('resource'), CHATGPT_PLAN_RESOURCE)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), pkceChallenge(pending.codeVerifier))
  assert.ok(url.searchParams.get('state'))
  assert.ok(url.searchParams.get('nonce'))
  // agent_name_hint is omitted on reauthorization with an issued client id.
  const again = startAuthorization({ extAgentHostId: 'urn:uuid:11111111-2222-4333-8444-555555555555', redirectUri: 'http://127.0.0.1:1455/auth/callback', clientId: 'oaiapp_abc' })
  const againUrl = new URL(again.authorizeUrl)
  assert.equal(againUrl.searchParams.get('client_id'), 'oaiapp_abc')
  assert.equal(againUrl.searchParams.get('agent_name_hint'), null)
})

test('a callback with a mismatched state is refused before any token request', () => {
  const { pending } = startAuthorization({ extAgentHostId: 'urn:uuid:66666666-7777-4888-8999-aaaaaaaaaaaa', redirectUri: 'http://127.0.0.1:1455/auth/callback' })
  assert.throws(() => parseCallback('http://127.0.0.1:1455/auth/callback?code=abc&state=wrong', pending), /state/)
})

test('authorization only accepts the exact loopback callback shape', () => {
  assert.throws(
    () => startAuthorization({ extAgentHostId: 'urn:uuid:66666666-7777-4888-8999-aaaaaaaaaaaa', redirectUri: 'http://localhost:1455/auth/callback' }),
    /127\.0\.0\.1/,
  )
  assert.throws(
    () => startAuthorization({ extAgentHostId: 'urn:uuid:66666666-7777-4888-8999-aaaaaaaaaaaa', redirectUri: 'http://127.0.0.1:1455/callback' }),
    /auth\/callback/,
  )
  const { pending } = startAuthorization({ extAgentHostId: 'urn:uuid:66666666-7777-4888-8999-aaaaaaaaaaaa', redirectUri: 'http://127.0.0.1:1455/auth/callback' })
  assert.throws(
    () => parseCallback(`http://127.0.0.1:1455/other?code=c&state=${pending.state}`, pending),
    /回调地址/,
  )
})

test('an access_denied callback is reported as a refusal, not a success', () => {
  const { pending } = startAuthorization({ extAgentHostId: 'urn:uuid:66666666-7777-4888-8999-aaaaaaaaaaaa', redirectUri: 'http://127.0.0.1:1455/auth/callback' })
  assert.throws(() => parseCallback('http://127.0.0.1:1455/auth/callback?error=access_denied&state=' + pending.state, pending), /授权被拒绝/)
})

test('a valid callback keeps the issued client id and the granted scopes', () => {
  const { pending } = startAuthorization({ extAgentHostId: 'urn:uuid:66666666-7777-4888-8999-aaaaaaaaaaaa', redirectUri: 'http://127.0.0.1:1455/auth/callback' })
  const result = parseCallback(
    `http://127.0.0.1:1455/auth/callback?code=AUTH_CODE&state=${pending.state}&client_id=oaiapp_abc&scope=chatgpt.tokens.use.direct+openid`,
    pending,
  )
  assert.equal(result.code, 'AUTH_CODE')
  assert.equal(result.clientId, 'oaiapp_abc')
  assert.equal(result.scope, 'chatgpt.tokens.use.direct openid')
})

test('a callback that supplies a different client id is rejected', () => {
  const { pending } = startAuthorization({ extAgentHostId: 'urn:uuid:66666666-7777-4888-8999-aaaaaaaaaaaa', redirectUri: 'http://127.0.0.1:1455/auth/callback', clientId: 'oaiapp_known' })
  assert.throws(
    () => parseCallback(`http://127.0.0.1:1455/auth/callback?code=c&state=${pending.state}&client_id=oaiapp_other`, pending),
    /client_id/,
  )
})

test('an expired authorization attempt cannot be replayed', () => {
  const { pending } = startAuthorization({ extAgentHostId: 'urn:uuid:66666666-7777-4888-8999-aaaaaaaaaaaa', redirectUri: 'http://127.0.0.1:1455/auth/callback' })
  const stale = { ...pending, createdAt: Date.now() - 11 * 60 * 1000 }
  assert.throws(() => parseCallback(`http://127.0.0.1:1455/auth/callback?code=c&state=${pending.state}`, stale), /超时/)
})

test('the ID token must be signed by OpenAI, unexpired, and aimed at this client', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  const now = Math.floor(Date.now() / 1000)
  const sign = (claims, header = { alg: 'RS256', kid: 'key-1' }) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const body = `${encode(header)}.${encode(claims)}`
    const signature = createSign('RSA-SHA256').update(body).end().sign(privateKey).toString('base64url')
    return `${body}.${signature}`
  }
  const good = sign({ iss: 'https://auth.openai.com', sub: 'user-1', aud: 'oaiapp_abc', exp: now + 600, nonce: 'n-1' })

  // Patch the JWKS fetch for this test only.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('jwks')) {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1', alg: 'RS256', use: 'sig' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return originalFetch(input)
  }
  try {
    const claims = await validateIdToken(good, { expectedClientId: 'oaiapp_abc', expectedNonce: 'n-1' })
    assert.equal(claims.sub, 'user-1')

    await assert.rejects(() => validateIdToken(good, { expectedClientId: 'oaiapp_other', expectedNonce: 'n-1' }), /audience/)
    await assert.rejects(() => validateIdToken(good, { expectedClientId: 'oaiapp_abc', expectedNonce: 'n-2' }), /nonce/)
    const expired = sign({ iss: 'https://auth.openai.com', sub: 'u', aud: 'oaiapp_abc', exp: now - 10, nonce: 'n-1' })
    await assert.rejects(() => validateIdToken(expired, { expectedClientId: 'oaiapp_abc', expectedNonce: 'n-1' }), /过期/)
    const wrongIssuer = sign({ iss: 'https://evil.example', sub: 'u', aud: 'oaiapp_abc', exp: now + 600, nonce: 'n-1' })
    await assert.rejects(() => validateIdToken(wrongIssuer, { expectedClientId: 'oaiapp_abc', expectedNonce: 'n-1', expectedIssuer: 'https://auth.openai.com' }), /签发者/)
    const badSignature = `${good.split('.')[0]}.${good.split('.')[1]}.AAAA`
    await assert.rejects(() => validateIdToken(badSignature, { expectedClientId: 'oaiapp_abc', expectedNonce: 'n-1' }), /签名/)
    await assert.rejects(() => validateIdToken('not-a-jwt', { expectedClientId: 'oaiapp_abc', expectedNonce: 'n-1' }), /格式/)
  } finally { globalThis.fetch = originalFetch }
})

test('concurrent refreshes for one credential are serialized', async () => {
  const path = tempPath()
  const stale = { ...CREDENTIAL, expiresAt: Date.now() - 1000 }
  writePlanCredentials(stale, path)
  let calls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (!String(input).includes('/oauth/token')) throw new Error('unexpected request')
    calls += 1
    await new Promise(resolve => setTimeout(resolve, 30))
    return new Response(JSON.stringify({
      access_token: 'rotated-access',
      refresh_token: 'rotated-refresh',
      id_token: 'rotated-id',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid chatgpt.tokens.use.direct',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const [first, second] = await Promise.all([
      refreshPlanCredentials({ credentials: stale, credentialsPath: path }),
      refreshPlanCredentials({ credentials: stale, credentialsPath: path }),
    ])
    assert.equal(calls, 1)
    assert.equal(first.accessToken, 'rotated-access')
    assert.equal(second.refreshToken, 'rotated-refresh')
    assert.equal(readPlanCredentials(path).refreshToken, 'rotated-refresh')
  } finally {
    globalThis.fetch = originalFetch
    rmSync(join(path, '..'), { recursive: true, force: true })
  }
})

test('disconnect revokes the refresh token and then removes local credentials', async () => {
  const path = tempPath()
  writePlanCredentials(CREDENTIAL, path)
  let seenUrl = ''
  let seenBody = null
  const result = await revokePlanCredentials(path, async (input, init) => {
    seenUrl = String(input)
    seenBody = Object.fromEntries(new URLSearchParams(init.body))
    return new Response('', { status: 200 })
  })
  try {
    assert.equal(seenUrl, CHATGPT_REVOKE_URL)
    assert.deepEqual(seenBody, {
      token: CREDENTIAL.refreshToken,
      token_type_hint: 'refresh_token',
      client_id: CREDENTIAL.clientId,
    })
    assert.equal(result.remoteRevoked, true)
    assert.equal(existsSync(path), false)
  } finally { rmSync(join(path, '..'), { recursive: true, force: true }) }
})

test('remote revoke failure still deletes local tokens and reports uncertainty', async () => {
  const path = tempPath()
  writePlanCredentials(CREDENTIAL, path)
  try {
    const result = await revokePlanCredentials(path, async () => new Response('', { status: 503 }))
    assert.equal(result.localCleared, true)
    assert.equal(result.remoteRevoked, false)
    assert.match(result.reason ?? '', /503/)
    assert.equal(existsSync(path), false)
  } finally { rmSync(join(path, '..'), { recursive: true, force: true }) }
})


const EXCHANGE_HOST_ID = 'urn:uuid:77777777-8888-4999-8aaa-bbbbbbbbbbbb'

function startExchange() {
  return startAuthorization({
    extAgentHostId: EXCHANGE_HOST_ID,
    redirectUri: 'http://127.0.0.1:1455/auth/callback',
    agentNameHint: 'AI人生数据库',
  }).pending
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

test('the code exchange sends the client id OpenAI issued on the callback', async () => {
  const pending = startExchange()
  const captured = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    captured.push({ url: String(input), body: Object.fromEntries(new URLSearchParams(init.body)), init })
    return jsonResponse({ access_token: 'at', refresh_token: 'rt', id_token: 'a.b.c', token_type: 'Bearer', expires_in: 3600 })
  }
  try {
    const tokens = await exchangeCode('AUTH_CODE_1', pending, 'oaiapp_abc123')
    assert.equal(tokens.access_token, 'at')
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, 'https://auth.openai.com/api/accounts/oauth/token')
    assert.equal(captured[0].body.client_id, 'oaiapp_abc123')
    assert.notEqual(captured[0].body.client_id, DYNAMIC_CLIENT_ID)
    assert.equal(captured[0].body.grant_type, 'authorization_code')
    assert.equal(captured[0].body.code, 'AUTH_CODE_1')
    assert.equal(captured[0].body.code_verifier, pending.codeVerifier)
    assert.notEqual(captured[0].body.code_verifier, pending.nonce)
    assert.equal(captured[0].body.redirect_uri, pending.redirectUri)
    assert.equal(captured[0].body.resource, CHATGPT_PLAN_RESOURCE)
    assert.equal(captured[0].init.method, 'POST')
    assert.equal(captured[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded')
    assert.equal(Object.values(captured[0].body).includes(DYNAMIC_CLIENT_ID), false)
  } finally { globalThis.fetch = originalFetch }
})

test('a first exchange without the issued client id fails before any network call', async () => {
  const pending = startExchange()
  let calls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { calls += 1; return jsonResponse({}) }
  try {
    await assert.rejects(
      () => exchangeCode('AUTH_CODE_2', pending, null),
      /没有在回调中获得 OpenAI 签发的 client_id/,
    )
    await assert.rejects(
      () => exchangeCode('AUTH_CODE_2b', pending, DYNAMIC_CLIENT_ID),
      /没有在回调中获得 OpenAI 签发的 client_id/,
    )
    assert.equal(calls, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('a region-blocked 403 reports the official code and request id without secrets', async () => {
  const pending = startExchange()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse(
    {
      error: {
        code: 'unsupported_country_region_territory',
        message: 'Country, region, or territory not supported',
        param: null,
        type: 'request_forbidden',
      },
    },
    403,
    { 'x-request-id': 'req_safe_123' },
  )
  let caught
  try {
    await exchangeCode('SECRET_AUTH_CODE', pending, 'oaiapp_secretclient')
  } catch (error) {
    caught = error
  } finally { globalThis.fetch = originalFetch }

  assert.ok(caught instanceof OAuthExchangeError)
  assert.equal(caught.diagnostics.stage, 'authorization_code_exchange')
  assert.equal(caught.diagnostics.status, 403)
  assert.equal(caught.diagnostics.errorCode, 'unsupported_country_region_territory')
  assert.equal(caught.diagnostics.errorType, 'request_forbidden')
  assert.equal(caught.diagnostics.requestId, 'req_safe_123')
  assert.equal(caught.diagnostics.regionBlocked, true)
  assert.equal(caught.diagnostics.clientIdKind, 'issued')
  assert.equal(caught.diagnostics.clientIdFormatOk, true)
  assert.equal(caught.diagnostics.pkcePresent, true)
  assert.equal(caught.diagnostics.redirectScheme, 'http')
  assert.equal(caught.diagnostics.redirectLoopback, true)
  assert.equal(caught.diagnostics.redirectHasPort, true)
  assert.equal(caught.diagnostics.redirectPathOk, true)
  assert.equal(caught.diagnostics.resourceOk, true)
  assert.match(caught.message, /unsupported_country_region_territory/)
  assert.match(caught.message, /req_safe_123/)
  assert.match(caught.message, /地区|区域/)
  const serialized = JSON.stringify(caught.diagnostics) + caught.message
  assert.equal(serialized.includes('SECRET_AUTH_CODE'), false)
  assert.equal(serialized.includes(pending.codeVerifier), false)
  assert.equal(serialized.includes('oaiapp_secretclient'), false)
})

test('a non-JSON 403 still yields a usable, secret-free message', async () => {
  const pending = startExchange()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('<html>Forbidden</html>', { status: 403, headers: { 'Content-Type': 'text/html' } })
  let caught
  try {
    await exchangeCode('SECRET_AUTH_CODE_2', pending, 'oaiapp_x')
  } catch (error) {
    caught = error
  } finally { globalThis.fetch = originalFetch }

  assert.ok(caught instanceof OAuthExchangeError)
  assert.equal(caught.diagnostics.status, 403)
  assert.equal(caught.diagnostics.errorCode, undefined)
  assert.equal(caught.diagnostics.regionBlocked, false)
  assert.match(caught.message, /403/)
  assert.equal(caught.message.includes('SECRET_AUTH_CODE_2'), false)
  assert.equal(caught.message.includes(pending.codeVerifier), false)
})

test('an error body that echoes the code, verifier or a JWT is redacted', async () => {
  const pending = startExchange()
  const jwt = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccc'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({
    error: {
      code: 'invalid_grant',
      message: 'rejected code=SECRET_CODE_3 verifier=' + pending.codeVerifier + ' token=' + jwt,
      type: 'invalid_request_error',
    },
  }, 400, { 'x-request-id': 'req_redact' })
  let caught
  try {
    await exchangeCode('SECRET_CODE_3', pending, 'oaiapp_redact')
  } catch (error) {
    caught = error
  } finally { globalThis.fetch = originalFetch }

  assert.ok(caught instanceof OAuthExchangeError)
  assert.equal(caught.diagnostics.errorCode, 'invalid_grant')
  const shown = caught.message
  assert.equal(shown.includes('SECRET_CODE_3'), false)
  assert.equal(shown.includes(pending.codeVerifier), false)
  assert.equal(shown.includes(jwt), false)
  assert.match(shown, /invalid_grant/)
})

test('the OAuth error payload parser handles nested, flat and invalid bodies', () => {
  assert.deepEqual(
    parseOAuthErrorPayload(JSON.stringify({ error: { code: 'c1', type: 't1', message: 'm1', param: 'p1' } })),
    { code: 'c1', type: 't1', message: 'm1', param: 'p1' },
  )
  assert.deepEqual(
    parseOAuthErrorPayload(JSON.stringify({ error: 'invalid_grant', error_description: 'bad code' })),
    { code: 'invalid_grant', type: undefined, message: 'bad code', param: undefined },
  )
  assert.deepEqual(parseOAuthErrorPayload('<html>nope</html>'), {})
  assert.equal(redactDiagnosticText('token=abcdefghijkl', []).includes('abcdefghijkl'), false)
})

test('after a failed exchange the user can start a brand new attempt', async () => {
  const first = startExchange()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({ error: { code: 'invalid_grant', message: 'code expired' } }, 400)
  try {
    await assert.rejects(() => exchangeCode('CODE_A', first, 'oaiapp_a'), /invalid_grant/)
  } finally { globalThis.fetch = originalFetch }

  const second = startExchange()
  assert.notEqual(second.state, first.state)
  assert.notEqual(second.nonce, first.nonce)
  assert.notEqual(second.codeVerifier, first.codeVerifier)
  assert.equal(second.extAgentHostId, first.extAgentHostId)
})