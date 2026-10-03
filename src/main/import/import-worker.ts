import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, opendir, readdir, rename, rm, stat, lstat } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { parentPort, workerData } from 'node:worker_threads'
import { createDatabase } from './database'
import { createVideoCoserAssignment } from './video-coser-assignment'
import { createCoserAssignment } from './coser-assignment'
import type { AlbumDetail, AlbumSummary, CoserDetail, CoserSummary, FolderDetail, FolderSummary, FolderTreeNode, ImportEntryStatus, ImportJobDetail, ImportJobSummary, ImportProgressEvent, LibraryMedia, LibrarySnapshot, MediaKind, PlaybackAchievement, PlaybackCheckpoint, PlaybackMediaProgress, PlaybackQueueEntryState, PlaybackStats, PlaybackVideoRange, StorageEligibility, TrashItem, TrashOperationResult, TrashSnapshot } from './types'
import { mergePlaybackRanges, playbackLevel, playbackMediaComplete, playbackXpFor } from './playback-rewards'

type WorkerConfig = { databasePath: string; storagePath: string; deleteSourcesAfterImport?: boolean }
type Source = { path: string; kind: 'file' | 'folder'; folderId?: string | null; coserId?: string }
type Request = { id?: string; command: 'assign-videos-coser' | 'undo-video-coser-assignment' | 'unassign-video-coser' | 'assign-albums-coser' | 'undo-album-coser-assignment' | 'plan' | 'get-jobs' | 'get-job' | 'get-library' | 'get-folder-tree' | 'get-album' | 'get-folder' | 'get-media-path' | 'get-coser-avatar-media' | 'get-coser-avatar-source' | 'create-folder' | 'move-media' | 'move-album' | 'get-cosers' | 'get-coser' | 'create-coser' | 'update-coser' | 'set-coser-avatar' | 'delete-coser' | 'assign-album-coser' | 'unassign-album-coser' | 'get-trash' | 'retry' | 'trash-media' | 'trash-album' | 'trash-folder' | 'restore-media' | 'restore-album' | 'restore-folder' | 'purge-trash' | 'purge-album' | 'purge-folder' | 'purge-all-trash' | 'purge-orphan' | 'set-delete-sources-after-import' | 'source-disposal-result' | 'get-storage-eligibility' | 'export-orphan' | 'get-playback-state' | 'get-playback-media' | 'save-playback-state' | 'playback-checkpoint' | 'get-smart-coser-index' | 'get-smart-coser-mapping' | 'get-smart-coser-mappings' | 'set-smart-coser-mapping' | 'get-smart-coser-model-cache' | 'set-smart-coser-model-cache'; payload?: unknown }
type ScannedFile = { path: string; relativePath: string; name: string; size: number; modifiedAt: number; kind: MediaKind; albumId: string | null; folderId: string | null; sourceRootPath: string | null; skippedReason?: string }
type SourceDisposalRequest = { entryId: string; sourcePath: string; sourceRootPath: string | null; sourceSize: number; sourceModifiedAt: number }
type SourceDisposalResult = { entryId: string; success: boolean; error?: string }

const config = workerData as WorkerConfig
if (!parentPort) throw new Error('Import worker must be started with a parent port')
const parent = parentPort!
const coserPerformanceEnabled = process.env.NODE_ENV === 'development'

function reportCoserDatabaseTime(stage: string, startedAt: number): void {
  if (coserPerformanceEnabled) console.info(`[coser-perf] database ${stage}: ${Math.round(performance.now() - startedAt)} ms`)
}

const { sqlite } = createDatabase(config.databasePath)
const coserAssignment = createCoserAssignment(sqlite)
const videoCoserAssignment = createVideoCoserAssignment(sqlite)
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.bmp', '.tif', '.tiff'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.wmv'])
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])
const hashLocks = new Map<string, Promise<void>>()
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const PROGRESS_INTERVAL_MS = 250
const importPathCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const scheduledProgress = new Map<string, NodeJS.Timeout>()
const lastProgressAt = new Map<string, number>()
const pendingSourceDisposals = new Map<string, (result: SourceDisposalResult) => void>()
let queuePumping = false
let queueScheduled = false
let deleteSourcesAfterImport = Boolean(config.deleteSourcesAfterImport)

function compareStableNatural(left: string, right: string): number {
  return importPathCollator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0)
}

function compareImportEntries(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftPath = String(left.source_path ?? '')
  const rightPath = String(right.source_path ?? '')
  return compareStableNatural(dirname(leftPath), dirname(rightPath)) ||
    compareStableNatural(basename(leftPath), basename(rightPath)) ||
    compareStableNatural(leftPath, rightPath) ||
    compareStableNatural(String(left.id ?? ''), String(right.id ?? ''))
}

function reply(id: string, result: unknown): void { parent.postMessage({ type: 'response', id, result }) }
function replyError(id: string, error: unknown): void { reply(id, { error: error instanceof Error ? error.message : String(error) }) }
function classify(path: string): MediaKind { const extension = extname(path).toLowerCase(); return IMAGE_EXTENSIONS.has(extension) ? 'image' : VIDEO_EXTENSIONS.has(extension) ? 'video' : 'file' }
function isArchive(path: string): boolean { return ARCHIVE_EXTENSIONS.has(extname(path).toLowerCase()) }
function jobSummary(row: Record<string, unknown>): ImportJobSummary {
  return {
    id: String(row.id), sourceKind: String(row.source_kind) as ImportJobSummary['sourceKind'], status: String(row.status) as ImportJobSummary['status'],
    totalEntries: Number(row.total_entries), totalBytes: Number(row.total_bytes), processedEntries: Number(row.processed_entries),
    importedEntries: Number(row.imported_entries), duplicateEntries: Number(row.duplicate_entries), failedEntries: Number(row.failed_entries), skippedEntries: Number(row.skipped_entries), sourceCleanupFailedEntries: Number(row.source_cleanup_failed_entries),
    createdAt: Number(row.created_at), startedAt: row.started_at === null ? null : Number(row.started_at), completedAt: row.completed_at === null ? null : Number(row.completed_at)
  }
}
function emitProgress(jobId: string): void {
  const row = sqlite.prepare('SELECT * FROM import_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined
  if (!row) return
  lastProgressAt.set(jobId, Date.now())
  parent.postMessage({ type: 'progress', event: { job: jobSummary(row) } satisfies ImportProgressEvent })
}
function publish(jobId: string, force = false): void {
  const pending = scheduledProgress.get(jobId)
  if (force && pending) { clearTimeout(pending); scheduledProgress.delete(jobId) }
  if (force) { emitProgress(jobId); return }
  if (pending) return
  const delay = Math.max(0, PROGRESS_INTERVAL_MS - (Date.now() - (lastProgressAt.get(jobId) ?? 0)))
  if (delay === 0) { emitProgress(jobId); return }
  scheduledProgress.set(jobId, setTimeout(() => { scheduledProgress.delete(jobId); emitProgress(jobId) }, delay))
}
function requestSourceDisposal(request: SourceDisposalRequest): Promise<SourceDisposalResult> {
  return new Promise((resolveDisposal) => {
    pendingSourceDisposals.set(request.entryId, resolveDisposal)
    parent.postMessage({ type: 'source-disposal-request', request })
  })
}
function updateSourceCleanupFailures(jobId: string): void {
  sqlite.prepare(`UPDATE import_jobs SET source_cleanup_failed_entries = (
    SELECT COUNT(*) FROM import_entries WHERE job_id = ? AND source_cleanup_status = 'failed'
  ) WHERE id = ?`).run(jobId, jobId)
}
async function disposeSourceForEntry(entry: Record<string, unknown>, jobId: string): Promise<void> {
  const entryId = String(entry.id)
  const result = await requestSourceDisposal({
    entryId,
    sourcePath: String(entry.source_path),
    sourceRootPath: entry.source_root_path === null ? null : String(entry.source_root_path),
    sourceSize: Number(entry.source_size),
    sourceModifiedAt: Number(entry.source_modified_at)
  })
  if (result.success) sqlite.prepare("UPDATE import_entries SET source_cleanup_status = 'trashed', source_cleanup_error = NULL, source_cleaned_at = ? WHERE id = ?").run(Date.now(), entryId)
  else sqlite.prepare("UPDATE import_entries SET source_cleanup_status = 'failed', source_cleanup_error = ? WHERE id = ?").run((result.error ?? '无法移入系统回收站').slice(0, 2000), entryId)
  updateSourceCleanupFailures(jobId)
}

async function scanFolder(rootPath: string, albumId: string, folderId: string | null): Promise<ScannedFile[]> {
  const results: ScannedFile[] = []
  async function visit(directory: string): Promise<void> {
    let handle
    try { handle = await opendir(directory) } catch (error) {
      results.push({ path: directory, relativePath: relative(rootPath, directory) || basename(directory), name: basename(directory), size: 0, modifiedAt: 0, kind: 'file', albumId, folderId, sourceRootPath: rootPath, skippedReason: `无法读取目录：${error instanceof Error ? error.message : String(error)}` })
      return
    }
    for await (const entry of handle) {
      const absolute = join(directory, entry.name)
      try {
        const info = await lstat(absolute)
        if (info.isSymbolicLink()) {
          results.push({ path: absolute, relativePath: relative(rootPath, absolute), name: entry.name, size: 0, modifiedAt: info.mtimeMs, kind: 'file', albumId, folderId, sourceRootPath: rootPath, skippedReason: '已跳过符号链接或重解析点' })
        } else if (info.isDirectory()) await visit(absolute)
        else if (info.isFile()) {
          results.push({ path: absolute, relativePath: relative(rootPath, absolute), name: entry.name, size: info.size, modifiedAt: info.mtimeMs, kind: classify(absolute), albumId, folderId, sourceRootPath: rootPath, skippedReason: isArchive(absolute) ? '本期不支持压缩包导入' : undefined })
        }
      } catch (error) {
        results.push({ path: absolute, relativePath: relative(rootPath, absolute), name: entry.name, size: 0, modifiedAt: 0, kind: 'file', albumId, folderId, sourceRootPath: rootPath, skippedReason: `无法读取文件：${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }
  await visit(rootPath)
  return results
}

async function scanSources(sources: Source[], jobId: string): Promise<{ files: ScannedFile[]; albums: Array<{ id: string; title: string; folderId: string | null; coserId: string | null }> }> {
  const files: ScannedFile[] = []
  const albums: Array<{ id: string; title: string; folderId: string | null; coserId: string | null }> = []
  for (const source of sources) {
    if (source.kind === 'folder') {
      const album = { id: randomUUID(), title: basename(source.path) || '未命名文件夹', folderId: source.coserId ? null : source.folderId ?? null, coserId: source.coserId ?? null }
      albums.push(album)
      files.push(...await scanFolder(source.path, album.id, album.folderId))
      continue
    }
    try {
      const info = await stat(source.path)
      if (!info.isFile()) continue
      files.push({ path: source.path, relativePath: basename(source.path), name: basename(source.path), size: info.size, modifiedAt: info.mtimeMs, kind: classify(source.path), albumId: null, folderId: source.folderId ?? null, sourceRootPath: null, skippedReason: isArchive(source.path) ? '本期不支持压缩包导入' : undefined })
    } catch (error) {
      files.push({ path: source.path, relativePath: basename(source.path), name: basename(source.path), size: 0, modifiedAt: 0, kind: 'file', albumId: null, folderId: source.folderId ?? null, sourceRootPath: null, skippedReason: `无法读取文件：${error instanceof Error ? error.message : String(error)}` })
    }
  }
  return { files, albums }
}

function validatePlanTargets(sources: Source[]): void {
  for (const source of sources) {
    if (source.coserId && source.folderId) throw new Error('导入位置无效')
    if (source.coserId && !sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(source.coserId)) throw new Error('目标 Coser 不存在或已删除')
    if (source.folderId && !sqlite.prepare("SELECT 1 FROM folders WHERE id = ? AND trash_state = 'active'").get(source.folderId)) throw new Error('目标文件夹不存在或已在回收站')
  }
}

async function validateFolderSources(sources: Source[]): Promise<void> {
  for (const source of sources.filter((item) => item.kind === 'folder')) {
    let info
    try { info = await lstat(source.path) } catch { throw new Error(`拖入的文件夹已不可访问：${source.path}`) }
    if (info.isSymbolicLink()) throw new Error(`不支持导入目录链接：${source.path}`)
    if (!info.isDirectory()) throw new Error(`拖入的路径不再是文件夹：${source.path}`)
  }
}

async function planImport(sources: Source[]): Promise<ImportJobSummary> {
  if (!sources.length) throw new Error('没有可导入的文件或文件夹')
  validatePlanTargets(sources)
  await validateFolderSources(sources)
  const jobId = randomUUID()
  const now = Date.now()
  const sourceKind = sources.some((source) => source.kind === 'folder') ? 'folders' : 'files'
  const { files, albums } = await scanSources(sources, jobId)
  await validateFolderSources(sources)
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const insert = sqlite.transaction(() => {
    validatePlanTargets(sources)
    sqlite.prepare(`INSERT INTO import_jobs (id, source_kind, status, total_entries, total_bytes, created_at, queued_at, delete_sources_after_import) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)`).run(jobId, sourceKind, files.length, totalBytes, now, now, deleteSourcesAfterImport ? 1 : 0)
    const albumInsert = sqlite.prepare('INSERT INTO albums (id, title, folder_id, coser_id, created_at, updated_at) VALUES (@id, @title, @folderId, @coserId, @createdAt, @updatedAt)')
    albums.forEach((album) => albumInsert.run({ id: album.id, title: album.title, folderId: album.folderId ?? null, coserId: album.coserId, createdAt: now, updatedAt: now }))
    for (const coserId of new Set(albums.map((album) => album.coserId).filter((id): id is string => Boolean(id)))) sqlite.prepare('UPDATE cosers SET updated_at = ? WHERE id = ?').run(now, coserId)
    const entryInsert = sqlite.prepare(`INSERT INTO import_entries (id, job_id, source_path, relative_path, source_name, source_size, source_modified_at, media_kind, album_id, target_folder_id, status, error_code, error_message, created_at, completed_at, source_root_path, source_cleanup_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    files.forEach((file) => {
      const skipped = Boolean(file.skippedReason)
      entryInsert.run(randomUUID(), jobId, file.path, file.relativePath, file.name, file.size, Math.round(file.modifiedAt), file.kind, file.albumId, file.folderId, skipped ? 'skipped' : 'planned', skipped ? (isArchive(file.path) ? 'ARCHIVE_UNSUPPORTED' : 'SOURCE_UNREADABLE') : null, file.skippedReason ?? null, now, skipped ? now : null, file.sourceRootPath, 'not_requested')
    })
    sqlite.prepare("UPDATE import_jobs SET skipped_entries = ? WHERE id = ?").run(files.filter((file) => file.skippedReason).length, jobId)
  })
  insert()
  const job = getJobSummary(jobId)
  publish(jobId, true)
  scheduleQueue()
  return job
}

let planningQueue = Promise.resolve()
function enqueuePlanImport(sources: Source[]): Promise<ImportJobSummary> {
  const next = planningQueue.then(() => planImport(sources))
  planningQueue = next.then(() => undefined, () => undefined)
  return next
}

async function copyAndHash(sourcePath: string, tempPath: string): Promise<string> {
  const hash = createHash('sha256')
  const hashingTransform = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk) } })
  await pipeline(createReadStream(sourcePath), hashingTransform, createWriteStream(tempPath, { flags: 'wx' }))
  return hash.digest('hex')
}

