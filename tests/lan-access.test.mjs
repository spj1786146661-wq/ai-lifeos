import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LAN_ACCESS_COOKIE,
  LAN_VERIFIED_HEADER,
  PUBLIC_BETA_TOKENHUB_TEST_PATH,
  PUBLIC_BETA_VERIFIED_HEADER,
  PUBLIC_TEST_API_PATH,
  PUBLIC_TEST_PAGE_PATH,
  PUBLIC_TEST_VERIFIED_HEADER,
  decideLanRoute,
  isLanAllowedApi,
  isLanHostname,
  isLoopbackHostname,
  isPersonalAlphaByokClientSurface,
  isPersonalAlphaByokHost,
  isPrivateIpv4,
  isPublicTestApi,
  isPublicBetaApi,
  isPublicBetaHostname,
  isPublicBetaRoute,
  isPublicTestHostname,
  isPublicTestRoute,
  isTrustedBrowserOrigin,
  isTrustedPublicBrowserOrigin,
  readCookie,
  requestHostname,
} from '../lib/lan-access.ts'

const LAN_HOST = '192.168.3.23:3000'
const PUBLIC_HOST = 'ai-lifeos-test-123456.web.app'

test('host parsing strips the port and handles bracketed IPv6', () => {
  assert.equal(requestHostname('192.168.3.23:3000'), '192.168.3.23')
  assert.equal(requestHostname('localhost:3000'), 'localhost')
  assert.equal(requestHostname('[::1]:3000'), '[::1]')
  assert.equal(requestHostname(null), '')
})

test('loopback detection accepts only loopback names', () => {
  assert.equal(isLoopbackHostname('127.0.0.1'), true)
  assert.equal(isLoopbackHostname('localhost'), true)
  assert.equal(isLoopbackHostname('::1'), true)
  assert.equal(isLoopbackHostname('192.168.3.23'), false)
})

test('Personal Alpha BYOK requires an explicit flag and the exact loopback Host', () => {
  assert.equal(
    isPersonalAlphaByokHost('localhost:3100', '1', 'localhost:3100'),
    true,
  )
  assert.equal(
    isPersonalAlphaByokHost('127.0.0.1:3100', '1', '127.0.0.1:3100'),
    true,
  )
  assert.equal(
    isPersonalAlphaByokHost('[::1]:3100', '1', '[::1]:3100'),
    true,
  )
  assert.equal(
    isPersonalAlphaByokHost('localhost:3100', undefined, 'localhost:3100'),
    false,
  )
  assert.equal(
    isPersonalAlphaByokHost('localhost:3100', '0', 'localhost:3100'),
    false,
  )
  assert.equal(
    isPersonalAlphaByokHost('localhost:3101', '1', 'localhost:3100'),
    false,
  )
  assert.equal(
    isPersonalAlphaByokHost('192.168.3.23:3100', '1', '192.168.3.23:3100'),
    false,
  )
  assert.equal(
    isPersonalAlphaByokHost('beta.example.com', '1', 'beta.example.com'),
    false,
  )
  assert.equal(
    isPersonalAlphaByokHost('localhost:3100', '1', '*:3100'),
    false,
  )
})

test('Personal Alpha BYOK UI is shown only for a server-marked loopback page', () => {
  assert.equal(isPersonalAlphaByokClientSurface('localhost', 'true'), true)
  assert.equal(isPersonalAlphaByokClientSurface('127.0.0.1', 'true'), true)
  assert.equal(isPersonalAlphaByokClientSurface('::1', 'true'), true)
  assert.equal(isPersonalAlphaByokClientSurface('localhost', 'false'), false)
  assert.equal(isPersonalAlphaByokClientSurface('localhost', undefined), false)
  assert.equal(isPersonalAlphaByokClientSurface('192.168.3.23', 'true'), false)
  assert.equal(isPersonalAlphaByokClientSurface('beta.example.com', 'true'), false)
})

