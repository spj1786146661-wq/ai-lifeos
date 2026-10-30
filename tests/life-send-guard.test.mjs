import test from 'node:test'
import assert from 'node:assert/strict'
import { LifeSendGuard, lifeSendDraftKey } from '../lib/life-send-guard.ts'

function ids(prefix) {
  let value = 0
  return () => `${prefix}-${++value}`
}

const draft = {
  text: '昨晚睡了7小时',
  date: '2026-10-26',
  image: null,
}

test('one unchanged draft keeps one stable action ID', () => {
  const guard = new LifeSendGuard(ids('action'))
  const first = guard.begin(draft)
  assert.equal(first.status, 'accepted')
  guard.finish(first.draftKey, false)
  const retry = guard.begin(draft)
  assert.equal(retry.status, 'accepted')
  assert.equal(retry.actionId, first.actionId)
})

test('an in-flight draft cannot be submitted by a stale button or Enter event', () => {
  const guard = new LifeSendGuard(ids('action'))
  assert.equal(guard.begin(draft).status, 'accepted')
  assert.equal(guard.begin(draft).status, 'busy')
})

test('a completed unchanged draft cannot be accidentally submitted again', () => {
  const guard = new LifeSendGuard(ids('action'))
  const first = guard.begin(draft)
  assert.equal(first.status, 'accepted')
  guard.finish(first.draftKey, true)
  assert.equal(guard.begin(draft).status, 'already-submitted')
})

test('editing a draft creates a new action ID for an intentional new send', () => {
  const guard = new LifeSendGuard(ids('action'))
  const first = guard.begin(draft)
  assert.equal(first.status, 'accepted')
  guard.finish(first.draftKey, true)
  guard.markDraftEdited()
  const next = guard.begin(draft)
  assert.equal(next.status, 'accepted')
  assert.notEqual(next.actionId, first.actionId)
})

test('a changed date or image rotates the action ID even without a UI edit callback', () => {
  const guard = new LifeSendGuard(ids('action'))
  const first = guard.begin(draft)
  guard.finish(first.draftKey, true)

  const changedDate = guard.begin({ ...draft, date: '2026-10-27' })
  assert.equal(changedDate.status, 'accepted')
  assert.notEqual(changedDate.actionId, first.actionId)
  guard.finish(changedDate.draftKey, true)

  const changedImage = guard.begin({
    ...draft,
    date: '2026-10-27',
    image: { name: 'synthetic.png', size: 42, lastModified: 1 },
  })
  assert.equal(changedImage.status, 'accepted')
  assert.notEqual(changedImage.actionId, changedDate.actionId)
})

test('failed submissions remain retryable while successful submissions do not repeat', () => {
  const guard = new LifeSendGuard(ids('action'))
  const failed = guard.begin(draft)
  guard.finish(failed.draftKey, false)
  const retry = guard.begin(draft)
  assert.equal(retry.status, 'accepted')
  assert.equal(retry.actionId, failed.actionId)
  guard.finish(retry.draftKey, true)
  assert.equal(guard.begin(draft).status, 'already-submitted')
})

test('draft identity includes text, date and image metadata', () => {
  assert.notEqual(
    lifeSendDraftKey(draft),
    lifeSendDraftKey({ ...draft, text: '昨晚睡了7.5小时' }),
  )
  assert.notEqual(
    lifeSendDraftKey(draft),
    lifeSendDraftKey({ ...draft, date: '2026-10-27' }),
  )
  assert.notEqual(
    lifeSendDraftKey(draft),
    lifeSendDraftKey({
      ...draft,
      image: { name: 'synthetic.png', size: 42, lastModified: 1 },
    }),
  )
})