async function withHashLock<T>(hash: string, task: () => Promise<T>): Promise<T> {
  const prior = hashLocks.get(hash) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = prior.then(() => current)
  hashLocks.set(hash, queued)
  await prior
  try { return await task() } finally { release(); if (hashLocks.get(hash) === queued) hashLocks.delete(hash) }
}

function trashObjectPath(hash: string, extension: string): string { return join(config.storagePath, 'trash', 'objects', hash.slice(0, 2), hash.slice(2, 4), `${hash}${extension}`) }
function thumbnailPath(hash: string, trashed = false): string { return join(config.storagePath, trashed ? 'trash' : 'thumbnails', ...(trashed ? ['thumbnails'] : []), `${hash}.webp`) }
function getStorageEligibility(): StorageEligibility {
  const mediaCount = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM media_items').get() as { count: number }).count)
  const albumCount = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM albums').get() as { count: number }).count)
  const folderCount = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM folders').get() as { count: number }).count)
  const coserCount = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM cosers').get() as { count: number }).count)
  const orphanCount = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM storage_orphans').get() as { count: number }).count)
  const pendingJobs = Number((sqlite.prepare("SELECT COUNT(*) AS count FROM import_jobs WHERE status IN ('planned', 'queued', 'running', 'partial_failed', 'interrupted')").get() as { count: number }).count)
  if (mediaCount || albumCount || folderCount || coserCount) return { canChangeResourceDirectory: false, reason: '当前图库已有 Coser、文件夹、媒体或图集，不能直接切换资源目录' }
  if (orphanCount) return { canChangeResourceDirectory: false, reason: '当前图库回收站中仍有未索引对象，不能切换资源目录' }
  if (pendingJobs) return { canChangeResourceDirectory: false, reason: '当前图库存在可恢复的导入任务，不能切换资源目录' }
  return { canChangeResourceDirectory: true, reason: null }
}
async function walkFiles(directory: string): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) results.push(...await walkFiles(path))
      else if (entry.isFile()) results.push(path)
    }
  } catch { return results }
  return results
}
async function recoverOrphanObjects(): Promise<void> {
  const objectRoot = join(config.storagePath, 'objects')
  const known = new Set((sqlite.prepare('SELECT object_path FROM media_items').all() as Array<{ object_path: string }>).map((row) => resolve(row.object_path)))
  const files = await walkFiles(objectRoot)
  for (const source of files) {
    if (known.has(resolve(source))) continue
    const id = randomUUID()
    const originalRelativePath = relative(objectRoot, source)
    const destination = join(config.storagePath, 'trash', 'orphans', `${id}-${basename(source)}`)
    await mkdir(join(destination, '..'), { recursive: true })
    await rename(source, destination)
    const now = Date.now()
    sqlite.prepare('INSERT INTO storage_orphans (id, original_relative_path, quarantined_path, byte_size, discovered_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, originalRelativePath, destination, Number((await stat(destination)).size), now, now + TRASH_RETENTION_MS)
  }
  // If a crash happened after rename but before the INSERT above, retain that
  // already-isolated file as an exportable orphan instead of losing track of it.
  const orphanRoot = join(config.storagePath, 'trash', 'orphans')
  const recorded = new Set((sqlite.prepare('SELECT quarantined_path FROM storage_orphans').all() as Array<{ quarantined_path: string }>).map((row) => resolve(row.quarantined_path)))
  for (const quarantinedPath of await walkFiles(orphanRoot)) {
    if (recorded.has(resolve(quarantinedPath))) continue
    const info = await stat(quarantinedPath)
    const filename = basename(quarantinedPath)
    const hasGeneratedPrefix = filename.length > 37 && filename[36] === '-'
    const id = hasGeneratedPrefix ? filename.slice(0, 36) : randomUUID()
    const originalRelativePath = hasGeneratedPrefix ? filename.slice(37) : filename
    const discoveredAt = Math.round(info.mtimeMs)
    sqlite.prepare('INSERT OR IGNORE INTO storage_orphans (id, original_relative_path, quarantined_path, byte_size, discovered_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, originalRelativePath, quarantinedPath, Number(info.size), discoveredAt, discoveredAt + TRASH_RETENTION_MS)
  }
}
async function exportOrphan(payload: unknown): Promise<TrashOperationResult> {
  const { orphanId, destinationDirectory } = payload as { orphanId: string; destinationDirectory: string }
  const row = sqlite.prepare('SELECT * FROM storage_orphans WHERE id = ?').get(orphanId) as { quarantined_path: string; original_relative_path: string } | undefined
  if (!row) return { succeeded: [], pending: [], failed: [{ id: orphanId, reason: '隔离文件不存在' }] }
  try {
    await mkdir(destinationDirectory, { recursive: true })
    await copyFile(row.quarantined_path, join(destinationDirectory, basename(row.original_relative_path)))
    return { succeeded: [orphanId], pending: [], failed: [] }
  } catch (error) { return { succeeded: [], pending: [orphanId], failed: [{ id: orphanId, reason: error instanceof Error ? error.message : String(error) }] } }
}
async function purgeOrphan(orphanId: string): Promise<void> {
  const orphan = sqlite.prepare('SELECT quarantined_path FROM storage_orphans WHERE id = ?').get(orphanId) as { quarantined_path: string } | undefined
  if (!orphan) return
  await rm(orphan.quarantined_path, { force: true })
  sqlite.prepare('DELETE FROM storage_orphans WHERE id = ?').run(orphanId)
}
async function moveIfPresent(source: string, destination: string): Promise<void> {
  const exists = await stat(source).then(() => true).catch(() => false)
  if (!exists) return
  await mkdir(join(destination, '..'), { recursive: true })
  const destinationExists = await stat(destination).then(() => true).catch(() => false)
  if (destinationExists) { await rm(source, { force: true }); return }
  await rename(source, destination)
}
function asMedia(row: Record<string, unknown>): LibraryMedia {
  const status = String(row.preview_status)
  const id = String(row.id)
  return {
    id,
    originalName: String(row.original_name),
    mediaKind: String(row.media_kind) as MediaKind,
    importedAt: Number(row.imported_at),
    previewUrl: previewUrl(String(row.content_hash), status),
    mediaUrl: `gallery-media://${id}`,
    previewStatus: status as LibraryMedia['previewStatus'],
    previewError: row.preview_error === null || row.preview_error === undefined ? null : String(row.preview_error)
  }
}
async function moveMediaToTrash(row: Record<string, unknown>): Promise<void> {
  const hash = String(row.content_hash); const extension = String(row.extension)
  await moveIfPresent(String(row.object_path), trashObjectPath(hash, extension))
  await moveIfPresent(thumbnailPath(hash), thumbnailPath(hash, true))
}
async function restoreMediaFiles(row: Record<string, unknown>): Promise<void> {
  const hash = String(row.content_hash); const extension = String(row.extension)
  await moveIfPresent(trashObjectPath(hash, extension), String(row.object_path))
  await moveIfPresent(thumbnailPath(hash, true), thumbnailPath(hash))
}
async function trashMedia(mediaId: string): Promise<void> {
  const row = sqlite.prepare("SELECT * FROM media_items WHERE id = ? AND trash_state IN ('active', 'pending_trash')").get(mediaId) as Record<string, unknown> | undefined
  if (!row) return
  sqlite.prepare("UPDATE media_items SET trash_state = 'pending_trash', trashed_at = ? WHERE id = ?").run(Date.now(), mediaId)
  await withHashLock(String(row.content_hash), async () => {
    await moveMediaToTrash(row)
    sqlite.prepare("UPDATE media_items SET trash_state = 'trashed' WHERE id = ?").run(mediaId)
  })
}
async function restoreMedia(mediaId: string): Promise<void> {
  const row = sqlite.prepare("SELECT * FROM media_items WHERE id = ? AND trash_state IN ('trashed', 'pending_restore')").get(mediaId) as Record<string, unknown> | undefined
  if (!row) return
  sqlite.prepare("UPDATE media_items SET trash_state = 'pending_restore' WHERE id = ?").run(mediaId)
  await withHashLock(String(row.content_hash), async () => {
    await restoreMediaFiles(row)
    const needsPreview = String(row.media_kind) === 'image' || String(row.media_kind) === 'video'
    sqlite.prepare("UPDATE media_items SET trash_state = 'active', trashed_at = NULL, preview_status = CASE WHEN ? THEN 'pending' ELSE preview_status END, preview_error = NULL WHERE id = ?").run(needsPreview ? 1 : 0, mediaId)
  })
}
async function runOperation(ids: string[], action: (id: string) => Promise<void>): Promise<TrashOperationResult> {
  const result: TrashOperationResult = { succeeded: [], pending: [], failed: [] }
  for (const id of ids) {
    try { await action(id); result.succeeded.push(id) } catch (error) { result.pending.push(id); result.failed.push({ id, reason: error instanceof Error ? error.message : String(error) }) }
  }
  return result
}
async function trashAlbum(albumId: string): Promise<TrashOperationResult> {
  const album = sqlite.prepare("SELECT id FROM albums WHERE id = ? AND trash_state IN ('active', 'pending_trash')").get(albumId) as { id: string } | undefined
  if (!album) return { succeeded: [], pending: [], failed: [] }
  const now = Date.now()
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE albums SET trash_state = 'pending_trash', trashed_at = ? WHERE id = ?").run(now, albumId)
    sqlite.prepare(`UPDATE media_items
      SET trash_state = 'pending_trash', trashed_at = ?
      WHERE id IN (SELECT media_id FROM album_items WHERE album_id = ?)
        AND trash_state = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id
          WHERE ai.media_id = media_items.id AND a.trash_state = 'active'
        )`).run(now, albumId)
  })()
  const ids = (sqlite.prepare("SELECT id FROM media_items WHERE id IN (SELECT media_id FROM album_items WHERE album_id = ?) AND trash_state = 'pending_trash'").all(albumId) as Array<{ id: string }>).map((item) => item.id)
  const result = await runOperation(ids, async (id) => {
    const row = sqlite.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as Record<string, unknown>
    await withHashLock(String(row.content_hash), async () => { await moveMediaToTrash(row); sqlite.prepare("UPDATE media_items SET trash_state = 'trashed' WHERE id = ?").run(id) })
  })
  finalizePendingAlbums()
  return result
}
async function restoreAlbum(albumId: string): Promise<TrashOperationResult> {
  const album = sqlite.prepare("SELECT id FROM albums WHERE id = ? AND trash_state IN ('trashed', 'pending_restore')").get(albumId) as { id: string } | undefined
  if (!album) return { succeeded: [], pending: [], failed: [] }
  sqlite.prepare("UPDATE albums SET trash_state = 'pending_restore' WHERE id = ?").run(albumId)
  const ids = (sqlite.prepare("SELECT id FROM media_items WHERE id IN (SELECT media_id FROM album_items WHERE album_id = ?) AND trash_state IN ('trashed', 'pending_restore')").all(albumId) as Array<{ id: string }>).map((item) => item.id)
  const result = await runOperation(ids, restoreMedia)
  finalizePendingAlbums()
  return result
}
async function purgeMedia(mediaId: string): Promise<void> {
  const row = sqlite.prepare("SELECT * FROM media_items WHERE id = ? AND trash_state = 'trashed'").get(mediaId) as Record<string, unknown> | undefined
  if (!row) return
  if (sqlite.prepare('SELECT 1 FROM album_items WHERE media_id = ? LIMIT 1').get(mediaId)) throw new Error('媒体仍被图集引用，不能永久删除')
  await withHashLock(String(row.content_hash), async () => {
    await rm(trashObjectPath(String(row.content_hash), String(row.extension)), { force: true })
    await rm(thumbnailPath(String(row.content_hash), true), { force: true })
    sqlite.prepare('DELETE FROM media_items WHERE id = ?').run(mediaId)
  })
}
async function purgeOrphanMedia(mediaId: string): Promise<void> {
  const referenced = sqlite.prepare('SELECT 1 FROM album_items WHERE media_id = ? LIMIT 1').get(mediaId)
  if (!referenced) await purgeMedia(mediaId)
}
async function purgeExpiredTrash(): Promise<void> {
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const folderIds = (sqlite.prepare(`SELECT id FROM folders
    WHERE trash_state = 'trashed' AND trashed_at <= ?
      AND (parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM folders parent WHERE parent.id = folders.parent_id AND parent.trash_state = 'trashed'))`).all(cutoff) as Array<{ id: string }>).map((item) => item.id)
  for (const folderId of folderIds) await purgeFolder(folderId)
  sqlite.prepare("DELETE FROM albums WHERE trash_state = 'trashed' AND trashed_at <= ?").run(cutoff)
  const ids = (sqlite.prepare(`SELECT m.id FROM media_items m
    WHERE m.trash_state = 'trashed' AND m.trashed_at <= ?
      AND NOT EXISTS (SELECT 1 FROM album_items ai WHERE ai.media_id = m.id)`).all(cutoff) as Array<{ id: string }>).map((item) => item.id)
  await runOperation(ids, purgeOrphanMedia)
  const expiredOrphans = sqlite.prepare('SELECT id, quarantined_path FROM storage_orphans WHERE expires_at <= ?').all(Date.now()) as Array<{ id: string; quarantined_path: string }>
  for (const orphan of expiredOrphans) { await rm(orphan.quarantined_path, { force: true }); sqlite.prepare('DELETE FROM storage_orphans WHERE id = ?').run(orphan.id) }
}
function finalizePendingAlbums(): void {
  sqlite.prepare(`UPDATE albums SET trash_state = 'trashed'
    WHERE trash_state = 'pending_trash' AND NOT EXISTS (
      SELECT 1 FROM album_items ai JOIN media_items m ON m.id = ai.media_id
      WHERE ai.album_id = albums.id AND m.trash_state = 'pending_trash'
    )`).run()
  sqlite.prepare(`UPDATE albums SET trash_state = 'active', trashed_at = NULL
    WHERE trash_state = 'pending_restore' AND NOT EXISTS (
      SELECT 1 FROM album_items ai JOIN media_items m ON m.id = ai.media_id
      WHERE ai.album_id = albums.id AND m.trash_state = 'pending_restore'
    )`).run()
}
function folderTree(folderId: string): string[] {
  return (sqlite.prepare(`WITH RECURSIVE tree(id) AS (
    SELECT id FROM folders WHERE id = ?
    UNION ALL SELECT child.id FROM folders child JOIN tree ON child.parent_id = tree.id
  ) SELECT id FROM tree`).all(folderId) as Array<{ id: string }>).map((row) => row.id)
}
function placeholders(ids: string[]): string { return ids.map(() => '?').join(', ') }
function finalizePendingFolders(): void {
  for (let depth = 0; depth < 3; depth += 1) {
    sqlite.prepare(`UPDATE folders SET trash_state = 'trashed'
      WHERE trash_state = 'pending_trash'
        AND NOT EXISTS (SELECT 1 FROM folders child WHERE child.parent_id = folders.id AND child.trash_state = 'pending_trash')
        AND NOT EXISTS (SELECT 1 FROM albums a WHERE a.folder_id = folders.id AND a.trash_state = 'pending_trash')
        AND NOT EXISTS (SELECT 1 FROM media_items m WHERE m.folder_id = folders.id AND m.trash_state = 'pending_trash')`).run()
    sqlite.prepare(`UPDATE folders SET trash_state = 'active', trashed_at = NULL
      WHERE trash_state = 'pending_restore'
        AND NOT EXISTS (SELECT 1 FROM folders child WHERE child.parent_id = folders.id AND child.trash_state = 'pending_restore')
        AND NOT EXISTS (SELECT 1 FROM albums a WHERE a.folder_id = folders.id AND a.trash_state = 'pending_restore')
        AND NOT EXISTS (SELECT 1 FROM media_items m WHERE m.folder_id = folders.id AND m.trash_state = 'pending_restore')`).run()
  }
}
async function trashFolder(folderId: string): Promise<TrashOperationResult> {
  const folder = sqlite.prepare("SELECT id FROM folders WHERE id = ? AND trash_state IN ('active', 'pending_trash')").get(folderId) as { id: string } | undefined
  if (!folder) return { succeeded: [], pending: [], failed: [] }
  const ids = folderTree(folderId); const marks = placeholders(ids); const now = Date.now()
  sqlite.prepare(`UPDATE folders SET trash_state = 'pending_trash', trashed_at = ? WHERE id IN (${marks})`).run(now, ...ids)
  const albumIds = (sqlite.prepare(`SELECT id FROM albums WHERE folder_id IN (${marks}) AND trash_state IN ('active', 'pending_trash')`).all(...ids) as Array<{ id: string }>).map((row) => row.id)
  const mediaIds = (sqlite.prepare(`SELECT id FROM media_items WHERE folder_id IN (${marks}) AND trash_state IN ('active', 'pending_trash')
    AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = media_items.id AND a.trash_state = 'active')`).all(...ids) as Array<{ id: string }>).map((row) => row.id)
  const result: TrashOperationResult = { succeeded: [], pending: [], failed: [] }
  for (const albumId of albumIds) { const outcome = await trashAlbum(albumId); result.succeeded.push(...outcome.succeeded); result.pending.push(...outcome.pending); result.failed.push(...outcome.failed) }
  const mediaOutcome = await runOperation(mediaIds, trashMedia); result.succeeded.push(...mediaOutcome.succeeded); result.pending.push(...mediaOutcome.pending); result.failed.push(...mediaOutcome.failed)
  finalizePendingFolders()
  if (sqlite.prepare("SELECT 1 FROM folders WHERE id = ? AND trash_state = 'trashed'").get(folderId)) result.succeeded.push(folderId)
  else result.pending.push(folderId)
  return result
}
async function restoreFolder(folderId: string): Promise<TrashOperationResult> {
  const folder = sqlite.prepare("SELECT id FROM folders WHERE id = ? AND trash_state IN ('trashed', 'pending_restore')").get(folderId) as { id: string } | undefined
  if (!folder) return { succeeded: [], pending: [], failed: [] }
  const ids = folderTree(folderId); const marks = placeholders(ids)
  sqlite.prepare(`UPDATE folders SET trash_state = 'pending_restore' WHERE id IN (${marks})`).run(...ids)
  const albumIds = (sqlite.prepare(`SELECT id FROM albums WHERE folder_id IN (${marks}) AND trash_state IN ('trashed', 'pending_restore')`).all(...ids) as Array<{ id: string }>).map((row) => row.id)
  const mediaIds = (sqlite.prepare(`SELECT id FROM media_items WHERE folder_id IN (${marks}) AND trash_state IN ('trashed', 'pending_restore')
    AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = media_items.id AND a.trash_state = 'active')`).all(...ids) as Array<{ id: string }>).map((row) => row.id)
  const result: TrashOperationResult = { succeeded: [], pending: [], failed: [] }
  for (const albumId of albumIds) { const outcome = await restoreAlbum(albumId); result.succeeded.push(...outcome.succeeded); result.pending.push(...outcome.pending); result.failed.push(...outcome.failed) }
  const mediaOutcome = await runOperation(mediaIds, restoreMedia); result.succeeded.push(...mediaOutcome.succeeded); result.pending.push(...mediaOutcome.pending); result.failed.push(...mediaOutcome.failed)
  finalizePendingFolders()
  if (sqlite.prepare("SELECT 1 FROM folders WHERE id = ? AND trash_state = 'active'").get(folderId)) result.succeeded.push(folderId)
  else result.pending.push(folderId)
  return result
}
async function purgeFolder(folderId: string): Promise<TrashOperationResult> {
  const folder = sqlite.prepare("SELECT id FROM folders WHERE id = ? AND trash_state = 'trashed'").get(folderId) as { id: string } | undefined
  if (!folder) return { succeeded: [], pending: [], failed: [] }
  const ids = folderTree(folderId); const marks = placeholders(ids)
  const albumIds = (sqlite.prepare(`SELECT id FROM albums WHERE folder_id IN (${marks}) AND trash_state = 'trashed'`).all(...ids) as Array<{ id: string }>).map((row) => row.id)
  const directMediaIds = (sqlite.prepare(`SELECT id FROM media_items WHERE folder_id IN (${marks}) AND trash_state = 'trashed'`).all(...ids) as Array<{ id: string }>).map((row) => row.id)
  const result: TrashOperationResult = { succeeded: [], pending: [], failed: [] }
  for (const albumId of albumIds) {
    const albumMedia = (sqlite.prepare("SELECT id FROM media_items WHERE id IN (SELECT media_id FROM album_items WHERE album_id = ?) AND trash_state = 'trashed'").all(albumId) as Array<{ id: string }>).map((row) => row.id)
    sqlite.prepare("DELETE FROM albums WHERE id = ? AND trash_state = 'trashed'").run(albumId)
    const outcome = await runOperation(albumMedia, purgeOrphanMedia); result.succeeded.push(...outcome.succeeded, albumId); result.pending.push(...outcome.pending); result.failed.push(...outcome.failed)
  }
  const directOutcome = await runOperation(directMediaIds, purgeMedia); result.succeeded.push(...directOutcome.succeeded); result.pending.push(...directOutcome.pending); result.failed.push(...directOutcome.failed)
  if (!sqlite.prepare(`SELECT 1 FROM albums WHERE folder_id IN (${marks}) UNION ALL SELECT 1 FROM media_items WHERE folder_id IN (${marks}) LIMIT 1`).get(...ids, ...ids)) {
    sqlite.prepare(`DELETE FROM folders WHERE id IN (${marks})`).run(...ids)
    result.succeeded.push(folderId)
  } else result.pending.push(folderId)
  return result
}
async function recoverTrashOperations(): Promise<void> {
  const pendingTrash = (sqlite.prepare("SELECT id FROM media_items WHERE trash_state = 'pending_trash'").all() as Array<{ id: string }>).map((item) => item.id)
  await runOperation(pendingTrash, async (id) => {
    const row = sqlite.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as Record<string, unknown>
    await withHashLock(String(row.content_hash), async () => { await moveMediaToTrash(row); sqlite.prepare("UPDATE media_items SET trash_state = 'trashed' WHERE id = ?").run(id) })
  })
  const pendingRestore = (sqlite.prepare("SELECT id FROM media_items WHERE trash_state = 'pending_restore'").all() as Array<{ id: string }>).map((item) => item.id)
  await runOperation(pendingRestore, restoreMedia)
  finalizePendingAlbums()
  finalizePendingFolders()
  await purgeExpiredTrash()
}

