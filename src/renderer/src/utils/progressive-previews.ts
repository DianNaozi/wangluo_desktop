export function activatePreviewIds(activeIds: ReadonlySet<string>, ids: Iterable<string>): Set<string> {
  const nextIds = new Set(activeIds)
  for (const id of ids) nextIds.add(id)
  return nextIds
}

export function retainPreviewIds(activeIds: ReadonlySet<string>, mediaIds: Iterable<string>): Set<string> {
  const remainingIds = new Set(mediaIds)
  return new Set([...activeIds].filter((id) => remainingIds.has(id)))
}

export function observePreviewElement(previewIdsByElement: Map<Element, string>, element: Element, mediaId: string): void {
  previewIdsByElement.set(element, mediaId)
}

export function stopObservingPreviewElement(previewIdsByElement: Map<Element, string>, element: Element): void {
  previewIdsByElement.delete(element)
}
