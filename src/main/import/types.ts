export type MediaKind = 'image' | 'video' | 'file'
export type ImportJobStatus = 'planned' | 'queued' | 'running' | 'completed' | 'partial_failed' | 'interrupted'
export type ImportEntryStatus = 'planned' | 'hashing' | 'copying' | 'imported' | 'duplicate' | 'skipped' | 'failed'
export type PreviewStatus = 'not_requested' | 'pending' | 'generating' | 'ready' | 'failed'
export type TrashState = 'active' | 'pending_trash' | 'trashed' | 'pending_restore'
export type LibraryMedia = { id: string; originalName: string; mediaKind: MediaKind; importedAt: number; previewUrl: string | null; mediaUrl: string; previewStatus: PreviewStatus }
export type AlbumDetail = { id: string; title: string; folderId: string | null; updatedAt: number; media: LibraryMedia[] }
export type FolderSummary = { id: string; title: string; parentId: string | null; updatedAt: number; folderCount: number; albumCount: number; mediaCount: number }
export type FolderDetail = FolderSummary & { breadcrumbs: Array<{ id: string; title: string }>; folders: FolderSummary[]; albums: Array<{ id: string; title: string; mediaCount: number; updatedAt: number; coverPreviewUrl: string | null }>; media: LibraryMedia[] }
export type TrashItem = { entityType: 'media' | 'album' | 'folder' | 'orphan'; id: string; title: string; mediaKind: MediaKind | null; trashedAt: number; expiresAt: number; mediaCount: number; state: 'trashed' | 'pending_trash' | 'pending_restore'; failureReason: string | null }
export type TrashSnapshot = { items: TrashItem[] }
export type TrashOperationResult = { succeeded: string[]; pending: string[]; failed: Array<{ id: string; reason: string }> }
export type StorageEligibility = { canChangeResourceDirectory: boolean; reason: string | null }

export type ImportJobSummary = {
  id: string
  sourceKind: 'files' | 'folders'
  status: ImportJobStatus
  totalEntries: number
  totalBytes: number
  processedEntries: number
  importedEntries: number
  duplicateEntries: number
  failedEntries: number
  skippedEntries: number
  sourceCleanupFailedEntries: number
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

export type ImportEntrySummary = {
  id: string
  sourceName: string
  relativePath: string
  sourceSize: number
  mediaKind: MediaKind
  status: ImportEntryStatus
  errorCode: string | null
  errorMessage: string | null
  sourceCleanupStatus: 'not_requested' | 'pending' | 'trashed' | 'failed'
  sourceCleanupError: string | null
}

export type ImportJobDetail = ImportJobSummary & { entries: ImportEntrySummary[] }

export type LibrarySnapshot = {
  totals: { all: number; images: number; videos: number; files: number }
  folders: FolderSummary[]
  albums: Array<{ id: string; title: string; mediaCount: number; updatedAt: number; coverPreviewUrl: string | null }>
  looseMedia: LibraryMedia[]
}

export type ImportProgressEvent = { job: ImportJobSummary }
export type PreviewProgressEvent = { mediaId: string; status: PreviewStatus }
