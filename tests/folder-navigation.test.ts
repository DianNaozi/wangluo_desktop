import { describe, expect, it } from 'vitest'
import { folderParentRoute, shouldRefreshFolderDetail } from '../src/renderer/src/utils/folder-navigation'

describe('folder navigation', () => {
  it('returns to the direct parent folder when one exists', () => {
    expect(folderParentRoute('parent-folder')).toBe('/folders/parent-folder')
  })

  it('returns to the media library from a root folder', () => {
    expect(folderParentRoute(null)).toBe('/library')
  })

  it('refreshes folder details only after an import reaches a terminal result', () => {
    expect(shouldRefreshFolderDetail('running')).toBe(false)
    expect(shouldRefreshFolderDetail('interrupted')).toBe(false)
    expect(shouldRefreshFolderDetail('completed')).toBe(true)
    expect(shouldRefreshFolderDetail('partial_failed')).toBe(true)
  })
})
