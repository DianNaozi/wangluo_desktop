<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, EyeOff, FileImage, FileVideo, Layers3, ListVideo, Pause, Play, Repeat2, RotateCcw, SkipBack, SkipForward, Trash2, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import { usePlaybackStore, type PlaybackMedia, type PlaybackQueueEntry, type PlaybackSampleState } from '@/stores/playback'
import { shouldRestartVideo } from '@/utils/playback-player'
import VideoPlayer from './VideoPlayer.vue'
import PlaybackImageStage from './PlaybackImageStage.vue'

const playback = usePlaybackStore()
const showQueue = ref(false)
const controlsVisible = ref(true)
const expandedEntries = ref(new Set<string>())
const playerSurface = ref<HTMLButtonElement | null>(null)
const videoPlayer = ref<InstanceType<typeof VideoPlayer> | null>(null)
const imageReady = ref(false)
const playbackError = ref('')
const fullscreenError = ref('')
const imageRetryToken = ref(0)
const progress = ref(0)
const elapsedImageMs = ref(0)
const playerItem = computed(() => playback.currentItem)
const currentEntry = computed(() => playback.currentEntry)
const playerKey = computed(() => playerItem.value && currentEntry.value ? `${currentEntry.value.entryId}\u0000${playerItem.value.id}\u0000${playback.restartToken}` : '')
const nextImageUrl = computed(() => {
  const item = playback.queue[playback.currentIndex + 1]
  return item?.type === 'image' ? item.mediaUrl : undefined
})
const playerPositionLabel = computed(() => currentEntry.value?.type === 'album'
  ? `${currentEntry.value.title} · ${playback.currentMediaIndex + 1} / ${currentEntry.value.items.length}`
  : `${playerItem.value?.source ?? ''} · ${playback.currentIndex + 1} / ${playback.queueLength}`)
const levelProgress = computed(() => playback.effectiveXpInLevel)
let timer: number | undefined
let progressFrame = 0
let dwellBaseMs = 0
let dwellStartedAt: number | null = null
let sampleTimer: number | undefined
let loadWatchdog: number | undefined
let loadWatchdogKey = ''
let trackingWork: Promise<void> | null = null
let trackingAgain = false
let sessionOpen = false
const failedKeys = ref(new Set<string>())

function queueKey(entryId: string, mediaId: string): string { return `${entryId}\u0000${mediaId}` }
function toggleEntry(entryId: string): void {
  const updated = new Set(expandedEntries.value)
  if (updated.has(entryId)) updated.delete(entryId)
  else updated.add(entryId)
  expandedEntries.value = updated
}
function isFailed(entryId: string, item: PlaybackMedia): boolean { return failedKeys.value.has(queueKey(entryId, item.id)) }
function isCurrent(entryId: string, item: PlaybackMedia): boolean { return currentEntry.value?.entryId === entryId && playerItem.value?.id === item.id }
function itemCount(entry: PlaybackQueueEntry): number { return entry.items.length }
function cover(entry: PlaybackQueueEntry): PlaybackMedia | undefined { return entry.items.find((item) => item.previewUrl) ?? entry.items[0] }
function completion(entry: PlaybackQueueEntry): { watched: number; total: number } {
  return entry.type === 'album' ? { watched: Math.round(playback.progressFraction(entry) * entry.items.length), total: entry.items.length } : { watched: 0, total: 0 }
}
function toggleQueue(): void {
  showQueue.value = !showQueue.value
  if (showQueue.value) void playback.refreshAlbums()
}

function saveDwellClock(): void {
  if (dwellStartedAt === null) return
  dwellBaseMs = Math.max(0, dwellBaseMs + performance.now() - dwellStartedAt)
  elapsedImageMs.value = dwellBaseMs
  dwellStartedAt = null
}

function clearTimer(): void {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = undefined
  cancelAnimationFrame(progressFrame)
  saveDwellClock()
}

