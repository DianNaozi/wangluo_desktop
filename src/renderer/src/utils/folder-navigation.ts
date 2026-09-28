export function folderParentRoute(parentId: string | null): string {
  return parentId ? `/folders/${parentId}` : '/library'
}

export function albumParentRoute(folderId: string | null): string {
  return folderParentRoute(folderId)
}

export function shouldRefreshFolderDetail(status: ImportJobStatus): boolean {
  return status === 'completed' || status === 'partial_failed'
}
