import test from 'node:test'
import assert from 'node:assert/strict'
import { remapPendingImageTarget, reviewIndexesToKeep } from '../lib/life-review-selection.ts'

test('successful candidates leave the review while duplicates stay actionable', () => {
  assert.deepEqual(reviewIndexesToKeep(4, [], [0, 2]), [0, 2])
})

test('incomplete and duplicate indexes are merged without changing order', () => {
  assert.deepEqual(reviewIndexesToKeep(4, [3, 1], [1, 2]), [1, 2, 3])
})

test('an all-duplicate batch remains visible', () => {
  assert.deepEqual(reviewIndexesToKeep(3, [], [0, 1, 2]), [0, 1, 2])
})

test('invalid indexes cannot create phantom review cards', () => {
  assert.deepEqual(reviewIndexesToKeep(2, [-1, 9], [1, 1]), [1])
})

test('an image target follows its original review card after earlier saves', () => {
  assert.equal(remapPendingImageTarget([1, 3], 3), 1)
  assert.equal(remapPendingImageTarget([1, 3], 1), 0)
})

test('a skipped image target stays unresolved instead of moving to another record', () => {
  assert.equal(remapPendingImageTarget([2, 3], 1), null)
  assert.equal(remapPendingImageTarget([2, 3], null), null)
})