test('private IPv4 ranges are accepted and public addresses are not', () => {
  for (const host of ['10.0.0.1', '192.168.3.23', '172.16.0.1', '172.31.255.254']) {
    assert.equal(isPrivateIpv4(host), true, host)
  }
  for (const host of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '100.64.0.1', 'example.com']) {
    assert.equal(isPrivateIpv4(host), false, host)
  }
})

test('LAN mode rejects loopback, public IPs and DNS names', () => {
  assert.equal(isLanHostname('192.168.3.23'), true)
  assert.equal(isLanHostname('127.0.0.1'), false)
  assert.equal(isLanHostname('203.0.113.5'), false)
  assert.equal(isLanHostname('my-laptop.local'), false)
})

test('cookie parsing finds the LAN cookie and ignores others', () => {
  assert.equal(
    readCookie(`theme=dark; ${LAN_ACCESS_COOKIE}=ABCD1234; other=x`, LAN_ACCESS_COOKIE),
    'ABCD1234',
  )
  assert.equal(readCookie('theme=dark', LAN_ACCESS_COOKIE), '')
  assert.equal(readCookie(null, LAN_ACCESS_COOKIE), '')
})

test('cookie parsing survives malformed percent encoding', () => {
  assert.equal(readCookie(`${LAN_ACCESS_COOKIE}=%E0%A4%A`, LAN_ACCESS_COOKIE), '')
})

test('no device cookie means no LAN route is reachable', () => {
  const denied = decideLanRoute({
    pathname: '/',
    method: 'GET',
    hostname: '192.168.3.23',
    hasValidDeviceCookie: false,
    hasTrustedBrowserOrigin: true,
  })
  assert.equal(denied, 'deny')
})

test('verified LAN devices can load the app shell and static assets', () => {
  for (const [pathname, method] of [
    ['/', 'GET'],
    ['/model-test', 'GET'],
    ['/_next/static/chunk.js', 'GET'],
    ['/manifest.json', 'GET'],
    ['/icons/icon.png', 'GET'],
  ]) {
    assert.equal(decideLanRoute({
      pathname,
      method,
      hostname: '192.168.3.23',
      hasValidDeviceCookie: true,
      hasTrustedBrowserOrigin: false,
    }), 'allow', pathname)
  }
})

test('verified LAN devices can only reach the allowlisted record and model-test endpoints', () => {
  const allow = (pathname, method, trustedOrigin = true) => decideLanRoute({
    pathname,
    method,
    hostname: '192.168.3.23',
    hasValidDeviceCookie: true,
    hasTrustedBrowserOrigin: trustedOrigin,
  })
  assert.equal(allow('/api/life-records/parse', 'GET'), 'allow')
  assert.equal(allow('/api/life-records/parse', 'POST'), 'allow')
  assert.equal(allow('/api/life-records/chat', 'POST'), 'allow')
  assert.equal(allow('/api/life-records/image', 'POST'), 'allow')
  assert.equal(allow('/api/model-test/chat', 'POST'), 'allow')
  // A write without a matching Origin is not a normal same-origin browser call.
  assert.equal(allow('/api/life-records/chat', 'POST', false), 'deny')
  assert.equal(allow('/api/life-records/image', 'POST', false), 'deny')
  assert.equal(allow('/api/model-test/chat', 'POST', false), 'deny')
})

test('OAuth management and every other API stay loopback-only', () => {
  const allow = (pathname, method = 'GET') => decideLanRoute({
    pathname,
    method,
    hostname: '192.168.3.23',
    hasValidDeviceCookie: true,
    hasTrustedBrowserOrigin: true,
  })
  for (const pathname of [
    '/api/life-records/chatgpt-plan',
    '/api/life-records/chatgpt-plan/authorize',
    '/api/telegram/cron',
    '/api/telegram/webhook',
    '/api/ai/chat',
    '/api/ai/daily-brief',
    '/api/health/import',
    '/api/health/apple-sync',
    '/dev/migration-test',
    '/model-test/private',
    '/api/model-test/other',
  ]) {
    assert.equal(allow(pathname), 'deny', pathname)
    assert.equal(allow(pathname, 'POST'), 'deny', pathname)
  }
})

