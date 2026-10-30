import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context)
    }
    if (specifier.startsWith('@/')) {
      const target = path.join(root, specifier.slice(2))
      return nextResolve(pathToFileURL(`${target}.ts`).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { NextRequest } = await import('next/server.js')
const { config, proxy } = await import(pathToFileURL(path.join(root, 'proxy.ts')).href)
const { issuePublicBetaSession } = await import(pathToFileURL(
  path.join(root, 'lib/public-beta-security.ts'),
).href)

const LAN_HOST = '192.168.3.23:3000'
const PUBLIC_HOST = 'ai-lifeos-test-123456.web.app'
const PUBLIC_BETA_HOST = 'beta.ai-lifeos.example'
const LAN_COOKIE = 'aios_lan_access=ABCD1234'
const PUBLIC_BETA_ENV = {
  AIOS_PUBLIC_BETA_HOSTS: PUBLIC_BETA_HOST,
  AIOS_PUBLIC_BETA_DEPLOYMENT_MODE: 'single-instance',
  AIOS_PUBLIC_BETA_INSTANCE_COUNT: '1',
  AIOS_PUBLIC_BETA_STATE_BACKEND: 'memory-single-instance',
  AIOS_PUBLIC_BETA_INSTANCE_ID: 'test-instance-01',
  AIOS_PUBLIC_BETA_RELEASE_ID: 'beta-test-abcdef1',
  AIOS_PUBLIC_BETA_SOURCE_URL: 'https://example.test/source/beta-test-abcdef1',
  AIOS_PUBLIC_BETA_INGRESS_SECRET: 'test-ingress-secret-00000000000000000001',
  AIOS_PUBLIC_BETA_SESSION_SECRET: 'test-session-secret-00000000000000000001',
  TENCENT_TOKENHUB_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
  FIREBASE_SERVICE_ACCOUNT: undefined,
  NEXT_PUBLIC_FIREBASE_API_KEY: undefined,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: undefined,
}

function request(url, options = {}) {
  return new NextRequest(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
    },
  })
}

function forwardedRequestHeaders(response) {
  return Object.fromEntries(
    [...response.headers.entries()]
      .filter(([name]) => name.startsWith('x-middleware-request-'))
      .map(([name, value]) => [name.slice('x-middleware-request-'.length), value]),
  )
}

async function withEnvironment(values, callback) {
  const previous = new Map()
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name])
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    return await callback()
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('the Next.js 16 matcher preserves the former middleware exclusions', () => {
  assert.deepEqual(config.matcher, [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)',
  ])
})