function incrementJob(jobId: string, kind: 'imported' | 'duplicate' | 'failed'): void {
  const field = kind === 'imported' ? 'imported_entries' : kind === 'duplicate' ? 'duplicate_entries' : 'failed_entries'
  sqlite.prepare(`UPDATE import_jobs SET processed_entries = processed_entries + 1, ${field} = ${field} + 1 WHERE id = ?`).run(jobId)
}

async function processEntry(entry: Record<string, unknown>, jobId: string): Promise<void> {
  const entryId = String(entry.id)
  const sourcePath = String(entry.source_path)
  const extension = extname(sourcePath).toLowerCase()
  const tempDirectory = join(config.storagePath, 'tmp')
  const tempPath = join(tempDirectory, `${entryId}.partial`)
  const deleteSource = Boolean((sqlite.prepare('SELECT delete_sources_after_import FROM import_jobs WHERE id = ?').get(jobId) as { delete_sources_after_import?: number } | undefined)?.delete_sources_after_import)
  try {
    const sourceInfo = await stat(sourcePath)
    if (sourceInfo.size !== Number(entry.source_size) || Math.round(sourceInfo.mtimeMs) !== Number(entry.source_modified_at)) throw new Error('源文件在扫描后发生变化，请重新创建导入任务')
    sqlite.prepare("UPDATE import_entries SET status = 'hashing' WHERE id = ?").run(entryId)
    await mkdir(tempDirectory, { recursive: true })
    sqlite.prepare("UPDATE import_entries SET status = 'copying' WHERE id = ?").run(entryId)
    const hash = await copyAndHash(sourcePath, tempPath)
    const imported = await withHashLock(hash, async () => {
      const existing = sqlite.prepare('SELECT * FROM media_items WHERE content_hash = ?').get(hash) as Record<string, unknown> | undefined
      const now = Date.now()
      if (existing) {
        await rm(tempPath, { force: true })
        if (String(existing.trash_state) !== 'active') {
          await restoreMediaFiles(existing)
          const needsPreview = String(existing.media_kind) === 'image' || String(existing.media_kind) === 'video'
          sqlite.prepare("UPDATE media_items SET trash_state = 'active', trashed_at = NULL, preview_status = CASE WHEN ? THEN 'pending' ELSE preview_status END, preview_error = NULL WHERE id = ?").run(needsPreview ? 1 : 0, existing.id)
        }
        const persistDuplicate = sqlite.transaction(() => {
          sqlite.prepare("UPDATE import_entries SET status = 'duplicate', content_hash = ?, media_id = ?, completed_at = ?, source_cleanup_status = ? WHERE id = ?").run(hash, existing.id, now, deleteSource ? 'pending' : 'not_requested', entryId)
          const albumId = entry.album_id as string | null
          if (albumId) {
            sqlite.prepare('INSERT OR IGNORE INTO album_items (album_id, media_id, sort_order) VALUES (?, ?, ?)').run(albumId, existing.id, now)
            sqlite.prepare("UPDATE media_items SET folder_id = NULL WHERE id = ? AND trash_state = 'active'").run(existing.id)
          }
          else if (entry.target_folder_id && !sqlite.prepare("SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = ? AND a.trash_state = 'active' LIMIT 1").get(existing.id)) sqlite.prepare("UPDATE media_items SET folder_id = ?, coser_id = NULL WHERE id = ? AND trash_state = 'active'").run(entry.target_folder_id, existing.id)
          incrementJob(jobId, 'duplicate')
        })
        persistDuplicate()
        return true
      }
      const objectDirectory = join(config.storagePath, 'objects', hash.slice(0, 2), hash.slice(2, 4))
      const objectPath = join(objectDirectory, `${hash}${extension}`)
      await mkdir(objectDirectory, { recursive: true })
      try { await rename(tempPath, objectPath) } catch (error) {
        const alreadyWritten = await stat(objectPath).then(() => true).catch(() => false)
        if (!alreadyWritten) throw error
        await rm(tempPath, { force: true })
      }
      const mediaId = randomUUID()
      const persistImport = sqlite.transaction(() => {
        const needsPreview = entry.media_kind === 'image' || entry.media_kind === 'video'
        const albumId = entry.album_id as string | null
        const folderId = albumId ? null : (entry.target_folder_id as string | null)
        sqlite.prepare('INSERT INTO media_items (id, content_hash, media_kind, original_name, extension, byte_size, object_path, imported_at, preview_status, preview_priority, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(mediaId, hash, entry.media_kind, entry.source_name, extension, entry.source_size, objectPath, now, needsPreview ? 'pending' : 'not_requested', needsPreview ? 0 : 100, folderId)
        sqlite.prepare("UPDATE import_entries SET status = 'imported', content_hash = ?, media_id = ?, completed_at = ?, source_cleanup_status = ? WHERE id = ?").run(hash, mediaId, now, deleteSource ? 'pending' : 'not_requested', entryId)
        if (albumId) {
          sqlite.prepare('INSERT OR IGNORE INTO album_items (album_id, media_id, sort_order) VALUES (?, ?, ?)').run(albumId, mediaId, now)
          sqlite.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now, albumId)
        }
        incrementJob(jobId, 'imported')
      })
      persistImport()
      return true
    })
    if (imported && deleteSource) await disposeSourceForEntry(entry, jobId)
  } catch (error) {
    await rm(tempPath, { force: true })
    const message = error instanceof Error ? error.message : String(error)
    const persistFailure = sqlite.transaction(() => {
      sqlite.prepare("UPDATE import_entries SET status = 'failed', error_code = 'IMPORT_FAILED', error_message = ?, completed_at = ? WHERE id = ?").run(message, Date.now(), entryId)
      incrementJob(jobId, 'failed')
    })
    persistFailure()
  } finally { publish(jobId) }
}

