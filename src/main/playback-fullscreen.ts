import type { BrowserWindow } from 'electron'

// Keep requests ordered even if the user closes playback during entry.
export function createPlaybackFullscreen(window: BrowserWindow) {
  let originalFullscreen: boolean | undefined
  let pending = Promise.resolve()
  function changeFullscreen(enabled: boolean): Promise<void> {
    if (window.isDestroyed() || window.isFullScreen() === enabled) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        window.removeListener('enter-full-screen', done)
        window.removeListener('leave-full-screen', done)
        window.removeListener('closed', done)
      }
      const done = () => { cleanup(); resolve() }
      const timeout = setTimeout(() => {
        cleanup()
        if (window.isDestroyed() || window.isFullScreen() === enabled) resolve()
        else reject(new Error('无法切换窗口全屏状态'))
      }, 3000)
      if (enabled) window.once('enter-full-screen', done)
      else window.once('leave-full-screen', done)
      window.once('closed', done)
      try { window.setFullScreen(enabled) } catch (error) { cleanup(); reject(error) }
    })
  }
  return (active: boolean): Promise<void> => {
    pending = pending.catch(() => {}).then(async () => {
      if (window.isDestroyed()) return
      if (active) {
        originalFullscreen ??= window.isFullScreen()
        await changeFullscreen(true)
      } else if (originalFullscreen !== undefined) {
        await changeFullscreen(originalFullscreen)
        originalFullscreen = undefined
      }
    })
    return pending
  }
}
