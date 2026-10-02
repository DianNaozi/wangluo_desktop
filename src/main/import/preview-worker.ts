import sharp from 'sharp'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { createDatabase } from './database'
import type { PreviewProgressEvent } from './types'
import { runBoundedProcess } from './process-runner'

type WorkerConfig = { databasePath: string; storagePath: string }
type Request = { id: string; command: 'rebuild' | 'retry' | 'wake'; payload?: unknown }
type PreviewRow = { id: string; content_hash: string; media_kind: 'image' | 'video'; object_path: string }

const config = workerData as WorkerConfig
if (!parentPort) throw new Error('Preview worker must be started with a parent port')
if (!ffmpegPath) throw new Error('FFmpeg binary is unavailable')
const ffmpegExecutable = ffmpegPath
const parent = parentPort
const { sqlite } = createDatabase(config.databasePath)
// Preview recovery belongs to this worker; opening the database must not alter
// import-job state in another worker.
sqlite.prepare("UPDATE media_items SET preview_status = 'pending', preview_error = NULL WHERE preview_status = 'generating'").run()
const thumbnailDirectory = join(config.storagePath, 'thumbnails')
const ffprobePath = (ffprobeStatic as unknown as { path: string }).path
const FFPROBE_TIMEOUT_MS = 15_000
const FFMPEG_TIMEOUT_MS = 60_000
const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024
let pumping = false
let scheduled: NodeJS.Timeout | undefined

