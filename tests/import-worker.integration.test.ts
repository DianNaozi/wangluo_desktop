import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { createDatabase } from '../src/main/import/database'
import type { PlaybackCheckpoint, PlaybackQueueEntryState, PlaybackStats } from '../src/main/import/types'

type Job = { id: string; status: string; totalEntries: number; importedEntries: number; sourceCleanupFailedEntries: number }
type JobDetail = Job & { entries: Array<{ relativePath: string; status: string }> }
type Library = { totals: { all: number }; albums: Array<{ id: string; coverPreviewUrl: string | null; coverPreviewPending?: boolean }>; looseMedia: Array<{ id: string; previewStatus: string; previewError: string | null; previewUrl: string | null }> }
type FolderTree = Array<{ id: string; title: string; parentId: string | null; itemCount: number; children: FolderTree }>
type Trash = { items: Array<{ id: string; entityType: string }> }
type StorageEligibility = { canChangeResourceDirectory: boolean; reason: string | null }
type Coser = { id: string; name: string; aliases: string[]; albumCount: number; videoCount: number; mediaCount: number; albums?: Array<{ id: string }> }
const runFile = promisify(execFile)

class ImportWorkerClient {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(reason: Error): void }>()
  readonly worker: Worker
  progressEvents = 0
  failNextSourceDisposal = false
  sourceDisposalHandler?: (request: { entryId: string; sourcePath: string }) => Promise<void>

  constructor(databasePath: string, storagePath: string, deleteSourcesAfterImport = false) {
    this.worker = new Worker(resolve('out/main/import-worker.js'), { workerData: { databasePath, storagePath, deleteSourcesAfterImport } })
    this.worker.on('message', (message: { type: string; id?: string; result?: unknown; request?: { entryId: string; sourcePath: string } }) => {
      if (message.type === 'progress') { this.progressEvents += 1; return }
      if (message.type === 'source-disposal-request' && message.request) {
        if (this.failNextSourceDisposal) {
          this.failNextSourceDisposal = false
          this.worker.postMessage({ command: 'source-disposal-result', payload: { entryId: message.request.entryId, success: false, error: 'simulated recycle-bin failure' } })
          return
        }
        void Promise.resolve().then(() => this.sourceDisposalHandler
          ? this.sourceDisposalHandler(message.request!)
          : rm(message.request!.sourcePath, { force: true })).then(
          () => this.worker.postMessage({ command: 'source-disposal-result', payload: { entryId: message.request!.entryId, success: true } }),
          (error) => this.worker.postMessage({ command: 'source-disposal-result', payload: { entryId: message.request!.entryId, success: false, error: String(error) } })
        )
        return
      }
      if (message.type !== 'response' || !message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      const result = message.result as { error?: string }
      if (result?.error) pending.reject(new Error(result.error)); else pending.resolve(result)
    })
  }
  request<T>(command: string, payload?: unknown): Promise<T> {
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`Timed out waiting for ${command}`))
      }, 3000)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value as T) },
        reject: (reason) => { clearTimeout(timeout); reject(reason) }
      })
      this.worker.postMessage({ id, command, payload })
    })
  }
  async dispose(): Promise<void> { await this.worker.terminate() }
}

class PreviewWorkerClient {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(reason: Error): void }>()
  readonly worker: Worker

  constructor(databasePath: string, storagePath: string) {
    this.worker = new Worker(resolve('out/main/preview-worker.js'), { workerData: { databasePath, storagePath } })
    this.worker.on('message', (message: { type: string; id?: string; result?: unknown }) => {
      if (message.type !== 'response' || !message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      const result = message.result as { error?: string }
      if (result?.error) pending.reject(new Error(result.error)); else pending.resolve(result)
    })
  }

  request<T>(command: 'wake' | 'rebuild' | 'retry', payload?: unknown): Promise<T> {
    const id = randomUUID()
    return new Promise<T>((resolveRequest, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`Timed out waiting for preview ${command}`))
      }, 3000)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolveRequest(value as T) },
        reject: (reason) => { clearTimeout(timeout); reject(reason) }
      })
      this.worker.postMessage({ id, command, payload })
    })
  }

  async dispose(): Promise<void> { await this.worker.terminate() }
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const value = await read()
    if (done(value)) return value
    await delay(25)
  }
  throw new Error('Timed out waiting for import worker')
}

