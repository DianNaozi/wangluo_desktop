import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import type { PlaybackCheckpoint, PlaybackStats } from '../src/main/import/types'
import { PlaybackTracker } from '../src/main/playback-tracker'
import { usePlaybackStore } from '../src/renderer/src/stores/playback'
import PlaybackController from '../src/renderer/src/components/playback/PlaybackController.vue'

type HostNode = {
  type: string
  text: string
  props: Record<string, unknown>
  children: Array<HostNode | string>
  parent: HostNode | null
  focus: () => void
}

function hostNode(type: string, text = ''): HostNode {
  return { type, text, props: {}, children: [], parent: null, focus() {} }
}

const body = hostNode('body')
const renderer = createRenderer<HostNode, HostNode>({
  createElement: (type) => hostNode(type),
  createText: (text) => hostNode('#text', text),
  createComment: (text) => hostNode('#comment', text),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.children = text ? [text] : [] },
  patchProp: (node, key, _previous, next) => { node.props[key] = next },
  insert: (node, parent, anchor) => {
    if (node.parent) {
      const previousIndex = node.parent.children.indexOf(node)
      if (previousIndex >= 0) node.parent.children.splice(previousIndex, 1)
    }
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove: (node) => {
    if (!node.parent) return
    const index = node.parent.children.indexOf(node)
    if (index >= 0) node.parent.children.splice(index, 1)
    node.parent = null
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => {
    if (!node.parent) return null
    const index = node.parent.children.indexOf(node)
    return index >= 0 ? node.parent.children[index + 1] as HostNode | null ?? null : null
  },
  querySelector: (selector) => selector === 'body' ? body : null,
  insertStaticContent: (content, parent, anchor) => {
    const node = hostNode('#static', content)
    if (anchor) {
      const index = parent.children.indexOf(anchor)
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
    } else parent.children.push(node)
    node.parent = parent
    return [node, node]
  }
})

const blankStats = (): PlaybackStats => ({
  totalWatchedMs: 0, xp: 0, level: 1, xpInLevel: 0, xpToNextLevel: 100, imageIntervalSeconds: 1, loop: true,
  queue: [], cursorEntryId: null, cursorMediaId: null, progress: [], achievements: [], lastPlayedEntryId: null, lastPlayedMediaId: null, days: []
})

const media = (id: string) => ({
  id, originalName: `${id}.jpg`, mediaKind: 'image' as const, importedAt: 1,
  previewUrl: null, mediaUrl: `gallery-media://${id}`, previewStatus: 'ready' as const, previewError: null
})

let app: ReturnType<typeof renderer.createApp> | undefined
let root: HostNode
let playback: ReturnType<typeof usePlaybackStore>
let tracker: PlaybackTracker
let persistedStats: PlaybackStats
let checkpointLog: PlaybackCheckpoint[]
let decodeCount: number
let pendingImageFailures: Map<string, () => void>
let fakeWindow: Window & { api: any }

function walk(node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode[] {
  const result = predicate(node) ? [node] : []
  for (const child of node.children) if (typeof child !== 'string') result.push(...walk(child, predicate))
  return result
}

async function flushVue(): Promise<void> {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  body.children = []
  decodeCount = 0
  checkpointLog = []
  pendingImageFailures = new Map()
  persistedStats = blankStats()
  tracker = new PlaybackTracker(async (checkpoint) => {
    checkpointLog.push(checkpoint)
    persistedStats = {
      ...persistedStats,
      totalWatchedMs: persistedStats.totalWatchedMs + checkpoint.watchedDeltaMs,
      xp: Math.floor((persistedStats.totalWatchedMs + checkpoint.watchedDeltaMs) / 10_000),
      progress: checkpoint.media.reduce((progress, item) => {
        const existing = progress.find((entry) => entry.entryId === item.entryId && entry.mediaId === item.mediaId)
        if (existing) {
          existing.watchedMs += item.watchedDeltaMs
          existing.imageElapsedMs = item.imageElapsedMs
        } else progress.push({ entryId: item.entryId, mediaId: item.mediaId, watchedMs: item.watchedDeltaMs, imageElapsedMs: item.imageElapsedMs, videoPositionMs: item.positionMs, videoDurationMs: item.durationMs, videoRanges: item.videoRanges, lastWatchedAt: item.watchedAt })
        return progress
      }, [...persistedStats.progress])
    }
    return persistedStats
  }, () => Date.now())
  const focusedWindow = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false }
  const api = {
    playback: {
      enterFullscreen: vi.fn(async () => undefined),
      exitFullscreen: vi.fn(async () => undefined),
      beginSession: vi.fn(async (sessionId: string) => tracker.begin(sessionId)),
      sample: vi.fn(async (sample: Parameters<typeof tracker.sample>[1]) => tracker.sample(sample.sessionId, sample, focusedWindow as never)),
      endSession: vi.fn(async (sessionId: string) => tracker.end(sessionId)),
      getState: vi.fn(async () => persistedStats),
      saveState: vi.fn(async () => persistedStats)
    },
    library: {
      getAlbum: vi.fn(async (id: string) => ({ id, title: `图包 ${id}`, folderId: null, updatedAt: 1, media: albums[id] ?? [] }))
    }
  }
  fakeWindow = {
    api,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    matchMedia: () => ({ matches: true, media: '', onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }),
    requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16),
    cancelAnimationFrame: (id: number) => window.clearTimeout(id)
  } as unknown as Window & { api: any }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', fullscreenElement: null } })
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class {
      src = ''
      decode(): Promise<void> {
        decodeCount += 1
        if (this.src.includes('stale-fail')) return new Promise((_resolve, reject) => pendingImageFailures.set(this.src, () => reject(new Error('late image failure'))))
        return this.src.includes('never-load') ? new Promise(() => {}) : Promise.resolve()
      }
    }
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: fakeWindow.cancelAnimationFrame })

  const pinia = createPinia()
  app = renderer.createApp(defineComponent(() => () => h(PlaybackController)))
  app.use(pinia)
  app.provide(Symbol.for('v-scx'), { modules: new Set<string>() })
  root = hostNode('root')
  app.mount(root)
  playback = usePlaybackStore(pinia)
})