async function processPendingSourceDisposals(jobId: string): Promise<void> {
  const entries = sqlite.prepare(`SELECT * FROM import_entries
    WHERE job_id = ? AND status IN ('imported', 'duplicate') AND source_cleanup_status = 'pending'
    `).all(jobId) as Record<string, unknown>[]
  entries.sort(compareImportEntries)
  for (const entry of entries) await disposeSourceForEntry(entry, jobId)
}
async function runJob(jobId: string): Promise<void> {
  try {
    sqlite.prepare("UPDATE import_jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?").run(Date.now(), jobId)
    publish(jobId, true)
    await processPendingSourceDisposals(jobId)
    const entries = sqlite.prepare("SELECT * FROM import_entries WHERE job_id = ? AND status = 'planned'").all(jobId) as Record<string, unknown>[]
    entries.sort(compareImportEntries)
    for (const entry of entries) await processEntry(entry, jobId)
    const job = getJobSummary(jobId)
    sqlite.prepare("UPDATE import_jobs SET status = ?, completed_at = ? WHERE id = ?").run(job.failedEntries || job.sourceCleanupFailedEntries ? 'partial_failed' : 'completed', Date.now(), jobId)
    publish(jobId, true)
  } catch (error) {
    sqlite.prepare("UPDATE import_jobs SET status = 'partial_failed', completed_at = ? WHERE id = ?").run(Date.now(), jobId)
    publish(jobId, true)
    throw error
  }
}

function scheduleQueue(): void {
  if (queueScheduled || queuePumping) return
  queueScheduled = true
  queueMicrotask(() => { queueScheduled = false; void pumpQueue() })
}
async function pumpQueue(): Promise<void> {
  if (queuePumping) return
  queuePumping = true
  try {
    while (true) {
      const next = sqlite.prepare("SELECT id FROM import_jobs WHERE status = 'queued' ORDER BY queued_at, created_at, id LIMIT 1").get() as { id: string } | undefined
      if (!next) return
      try { await runJob(next.id) }
      catch { /* The job already records its terminal failure state. */ }
    }
  } finally {
    queuePumping = false
    if (sqlite.prepare("SELECT 1 FROM import_jobs WHERE status = 'queued' LIMIT 1").get()) scheduleQueue()
  }
}

function getJobSummary(jobId: string): ImportJobSummary {
  const row = sqlite.prepare('SELECT * FROM import_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined
  if (!row) throw new Error('导入任务不存在')
  return jobSummary(row)
}
function getJobs(): ImportJobSummary[] { return (sqlite.prepare('SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 20').all() as Record<string, unknown>[]).map(jobSummary) }
function getJob(jobId: string): ImportJobDetail {
  const job = getJobSummary(jobId)
  const entries = sqlite.prepare('SELECT id, source_path, source_name, relative_path, source_size, media_kind, status, error_code, error_message, source_cleanup_status, source_cleanup_error FROM import_entries WHERE job_id = ?').all(jobId) as Record<string, unknown>[]
  entries.sort(compareImportEntries)
  return { ...job, entries: entries.map((entry) => ({ id: String(entry.id), sourceName: String(entry.source_name), relativePath: String(entry.relative_path), sourceSize: Number(entry.source_size), mediaKind: String(entry.media_kind) as MediaKind, status: String(entry.status) as ImportEntryStatus, errorCode: entry.error_code === null ? null : String(entry.error_code), errorMessage: entry.error_message === null ? null : String(entry.error_message), sourceCleanupStatus: String(entry.source_cleanup_status) as 'not_requested' | 'pending' | 'trashed' | 'failed', sourceCleanupError: entry.source_cleanup_error === null ? null : String(entry.source_cleanup_error) })) }
}
function previewUrl(hash: string, status: string): string | null { return status === 'ready' ? `gallery-thumb://${hash}` : null }
type AlbumSummaryRow = { id: string; title: string; updated_at: number; media_count: number; cover_hash: string | null; cover_status: string | null }
function getAlbumSummaries(where: string, parameters: unknown[]): AlbumSummary[] {
  const albums = sqlite.prepare(`SELECT a.id, a.title, a.updated_at, COUNT(m.id) AS media_count,
    (SELECT m.content_hash FROM album_items ai2 JOIN media_items m ON m.id = ai2.media_id
      WHERE ai2.album_id = a.id AND m.media_kind IN ('image', 'video') AND m.trash_state = 'active' ORDER BY ai2.sort_order, ai2.media_id LIMIT 1) AS cover_hash
    , (SELECT m.preview_status FROM album_items ai2 JOIN media_items m ON m.id = ai2.media_id
      WHERE ai2.album_id = a.id AND m.media_kind IN ('image', 'video') AND m.trash_state = 'active' ORDER BY ai2.sort_order, ai2.media_id LIMIT 1) AS cover_status
    FROM albums a LEFT JOIN album_items ai ON ai.album_id = a.id LEFT JOIN media_items m ON m.id = ai.media_id AND m.trash_state = 'active'
    WHERE a.trash_state = 'active' AND ${where} GROUP BY a.id ORDER BY a.updated_at DESC`).all(...parameters) as AlbumSummaryRow[]
  return albums.map((album) => ({
    id: album.id,
    title: album.title,
    mediaCount: Number(album.media_count),
    updatedAt: Number(album.updated_at),
    coverPreviewUrl: album.cover_hash && album.cover_status === 'ready' ? previewUrl(album.cover_hash, 'ready') : null,
    coverPreviewPending: album.cover_status === 'pending' || album.cover_status === 'generating'
  }))
}
function getFolderAlbumSummaries(folderId: string | null): AlbumSummary[] { return getAlbumSummaries('a.folder_id IS ? AND a.coser_id IS NULL', [folderId]) }
function getCoserAlbumSummaries(coserId: string): AlbumSummary[] { return getAlbumSummaries('a.coser_id = ?', [coserId]) }
function getFolderSummaries(parentId: string | null): FolderSummary[] {
  const rows = sqlite.prepare(`SELECT f.id, f.title, f.parent_id, f.updated_at,
    (SELECT COUNT(*) FROM folders child WHERE child.parent_id = f.id AND child.trash_state = 'active') AS folder_count,
    (SELECT COUNT(*) FROM albums a WHERE a.folder_id = f.id AND a.coser_id IS NULL AND a.trash_state = 'active') AS album_count,
    (SELECT COUNT(*) FROM media_items m WHERE m.folder_id = f.id AND m.coser_id IS NULL AND m.trash_state = 'active'
      AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = m.id AND a.trash_state = 'active')) AS media_count
    FROM folders f WHERE f.parent_id IS ? AND f.trash_state = 'active' ORDER BY f.updated_at DESC, f.title COLLATE NOCASE`).all(parentId) as Array<{ id: string; title: string; parent_id: string | null; updated_at: number; folder_count: number; album_count: number; media_count: number }>
  return rows.map((row) => ({ id: row.id, title: row.title, parentId: row.parent_id, updatedAt: Number(row.updated_at), folderCount: Number(row.folder_count), albumCount: Number(row.album_count), mediaCount: Number(row.media_count) }))
}
function getFolderTree(): FolderTreeNode[] {
  const folders = sqlite.prepare(`SELECT f.id, f.title, f.parent_id,
      (SELECT COUNT(*) FROM folders child WHERE child.parent_id = f.id AND child.trash_state = 'active') +
      (SELECT COUNT(*) FROM albums a WHERE a.folder_id = f.id AND a.coser_id IS NULL AND a.trash_state = 'active') +
      (SELECT COUNT(*) FROM media_items m WHERE m.folder_id = f.id AND m.coser_id IS NULL AND m.trash_state = 'active'
        AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = m.id AND a.trash_state = 'active')) AS item_count
    FROM folders f WHERE f.trash_state = 'active'`).all() as Array<{ id: string; title: string; parent_id: string | null; item_count: number }>
  type MutableNode = Omit<FolderTreeNode, 'children'> & { children: MutableNode[] }
  const nodes = new Map<string, MutableNode>(folders.map((folder) => [folder.id, {
    id: folder.id,
    title: folder.title,
    parentId: folder.parent_id,
    itemCount: Number(folder.item_count),
    children: []
  }]))
  const roots: MutableNode[] = []
  nodes.forEach((node) => {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  })
  const stripNode = (node: MutableNode): FolderTreeNode => ({
    id: node.id,
    title: node.title,
    parentId: node.parentId,
    itemCount: node.itemCount,
    children: node.children.map(stripNode)
  })
  return roots.map(stripNode)
}
function getLibrary(): LibrarySnapshot {
  const counts = sqlite.prepare("SELECT media_kind, COUNT(*) AS count FROM media_items WHERE trash_state = 'active' GROUP BY media_kind").all() as Array<{ media_kind: MediaKind; count: number }>
  const byKind = new Map(counts.map((row) => [row.media_kind, Number(row.count)]))
  const looseMedia = sqlite.prepare(`SELECT m.id, m.original_name, m.media_kind, m.imported_at, m.content_hash, m.preview_status, m.preview_error FROM media_items m WHERE m.trash_state = 'active' AND m.folder_id IS NULL AND m.coser_id IS NULL AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = m.id AND a.trash_state = 'active') ORDER BY m.imported_at DESC LIMIT 100`).all() as Record<string, unknown>[]
  const images = byKind.get('image') ?? 0; const videos = byKind.get('video') ?? 0; const files = byKind.get('file') ?? 0
  return { totals: { all: images + videos + files, images, videos, files }, folders: getFolderSummaries(null), albums: getFolderAlbumSummaries(null), looseMedia: looseMedia.map(asMedia) }
}
function normalizeCoserName(value: unknown): { value: string; key: string } {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!name || name.length > 80) throw new Error('请输入 1 到 80 个字符的 Coser 名称')
  return { value: name, key: name.toLocaleLowerCase() }
}
function normalizeAliases(value: unknown, primaryKey: string): Array<{ value: string; key: string }> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('别名格式无效')
  const keys = new Set([primaryKey])
  return value.map((alias) => normalizeCoserName(alias)).map((alias) => {
    if (keys.has(alias.key)) throw new Error('别名不能重复或与主名称相同')
    keys.add(alias.key)
    return alias
  })
}
function assertCoserNamesAvailable(names: Array<{ key: string }>, excludedId: string | null = null): void {
  const candidateKeys = names.map((name) => name.key)
  if (!candidateKeys.length) return
  const marks = placeholders(candidateKeys)
  const existing = sqlite.prepare(`SELECT id FROM cosers WHERE name_key IN (${marks}) UNION SELECT coser_id AS id FROM coser_aliases WHERE alias_key IN (${marks})`).all(...candidateKeys, ...candidateKeys) as Array<{ id: string }>
  if (existing.some((row) => row.id !== excludedId)) throw new Error('名称或别名已被其他 Coser 使用')
}
type CoserRow = { id: string; name: string; updated_at: number; avatar_updated_at: number | null }

