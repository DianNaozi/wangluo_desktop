export function toggleAlbumSelection(current: Set<string>, ids: string[], id: string, anchor: string | null, shift: boolean): Set<string> {
  const next = new Set(current)
  const end = ids.indexOf(id); const start = anchor ? ids.indexOf(anchor) : -1
  if (end < 0) return next
  if (shift && start >= 0) ids.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(value => next.add(value))
  else if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
