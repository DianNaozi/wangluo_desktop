import { describe, expect, it } from 'vitest'
import { mergePlaybackRanges, playbackLevel, playbackMediaComplete, playbackRangeCoverage, playbackXpFor } from '../src/main/import/playback-rewards'

describe('playback rewards', () => {
  it('merges overlaps but keeps skipped video ranges separate', () => {
    const ranges = mergePlaybackRanges([{ startMs: 0, endMs: 2_000 }], { startMs: 1_000, endMs: 4_000 })
    expect(mergePlaybackRanges(ranges, { startMs: 8_000, endMs: 10_000 })).toEqual([{ startMs: 0, endMs: 4_000 }, { startMs: 8_000, endMs: 10_000 }])
    expect(playbackRangeCoverage([{ startMs: 0, endMs: 4_000 }, { startMs: 8_000, endMs: 10_000 }], 10_000)).toBe(0.6)
  })

  it('marks images after three seconds and videos after ninety percent of actual coverage', () => {
    expect(playbackMediaComplete('image', 2_999, [], 0)).toBe(false)
    expect(playbackMediaComplete('image', 3_000, [], 0)).toBe(true)
    expect(playbackMediaComplete('video', 9_000, [{ startMs: 0, endMs: 8_999 }], 10_000)).toBe(false)
    expect(playbackMediaComplete('video', 5_000, [{ startMs: 0, endMs: 9_000 }], 10_000)).toBe(true)
    expect(playbackRangeCoverage([{ startMs: 0, endMs: 6_000 }, { startMs: 5_000, endMs: 9_000 }], 10_000)).toBe(0.9)
    expect(playbackRangeCoverage([{ startMs: 0, endMs: 6_000 }, { startMs: 5_000, endMs: 8_000 }], 10_000)).toBe(0.8)
  })

  it('awards one XP per ten seconds and starts a new level every one hundred XP', () => {
    expect(playbackXpFor(9_999)).toBe(0)
    expect(playbackXpFor(10_000)).toBe(1)
    expect(playbackXpFor(125_000)).toBe(12)
    expect(playbackLevel(99)).toEqual({ level: 1, xpInLevel: 99, xpToNextLevel: 1 })
    expect(playbackLevel(100)).toEqual({ level: 2, xpInLevel: 0, xpToNextLevel: 100 })
  })
})
