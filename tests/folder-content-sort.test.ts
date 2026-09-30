import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FOLDER_ALBUMS_SORT_STORAGE_KEY,
  FOLDER_CHILDREN_SORT_STORAGE_KEY,
  readFolderContentSortOrder,
  sortFolderContent,
  writeFolderContentSortOrder
} from '../src/renderer/src/utils/folder-content-sort'

const items = [
  { id: 'second', title: 'IMG_10', updatedAt: 30 },
  { id: 'first', title: 'img_2', updatedAt: 20 },
  { id: 'same-new', title: 'same', updatedAt: 40 },
  { id: 'same-old', title: 'same', updatedAt: 10 },
  { id: 'chinese', title: '照片_3', updatedAt: 25 }
]

describe('folder content sorting', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    })
  })

  it('sorts titles naturally and deterministically', () => {
    expect(sortFolderContent(items, 'title').map((item) => item.id)).toEqual(['chinese', 'first', 'second', 'same-new', 'same-old'])
  })

  it('sorts recently updated content first', () => {
    expect(sortFolderContent(items, 'updatedAt').map((item) => item.id)).toEqual(['same-new', 'second', 'chinese', 'first', 'same-old'])
  })

  it('keeps child-folder and album preferences separate and falls back safely', () => {
    expect(readFolderContentSortOrder(FOLDER_CHILDREN_SORT_STORAGE_KEY)).toBe('title')
    writeFolderContentSortOrder(FOLDER_CHILDREN_SORT_STORAGE_KEY, 'updatedAt')
    expect(readFolderContentSortOrder(FOLDER_CHILDREN_SORT_STORAGE_KEY)).toBe('updatedAt')
    expect(readFolderContentSortOrder(FOLDER_ALBUMS_SORT_STORAGE_KEY)).toBe('title')
    localStorage.setItem(FOLDER_ALBUMS_SORT_STORAGE_KEY, 'importedAt')
    expect(readFolderContentSortOrder(FOLDER_ALBUMS_SORT_STORAGE_KEY)).toBe('title')
  })
})