function coserSummaries(rows: CoserRow[]): CoserSummary[] {
  if (!rows.length) return []
  const ids = rows.map((row) => row.id)
  const marks = placeholders(ids)

  let startedAt = performance.now()
  const aliases = sqlite.prepare(`SELECT coser_id, alias FROM coser_aliases WHERE coser_id IN (${marks}) ORDER BY coser_id, created_at, alias COLLATE NOCASE`).all(...ids) as Array<{ coser_id: string; alias: string }>
  reportCoserDatabaseTime('Coser aliases', startedAt)

  startedAt = performance.now()
  const counts = sqlite.prepare(`WITH target_cosers AS (
      SELECT id FROM cosers WHERE id IN (${marks})
    ), album_counts AS (
      SELECT a.coser_id, COUNT(*) AS n FROM albums a JOIN target_cosers c ON c.id = a.coser_id
      WHERE a.trash_state = 'active' GROUP BY a.coser_id
    ), video_counts AS (
      SELECT m.coser_id, COUNT(*) AS n FROM media_items m JOIN target_cosers c ON c.id = m.coser_id
      WHERE m.media_kind = 'video' AND m.trash_state = 'active'
        AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = m.id AND a.trash_state = 'active')
      GROUP BY m.coser_id
    ), coser_media AS (
      SELECT m.coser_id, m.id FROM media_items m JOIN target_cosers c ON c.id = m.coser_id WHERE m.trash_state = 'active'
      UNION
      SELECT a.coser_id, m.id FROM albums a JOIN target_cosers c ON c.id = a.coser_id
      JOIN album_items ai ON ai.album_id = a.id JOIN media_items m ON m.id = ai.media_id
      WHERE a.trash_state = 'active' AND m.trash_state = 'active'
    ), media_counts AS (
      SELECT coser_id, COUNT(*) AS n FROM coser_media GROUP BY coser_id
    )
    SELECT c.id, COALESCE(ac.n, 0) AS album_count, COALESCE(vc.n, 0) AS video_count, COALESCE(mc.n, 0) AS media_count
    FROM target_cosers c LEFT JOIN album_counts ac ON ac.coser_id = c.id
    LEFT JOIN video_counts vc ON vc.coser_id = c.id LEFT JOIN media_counts mc ON mc.coser_id = c.id`).all(...ids) as Array<{ id: string; album_count: number; video_count: number; media_count: number }>
  reportCoserDatabaseTime('Coser aggregate counts', startedAt)

  const aliasesByCoser = new Map<string, string[]>()
  for (const alias of aliases) {
    const list = aliasesByCoser.get(alias.coser_id) ?? []
    list.push(alias.alias)
    aliasesByCoser.set(alias.coser_id, list)
  }
  const countsByCoser = new Map(counts.map((count) => [count.id, count]))
  return rows.map((row) => {
    const count = countsByCoser.get(row.id)
    return {
      id: row.id,
      name: row.name,
      aliases: aliasesByCoser.get(row.id) ?? [],
      avatarUrl: row.avatar_updated_at === null ? null : `gallery-coser-avatar://${row.id}?v=${row.avatar_updated_at}`,
      albumCount: Number(count?.album_count ?? 0),
      videoCount: Number(count?.video_count ?? 0),
      mediaCount: Number(count?.media_count ?? 0),
      updatedAt: Number(row.updated_at)
    }
  })
}
function getCoserVideos(coserId: string): LibraryMedia[] {
  return (sqlite.prepare(`SELECT m.* FROM media_items m WHERE m.coser_id = ? AND m.media_kind = 'video' AND m.trash_state = 'active'
    AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = m.id AND a.trash_state = 'active')
    ORDER BY m.imported_at DESC, m.id`).all(coserId) as Record<string, unknown>[]).map(asMedia)
}
function getSmartCoserIndex(): Array<{ id: string; name: string; aliases: string[] }> {
  const cosers = sqlite.prepare('SELECT id, name FROM cosers ORDER BY name COLLATE NOCASE').all() as Array<{ id: string; name: string }>
  if (!cosers.length) return []
  const aliases = sqlite.prepare('SELECT coser_id, alias FROM coser_aliases ORDER BY alias COLLATE NOCASE').all() as Array<{ coser_id: string; alias: string }>
  const grouped = new Map<string, string[]>()
  for (const row of aliases) {
    const list = grouped.get(row.coser_id) ?? []
    list.push(row.alias)
    grouped.set(row.coser_id, list)
  }
  return cosers.map((coser) => ({ ...coser, aliases: grouped.get(coser.id) ?? [] }))
}
function smartCoserSignature(payload: unknown): string {
  const signature = typeof (payload as { signature?: unknown })?.signature === 'string' ? (payload as { signature: string }).signature : ''
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw new Error('智能归类缓存标识无效')
  return signature
}
function getSmartCoserMapping(payload: unknown): string | null {
  const row = sqlite.prepare('SELECT coser_id FROM smart_coser_folder_mappings WHERE mapping_key = ?').get(smartCoserSignature(payload)) as { coser_id: string } | undefined
  return row?.coser_id ?? null
}
function getSmartCoserMappings(payload: unknown): Record<string, string> {
  const signatures = [...new Set(Array.isArray(payload) ? payload.filter((value): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)).slice(0, 500) : [])]
  if (!signatures.length) return {}
  const rows = sqlite.prepare(`SELECT mapping_key, coser_id FROM smart_coser_folder_mappings WHERE mapping_key IN (${placeholders(signatures)})`).all(...signatures) as Array<{ mapping_key: string; coser_id: string }>
  return Object.fromEntries(rows.map((row) => [row.mapping_key, row.coser_id]))
}
function saveSmartCoserMapping(payload: unknown): void {
  const data = payload as { signature?: unknown; coserId?: unknown }
  const signature = smartCoserSignature(payload)
  if (typeof data?.coserId !== 'string' || !sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(data.coserId)) throw new Error('目标 Coser 不存在或已删除')
  sqlite.prepare('INSERT INTO smart_coser_folder_mappings (mapping_key, coser_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(mapping_key) DO UPDATE SET coser_id = excluded.coser_id, updated_at = excluded.updated_at').run(signature, data.coserId, Date.now())
}
function getSmartCoserModelCache(payload: unknown): string | null {
  const row = sqlite.prepare('SELECT result_json FROM smart_coser_model_cache WHERE cache_key = ?').get(smartCoserSignature(payload)) as { result_json: string } | undefined
  return row?.result_json ?? null
}
function saveSmartCoserModelCache(payload: unknown): void {
  const data = payload as { signature?: unknown; result?: unknown }
  if (typeof data?.result !== 'string' || data.result.length > 8000) throw new Error('模型归类结果无效')
  sqlite.prepare('INSERT INTO smart_coser_model_cache (cache_key, result_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET result_json = excluded.result_json, updated_at = excluded.updated_at').run(smartCoserSignature(payload), data.result, Date.now())
}
function getCosers(): CoserSummary[] {
  const startedAt = performance.now()
  const rows = sqlite.prepare('SELECT id, name, updated_at, avatar_updated_at FROM cosers ORDER BY updated_at DESC, name COLLATE NOCASE').all() as CoserRow[]
  reportCoserDatabaseTime('Coser list rows', startedAt)
  const summaries = coserSummaries(rows)
  reportCoserDatabaseTime('get-cosers total', startedAt)
  return summaries
}
function getCoser(coserId: string): CoserDetail {
  const startedAt = performance.now()
  const row = sqlite.prepare('SELECT id, name, updated_at, avatar_updated_at FROM cosers WHERE id = ?').get(coserId) as CoserRow | undefined
  if (!row) throw new Error('Coser 不存在')
  const summary = coserSummaries([row])[0]!
  const albumsStartedAt = performance.now()
  const albums = getCoserAlbumSummaries(coserId)
  reportCoserDatabaseTime('Coser detail albums', albumsStartedAt)
  const videosStartedAt = performance.now()
  const videos = getCoserVideos(coserId)
  reportCoserDatabaseTime('Coser detail videos', videosStartedAt)
  reportCoserDatabaseTime('get-coser total', startedAt)
  return { ...summary, albums, videos }
}
function getCoserAvatarMedia(coserId: string): LibraryMedia[] {
  if (!sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(coserId)) throw new Error('Coser 不存在')
  const media = sqlite.prepare(`SELECT m.id, m.original_name, m.media_kind, m.imported_at, m.content_hash, m.preview_status, m.preview_error
    FROM albums a JOIN album_items ai ON ai.album_id = a.id JOIN media_items m ON m.id = ai.media_id
    WHERE a.coser_id = ? AND a.trash_state = 'active' AND m.trash_state = 'active' AND m.media_kind = 'image'
    ORDER BY a.updated_at DESC, ai.sort_order, m.imported_at DESC`).all(coserId) as Record<string, unknown>[]
  return media.map(asMedia)
}
function setCoserAvatar(payload: unknown): void {
  const data = payload as { id?: unknown; updatedAt?: unknown }
  const id = typeof data?.id === 'string' ? data.id : ''
  const updatedAt = data?.updatedAt === null ? null : Number(data?.updatedAt)
  if (updatedAt !== null && (!Number.isSafeInteger(updatedAt) || updatedAt <= 0)) throw new Error('头像版本无效')
  if (!sqlite.prepare('UPDATE cosers SET avatar_updated_at = ?, updated_at = ? WHERE id = ?').run(updatedAt, Date.now(), id).changes) throw new Error('Coser 不存在')
}
function createCoser(payload: unknown): CoserSummary {
  const data = payload as { name?: unknown; aliases?: unknown }
  const name = normalizeCoserName(data?.name)
  const aliases = normalizeAliases(data?.aliases, name.key)
  assertCoserNamesAvailable([name, ...aliases])
  const id = randomUUID(); const now = Date.now()
  sqlite.transaction(() => {
    sqlite.prepare('INSERT INTO cosers (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name.value, name.key, now, now)
    const insertAlias = sqlite.prepare('INSERT INTO coser_aliases (id, coser_id, alias, alias_key, created_at) VALUES (?, ?, ?, ?, ?)')
    aliases.forEach((alias) => insertAlias.run(randomUUID(), id, alias.value, alias.key, now))
  })()
  return getCoser(id)
}
function updateCoser(payload: unknown): CoserSummary {
  const data = payload as { id?: unknown; name?: unknown; aliases?: unknown }
  const id = typeof data?.id === 'string' ? data.id : ''
  if (!sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(id)) throw new Error('Coser 不存在')
  const name = normalizeCoserName(data.name)
  const aliases = normalizeAliases(data.aliases, name.key)
  assertCoserNamesAvailable([name, ...aliases], id)
  const now = Date.now()
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE cosers SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').run(name.value, name.key, now, id)
    sqlite.prepare('DELETE FROM coser_aliases WHERE coser_id = ?').run(id)
    const insertAlias = sqlite.prepare('INSERT INTO coser_aliases (id, coser_id, alias, alias_key, created_at) VALUES (?, ?, ?, ?, ?)')
    aliases.forEach((alias) => insertAlias.run(randomUUID(), id, alias.value, alias.key, now))
  })()
  return getCoser(id)
}
function deleteCoser(coserId: string): void {
  const now = Date.now()
  sqlite.transaction(() => {
    if (!sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(coserId)) throw new Error('Coser 不存在')
    sqlite.prepare('UPDATE albums SET coser_id = NULL, updated_at = ? WHERE coser_id = ?').run(now, coserId)
    sqlite.prepare('DELETE FROM cosers WHERE id = ?').run(coserId)
  })()
}
function assignAlbumCoser(payload: unknown): void {
  const data = payload as { albumId?: unknown; coserId?: unknown }
  const albumId = typeof data?.albumId === 'string' ? data.albumId : ''
  const coserId = typeof data?.coserId === 'string' ? data.coserId : ''
  if (!sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(coserId)) throw new Error('目标 Coser 不存在')
  const now = Date.now()
  sqlite.transaction(() => {
    if (!sqlite.prepare("UPDATE albums SET coser_id = ?, folder_id = NULL, updated_at = ? WHERE id = ? AND trash_state = 'active'").run(coserId, now, albumId).changes) throw new Error('图集不存在或已在回收站')
    sqlite.prepare('UPDATE cosers SET updated_at = ? WHERE id = ?').run(now, coserId)
  })()
}
function unassignAlbumCoser(albumId: string): void {
  if (!sqlite.prepare("UPDATE albums SET coser_id = NULL, updated_at = ? WHERE id = ? AND coser_id IS NOT NULL AND trash_state = 'active'").run(Date.now(), albumId).changes) throw new Error('图集不存在、未归入 Coser 或已在回收站')
}
function createFolder(payload: unknown): FolderSummary {
  const { title, parentId } = payload as { title: string; parentId: string | null }
  const normalizedTitle = typeof title === 'string' ? title.trim() : ''
  if (!normalizedTitle || normalizedTitle.length > 120) throw new Error('请输入 1 到 120 个字符的文件夹名称')
  const normalizedParent = parentId === null || parentId === undefined ? null : String(parentId)
  if (normalizedParent) {
    const parent = sqlite.prepare("SELECT parent_id FROM folders WHERE id = ? AND trash_state = 'active'").get(normalizedParent) as { parent_id: string | null } | undefined
    if (!parent) throw new Error('目标文件夹不存在或已在回收站')
    if (parent.parent_id !== null) throw new Error('最多只能创建两层文件夹')
  }
  const now = Date.now(); const id = randomUUID()
  sqlite.transaction(() => {
    sqlite.prepare('INSERT INTO folders (id, title, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, normalizedTitle, normalizedParent, now, now)
    if (normalizedParent) sqlite.prepare('UPDATE folders SET updated_at = ? WHERE id = ?').run(now, normalizedParent)
  })()
  return { id, title: normalizedTitle, parentId: normalizedParent, updatedAt: now, folderCount: 0, albumCount: 0, mediaCount: 0 }
}
function moveAlbum(payload: unknown): void {
  const { albumId, folderId } = payload as { albumId: string; folderId: string | null }
  const target = folderId === null ? null : String(folderId)
  if (target && !sqlite.prepare("SELECT 1 FROM folders WHERE id = ? AND trash_state = 'active'").get(target)) throw new Error('目标文件夹不存在或已在回收站')
  const changed = sqlite.prepare("UPDATE albums SET folder_id = ?, coser_id = NULL, updated_at = ? WHERE id = ? AND trash_state = 'active'").run(target, Date.now(), String(albumId))
  if (!changed.changes) throw new Error('图集不存在或已在回收站')
}
function moveMedia(payload: unknown): void {
  const { mediaId, folderId } = payload as { mediaId: string; folderId: string | null }
  const target = folderId === null ? null : String(folderId)
  if (target && !sqlite.prepare("SELECT 1 FROM folders WHERE id = ? AND trash_state = 'active'").get(target)) throw new Error('目标文件夹不存在或已在回收站')
  if (sqlite.prepare("SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = ? AND a.trash_state = 'active' LIMIT 1").get(String(mediaId))) throw new Error('已有图集关联的媒体请通过移动图集分类')
  const changed = sqlite.prepare("UPDATE media_items SET folder_id = ?, coser_id = NULL WHERE id = ? AND trash_state = 'active'").run(target, String(mediaId))
  if (!changed.changes) throw new Error('媒体不存在或已在回收站')
}
function getFolder(folderId: string): FolderDetail {
  const folder = sqlite.prepare("SELECT id, title, parent_id, updated_at FROM folders WHERE id = ? AND trash_state = 'active'").get(folderId) as { id: string; title: string; parent_id: string | null; updated_at: number } | undefined
  if (!folder) throw new Error('文件夹不存在或已在回收站')
  const breadcrumbs: Array<{ id: string; title: string }> = []
  let current: typeof folder | undefined = folder
  while (current) { breadcrumbs.unshift({ id: current.id, title: current.title }); current = current.parent_id ? sqlite.prepare("SELECT id, title, parent_id, updated_at FROM folders WHERE id = ? AND trash_state = 'active'").get(current.parent_id) as typeof folder | undefined : undefined }
  const media = sqlite.prepare(`SELECT id, original_name, media_kind, imported_at, content_hash, preview_status, preview_error FROM media_items
    WHERE folder_id = ? AND coser_id IS NULL AND trash_state = 'active'
      AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = media_items.id AND a.trash_state = 'active')
    ORDER BY imported_at DESC`).all(folderId) as Record<string, unknown>[]
  return { id: folder.id, title: folder.title, parentId: folder.parent_id, updatedAt: Number(folder.updated_at), folderCount: getFolderSummaries(folderId).length, albumCount: getFolderAlbumSummaries(folderId).length, mediaCount: media.length, breadcrumbs, folders: getFolderSummaries(folderId), albums: getFolderAlbumSummaries(folderId), media: media.map(asMedia) }
}
function getAlbum(albumId: string): AlbumDetail {
  const album = sqlite.prepare("SELECT id, title, folder_id, updated_at FROM albums WHERE id = ? AND trash_state = 'active'").get(albumId) as { id: string; title: string; folder_id: string | null; updated_at: number } | undefined
  if (!album) throw new Error('图集不存在或已在回收站')
  const media = sqlite.prepare("SELECT m.id, m.original_name, m.media_kind, m.imported_at, m.content_hash, m.preview_status, m.preview_error FROM album_items ai JOIN media_items m ON m.id = ai.media_id WHERE ai.album_id = ? AND m.trash_state = 'active' ORDER BY ai.sort_order").all(albumId) as Record<string, unknown>[]
  return { id: album.id, title: album.title, folderId: album.folder_id, updatedAt: Number(album.updated_at), media: media.map(asMedia) }
}

function playbackDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T } catch { return fallback }
}

