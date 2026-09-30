import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ancestorFolderIds, filterFolderTree, flattenFolderTree, readExpandedFolderIds, sortFolderTree, writeExpandedFolderIds } from '../src/renderer/src/utils/folder-tree'

const tree = [
  { id: 'root-10', title: '旅行10', parentId: null, itemCount: 3, children: [] },
  { id: 'root-2', title: '旅行2', parentId: null, itemCount: 5, children: [{ id: 'child', title: '东京', parentId: 'root-2', itemCount: 2, children: [] }] },
  { id: 'photos', title: '照片', parentId: null, itemCount: 1, children: [] }
]

describe('folder tree', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  })

  it('sorts Chinese and numeric names naturally', () => {
    expect(sortFolderTree(tree).map((item) => item.id)).toEqual(['root-2', 'root-10', 'photos'])
  })

  it('keeps ancestors while filtering and forces matching paths visible', () => {
    const filtered = filterFolderTree(tree, '东京')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe('root-2')
    expect(flattenFolderTree(filtered, new Set(), true).map((item) => item.id)).toEqual(['root-2', 'child'])
  })

  it('persists expanded folders and resolves ancestors', () => {
    const ids = new Set(['root-2'])
    writeExpandedFolderIds(ids)
    expect(readExpandedFolderIds()).toEqual(['root-2'])
    expect(ancestorFolderIds(tree, 'child')).toEqual(['root-2'])
  })
})
