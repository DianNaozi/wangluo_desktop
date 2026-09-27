export type GalleryItemRatio = { id: string; aspectRatio: number }
export type JustifiedGalleryRow = { height: number; isLast: boolean; items: Array<{ id: string; width: number }> }

export function getGalleryTargetRowHeight(containerWidth: number): number {
  if (containerWidth < 640) return 160
  if (containerWidth < 1024) return 220
  return 280
}

export function buildJustifiedRows(items: GalleryItemRatio[], containerWidth: number, targetHeight: number, gap: number): JustifiedGalleryRow[] {
  if (containerWidth <= 0 || targetHeight <= 0) return []
  const rows: JustifiedGalleryRow[] = []
  let pending: GalleryItemRatio[] = []

  const pushFilledRow = (): void => {
    const ratioTotal = pending.reduce((sum, item) => sum + item.aspectRatio, 0)
    const availableWidth = containerWidth - gap * Math.max(0, pending.length - 1)
    const height = availableWidth / ratioTotal
    rows.push({ height, isLast: false, items: pending.map((item) => ({ id: item.id, width: item.aspectRatio * height })) })
    pending = []
  }

  for (const item of items) {
    const aspectRatio = Number.isFinite(item.aspectRatio) && item.aspectRatio > 0 ? item.aspectRatio : 1
    const candidateRatio = pending.reduce((sum, current) => sum + current.aspectRatio, 0) + aspectRatio
    const candidateWidth = candidateRatio * targetHeight + gap * pending.length
    if (pending.length && candidateWidth > containerWidth) pushFilledRow()
    pending.push({ ...item, aspectRatio })
  }

  if (pending.length) rows.push({ height: targetHeight, isLast: true, items: pending.map((item) => ({ id: item.id, width: item.aspectRatio * targetHeight })) })
  return rows
}
