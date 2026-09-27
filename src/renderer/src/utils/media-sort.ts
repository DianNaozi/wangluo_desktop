export type MediaSortOrder = 'filename' | 'importedAt'

export type SortableMedia = {
  id: string
  originalName: string
  importedAt: number
}

export const LIBRARY_SORT_STORAGE_KEY = 'gallery-library-media-sort-order'
export const ALBUM_SORT_STORAGE_KEY = 'gallery-album-media-sort-order'

const filenameCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
})

export function normalizeMediaSortOrder(value: unknown): MediaSortOrder {
  return value === 'importedAt' ? 'importedAt' : 'filename'
}

export function readMediaSortOrder(storageKey: string): MediaSortOrder {
  if (typeof localStorage === 'undefined') return 'filename'
  return normalizeMediaSortOrder(localStorage.getItem(storageKey))
}

export function writeMediaSortOrder(storageKey: string, value: MediaSortOrder): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, value)
}

function compareId(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function compareByFilename(left: SortableMedia, right: SortableMedia): number {
  const filename = filenameCollator.compare(left.originalName, right.originalName)
  if (filename !== 0) return filename
  const importedAt = right.importedAt - left.importedAt
  return importedAt !== 0 ? importedAt : compareId(left.id, right.id)
}

export function sortMedia<T extends SortableMedia>(media: readonly T[], order: MediaSortOrder): T[] {
  return [...media].sort((left, right) => {
    if (order === 'filename') return compareByFilename(left, right)
    const importedAt = right.importedAt - left.importedAt
    return importedAt !== 0 ? importedAt : compareByFilename(left, right)
  })
}