function schedule(): void {
  clearTimer()
  progress.value = 0
  if (!playback.playerOpen || !playback.isPlaying || !imageReady.value || playerItem.value?.type !== 'image') return
  const intervalMs = Math.min(120_000, Math.max(1_000, Number(playback.imageIntervalSeconds) * 1_000))
  dwellBaseMs = Math.min(intervalMs, Math.max(0, dwellBaseMs))
  const startedAt = performance.now()
  dwellStartedAt = startedAt
  const update = () => {
    elapsedImageMs.value = Math.min(intervalMs, dwellBaseMs + performance.now() - startedAt)
    progress.value = Math.min(100, elapsedImageMs.value / intervalMs * 100)
    if (progress.value < 100 && playback.isPlaying && playback.playerOpen) progressFrame = window.requestAnimationFrame(update)
  }
  progressFrame = window.requestAnimationFrame(update)
  timer = window.setTimeout(() => {
    timer = undefined
    cancelAnimationFrame(progressFrame)
    progressFrame = 0
    dwellStartedAt = null
    dwellBaseMs = intervalMs
    elapsedImageMs.value = intervalMs
    progress.value = 100
    void finishImageVisit()
  }, Math.max(50, intervalMs - dwellBaseMs))
}

async function finishImageVisit(): Promise<void> {
  const key = playerKey.value
  await syncTracking()
  if (key !== playerKey.value || !playback.playerOpen) return
  dwellBaseMs = 0
  elapsedImageMs.value = 0
  progress.value = 0
  await syncTracking()
  if (key === playerKey.value) await advance()
}

function readSample(): PlaybackSampleState | null {
  const item = playerItem.value
  if (!item) return null
  if (item.type === 'image') return {
    mediaType: 'image', ready: imageReady.value, playing: playback.isPlaying, waiting: !imageReady.value,
    seeking: false, error: Boolean(playbackError.value), positionMs: 0,
    durationMs: Math.max(1_000, playback.imageIntervalSeconds * 1_000), imageElapsedMs: Math.floor(elapsedImageMs.value), playbackRate: 1
  }
  const sample = videoPlayer.value?.trackingSample()
  return sample ? {
    mediaType: 'video', ...sample, playing: sample.playing && playback.isPlaying, imageElapsedMs: 0
  } : {
    mediaType: 'video', ready: false, playing: false, waiting: true, seeking: false, error: false,
    positionMs: 0, durationMs: 0, imageElapsedMs: 0, playbackRate: 1
  }
}

function canEarnFrom(sample: PlaybackSampleState | null): boolean {
  return Boolean(sample?.ready && sample.playing && !sample.waiting && !sample.seeking && !sample.error && document.visibilityState === 'visible')
}

async function syncTracking(): Promise<void> {
  if (trackingWork) { trackingAgain = true; return trackingWork }
  trackingWork = (async () => {
    do {
      trackingAgain = false
      const sample = readSample()
      if (playback.playerOpen && canEarnFrom(sample)) {
        await playback.beginSession()
        sessionOpen = true
      }
      if (sessionOpen && sample) {
        await playback.reportSample(sample)
        if (!playback.playerOpen || !canEarnFrom(sample)) {
          await playback.endSession()
          sessionOpen = false
        }
      }
    } while (trackingAgain)
  })().finally(() => { trackingWork = null })
  return trackingWork
}

function itemReady(): boolean {
  if (playerItem.value?.type === 'image') return imageReady.value
  return Boolean(videoPlayer.value?.trackingSample().ready)
}

function clearWatchdog(): void {
  if (loadWatchdog !== undefined) window.clearTimeout(loadWatchdog)
  loadWatchdog = undefined
  loadWatchdogKey = ''
}

function updateWatchdog(restartAttempt = false): void {
  if (!playback.playerOpen || !playerItem.value || itemReady()) { clearWatchdog(); return }
  const key = playerKey.value
  if (!restartAttempt && loadWatchdog !== undefined && loadWatchdogKey === key) return
  clearWatchdog()
  loadWatchdogKey = key
  loadWatchdog = window.setTimeout(() => {
    loadWatchdog = undefined
    loadWatchdogKey = ''
    if (key === playerKey.value && playback.playerOpen && !itemReady()) markFailed('媒体加载超过 15 秒，已跳过')
  }, 15_000)
}

function markFailed(message: string): void {
  const item = playerItem.value; const entry = currentEntry.value
  if (!item || !entry) return
  const failed = new Set(failedKeys.value)
  failed.add(queueKey(entry.entryId, item.id))
  failedKeys.value = failed
  playbackError.value = message
  controlsVisible.value = true
  clearWatchdog()
  const queue = playback.queue
  for (let offset = 1; offset < queue.length; offset += 1) {
    const index = playback.currentIndex + offset
    if (index >= queue.length && !playback.loop) break
    const candidate = queue[index % queue.length]!
    if (!failedKeys.value.has(queueKey(candidate.entryId, candidate.id))) {
      playback.jump((index % queue.length))
      return
    }
  }
  playback.isPlaying = false
  playback.setNotice('本轮没有可播放的媒体。可在队列中重试失败项。', 5_000)
  void syncTracking()
}

