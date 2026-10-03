import { performance } from 'node:perf_hooks'
import type { BrowserWindow } from 'electron'
import type { PlaybackCheckpoint, PlaybackCheckpointMedia, PlaybackSample, PlaybackStats } from './import/types'

type ActiveSample = PlaybackSample & { at: number; foreground: boolean }
type PendingMedia = PlaybackCheckpointMedia
type Session = {
  last: ActiveSample | null
  lastSampleSequence: number
  nextCheckpointSequence: number
  lastSavedAt: number
  watchedDeltaMs: number
  pending: Map<string, PendingMedia>
  flushing?: Promise<PlaybackStats | null>
  ending?: Promise<PlaybackStats | null>
  retryTimer?: ReturnType<typeof setTimeout>
}
type PlaybackSampleResult = { acceptedWallMs: number; stats: PlaybackStats | null; error?: string }

const CHECKPOINT_INTERVAL_MS = 5_000
const MAX_SAMPLE_GAP_MS = 1_500

function progressKey(entryId: string, mediaId: string): string { return `${entryId}\u0000${mediaId}` }
function isEligible(sample: PlaybackSample, foreground: boolean): boolean {
  return foreground && sample.ready && sample.playing && !sample.waiting && !sample.seeking && !sample.error
}

export class PlaybackTracker {
  private readonly sessions = new Map<string, Session>()
  constructor(private readonly persist: (checkpoint: PlaybackCheckpoint) => Promise<PlaybackStats>, private readonly now: () => number = () => performance.now()) {}

  begin(sessionId: string): void {
    if (!sessionId || sessionId.length > 200 || this.sessions.has(sessionId)) return
    this.sessions.set(sessionId, { last: null, lastSampleSequence: 0, nextCheckpointSequence: 1, lastSavedAt: this.now(), watchedDeltaMs: 0, pending: new Map() })
  }

  private async flush(sessionId: string, session: Session): Promise<PlaybackStats | null> {
    if (session.flushing) return session.flushing
    if (!session.pending.size && session.watchedDeltaMs === 0) return null
    const media = [...session.pending.values()].map((item) => ({ ...item, videoRanges: item.videoRanges.map((range) => ({ ...range })) }))
    const watchedDeltaMs = session.watchedDeltaMs
    session.pending.clear()
    session.watchedDeltaMs = 0
    const checkpoint: PlaybackCheckpoint = { sessionId, sequence: session.nextCheckpointSequence, watchedDeltaMs, media }
    const running = this.persist(checkpoint).then((stats) => {
      session.nextCheckpointSequence += 1
      session.lastSavedAt = this.now()
      return stats
    }).catch((error: unknown) => {
      for (const item of media) {
        const key = progressKey(item.entryId, item.mediaId)
        const current = session.pending.get(key)
        if (!current) session.pending.set(key, item)
        else {
          current.watchedDeltaMs += item.watchedDeltaMs
          current.videoRanges.push(...item.videoRanges)
          current.imageElapsedMs = item.imageElapsedMs
          current.positionMs = item.positionMs
          current.durationMs = item.durationMs
          current.watchedAt = Math.max(current.watchedAt, item.watchedAt)
        }
      }
      session.watchedDeltaMs += watchedDeltaMs
      throw error
    }).finally(() => { session.flushing = undefined })
    session.flushing = running
    return running
  }