function getPlaybackState(): PlaybackStats {
  const state = sqlite.prepare('SELECT * FROM playback_state WHERE id = 1').get() as Record<string, unknown>
  const queue = safeJson<PlaybackQueueEntryState[]>(state.queue_json, [])
  const progressRows = sqlite.prepare('SELECT * FROM playback_media_progress ORDER BY last_watched_at DESC').all() as Record<string, unknown>[]
  const progress: PlaybackMediaProgress[] = progressRows.map((row) => ({
    entryId: String(row.entry_id), mediaId: String(row.media_id), watchedMs: Number(row.watched_ms),
    imageElapsedMs: Number(row.image_elapsed_ms), videoPositionMs: Number(row.video_position_ms), videoDurationMs: Number(row.video_duration_ms),
    videoRanges: safeJson(row.video_ranges_json, []), lastWatchedAt: row.last_watched_at === null ? null : Number(row.last_watched_at)
  }))
  const achievements = sqlite.prepare('SELECT id, earned_at FROM playback_achievements ORDER BY earned_at').all() as Array<{ id: string; earned_at: number }>
  const days: PlaybackStats['days'] = []
  const now = new Date()
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    const date = playbackDateKey(day.getTime())
    const row = sqlite.prepare('SELECT watched_ms FROM playback_days WHERE date = ?').get(date) as { watched_ms: number } | undefined
    days.push({ date, watchedMs: Number(row?.watched_ms ?? 0) })
  }
  const totalWatchedMs = Number(state.total_watched_ms)
  const xp = playbackXpFor(totalWatchedMs)
  return {
    totalWatchedMs, xp, ...playbackLevel(xp), imageIntervalSeconds: Number(state.image_interval_seconds), loop: Number(state.loop_enabled) === 1,
    queue, cursorEntryId: typeof state.cursor_entry_id === 'string' ? state.cursor_entry_id : null,
    cursorMediaId: typeof state.cursor_media_id === 'string' ? state.cursor_media_id : null,
    progress, achievements: achievements.map((row): PlaybackAchievement => ({ id: row.id, earnedAt: Number(row.earned_at) })),
    lastPlayedEntryId: typeof state.last_entry_id === 'string' ? state.last_entry_id : null,
    lastPlayedMediaId: typeof state.last_media_id === 'string' ? state.last_media_id : null, days
  }
}

function getPlaybackMedia(payload: unknown): LibraryMedia[] {
  if (!Array.isArray(payload)) return []
  const ids = [...new Set(payload.filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))].slice(0, 10_000)
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = sqlite.prepare(`SELECT id, original_name, media_kind, imported_at, content_hash, preview_status, preview_error FROM media_items WHERE id IN (${placeholders}) AND trash_state = 'active' AND media_kind IN ('image', 'video')`).all(...ids) as Record<string, unknown>[]
  return rows.map(asMedia)
}

