import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LibraryMedia, PlaybackStats } from '../../../preload'
import { sortMedia, type MediaSortOrder } from '../utils/media-sort'
import { playbackRangeCoverage } from '../../../main/import/playback-rewards'

export type PlaybackMedia = {
  id: string
  title: string
  source: string
  type: 'image' | 'video'
  mediaUrl: string
  previewUrl: string | null
}

export type PlaybackQueueEntry =
  | { entryId: string; type: 'album'; albumId: string; title: string; sortOrder: MediaSortOrder; items: PlaybackMedia[] }
  | { entryId: string; type: 'media'; title: string; source: string; items: PlaybackMedia[] }

export type PlaybackSampleState = Omit<Parameters<typeof window.api.playback.sample>[0], 'sessionId' | 'sequence' | 'entryId' | 'mediaId'>

function playbackEntryKey(entry: PlaybackQueueEntry, mediaId?: string): string {
  return `${entry.entryId}\u0000${mediaId ?? ''}`
}

function toPlayableMedia(media: LibraryMedia, source: string): PlaybackMedia | null {
  if (media.mediaKind === 'file') return null
  return { id: media.id, title: media.originalName, source, type: media.mediaKind, mediaUrl: media.mediaUrl, previewUrl: media.previewUrl }
}

export const usePlaybackStore = defineStore('playback', () => {
  const entries = ref<PlaybackQueueEntry[]>([])
  const drawerOpen = ref(false)
  const playerOpen = ref(false)
  const isPlaying = ref(false)
  const loop = ref(true)
  const entryIndex = ref(0)
  const currentMediaIndex = ref(0)
  const imageIntervalSeconds = ref(5)
  const stats = ref<PlaybackStats | null>(null)
  const notice = ref('')
  const persistenceError = ref('')
  const sampleError = ref('')
  const resumedFromSave = ref(false)
  const hydrating = ref(false)
  const hydrated = ref(false)
  const refreshingQueue = ref(false)
  const unpersistedWatchMs = ref(0)
  const packWatchMs = ref<Record<string, number>>({})
  let packStartingRemainderMs = 0
  const restartToken = ref(0)
  const restartAtStart = ref(false)
  const currentEntry = computed(() => entries.value[entryIndex.value])
  const currentItem = computed(() => currentEntry.value?.items[currentMediaIndex.value])
  const currentEntryId = computed(() => currentEntry.value?.entryId ?? null)
  const queue = computed(() => entries.value.flatMap((entry) => entry.items.map((item) => ({ ...item, key: playbackEntryKey(entry, item.id), entryId: entry.entryId, entryTitle: entry.title }))))
  const currentIndex = computed(() => queue.value.findIndex((item) => item.entryId === currentEntryId.value && item.id === currentItem.value?.id))
  const queueLength = computed(() => entries.value.reduce((total, entry) => total + entry.items.length, 0))
  const xp = computed(() => stats.value?.xp ?? 0)
  const level = computed(() => stats.value?.level ?? 1)
  const xpInLevel = computed(() => stats.value?.xpInLevel ?? 0)
  const effectiveTotalWatchedMs = computed(() => (stats.value?.totalWatchedMs ?? 0) + unpersistedWatchMs.value)
  const effectiveXp = computed(() => Math.floor(effectiveTotalWatchedMs.value / 10_000))
  const effectiveLevel = computed(() => Math.floor(effectiveXp.value / 100) + 1)
  const effectiveXpInLevel = computed(() => effectiveXp.value % 100)
  const earnedAchievements = computed(() => stats.value?.achievements ?? [])
  const lastPlayedEntryId = computed(() => stats.value?.lastPlayedEntryId ?? null)
  const currentProgress = computed(() => {
    const entry = currentEntry.value; const item = currentItem.value
    if (!entry || !item) return undefined
    return stats.value?.progress.find((progress) => progress.entryId === entry.entryId && progress.mediaId === item.id)
  })
  const resumePositionMs = computed(() => restartAtStart.value ? 0 : currentProgress.value?.videoPositionMs ?? 0)
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let persistence = Promise.resolve()
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let playerSessionId = ''
  let sampleSequence = 0
  let sampleInFlight = false
  let endingSession: Promise<void> | null = null
  let queueRefresh: Promise<void> | null = null
  let imageResumeKey: string | null = null

  function resetPackWatch(): void {
    packWatchMs.value = {}
    packStartingRemainderMs = effectiveTotalWatchedMs.value % 10_000
  }

  function applyStats(value: PlaybackStats): void {
    const previous = stats.value
    stats.value = value
    imageIntervalSeconds.value = value.imageIntervalSeconds
    loop.value = value.loop
    const newlyPersistedMs = previous ? Math.max(0, value.totalWatchedMs - previous.totalWatchedMs) : 0
    unpersistedWatchMs.value = Math.max(0, unpersistedWatchMs.value - newlyPersistedMs)
    persistenceError.value = ''
    if (hydrated.value && previous && value.level > previous.level) setNotice(`升到 Lv.${value.level} · ${value.xp} XP`)
    if (hydrated.value && previous) {
      const before = new Set(previous.achievements.map((achievement) => achievement.id))
      const newlyEarned = value.achievements.filter((achievement) => !before.has(achievement.id))
      const names: Record<string, string> = { 'first-album': '完成首个图包', 'ten-albums': '完成 10 个图包', 'one-hour': '累计观看 1 小时' }
      if (newlyEarned.length) setNotice(`成就解锁：${names[newlyEarned[0]!.id] ?? newlyEarned[0]!.id}`)
    }
  }

  function serializableEntries(): PlaybackStats['queue'] {
    return entries.value.map((entry) => entry.type === 'album'
      ? { entryId: entry.entryId, type: 'album' as const, albumId: entry.albumId, title: entry.title, sortOrder: entry.sortOrder, mediaIds: entry.items.map((item) => item.id) }
      : { entryId: entry.entryId, type: 'media' as const, mediaId: entry.items[0]!.id, title: entry.title, source: entry.source })
  }

  function persistNow(): Promise<void> {
    if (!hydrated.value || hydrating.value) return Promise.resolve()
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = undefined }
    const current = entries.value[entryIndex.value]
    const cursorMediaId = current?.items[currentMediaIndex.value]?.id ?? null
    const payload = { queue: serializableEntries(), cursorEntryId: current?.entryId ?? null, cursorMediaId, imageIntervalSeconds: imageIntervalSeconds.value, loop: loop.value }
    persistence = persistence.catch(() => undefined).then(async () => {
      try { applyStats(await window.api.playback.saveState(payload)) }
      catch (error) { persistenceError.value = error instanceof Error ? error.message : String(error) }
    })
    return persistence
  }

  function persistSoon(): void {
    if (!hydrated.value || hydrating.value) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => { persistTimer = undefined; void persistNow() }, 200)
  }

  function setNotice(message: string, duration = 2_500): void {
    notice.value = message
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { notice.value = '' }, duration)
  }

  function sourceKey(entryId: string, mediaId: string): string { return `${entryId}\u0000${mediaId}` }
  function progressFor(entryId: string, mediaId: string) { return stats.value?.progress.find((progress) => progress.entryId === entryId && progress.mediaId === mediaId) }
  function completionFor(entry: PlaybackQueueEntry): { watched: number; total: number } {
    if (entry.type !== 'album') return { watched: 0, total: 0 }
    let watched = 0
    for (const item of entry.items) {
      const progress = progressFor(entry.entryId, item.id)
      if (item.type === 'image' ? (progress?.watchedMs ?? 0) >= 3_000 : playbackRangeCoverage(progress?.videoRanges ?? [], progress?.videoDurationMs ?? 0) >= 0.9) watched += 1
    }
    return { watched, total: entry.items.length }
  }
  function isWatched(entryId: string, item: PlaybackMedia): boolean {
    const progress = progressFor(entryId, item.id)
    return item.type === 'image'
      ? (progress?.watchedMs ?? 0) >= 3_000
      : playbackRangeCoverage(progress?.videoRanges ?? [], progress?.videoDurationMs ?? 0) >= 0.9
  }

  async function hydrate(): Promise<void> {
    if (hydrated.value || hydrating.value) return
    hydrating.value = true
    try {
      const saved = await window.api.playback.getState()
      stats.value = saved
      imageIntervalSeconds.value = saved.imageIntervalSeconds
      loop.value = saved.loop
      const restored: PlaybackQueueEntry[] = []
      for (const entry of saved.queue) {
        try {
          if (entry.type === 'album') {
            const album = await window.api.library.getAlbum(entry.albumId)
            const orderedMedia = sortMedia(album.media, entry.sortOrder)
            const playable = orderedMedia.map((media) => toPlayableMedia(media, album.title)).filter((item): item is PlaybackMedia => item !== null)
            const current = new Map(playable.map((item) => [item.id, item]))
            const previousIds = entry.mediaIds.filter((id) => current.has(id))
            const previousSet = new Set(previousIds)
            const sortOrder = entry.sortOrder
            const sortedIds = playable.map((item) => item.id)
            const orderedIds = [...previousIds, ...sortedIds.filter((id) => !previousSet.has(id))]
            restored.push({ entryId: entry.entryId, type: 'album', albumId: album.id, title: album.title, sortOrder, items: orderedIds.map((id) => current.get(id)!) })
          } else {
            const [media] = await window.api.playback.getMedia([entry.mediaId])
            if (media) {
              const item = toPlayableMedia(media, entry.source)
              if (item) restored.push({ entryId: entry.entryId, type: 'media', title: entry.title, source: entry.source, items: [{ ...item, title: entry.title, source: entry.source }] })
            }
          }
        } catch { /* The deleted or trashed source is removed from the restored queue. */ }
      }
      const addedDuringRestore = entries.value.filter((entry) => !restored.some((savedEntry) => savedEntry.entryId === entry.entryId))
      entries.value = [...restored, ...addedDuringRestore]
      const cursorEntryId = saved.cursorEntryId && restored.some((entry) => entry.entryId === saved.cursorEntryId) ? saved.cursorEntryId : saved.lastPlayedEntryId
      const restoredEntryIndex = cursorEntryId ? restored.findIndex((entry) => entry.entryId === cursorEntryId) : -1
      entryIndex.value = restoredEntryIndex >= 0 ? restoredEntryIndex : 0
      const entry = restored[entryIndex.value]
      const cursorMediaId = saved.cursorEntryId === entry?.entryId ? saved.cursorMediaId : saved.lastPlayedMediaId
      const savedPosition = cursorMediaId ? entry?.items.findIndex((item) => item.id === cursorMediaId) ?? -1 : -1
      if (savedPosition >= 0) currentMediaIndex.value = savedPosition
      else if (entry) {
        const mostRecent = saved.progress.filter((item) => item.entryId === entry.entryId).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0))[0]
        const resume = mostRecent ? entry.items.findIndex((item) => item.id === mostRecent.mediaId) : -1
        currentMediaIndex.value = resume >= 0 ? resume : 0
      }
      resumedFromSave.value = Boolean(cursorEntryId || saved.lastPlayedEntryId)
    } catch (error) {
      persistenceError.value = error instanceof Error ? error.message : String(error)
      stats.value = null
    } finally {
      hydrated.value = true
      hydrating.value = false
      void persistNow()
    }
  }

  function addAlbums(albums: Array<{ albumId: string; title: string; media: LibraryMedia[]; sortOrder: MediaSortOrder }>): number {
    let added = 0
    for (const album of albums) {
      const entryId = `album:${album.albumId}`
      if (entries.value.some((entry) => entry.entryId === entryId)) { setNotice(`「${album.title}」已在播放队列中`); continue }
      const items = album.media.map((media) => toPlayableMedia(media, album.title)).filter((item): item is PlaybackMedia => item !== null)
      if (!items.length) { setNotice(`「${album.title}」没有可播放内容`); continue }
      entries.value.push({ entryId, type: 'album', albumId: album.albumId, title: album.title, sortOrder: album.sortOrder, items })
      added += 1
    }
    if (added) { setNotice(`已加入 ${added} 个图包`, 1_800); persistSoon() }
    return added
  }

  function addMediaBatch(items: LibraryMedia[], source: string): number {
    let added = 0
    for (const media of items) {
      if (media.mediaKind === 'file') continue
      const entryId = `media:${media.id}`
      if (entries.value.some((entry) => entry.entryId === entryId)) continue
      const item = toPlayableMedia(media, source)
      if (!item) continue
      entries.value.push({ entryId, type: 'media', title: media.originalName, source, items: [{ ...item, source }] })
      added += 1
    }
    if (added) persistSoon()
    return added
  }

  async function refreshAlbums(): Promise<void> {
    if (queueRefresh) return queueRefresh
    queueRefresh = (async () => {
      const previousEntryId = currentEntryId.value
      const previousMediaId = currentItem.value?.id
      refreshingQueue.value = true
      const albums = entries.value.filter((entry): entry is Extract<PlaybackQueueEntry, { type: 'album' }> => entry.type === 'album')
      const results = await Promise.all(albums.map(async (entry) => {
        try {
          const album = await window.api.library.getAlbum(entry.albumId)
          const sorted = sortMedia(album.media, entry.sortOrder).map((media) => toPlayableMedia(media, album.title)).filter((item): item is PlaybackMedia => item !== null)
          const current = new Map(sorted.map((item) => [item.id, item]))
          const previousIds = entry.items.map((item) => item.id).filter((id) => current.has(id))
          const previousSet = new Set(previousIds)
          return { entryId: entry.entryId, update: { title: album.title, items: [...previousIds.map((id) => current.get(id)!), ...sorted.filter((item) => !previousSet.has(item.id))] as PlaybackMedia[] } }
        } catch { return { entryId: entry.entryId, update: null } }
      }))
      let changed = false
      const byId = new Map(results.map((result) => [result.entryId, result.update]))
      entries.value = entries.value.flatMap((entry) => {
        if (entry.type !== 'album') return [entry]
        const update = byId.get(entry.entryId)
        if (!update) return [entry]
        if (update.items.length === 0) { changed = true; return [] }
        if (update.title !== entry.title || update.items.map((item) => item.id).join('\u0000') !== entry.items.map((item) => item.id).join('\u0000')) changed = true
        return [{ ...entry, title: update.title, items: update.items }]
      })
      if (previousEntryId) {
        const index = entries.value.findIndex((entry) => entry.entryId === previousEntryId)
        if (index >= 0) {
          entryIndex.value = index
          const mediaIndex = entries.value[index]!.items.findIndex((item) => item.id === previousMediaId)
          if (mediaIndex >= 0) currentMediaIndex.value = mediaIndex
          else currentMediaIndex.value = Math.min(currentMediaIndex.value, entries.value[index]!.items.length - 1)
        } else {
          entryIndex.value = Math.min(entryIndex.value, Math.max(0, entries.value.length - 1))
          currentMediaIndex.value = 0
        }
      }
      if (changed) persistSoon()
    })().catch((error: unknown) => { persistenceError.value = error instanceof Error ? error.message : String(error) })
      .finally(() => { refreshingQueue.value = false; queueRefresh = null })
    return queueRefresh
  }

  async function openQueue(): Promise<void> {
    drawerOpen.value = true
    await refreshAlbums()
  }

  async function removeEntry(entryId: string): Promise<void> {
    const index = entries.value.findIndex((entry) => entry.entryId === entryId)
    if (index < 0) return
    const wasCurrent = index === entryIndex.value
    const shouldResume = wasCurrent && playerOpen.value && isPlaying.value
    if (wasCurrent) await endSession()
    entries.value.splice(index, 1)
    if (index < entryIndex.value) entryIndex.value -= 1
    else if (wasCurrent) {
      restartAtStart.value = false
      resetPackWatch()
      if (!entries.value.length) { entryIndex.value = 0; currentMediaIndex.value = 0; playerOpen.value = false; isPlaying.value = false }
      else { entryIndex.value = Math.min(index, entries.value.length - 1); currentMediaIndex.value = 0 }
    }
    await persistNow()
    if (shouldResume && playerOpen.value) void beginSession()
  }

  function remove(id: string): void {
    const item = queue.value.find((queued) => queued.key === id || queued.id === id)
    if (item) removeEntry(item.entryId)
  }

  function moveEntry(entryId: string, offset: -1 | 1): void {
    const index = entries.value.findIndex((entry) => entry.entryId === entryId)
    const target = index + offset
    if (index < 0 || target < 0 || target >= entries.value.length) return
    const activeId = currentEntryId.value
    ;[entries.value[index], entries.value[target]] = [entries.value[target]!, entries.value[index]!]
    const nextIndex = entries.value.findIndex((entry) => entry.entryId === activeId)
    if (nextIndex >= 0) entryIndex.value = nextIndex
    persistSoon()
  }

  function move(id: string, offset: -1 | 1): void {
    const item = queue.value.find((queued) => queued.key === id || queued.id === id)
    if (item) moveEntry(item.entryId, offset)
  }

  async function clear(): Promise<void> {
    await endSession()
    entries.value = []
    entryIndex.value = 0
    currentMediaIndex.value = 0
    playerOpen.value = false
    isPlaying.value = false
    resumedFromSave.value = false
    restartAtStart.value = false
    imageResumeKey = null
    resetPackWatch()
    await persistNow()
  }

  async function playEntry(entryId: string, restart = false): Promise<void> {
    await refreshAlbums()
    const index = entries.value.findIndex((entry) => entry.entryId === entryId)
    if (index < 0 || !entries.value[index]!.items.length) return
    const wasPlaying = playerOpen.value && isPlaying.value
    const alreadyOnEntry = playerOpen.value && currentEntryId.value === entryId && !restart
    if (playerOpen.value && !alreadyOnEntry) await endSession()
    if (alreadyOnEntry) {
      drawerOpen.value = false
      isPlaying.value = true
      await persistNow()
      return
    }
    resetPackWatch()
    imageResumeKey = null
    entryIndex.value = index
    const entry = entries.value[index]!
    restartAtStart.value = restart
    if (restart) { currentMediaIndex.value = 0; restartToken.value += 1 }
    else {
      const savedCursor = stats.value?.cursorEntryId === entryId ? stats.value.cursorMediaId : null
      const recentlyWatched = stats.value?.progress.filter((item) => item.entryId === entryId).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0))[0]?.mediaId
      const mediaId = savedCursor ?? recentlyWatched
      const index = mediaId ? entry.items.findIndex((item) => item.id === mediaId) : -1
      currentMediaIndex.value = index >= 0 ? index : 0
      const resumeItem = entry.items[currentMediaIndex.value]
      if (resumeItem?.type === 'image') imageResumeKey = sourceKey(entry.entryId, resumeItem.id)
    }
    drawerOpen.value = false
    isPlaying.value = true
    playerOpen.value = true
    resumedFromSave.value = !restart
    await persistNow()
    if (wasPlaying) void beginSession()
  }

  function play(index = 0): void {
    const item = queue.value[index]
    if (item) playEntry(item.entryId)
  }

  async function resume(): Promise<void> {
    const entryId = stats.value?.cursorEntryId ?? stats.value?.lastPlayedEntryId
    const match = entryId ? entries.value.find((entry) => entry.entryId === entryId) : entries.value[0]
    if (match) await playEntry(match.entryId)
  }

  async function jump(index: number): Promise<void> {
    const initial = queue.value[index]
    if (initial && entries.value.find((entry) => entry.entryId === initial.entryId)?.type === 'album') await refreshAlbums()
    const item = initial && queue.value.find((queued) => queued.entryId === initial.entryId && queued.id === initial.id)
    if (!item) return
    const wasPlaying = playerOpen.value && isPlaying.value
    const packChanged = !playerOpen.value || currentEntryId.value !== item.entryId
    if (playerOpen.value && (currentEntryId.value !== item.entryId || currentItem.value?.id !== item.id)) await endSession()
    const nextEntryIndex = entries.value.findIndex((entry) => entry.entryId === item.entryId)
    if (nextEntryIndex < 0) return
    imageResumeKey = null
    if (packChanged) resetPackWatch()
    entryIndex.value = nextEntryIndex
    restartAtStart.value = false
    currentMediaIndex.value = entries.value[nextEntryIndex]!.items.findIndex((media) => media.id === item.id)
    isPlaying.value = true
    playerOpen.value = true
    await persistNow()
    if (wasPlaying) void beginSession()
  }

  function moveTo(nextEntryIndex: number): void {
    if (nextEntryIndex < 0 || nextEntryIndex >= entries.value.length) return
    if (currentEntryId.value !== entries.value[nextEntryIndex]!.entryId) resetPackWatch()
    restartAtStart.value = false
    imageResumeKey = null
    entryIndex.value = nextEntryIndex
    const entry = entries.value[nextEntryIndex]!
    const cursor = stats.value?.cursorEntryId === entry.entryId ? stats.value.cursorMediaId : null
    const lastWatched = stats.value?.progress.filter((item) => item.entryId === entry.entryId).sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0))[0]?.mediaId
    const mediaId = cursor ?? lastWatched
    const index = mediaId ? entry.items.findIndex((item) => item.id === mediaId) : -1
    currentMediaIndex.value = index >= 0 ? index : 0
    persistSoon()
  }

  function finishCurrentEntry(): void {
    const entry = currentEntry.value
    if (entry?.type === 'album') {
      const completion = completionFor(entry)
      const watchedMs = packWatchMs.value[entry.entryId] ?? 0
      const earnedXp = Math.floor((packStartingRemainderMs + watchedMs) / 10_000)
      setNotice(`${completion.watched}/${completion.total} 项 · 本次 ${Math.floor(watchedMs / 60_000)} 分钟 · ${earnedXp} XP`)
    }
  }

  async function next(): Promise<void> {
    const entry = currentEntry.value
    if (!entry) return
    if (currentMediaIndex.value < entry.items.length - 1) {
      const shouldResume = isPlaying.value
      await endSession()
      restartAtStart.value = false
      imageResumeKey = null
      currentMediaIndex.value += 1
      await persistNow()
      if (shouldResume) void beginSession()
      return
    }
    if (entry.type === 'album') {
      await endSession()
      await refreshAlbums()
      if (currentMediaIndex.value < (currentEntry.value?.items.length ?? 0) - 1) {
        restartAtStart.value = false
        imageResumeKey = null
        currentMediaIndex.value += 1
        isPlaying.value = true
        await persistNow()
        if (!playerSessionId) void beginSession()
        return
      }
    }
    finishCurrentEntry()
    if (entryIndex.value < entries.value.length - 1) moveTo(entryIndex.value + 1)
    else if (loop.value) {
      entryIndex.value = 0
      currentMediaIndex.value = 0
      restartAtStart.value = false
      imageResumeKey = null
      resetPackWatch()
    }
    else { playerOpen.value = false; isPlaying.value = false }
    await persistNow()
    if (playerOpen.value && isPlaying.value && !playerSessionId) void beginSession()
  }

  async function previous(): Promise<void> {
    const entry = currentEntry.value
    if (!entry) return
    let targetEntry = entryIndex.value
    let targetMedia = currentMediaIndex.value - 1
    if (targetMedia < 0 && targetEntry > 0) {
      targetEntry -= 1
      targetMedia = entries.value[targetEntry]!.items.length - 1
    } else if (targetMedia < 0 && loop.value && entries.value.length > 1) {
      targetEntry = entries.value.length - 1
      targetMedia = entries.value[targetEntry]!.items.length - 1
    }
    if (targetMedia < 0) return
    const shouldResume = playerOpen.value && isPlaying.value
    await endSession()
    if (targetEntry !== entryIndex.value) resetPackWatch()
    restartAtStart.value = false
    imageResumeKey = null
    entryIndex.value = targetEntry
    currentMediaIndex.value = targetMedia
    await persistNow()
    if (shouldResume) void beginSession()
  }

  async function nextPack(): Promise<void> {
    await refreshAlbums()
    const target = entryIndex.value + 1 < entries.value.length ? entryIndex.value + 1 : loop.value ? 0 : -1
    if (target >= 0) {
      await endSession()
      if (target === entryIndex.value) resetPackWatch()
      moveTo(target)
      isPlaying.value = true
      playerOpen.value = true
      await persistNow()
      void beginSession()
    }
  }

  async function previousPack(): Promise<void> {
    await refreshAlbums()
    const target = entryIndex.value > 0 ? entryIndex.value - 1 : loop.value && entries.value.length > 1 ? entries.value.length - 1 : -1
    if (target >= 0) { await endSession(); if (target === entryIndex.value) resetPackWatch(); moveTo(target); isPlaying.value = true; playerOpen.value = true; await persistNow(); void beginSession() }
  }

  function setCurrentMediaIndex(index: number): void {
    if (index >= 0 && index < (currentEntry.value?.items.length ?? 0)) { currentMediaIndex.value = index; persistSoon() }
  }

  async function beginSession(): Promise<void> {
    if (playerSessionId || !playerOpen.value || !currentItem.value || !isPlaying.value) return
    playerSessionId = crypto.randomUUID()
    sampleSequence = 0
    try { await window.api.playback.beginSession(playerSessionId) }
    catch (error) { playerSessionId = ''; sampleError.value = error instanceof Error ? error.message : String(error) }
  }

  async function reportSample(sample: PlaybackSampleState): Promise<void> {
    if (!playerSessionId || sampleInFlight) return
    const entry = currentEntry.value; const item = currentItem.value
    if (!entry || !item) return
    sampleInFlight = true
    try {
      const result = await window.api.playback.sample({ ...sample, entryId: entry.entryId, mediaId: item.id, sessionId: playerSessionId, sequence: ++sampleSequence })
      unpersistedWatchMs.value += result.acceptedWallMs
      if (result.acceptedWallMs > 0) packWatchMs.value = { ...packWatchMs.value, [entry.entryId]: (packWatchMs.value[entry.entryId] ?? 0) + result.acceptedWallMs }
      if (result.stats) applyStats(result.stats)
      if (result.error) sampleError.value = result.error
      else if (!persistenceError.value) sampleError.value = ''
    } catch (error) { sampleError.value = error instanceof Error ? error.message : String(error) }
    finally { sampleInFlight = false }
  }

  async function endSession(): Promise<void> {
    if (endingSession) return endingSession
    if (!playerSessionId) return
    const sessionId = playerSessionId
    playerSessionId = ''
    const ending = (async () => {
      try {
        const result = await window.api.playback.endSession(sessionId)
        if (result) applyStats(result)
      } catch (error) { sampleError.value = error instanceof Error ? error.message : String(error) }
    })()
    endingSession = ending
    try { await ending } finally { endingSession = null }
  }

  function imageElapsedFor(entryId: string, mediaId: string): number {
    const key = sourceKey(entryId, mediaId)
    if (!imageResumeKey || imageResumeKey !== key) { imageResumeKey = null; return 0 }
    imageResumeKey = null
    if (restartAtStart.value && currentEntryId.value === entryId && currentItem.value?.id === mediaId) return 0
    return progressFor(entryId, mediaId)?.imageElapsedMs ?? 0
  }
  function progressFraction(entry: PlaybackQueueEntry): number {
    const { watched, total } = completionFor(entry)
    return total ? watched / total : 0
  }

  return {
    entries, queue, queueLength, drawerOpen, playerOpen, isPlaying, loop, entryIndex, currentMediaIndex, currentIndex, imageIntervalSeconds, refreshingQueue,
    stats, xp, level, xpInLevel, effectiveXp, effectiveLevel, effectiveXpInLevel, effectiveTotalWatchedMs, earnedAchievements, resumePositionMs, restartToken,
    currentEntry, currentItem, currentEntryId, currentProgress, lastPlayedEntryId, notice, persistenceError, sampleError, resumedFromSave, hydrated, hydrating,
    hydrate, addAlbums, addMediaBatch, remove, removeEntry, move, moveEntry, clear, play, resume, playEntry, openQueue, refreshAlbums, jump, next, previous, nextPack, previousPack,
    setCurrentMediaIndex, beginSession, reportSample, endSession, persistNow, persistSoon, imageElapsedFor, progressFraction, isWatched, setNotice
  }
})
