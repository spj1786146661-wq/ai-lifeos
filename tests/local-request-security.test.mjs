import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedLocalRequest } from '../lib/ai/local-request-security.ts'

const BASE = {
  protocol: 'http:',
  hostHeader: '127.0.0.1:3002',
  secFetchSite: 'same-origin',
  stateChanging: true,
}

test('same-origin loopback requests are accepted', () => {
  assert.equal(isTrustedLocalRequest({
    ...BASE,
    originHeader: 'http://127.0.0.1:3002',
  }), true)
})

test('remote hosts, cross-site requests and cross-origin requests are rejected', () => {
  assert.equal(isTrustedLocalRequest({
    ...BASE,
    hostHeader: '192.168.1.20:3002',
    originHeader: 'http://192.168.1.20:3002',
  }), false)
  assert.equal(isTrustedLocalRequest({
    ...BASE,
    originHeader: 'https://evil.example',
    secFetchSite: 'cross-site',
  }), false)
  assert.equal(isTrustedLocalRequest({
    ...BASE,
    originHeader: 'http://127.0.0.1:9999',
  }), false)
})

test('state-changing requests without same-origin evidence are rejected', () => {
  assert.equal(isTrustedLocalRequest({
    ...BASE,
    originHeader: null,
    secFetchSite: null,
  }), false)
})

test('read-only same-origin GET style requests do not require an Origin header', () => {
  assert.equal(isTrustedLocalRequest({
    ...BASE,
    originHeader: null,
    secFetchSite: null,
    stateChanging: false,
  }), true)
})
