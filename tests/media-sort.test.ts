import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALBUM_SORT_STORAGE_KEY,
  LIBRARY_SORT_STORAGE_KEY,
  readMediaSortOrder,
  sortMedia,
  writeMediaSortOrder
} from '../src/renderer/src/utils/media-sort'

const media = [
  { id: 'second', originalName: 'IMG_10.jpg', importedAt: 30 },
  { id: 'first', originalName: 'img_2.jpg', importedAt: 20 },
  { id: 'same-new', originalName: 'same.jpg', importedAt: 40 },
  { id: 'same-old', originalName: 'same.jpg', importedAt: 10 },
  { id: 'chinese', originalName: '照片_3.jpg', importedAt: 25 }
]

describe('media sorting', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    })
  })

  it('sorts filenames naturally, case-insensitively, and deterministically', () => {
    expect(sortMedia(media, 'filename').map((item) => item.id)).toEqual(['chinese', 'first', 'second', 'same-new', 'same-old'])
  })

  it('sorts imported media with the newest first', () => {
    expect(sortMedia(media, 'importedAt').map((item) => item.id)).toEqual(['same-new', 'second', 'chinese', 'first', 'same-old'])
  })

  it('keeps media-library and album preferences separate and falls back safely', () => {
    expect(readMediaSortOrder(LIBRARY_SORT_STORAGE_KEY)).toBe('filename')
    writeMediaSortOrder(LIBRARY_SORT_STORAGE_KEY, 'importedAt')
    expect(readMediaSortOrder(LIBRARY_SORT_STORAGE_KEY)).toBe('importedAt')
    expect(readMediaSortOrder(ALBUM_SORT_STORAGE_KEY)).toBe('filename')
    localStorage.setItem(ALBUM_SORT_STORAGE_KEY, 'takenAt')
    expect(readMediaSortOrder(ALBUM_SORT_STORAGE_KEY)).toBe('filename')
  })
})