test('unknown future APIs are denied by default', () => {
  assert.equal(decideLanRoute({
    pathname: '/api/future/secret',
    method: 'GET',
    hostname: '192.168.3.23',
    hasValidDeviceCookie: true,
    hasTrustedBrowserOrigin: true,
  }), 'deny')
})

test('a private IP alone never authorizes a record API', () => {
  for (const pathname of [
    '/api/life-records/parse',
    '/api/life-records/chat',
    '/api/life-records/image',
    '/api/model-test/chat',
  ]) {
    assert.equal(isLanAllowedApi('192.168.3.23', pathname, null), false, pathname)
    assert.equal(isLanAllowedApi('192.168.3.23', pathname, 'browser-forged'), false, pathname)
    assert.equal(isLanAllowedApi('192.168.3.23', pathname, 'verified'), true, pathname)
  }
})

test('record API authorization does not leak to OAuth or other endpoints', () => {
  assert.equal(isLanAllowedApi('192.168.3.23', '/api/life-records/chatgpt-plan', 'verified'), false)
  assert.equal(isLanAllowedApi('192.168.3.23', '/api/ai/chat', 'verified'), false)
  assert.equal(isLanAllowedApi('192.168.3.23', '/api/telegram/webhook', 'verified'), false)
  assert.equal(isLanAllowedApi('192.168.3.23', '/api/model-test/other', 'verified'), false)
  assert.equal(isLanAllowedApi('127.0.0.1', '/api/life-records/parse', 'verified'), false)
  assert.equal(LAN_VERIFIED_HEADER, 'x-aios-lan-verified')
})

test('trusted browser origin must match the exact LAN host', () => {
  assert.equal(isTrustedBrowserOrigin(`http://${LAN_HOST}`, LAN_HOST), true)
  assert.equal(isTrustedBrowserOrigin('http://192.168.3.24:3000', LAN_HOST), false)
  assert.equal(isTrustedBrowserOrigin('https://192.168.3.23:3000', LAN_HOST), false)
  assert.equal(isTrustedBrowserOrigin('http://127.0.0.1:3000', LAN_HOST), false)
  assert.equal(isTrustedBrowserOrigin(null, LAN_HOST), false)
  assert.equal(isTrustedBrowserOrigin('not a url', LAN_HOST), false)
})

test('public test mode accepts only exact configured hostnames', () => {
  assert.equal(isPublicTestHostname(PUBLIC_HOST, PUBLIC_HOST), true)
  assert.equal(
    isPublicTestHostname(PUBLIC_HOST, `example.com, ${PUBLIC_HOST.toUpperCase()}`),
    true,
  )
  assert.equal(isPublicTestHostname(PUBLIC_HOST, '*.web.app'), false)
  assert.equal(isPublicTestHostname(PUBLIC_HOST, 'ai-lifeos-test-123456.web.app.evil'), false)
  assert.equal(isPublicTestHostname(PUBLIC_HOST, ''), false)
  assert.equal(isPublicTestHostname('', PUBLIC_HOST), false)
})

test('public test mode exposes only its page and chat endpoint', () => {
  assert.equal(PUBLIC_TEST_PAGE_PATH, '/model-test')
  assert.equal(PUBLIC_TEST_API_PATH, '/api/model-test/chat')
  assert.equal(isPublicTestRoute('/model-test', 'GET'), true)
  assert.equal(isPublicTestRoute('/model-test', 'HEAD'), true)
  assert.equal(isPublicTestRoute('/model-test', 'POST'), false)
  assert.equal(isPublicTestRoute('/api/model-test/chat', 'POST'), true)
  assert.equal(isPublicTestRoute('/api/model-test/chat', 'GET'), false)
  for (const pathname of [
    '/',
    '/api/life-records/chat',
    '/api/life-records/chatgpt-plan',
    '/api/life-records/chatgpt-plan/authorize',
    '/api/telegram/webhook',
    '/dev/migration-test',
    '/model-test/private',
    '/api/model-test/other',
  ]) {
    assert.equal(isPublicTestRoute(pathname, 'GET'), false, pathname)
    assert.equal(isPublicTestRoute(pathname, 'POST'), false, pathname)
  }
})

