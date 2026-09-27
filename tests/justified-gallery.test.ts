import { describe, expect, it } from 'vitest'
import { buildJustifiedRows, getGalleryTargetRowHeight } from '../src/renderer/src/utils/justified-gallery'

describe('buildJustifiedRows', () => {
  it('fills complete horizontal rows while preserving each preview aspect ratio', () => {
    const rows = buildJustifiedRows([
      { id: 'wide', aspectRatio: 2 },
      { id: 'square', aspectRatio: 1 },
      { id: 'portrait', aspectRatio: 0.5 },
      { id: 'landscape', aspectRatio: 1.5 }
    ], 600, 120, 2)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ height: 596 / 3.5, isLast: false })
    expect(rows[0]?.items.reduce((sum, item) => sum + item.width, 0)).toBe(596)
    expect(rows[0]?.items.map((item) => item.id)).toEqual(['wide', 'square', 'portrait'])
    expect(rows[0]?.items.map((item) => item.width / rows[0]!.height)).toEqual([2, 1, 0.5])
  })

  it('keeps the final row left aligned at the target height instead of stretching it', () => {
    const rows = buildJustifiedRows([{ id: 'one', aspectRatio: 1.5 }], 600, 120, 2)

    expect(rows).toEqual([{ height: 120, isLast: true, items: [{ id: 'one', width: 180 }] }])
  })
})

describe('getGalleryTargetRowHeight', () => {
  it('uses larger rows on desktop and fewer images per line', () => {
    expect(getGalleryTargetRowHeight(1280)).toBe(280)
    expect(getGalleryTargetRowHeight(800)).toBe(220)
    expect(getGalleryTargetRowHeight(480)).toBe(160)
  })
})
