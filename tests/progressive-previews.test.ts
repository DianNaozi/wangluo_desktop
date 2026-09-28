import { describe, expect, it } from 'vitest'
import { activatePreviewIds, observePreviewElement, retainPreviewIds, stopObservingPreviewElement } from '../src/renderer/src/utils/progressive-previews'

describe('progressive preview activation', () => {
  it('activates the first visible batch', () => {
    expect([...activatePreviewIds(new Set(), ['cover', 'detail'])]).toEqual(['cover', 'detail'])
  })

  it('keeps previously activated previews when a later batch enters the viewport', () => {
    const firstBatch = activatePreviewIds(new Set(), ['cover', 'detail'])

    expect([...activatePreviewIds(firstBatch, ['detail', 'landscape'])]).toEqual(['cover', 'detail', 'landscape'])
  })

  it('keeps a replacement node observed when its previous node is removed', () => {
    const previewIdsByElement = new Map<Element, string>()
    const previousNode = {} as Element
    const replacementNode = {} as Element

    observePreviewElement(previewIdsByElement, previousNode, 'landscape')
    observePreviewElement(previewIdsByElement, replacementNode, 'landscape')
    stopObservingPreviewElement(previewIdsByElement, previousNode)

    expect(previewIdsByElement.get(replacementNode)).toBe('landscape')
  })

  it('retains activated previews that still belong to a refreshed album', () => {
    expect([...retainPreviewIds(new Set(['cover', 'removed']), ['cover', 'new'])]).toEqual(['cover'])
  })
})
