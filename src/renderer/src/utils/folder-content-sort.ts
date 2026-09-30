export type FolderContentSortOrder = 'title' | 'updatedAt'

export type SortableFolderContent = {
  id: string
  title: string
  updatedAt: number
}

export const FOLDER_CHILDREN_SORT_STORAGE_KEY = 'gallery-folder-children-sort-order'
export const FOLDER_ALBUMS_SORT_STORAGE_KEY = 'gallery-folder-albums-sort-order'

const titleCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
})

export function normalizeFolderContentSortOrder(value: unknown): FolderContentSortOrder {
  return value === 'updatedAt' ? 'updatedAt' : 'title'
}

export function readFolderContentSortOrder(storageKey: string): FolderContentSortOrder {
  if (typeof localStorage === 'undefined') return 'title'
  return normalizeFolderContentSortOrder(localStorage.getItem(storageKey))
}

export function writeFolderContentSortOrder(storageKey: string, value: FolderContentSortOrder): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, value)
}

function compareId(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function compareByTitle<T extends SortableFolderContent>(left: T, right: T): number {
  const title = titleCollator.compare(left.title, right.title)
  if (title !== 0) return title
  const updatedAt = right.updatedAt - left.updatedAt
  return updatedAt !== 0 ? updatedAt : compareId(left.id, right.id)
}

export function sortFolderContent<T extends SortableFolderContent>(items: readonly T[], order: FolderContentSortOrder): T[] {
  return [...items].sort((left, right) => {
    if (order === 'title') return compareByTitle(left, right)
    const updatedAt = right.updatedAt - left.updatedAt
    return updatedAt !== 0 ? updatedAt : compareByTitle(left, right)
  })
}
