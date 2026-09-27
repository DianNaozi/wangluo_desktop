import { describe, expect, it } from 'vitest'
import { clampViewerIndex, nextViewerIndex, previousViewerIndex, resetImageTransform } from '../src/renderer/src/utils/media-viewer'

describe('media viewer state', () => {
  it('keeps navigation inside the current media sequence', () => {
    expect(previousViewerIndex(0)).toBe(0)
    expect(nextViewerIndex(2, 3)).toBe(2)
    expect(nextViewerIndex(0, 3)).toBe(1)
    expect(previousViewerIndex(2)).toBe(1)
    expect(clampViewerIndex(8, 3)).toBe(2)
  })

  it('resets image zoom and pan on media changes', () => {
    expect(resetImageTransform()).toEqual({ scale: 1, x: 0, y: 0 })
  })
})
