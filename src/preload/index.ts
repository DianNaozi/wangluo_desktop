import { contextBridge, ipcRenderer, webUtils } from 'electron'

export type MediaKind = 'image' | 'video' | 'file'
export type ImportJobStatus = 'planned' | 'queued' | 'running' | 'completed' | 'partial_failed' | 'interrupted'
export type ImportDestination = { type: 'library' } | { type: 'folder'; folderId: string } | { type: 'coser'; coserId: string }
export type ImportEntryStatus = 'planned' | 'hashing' | 'copying' | 'imported' | 'duplicate' | 'skipped' | 'failed'
export type PreviewStatus = 'not_requested' | 'pending' | 'generating' | 'ready' | 'failed'
export type LibraryMedia = { id: string; originalName: string; mediaKind: MediaKind; importedAt: number; previewUrl: string | null; mediaUrl: string; previewStatus: PreviewStatus; previewError: string | null }
export type AlbumDetail = { id: string; title: string; folderId: string | null; updatedAt: number; media: LibraryMedia[] }
export type FolderSummary = { id: string; title: string; parentId: string | null; updatedAt: number; folderCount: number; albumCount: number; mediaCount: number }
export type FolderTreeNode = { id: string; title: string; parentId: string | null; itemCount: number; children: FolderTreeNode[] }
export type AlbumSummary = { id: string; title: string; mediaCount: number; updatedAt: number; coverPreviewUrl: string | null; coverPreviewPending: boolean }
export type CoserSummary = { id: string; name: string; aliases: string[]; avatarUrl: string | null; albumCount: number; videoCount: number; mediaCount: number; updatedAt: number }
export type CoserDetail = CoserSummary & { albums: AlbumSummary[]; videos: LibraryMedia[] }
export type AvatarCrop = { left: number; top: number; size: number }
export type FolderDetail = FolderSummary & { breadcrumbs: Array<{ id: string; title: string }>; folders: FolderSummary[]; albums: AlbumSummary[]; media: LibraryMedia[] }
export type TrashItem = { entityType: 'media' | 'album' | 'folder' | 'orphan'; id: string; title: string; mediaKind: MediaKind | null; trashedAt: number; expiresAt: number; mediaCount: number; state: 'trashed' | 'pending_trash' | 'pending_restore'; failureReason: string | null }
export type TrashSnapshot = { items: TrashItem[] }
export type TrashOperationResult = { succeeded: string[]; pending: string[]; failed: Array<{ id: string; reason: string }> }
export type ImportJobSummary = { id: string; sourceKind: 'files' | 'folders'; status: ImportJobStatus; totalEntries: number; totalBytes: number; processedEntries: number; importedEntries: number; duplicateEntries: number; failedEntries: number; skippedEntries: number; sourceCleanupFailedEntries: number; createdAt: number; startedAt: number | null; completedAt: number | null }
export type ImportEntrySummary = { id: string; sourceName: string; relativePath: string; sourceSize: number; mediaKind: MediaKind; status: ImportEntryStatus; errorCode: string | null; errorMessage: string | null; sourceCleanupStatus: 'not_requested' | 'pending' | 'trashed' | 'failed'; sourceCleanupError: string | null }
export type ImportJobDetail = ImportJobSummary & { entries: ImportEntrySummary[] }
export type LibrarySnapshot = { totals: { all: number; images: number; videos: number; files: number }; folders: FolderSummary[]; albums: AlbumSummary[]; looseMedia: LibraryMedia[] }