function retryCurrent(): void {
  const item = playerItem.value; const entry = currentEntry.value
  if (!item || !entry) return
  const failed = new Set(failedKeys.value)
  failed.delete(queueKey(entry.entryId, item.id))
  failedKeys.value = failed
  playbackError.value = ''
  playback.isPlaying = true
  if (item.type === 'image') imageRetryToken.value += 1
  else videoPlayer.value?.retry()
  updateWatchdog(true)
}

function playQueued(entry: PlaybackQueueEntry, item: PlaybackMedia, index: number): void {
  const failed = new Set(failedKeys.value)
  failed.delete(queueKey(entry.entryId, item.id))
  failedKeys.value = failed
  playbackError.value = ''
  playback.jump(playback.queue.findIndex((queued) => queued.entryId === entry.entryId && queued.id === item.id))
  playback.setCurrentMediaIndex(index)
}

function imageLoading(id: string): void {
  if (id === playerKey.value) {
    imageReady.value = false
    updateWatchdog(true)
  }
}
function imageLoaded(id: string): void {
  if (id === playerKey.value) {
    imageReady.value = true
    updateWatchdog()
    schedule()
    void syncTracking()
  }
}
function imageFailed(id: string, message: string): void { if (id === playerKey.value) { imageReady.value = false; markFailed(message) } }
function onVideoState(): void { updateWatchdog(); void syncTracking() }
function onVideoError(message: string): void { markFailed(message) }

async function advance(): Promise<void> {
  if (!playback.playerOpen || !playerItem.value) return
  const key = playerKey.value
  await playback.next()
  if (playback.playerOpen && playback.isPlaying && key === playerKey.value && playback.loop) schedule()
}
async function handleVideoEnded(): Promise<void> {
  if (shouldRestartVideo(playback.queueLength, playback.loop)) {
    await playback.endSession()
    videoPlayer.value?.restart()
    playback.isPlaying = true
    sessionOpen = false
    return
  }
  await playback.next()
  if (playback.playerOpen && playback.currentItem) playback.isPlaying = true
  sessionOpen = false
}

function closePlayer(): void { playback.playerOpen = false; playback.isPlaying = false; void playback.persistNow() }
function toggleControls(): void {
  controlsVisible.value = !controlsVisible.value
  if (!controlsVisible.value) showQueue.value = false
  void nextTick(() => playerSurface.value?.focus({ preventScroll: true }))
}

watch(() => playback.playerOpen, (open) => {
  controlsVisible.value = true
  showQueue.value = false
  if (open) void nextTick(() => playerSurface.value?.focus({ preventScroll: true }))
  else void syncTracking()
})
watch(() => Boolean(playback.playerOpen && playerItem.value?.type === 'image'), (active) => {
  fullscreenError.value = ''
  const request = active ? window.api.playback.enterFullscreen() : window.api.playback.exitFullscreen()
  void request.catch((error: unknown) => { fullscreenError.value = error instanceof Error ? error.message : '无法切换全屏'; controlsVisible.value = true })
}, { flush: 'sync' })
watch([playerKey, () => playback.playerOpen], ([key, open], [previousKey, wasOpen] = ['', false]) => {
  const changed = key !== previousKey
  const opened = open && !wasOpen
  if (changed || opened) {
    clearTimer()
    imageReady.value = false
    if (changed) playbackError.value = ''
    elapsedImageMs.value = 0
    progress.value = 0
    const item = playerItem.value; const entry = currentEntry.value
    dwellBaseMs = open && item && entry ? playback.imageElapsedFor(entry.entryId, item.id) : 0
  }
  if (changed || opened || !open) updateWatchdog()
}, { flush: 'post', immediate: true })
watch(() => [playback.playerOpen, playback.isPlaying, playerKey.value, playback.imageIntervalSeconds, imageReady.value], () => {
  schedule()
  updateWatchdog()
  void syncTracking()
}, { immediate: true, flush: 'post' })
watch(playerSurface, (surface) => { surface?.focus({ preventScroll: true }) }, { flush: 'post' })
onMounted(() => { sampleTimer = window.setInterval(() => { void syncTracking() }, 1_000) })
onBeforeUnmount(() => {
  clearTimer()
  if (sampleTimer !== undefined) window.clearInterval(sampleTimer)
  if (loadWatchdog !== undefined) window.clearTimeout(loadWatchdog)
  void syncTracking()
  void window.api.playback.exitFullscreen().catch(() => {})
})
</script>

