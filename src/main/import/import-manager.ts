import { BrowserWindow, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, rmdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { createDatabase } from './database'
import { validateDroppedFolderPaths } from './drop-paths'
import type { SmartCoserIndexItem } from './smart-folder-coser'
import type { AlbumDetail, CoserDetail, CoserSummary, FolderDetail, FolderSummary, FolderTreeNode, ImportJobDetail, ImportJobSummary, ImportProgressEvent, LibraryMedia, LibrarySnapshot, PlaybackCheckpoint, PlaybackStats, PreviewProgressEvent, StorageEligibility, TrashOperationResult, TrashSnapshot } from './types'

type Source = { path: string; kind: 'file' | 'folder'; folderId?: string | null; coserId?: string }
export type ImportDestination = { type: 'library' } | { type: 'folder'; folderId: string } | { type: 'coser'; coserId: string }
type PendingRequest = { resolve(value: unknown): void; reject(reason: Error): void }
type Service = 'import' | 'preview'
type SourceDisposalRequest = { entryId: string; sourcePath: string; sourceRootPath: string | null; sourceSize: number; sourceModifiedAt: number }

const MAX_RESTARTS = 3
const RESTART_DELAYS_MS = [250, 1000, 5000]

export class ImportManager {
  private worker: Worker | null = null
  private previewWorker: Worker | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly previewPending = new Map<string, PendingRequest>()
  private readonly restartAttempts: Record<Service, number> = { import: 0, preview: 0 }
  private readonly restartTimers: Partial<Record<Service, NodeJS.Timeout>> = {}
  private disposed = false

  constructor(private readonly databasePath: string, private readonly storagePath: string, private deleteSourcesAfterImport = false) {
    // Migrations complete before workers open their own SQLite connections.
    createDatabase(databasePath).sqlite.close()
    this.startImportWorker()
    this.startPreviewWorker()
  }

  private notifyServiceError(service: Service, message: string): void {
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('media:import-service-error', { service, message }))
  }
  private failPending(pending: Map<string, PendingRequest>, error: Error): void {
    pending.forEach((request) => request.reject(error))
    pending.clear()
  }
  private startImportWorker(): void {
    if (this.disposed) return
    const worker = new Worker(join(__dirname, 'import-worker.js'), { workerData: { databasePath: this.databasePath, storagePath: this.storagePath, deleteSourcesAfterImport: this.deleteSourcesAfterImport } })
    this.worker = worker
    worker.on('message', (message: { type: string; id?: string; result?: unknown; event?: ImportProgressEvent; request?: SourceDisposalRequest }) => {
      if (message.type === 'source-disposal-request' && message.request) { void this.disposeSource(worker, message.request); return }
      if (message.type === 'progress' && message.event) {
        BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('media:import-progress', message.event))
        if (['completed', 'partial_failed'].includes(message.event.job.status)) this.wakePreviewWorker()
        return
      }
      if (message.type !== 'response' || !message.id) return
      this.restartAttempts.import = 0
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      const result = message.result as { error?: string }
      if (result?.error) pending.reject(new Error(result.error)); else pending.resolve(message.result)
    })
    worker.once('error', (error) => this.handleWorkerFailure('import', worker, error))
    worker.once('exit', (code) => this.handleWorkerFailure('import', worker, new Error(`导入工作线程已退出（代码 ${code}）`)))
  }
  private startPreviewWorker(): void {
    if (this.disposed) return
    const worker = new Worker(join(__dirname, 'preview-worker.js'), { workerData: { databasePath: this.databasePath, storagePath: this.storagePath } })
    this.previewWorker = worker
    worker.on('message', (message: { type: string; id?: string; result?: unknown; event?: PreviewProgressEvent }) => {
      if (message.type === 'progress' && message.event) {
        BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('media:preview-progress', message.event))
        return
      }
      if (message.type !== 'response' || !message.id) return
      this.restartAttempts.preview = 0
      const pending = this.previewPending.get(message.id)
      if (!pending) return
      this.previewPending.delete(message.id)
      const result = message.result as { error?: string }
      if (result?.error) pending.reject(new Error(result.error)); else pending.resolve(message.result)
    })
    worker.once('error', (error) => this.handleWorkerFailure('preview', worker, error))
    worker.once('exit', (code) => this.handleWorkerFailure('preview', worker, new Error(`预览工作线程已退出（代码 ${code}）`)))
  }
  private handleWorkerFailure(service: Service, worker: Worker, error: Error): void {
    if (this.disposed || (service === 'import' ? this.worker : this.previewWorker) !== worker) return
    if (service === 'import') { this.worker = null; this.failPending(this.pending, error) }
    else { this.previewWorker = null; this.failPending(this.previewPending, error) }
    const attempt = this.restartAttempts[service]++
    if (attempt >= MAX_RESTARTS) {
      this.notifyServiceError(service, `${error.message}；已停止自动重启，请重启应用。`)
      return
    }
    const delay = RESTART_DELAYS_MS[attempt] ?? RESTART_DELAYS_MS.at(-1)!
    this.notifyServiceError(service, `${error.message}；将在 ${Math.ceil(delay / 1000)} 秒后自动恢复。`)
    this.restartTimers[service] = setTimeout(() => {
      delete this.restartTimers[service]
      if (service === 'import') this.startImportWorker(); else this.startPreviewWorker()
    }, delay)
  }

  async initialize(storagePath: string): Promise<void> { await mkdir(storagePath, { recursive: true }) }
  private request<T>(command: string, payload?: unknown): Promise<T> {
    if (!this.worker) return Promise.reject(new Error('导入服务正在恢复，请稍后重试'))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try { this.worker?.postMessage({ id, command, payload }) } catch (error) { this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  private previewRequest<T>(command: 'rebuild' | 'retry' | 'wake', payload?: unknown): Promise<T> {
    if (!this.previewWorker) return Promise.reject(new Error('预览服务正在恢复，请稍后重试'))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      this.previewPending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try { this.previewWorker?.postMessage({ id, command, payload }) } catch (error) { this.previewPending.delete(id); reject(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  private wakePreviewWorker(): void { void this.previewRequest<boolean>('wake').catch(() => undefined) }
  private isInside(root: string, target: string): boolean {
    const relativePath = relative(resolve(root), resolve(target))
    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  }
  private async removeEmptyParents(sourcePath: string, rootPath: string | null): Promise<void> {
    if (!rootPath || !this.isInside(rootPath, sourcePath)) return
    const root = resolve(rootPath)
    let candidate = dirname(resolve(sourcePath))
    while (this.isInside(root, candidate)) {
      try { await rmdir(candidate) } catch { return }
      if (candidate === root) return
      candidate = dirname(candidate)
    }
  }
  private async disposeSource(worker: Worker, request: SourceDisposalRequest): Promise<void> {
    let result: { entryId: string; success: boolean; error?: string }
    try {
      const source = resolve(request.sourcePath)
      if (this.isInside(this.storagePath, source)) throw new Error('源文件位于资源存储目录中，已拒绝回收')
      const info = await stat(source).catch(async (error: NodeJS.ErrnoException) => {
        // A crash can occur after Windows accepted trashItem but before the
        // worker persisted its acknowledgement.  The absent source is already
        // safely gone from its original location, so recovery is successful.
        if (error.code === 'ENOENT') { await this.removeEmptyParents(source, request.sourceRootPath); return null }
        throw error
      })
      if (!info) { result = { entryId: request.entryId, success: true }; worker.postMessage({ command: 'source-disposal-result', payload: result }); return }
      if (!info.isFile()) throw new Error('源路径已不再是普通文件')
      if (info.size !== request.sourceSize || Math.round(info.mtimeMs) !== request.sourceModifiedAt) throw new Error('源文件在导入后发生变化，已保留')
      await shell.trashItem(source)
      await this.removeEmptyParents(source, request.sourceRootPath)
      result = { entryId: request.entryId, success: true }
    } catch (error) { result = { entryId: request.entryId, success: false, error: error instanceof Error ? error.message : String(error) } }
    try { worker.postMessage({ command: 'source-disposal-result', payload: result }) } catch { /* The worker will recover the pending cleanup after restart. */ }
  }
  async setDeleteSourcesAfterImport(enabled: boolean): Promise<void> {
    this.deleteSourcesAfterImport = enabled
    await this.request('set-delete-sources-after-import', enabled)
  }
  async importFiles(owner: BrowserWindow, folderId: string | null = null): Promise<ImportJobSummary | null> {
    const result = await dialog.showOpenDialog(owner, { title: '导入文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '全部文件', extensions: ['*'] }] })
    return result.canceled || !result.filePaths.length ? null : this.request<ImportJobSummary>('plan', result.filePaths.map((path) => ({ path, kind: 'file', folderId } satisfies Source)))
  }
  async importFolders(owner: BrowserWindow, folderId: string | null = null): Promise<ImportJobSummary | null> {
    const result = await dialog.showOpenDialog(owner, { title: '导入文件夹', properties: ['openDirectory', 'multiSelections'] })
    return result.canceled || !result.filePaths.length ? null : this.request<ImportJobSummary>('plan', result.filePaths.map((path) => ({ path, kind: 'folder', folderId } satisfies Source)))
  }
  async chooseSmartFolderPaths(owner: BrowserWindow): Promise<string[] | null> {
    const result = await dialog.showOpenDialog(owner, { title: '智能导入文件夹', properties: ['openDirectory', 'multiSelections'] })
    return result.canceled || !result.filePaths.length ? null : validateDroppedFolderPaths(result.filePaths, this.storagePath)
  }
  validateSmartFolderPaths(rawPaths: unknown): Promise<string[]> { return validateDroppedFolderPaths(rawPaths, this.storagePath) }
  planSmartFolders(sources: Array<{ path: string; coserId: string | null }>): Promise<ImportJobSummary> {
    return this.request<ImportJobSummary>('plan', sources.map(({ path, coserId }) => ({ path, kind: 'folder', ...(coserId ? { coserId } : {}) } satisfies Source)))
  }
  async importDroppedFolders(rawPaths: unknown, rawDestination: unknown): Promise<ImportJobSummary> {
    if (!rawDestination || typeof rawDestination !== 'object') throw new Error('导入位置无效，请重新拖入文件夹')
    const destination = rawDestination as Record<string, unknown>
    let target: Pick<Source, 'folderId' | 'coserId'>
    if (destination.type === 'library') target = { folderId: null }
    else if (destination.type === 'folder' && typeof destination.folderId === 'string' && destination.folderId.length > 0) target = { folderId: destination.folderId }
    else if (destination.type === 'coser' && typeof destination.coserId === 'string' && destination.coserId.length > 0) target = { coserId: destination.coserId }
    else throw new Error('导入位置无效，请重新拖入文件夹')

    const paths = await validateDroppedFolderPaths(rawPaths, this.storagePath)
    return this.request<ImportJobSummary>('plan', paths.map((path) => ({ path, kind: 'folder', ...target } satisfies Source)))
  }
  getJobs(): Promise<ImportJobSummary[]> { return this.request('get-jobs') }
  getJob(jobId: string): Promise<ImportJobDetail> { return this.request('get-job', jobId) }
  getLibrary(): Promise<LibrarySnapshot> { return this.request('get-library') }
  getPlaybackState(): Promise<PlaybackStats> { return this.request('get-playback-state') }
  getPlaybackMedia(mediaIds: string[]): Promise<LibraryMedia[]> { return this.request('get-playback-media', mediaIds) }
  savePlaybackState(payload: unknown): Promise<PlaybackStats> { return this.request('save-playback-state', payload) }
  playbackCheckpoint(payload: PlaybackCheckpoint): Promise<PlaybackStats> { return this.request('playback-checkpoint', payload) }
  getFolderTree(): Promise<FolderTreeNode[]> { return this.request('get-folder-tree') }
  getAlbum(albumId: string): Promise<AlbumDetail> { return this.request('get-album', albumId) }
  getMediaPath(mediaId: string): Promise<string> { return this.request('get-media-path', mediaId) }
  getFolder(folderId: string): Promise<FolderDetail> { return this.request('get-folder', folderId) }
  createFolder(title: string, parentId: string | null): Promise<FolderSummary> { return this.request('create-folder', { title, parentId }) }
  moveMedia(mediaId: string, folderId: string | null): Promise<void> { return this.request('move-media', { mediaId, folderId }) }
  moveAlbum(albumId: string, folderId: string | null): Promise<void> { return this.request('move-album', { albumId, folderId }) }
  getCosers(): Promise<CoserSummary[]> { return this.request('get-cosers') }
  getSmartCoserIndex(): Promise<SmartCoserIndexItem[]> { return this.request('get-smart-coser-index') }
  getSmartCoserMapping(signature: string): Promise<string | null> { return this.request('get-smart-coser-mapping', { signature }) }
  async getSmartCoserMappings(signatures: string[]): Promise<Record<string, string>> {
    const mappings: Record<string, string> = {}
    for (let offset = 0; offset < signatures.length; offset += 500) Object.assign(mappings, await this.request<Record<string, string>>('get-smart-coser-mappings', signatures.slice(offset, offset + 500)))
    return mappings
  }
  saveSmartCoserMapping(signature: string, coserId: string): Promise<void> { return this.request('set-smart-coser-mapping', { signature, coserId }) }
  getSmartCoserModelCache(signature: string): Promise<string | null> { return this.request('get-smart-coser-model-cache', { signature }) }
  saveSmartCoserModelCache(signature: string, result: string): Promise<void> { return this.request('set-smart-coser-model-cache', { signature, result }) }
  getCoser(coserId: string): Promise<CoserDetail> { return this.request('get-coser', coserId) }
  getCoserAvatarMedia(coserId: string): Promise<LibraryMedia[]> { return this.request('get-coser-avatar-media', coserId) }
  getCoserAvatarSource(coserId: string, mediaId: string): Promise<string> { return this.request('get-coser-avatar-source', { coserId, mediaId }) }
  createCoser(name: string, aliases: string[]): Promise<CoserSummary> { return this.request('create-coser', { name, aliases }) }
  updateCoser(id: string, name: string, aliases: string[]): Promise<CoserSummary> { return this.request('update-coser', { id, name, aliases }) }
  setCoserAvatar(id: string, updatedAt: number | null): Promise<void> { return this.request('set-coser-avatar', { id, updatedAt }) }
  deleteCoser(id: string): Promise<void> { return this.request('delete-coser', id) }
  assignVideosCoser(mediaIds: string[], coserId: string): Promise<{ count: number; operationId: string; expiresAt: number }> { return this.request('assign-videos-coser', { mediaIds, coserId }) }
  undoVideoCoserAssignment(operationId: string): Promise<void> { return this.request('undo-video-coser-assignment', operationId) }
  unassignVideoCoser(mediaId: string): Promise<void> { return this.request('unassign-video-coser', mediaId) }
  assignAlbumsCoser(albumIds: string[], coserId: string): Promise<{ count: number; operationId: string; expiresAt: number }> { return this.request('assign-albums-coser', { albumIds, coserId }) }
  undoAlbumCoserAssignment(operationId: string): Promise<void> { return this.request('undo-album-coser-assignment', operationId) }
  assignAlbumCoser(albumId: string, coserId: string): Promise<void> { return this.request('assign-album-coser', { albumId, coserId }) }
  unassignAlbumCoser(albumId: string): Promise<void> { return this.request('unassign-album-coser', albumId) }
  getTrash(): Promise<TrashSnapshot> { return this.request('get-trash') }
  retry(jobId: string): Promise<ImportJobSummary> { return this.request('retry', jobId) }
  rebuildPreviews(): Promise<number> { return this.previewRequest('rebuild') }
  retryPreview(mediaId: string): Promise<boolean> { return this.previewRequest('retry', mediaId) }
  trashMedia(mediaId: string): Promise<TrashOperationResult> { return this.request('trash-media', mediaId) }
  trashAlbum(albumId: string): Promise<TrashOperationResult> { return this.request('trash-album', albumId) }
  trashFolder(folderId: string): Promise<TrashOperationResult> { return this.request('trash-folder', folderId) }
  restoreMedia(mediaId: string): Promise<TrashOperationResult> { return this.request('restore-media', mediaId) }
  restoreAlbum(albumId: string): Promise<TrashOperationResult> { return this.request('restore-album', albumId) }
  restoreFolder(folderId: string): Promise<TrashOperationResult> { return this.request('restore-folder', folderId) }
  purgeTrash(mediaId: string): Promise<TrashOperationResult> { return this.request('purge-trash', mediaId) }
  purgeAlbum(albumId: string): Promise<TrashOperationResult> { return this.request('purge-album', albumId) }
  purgeFolder(folderId: string): Promise<TrashOperationResult> { return this.request('purge-folder', folderId) }
  purgeAllTrash(): Promise<TrashOperationResult> { return this.request('purge-all-trash') }
  getStorageEligibility(): Promise<StorageEligibility> { return this.request('get-storage-eligibility') }
  async exportOrphan(owner: BrowserWindow, orphanId: string): Promise<TrashOperationResult> {
    const result = await dialog.showOpenDialog(owner, { title: '导出未完成导入文件', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { succeeded: [], pending: [], failed: [] }
    return this.request('export-orphan', { orphanId, destinationDirectory: result.filePaths[0] })
  }
  purgeOrphan(orphanId: string): Promise<TrashOperationResult> { return this.request('purge-orphan', orphanId) }
  async dispose(): Promise<void> {
    this.disposed = true
    Object.values(this.restartTimers).forEach((timer) => clearTimeout(timer))
    this.failPending(this.pending, new Error('导入服务已停止'))
    this.failPending(this.previewPending, new Error('预览服务已停止'))
    await Promise.all([this.worker?.terminate(), this.previewWorker?.terminate()])
    this.worker = null
    this.previewWorker = null
  }
}