test('loopback traffic is passed through with every forged verification marker removed', async () => {
  const response = await proxy(request('http://127.0.0.1:3000/', {
    headers: {
      host: '127.0.0.1:3000',
      'x-aios-lan-verified': 'verified',
      'x-aios-public-test-verified': 'verified',
      'x-aios-public-beta-verified': 'verified',
    },
  }))
  const forwarded = forwardedRequestHeaders(response)

  assert.equal(response.status, 200)
  assert.equal(forwarded['x-aios-lan-verified'], undefined)
  assert.equal(forwarded['x-aios-public-test-verified'], undefined)
  assert.equal(forwarded['x-aios-public-beta-verified'], undefined)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('Public Beta issues its marker only for an exact HTTPS host and allowlisted route', async () => {
  const response = await withEnvironment(PUBLIC_BETA_ENV, () => {
    const session = issuePublicBetaSession()
    return proxy(request(`https://${PUBLIC_BETA_HOST}/api/life-records/chat`, {
      method: 'POST',
      headers: {
        host: PUBLIC_BETA_HOST,
        origin: `https://${PUBLIC_BETA_HOST}`,
        cookie: `aios_public_beta_session=${encodeURIComponent(session.value)}`,
        'x-aios-ingress-secret': process.env.AIOS_PUBLIC_BETA_INGRESS_SECRET,
        'x-aios-public-beta-verified': 'browser-forged',
        'x-aios-public-beta-session': 'browser-forged',
        'x-aios-lan-verified': 'verified',
      },
    }))
  })
  const forwarded = forwardedRequestHeaders(response)
  assert.equal(response.status, 200)
  assert.equal(forwarded['x-aios-public-beta-verified'], 'verified')
  assert.match(forwarded['x-aios-public-beta-session'], /^[0-9a-f-]{36}$/)
  assert.equal(forwarded['x-aios-lan-verified'], undefined)
  assert.equal(response.headers.get('x-aios-public-beta-mode'), 'enabled')
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains')
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('Public Beta rejects OAuth, image AI, cross-origin writes and unknown APIs', async () => {
  for (const [pathname, origin] of [
    ['/api/life-records/chatgpt-plan', `https://${PUBLIC_BETA_HOST}`],
    ['/api/life-records/image', `https://${PUBLIC_BETA_HOST}`],
    ['/api/future/unknown', `https://${PUBLIC_BETA_HOST}`],
    ['/api/life-records/chat', 'https://evil.example'],
  ]) {
    const response = await withEnvironment(PUBLIC_BETA_ENV, () => proxy(request(`https://${PUBLIC_BETA_HOST}${pathname}`, {
      method: 'POST',
      headers: {
        host: PUBLIC_BETA_HOST,
        origin,
        'x-aios-ingress-secret': process.env.AIOS_PUBLIC_BETA_INGRESS_SECRET,
      },
    })))
    assert.equal(response.status, 403, pathname)
  }
})

test('Public Beta page issues a secure signed anonymous session and strict CSP', async () => {
  const response = await withEnvironment(PUBLIC_BETA_ENV, () => proxy(request(
    `https://${PUBLIC_BETA_HOST}/privacy`,
    {
      headers: {
        host: PUBLIC_BETA_HOST,
        'x-aios-ingress-secret': process.env.AIOS_PUBLIC_BETA_INGRESS_SECRET,
      },
    },
  )))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie') ?? '', /aios_public_beta_session=/)
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/i)
  assert.match(response.headers.get('set-cookie') ?? '', /Secure/i)
  assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self' 'nonce-/)
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
})

test('Public Beta fails closed without trusted ingress and complete single-instance config', async () => {
  const missingIngress = await withEnvironment(PUBLIC_BETA_ENV, () => proxy(request(
    `https://${PUBLIC_BETA_HOST}/`,
    { headers: { host: PUBLIC_BETA_HOST } },
  )))
  assert.equal(missingIngress.status, 403)

  const multiInstance = await withEnvironment({
    ...PUBLIC_BETA_ENV,
    AIOS_PUBLIC_BETA_INSTANCE_COUNT: '2',
  }, () => proxy(request(
    `https://${PUBLIC_BETA_HOST}/`,
    {
      headers: {
        host: PUBLIC_BETA_HOST,
        'x-aios-ingress-secret': process.env.AIOS_PUBLIC_BETA_INGRESS_SECRET,
      },
    },
  )))
  assert.equal(multiInstance.status, 503)
})

test('an unverified LAN device receives the access-code page', async () => {
  const response = await proxy(request(`http://${LAN_HOST}/`, {
    headers: {
      host: LAN_HOST,
      'x-aios-lan-verified': 'verified',
      'x-aios-public-test-verified': 'verified',
    },
  }))
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /局域网访问验证/)
  assert.match(html, /name="key"/)
})

test('a verified LAN device gets only the proxy-issued LAN marker', async () => {
  const response = await withEnvironment({ AIOS_LAN_ACCESS_KEY: 'ABCD1234' }, () => (
    proxy(request(`http://${LAN_HOST}/model-test`, {
      headers: {
        host: LAN_HOST,
        cookie: LAN_COOKIE,
        'x-aios-lan-verified': 'browser-forged',
        'x-aios-public-test-verified': 'verified',
      },
    }))
  ))
  const forwarded = forwardedRequestHeaders(response)

  assert.equal(response.status, 200)
  assert.equal(forwarded['x-aios-lan-verified'], 'verified')
  assert.equal(forwarded['x-aios-public-test-verified'], undefined)
  assert.equal(response.headers.get('x-aios-lan-mode'), 'device-authorized')
})

test('the public test route gets only the proxy-issued public marker', async () => {
  const response = await withEnvironment({
    AIOS_PUBLIC_TEST_HOSTS: PUBLIC_HOST,
    AIOS_LAN_ACCESS_KEY: 'ABCD1234',
  }, () => (
    proxy(request(`https://${PUBLIC_HOST}/api/model-test/chat`, {
      method: 'POST',
      headers: {
        host: PUBLIC_HOST,
        origin: `https://${PUBLIC_HOST}`,
        cookie: LAN_COOKIE,
        'x-aios-lan-verified': 'verified',
        'x-aios-public-test-verified': 'browser-forged',
      },
    }))
  ))
  const forwarded = forwardedRequestHeaders(response)

  assert.equal(response.status, 200)
  assert.equal(forwarded['x-aios-public-test-verified'], 'verified')
  assert.equal(forwarded['x-aios-lan-verified'], undefined)
  assert.equal(response.headers.get('x-aios-public-test-mode'), 'enabled')
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('public mode rejects paths outside the isolated test surface', async () => {
  const response = await withEnvironment({ AIOS_PUBLIC_TEST_HOSTS: PUBLIC_HOST }, () => (
    proxy(request(`https://${PUBLIC_HOST}/api/life-records/chat`, {
      method: 'POST',
      headers: {
        host: PUBLIC_HOST,
        origin: `https://${PUBLIC_HOST}`,
        'x-aios-public-test-verified': 'verified',
      },
    }))
  ))

  assert.equal(response.status, 403)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('an unknown hostname is rejected by default', async () => {
  const response = await proxy(request('https://unknown.example/model-test', {
    headers: {
      host: 'unknown.example',
      'x-aios-lan-verified': 'verified',
      'x-aios-public-test-verified': 'verified',
    },
  }))

  assert.equal(response.status, 403)
})
