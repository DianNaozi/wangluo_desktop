export type MediaKind = 'image' | 'video' | 'file'
export type ImportJobStatus = 'planned' | 'queued' | 'running' | 'completed' | 'partial_failed' | 'interrupted'
export type ImportEntryStatus = 'planned' | 'hashing' | 'copying' | 'imported' | 'duplicate' | 'skipped' | 'failed'
export type PreviewStatus = 'not_requested' | 'pending' | 'generating' | 'ready' | 'failed'
export type TrashState = 'active' | 'pending_trash' | 'trashed' | 'pending_restore'
export type LibraryMedia = { id: string; originalName: string; mediaKind: MediaKind; importedAt: number; previewUrl: string | null; mediaUrl: string; previewStatus: PreviewStatus; previewError: string | null }
export type AlbumDetail = { id: string; title: string; folderId: string | null; updatedAt: number; media: LibraryMedia[] }
export type FolderSummary = { id: string; title: string; parentId: string | null; updatedAt: number; folderCount: number; albumCount: number; mediaCount: number }
export type FolderTreeNode = { id: string; title: string; parentId: string | null; itemCount: number; children: FolderTreeNode[] }
export type AlbumSummary = { id: string; title: string; mediaCount: number; updatedAt: number; coverPreviewUrl: string | null; coverPreviewPending: boolean }
export type CoserSummary = { id: string; name: string; aliases: string[]; avatarUrl: string | null; albumCount: number; videoCount: number; mediaCount: number; updatedAt: number }
export type CoserDetail = CoserSummary & { albums: AlbumSummary[]; videos: LibraryMedia[] }
export type FolderDetail = FolderSummary & { breadcrumbs: Array<{ id: string; title: string }>; folders: FolderSummary[]; albums: AlbumSummary[]; media: LibraryMedia[] }
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
  albums: AlbumSummary[]
  looseMedia: LibraryMedia[]
}

export type ImportProgressEvent = { job: ImportJobSummary }
export type PreviewProgressEvent = { mediaId: string; status: PreviewStatus }

export type PlaybackVideoRange = { startMs: number; endMs: number }
export type PlaybackQueueEntryState =
  | { entryId: string; type: 'album'; albumId: string; title: string; sortOrder: 'filename' | 'importedAt'; mediaIds: string[] }
  | { entryId: string; type: 'media'; mediaId: string; title: string; source: string }
export type PlaybackMediaProgress = {
  entryId: string
  mediaId: string
  watchedMs: number
  imageElapsedMs: number
  videoPositionMs: number
  videoDurationMs: number
  videoRanges: PlaybackVideoRange[]
  lastWatchedAt: number | null
}
export type PlaybackAchievement = { id: string; earnedAt: number }
export type PlaybackDayTotal = { date: string; watchedMs: number }
export type PlaybackStats = {
  totalWatchedMs: number
  xp: number
  level: number
  xpInLevel: number
  xpToNextLevel: number
  imageIntervalSeconds: number
  loop: boolean
  queue: PlaybackQueueEntryState[]
  cursorEntryId: string | null
  cursorMediaId: string | null
  progress: PlaybackMediaProgress[]
  achievements: PlaybackAchievement[]
  lastPlayedEntryId: string | null
  lastPlayedMediaId: string | null
  days: PlaybackDayTotal[]
}
export type PlaybackSample = {
  sessionId: string
  sequence: number
  entryId: string
  mediaId: string
  mediaType: 'image' | 'video'
  ready: boolean
  playing: boolean
  waiting: boolean
  seeking: boolean
  error: boolean
  positionMs: number
  durationMs: number
  imageElapsedMs: number
  playbackRate: number
}
export type PlaybackCheckpointMedia = {
  entryId: string
  mediaId: string
  watchedDeltaMs: number
  imageElapsedMs: number
  positionMs: number
  durationMs: number
  videoRanges: PlaybackVideoRange[]
  watchedAt: number
}
export type PlaybackCheckpoint = {
  sessionId: string
  sequence: number
  watchedDeltaMs: number
  media: PlaybackCheckpointMedia[]
}
