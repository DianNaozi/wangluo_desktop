import { createHash, randomUUID } from 'node:crypto'
import { cpus } from 'node:os'
import { basename, extname, join, relative, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, opendir, readdir, rename, rm, stat, lstat } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { createDatabase } from './database'
import type { AlbumDetail, ImportEntryStatus, ImportJobDetail, ImportJobSummary, ImportProgressEvent, LibraryMedia, LibrarySnapshot, MediaKind, StorageEligibility, TrashItem, TrashOperationResult, TrashSnapshot } from './types'

type WorkerConfig = { databasePath: string; storagePath: string; deleteSourcesAfterImport?: boolean }
type Source = { path: string; kind: 'file' | 'folder' }
type Request = { id?: string; command: 'plan' | 'get-jobs' | 'get-job' | 'get-library' | 'get-album' | 'get-trash' | 'retry' | 'trash-media' | 'trash-album' | 'restore-media' | 'restore-album' | 'purge-trash' | 'purge-album' | 'purge-all-trash' | 'purge-orphan' | 'set-delete-sources-after-import' | 'source-disposal-result' | 'get-storage-eligibility' | 'export-orphan'; payload?: unknown }
type ScannedFile = { path: string; relativePath: string; name: string; size: number; modifiedAt: number; kind: MediaKind; albumId: string | null; sourceRootPath: string | null; skippedReason?: string }
type SourceDisposalRequest = { entryId: string; sourcePath: string; sourceRootPath: string | null; sourceSize: number; sourceModifiedAt: number }
type SourceDisposalResult = { entryId: string; success: boolean; error?: string }

const config = workerData as WorkerConfig
if (!parentPort) throw new Error('Import worker must be started with a parent port')
const parent = parentPort!

const { sqlite } = createDatabase(config.databasePath)
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.bmp', '.tif', '.tiff'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.wmv'])
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])
const hashLocks = new Map<string, Promise<void>>()
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const PROGRESS_INTERVAL_MS = 250
const scheduledProgress = new Map<string, NodeJS.Timeout>()
const lastProgressAt = new Map<string, number>()
const pendingSourceDisposals = new Map<string, (result: SourceDisposalResult) => void>()
let queuePumping = false
let queueScheduled = false
let deleteSourcesAfterImport = Boolean(config.deleteSourcesAfterImport)

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