function savePlaybackState(payload: unknown): PlaybackStats {
  const value = payload as { queue?: unknown; cursorEntryId?: unknown; cursorMediaId?: unknown; imageIntervalSeconds?: unknown; loop?: unknown }
  if (!value || !Array.isArray(value.queue) || value.queue.length > 1000) throw new Error('播放队列数据无效')
  const seenEntries = new Set<string>()
  const queue: PlaybackQueueEntryState[] = value.queue.map((entry: unknown) => {
    const item = entry as Record<string, unknown>
    const entryId = typeof item?.entryId === 'string' ? item.entryId.slice(0, 200) : ''
    if (!entryId || seenEntries.has(entryId)) throw new Error('队列包含无效或重复的条目')
    seenEntries.add(entryId)
    if (item.type === 'album' && typeof item.albumId === 'string') {
      const sortOrder = item.sortOrder === 'importedAt' ? 'importedAt' : 'filename'
      const mediaIds = Array.isArray(item.mediaIds) ? [...new Set(item.mediaIds.filter((id): id is string => typeof id === 'string'))].slice(0, 100_000) : []
      return { entryId, type: 'album', albumId: item.albumId.slice(0, 200), title: String(item.title ?? '图包').slice(0, 500), sortOrder, mediaIds }
    }
    if (item.type === 'media' && typeof item.mediaId === 'string') return { entryId, type: 'media', mediaId: item.mediaId.slice(0, 200), title: String(item.title ?? '媒体').slice(0, 500), source: String(item.source ?? '媒体').slice(0, 500) }
    throw new Error('播放队列包含未知的条目类型')
  })
  const interval = Math.min(120, Math.max(1, Math.floor(Number(value.imageIntervalSeconds) || 5)))
  const cursorEntryId = typeof value.cursorEntryId === 'string' && seenEntries.has(value.cursorEntryId) ? value.cursorEntryId : null
  const cursorMediaId = typeof value.cursorMediaId === 'string' ? value.cursorMediaId.slice(0, 200) : null
  sqlite.prepare('UPDATE playback_state SET queue_json = ?, cursor_entry_id = ?, cursor_media_id = ?, image_interval_seconds = ?, loop_enabled = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(queue), cursorEntryId, cursorMediaId, interval, value.loop === false ? 0 : 1, Date.now())
  return getPlaybackState()
}

function awardPlaybackAchievement(id: string, earnedAt: number): void {
  sqlite.prepare('INSERT OR IGNORE INTO playback_achievements (id, earned_at) VALUES (?, ?)').run(id, earnedAt)
}

function awardAlbumCompletion(albumId: string, now: number): void {
  const rows = sqlite.prepare("SELECT m.id, m.media_kind FROM album_items ai JOIN media_items m ON m.id = ai.media_id WHERE ai.album_id = ? AND m.trash_state = 'active' AND m.media_kind IN ('image', 'video')").all(albumId) as Array<{ id: string; media_kind: 'image' | 'video' }>
  if (!rows.length) return
  const progressById = new Map((sqlite.prepare('SELECT media_id, watched_ms, video_duration_ms, video_ranges_json FROM playback_media_progress WHERE entry_id = ?').all(`album:${albumId}`) as Array<Record<string, unknown>>).map((row) => [String(row.media_id), row]))
  const complete = rows.every((media) => {
    const item = progressById.get(media.id)
    if (!item) return false
    return playbackMediaComplete(media.media_kind, Number(item.watched_ms), safeJson(item.video_ranges_json, []), Number(item.video_duration_ms))
  })
  if (!complete) return
  const first = sqlite.prepare('INSERT OR IGNORE INTO playback_completed_albums (album_id, completed_at) VALUES (?, ?)').run(albumId, now)
  if (first.changes) awardPlaybackAchievement('first-album', now)
  const completed = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM playback_completed_albums').get() as { count: number }).count)
  if (completed >= 10) awardPlaybackAchievement('ten-albums', now)
}

function applyPlaybackCheckpoint(payload: unknown): PlaybackStats {
  const checkpoint = payload as PlaybackCheckpoint
  if (!checkpoint || typeof checkpoint.sessionId !== 'string' || checkpoint.sessionId.length > 200 || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 1) throw new Error('观看记录会话无效')
  if (!Number.isFinite(checkpoint.watchedDeltaMs) || checkpoint.watchedDeltaMs < 0 || checkpoint.watchedDeltaMs > 10_000 || !Array.isArray(checkpoint.media) || checkpoint.media.length > 100) throw new Error('观看记录时间无效')
  const existing = sqlite.prepare('SELECT sequence FROM playback_sessions WHERE id = ?').get(checkpoint.sessionId) as { sequence: number } | undefined
  if (existing && existing.sequence >= checkpoint.sequence) return getPlaybackState()
  const now = Date.now()
  const transaction = sqlite.transaction(() => {
    let appliedMs = 0
    const updateMedia = sqlite.prepare(`INSERT INTO playback_media_progress (entry_id, media_id, watched_ms, image_elapsed_ms, video_position_ms, video_duration_ms, video_ranges_json, last_watched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id, media_id) DO UPDATE SET
        watched_ms = watched_ms + excluded.watched_ms, image_elapsed_ms = excluded.image_elapsed_ms,
        video_position_ms = excluded.video_position_ms, video_duration_ms = MAX(video_duration_ms, excluded.video_duration_ms),
        video_ranges_json = excluded.video_ranges_json, last_watched_at = excluded.last_watched_at`)
    for (const item of checkpoint.media) {
      if (!item || typeof item.entryId !== 'string' || typeof item.mediaId !== 'string') continue
      const delta = Math.min(10_000, Math.max(0, Math.floor(Number(item.watchedDeltaMs) || 0)))
      const watchedAt = Number.isFinite(item.watchedAt) ? Math.min(now, Math.max(0, Math.floor(item.watchedAt))) : now
      const entryId = item.entryId.slice(0, 200)
      const mediaId = item.mediaId.slice(0, 200)
      const previous = sqlite.prepare('SELECT video_ranges_json FROM playback_media_progress WHERE entry_id = ? AND media_id = ?').get(entryId, mediaId) as { video_ranges_json: string } | undefined
      const oldRanges = safeJson<PlaybackVideoRange[]>(previous?.video_ranges_json, [])
      const videoRanges = Array.isArray(item.videoRanges) ? item.videoRanges : []
      const ranges = videoRanges.reduce((all, range) => mergePlaybackRanges(all, range), oldRanges)
      updateMedia.run(entryId, mediaId, delta, Math.max(0, Math.floor(Number(item.imageElapsedMs) || 0)), Math.max(0, Math.floor(Number(item.positionMs) || 0)), Math.max(0, Math.floor(Number(item.durationMs) || 0)), JSON.stringify(ranges), watchedAt)
      appliedMs += delta
    }
    if (appliedMs > 0) {
      sqlite.prepare('UPDATE playback_state SET total_watched_ms = total_watched_ms + ?, xp_remainder_ms = (xp_remainder_ms + ?) % 10000, updated_at = ?, cursor_entry_id = ?, cursor_media_id = ?, last_entry_id = ?, last_media_id = ? WHERE id = 1')
        .run(appliedMs, appliedMs, now, checkpoint.media.at(-1)?.entryId ?? null, checkpoint.media.at(-1)?.mediaId ?? null, checkpoint.media.at(-1)?.entryId ?? null, checkpoint.media.at(-1)?.mediaId ?? null)
      sqlite.prepare('INSERT INTO playback_days (date, watched_ms) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET watched_ms = watched_ms + excluded.watched_ms')
        .run(playbackDateKey(now), appliedMs)
      if (Number((sqlite.prepare('SELECT total_watched_ms AS value FROM playback_state WHERE id = 1').get() as { value: number }).value) >= 3_600_000) awardPlaybackAchievement('one-hour', now)
      for (const item of checkpoint.media) if (item.entryId.startsWith('album:') && item.watchedDeltaMs > 0) awardAlbumCompletion(item.entryId.slice('album:'.length), now)
    }
    sqlite.prepare('INSERT INTO playback_sessions (id, sequence, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence, updated_at = excluded.updated_at')
      .run(checkpoint.sessionId, checkpoint.sequence, now)
  })
  transaction()
  return getPlaybackState()
}
function getMediaPath(mediaId: string): string {
  const media = sqlite.prepare("SELECT object_path FROM media_items WHERE id = ? AND trash_state = 'active'").get(mediaId) as { object_path: string } | undefined
  if (!media) throw new Error('媒体不存在或不可查看')
  return validatedMediaPath(media.object_path)
}
function getCoserAvatarSource(payload: unknown): string {
  const data = payload as { coserId?: unknown; mediaId?: unknown }
  const coserId = typeof data?.coserId === 'string' ? data.coserId : ''
  const mediaId = typeof data?.mediaId === 'string' ? data.mediaId : ''
  const media = sqlite.prepare(`SELECT m.object_path FROM albums a JOIN album_items ai ON ai.album_id = a.id JOIN media_items m ON m.id = ai.media_id
    WHERE a.coser_id = ? AND a.trash_state = 'active' AND m.id = ? AND m.trash_state = 'active' AND m.media_kind = 'image'`).get(coserId, mediaId) as { object_path: string } | undefined
  if (!media) throw new Error('头像来源不是当前 Coser 图包中的可用图片')
  return validatedMediaPath(media.object_path)
}
function validatedMediaPath(objectPathValue: string): string {
  const objectsRoot = resolve(config.storagePath, 'objects')
  const objectPath = resolve(objectPathValue)
  const relation = relative(objectsRoot, objectPath)
  if (!relation || relation.startsWith('..') || /^[\\/]/.test(relation)) throw new Error('媒体不存在或不可查看')
  return objectPath
}
function getTrash(): TrashSnapshot {
  const expiresAt = (trashedAt: number) => trashedAt + TRASH_RETENTION_MS
  const media = sqlite.prepare(`SELECT id, original_name, media_kind, trashed_at, trash_state FROM media_items
    WHERE trash_state IN ('trashed', 'pending_trash', 'pending_restore')
      AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = media_items.folder_id AND f.trash_state IN ('trashed', 'pending_trash', 'pending_restore'))
      AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id JOIN folders f ON f.id = a.folder_id
        WHERE ai.media_id = media_items.id AND a.trash_state IN ('trashed', 'pending_trash', 'pending_restore') AND f.trash_state IN ('trashed', 'pending_trash', 'pending_restore'))
    ORDER BY trashed_at DESC`).all() as Array<{ id: string; original_name: string; media_kind: MediaKind; trashed_at: number; trash_state: TrashItem['state'] }>
  const albums = sqlite.prepare(`SELECT a.id, a.title, a.trashed_at, a.trash_state, COUNT(ai.media_id) AS media_count FROM albums a
    LEFT JOIN album_items ai ON ai.album_id = a.id
    WHERE a.trash_state IN ('trashed', 'pending_trash', 'pending_restore')
      AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = a.folder_id AND f.trash_state IN ('trashed', 'pending_trash', 'pending_restore'))
    GROUP BY a.id ORDER BY a.trashed_at DESC`).all() as Array<{ id: string; title: string; trashed_at: number; trash_state: TrashItem['state']; media_count: number }>
  const folders = sqlite.prepare(`SELECT f.id, f.title, f.trashed_at, f.trash_state,
    (SELECT COUNT(*) FROM media_items m WHERE m.folder_id = f.id) + (SELECT COUNT(*) FROM albums a WHERE a.folder_id = f.id) AS media_count
    FROM folders f WHERE f.trash_state IN ('trashed', 'pending_trash', 'pending_restore')
      AND NOT EXISTS (SELECT 1 FROM folders parent WHERE parent.id = f.parent_id AND parent.trash_state IN ('trashed', 'pending_trash', 'pending_restore'))
    ORDER BY f.trashed_at DESC`).all() as Array<{ id: string; title: string; trashed_at: number; trash_state: TrashItem['state']; media_count: number }>
  const orphans = sqlite.prepare('SELECT id, original_relative_path, discovered_at, expires_at FROM storage_orphans ORDER BY discovered_at DESC').all() as Array<{ id: string; original_relative_path: string; discovered_at: number; expires_at: number }>
  const items: TrashItem[] = [
    ...albums.map((album) => ({ entityType: 'album' as const, id: album.id, title: album.title, mediaKind: null, trashedAt: Number(album.trashed_at), expiresAt: expiresAt(Number(album.trashed_at)), mediaCount: Number(album.media_count), state: album.trash_state, failureReason: album.trash_state === 'trashed' ? null : '操作尚未完成，可再次点击继续处理' })),
    ...folders.map((folder) => ({ entityType: 'folder' as const, id: folder.id, title: folder.title, mediaKind: null, trashedAt: Number(folder.trashed_at), expiresAt: expiresAt(Number(folder.trashed_at)), mediaCount: Number(folder.media_count), state: folder.trash_state, failureReason: folder.trash_state === 'trashed' ? null : '操作尚未完成，可再次点击继续处理' })),
    ...media.map((item) => ({ entityType: 'media' as const, id: item.id, title: item.original_name, mediaKind: item.media_kind, trashedAt: Number(item.trashed_at), expiresAt: expiresAt(Number(item.trashed_at)), mediaCount: 1, state: item.trash_state, failureReason: item.trash_state === 'trashed' ? null : '操作尚未完成，可再次点击继续处理' })),
    ...orphans.map((orphan) => ({ entityType: 'orphan' as const, id: orphan.id, title: orphan.original_relative_path, mediaKind: null, trashedAt: orphan.discovered_at, expiresAt: orphan.expires_at, mediaCount: 1, state: 'trashed' as const, failureReason: null }))
  ]
  return { items: items.sort((a, b) => b.trashedAt - a.trashedAt) }
}
function prepareRetry(jobId: string): ImportJobSummary {
  const retry = sqlite.transaction(() => {
    sqlite.prepare("UPDATE import_entries SET status = 'planned', error_code = NULL, error_message = NULL, completed_at = NULL WHERE job_id = ? AND status IN ('hashing', 'copying', 'failed')").run(jobId)
    sqlite.prepare("UPDATE import_entries SET source_cleanup_status = 'pending', source_cleanup_error = NULL WHERE job_id = ? AND status IN ('imported', 'duplicate') AND source_cleanup_status = 'failed'").run(jobId)
    const counts = sqlite.prepare(`SELECT
      SUM(CASE WHEN status IN ('imported', 'duplicate', 'failed') THEN 1 ELSE 0 END) AS processed,
      SUM(CASE WHEN status = 'imported' THEN 1 ELSE 0 END) AS imported,
      SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END) AS duplicate,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
      FROM import_entries WHERE job_id = ?`).get(jobId) as Record<string, number | null>
    sqlite.prepare("UPDATE import_jobs SET status = 'queued', queued_at = ?, processed_entries = ?, imported_entries = ?, duplicate_entries = ?, failed_entries = ?, skipped_entries = ?, source_cleanup_failed_entries = 0, completed_at = NULL WHERE id = ?").run(Date.now(), Number(counts.processed ?? 0), Number(counts.imported ?? 0), Number(counts.duplicate ?? 0), Number(counts.failed ?? 0), Number(counts.skipped ?? 0), jobId)
  })
  retry()
  return getJobSummary(jobId)
}

async function cleanTemporaryFiles(): Promise<void> {
  const directory = join(config.storagePath, 'tmp')
  try {
    const entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' })
    await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.partial')).map((entry) => rm(join(directory, entry.name), { force: true })))
  } catch { return }
}
async function recoverImportJobs(): Promise<void> {
  await cleanTemporaryFiles()
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE import_entries SET status = 'planned', error_code = NULL, error_message = NULL, completed_at = NULL WHERE status IN ('hashing', 'copying')").run()
    sqlite.prepare(`UPDATE import_jobs
      SET status = 'queued', completed_at = NULL,
          queued_at = CASE WHEN queued_at = 0 THEN created_at ELSE queued_at END
      WHERE status IN ('planned', 'queued', 'running', 'interrupted')`).run()
  })()
}
const startupRecovery = (async () => {
  await recoverImportJobs()
  await recoverTrashOperations()
})()
const startup = startupRecovery.then(async () => {
  await recoverOrphanObjects()
  scheduleQueue()
})
// Requests that only read indexed media can be served while the orphan scan is
// walking the object directory. Keep the rejection observable to writes while
// marking it handled in case no write is attempted during this session.
void startup.catch(() => undefined)
const readDuringOrphanScan = new Set<Request['command']>([
  'get-jobs', 'get-job', 'get-library', 'get-folder-tree', 'get-album', 'get-folder',
  'get-media-path', 'get-coser-avatar-media', 'get-coser-avatar-source', 'get-cosers', 'get-coser', 'get-playback-state', 'get-playback-media',
  'get-smart-coser-index', 'get-smart-coser-mapping', 'get-smart-coser-mappings', 'get-smart-coser-model-cache'
])

