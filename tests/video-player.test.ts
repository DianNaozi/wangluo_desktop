import { describe, expect, it } from 'vitest'
import { seekTime, videoShortcut, videoTime } from '../src/renderer/src/utils/video-player'

describe('video controls', () => {
  it('formats unloaded metadata, hours and fractional times', () => {
    expect(videoTime(NaN)).toBe('0:00'); expect(videoTime(Infinity)).toBe('0:00')
    expect(videoTime(65.9)).toBe('1:05'); expect(videoTime(3661)).toBe('1:01:01')
  })
  it('clamps seeks and rejects unknown duration', () => {
    expect(seekTime(-5, 20)).toBe(0); expect(seekTime(25, 20)).toBe(20)
    expect(seekTime(10, 20)).toBe(10)
    for (const duration of [0, NaN, Infinity, -1]) expect(seekTime(1, duration)).toBeNull()
  })
  it('maps video arrows to seeking and preserves unrelated keys', () => {
    expect(videoShortcut('ArrowLeft')).toBe('back'); expect(videoShortcut('ArrowRight')).toBe('forward')
    expect(videoShortcut(' ')).toBe('play'); expect(videoShortcut('M')).toBe('mute')
    expect(videoShortcut('f')).toBe('fullscreen'); expect(videoShortcut('Escape')).toBe('escape')
    expect(videoShortcut('Tab')).toBeNull()
  })
})
