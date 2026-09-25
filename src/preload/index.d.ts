export interface DesktopApi {
  readonly version: '1.0'
  readonly app: { getVersion(): Promise<string> }
  readonly media: {
    importFiles(): Promise<ImportJobSummary | null>
    importFolders(): Promise<ImportJobSummary | null>
    getJobs(): Promise<ImportJobSummary[]>
    getJob(jobId: string): Promise<ImportJobDetail>
    retryJob(jobId: string): Promise<ImportJobSummary>
    rebuildPreviews(): Promise<number>
    trashMedia(id: string): Promise<TrashOperationResult>
    trashAlbum(id: string): Promise<TrashOperationResult>
    restoreMedia(id: string): Promise<TrashOperationResult>
    restoreAlbum(id: string): Promise<TrashOperationResult>
    purgeTrash(id: string): Promise<TrashOperationResult>
    purgeAlbum(id: string): Promise<TrashOperationResult>
    purgeAllTrash(): Promise<TrashOperationResult>
    onImportProgress(listener: (event: { job: ImportJobSummary }) => void): () => void
    onPreviewProgress(listener: (event: { mediaId: string; status: PreviewStatus }) => void): () => void
  }
  readonly library: { getSnapshot(): Promise<LibrarySnapshot>; getAlbum(id: string): Promise<AlbumDetail>; getTrash(): Promise<TrashSnapshot> }
  readonly settings: Record<string, never>
}
export type MediaKind = 'image' | 'video' | 'file'
export type ImportJobStatus = 'planned' | 'queued' | 'running' | 'completed' | 'partial_failed' | 'interrupted'
export type ImportEntryStatus = 'planned' | 'hashing' | 'copying' | 'imported' | 'duplicate' | 'skipped' | 'failed'
export type PreviewStatus = 'not_requested' | 'pending' | 'generating' | 'ready' | 'failed'
export type LibraryMedia = { id: string; originalName: string; mediaKind: MediaKind; importedAt: number; previewUrl: string | null; previewStatus: PreviewStatus }
export type AlbumDetail = { id: string; title: string; updatedAt: number; media: LibraryMedia[] }
export type TrashItem = { entityType: 'media' | 'album'; id: string; title: string; mediaKind: MediaKind | null; trashedAt: number; expiresAt: number; mediaCount: number }
export type TrashSnapshot = { items: TrashItem[] }
export type TrashOperationResult = { succeeded: string[]; pending: string[]; failed: Array<{ id: string; reason: string }> }
export type ImportJobSummary = { id: string; sourceKind: 'files' | 'folders'; status: ImportJobStatus; totalEntries: number; totalBytes: number; processedEntries: number; importedEntries: number; duplicateEntries: number; failedEntries: number; skippedEntries: number; createdAt: number; startedAt: number | null; completedAt: number | null }
export type ImportEntrySummary = { id: string; sourceName: string; relativePath: string; sourceSize: number; mediaKind: MediaKind; status: ImportEntryStatus; errorCode: string | null; errorMessage: string | null }
export type ImportJobDetail = ImportJobSummary & { entries: ImportEntrySummary[] }
export type LibrarySnapshot = { totals: { all: number; images: number; videos: number; files: number }; albums: Array<{ id: string; title: string; mediaCount: number; updatedAt: number; coverPreviewUrl: string | null }>; looseMedia: LibraryMedia[] }
declare global { interface Window { api: DesktopApi } }
