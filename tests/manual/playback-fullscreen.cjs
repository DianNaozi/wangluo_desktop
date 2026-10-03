// Run after npm run build: electron tests/manual/playback-fullscreen.cjs
// Uses a temporary, empty library and removes it when the smoke check exits.
const { app, BrowserWindow, screen } = require('electron')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, dirname, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const tempRoot = resolve(tmpdir())
const data = resolve(mkdtempSync(join(tempRoot, 'gallery-fullscreen-')))
if (dirname(data) !== tempRoot || !basename(data).startsWith('gallery-fullscreen-')) throw new Error('Unsafe temporary userData path')
app.setPath('userData', data)
app.on('will-quit', () => { try { rmSync(data, { recursive: true, force: true }) } catch {} })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(read, message) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await read()) return
    await sleep(25)
  }
  throw new Error(message)
}
const timeout = setTimeout(() => { console.error('Smoke check timed out'); app.exit(1) }, 30000)
;(async () => {
  await import(pathToFileURL(resolve('out/main/index.js')).href)
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows()[0]?.webContents.getURL().startsWith('file:'), 'Window did not load')
  const window = BrowserWindow.getAllWindows()[0]
  window.show()
  window.focus()
  window.webContents.setBackgroundThrottling(false)
  const js = source => window.webContents.executeJavaScript(source, true)
  await until(() => js("Boolean(document.querySelector('#app').__vue_app__?.config.globalProperties.$pinia?._s.get('playback'))"), 'Renderer did not mount')
  const bounds = window.getBounds()
  await js(`(() => {
    window.smokePlayback = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('playback')
    const svg = (width, height, color) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="' + color + '"/></svg>')
    smokePlayback.addMediaBatch([
      { id: 'one', originalName: 'landscape', mediaKind: 'image', mediaUrl: svg(1600,900,'red'), previewUrl: null },
      { id: 'two', originalName: 'portrait', mediaKind: 'image', mediaUrl: svg(600,900,'blue'), previewUrl: null },
      { id: 'three', originalName: 'small', mediaKind: 'image', mediaUrl: svg(60,60,'green'), previewUrl: null }
    ], 'smoke')
    smokePlayback.imageIntervalSeconds = 120
    smokePlayback.play()
  })()`)
  await until(() => window.isFullScreen(), 'Did not enter native fullscreen')
  const display = screen.getDisplayMatching(window.getBounds()).bounds
  assert.deepEqual(window.getBounds(), display)
  await until(() => js("document.querySelector('[role=dialog] img')?.complete"), 'Initial image did not decode')
  await js("smokePlayback.next()")
  await until(() => js("document.querySelectorAll('[role=dialog] .image-fade').length === 2"), 'Images did not overlap')
  await sleep(200)
  const opacity = await js("Number(getComputedStyle(document.querySelectorAll('[role=dialog] .image-fade')[1]).opacity)")
  if (!(opacity > 0 && opacity < 1)) console.log(await js("JSON.stringify({hidden:document.hidden, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,images:[...document.querySelectorAll('[role=dialog] img')].map(i=>({alt:i.alt,style:i.style.cssText,opacity:getComputedStyle(i).opacity,transition:getComputedStyle(i).transition, animations:i.getAnimations().map(a=>({state:a.playState,time:a.currentTime}))}))})"))
  assert(opacity > 0 && opacity < 1, 'No intermediate fade opacity')
  await until(() => js("document.querySelector('[role=dialog] img')?.alt === 'portrait' && document.querySelectorAll('[role=dialog] img').length === 1"), 'Transition did not finish')
  await js("document.querySelector('[aria-label=隐藏播放控件]').click()")
  assert.equal(await js("document.querySelector('[role=dialog] header') === null"), true)
  await js("document.querySelector('[aria-label=显示播放控件]').click()")
  assert.equal(await js("Boolean(document.querySelector('[role=dialog] header'))"), true)
  await js("smokePlayback.jump(0); smokePlayback.jump(2)")
  await until(() => js("document.querySelector('[role=dialog] img')?.alt === 'small' && document.querySelectorAll('[role=dialog] img').length === 1"), 'Latest selection did not win')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await until(() => !window.isFullScreen(), 'Escape did not exit fullscreen')
  assert.deepEqual(window.getBounds(), bounds)
  await js("smokePlayback.play(); setTimeout(() => { smokePlayback.playerOpen = false }, 0)")
  await sleep(750)
  assert.equal(window.isFullScreen(), false)
  await js(`(() => {
    const svg = color => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="100%" height="100%" fill="' + color + '"/></svg>')
    const item = (id, color) => ({ id, title: id, source: 'autoplay smoke', type: 'image', mediaUrl: svg(color), previewUrl: null })
    smokePlayback.entries = [
      { entryId: 'album:smoke-a', type: 'album', albumId: 'smoke-a', title: 'Autoplay A', sortOrder: 'filename', items: [item('auto-a', 'red')] },
      { entryId: 'album:smoke-b', type: 'album', albumId: 'smoke-b', title: 'Autoplay B', sortOrder: 'filename', items: [item('auto-b', 'blue')] }
    ]
    smokePlayback.entryIndex = 0
    smokePlayback.currentMediaIndex = 0
    smokePlayback.loop = true
    smokePlayback.imageIntervalSeconds = 1
    smokePlayback.isPlaying = true
    smokePlayback.playerOpen = true
  })()`)
  await until(() => js("smokePlayback.currentEntryId === 'album:smoke-b'"), 'Automatic playback did not cross into the next package')
  await until(() => js('smokePlayback.effectiveXp >= 1'), 'Ten seconds of valid playback did not earn XP')
  await js('smokePlayback.playerOpen = false; smokePlayback.isPlaying = false')
  await until(() => !window.isFullScreen(), 'Autoplay smoke did not exit fullscreen')
  console.log('PASS: native fullscreen, bounds restore, fade, controls, rapid navigation, Escape, close, cross-package autoplay, 1 XP after valid viewing')
  clearTimeout(timeout)
  app.quit()
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1) })
