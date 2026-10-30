/** Friendly image labels for the normal UI. Never expose internal IDs/hashes. */
export function attachmentDisplayName(name: string | undefined, index = 0): string {
  const clean = (name ?? '').trim()
  return clean || `图片 ${index + 1}`
}

export function truncateDisplayName(name: string | undefined, maxLength = 28, index = 0): string {
  const label = attachmentDisplayName(name, index)
  if (label.length <= maxLength) return label
  return `${label.slice(0, Math.max(1, maxLength - 1))}…`
}