const api = {
  version: '1.0',
  playback: {
    enterFullscreen: (): Promise<void> => ipcRenderer.invoke('playback:set-fullscreen', true),
    exitFullscreen: (): Promise<void> => ipcRenderer.invoke('playback:set-fullscreen', false)
  },
  app: { getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version') },
  media: {
    importFiles: (folderId: string | null = null): Promise<ImportJobSummary | null> => ipcRenderer.invoke('media:import-files', folderId),
    importFolders: (folderId: string | null = null): Promise<ImportJobSummary | null> => ipcRenderer.invoke('media:import-folders', folderId),
    importDroppedFolders: (files: File[], destination: ImportDestination): Promise<ImportJobSummary> => ipcRenderer.invoke('media:import-dropped-folders', { paths: files.map((file) => webUtils.getPathForFile(file)), destination }),
    getJobs: (): Promise<ImportJobSummary[]> => ipcRenderer.invoke('media:get-jobs'),
    getJob: (jobId: string): Promise<ImportJobDetail> => ipcRenderer.invoke('media:get-job', jobId),
    retryJob: (jobId: string): Promise<ImportJobSummary> => ipcRenderer.invoke('media:retry-job', jobId),
    rebuildPreviews: (): Promise<number> => ipcRenderer.invoke('media:rebuild-previews'),
    retryPreview: (mediaId: string): Promise<boolean> => ipcRenderer.invoke('media:retry-preview', mediaId),
    trashMedia: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:trash-media', id),
    trashAlbum: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:trash-album', id),
    trashFolder: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:trash-folder', id),
    restoreMedia: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:restore-media', id),
    restoreAlbum: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:restore-album', id),
    restoreFolder: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:restore-folder', id),
    purgeTrash: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:purge-trash', id),
    purgeAlbum: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:purge-album', id),
    purgeFolder: (id: string): Promise<TrashOperationResult> => ipcRenderer.invoke('media:purge-folder', id),
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
  library: {
    getSnapshot: (): Promise<LibrarySnapshot> => ipcRenderer.invoke('media:get-library'),
    getFolderTree: (): Promise<FolderTreeNode[]> => ipcRenderer.invoke('media:get-folder-tree'),
    getAlbum: (id: string): Promise<AlbumDetail> => ipcRenderer.invoke('media:get-album', id),
    getFolder: (id: string): Promise<FolderDetail> => ipcRenderer.invoke('media:get-folder', id),
    createFolder: (title: string, parentId: string | null): Promise<FolderSummary> => ipcRenderer.invoke('media:create-folder', title, parentId),
    moveMedia: (mediaId: string, folderId: string | null): Promise<void> => ipcRenderer.invoke('media:move-media', mediaId, folderId),
    moveAlbum: (albumId: string, folderId: string | null): Promise<void> => ipcRenderer.invoke('media:move-album', albumId, folderId),
    getCosers: (): Promise<CoserSummary[]> => ipcRenderer.invoke('media:get-cosers'),
    getCoser: (id: string): Promise<CoserDetail> => ipcRenderer.invoke('media:get-coser', id),
    createCoser: (name: string, aliases: string[]): Promise<CoserSummary> => ipcRenderer.invoke('media:create-coser', { name, aliases }),
    updateCoser: (id: string, name: string, aliases: string[]): Promise<CoserSummary> => ipcRenderer.invoke('media:update-coser', { id, name, aliases }),
    deleteCoser: (id: string): Promise<void> => ipcRenderer.invoke('media:delete-coser', id),
    assignVideosCoser: (mediaIds: string[], coserId: string): Promise<{ count: number; operationId: string; expiresAt: number }> => ipcRenderer.invoke('media:assign-videos-coser', { mediaIds, coserId }),
    undoVideoCoserAssignment: (operationId: string): Promise<void> => ipcRenderer.invoke('media:undo-video-coser-assignment', operationId),
    unassignVideoCoser: (mediaId: string): Promise<void> => ipcRenderer.invoke('media:unassign-video-coser', mediaId),
    assignAlbumsCoser: (albumIds: string[], coserId: string): Promise<{ count: number; operationId: string; expiresAt: number }> => ipcRenderer.invoke('media:assign-albums-coser', { albumIds, coserId }),
    undoAlbumCoserAssignment: (operationId: string): Promise<void> => ipcRenderer.invoke('media:undo-album-coser-assignment', operationId),
    assignAlbumCoser: (albumId: string, coserId: string): Promise<void> => ipcRenderer.invoke('media:assign-album-coser', { albumId, coserId }),
    unassignAlbumCoser: (albumId: string): Promise<void> => ipcRenderer.invoke('media:unassign-album-coser', albumId),
    getCoserAvatarMedia: (coserId: string): Promise<LibraryMedia[]> => ipcRenderer.invoke('media:get-coser-avatar-media', coserId),
    saveCoserAvatar: (coserId: string, mediaId: string, crop: AvatarCrop): Promise<void> => ipcRenderer.invoke('coser:save-avatar', { coserId, mediaId, crop }),
    clearCoserAvatar: (coserId: string): Promise<void> => ipcRenderer.invoke('coser:clear-avatar', coserId),
    getTrash: (): Promise<TrashSnapshot> => ipcRenderer.invoke('media:get-trash')
  },
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
