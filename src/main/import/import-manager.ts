import { BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { createDatabase } from './database'
import type { AlbumDetail, ImportJobDetail, ImportJobSummary, ImportProgressEvent, LibrarySnapshot, PreviewProgressEvent, TrashOperationResult, TrashSnapshot } from './types'

type Source = { path: string; kind: 'file' | 'folder' }
type PendingRequest = { resolve(value: unknown): void; reject(reason: Error): void }

export class ImportManager {
  private readonly worker: Worker
  private readonly pending = new Map<string, PendingRequest>()
  private readonly previewWorker: Worker
  private readonly previewPending = new Map<string, PendingRequest>()

  constructor(databasePath: string, storagePath: string) {
    // Finish migrations before both workers open their own SQLite connections.
    // This avoids two fresh workers racing to apply an ALTER TABLE migration.
    createDatabase(databasePath).sqlite.close()
    this.worker = new Worker(join(__dirname, 'import-worker.js'), { workerData: { databasePath, storagePath } })
    this.worker.on('message', (message: { type: string; id?: string; result?: unknown; event?: ImportProgressEvent }) => {
      if (message.type === 'progress' && message.event) {
        BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('media:import-progress', message.event))
        return
      }
      if (message.type !== 'response' || !message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      const result = message.result as { error?: string }
      if (result?.error) pending.reject(new Error(result.error)); else pending.resolve(message.result)
    })
    this.worker.on('error', (error) => { this.pending.forEach((pending) => pending.reject(error)); this.pending.clear() })
    this.previewWorker = new Worker(join(__dirname, 'preview-worker.js'), { workerData: { databasePath, storagePath } })
    this.previewWorker.on('message', (message: { type: string; id?: string; result?: unknown; event?: PreviewProgressEvent }) => {
      if (message.type === 'progress' && message.event) {
        BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('media:preview-progress', message.event))
        return
      }
      if (message.type !== 'response' || !message.id) return
      const pending = this.previewPending.get(message.id)
      if (!pending) return
      this.previewPending.delete(message.id)
      const result = message.result as { error?: string }
      if (result?.error) pending.reject(new Error(result.error)); else pending.resolve(message.result)
    })
    this.previewWorker.on('error', (error) => { this.previewPending.forEach((pending) => pending.reject(error)); this.previewPending.clear() })
  }

  async initialize(storagePath: string): Promise<void> { await mkdir(storagePath, { recursive: true }) }
  private request<T>(command: string, payload?: unknown): Promise<T> {
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => { this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject }); this.worker.postMessage({ id, command, payload }) })
  }
  private previewRequest<T>(command: 'rebuild' | 'wake'): Promise<T> {
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => { this.previewPending.set(id, { resolve: resolve as (value: unknown) => void, reject }); this.previewWorker.postMessage({ id, command }) })
  }
  async importFiles(owner: BrowserWindow): Promise<ImportJobSummary | null> {
    const result = await dialog.showOpenDialog(owner, { title: '导入文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '全部文件', extensions: ['*'] }] })
    return result.canceled || !result.filePaths.length ? null : this.request<ImportJobSummary>('plan', result.filePaths.map((path) => ({ path, kind: 'file' } satisfies Source)))
  }
  async importFolders(owner: BrowserWindow): Promise<ImportJobSummary | null> {
    const result = await dialog.showOpenDialog(owner, { title: '导入文件夹', properties: ['openDirectory', 'multiSelections'] })
    return result.canceled || !result.filePaths.length ? null : this.request<ImportJobSummary>('plan', result.filePaths.map((path) => ({ path, kind: 'folder' } satisfies Source)))
  }
  getJobs(): Promise<ImportJobSummary[]> { return this.request('get-jobs') }
  getJob(jobId: string): Promise<ImportJobDetail> { return this.request('get-job', jobId) }
  getLibrary(): Promise<LibrarySnapshot> { return this.request('get-library') }
  getAlbum(albumId: string): Promise<AlbumDetail> { return this.request('get-album', albumId) }
  getTrash(): Promise<TrashSnapshot> { return this.request('get-trash') }
  retry(jobId: string): Promise<ImportJobSummary> { return this.request('retry', jobId) }
  rebuildPreviews(): Promise<number> { return this.previewRequest('rebuild') }
  trashMedia(mediaId: string): Promise<TrashOperationResult> { return this.request('trash-media', mediaId) }
  trashAlbum(albumId: string): Promise<TrashOperationResult> { return this.request('trash-album', albumId) }
  restoreMedia(mediaId: string): Promise<TrashOperationResult> { return this.request('restore-media', mediaId) }
  restoreAlbum(albumId: string): Promise<TrashOperationResult> { return this.request('restore-album', albumId) }
  purgeTrash(mediaId: string): Promise<TrashOperationResult> { return this.request('purge-trash', mediaId) }
  purgeAlbum(albumId: string): Promise<TrashOperationResult> { return this.request('purge-album', albumId) }
  purgeAllTrash(): Promise<TrashOperationResult> { return this.request('purge-all-trash') }
  async dispose(): Promise<void> { await Promise.all([this.worker.terminate(), this.previewWorker.terminate()]) }
}
