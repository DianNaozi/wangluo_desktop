import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { createDatabase } from '../src/main/import/database'

type Job = { id: string; status: string; totalEntries: number; importedEntries: number; sourceCleanupFailedEntries: number }
type Library = { totals: { all: number }; albums: Array<{ id: string }>; looseMedia: Array<{ id: string }> }
type Trash = { items: Array<{ id: string; entityType: string }> }
type StorageEligibility = { canChangeResourceDirectory: boolean; reason: string | null }

class ImportWorkerClient {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(reason: Error): void }>()
  readonly worker: Worker
  progressEvents = 0
  failNextSourceDisposal = false

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
        void rm(message.request.sourcePath, { force: true }).then(
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
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
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
})