async function scanFolder(rootPath: string, albumId: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = []
  async function visit(directory: string): Promise<void> {
    let handle
    try { handle = await opendir(directory) } catch (error) {
      results.push({ path: directory, relativePath: relative(rootPath, directory) || basename(directory), name: basename(directory), size: 0, modifiedAt: 0, kind: 'file', albumId, sourceRootPath: rootPath, skippedReason: `无法读取目录：${error instanceof Error ? error.message : String(error)}` })
      return
    }
    for await (const entry of handle) {
      const absolute = join(directory, entry.name)
      try {
        const info = await lstat(absolute)
        if (info.isSymbolicLink()) {
          results.push({ path: absolute, relativePath: relative(rootPath, absolute), name: entry.name, size: 0, modifiedAt: info.mtimeMs, kind: 'file', albumId, sourceRootPath: rootPath, skippedReason: '已跳过符号链接或重解析点' })
        } else if (info.isDirectory()) await visit(absolute)
        else if (info.isFile()) {
          results.push({ path: absolute, relativePath: relative(rootPath, absolute), name: entry.name, size: info.size, modifiedAt: info.mtimeMs, kind: classify(absolute), albumId, sourceRootPath: rootPath, skippedReason: isArchive(absolute) ? '本期不支持压缩包导入' : undefined })
        }
      } catch (error) {
        results.push({ path: absolute, relativePath: relative(rootPath, absolute), name: entry.name, size: 0, modifiedAt: 0, kind: 'file', albumId, sourceRootPath: rootPath, skippedReason: `无法读取文件：${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }
  await visit(rootPath)
  return results
}

async function scanSources(sources: Source[], jobId: string): Promise<{ files: ScannedFile[]; albums: Array<{ id: string; title: string }> }> {
  const files: ScannedFile[] = []
  const albums: Array<{ id: string; title: string }> = []
  for (const source of sources) {
    if (source.kind === 'folder') {
      const album = { id: randomUUID(), title: basename(source.path) || '未命名文件夹' }
      albums.push(album)
      files.push(...await scanFolder(source.path, album.id))
      continue
    }
    try {
      const info = await stat(source.path)
      if (!info.isFile()) continue
      files.push({ path: source.path, relativePath: basename(source.path), name: basename(source.path), size: info.size, modifiedAt: info.mtimeMs, kind: classify(source.path), albumId: null, sourceRootPath: null, skippedReason: isArchive(source.path) ? '本期不支持压缩包导入' : undefined })
    } catch (error) {
      files.push({ path: source.path, relativePath: basename(source.path), name: basename(source.path), size: 0, modifiedAt: 0, kind: 'file', albumId: null, sourceRootPath: null, skippedReason: `无法读取文件：${error instanceof Error ? error.message : String(error)}` })
    }
  }
  return { files, albums }
}

async function planImport(sources: Source[]): Promise<ImportJobSummary> {
  if (!sources.length) throw new Error('没有可导入的文件或文件夹')
  const jobId = randomUUID()
  const now = Date.now()
  const sourceKind = sources.some((source) => source.kind === 'folder') ? 'folders' : 'files'
  const { files, albums } = await scanSources(sources, jobId)
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const insert = sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO import_jobs (id, source_kind, status, total_entries, total_bytes, created_at, queued_at, delete_sources_after_import) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)`).run(jobId, sourceKind, files.length, totalBytes, now, now, deleteSourcesAfterImport ? 1 : 0)
    const albumInsert = sqlite.prepare('INSERT INTO albums (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    albums.forEach((album) => albumInsert.run(album.id, album.title, now, now))
    const entryInsert = sqlite.prepare(`INSERT INTO import_entries (id, job_id, source_path, relative_path, source_name, source_size, source_modified_at, media_kind, album_id, status, error_code, error_message, created_at, completed_at, source_root_path, source_cleanup_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    files.forEach((file) => {
      const skipped = Boolean(file.skippedReason)
      entryInsert.run(randomUUID(), jobId, file.path, file.relativePath, file.name, file.size, Math.round(file.modifiedAt), file.kind, file.albumId, skipped ? 'skipped' : 'planned', skipped ? (isArchive(file.path) ? 'ARCHIVE_UNSUPPORTED' : 'SOURCE_UNREADABLE') : null, file.skippedReason ?? null, now, skipped ? now : null, file.sourceRootPath, 'not_requested')
    })
    sqlite.prepare("UPDATE import_jobs SET skipped_entries = ? WHERE id = ?").run(files.filter((file) => file.skippedReason).length, jobId)
  })
  insert()
  const job = getJobSummary(jobId)
  publish(jobId, true)
  scheduleQueue()
  return job
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
  const orphanCount = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM storage_orphans').get() as { count: number }).count)
  const pendingJobs = Number((sqlite.prepare("SELECT COUNT(*) AS count FROM import_jobs WHERE status IN ('planned', 'queued', 'running', 'partial_failed', 'interrupted')").get() as { count: number }).count)
  if (mediaCount || albumCount) return { canChangeResourceDirectory: false, reason: '当前图库已有媒体或图集，不能直接切换资源目录' }
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
  return { id: String(row.id), originalName: String(row.original_name), mediaKind: String(row.media_kind) as MediaKind, importedAt: Number(row.imported_at), previewUrl: previewUrl(String(row.content_hash), status), previewStatus: status as LibraryMedia['previewStatus'] }
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
async function recoverTrashOperations(): Promise<void> {
  const pendingTrash = (sqlite.prepare("SELECT id FROM media_items WHERE trash_state = 'pending_trash'").all() as Array<{ id: string }>).map((item) => item.id)
  await runOperation(pendingTrash, async (id) => {
    const row = sqlite.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as Record<string, unknown>
    await withHashLock(String(row.content_hash), async () => { await moveMediaToTrash(row); sqlite.prepare("UPDATE media_items SET trash_state = 'trashed' WHERE id = ?").run(id) })
  })
  const pendingRestore = (sqlite.prepare("SELECT id FROM media_items WHERE trash_state = 'pending_restore'").all() as Array<{ id: string }>).map((item) => item.id)
  await runOperation(pendingRestore, restoreMedia)
  finalizePendingAlbums()
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
          if (albumId) sqlite.prepare('INSERT OR IGNORE INTO album_items (album_id, media_id, sort_order) VALUES (?, ?, ?)').run(albumId, existing.id, now)
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
        sqlite.prepare('INSERT INTO media_items (id, content_hash, media_kind, original_name, extension, byte_size, object_path, imported_at, preview_status, preview_priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(mediaId, hash, entry.media_kind, entry.source_name, extension, entry.source_size, objectPath, now, needsPreview ? 'pending' : 'not_requested', needsPreview ? 0 : 100)
        sqlite.prepare("UPDATE import_entries SET status = 'imported', content_hash = ?, media_id = ?, completed_at = ?, source_cleanup_status = ? WHERE id = ?").run(hash, mediaId, now, deleteSource ? 'pending' : 'not_requested', entryId)
        const albumId = entry.album_id as string | null
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
    ORDER BY created_at, id`).all(jobId) as Record<string, unknown>[]
  for (const entry of entries) await disposeSourceForEntry(entry, jobId)
}
async function runJob(jobId: string): Promise<void> {
  try {
    sqlite.prepare("UPDATE import_jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?").run(Date.now(), jobId)
    publish(jobId, true)
    await processPendingSourceDisposals(jobId)
    const entries = sqlite.prepare("SELECT * FROM import_entries WHERE job_id = ? AND status = 'planned' ORDER BY created_at, id").all(jobId) as Record<string, unknown>[]
    const concurrency = Math.max(1, Math.min(4, Math.floor(cpus().length / 2) || 1))
    let index = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
      while (index < entries.length) { const entry = entries[index++]; await processEntry(entry, jobId) }
    }))
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
  const entries = sqlite.prepare('SELECT id, source_name, relative_path, source_size, media_kind, status, error_code, error_message, source_cleanup_status, source_cleanup_error FROM import_entries WHERE job_id = ? ORDER BY created_at, id').all(jobId) as Record<string, unknown>[]
  return { ...job, entries: entries.map((entry) => ({ id: String(entry.id), sourceName: String(entry.source_name), relativePath: String(entry.relative_path), sourceSize: Number(entry.source_size), mediaKind: String(entry.media_kind) as MediaKind, status: String(entry.status) as ImportEntryStatus, errorCode: entry.error_code === null ? null : String(entry.error_code), errorMessage: entry.error_message === null ? null : String(entry.error_message), sourceCleanupStatus: String(entry.source_cleanup_status) as 'not_requested' | 'pending' | 'trashed' | 'failed', sourceCleanupError: entry.source_cleanup_error === null ? null : String(entry.source_cleanup_error) })) }
}
function previewUrl(hash: string, status: string): string | null { return status === 'ready' ? `gallery-thumb://${hash}` : null }
function getLibrary(): LibrarySnapshot {
  const counts = sqlite.prepare("SELECT media_kind, COUNT(*) AS count FROM media_items WHERE trash_state = 'active' GROUP BY media_kind").all() as Array<{ media_kind: MediaKind; count: number }>
  const byKind = new Map(counts.map((row) => [row.media_kind, Number(row.count)]))
  const albums = sqlite.prepare(`SELECT a.id, a.title, a.updated_at, COUNT(m.id) AS media_count,
    (SELECT m.content_hash FROM album_items ai2 JOIN media_items m ON m.id = ai2.media_id
      WHERE ai2.album_id = a.id AND m.preview_status = 'ready' AND m.trash_state = 'active' ORDER BY ai2.sort_order LIMIT 1) AS cover_hash
    FROM albums a LEFT JOIN album_items ai ON ai.album_id = a.id LEFT JOIN media_items m ON m.id = ai.media_id AND m.trash_state = 'active'
    WHERE a.trash_state = 'active' GROUP BY a.id ORDER BY a.updated_at DESC`).all() as Array<{ id: string; title: string; updated_at: number; media_count: number; cover_hash: string | null }>
  const looseMedia = sqlite.prepare(`SELECT m.id, m.original_name, m.media_kind, m.imported_at, m.content_hash, m.preview_status FROM media_items m WHERE m.trash_state = 'active' AND NOT EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = m.id AND a.trash_state = 'active') ORDER BY m.imported_at DESC LIMIT 100`).all() as Record<string, unknown>[]
  const images = byKind.get('image') ?? 0; const videos = byKind.get('video') ?? 0; const files = byKind.get('file') ?? 0
  return { totals: { all: images + videos + files, images, videos, files }, albums: albums.map((album) => ({ id: album.id, title: album.title, mediaCount: Number(album.media_count), updatedAt: Number(album.updated_at), coverPreviewUrl: album.cover_hash ? previewUrl(album.cover_hash, 'ready') : null })), looseMedia: looseMedia.map(asMedia) }
}
function getAlbum(albumId: string): AlbumDetail {
  const album = sqlite.prepare("SELECT id, title, updated_at FROM albums WHERE id = ? AND trash_state = 'active'").get(albumId) as { id: string; title: string; updated_at: number } | undefined
  if (!album) throw new Error('图集不存在或已在回收站')
  const media = sqlite.prepare("SELECT m.id, m.original_name, m.media_kind, m.imported_at, m.content_hash, m.preview_status FROM album_items ai JOIN media_items m ON m.id = ai.media_id WHERE ai.album_id = ? AND m.trash_state = 'active' ORDER BY ai.sort_order").all(albumId) as Record<string, unknown>[]
  return { id: album.id, title: album.title, updatedAt: Number(album.updated_at), media: media.map(asMedia) }
}
function getTrash(): TrashSnapshot {
  const expiresAt = (trashedAt: number) => trashedAt + TRASH_RETENTION_MS
  const media = sqlite.prepare("SELECT id, original_name, media_kind, trashed_at, trash_state FROM media_items WHERE trash_state IN ('trashed', 'pending_trash', 'pending_restore') ORDER BY trashed_at DESC").all() as Array<{ id: string; original_name: string; media_kind: MediaKind; trashed_at: number; trash_state: TrashItem['state'] }>
  const albums = sqlite.prepare("SELECT a.id, a.title, a.trashed_at, a.trash_state, COUNT(ai.media_id) AS media_count FROM albums a LEFT JOIN album_items ai ON ai.album_id = a.id WHERE a.trash_state IN ('trashed', 'pending_trash', 'pending_restore') GROUP BY a.id ORDER BY a.trashed_at DESC").all() as Array<{ id: string; title: string; trashed_at: number; trash_state: TrashItem['state']; media_count: number }>
  const orphans = sqlite.prepare('SELECT id, original_relative_path, discovered_at, expires_at FROM storage_orphans ORDER BY discovered_at DESC').all() as Array<{ id: string; original_relative_path: string; discovered_at: number; expires_at: number }>
  const items: TrashItem[] = [
    ...albums.map((album) => ({ entityType: 'album' as const, id: album.id, title: album.title, mediaKind: null, trashedAt: Number(album.trashed_at), expiresAt: expiresAt(Number(album.trashed_at)), mediaCount: Number(album.media_count), state: album.trash_state, failureReason: album.trash_state === 'trashed' ? null : '操作尚未完成，可再次点击继续处理' })),
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
const startup = (async () => {
  await recoverImportJobs()
  await recoverTrashOperations()
  await recoverOrphanObjects()
  scheduleQueue()
})()

parent.on('message', (request: Request) => {
  if (request.command === 'source-disposal-result') {
    const result = request.payload as SourceDisposalResult
    const resolveDisposal = pendingSourceDisposals.get(result.entryId)
    if (resolveDisposal) { pendingSourceDisposals.delete(result.entryId); resolveDisposal(result) }
    return
  }
  void (async () => {
    try {
      await startup
      if (!request.id) throw new Error('请求缺少标识')
      if (request.command === 'plan') reply(request.id, await planImport(request.payload as Source[]))
      else if (request.command === 'get-jobs') reply(request.id, getJobs())
      else if (request.command === 'get-job') reply(request.id, getJob(String(request.payload)))
      else if (request.command === 'get-library') reply(request.id, getLibrary())
      else if (request.command === 'get-album') reply(request.id, getAlbum(String(request.payload)))
      else if (request.command === 'get-trash') reply(request.id, getTrash())
      else if (request.command === 'get-storage-eligibility') reply(request.id, getStorageEligibility())
      else if (request.command === 'export-orphan') reply(request.id, await exportOrphan(request.payload))
      else if (request.command === 'retry') { const jobId = String(request.payload); const job = prepareRetry(jobId); publish(jobId, true); scheduleQueue(); reply(request.id, job) }
      else if (request.command === 'set-delete-sources-after-import') { deleteSourcesAfterImport = Boolean(request.payload); reply(request.id, true) }
      else if (request.command === 'trash-media') reply(request.id, await runOperation([String(request.payload)], trashMedia))
      else if (request.command === 'trash-album') reply(request.id, await trashAlbum(String(request.payload)))
      else if (request.command === 'restore-media') reply(request.id, await runOperation([String(request.payload)], restoreMedia))
      else if (request.command === 'restore-album') reply(request.id, await restoreAlbum(String(request.payload)))
      else if (request.command === 'purge-trash') reply(request.id, await runOperation([String(request.payload)], purgeMedia))
      else if (request.command === 'purge-album') {
        const albumId = String(request.payload)
        const ids = (sqlite.prepare("SELECT id FROM media_items WHERE id IN (SELECT media_id FROM album_items WHERE album_id = ?) AND trash_state = 'trashed'").all(albumId) as Array<{ id: string }>).map((item) => item.id)
        sqlite.prepare("DELETE FROM albums WHERE id = ? AND trash_state = 'trashed'").run(albumId)
        const result = await runOperation(ids, purgeOrphanMedia)
        reply(request.id, { ...result, succeeded: [...result.succeeded, albumId] })
      }
      else if (request.command === 'purge-orphan') reply(request.id, await runOperation([String(request.payload)], purgeOrphan))
      else if (request.command === 'purge-all-trash') {
        const ids = (sqlite.prepare("SELECT id FROM media_items WHERE trash_state = 'trashed'").all() as Array<{ id: string }>).map((item) => item.id)
        const orphanIds = (sqlite.prepare('SELECT id FROM storage_orphans').all() as Array<{ id: string }>).map((item) => item.id)
        sqlite.prepare("DELETE FROM albums WHERE trash_state = 'trashed'").run()
        const mediaResult = await runOperation(ids, purgeMedia)
        const orphanResult = await runOperation(orphanIds, purgeOrphan)
        reply(request.id, { succeeded: [...mediaResult.succeeded, ...orphanResult.succeeded], pending: [...mediaResult.pending, ...orphanResult.pending], failed: [...mediaResult.failed, ...orphanResult.failed] })
      }
    } catch (error) { if (request.id) replyError(request.id, error) }
  })()
})
setInterval(() => { void purgeExpiredTrash() }, 24 * 60 * 60 * 1000).unref()