parent.on('message', (request: Request) => {
  if (request.command === 'source-disposal-result') {
    const result = request.payload as SourceDisposalResult
    const resolveDisposal = pendingSourceDisposals.get(result.entryId)
    if (resolveDisposal) { pendingSourceDisposals.delete(result.entryId); resolveDisposal(result) }
    return
  }
  void (async () => {
    try {
      await (readDuringOrphanScan.has(request.command) ? startupRecovery : startup)
      if (!request.id) throw new Error('请求缺少标识')
      if (request.command === 'plan') reply(request.id, await enqueuePlanImport(request.payload as Source[]))
      else if (request.command === 'get-jobs') reply(request.id, getJobs())
      else if (request.command === 'get-job') reply(request.id, getJob(String(request.payload)))
      else if (request.command === 'get-library') reply(request.id, getLibrary())
      else if (request.command === 'get-playback-state') reply(request.id, getPlaybackState())
      else if (request.command === 'get-playback-media') reply(request.id, getPlaybackMedia(request.payload))
      else if (request.command === 'save-playback-state') reply(request.id, savePlaybackState(request.payload))
      else if (request.command === 'playback-checkpoint') reply(request.id, applyPlaybackCheckpoint(request.payload))
      else if (request.command === 'get-folder-tree') reply(request.id, getFolderTree())
      else if (request.command === 'get-album') reply(request.id, getAlbum(String(request.payload)))
      else if (request.command === 'get-media-path') reply(request.id, getMediaPath(String(request.payload)))
      else if (request.command === 'get-coser-avatar-media') reply(request.id, getCoserAvatarMedia(String(request.payload)))
      else if (request.command === 'get-coser-avatar-source') reply(request.id, getCoserAvatarSource(request.payload))
      else if (request.command === 'get-folder') reply(request.id, getFolder(String(request.payload)))
      else if (request.command === 'create-folder') reply(request.id, createFolder(request.payload))
      else if (request.command === 'move-media') { moveMedia(request.payload); reply(request.id, true) }
      else if (request.command === 'move-album') { moveAlbum(request.payload); reply(request.id, true) }
      else if (request.command === 'get-cosers') reply(request.id, getCosers())
      else if (request.command === 'get-smart-coser-index') reply(request.id, getSmartCoserIndex())
      else if (request.command === 'get-smart-coser-mapping') reply(request.id, getSmartCoserMapping(request.payload))
      else if (request.command === 'get-smart-coser-mappings') reply(request.id, getSmartCoserMappings(request.payload))
      else if (request.command === 'set-smart-coser-mapping') { saveSmartCoserMapping(request.payload); reply(request.id, null) }
      else if (request.command === 'get-smart-coser-model-cache') reply(request.id, getSmartCoserModelCache(request.payload))
      else if (request.command === 'set-smart-coser-model-cache') { saveSmartCoserModelCache(request.payload); reply(request.id, null) }
      else if (request.command === 'get-coser') reply(request.id, getCoser(String(request.payload)))
      else if (request.command === 'create-coser') reply(request.id, createCoser(request.payload))
      else if (request.command === 'update-coser') reply(request.id, updateCoser(request.payload))
      else if (request.command === 'set-coser-avatar') { setCoserAvatar(request.payload); reply(request.id, true) }
      else if (request.command === 'delete-coser') { deleteCoser(String(request.payload)); reply(request.id, true) }
      else if (request.command === 'assign-videos-coser') { const data = request.payload as { mediaIds?: unknown; coserId?: unknown }; const result = videoCoserAssignment.assign(data?.mediaIds, data?.coserId); coserAssignment.invalidate(); reply(request.id, result) }
      else if (request.command === 'undo-video-coser-assignment') { videoCoserAssignment.undo(String(request.payload)); reply(request.id, null) }
      else if (request.command === 'unassign-video-coser') {
        if (!sqlite.prepare("UPDATE media_items SET coser_id = NULL, folder_id = NULL WHERE id = ? AND media_kind = 'video' AND coser_id IS NOT NULL AND trash_state = 'active'").run(String(request.payload)).changes) throw new Error('视频不存在、未归入 Coser 或已在回收站')
        reply(request.id, null)
      }
      else if (request.command === 'assign-albums-coser') { const data = request.payload as { albumIds?: unknown; coserId?: unknown }; const result = coserAssignment.assign(data?.albumIds, data?.coserId); videoCoserAssignment.invalidate(); reply(request.id, result) }
      else if (request.command === 'undo-album-coser-assignment') { coserAssignment.undo(String(request.payload)); reply(request.id, true) }
      else if (request.command === 'assign-album-coser') { assignAlbumCoser(request.payload); reply(request.id, true) }
      else if (request.command === 'unassign-album-coser') { unassignAlbumCoser(String(request.payload)); reply(request.id, true) }
      else if (request.command === 'get-trash') reply(request.id, getTrash())
      else if (request.command === 'get-storage-eligibility') reply(request.id, getStorageEligibility())
      else if (request.command === 'export-orphan') reply(request.id, await exportOrphan(request.payload))
      else if (request.command === 'retry') { const jobId = String(request.payload); const job = prepareRetry(jobId); publish(jobId, true); scheduleQueue(); reply(request.id, job) }
      else if (request.command === 'set-delete-sources-after-import') { deleteSourcesAfterImport = Boolean(request.payload); reply(request.id, true) }
      else if (request.command === 'trash-media') reply(request.id, await runOperation([String(request.payload)], trashMedia))
      else if (request.command === 'trash-album') reply(request.id, await trashAlbum(String(request.payload)))
      else if (request.command === 'trash-folder') reply(request.id, await trashFolder(String(request.payload)))
      else if (request.command === 'restore-media') reply(request.id, await runOperation([String(request.payload)], restoreMedia))
      else if (request.command === 'restore-album') reply(request.id, await restoreAlbum(String(request.payload)))
      else if (request.command === 'restore-folder') reply(request.id, await restoreFolder(String(request.payload)))
      else if (request.command === 'purge-trash') reply(request.id, await runOperation([String(request.payload)], purgeMedia))
      else if (request.command === 'purge-album') {
        const albumId = String(request.payload)
        const ids = (sqlite.prepare("SELECT id FROM media_items WHERE id IN (SELECT media_id FROM album_items WHERE album_id = ?) AND trash_state = 'trashed'").all(albumId) as Array<{ id: string }>).map((item) => item.id)
        sqlite.prepare("DELETE FROM albums WHERE id = ? AND trash_state = 'trashed'").run(albumId)
        const result = await runOperation(ids, purgeOrphanMedia)
        reply(request.id, { ...result, succeeded: [...result.succeeded, albumId] })
      }
      else if (request.command === 'purge-folder') reply(request.id, await purgeFolder(String(request.payload)))
      else if (request.command === 'purge-orphan') reply(request.id, await runOperation([String(request.payload)], purgeOrphan))
      else if (request.command === 'purge-all-trash') {
        const folderIds = (sqlite.prepare("SELECT id FROM folders WHERE trash_state = 'trashed' AND (parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM folders parent WHERE parent.id = folders.parent_id AND parent.trash_state = 'trashed'))").all() as Array<{ id: string }>).map((item) => item.id)
        const folderResult: TrashOperationResult = { succeeded: [], pending: [], failed: [] }
        for (const folderId of folderIds) { const outcome = await purgeFolder(folderId); folderResult.succeeded.push(...outcome.succeeded); folderResult.pending.push(...outcome.pending); folderResult.failed.push(...outcome.failed) }
        const ids = (sqlite.prepare("SELECT id FROM media_items WHERE trash_state = 'trashed'").all() as Array<{ id: string }>).map((item) => item.id)
        const orphanIds = (sqlite.prepare('SELECT id FROM storage_orphans').all() as Array<{ id: string }>).map((item) => item.id)
        sqlite.prepare("DELETE FROM albums WHERE trash_state = 'trashed'").run()
        const mediaResult = await runOperation(ids, purgeMedia)
        const orphanResult = await runOperation(orphanIds, purgeOrphan)
        reply(request.id, { succeeded: [...folderResult.succeeded, ...mediaResult.succeeded, ...orphanResult.succeeded], pending: [...folderResult.pending, ...mediaResult.pending, ...orphanResult.pending], failed: [...folderResult.failed, ...mediaResult.failed, ...orphanResult.failed] })
      }
    } catch (error) {
      const diagnostic = error instanceof Error ? error : new Error(String(error))
      console.error('[import-worker] Request failed', {
        command: request.command,
        requestId: request.id,
        name: diagnostic.name,
        message: diagnostic.message,
        stack: diagnostic.stack
      })
      if (request.id) replyError(request.id, diagnostic)
    }
  })()
})
setInterval(() => { void purgeExpiredTrash() }, 24 * 60 * 60 * 1000).unref()
