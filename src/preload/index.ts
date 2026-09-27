import { contextBridge, ipcRenderer } from 'electron'

export type MediaKind = 'image' | 'video' | 'file'
export type ImportJobStatus = 'planned' | 'queued' | 'running' | 'completed' | 'partial_failed' | 'interrupted'
export type ImportEntryStatus = 'planned' | 'hashing' | 'copying' | 'imported' | 'duplicate' | 'skipped' | 'failed'
export type PreviewStatus = 'not_requested' | 'pending' | 'generating' | 'ready' | 'failed'
export type LibraryMedia = { id: string; originalName: string; mediaKind: MediaKind; importedAt: number; previewUrl: string | null; previewStatus: PreviewStatus }
export type AlbumDetail = { id: string; title: string; updatedAt: number; media: LibraryMedia[] }
export type TrashItem = { entityType: 'media' | 'album' | 'orphan'; id: string; title: string; mediaKind: MediaKind | null; trashedAt: number; expiresAt: number; mediaCount: number; state: 'trashed' | 'pending_trash' | 'pending_restore'; failureReason: string | null }
export type TrashSnapshot = { items: TrashItem[] }
export type TrashOperationResult = { succeeded: string[]; pending: string[]; failed: Array<{ id: string; reason: string }> }
export type ImportJobSummary = { id: string; sourceKind: 'files' | 'folders'; status: ImportJobStatus; totalEntries: number; totalBytes: number; processedEntries: number; importedEntries: number; duplicateEntries: number; failedEntries: number; skippedEntries: number; sourceCleanupFailedEntries: number; createdAt: number; startedAt: number | null; completedAt: number | null }
export type ImportEntrySummary = { id: string; sourceName: string; relativePath: string; sourceSize: number; mediaKind: MediaKind; status: ImportEntryStatus; errorCode: string | null; errorMessage: string | null; sourceCleanupStatus: 'not_requested' | 'pending' | 'trashed' | 'failed'; sourceCleanupError: string | null }
export type ImportJobDetail = ImportJobSummary & { entries: ImportEntrySummary[] }
export type LibrarySnapshot = { totals: { all: number; images: number; videos: number; files: number }; albums: Array<{ id: string; title: string; mediaCount: number; updatedAt: number; coverPreviewUrl: string | null }>; looseMedia: LibraryMedia[] }

const api = {
  version: '1.0',
  app: { getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version') },
  media: {
    importFiles: (): Promise<ImportJobSummary | null> => ipcRenderer.invoke('media:import-files'),
    importFolders: (): Promise<ImportJobSummary | null> => ipcRenderer.invoke('media:import-folders'),
    getJobs: (): Promise<ImportJobSummary[]> => ipcRenderer.invoke('media:get-jobs'),
    getJob: (jobId: string): Promise<ImportJobDetail> => ipcRenderer.invoke('media:get-job', jobId),
    retryJob: (jobId: string): Promise<ImportJobSummary> => ipcRenderer.invoke('media:retry-job', jobId),
    rebuildPreviews: (): Promise<number> => ipcRenderer.invoke('media:rebuild-previews'),
    trashMedia: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:trash-media', id),
    trashAlbum: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:trash-album', id),
    restoreMedia: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:restore-media', id),
    restoreAlbum: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:restore-album', id),
    purgeTrash: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:purge-trash', id),
    purgeAlbum: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:purge-album', id),
    purgeAllTrash: (): Promise<TrashOperationResult> => ipcRenderer.invoke('media:purge-all-trash'),
    exportOrphan: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:export-orphan', id),
    purgeOrphan: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:purge-orphan', id),
    onImportProgress: (listener: (event: { job: ImportJobSummary }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: { job: ImportJobSummary }) => listener(event)
      ipcRenderer.on('media:import-progress', handler)
      return () => ipcRenderer.removeListener('media:import-progress', handler)
    },
    onPreviewProgress: (listener: (event: { mediaId: string; status: PreviewStatus }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: { mediaId: string; status: PreviewStatus }) => listener(event)
      ipcRenderer.on('media:preview-progress', handler)
      return () => ipcRenderer.removeListener('media:preview-progress', handler)
    },
    onImportServiceError: (listener: (event: { service: 'import' | 'preview'; message: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: { service: 'import' | 'preview'; message: string }) => listener(event)
      ipcRenderer.on('media:import-service-error', handler)
      return () => ipcRenderer.removeListener('media:import-service-error', handler)
    }
  },
  library: { getSnapshot: (): Promise<LibrarySnapshot> => ipcRenderer.invoke('media:get-library'), getAlbum: (id: string): Promise<AlbumDetail> => ipcRenderer.invoke('media:get-album', id), getTrash: (): Promise<TrashSnapshot> => ipcRenderer.invoke('media:get-trash') },
  settings: {
    getResourceDirectory: (): Promise<ResourceDirectory> => ipcRenderer.invoke('settings:get-resource-directory'),
    pickResourceDirectory: (): Promise<string | null> => ipcRenderer.invoke('settings:pick-resource-directory'),
    setResourceDirectory: (path: string): Promise<ResourceDirectory> => ipcRenderer.invoke('settings:set-resource-directory', path),
    getImportBehavior: (): Promise<ImportBehaviorSettings> => ipcRenderer.invoke('settings:get-import-behavior'),
    setDeleteSourcesAfterImport: (enabled: boolean): Promise<ImportBehaviorSettings> => ipcRenderer.invoke('settings:set-delete-sources-after-import', enabled)
  }
} as const
contextBridge.exposeInMainWorld('api', api)

export type ResourceDirectory = { path: string; usesDefault: boolean }
export type ImportBehaviorSettings = { deleteSourcesAfterImport: boolean }