describe('import worker integration', () => {
  let root: string
  let client: ImportWorkerClient

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'local-gallery-test-'))
    client = new ImportWorkerClient(join(root, 'gallery.sqlite'), root)
  })
  afterEach(async () => {
    await client?.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('serializes queued jobs and imports each source once', async () => {
    const first = join(root, 'first.txt')
    const second = join(root, 'second.txt')
    await writeFile(first, Buffer.alloc(8 * 1024 * 1024, 1))
    await writeFile(second, Buffer.alloc(8 * 1024 * 1024, 2))
    const [firstJob, secondJob] = await Promise.all([
      client.request<Job>('plan', [{ path: first, kind: 'file' }]),
      client.request<Job>('plan', [{ path: second, kind: 'file' }])
    ])

    let observedRunning = 0
    const jobs = await waitFor(() => client.request<Job[]>('get-jobs'), (items) => {
      observedRunning = Math.max(observedRunning, items.filter((item) => item.status === 'running').length)
      return items.every((item) => ['completed', 'partial_failed'].includes(item.status))
    })
    expect(observedRunning).toBeLessThanOrEqual(1)
    expect(jobs.find((job) => job.id === firstJob.id)?.importedEntries).toBe(1)
    expect(jobs.find((job) => job.id === secondJob.id)?.importedEntries).toBe(1)
  })

  it('imports folder entries one at a time in natural directory and filename order', async () => {
    const databasePath = join(root, 'gallery.sqlite')
    await client.dispose()
    client = new ImportWorkerClient(databasePath, root, true)

    const sourceRoot = join(root, 'ordered-input')
    const expected = ['set2/file1.bin', 'set2/file2.bin', 'set2/file10.bin', 'set10/file1.bin', 'set10/file2.bin']
    for (const relativePath of [expected[4]!, expected[2]!, expected[0]!, expected[3]!, expected[1]!]) {
      const source = join(sourceRoot, ...relativePath.split('/'))
      await mkdir(dirname(source), { recursive: true })
      await writeFile(source, relativePath)
    }

    const disposalPaths: string[] = []
    const releases: Array<() => void> = []
    let activeDisposals = 0
    let maxActiveDisposals = 0
    client.sourceDisposalHandler = async ({ sourcePath }) => {
      activeDisposals += 1
      maxActiveDisposals = Math.max(maxActiveDisposals, activeDisposals)
      disposalPaths.push(relative(sourceRoot, sourcePath).replaceAll('\\', '/'))
      await new Promise<void>((resolveDisposal) => releases.push(() => { activeDisposals -= 1; resolveDisposal() }))
      await rm(sourcePath, { force: true })
    }

    const job = await client.request<Job>('plan', [{ path: sourceRoot, kind: 'folder' }])
    await waitFor(async () => disposalPaths.length, (count) => count === 1)
    expect(disposalPaths).toEqual([expected[0]])
    expect((await client.request<JobDetail>('get-job', job.id)).entries.map((entry) => entry.relativePath.replaceAll('\\', '/'))).toEqual(expected)
    expect((await client.request<JobDetail>('get-job', job.id)).entries.filter((entry) => entry.status === 'planned')).toHaveLength(expected.length - 1)

    while (disposalPaths.length < expected.length) {
      releases.shift()!()
      const nextCount = disposalPaths.length + 1
      await waitFor(async () => disposalPaths.length, (count) => count === nextCount)
      expect(disposalPaths).toEqual(expected.slice(0, nextCount))
      expect((await client.request<JobDetail>('get-job', job.id)).entries.filter((entry) => entry.status === 'planned')).toHaveLength(expected.length - nextCount)
      expect(maxActiveDisposals).toBe(1)
    }
    releases.shift()!()

    const jobs = await waitFor(() => client.request<Job[]>('get-jobs'), (items) => items.some((item) => item.id === job.id && item.status === 'completed'))
    expect(jobs.find((item) => item.id === job.id)?.importedEntries).toBe(expected.length)
  })

  it('automatically resumes a persisted in-progress entry', async () => {
    const source = join(root, 'resume.txt')
    await writeFile(source, 'resume me')
    const databasePath = join(root, 'resume.sqlite')
    const { sqlite } = createDatabase(databasePath)
    const jobId = randomUUID(); const entryId = randomUUID(); const now = Date.now()
    sqlite.prepare("INSERT INTO import_jobs (id, source_kind, status, total_entries, total_bytes, created_at, queued_at, started_at) VALUES (?, 'files', 'running', 1, 9, ?, ?, ?)").run(jobId, now, now, now)
    sqlite.prepare("INSERT INTO import_entries (id, job_id, source_path, relative_path, source_name, source_size, source_modified_at, media_kind, album_id, status, error_code, error_message, created_at, completed_at) VALUES (?, ?, ?, 'resume.txt', 'resume.txt', 9, ?, 'file', NULL, 'copying', NULL, NULL, ?, NULL)").run(entryId, jobId, source, Math.round((await (await import('node:fs/promises')).stat(source)).mtimeMs), now)
    sqlite.close()

    const resumed = new ImportWorkerClient(databasePath, root)
    try {
      const jobs = await waitFor(() => resumed.request<Job[]>('get-jobs'), (items) => items.some((item) => item.id === jobId && item.status === 'completed'))
      expect(jobs.find((job) => job.id === jobId)?.importedEntries).toBe(1)
    } finally { await resumed.dispose() }
  })

  it('persists playback queues, merges actually watched video ranges, awards XP, and ignores duplicate checkpoints', async () => {
    const databasePath = join(root, 'gallery.sqlite')
    const { sqlite } = createDatabase(databasePath)
    const albumId = randomUUID(); const firstImageId = randomUUID(); const secondImageId = randomUUID(); const videoId = randomUUID(); const now = Date.now()
    const addImage = sqlite.prepare("INSERT INTO media_items (id, content_hash, media_kind, original_name, extension, byte_size, object_path, imported_at) VALUES (?, ?, 'image', ?, '.jpg', 10, ?, ?)")
    addImage.run(firstImageId, 'a'.repeat(64), 'first.jpg', join(root, 'first.jpg'), now)
    addImage.run(secondImageId, 'b'.repeat(64), 'second.jpg', join(root, 'second.jpg'), now)
    sqlite.prepare("INSERT INTO media_items (id, content_hash, media_kind, original_name, extension, byte_size, object_path, imported_at) VALUES (?, ?, 'video', 'short.mp4', '.mp4', 10, ?, ?)").run(videoId, 'c'.repeat(64), join(root, 'short.mp4'), now)
    sqlite.prepare('INSERT INTO albums (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(albumId, '观看测试图包', now, now)
    const albumItem = sqlite.prepare('INSERT INTO album_items (album_id, media_id, sort_order) VALUES (?, ?, ?)')
    albumItem.run(albumId, firstImageId, 0); albumItem.run(albumId, secondImageId, 1); albumItem.run(albumId, videoId, 2)
    sqlite.close()

    const queue: PlaybackQueueEntryState[] = [{ entryId: `album:${albumId}`, type: 'album', albumId, title: '观看测试图包', sortOrder: 'filename', mediaIds: [firstImageId, secondImageId, videoId] }]
    const saved = await client.request<PlaybackStats>('save-playback-state', { queue, cursorEntryId: `album:${albumId}`, cursorMediaId: firstImageId, imageIntervalSeconds: 5, loop: true })
    expect(saved.queue).toEqual(queue)
    expect((await client.request<Array<{ id: string }>>('get-playback-media', [firstImageId, videoId])).map((item) => item.id).sort()).toEqual([firstImageId, videoId].sort())

    const checkpoint = (sequence: number, mediaId: string, watchedDeltaMs: number, videoRanges: PlaybackCheckpoint['media'][number]['videoRanges'] = []): PlaybackCheckpoint => ({
      sessionId: 'integration-playback-session', sequence, watchedDeltaMs,
      media: [{ entryId: `album:${albumId}`, mediaId, watchedDeltaMs, imageElapsedMs: watchedDeltaMs, positionMs: videoRanges.at(-1)?.endMs ?? 0, durationMs: mediaId === videoId ? 10_000 : 0, videoRanges, watchedAt: Date.now() }]
    })
    await client.request<PlaybackStats>('playback-checkpoint', checkpoint(1, firstImageId, 3_000))
    const partlyWatched = await client.request<PlaybackStats>('playback-checkpoint', checkpoint(2, secondImageId, 3_000))
    expect(partlyWatched.achievements).toEqual([])
    await client.request<PlaybackStats>('playback-checkpoint', checkpoint(3, videoId, 5_000, [{ startMs: 0, endMs: 5_000 }]))
    const completed = await client.request<PlaybackStats>('playback-checkpoint', checkpoint(4, videoId, 5_000, [{ startMs: 5_000, endMs: 10_000 }]))
    expect(completed.totalWatchedMs).toBe(16_000)
    expect(completed.xp).toBe(1)
    expect(completed.xpInLevel).toBe(1)
    expect(completed.achievements.map((item) => item.id)).toEqual(['first-album'])
    expect(completed.progress.find((item) => item.mediaId === videoId)?.videoRanges).toEqual([{ startMs: 0, endMs: 10_000 }])

    const retried = await client.request<PlaybackStats>('playback-checkpoint', checkpoint(4, videoId, 5_000, [{ startMs: 5_000, endMs: 10_000 }]))
    expect(retried.totalWatchedMs).toBe(16_000)
    expect(retried.achievements.map((item) => item.id)).toEqual(['first-album'])

    const resetImageClock = await client.request<PlaybackStats>('playback-checkpoint', checkpoint(5, firstImageId, 0))
    expect(resetImageClock.totalWatchedMs).toBe(16_000)
    expect(resetImageClock.xp).toBe(1)
    expect(resetImageClock.progress.find((item) => item.mediaId === firstImageId)).toMatchObject({ watchedMs: 3_000, imageElapsedMs: 0 })
  })

  it('coalesces per-file progress notifications', async () => {
    const files = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const file = join(root, `progress-${index}.txt`)
      await writeFile(file, Buffer.alloc(512 * 1024, index))
      return { path: file, kind: 'file' as const }
    }))
    await client.request<Job>('plan', files)
    await waitFor(() => client.request<Job[]>('get-jobs'), (items) => items.some((item) => item.status === 'completed'))
    expect(client.progressEvents).toBeLessThan(8)
  })

  it('requests source disposal only after a successful import', async () => {
    await client.dispose()
    const source = join(root, 'remove-after-import.txt')
    await writeFile(source, 'recycle after importing')
    client = new ImportWorkerClient(join(root, 'gallery.sqlite'), root, true)
    await client.request<Job>('plan', [{ path: source, kind: 'file' }])
    const jobs = await waitFor(() => client.request<Job[]>('get-jobs'), (items) => items.some((item) => item.status === 'completed'))
    await expect(access(source)).rejects.toThrow()
    expect(jobs[0]?.sourceCleanupFailedEntries).toBe(0)
  })

  it('retries a failed source disposal without importing the file again', async () => {
    await client.dispose()
    const source = join(root, 'retry-source-disposal.txt')
    await writeFile(source, 'keep this until retry')
    client = new ImportWorkerClient(join(root, 'gallery.sqlite'), root, true)
    client.failNextSourceDisposal = true
    const job = await client.request<Job>('plan', [{ path: source, kind: 'file' }])
    const failed = await waitFor(() => client.request<Job[]>('get-jobs'), (items) => items.some((item) => item.id === job.id && item.status === 'partial_failed'))
    expect(failed.find((item) => item.id === job.id)?.sourceCleanupFailedEntries).toBe(1)
    await access(source)

    await client.request<Job>('retry', job.id)
    const completed = await waitFor(() => client.request<Job[]>('get-jobs'), (items) => items.some((item) => item.id === job.id && item.status === 'completed'))
    expect(completed.find((item) => item.id === job.id)?.importedEntries).toBe(1)
    await expect(access(source)).rejects.toThrow()
  })

  it('retains a de-duplicated item while another active album references it', async () => {
    const one = join(root, 'one'); const two = join(root, 'two')
    await (await import('node:fs/promises')).mkdir(one); await (await import('node:fs/promises')).mkdir(two)
    await writeFile(join(one, 'same.txt'), 'shared')
    await writeFile(join(two, 'same.txt'), 'shared')
    await client.request<Job>('plan', [{ path: one, kind: 'folder' }, { path: two, kind: 'folder' }])
    const library = await waitFor(() => client.request<Library>('get-library'), (value) => value.albums.length === 2 && value.totals.all === 1)
    const [firstAlbum, secondAlbum] = library.albums

    await client.request('trash-album', firstAlbum.id)
    const afterFirstTrash = await client.request<Library>('get-library')
    expect(afterFirstTrash.totals.all).toBe(1)
    expect((await client.request<{ media: unknown[] }>('get-album', secondAlbum.id)).media).toHaveLength(1)

    await client.request('trash-album', secondAlbum.id)
    expect((await client.request<Library>('get-library')).totals.all).toBe(0)
    await client.request('restore-album', secondAlbum.id)
    expect((await client.request<Library>('get-library')).totals.all).toBe(1)
  })

  it('generates a folder album cover after importing an image', async () => {
    const sourceDirectory = join(root, 'image-album')
    const sourceImage = join(sourceDirectory, 'cover.png')
    await mkdir(sourceDirectory)
    await sharp({ create: { width: 16, height: 12, channels: 3, background: '#8b5cf6' } }).png().toFile(sourceImage)

    await client.request<Job>('plan', [{ path: sourceDirectory, kind: 'folder' }])
    await waitFor(() => client.request<Job[]>('get-jobs'), (jobs) => jobs.some((job) => job.status === 'completed'))
    const beforePreview = await client.request<Library>('get-library')
    expect(beforePreview.albums[0]).toMatchObject({ coverPreviewUrl: null, coverPreviewPending: true })

    const previewClient = new PreviewWorkerClient(join(root, 'gallery.sqlite'), root)
    try {
      await previewClient.request<boolean>('wake')
      const library = await waitFor(() => client.request<Library>('get-library'), (snapshot) => snapshot.albums[0]?.coverPreviewUrl !== null)
      const album = library.albums[0]!
      expect(album.coverPreviewPending).toBe(false)
      const thumbnailHash = new URL(album.coverPreviewUrl!).hostname
      await access(join(root, 'thumbnails', `${thumbnailHash}.webp`))
    } finally { await previewClient.dispose() }
  })

  it('assigns dropped folder albums to the selected Coser in the import plan', async () => {
    const coser = await client.request<Coser>('create-coser', { name: '拖放测试', aliases: [] })
    const sourceDirectory = join(root, '落日写真')
    await mkdir(join(sourceDirectory, '子目录'), { recursive: true })
    await writeFile(join(sourceDirectory, '照片 1.jpg'), 'test photo')
    await writeFile(join(sourceDirectory, '子目录', '照片 2.jpg'), 'nested test photo')

    const job = await client.request<Job>('plan', [{ path: sourceDirectory, kind: 'folder', coserId: coser.id }])
    await waitFor(() => client.request<Job[]>('get-jobs'), (jobs) => jobs.some((item) => item.id === job.id && item.status === 'completed'))

    const detail = await client.request<Coser>('get-coser', coser.id)
    expect(detail.albums).toHaveLength(1)
    const album = await client.request<{ folderId: string | null; media: unknown[] }>('get-album', detail.albums![0]!.id)
    expect(album).toMatchObject({ folderId: null })
    expect(album.media).toHaveLength(2)
  })

  it('rejects a deleted Coser before creating an import job', async () => {
    const sourceDirectory = join(root, 'missing-coser-album')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'photo.jpg'), 'test photo')

    await expect(client.request<Job>('plan', [{ path: sourceDirectory, kind: 'folder', coserId: randomUUID() }])).rejects.toThrow('目标 Coser 不存在或已删除')
    expect(await client.request<Job[]>('get-jobs')).toHaveLength(0)
  })

  it.each([false, true])('generates an MP4 preview, recovering an executable failure: %s', async (recoverFailure) => {
    const source = join(root, 'sample.mp4')
    await runFile(ffmpegPath!, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', '-t', '1', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
    await client.request<Job>('plan', [{ path: source, kind: 'file' }])
    await waitFor(() => client.request<Job[]>('get-jobs'), (jobs) => jobs.some((job) => job.status === 'completed'))

    if (recoverFailure) {
      const { sqlite } = createDatabase(join(root, 'gallery.sqlite'))
      try {
        sqlite.prepare("UPDATE media_items SET preview_status = 'failed', preview_error = 'FFmpeg：spawn EFTYPE' WHERE media_kind = 'video'").run()
      } finally { sqlite.close() }
    }
    const previewClient = new PreviewWorkerClient(join(root, 'gallery.sqlite'), root)
    try {
      await previewClient.request<boolean>('wake')
      const library = await waitFor(() => client.request<Library>('get-library'), (snapshot) => snapshot.looseMedia[0]?.previewStatus === 'ready')
      const media = library.looseMedia[0]!
      expect(media.previewUrl).toMatch(/^gallery-thumb:\/\//)
      const thumbnailHash = new URL(media.previewUrl!).hostname
      const metadata = await sharp(await readFile(join(root, 'thumbnails', `${thumbnailHash}.webp`))).metadata()
      expect(metadata.format).toBe('webp')
      expect(metadata.width).toBeGreaterThan(0)
      expect(metadata.height).toBeGreaterThan(0)
      expect(metadata.width).toBeLessThanOrEqual(640)
      expect(metadata.height).toBeLessThanOrEqual(640)
    } finally { await previewClient.dispose() }
  })

  it('returns preview errors and requeues a failed video preview', async () => {
    await client.dispose()
    const databasePath = join(root, 'preview-retry.sqlite')
    const mediaId = randomUUID()
    const now = Date.now()
    const { sqlite } = createDatabase(databasePath)
    try {
      sqlite.prepare("INSERT INTO media_items (id, content_hash, media_kind, original_name, extension, byte_size, object_path, preview_status, preview_error, preview_priority, preview_version, trash_state, imported_at) VALUES (?, ?, 'video', 'broken.mp4', '.mp4', 1, ?, 'pending', NULL, 100, 1, 'active', ?)").run(mediaId, 'd'.repeat(64), join(root, 'missing.mp4'), now)
    } finally { sqlite.close() }
    client = new ImportWorkerClient(databasePath, root)
    const previewClient = new PreviewWorkerClient(databasePath, root)
    try {
      await previewClient.request<boolean>('wake')
      const failed = await waitFor(() => client.request<Library>('get-library'), (snapshot) => snapshot.looseMedia[0]?.previewStatus === 'failed')
      expect(failed.looseMedia[0]).toMatchObject({ previewError: expect.any(String), previewUrl: null })

      const activeDatabase = createDatabase(databasePath).sqlite
      try {
        activeDatabase.prepare("INSERT INTO import_jobs (id, source_kind, status, total_entries, total_bytes, created_at, queued_at) VALUES (?, 'files', 'running', 0, 0, ?, ?)").run(randomUUID(), now, now)
      } finally { activeDatabase.close() }
      expect(await previewClient.request<boolean>('retry', mediaId)).toBe(true)
      const requeued = await client.request<Library>('get-library')
      expect(requeued.looseMedia[0]).toMatchObject({ previewStatus: 'pending', previewError: null, previewUrl: null })
    } finally { await previewClient.dispose() }
  })

  it('keeps an album cover bound to its first previewable media', async () => {
    const databasePath = join(root, 'gallery.sqlite')
    const { sqlite } = createDatabase(databasePath)
    const albumId = 'fixed-cover-album'
    const firstHash = 'a'.repeat(64)
    const secondHash = 'b'.repeat(64)
    const now = Date.now()
    try {
      sqlite.prepare("INSERT INTO albums (id, title, created_at, updated_at, trash_state) VALUES (?, '固定封面', ?, ?, 'active')").run(albumId, now, now)
      const insertMedia = sqlite.prepare("INSERT INTO media_items (id, content_hash, media_kind, original_name, extension, byte_size, object_path, preview_status, preview_priority, preview_version, trash_state, imported_at) VALUES (?, ?, 'image', ?, '.png', 1, ?, ?, 0, 1, 'active', ?)")
      insertMedia.run('media-a', firstHash, 'first.png', join(root, 'first.png'), 'pending', now)
      insertMedia.run('media-b', secondHash, 'second.png', join(root, 'second.png'), 'ready', now)
      sqlite.prepare('INSERT INTO album_items (album_id, media_id, sort_order) VALUES (?, ?, ?), (?, ?, ?)').run(albumId, 'media-a', 1, albumId, 'media-b', 2)
    } finally { sqlite.close() }

    const readCover = async () => (await client.request<Library>('get-library')).albums.find((album) => album.id === albumId)!
    expect(await readCover()).toMatchObject({ coverPreviewUrl: null, coverPreviewPending: true })

    const readyDatabase = createDatabase(databasePath).sqlite
    try { readyDatabase.prepare("UPDATE media_items SET preview_status = 'ready' WHERE id = 'media-a'").run() } finally { readyDatabase.close() }
    expect(await readCover()).toMatchObject({ coverPreviewUrl: `gallery-thumb://${firstHash}`, coverPreviewPending: false })

    const failedDatabase = createDatabase(databasePath).sqlite
    try { failedDatabase.prepare("UPDATE media_items SET preview_status = 'failed' WHERE id = 'media-a'").run() } finally { failedDatabase.close() }
    expect(await readCover()).toMatchObject({ coverPreviewUrl: null, coverPreviewPending: false })

    const tiedDatabase = createDatabase(databasePath).sqlite
    try {
      tiedDatabase.prepare("UPDATE media_items SET preview_status = 'ready' WHERE id = 'media-a'").run()
      tiedDatabase.prepare('UPDATE album_items SET sort_order = 10 WHERE album_id = ?').run(albumId)
    } finally { tiedDatabase.close() }
    expect(await readCover()).toMatchObject({ coverPreviewUrl: `gallery-thumb://${firstHash}`, coverPreviewPending: false })
  })

  it('quarantines an unindexed managed object and exports a copy without indexing it', async () => {
    await client.dispose()
    const orphanPath = join(root, 'objects', 'ab', 'cd', 'left-behind.bin')
    await mkdir(join(root, 'objects', 'ab', 'cd'), { recursive: true })
    await writeFile(orphanPath, 'orphan content')
    client = new ImportWorkerClient(join(root, 'gallery.sqlite'), root)

    const trash = await waitFor(() => client.request<Trash>('get-trash'), (snapshot) => snapshot.items.some((item) => item.entityType === 'orphan'))
    const orphan = trash.items.find((item) => item.entityType === 'orphan')!
    await expect(access(orphanPath)).rejects.toThrow()
    const destination = join(root, 'exported')
    const result = await client.request<{ succeeded: string[] }>('export-orphan', { orphanId: orphan.id, destinationDirectory: destination })
    expect(result.succeeded).toEqual([orphan.id])
    expect(await readFile(join(destination, 'left-behind.bin'), 'utf8')).toBe('orphan content')
    expect((await client.request<Library>('get-library')).totals.all).toBe(0)
  })

  it('records an already-quarantined object left by an interrupted move', async () => {
    await client.dispose()
    const orphanId = randomUUID()
    const quarantinedPath = join(root, 'trash', 'orphans', `${orphanId}-interrupted.bin`)
    await mkdir(join(root, 'trash', 'orphans'), { recursive: true })
    await writeFile(quarantinedPath, 'isolated before crash')
    client = new ImportWorkerClient(join(root, 'gallery.sqlite'), root)
    const trash = await waitFor(() => client.request<Trash>('get-trash'), (snapshot) => snapshot.items.some((item) => item.id === orphanId))
    expect(trash.items.some((item) => item.entityType === 'orphan' && item.id === orphanId)).toBe(true)
    expect((await client.request<StorageEligibility>('get-storage-eligibility')).canChangeResourceDirectory).toBe(false)
  })

  it('allows resource-directory changes only while the library is empty', async () => {
    expect(await client.request<StorageEligibility>('get-storage-eligibility')).toEqual({ canChangeResourceDirectory: true, reason: null })
    const source = join(root, 'occupy-library.txt')
    await writeFile(source, 'occupied')
    await client.request<Job>('plan', [{ path: source, kind: 'file' }])
    await waitFor(() => client.request<Job[]>('get-jobs'), (jobs) => jobs.some((job) => job.status === 'completed'))
    expect((await client.request<StorageEligibility>('get-storage-eligibility')).canChangeResourceDirectory).toBe(false)
  })

  it('migrates a two-level folder hierarchy with direct album and media parents', () => {
    const databasePath = join(root, 'folders.sqlite')
    const { sqlite } = createDatabase(databasePath)
    try {
      const columns = (table: string) => (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
      expect(columns('folders')).toEqual(expect.arrayContaining(['id', 'title', 'parent_id', 'trash_state', 'trashed_at']))
      expect(columns('albums')).toContain('folder_id')
      expect(columns('media_items')).toContain('folder_id')
      expect(columns('cosers')).toEqual(expect.arrayContaining(['id', 'name', 'avatar_updated_at']))
    } finally { sqlite.close() }
  })

  it('returns active folders as a tree with direct item counts', async () => {
    const databasePath = join(root, 'folder-tree.sqlite')
    const { sqlite } = createDatabase(databasePath)
    const now = Date.now()
    try {
      sqlite.prepare("INSERT INTO folders (id, title, parent_id, created_at, updated_at, trash_state) VALUES ('parent', '旅行', NULL, ?, ?, 'active'), ('child', '东京', 'parent', ?, ?, 'active'), ('trashed', '已删除', NULL, ?, ?, 'trashed')").run(now, now, now, now, now, now)
      sqlite.prepare("INSERT INTO albums (id, title, folder_id, created_at, updated_at, trash_state) VALUES ('parent-album', '旅行图集', 'parent', ?, ?, 'active'), ('child-album', '东京图集', 'child', ?, ?, 'active')").run(now, now, now, now)
      const insertMedia = sqlite.prepare("INSERT INTO media_items (id, content_hash, media_kind, original_name, extension, byte_size, object_path, preview_status, preview_priority, preview_version, trash_state, folder_id, imported_at) VALUES (?, ?, 'image', ?, '.png', 1, ?, 'not_requested', 0, 1, 'active', ?, ?)")
      insertMedia.run('parent-direct', 'a'.repeat(64), 'parent.png', join(root, 'parent.png'), 'parent', now)
      insertMedia.run('child-direct', 'b'.repeat(64), 'child.png', join(root, 'child.png'), 'child', now)
      insertMedia.run('child-album-media', 'c'.repeat(64), 'album.png', join(root, 'album.png'), 'child', now)
      sqlite.prepare("INSERT INTO album_items (album_id, media_id, sort_order) VALUES ('parent-album', 'child-album-media', 1), ('child-album', 'child-album-media', 1)").run()
    } finally { sqlite.close() }

    await client.dispose()
    client = new ImportWorkerClient(databasePath, root)
    const tree = await client.request<FolderTree>('get-folder-tree')
    expect(tree).toEqual([{ id: 'parent', title: '旅行', parentId: null, itemCount: 3, children: [{ id: 'child', title: '东京', parentId: 'parent', itemCount: 2, children: [] }] }])
  })

  it('organizes an unarchived media item into a two-level folder hierarchy', async () => {
    const source = join(root, 'folder-media.txt')
    await writeFile(source, 'folder media')
    await client.request<Job>('plan', [{ path: source, kind: 'file' }])
    const initial = await waitFor(() => client.request<Library>('get-library'), (library) => library.looseMedia.length === 1)
    const rootFolder = await client.request<{ id: string }>('create-folder', { title: '旅行', parentId: null })
    const childFolder = await client.request<{ id: string }>('create-folder', { title: '布鲁塞尔', parentId: rootFolder.id })
    await expect(client.request('create-folder', { title: '不允许', parentId: childFolder.id })).rejects.toThrow('最多只能创建两层文件夹')
    await client.request('move-media', { mediaId: initial.looseMedia[0]!.id, folderId: childFolder.id })
    const detail = await client.request<{ media: Array<{ id: string }> }>('get-folder', childFolder.id)
    expect(detail.media.map((media) => media.id)).toEqual([initial.looseMedia[0]!.id])
    expect((await client.request<Library>('get-library')).looseMedia).toHaveLength(0)
  })

  it('places directly imported files and folder-imported albums in the requested folder', async () => {
    const target = await client.request<{ id: string }>('create-folder', { title: '旅行', parentId: null })
    const loose = join(root, 'directly-filed.txt')
    const sourceDirectory = join(root, 'source-album')
    await mkdir(sourceDirectory)
    await writeFile(loose, 'direct')
    await writeFile(join(sourceDirectory, 'inside.txt'), 'album')
    await client.request<Job>('plan', [{ path: loose, kind: 'file', folderId: target.id }])
    const job = await client.request<Job>('plan', [{ path: sourceDirectory, kind: 'folder', folderId: target.id }])
    await waitFor(() => client.request<Job[]>('get-jobs'), (jobs) => jobs.some((item) => item.id === job.id && item.status === 'completed'))
    const detail = await waitFor(() => client.request<{ media: Array<{ originalName: string }>; albums: Array<{ title: string }> }>('get-folder', target.id), (folder) => folder.media.length === 1 && folder.albums.length === 1)
    expect(detail.media[0]!.originalName).toBe('directly-filed.txt')
    expect(detail.albums[0]!.title).toBe('source-album')
  })

  it('returns an album parent folder for navigation back to its container', async () => {
    const target = await client.request<{ id: string }>('create-folder', { title: '旅行', parentId: null })
    const sourceDirectory = join(root, 'source-album')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'inside.txt'), 'album')
    await client.request<Job>('plan', [{ path: sourceDirectory, kind: 'folder', folderId: target.id }])
    const folder = await waitFor(() => client.request<{ albums: Array<{ id: string }> }>('get-folder', target.id), (detail) => detail.albums.length === 1)

    expect(await client.request<{ folderId: string | null }>('get-album', folder.albums[0]!.id)).toMatchObject({ folderId: target.id })
  })

  it('moves standalone videos into Coser, undoes placement and restores trash ownership', async () => {
    const folder = await client.request<{ id: string }>('create-folder', { title: 'Videos', parentId: null })
    const source = join(root, 'clip.mp4'); await writeFile(source, 'video fixture')
    const job = await client.request<Job>('plan', [{ path: source, kind: 'file', folderId: folder.id }])
    await waitFor(() => client.request<Job[]>('get-jobs'), jobs => jobs.some(item => item.id === job.id && item.status === 'completed'))
    const detail = await client.request<{ media: Array<{ id: string }>; mediaCount: number }>('get-folder', folder.id)
    const id = detail.media[0]!.id
    const coser = await client.request<Coser>('create-coser', { name: 'Video owner', aliases: [] })
    const assign = () => client.request<{ operationId: string }>('assign-videos-coser', { mediaIds: [id], coserId: coser.id })
    const receipt = await assign()
    expect(await client.request('get-coser', coser.id)).toMatchObject({ videoCount: 1, mediaCount: 1, albumCount: 0, videos: [{ id }] })
    expect(await client.request<Coser[]>('get-cosers')).toContainEqual(expect.objectContaining({ id: coser.id, videoCount: 1, mediaCount: 1 }))
    expect(await client.request('get-folder', folder.id)).toMatchObject({ mediaCount: 0, media: [] })
    expect((await client.request<FolderTree>('get-folder-tree'))[0]!.itemCount).toBe(0)
    expect((await client.request<Library>('get-library')).looseMedia).toHaveLength(0)
    await client.request('undo-video-coser-assignment', receipt.operationId)
    expect(await client.request('get-folder', folder.id)).toMatchObject({ mediaCount: 1 })
    await assign()
    await client.request('trash-media', id)
    expect(await client.request('get-coser', coser.id)).toMatchObject({ videoCount: 0, mediaCount: 0 })
    expect(await client.request<Coser[]>('get-cosers')).toContainEqual(expect.objectContaining({ id: coser.id, videoCount: 0, mediaCount: 0 }))
    await client.request('restore-media', id)
    expect(await client.request('get-coser', coser.id)).toMatchObject({ videos: [{ id }] })
    await client.request('unassign-video-coser', id)
    expect((await client.request<Library>('get-library')).looseMedia).toHaveLength(1)
    await assign()
    await client.request('move-media', { mediaId: id, folderId: folder.id })
    expect(await client.request('get-coser', coser.id)).toMatchObject({ videoCount: 0 })
    await assign()
    await client.request('trash-media', id); await client.request('delete-coser', coser.id); await client.request('restore-media', id)
    expect((await client.request<Library>('get-library')).looseMedia.map(item => item.id)).toEqual([id])
  })

  it('deduplicates Coser media counts and removes direct placement on duplicate album import', async () => {
    const source = join(root, 'shared.mp4'); await writeFile(source, 'same video')
    const job = await client.request<Job>('plan', [{ path: source, kind: 'file' }])
    await waitFor(() => client.request<Job[]>('get-jobs'), jobs => jobs.some(item => item.id === job.id && item.status === 'completed'))
    const id = (await client.request<Library>('get-library')).looseMedia[0]!.id
    const coser = await client.request<Coser>('create-coser', { name: 'Shared', aliases: [] })
    await client.request('assign-videos-coser', { mediaIds: [id], coserId: coser.id })
    for (const name of ['first', 'second']) {
      const directory = join(root, name); await mkdir(directory); await writeFile(join(directory, 'shared.mp4'), 'same video')
      const next = await client.request<Job>('plan', [{ path: directory, kind: 'folder' }])
      await waitFor(() => client.request<Job[]>('get-jobs'), jobs => jobs.some(item => item.id === next.id && item.status === 'completed'))
    }
    const albums = (await client.request<Library>('get-library')).albums
    await client.request('assign-albums-coser', { albumIds: albums.map(item => item.id), coserId: coser.id })
    expect(await client.request('get-coser', coser.id)).toMatchObject({ videoCount: 0, videos: [], albumCount: 2, mediaCount: 1 })
    expect(await client.request<Coser[]>('get-cosers')).toContainEqual(expect.objectContaining({ id: coser.id, videoCount: 0, albumCount: 2, mediaCount: 1 }))
    await expect(client.request('assign-videos-coser', { mediaIds: [id], coserId: coser.id })).rejects.toThrow('图集')
  })

  it('returns grouped summaries for a library with 20 Cosers and 200 albums', async () => {
    const db = createDatabase(join(root, 'gallery.sqlite')).sqlite
    const now = Date.now()
    const coserRows = Array.from({ length: 20 }, (_, index) => ({ id: randomUUID(), name: `Coser ${index}`, key: `coser-${index}` }))
    const insertCoser = db.prepare('INSERT INTO cosers (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    const insertAlbum = db.prepare('INSERT INTO albums (id, title, created_at, updated_at, coser_id) VALUES (?, ?, ?, ?, ?)')
    db.transaction(() => {
      coserRows.forEach((coser, index) => insertCoser.run(coser.id, coser.name, coser.key, now + index, now + index))
      for (let index = 0; index < 200; index += 1) {
        const coser = coserRows[index % coserRows.length]!
        insertAlbum.run(randomUUID(), `Album ${index}`, now + index, now + index, coser.id)
      }
    })()
    db.close()

    const summaries = await client.request<Coser[]>('get-cosers')
    expect(summaries).toHaveLength(20)
    expect(summaries.every((coser) => coser.albumCount === 10 && coser.videoCount === 0 && coser.mediaCount === 0)).toBe(true)
    const detail = await client.request<Coser & { albums: Array<{ id: string }> }>('get-coser', coserRows[0]!.id)
    expect(detail.albums).toHaveLength(10)
  })

  it('groups an album under one Coser and hides it from folders and the library', async () => {
    const target = await client.request<{ id: string }>('create-folder', { title: '待归类', parentId: null })
    const sourceDirectory = join(root, 'coser-album')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'inside.txt'), 'album')
    const job = await client.request<Job>('plan', [{ path: sourceDirectory, kind: 'folder', folderId: target.id }])
    await waitFor(() => client.request<Job[]>('get-jobs'), (jobs) => jobs.some((item) => item.id === job.id && item.status === 'completed'))
    const initialFolder = await waitFor(() => client.request<{ albums: Array<{ id: string }> }>('get-folder', target.id), (detail) => detail.albums.length === 1)
    const albumId = initialFolder.albums[0]!.id

    const coser = await client.request<Coser>('create-coser', { name: '林柚', aliases: ['Yuzu', '柚子'] })
    expect(coser).toMatchObject({ name: '林柚', aliases: ['Yuzu', '柚子'], albumCount: 0 })
    await expect(client.request('create-coser', { name: '其他人', aliases: ['yuzu'] })).rejects.toThrow('名称或别名已被其他 Coser 使用')
    await client.request('assign-album-coser', { albumId, coserId: coser.id })

    expect((await client.request<Library>('get-library')).albums).not.toContainEqual(expect.objectContaining({ id: albumId }))
    expect((await client.request<{ albums: Array<{ id: string }> }>('get-folder', target.id)).albums).toHaveLength(0)
    expect(await client.request<Coser>('get-coser', coser.id)).toMatchObject({ id: coser.id, albumCount: 1, mediaCount: 1, albums: [{ id: albumId }] })
    expect(await client.request<Coser[]>('get-cosers')).toContainEqual(expect.objectContaining({ id: coser.id, aliases: ['Yuzu', '柚子'], albumCount: 1, videoCount: 0, mediaCount: 1 }))

    await client.request('unassign-album-coser', albumId)
    expect((await client.request<Library>('get-library')).albums).toContainEqual(expect.objectContaining({ id: albumId }))
    await client.request('assign-album-coser', { albumId, coserId: coser.id })
    await client.request('delete-coser', coser.id)
    expect((await client.request<Library>('get-library')).albums).toContainEqual(expect.objectContaining({ id: albumId }))
    await expect(client.request('get-coser', coser.id)).rejects.toThrow('Coser 不存在')
  })

  it('persists smart import mappings and model cache across worker restarts', async () => {
    const coser = await client.request<Coser>('create-coser', { name: '智能映射测试', aliases: ['Smart Alias'] })
    const mappingSignature = 'a'.repeat(64)
    const cacheSignature = 'b'.repeat(64)
    const cachedResult = JSON.stringify({ status: 'unknown', coserId: 'none', proposedName: '', evidence: 'unknown folder', reason: 'no candidate' })
    await client.request('set-smart-coser-mapping', { signature: mappingSignature, coserId: coser.id })
    await client.request('set-smart-coser-model-cache', { signature: cacheSignature, result: cachedResult })
    expect(await client.request<Array<{ id: string; aliases: string[] }>>('get-smart-coser-index')).toContainEqual(expect.objectContaining({ id: coser.id, aliases: ['Smart Alias'] }))

    await client.dispose()
    client = new ImportWorkerClient(join(root, 'gallery.sqlite'), root)

    expect(await client.request('get-smart-coser-mapping', { signature: mappingSignature })).toBe(coser.id)
    expect(await client.request('get-smart-coser-mappings', [mappingSignature])).toEqual({ [mappingSignature]: coser.id })
    expect(await client.request('get-smart-coser-model-cache', { signature: cacheSignature })).toBe(cachedResult)
  })

  it('only exposes current Coser album images as avatar sources', async () => {
    const sourceDirectory = join(root, 'avatar-source-album')
    const sourceImage = join(sourceDirectory, 'portrait.png')
    await mkdir(sourceDirectory)
    await sharp({ create: { width: 64, height: 96, channels: 3, background: '#8b5cf6' } }).png().toFile(sourceImage)
    await client.request<Job>('plan', [{ path: sourceDirectory, kind: 'folder' }])
    const library = await waitFor(() => client.request<Library>('get-library'), (snapshot) => snapshot.albums.length === 1)
    await waitFor(() => client.request<{ media: unknown[] }>('get-album', library.albums[0]!.id), (album) => album.media.length === 1)
    const coser = await client.request<Coser>('create-coser', { name: '头像来源', aliases: [] })
    const other = await client.request<Coser>('create-coser', { name: '其他来源', aliases: [] })
    await client.request('assign-album-coser', { albumId: library.albums[0]!.id, coserId: coser.id })

    const media = await client.request<Array<{ id: string; mediaKind: string }>>('get-coser-avatar-media', coser.id)
    expect(media).toHaveLength(1)
    expect(media[0]?.mediaKind).toBe('image')
    const storedPath = await client.request<string>('get-coser-avatar-source', { coserId: coser.id, mediaId: media[0]!.id })
    await access(storedPath)
    await expect(client.request('get-coser-avatar-source', { coserId: other.id, mediaId: media[0]!.id })).rejects.toThrow('头像来源不是当前 Coser 图包中的可用图片')
  })

  it('trashes and restores a folder together with its direct media', async () => {
    const source = join(root, 'folder-trash.txt')
    await writeFile(source, 'trash me')
    const folder = await client.request<{ id: string }>('create-folder', { title: '待删除', parentId: null })
    await client.request<Job>('plan', [{ path: source, kind: 'file', folderId: folder.id }])
    await waitFor(() => client.request<{ media: unknown[] }>('get-folder', folder.id), (detail) => detail.media.length === 1)
    await client.request('trash-folder', folder.id)
    const trash = await waitFor(() => client.request<Trash>('get-trash'), (snapshot) => snapshot.items.some((item) => item.entityType === 'folder' && item.id === folder.id))
    expect(trash.items.some((item) => item.entityType === 'folder' && item.id === folder.id)).toBe(true)
    await client.request('restore-folder', folder.id)
    expect((await client.request<{ media: unknown[] }>('get-folder', folder.id)).media).toHaveLength(1)
  })

  it('returns an object path only for an active media item', async () => {
    const source = join(root, 'viewable.txt')
    await writeFile(source, 'viewable')
    await client.request<Job>('plan', [{ path: source, kind: 'file' }])
    const library = await waitFor(() => client.request<Library>('get-library'), (snapshot) => snapshot.looseMedia.length === 1)
    const mediaId = library.looseMedia[0]!.id
    const path = await client.request<string>('get-media-path', mediaId)
    expect(await readFile(path, 'utf8')).toBe('viewable')
    await client.request('trash-media', mediaId)
    await expect(client.request('get-media-path', mediaId)).rejects.toThrow('媒体不存在或不可查看')
    await expect(client.request('get-media-path', randomUUID())).rejects.toThrow('媒体不存在或不可查看')
  })
})