test('public test API requires the proxy marker and exact host', () => {
  assert.equal(
    isPublicTestApi(PUBLIC_HOST, PUBLIC_TEST_API_PATH, 'verified', PUBLIC_HOST),
    true,
  )
  assert.equal(
    isPublicTestApi(PUBLIC_HOST, PUBLIC_TEST_API_PATH, null, PUBLIC_HOST),
    false,
  )
  assert.equal(
    isPublicTestApi(PUBLIC_HOST, PUBLIC_TEST_API_PATH, 'verified', 'other.example'),
    false,
  )
  assert.equal(
    isPublicTestApi(
      PUBLIC_HOST,
      '/api/life-records/chat',
      'verified',
      PUBLIC_HOST,
    ),
    false,
  )
  assert.equal(PUBLIC_TEST_VERIFIED_HEADER, 'x-aios-public-test-verified')
})

test('public test origin must be exact HTTPS', () => {
  assert.equal(isTrustedPublicBrowserOrigin(`https://${PUBLIC_HOST}`, PUBLIC_HOST), true)
  assert.equal(isTrustedPublicBrowserOrigin(`http://${PUBLIC_HOST}`, PUBLIC_HOST), false)
  assert.equal(
    isTrustedPublicBrowserOrigin('https://ai-lifeos-test-123456.web.app.evil', PUBLIC_HOST),
    false,
  )
  assert.equal(isTrustedPublicBrowserOrigin(null, PUBLIC_HOST), false)
  assert.equal(isTrustedPublicBrowserOrigin('not a url', PUBLIC_HOST), false)
})

test('Public Beta accepts only exact non-local hostnames', () => {
  assert.equal(isPublicBetaHostname(PUBLIC_HOST, PUBLIC_HOST), true)
  assert.equal(isPublicBetaHostname(PUBLIC_HOST, `example.com,${PUBLIC_HOST}`), true)
  assert.equal(isPublicBetaHostname(PUBLIC_HOST, '*.web.app'), false)
  assert.equal(isPublicBetaHostname('127.0.0.1', '127.0.0.1'), false)
  assert.equal(isPublicBetaHostname('192.168.1.5', '192.168.1.5'), false)
})

test('Public Beta exposes only the minimal BYOK product surface', () => {
  assert.equal(isPublicBetaRoute('/', 'GET'), true)
  assert.equal(isPublicBetaRoute('/api/life-records/parse', 'GET'), true)
  assert.equal(isPublicBetaRoute('/api/life-records/chat', 'POST'), true)
  assert.equal(isPublicBetaRoute('/api/life-records/follow-up', 'POST'), true)
  assert.equal(isPublicBetaRoute(PUBLIC_BETA_TOKENHUB_TEST_PATH, 'POST'), true)
  for (const pathname of [
    '/api/life-records/image',
    '/api/life-records/chatgpt-plan',
    '/api/model-test/chat',
    '/api/telegram/webhook',
    '/api/health/import',
  ]) {
    assert.equal(isPublicBetaRoute(pathname, 'GET'), false, pathname)
    assert.equal(isPublicBetaRoute(pathname, 'POST'), false, pathname)
  }
})

test('Public Beta API requires an unforgeable proxy marker and exact host', () => {
  assert.equal(
    isPublicBetaApi(PUBLIC_HOST, '/api/life-records/chat', 'verified', PUBLIC_HOST),
    true,
  )
  assert.equal(
    isPublicBetaApi(PUBLIC_HOST, '/api/life-records/chat', null, PUBLIC_HOST),
    false,
  )
  assert.equal(
    isPublicBetaApi(PUBLIC_HOST, '/api/life-records/image', 'verified', PUBLIC_HOST),
    false,
  )
  assert.equal(PUBLIC_BETA_VERIFIED_HEADER, 'x-aios-public-beta-verified')
})
