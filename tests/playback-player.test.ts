import { describe, expect, it } from 'vitest'
import { shouldRestartVideo } from '../src/renderer/src/utils/playback-player'

describe('video playback loop', () => {
  it('restarts a single queued video when loop mode is enabled', () => {
    expect(shouldRestartVideo(1, true)).toBe(true)
  })

  it('uses normal queue navigation for multi-item queues or when looping is disabled', () => {
    expect(shouldRestartVideo(2, true)).toBe(false)
    expect(shouldRestartVideo(1, false)).toBe(false)
  })
})
