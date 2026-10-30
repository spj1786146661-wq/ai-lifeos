/**
 * Review items which need another user decision after a batch save.
 *
 * `skippedIndexes` refers to the candidate batch passed to the save service.
 * `incompleteIndexes` refers to the same original preview array. Keeping
 * original indexes avoids shifting image ownership when earlier candidates
 * were saved successfully.
 */
export function reviewIndexesToKeep(
  previewLength: number,
  incompleteIndexes: readonly number[],
  skippedIndexes: readonly number[],
): number[] {
  const keep = new Set<number>()
  for (const index of [...incompleteIndexes, ...skippedIndexes]) {
    if (Number.isInteger(index) && index >= 0 && index < previewLength) keep.add(index)
  }
  return [...keep].sort((a, b) => a - b)
}

export function remapPendingImageTarget(
  originalIndexes: readonly number[],
  target: number | null,
): number | null {
  if (target === null) return null
  const index = originalIndexes.indexOf(target)
  return index >= 0 ? index : null
}
