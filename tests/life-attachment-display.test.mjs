import test from 'node:test'
import assert from 'node:assert/strict'
import { attachmentDisplayName, truncateDisplayName } from '../lib/life-attachment-display.ts'

test('empty image names get a friendly numbered label', () => {
  assert.equal(attachmentDisplayName('', 0), '图片 1')
  assert.equal(attachmentDisplayName(undefined, 1), '图片 2')
})

test('long filenames are truncated without leaking an internal id', () => {
  const label = truncateDisplayName('a-very-long-photo-name-that-keeps-going.png', 20)
  assert.equal(label.length <= 20, true)
  assert.match(label, /…$/)
  assert.doesNotMatch(label, /sha256|attachment/i)
})