function reply(id: string, result: unknown): void { parent.postMessage({ type: 'response', id, result }) }
function replyError(id: string, error: unknown): void { reply(id, { error: error instanceof Error ? error.message : String(error) }) }
function publish(event: PreviewProgressEvent): void { parent.postMessage({ type: 'progress', event }) }
function importsAreActive(): boolean {
  return Boolean(sqlite.prepare("SELECT 1 FROM import_jobs WHERE status IN ('planned', 'queued', 'running') LIMIT 1").get())
}
function claimNext(): PreviewRow | undefined {
  if (importsAreActive()) return undefined
  return sqlite.transaction(() => {
    const candidate = sqlite.prepare("SELECT id, content_hash, media_kind, object_path FROM media_items WHERE trash_state = 'active' AND preview_status = 'pending' AND media_kind IN ('image', 'video') ORDER BY preview_priority ASC, imported_at DESC LIMIT 1").get() as PreviewRow | undefined
    if (!candidate) return undefined
    const changed = sqlite.prepare("UPDATE media_items SET preview_status = 'generating', preview_error = NULL WHERE id = ? AND preview_status = 'pending' AND trash_state = 'active'").run(candidate.id)
    return changed.changes ? candidate : undefined
  })()
}
type DurationProbe = { duration: number | null; error: string | null }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
async function getDuration(input: string): Promise<DurationProbe> {
  try {
    const { stdout: output } = await runBoundedProcess(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input], { timeoutMs: FFPROBE_TIMEOUT_MS, maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES })
    const duration = Number.parseFloat(output.trim())
    return { duration: Number.isFinite(duration) && duration > 0 ? duration : null, error: null }
  } catch (error) { return { duration: null, error: errorMessage(error) } }
}
async function createVideoPreview(input: string, output: string): Promise<void> {
  const probe = await getDuration(input)
  const offset = probe.duration ? Math.max(0, Math.min(probe.duration * 0.1, Math.max(0, probe.duration - 0.05))) : 0
  const writeFrame = async (at: number): Promise<void> => {
    await runBoundedProcess(ffmpegExecutable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(at), '-i', input, '-frames:v', '1', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', '-c:v', 'libwebp', '-q:v', '82', output], { timeoutMs: FFMPEG_TIMEOUT_MS, maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES })
    // FFmpeg can exit successfully without emitting a frame after seeking.
    const metadata = await sharp(await readFile(output)).metadata()
    if (!metadata.width || !metadata.height) throw new Error('视频截帧未生成有效图片')
  }
  try { await writeFrame(offset) } catch (error) {
    if (offset <= 0) throw new Error(`${probe.error ? `FFprobe：${probe.error}\n` : ''}FFmpeg：${errorMessage(error)}`)
    await rm(output, { force: true })
    try { await writeFrame(0) } catch (fallbackError) {
      throw new Error(`${probe.error ? `FFprobe：${probe.error}\n` : ''}FFmpeg（${offset.toFixed(2)} 秒）：${errorMessage(error)}\nFFmpeg（首帧回退）：${errorMessage(fallbackError)}`)
    }
  }
}
async function generate(row: PreviewRow): Promise<void> {
  const output = join(thumbnailDirectory, `${row.content_hash}.webp`)
  const temporary = join(thumbnailDirectory, `${row.content_hash}.${randomUUID()}.tmp.webp`)
  try {
    await mkdir(thumbnailDirectory, { recursive: true })
    const exists = await access(output).then(() => true).catch(() => false)
    if (!exists) {
      if (row.media_kind === 'image') {
        await sharp(row.object_path, { animated: false, failOn: 'none' })
          .rotate()
          .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(temporary)
      } else await createVideoPreview(row.object_path, temporary)
      const appeared = await access(output).then(() => true).catch(() => false)
      if (appeared) await rm(temporary, { force: true }); else await rename(temporary, output)
    }
    sqlite.prepare("UPDATE media_items SET preview_status = 'ready', preview_error = NULL, preview_updated_at = ?, preview_version = 1 WHERE id = ? AND trash_state = 'active'").run(Date.now(), row.id)
    publish({ mediaId: row.id, status: 'ready' })
  } catch (error) {
    await rm(temporary, { force: true })
    const message = errorMessage(error)
    sqlite.prepare("UPDATE media_items SET preview_status = 'failed', preview_error = ?, preview_updated_at = ? WHERE id = ? AND trash_state = 'active'").run(message.slice(0, 2000), Date.now(), row.id)
    publish({ mediaId: row.id, status: 'failed' })
  }
}
function schedule(delay = 1000): void {
  if (scheduled) return
  scheduled = setTimeout(() => { scheduled = undefined; void pump() }, delay)
}
function wake(): void {
  if (scheduled) {
    clearTimeout(scheduled)
    scheduled = undefined
  }
  schedule(0)
}
async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    let row: PreviewRow | undefined
    while ((row = claimNext())) await generate(row)
  } finally {
    pumping = false
    schedule(importsAreActive() ? 1500 : 1000)
  }
}
function rebuild(): number {
  const result = sqlite.prepare("UPDATE media_items SET preview_status = 'pending', preview_error = NULL, preview_priority = 100 WHERE trash_state = 'active' AND media_kind IN ('image', 'video') AND (preview_status = 'failed' OR preview_status = 'ready' OR preview_version <> 1)").run()
  schedule(0)
  return result.changes
}
async function retry(mediaId: unknown): Promise<boolean> {
  if (typeof mediaId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaId)) throw new Error('媒体标识无效')
  const row = sqlite.prepare("SELECT content_hash FROM media_items WHERE id = ? AND trash_state = 'active' AND media_kind IN ('image', 'video') AND preview_status IN ('failed', 'ready')").get(mediaId) as { content_hash: string } | undefined
  if (!row) return false
  await rm(join(thumbnailDirectory, `${row.content_hash}.webp`), { force: true })
  const result = sqlite.prepare("UPDATE media_items SET preview_status = 'pending', preview_error = NULL, preview_priority = 0 WHERE id = ? AND trash_state = 'active' AND media_kind IN ('image', 'video') AND preview_status IN ('failed', 'ready')").run(mediaId)
  if (result.changes) {
    publish({ mediaId, status: 'pending' })
    wake()
  }
  return result.changes > 0
}

async function handleRequest(request: Request): Promise<void> {
  try {
    if (request.command === 'rebuild') reply(request.id, rebuild())
    else if (request.command === 'retry') reply(request.id, await retry(request.payload))
    else if (request.command === 'wake') { wake(); reply(request.id, true) }
  } catch (error) { replyError(request.id, error) }
}

async function initialize(): Promise<void> {
  // Retry only executable-start failures, once on startup after the binary is
  // repaired. Invalid media must not be retried in an endless queue.
  try {
    await runBoundedProcess(ffmpegExecutable, ['-version'], { timeoutMs: FFPROBE_TIMEOUT_MS, maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES })
    sqlite.prepare(`UPDATE media_items SET preview_status = 'pending', preview_error = NULL
      WHERE trash_state = 'active' AND media_kind = 'video' AND preview_status = 'failed'
      AND (preview_error LIKE '%spawn%EFTYPE%' OR preview_error LIKE '%spawn%ENOENT%'
        OR preview_error LIKE '%spawn%EACCES%' OR preview_error LIKE '%spawn%ENOEXEC%')`).run()
  } catch { /* Individual video tasks retain their failure details; images still work. */ }
  parent.on('message', (request: Request) => { void handleRequest(request) })
  schedule(0)
}
void initialize()
