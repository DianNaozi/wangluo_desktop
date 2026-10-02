export function folderParentRoute(parentId: string | null): string {
  return parentId ? `/folders/${parentId}` : '/library'
}

export function albumParentRoute(folderId: string | null, sourceCoser?: unknown): string {
  if (typeof sourceCoser === 'string' && sourceCoser.trim()) {
    return `/cosers?coser=${encodeURIComponent(sourceCoser)}`
  }
  return folderParentRoute(folderId)
}

export function shouldRefreshFolderDetail(status: ImportJobStatus): boolean {
  return status === 'completed' || status === 'partial_failed'
}
