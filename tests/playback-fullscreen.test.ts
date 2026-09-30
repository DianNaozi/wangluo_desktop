import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { createPlaybackFullscreen } from '../src/main/playback-fullscreen'

class TestWindow extends EventEmitter {
  fullscreen = false
  transitions: boolean[] = []
  isDestroyed() { return false }
  isFullScreen() { return this.fullscreen }
  setFullScreen(value: boolean) {
    this.transitions.push(value)
    setTimeout(() => {
      this.fullscreen = value
      this.emit(value ? 'enter-full-screen' : 'leave-full-screen')
    }, 5)
  }
}

describe('playback fullscreen sessions', () => {
  it('serializes rapid entry and exit and restores windowed mode', async () => {
    const window = new TestWindow()
    const set = createPlaybackFullscreen(window as unknown as BrowserWindow)
    const enter = set(true)
    const exit = set(false)
    await Promise.all([enter, exit])
    expect(window.transitions).toEqual([true, false])
    expect(window.fullscreen).toBe(false)
    expect(window.eventNames()).toEqual([])
  })

  it('does not overwrite the original state on repeated entry', async () => {
    const window = new TestWindow()
    const set = createPlaybackFullscreen(window as unknown as BrowserWindow)
    await set(true)
    await set(true)
    await set(false)
    await set(false)
    expect(window.transitions).toEqual([true, false])
  })

  it('preserves a window that was fullscreen before playback', async () => {
    const window = new TestWindow()
    window.fullscreen = true
    const set = createPlaybackFullscreen(window as unknown as BrowserWindow)
    await set(true)
    await set(false)
    expect(window.fullscreen).toBe(true)
    expect(window.transitions).toEqual([])
  })
})
