import type { PlaybackVideoRange } from './types'

export const PLAYBACK_XP_INTERVAL_MS = 10_000
export const PLAYBACK_IMAGE_COMPLETE_MS = 3_000

export function mergePlaybackRanges(ranges: PlaybackVideoRange[], incoming: PlaybackVideoRange): PlaybackVideoRange[] {
  if (!Number.isFinite(incoming.startMs) || !Number.isFinite(incoming.endMs)) return ranges
  const startMs = Math.max(0, Math.floor(incoming.startMs))
  const endMs = Math.max(startMs, Math.floor(incoming.endMs))
  if (endMs <= startMs) return ranges
  const sorted = [...ranges, { startMs, endMs }].filter((range) => Number.isFinite(range.startMs) && Number.isFinite(range.endMs) && range.endMs > range.startMs)
    .map((range) => ({ startMs: Math.max(0, Math.floor(range.startMs)), endMs: Math.floor(range.endMs) }))
    .sort((a, b) => a.startMs - b.startMs)
  const merged: PlaybackVideoRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.startMs <= previous.endMs) previous.endMs = Math.max(previous.endMs, range.endMs)
    else merged.push(range)
  }
  return merged
}

export function playbackRangeCoverage(ranges: PlaybackVideoRange[], durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  const merged = ranges.reduce<PlaybackVideoRange[]>((result, range) => mergePlaybackRanges(result, range), [])
  const watchedMs = merged.reduce((total, range) => total + Math.max(0, Math.min(durationMs, range.endMs) - Math.max(0, range.startMs)), 0)
  return Math.min(1, watchedMs / durationMs)
}

export function playbackMediaComplete(kind: 'image' | 'video', watchedMs: number, ranges: PlaybackVideoRange[], durationMs: number): boolean {
  if (kind === 'image') return watchedMs >= PLAYBACK_IMAGE_COMPLETE_MS
  return playbackRangeCoverage(ranges, durationMs) >= 0.9
}

export function playbackLevel(xp: number): { level: number; xpInLevel: number; xpToNextLevel: number } {
  const earnedXp = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0))
  const xpInLevel = earnedXp % 100
  return { level: Math.floor(earnedXp / 100) + 1, xpInLevel, xpToNextLevel: 100 - xpInLevel }
}

export function playbackXpFor(totalWatchedMs: number): number {
  return Math.floor(Math.max(0, Number.isFinite(totalWatchedMs) ? totalWatchedMs : 0) / PLAYBACK_XP_INTERVAL_MS)
}

