import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import type { PlaybackSample, PlaybackStats } from '../src/main/import/types'
import { PlaybackTracker } from '../src/main/playback-tracker'

const blankStats = (): PlaybackStats => ({
  totalWatchedMs: 0, xp: 0, level: 1, xpInLevel: 0, xpToNextLevel: 100, imageIntervalSeconds: 5, loop: true,
  queue: [], cursorEntryId: null, cursorMediaId: null, progress: [], achievements: [], lastPlayedEntryId: null, lastPlayedMediaId: null, days: []
})

function sample(sequence: number, mediaId = 'image', changes: Partial<PlaybackSample> = {}): PlaybackSample {
  return {
    sessionId: 'session', sequence, entryId: 'album:one', mediaId, mediaType: mediaId === 'video' ? 'video' : 'image',
    ready: true, playing: true, waiting: false, seeking: false, error: false, positionMs: 0, durationMs: mediaId === 'video' ? 10_000 : 5_000,
    imageElapsedMs: 0, playbackRate: 1, ...changes
  }
}

describe('playback session tracking', () => {
  it('counts only ready foreground playback and freezes elapsed time on pause and blur', async () => {
    let now = 0
    let focused = true
    const checkpoints: unknown[] = []
    const stats = new PlaybackTracker(async (checkpoint) => { checkpoints.push(checkpoint); return blankStats() }, () => now)
    const window = { isDestroyed: () => false, isFocused: () => focused, isMinimized: () => false } as unknown as BrowserWindow
    stats.begin('session')
    await stats.sample('session', sample(1), window)
    now = 1_000
    expect((await stats.sample('session', sample(2), window)).acceptedWallMs).toBe(1_000)
    now = 2_000
    expect((await stats.sample('session', sample(3, 'image', { playing: false }), window)).acceptedWallMs).toBe(1_000)
    now = 3_000
    expect((await stats.sample('session', sample(4, 'image', { playing: false }), window)).acceptedWallMs).toBe(0)
    now = 4_000
    expect((await stats.sample('session', sample(5), window)).acceptedWallMs).toBe(0)
    focused = false
    now = 5_000
    expect((await stats.sample('session', sample(6), window)).acceptedWallMs).toBe(0)
    focused = true
    now = 6_000
    expect((await stats.sample('session', sample(7), window)).acceptedWallMs).toBe(0)
    now = 7_000
    expect((await stats.sample('session', sample(8), window)).acceptedWallMs).toBe(1_000)
    await stats.end('session')
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints.reduce((total, item) => total + (item as { watchedDeltaMs: number }).watchedDeltaMs, 0)).toBe(3_000)
  })

  it('discards time gaps over 1.5 seconds and rejects seeking jumps from viewed ranges', async () => {
    let now = 0
    const checkpoints: Array<{ watchedDeltaMs: number; media: Array<{ videoRanges: Array<{ startMs: number; endMs: number }> }> }> = []
    const tracker = new PlaybackTracker(async (checkpoint) => { checkpoints.push(checkpoint); return blankStats() }, () => now)
    const window = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false } as unknown as BrowserWindow
    tracker.begin('session')
    await tracker.sample('session', sample(1, 'video'), window)
    now = 1_000
    expect((await tracker.sample('session', sample(2, 'video', { positionMs: 1_000 }), window)).acceptedWallMs).toBe(1_000)
    now = 2_000
    await tracker.sample('session', sample(3, 'video', { positionMs: 9_000, seeking: true }), window)
    now = 3_000
    await tracker.sample('session', sample(4, 'video', { positionMs: 9_000 }), window)
    now = 7_000
    expect((await tracker.sample('session', sample(5, 'video', { positionMs: 10_000 }), window)).acceptedWallMs).toBe(0)
    await tracker.end('session')
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]?.watchedDeltaMs).toBe(1_000)
    expect(checkpoints[0]?.media[0]?.videoRanges).toEqual([{ startMs: 0, endMs: 1_000 }])
  })

  it('uses monotonically increasing sample sequences to ignore duplicates', async () => {
    let now = 0
    const tracker = new PlaybackTracker(async () => blankStats(), () => now)
    const window = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false } as unknown as BrowserWindow
    tracker.begin('session')
    await tracker.sample('session', sample(1), window)
    now = 1_000
    expect((await tracker.sample('session', sample(2), window)).acceptedWallMs).toBe(1_000)
    now = 2_000
    expect((await tracker.sample('session', sample(2), window)).acceptedWallMs).toBe(0)
  })

  it('persists a zero-credit image countdown reset after a completed visit', async () => {
    let now = 0
    const checkpoints: Array<{ watchedDeltaMs: number; media: Array<{ watchedDeltaMs: number; imageElapsedMs: number }> }> = []
    const tracker = new PlaybackTracker(async (checkpoint) => { checkpoints.push(checkpoint); return blankStats() }, () => now)
    const window = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false } as unknown as BrowserWindow
    tracker.begin('session')
    await tracker.sample('session', sample(1, 'image', { imageElapsedMs: 0 }), window)
    now = 1_000
    await tracker.sample('session', sample(2, 'image', { imageElapsedMs: 1_000 }), window)
    now = 5_000
    await tracker.sample('session', sample(3, 'image', { playing: false, imageElapsedMs: 1_000 }), window)
    now = 5_010
    await tracker.sample('session', sample(4, 'image', { playing: false, imageElapsedMs: 0 }), window)
    await tracker.end('session')

    expect(checkpoints.at(-1)?.media[0]?.watchedDeltaMs).toBe(0)
    expect(checkpoints.at(-1)?.media).toEqual([expect.objectContaining({ watchedDeltaMs: 0, imageElapsedMs: 0 })])
  })

  it('keeps failed checkpoints and retries them on the next flush', async () => {
    let now = 0
    let attempts = 0
    const tracker = new PlaybackTracker(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary database error')
      return blankStats()
    }, () => now)
    const window = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false } as unknown as BrowserWindow
    tracker.begin('session')
    await tracker.sample('session', sample(1), window)
    now = 1_000
    await tracker.sample('session', sample(2), window)

    await expect(tracker.end('session')).rejects.toThrow('temporary database error')
    now = 6_000
    await tracker.sample('session', sample(3), window)
    await tracker.end('session')

    expect(attempts).toBe(2)
  })
})