const albums: Record<string, ReturnType<typeof media>[]> = {}

afterEach(async () => {
  if (playback) {
    playback.isPlaying = false
    playback.playerOpen = false
    await flushVue()
  }
  await tracker.flushAll()
  app?.unmount()
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  await flushVue()
  vi.clearAllTimers()
  vi.useRealTimers()
  app = undefined
  for (const key of Object.keys(albums)) delete albums[key]
  pendingImageFailures.clear()
  delete (globalThis as Record<string, unknown>)['window']
  delete (globalThis as Record<string, unknown>)['document']
  delete (globalThis as Record<string, unknown>)['Image']
  delete (globalThis as Record<string, unknown>)['cancelAnimationFrame']
})

describe('playback controller image flow', () => {
  it('emits the active composite key, auto-advances into the next package, and earns XP', async () => {
    albums['one'] = [media('first')]
    albums['two'] = [media('second')]
    playback.addAlbums([
      { albumId: 'one', title: '图包 one', media: albums['one']!, sortOrder: 'filename' },
      { albumId: 'two', title: '图包 two', media: albums['two']!, sortOrder: 'filename' }
    ])
    playback.imageIntervalSeconds = 1
    await playback.playEntry('album:one')
    await flushVue()
    expect([...walk(root, (node) => node.type === 'img'), ...walk(body, (node) => node.type === 'img')].some((node) => node.props['src'] === 'gallery-media://first')).toBe(true)

    await vi.advanceTimersByTimeAsync(1_050)
    await flushVue()
    expect(playback.currentEntryId).toBe('album:two')
    expect(playback.currentItem?.id).toBe('second')

    await vi.advanceTimersByTimeAsync(9_500)
    await flushVue()
    expect(playback.effectiveXp).toBeGreaterThanOrEqual(1)
    expect(checkpointLog.some((checkpoint) => checkpoint.media.some((item) => item.imageElapsedMs === 0))).toBe(true)
  })

  it('starts a fresh full interval on a repeated visit and preserves the remaining time across pause', async () => {
    albums['loop'] = [media('loop-image'), media('loop-second')]
    playback.addAlbums([{ albumId: 'loop', title: '循环图包', media: albums['loop']!, sortOrder: 'filename' }])
    playback.imageIntervalSeconds = 1
    await playback.playEntry('album:loop')
    await flushVue()

    await vi.advanceTimersByTimeAsync(1_100)
    await flushVue()
    const loadsAfterFirstVisit = decodeCount
    await vi.advanceTimersByTimeAsync(500)
    playback.isPlaying = false
    await flushVue()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(decodeCount).toBe(loadsAfterFirstVisit)
    playback.isPlaying = true
    await flushVue()
    await vi.advanceTimersByTimeAsync(600)
    await flushVue()
    expect(decodeCount).toBeGreaterThan(loadsAfterFirstVisit)
    await vi.advanceTimersByTimeAsync(700)
    await flushVue()
    expect(decodeCount).toBeLessThan(loadsAfterFirstVisit + 4)
  })

  it('uses a saved image countdown only for the explicit resume and restarts it after a direct selection', async () => {
    albums['resume'] = [media('saved'), media('next')]
    playback.addAlbums([{ albumId: 'resume', title: '续播图包', media: albums['resume']!, sortOrder: 'filename' }])
    playback.imageIntervalSeconds = 1
    playback.stats = {
      ...persistedStats,
      cursorEntryId: 'album:resume', cursorMediaId: 'saved',
      progress: [{ entryId: 'album:resume', mediaId: 'saved', watchedMs: 900, imageElapsedMs: 900, videoPositionMs: 0, videoDurationMs: 0, videoRanges: [], lastWatchedAt: 1 }]
    }
    await playback.playEntry('album:resume')
    await flushVue()
    await vi.advanceTimersByTimeAsync(80)
    expect(playback.currentItem?.id).toBe('saved')
    await vi.advanceTimersByTimeAsync(40)
    await flushVue()
    expect(playback.currentItem?.id).toBe('next')

    await playback.jump(0)
    await flushVue()
    await vi.advanceTimersByTimeAsync(990)
    expect(playback.currentItem?.id).toBe('saved')
    await vi.advanceTimersByTimeAsync(30)
    await flushVue()
    expect(playback.currentItem?.id).toBe('next')
  })

  it('keeps one 15-second deadline through repeated state changes while loading', async () => {
    albums['slow'] = [media('never-load'), media('fallback')]
    playback.addAlbums([{ albumId: 'slow', title: '超时图包', media: albums['slow']!, sortOrder: 'filename' }])
    playback.imageIntervalSeconds = 1
    await playback.playEntry('album:slow')
    await flushVue()

    await vi.advanceTimersByTimeAsync(14_000)
    playback.isPlaying = false
    await flushVue()
    playback.isPlaying = true
    await flushVue()
    expect(playback.currentItem?.id).toBe('never-load')

    await vi.advanceTimersByTimeAsync(1_000)
    await flushVue()
    expect(playback.currentItem?.id).toBe('fallback')
  })

  it('ignores a stale image failure after selecting another item', async () => {
    albums['stale'] = [media('stale-fail'), media('fallback')]
    playback.addAlbums([{ albumId: 'stale', title: '异步失败图包', media: albums['stale']!, sortOrder: 'filename' }])
    await playback.playEntry('album:stale')
    await flushVue()
    expect(pendingImageFailures.size).toBeGreaterThan(0)

    await playback.jump(1)
    await flushVue()
    pendingImageFailures.values().next().value?.()
    await flushVue()
    expect(playback.currentItem?.id).toBe('fallback')
    expect(playback.isPlaying).toBe(true)
  })
})