  async sample(sessionId: string, sample: PlaybackSample, window: BrowserWindow | null): Promise<PlaybackSampleResult> {
    const session = this.sessions.get(sessionId)
    if (!session || sessionId !== sample.sessionId || !Number.isSafeInteger(sample.sequence) || sample.sequence <= session.lastSampleSequence) return { acceptedWallMs: 0, stats: null }
    session.lastSampleSequence = sample.sequence
    const now = this.now()
    const foreground = Boolean(window && !window.isDestroyed() && window.isFocused() && !window.isMinimized())
    const current: ActiveSample = { ...sample, at: now, foreground }
    const previous = session.last
    session.last = current
    let acceptedWallMs = 0
    if (previous && previous.entryId === current.entryId && previous.mediaId === current.mediaId) {
      const elapsed = Math.floor(now - previous.at)
      const readyForThisInterval = current.ready && !current.waiting && !current.error && !current.seeking
      let videoRange: { startMs: number; endMs: number } | null = null
      if (elapsed > 0 && elapsed <= MAX_SAMPLE_GAP_MS && isEligible(previous, previous.foreground) && foreground && readyForThisInterval) {
        if (current.mediaType === 'image') {
          acceptedWallMs = elapsed
        } else if (previous.playing && previous.mediaType === 'video' && current.mediaType === 'video') {
          const mediaAdvance = current.positionMs - previous.positionMs
          const maximumAdvance = elapsed * Math.min(2, Math.max(0.5, current.playbackRate)) + 250
          if (current.playing && mediaAdvance > 0 && mediaAdvance <= maximumAdvance) {
            acceptedWallMs = elapsed
            videoRange = { startMs: previous.positionMs, endMs: current.positionMs }
          } else if (!current.playing && mediaAdvance > 0 && mediaAdvance <= maximumAdvance) {
            // Capture the last short segment on pause/end while still rejecting seeks.
            acceptedWallMs = elapsed
            videoRange = { startMs: previous.positionMs, endMs: current.positionMs }
          }
        }
      }
      const imageSnapshotChanged = current.mediaType === 'image' && current.ready && foreground && current.imageElapsedMs !== previous.imageElapsedMs
      if (acceptedWallMs > 0 || imageSnapshotChanged) {
        const key = progressKey(current.entryId, current.mediaId)
        const pending = session.pending.get(key)
        const position = Math.max(0, Math.floor(current.positionMs))
        if (pending) {
          pending.watchedDeltaMs += acceptedWallMs
          pending.imageElapsedMs = Math.max(0, Math.floor(current.imageElapsedMs))
          pending.positionMs = position
          pending.durationMs = Math.max(0, Math.floor(current.durationMs))
          pending.watchedAt = Date.now()
          if (videoRange) pending.videoRanges.push(videoRange)
        } else {
          session.pending.set(key, {
            entryId: current.entryId, mediaId: current.mediaId, watchedDeltaMs: acceptedWallMs,
            imageElapsedMs: Math.max(0, Math.floor(current.imageElapsedMs)), positionMs: position,
            durationMs: Math.max(0, Math.floor(current.durationMs)), videoRanges: videoRange ? [videoRange] : [], watchedAt: Date.now()
          })
        }
        session.watchedDeltaMs += acceptedWallMs
      }
    }
    if (now - session.lastSavedAt >= CHECKPOINT_INTERVAL_MS && (session.pending.size > 0 || session.watchedDeltaMs > 0)) {
      try { return { acceptedWallMs, stats: await this.flush(sessionId, session) } }
      catch (error) { return { acceptedWallMs, stats: null, error: error instanceof Error ? error.message : String(error) } }
    }
    return { acceptedWallMs, stats: null }
  }

  async end(sessionId: string): Promise<PlaybackStats | null> {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    if (session.ending) return session.ending
    if (session.retryTimer) { clearTimeout(session.retryTimer); session.retryTimer = undefined }
    const ending = (async () => {
      try {
        let stats: PlaybackStats | null = null
        do {
          stats = await this.flush(sessionId, session) ?? stats
        } while (session.pending.size > 0 || session.watchedDeltaMs > 0)
        this.sessions.delete(sessionId)
        return stats
      } catch (error) {
        if (this.sessions.get(sessionId) === session && !session.retryTimer) {
          session.retryTimer = setTimeout(() => {
            session.retryTimer = undefined
            void this.end(sessionId).catch(() => undefined)
          }, 5_000)
          session.retryTimer.unref?.()
        }
        throw error
      } finally { session.ending = undefined }
    })()
    session.ending = ending
    return ending
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.end(sessionId)))
  }
}