<template>
  <button class="relative grid size-9 place-items-center rounded-xl text-muted transition hover:bg-surface-hover hover:text-foreground" title="播放队列" aria-label="播放队列" @click="playback.openQueue()"><ListVideo :size="18" /><span v-if="playback.entries.length" class="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-violet-500 px-1 text-[10px] leading-4 text-white">{{ playback.entries.length }}</span></button>
  <div v-if="playback.notice" class="fixed left-1/2 top-4 z-[90] -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-900/95 px-4 py-2.5 text-sm text-white shadow-xl" role="status">{{ playback.notice }}</div>
  <div v-if="playback.persistenceError || playback.sampleError" class="fixed bottom-4 left-1/2 z-[90] max-w-[min(90vw,36rem)] -translate-x-1/2 rounded-lg border border-rose-400/20 bg-zinc-950/95 px-3 py-2 text-xs text-rose-200 shadow-xl" role="status">观看记录正在重试保存：{{ playback.persistenceError || playback.sampleError }}</div>

  <div v-if="playback.drawerOpen" class="fixed inset-0 z-40 bg-zinc-950/20" @click.self="playback.drawerOpen = false">
    <aside class="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl">
      <div class="flex items-center justify-between border-b border-line p-5">
        <div><h3 class="font-semibold text-foreground">播放队列</h3><p class="mt-1 text-xs text-muted">{{ playback.entries.length }} 个条目 · {{ playback.queueLength }} 项媒体</p></div>
        <button class="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-hover" aria-label="关闭播放队列" @click="playback.drawerOpen = false"><X :size="18" /></button>
      </div>
      <div class="border-b border-line p-4">
        <div class="flex items-center justify-between text-xs"><span class="font-medium text-muted">等级 {{ playback.effectiveLevel }} · {{ playback.effectiveXp }} XP</span><span class="text-muted">{{ playback.effectiveXpInLevel }} / 100 XP</span></div>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-violet-500 transition-[width]" :style="{ width: `${playback.effectiveXpInLevel}%` }"></div></div>
        <p class="mt-4 text-xs font-medium text-muted">图片播放间隔</p>
        <div class="mt-2 flex items-center gap-2"><button v-for="seconds in [3, 5, 8, 10]" :key="seconds" :class="['rounded-lg px-2.5 py-1.5 text-xs font-medium transition', playback.imageIntervalSeconds === seconds ? 'bg-violet-500 text-white' : 'bg-canvas text-muted hover:bg-surface-hover']" @click="playback.imageIntervalSeconds = seconds; playback.persistSoon()">{{ seconds }} 秒</button><input v-model.number="playback.imageIntervalSeconds" type="number" min="1" max="120" aria-label="自定义图片播放间隔" class="h-8 w-16 rounded-lg border border-line bg-canvas px-2 text-xs text-foreground outline-none focus:border-violet-500" @change="playback.imageIntervalSeconds = Math.min(120, Math.max(1, playback.imageIntervalSeconds)); playback.persistSoon()"></div>
      </div>
      <div class="min-h-0 flex-1 overflow-auto p-3">
        <div v-if="playback.entries.length" class="space-y-2">
          <article v-for="(entry, index) in playback.entries" :key="entry.entryId" class="overflow-hidden rounded-xl border border-line bg-surface transition hover:bg-surface-hover" :class="entry.entryId === playback.currentEntryId ? 'ring-1 ring-violet-500/60' : ''">
            <div class="flex items-center gap-2 p-2">
              <div class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-canvas text-muted">
                <img v-if="cover(entry)?.previewUrl" :src="cover(entry)?.previewUrl ?? undefined" :alt="entry.title" class="size-full object-cover">
                <FileVideo v-else-if="entry.items[0]?.type === 'video'" :size="18" />
                <FileImage v-else :size="18" />
              </div>
              <button class="min-w-0 flex-1 text-left" :aria-label="`${entry.title}，播放或续播`" @click="playback.playEntry(entry.entryId)">
                <span class="flex items-center gap-2"><span class="truncate text-sm font-medium text-foreground">{{ entry.title }}</span><Badge v-if="entry.type === 'album'" class="shrink-0">图包</Badge><Badge v-else class="shrink-0">散媒体</Badge></span>
                <span class="mt-1 block truncate text-xs text-muted">{{ itemCount(entry) }} 项<span v-if="entry.type === 'album'"> · {{ completion(entry).watched }} / {{ completion(entry).total }} 已看</span><span v-else> · {{ entry.source }}</span></span>
              </button>
              <button v-if="entry.type === 'album'" class="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-canvas" :aria-label="`${entry.title}，从头播放`" title="从头播放" @click="playback.playEntry(entry.entryId, true)"><RotateCcw :size="15" /></button>
              <button v-if="entry.type === 'album'" class="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-canvas" :aria-label="expandedEntries.has(entry.entryId) ? '收起媒体' : '展开媒体'" :aria-expanded="expandedEntries.has(entry.entryId)" @click="toggleEntry(entry.entryId)"><ChevronDown v-if="expandedEntries.has(entry.entryId)" :size="16" /><ChevronUp v-else :size="16" /></button>
              <div class="flex shrink-0 items-center gap-0.5">
                <button class="grid size-7 place-items-center rounded-md text-muted hover:bg-canvas disabled:opacity-30" :disabled="index === 0" aria-label="图包上移" @click="playback.moveEntry(entry.entryId, -1)"><ChevronUp :size="14" /></button>
                <button class="grid size-7 place-items-center rounded-md text-muted hover:bg-canvas disabled:opacity-30" :disabled="index === playback.entries.length - 1" aria-label="图包下移" @click="playback.moveEntry(entry.entryId, 1)"><ChevronDown :size="14" /></button>
                <button class="grid size-7 place-items-center rounded-md text-muted hover:bg-rose-500/10 hover:text-rose-600" aria-label="从队列移除图包" @click="playback.removeEntry(entry.entryId)"><Trash2 :size="14" /></button>
              </div>
            </div>
            <div v-if="entry.type === 'album'" class="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-violet-500 transition-[width]" :style="{ width: `${playback.progressFraction(entry) * 100}%` }"></div></div>
            <div v-if="entry.type === 'album' && expandedEntries.has(entry.entryId)" class="max-h-64 space-y-0.5 overflow-y-auto border-t border-line/70 p-2">
              <button v-for="(item, mediaIndex) in entry.items" :key="queueKey(entry.entryId, item.id)" :class="['flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left', isCurrent(entry.entryId, item) ? 'bg-violet-500/10' : 'hover:bg-canvas']" @click="playQueued(entry, item, mediaIndex)">
                <span class="w-5 text-right text-[10px] tabular-nums text-muted">{{ String(mediaIndex + 1).padStart(2, '0') }}</span>
                <FileVideo v-if="item.type === 'video'" :size="13" class="shrink-0 text-muted" /><FileImage v-else :size="13" class="shrink-0 text-muted" />
                <span class="min-w-0 flex-1 truncate text-xs text-foreground">{{ item.title }}</span>
                <span v-if="isFailed(entry.entryId, item)" class="text-[10px] text-rose-500">无法读取 · 重试</span>
                <span v-else-if="playback.isWatched(entry.entryId, item)" class="text-[10px] text-violet-500">已看</span>
              </button>
            </div>
          </article>
        </div>
        <div v-else class="grid min-h-44 place-items-center text-center"><div><ListVideo class="mx-auto text-muted" :size="24" /><p class="mt-3 text-sm text-muted">从图包卡片或媒体卡片加入播放队列</p></div></div>
      </div>
      <div class="flex items-center gap-2 border-t border-line p-4"><Button class="flex-1" :disabled="!playback.entries.length" @click="playback.resume()"><Play :size="16" />{{ playback.resumedFromSave ? '继续播放' : '开始播放' }}</Button><Button variant="outline" :disabled="!playback.entries.length" @click="playback.clear">清空队列</Button></div>
    </aside>
  </div>

  <Teleport to="body">
    <div v-if="playback.playerOpen && playerItem" class="fixed inset-0 z-50 overflow-hidden bg-black text-white" role="dialog" aria-modal="true" aria-label="媒体播放" @keydown.esc="closePlayer">
      <PlaybackImageStage v-if="playerItem.type === 'image'" :id="playerKey" :src="playerItem.mediaUrl" :title="playerItem.title" :next-src="nextImageUrl" :retry-token="imageRetryToken" @loading="imageLoading" @ready="imageLoaded" @error="imageFailed" />
      <VideoPlayer v-else :key="playerKey" ref="videoPlayer" :src="playerItem.mediaUrl" :title="playerItem.title" :subtitle="playerPositionLabel" :poster="playerItem.previewUrl" :resume-at-ms="playback.resumePositionMs" v-model:playing="playback.isPlaying" navigation :can-previous="playback.currentIndex > 0 || playback.loop" :can-next="playback.currentIndex < playback.queueLength - 1 || playback.loop" @previous="playback.previous" @next="advance" @ended="handleVideoEnded" @close="closePlayer" @state="onVideoState" @error="onVideoError">
        <template #header><button class="grid size-9 place-items-center rounded-lg hover:bg-white/10" aria-label="播放队列" :aria-expanded="showQueue" @click="toggleQueue"><ListVideo :size="19" /></button></template>
        <template #controls><button class="grid size-9 place-items-center rounded-lg hover:bg-white/10" aria-label="上一图包" :disabled="playback.entries.length < 2 && !playback.loop" @click="playback.previousPack"><Layers3 class="rotate-180" :size="17" /></button><button class="grid size-9 place-items-center rounded-lg hover:bg-white/10" aria-label="下一图包" :disabled="playback.entries.length < 2 && !playback.loop" @click="playback.nextPack"><Layers3 :size="17" /></button><button class="grid size-9 place-items-center rounded-lg hover:bg-white/10" :class="playback.loop ? 'text-violet-300' : 'text-white/50'" aria-label="循环播放" :aria-pressed="playback.loop" @click="playback.loop = !playback.loop; playback.persistSoon()"><Repeat2 :size="18" /></button></template>
        <aside v-if="showQueue" class="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-white/15 bg-zinc-950/90 p-5 backdrop-blur"><div class="flex items-center justify-between"><h4 class="font-semibold">播放队列</h4><button aria-label="关闭播放队列" @click="showQueue = false"><X :size="18" /></button></div><div class="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto"><section v-for="entry in playback.entries" :key="entry.entryId"><button class="mb-1 flex w-full items-center justify-between text-left text-xs font-medium text-white/70" @click="playback.playEntry(entry.entryId)"><span class="truncate">{{ entry.type === 'album' ? `图包 · ${entry.title}` : entry.title }}</span><span>{{ entry.items.length }} 项</span></button><button v-for="(item, index) in entry.items" :key="queueKey(entry.entryId, item.id)" :class="['flex w-full items-center gap-3 rounded-lg p-2 text-left', isCurrent(entry.entryId, item) ? 'bg-white/15' : 'hover:bg-white/10']" @click="playQueued(entry, item, index)"><span class="text-xs text-white/60">{{ index + 1 }}</span><span class="min-w-0 flex-1"><span class="block truncate text-sm">{{ item.title }}</span><span class="block truncate text-xs text-white/60">{{ item.source }}</span></span><span v-if="isFailed(entry.entryId, item)" class="text-[10px] text-rose-300">重试</span></button></section></div></aside>
      </VideoPlayer>
      <template v-if="playerItem.type === 'image'">
        <button ref="playerSurface" class="absolute inset-0 size-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/60" :class="{ 'cursor-none': !controlsVisible }" :aria-label="controlsVisible ? '隐藏播放控件' : '显示播放控件'" :aria-expanded="controlsVisible" @click="toggleControls" />
        <p v-if="playbackError || fullscreenError" class="pointer-events-auto absolute inset-x-4 top-24 flex items-center justify-center gap-3 rounded bg-black/85 p-3 text-center text-sm text-rose-300" role="alert"><span>{{ playbackError || fullscreenError }}</span><button v-if="playbackError" class="rounded bg-white/10 px-2.5 py-1 text-white hover:bg-white/20" @click="retryCurrent">重试</button></p>
        <template v-if="controlsVisible">
          <header class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/80 to-transparent p-4 pb-12 lg:p-6 lg:pb-14"><div class="min-w-0"><p class="truncate text-sm text-white/70">{{ playerPositionLabel }}</p><h3 class="mt-1 truncate text-lg font-semibold">{{ playerItem.title }}</h3></div><div class="pointer-events-auto flex shrink-0 items-center gap-2"><Badge class="border-white/15 bg-black/40 text-white">{{ playback.currentIndex + 1 }} / {{ playback.queueLength }}</Badge><Badge class="border-white/15 bg-black/40 text-white">Lv.{{ playback.effectiveLevel }} · {{ playback.effectiveXp }} XP</Badge><button class="grid size-9 place-items-center rounded-xl bg-black/40 hover:bg-white/20" title="隐藏控件，点击画面重新显示" aria-label="隐藏播放控件" @click="toggleControls"><EyeOff :size="18" /></button><button class="grid size-9 place-items-center rounded-xl bg-black/40 hover:bg-white/20" title="播放队列" aria-label="播放队列" :aria-expanded="showQueue" @click="toggleQueue"><ListVideo :size="18" /></button><button class="grid size-9 place-items-center rounded-xl bg-black/40 hover:bg-white/20" title="关闭播放（Esc）" aria-label="关闭播放" @click="closePlayer"><X :size="18" /></button></div></header>
          <footer class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-12 lg:px-6 lg:pb-6"><div class="mx-auto w-full max-w-3xl"><div class="h-1 overflow-hidden rounded-full bg-white/25"><div class="h-full bg-white transition-[width] duration-100" :style="{ width: `${progress}%` }"></div></div><div class="mt-4 flex items-center justify-center gap-2"><button class="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/40 hover:bg-white/20" aria-label="上一项" @click="playback.previous"><SkipBack :size="19" /></button><button class="pointer-events-auto grid size-8 place-items-center rounded-full bg-black/40 hover:bg-white/20" aria-label="上一图包" :disabled="playback.entries.length < 2 && !playback.loop" @click="playback.previousPack"><Layers3 class="rotate-180" :size="16" /></button><button class="pointer-events-auto grid size-14 place-items-center rounded-full bg-white text-zinc-900 shadow-lg" :aria-label="playback.isPlaying ? '暂停' : '播放'" @click="playback.isPlaying = !playback.isPlaying"><Pause v-if="playback.isPlaying" :size="22" fill="currentColor" /><Play v-else :size="22" fill="currentColor" /></button><button class="pointer-events-auto grid size-8 place-items-center rounded-full bg-black/40 hover:bg-white/20" aria-label="下一图包" :disabled="playback.entries.length < 2 && !playback.loop" @click="playback.nextPack"><Layers3 :size="16" /></button><button class="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/40 hover:bg-white/20" aria-label="下一项" @click="advance"><SkipForward :size="19" /></button><button class="pointer-events-auto ml-2 grid size-10 place-items-center rounded-full" :class="playback.loop ? 'bg-violet-500 text-white' : 'bg-black/40 text-white/75 hover:bg-white/20'" aria-label="循环播放" :aria-pressed="playback.loop" @click="playback.loop = !playback.loop; playback.persistSoon()"><Repeat2 :size="18" /></button></div><p class="mt-3 text-center text-xs text-white/65">{{ playback.imageIntervalSeconds }} 秒／张 · 本包 {{ completion(currentEntry!).watched }} / {{ completion(currentEntry!).total }} 项 · Lv.{{ playback.effectiveLevel }} {{ levelProgress }} / 100 XP</p></div></footer>
          <aside v-if="showQueue" class="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-white/15 bg-zinc-950/90 p-5 backdrop-blur"><div class="flex items-center justify-between"><h4 class="font-semibold">播放队列</h4><button aria-label="关闭播放队列" @click="showQueue = false"><X :size="18" /></button></div><div class="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto"><section v-for="entry in playback.entries" :key="entry.entryId"><button class="mb-1 flex w-full items-center justify-between text-left text-xs font-medium text-white/70" @click="playback.playEntry(entry.entryId)"><span class="truncate">{{ entry.type === 'album' ? `图包 · ${entry.title}` : entry.title }}</span><span>{{ entry.items.length }} 项</span></button><button v-for="(item, index) in entry.items" :key="queueKey(entry.entryId, item.id)" :class="['flex w-full items-center gap-3 rounded-lg p-2 text-left', isCurrent(entry.entryId, item) ? 'bg-white/15' : 'hover:bg-white/10']" @click="playQueued(entry, item, index)"><span class="text-xs text-white/60">{{ index + 1 }}</span><span class="min-w-0 flex-1"><span class="block truncate text-sm">{{ item.title }}</span><span class="block truncate text-xs text-white/60">{{ item.source }}</span></span><span v-if="isFailed(entry.entryId, item)" class="text-[10px] text-rose-300">重试</span></button></section></div></aside>
        </template>
      </template>
    </div>
  </Teleport>
</template>
