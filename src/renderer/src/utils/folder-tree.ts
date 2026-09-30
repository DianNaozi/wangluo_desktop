export type FolderTreeItem = {
  id: string
  title: string
  parentId: string | null
  itemCount: number
  children: FolderTreeItem[]
}

export type VisibleFolderTreeItem = FolderTreeItem & { depth: number; hasChildren: boolean }

export const FOLDER_TREE_EXPANDED_STORAGE_KEY = 'gallery-folder-tree-expanded'

const titleCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function compareId(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

export function sortFolderTree(items: readonly FolderTreeItem[]): FolderTreeItem[] {
  return [...items]
    .sort((left, right) => titleCollator.compare(left.title, right.title) || compareId(left.id, right.id))
    .map((item) => ({ ...item, children: sortFolderTree(item.children) }))
}

export function filterFolderTree(items: readonly FolderTreeItem[], query: string): FolderTreeItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items.map((item) => ({ ...item, children: filterFolderTree(item.children, '') }))
  return items.flatMap((item) => {
    const children = filterFolderTree(item.children, normalizedQuery)
    return item.title.toLocaleLowerCase().includes(normalizedQuery) || children.length ? [{ ...item, children }] : []
  })
}

export function flattenFolderTree(items: readonly FolderTreeItem[], expandedIds: ReadonlySet<string>, forceExpanded = false, depth = 0): VisibleFolderTreeItem[] {
  return items.flatMap((item) => {
    const hasChildren = item.children.length > 0
    const visible: VisibleFolderTreeItem = { ...item, depth, hasChildren }
    return hasChildren && (forceExpanded || expandedIds.has(item.id))
      ? [visible, ...flattenFolderTree(item.children, expandedIds, forceExpanded, depth + 1)]
      : [visible]
  })
}

export function readExpandedFolderIds(): string[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FOLDER_TREE_EXPANDED_STORAGE_KEY) ?? 'null')
    return Array.isArray(value) && value.every((id) => typeof id === 'string') ? value : null
  } catch { return null }
}

export function writeExpandedFolderIds(ids: ReadonlySet<string>): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(FOLDER_TREE_EXPANDED_STORAGE_KEY, JSON.stringify([...ids]))
}

export function ancestorFolderIds(items: readonly FolderTreeItem[], targetId: string): string[] {
  for (const item of items) {
    if (item.id === targetId) return []
    const descendants = ancestorFolderIds(item.children, targetId)
    if (descendants.length || item.children.some((child) => child.id === targetId)) return [item.id, ...descendants]
  }
  return []
}
