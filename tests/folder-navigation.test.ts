import { describe, expect, it } from 'vitest'
import { albumParentRoute, folderParentRoute, shouldRefreshFolderDetail } from '../src/renderer/src/utils/folder-navigation'

describe('folder navigation', () => {
  it('returns to the direct parent folder when one exists', () => {
    expect(folderParentRoute('parent-folder')).toBe('/folders/parent-folder')
  })

  it('returns to the media library from a root folder', () => {
    expect(folderParentRoute(null)).toBe('/library')
  })

  it('returns to an album parent folder when one exists', () => {
    expect(albumParentRoute('parent-folder')).toBe('/folders/parent-folder')
  })

  it('returns to the media library from a root album', () => {
    expect(albumParentRoute(null)).toBe('/library')
  })

  it('returns to the selected Coser when the album was opened from Coser', () => {
    expect(albumParentRoute(null, 'coser-1')).toBe('/cosers?coser=coser-1')
    expect(albumParentRoute('parent-folder', 'coser-2')).toBe('/cosers?coser=coser-2')
  })

  it('encodes the Coser selection and ignores invalid source values', () => {
    expect(albumParentRoute(null, 'name & alias')).toBe('/cosers?coser=name%20%26%20alias')
    for (const source of [undefined, null, '', ' ', ['coser-1']]) {
      expect(albumParentRoute('parent-folder', source)).toBe('/folders/parent-folder')
      expect(albumParentRoute(null, source)).toBe('/library')
    }
  })

  it('refreshes folder details only after an import reaches a terminal result', () => {
    expect(shouldRefreshFolderDetail('running')).toBe(false)
    expect(shouldRefreshFolderDetail('interrupted')).toBe(false)
    expect(shouldRefreshFolderDetail('completed')).toBe(true)
    expect(shouldRefreshFolderDetail('partial_failed')).toBe(true)
  })
})
