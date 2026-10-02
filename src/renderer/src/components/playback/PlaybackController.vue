<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, EyeOff, FileImage, FileVideo, ListVideo, Pause, Play, Repeat2, SkipBack, SkipForward, Trash2, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import { usePlaybackStore } from '@/stores/playback'
import { shouldRestartVideo } from '@/utils/playback-player'
import VideoPlayer from './VideoPlayer.vue'
import PlaybackImageStage from './PlaybackImageStage.vue'

const playback = usePlaybackStore()
const showQueue = ref(false)
const controlsVisible = ref(true)
const playerSurface = ref<HTMLButtonElement | null>(null)
let timer: number | undefined
let progressFrame = 0
const imageReady = ref(false)
const playbackError = ref('')
const fullscreenError = ref('')
const nextImageUrl = computed(() => {
  const index = playback.currentIndex + 1
  const item = playback.queue[index] ?? (playback.loop ? playback.queue[0] : undefined)
  return item?.type === 'image' ? item.mediaUrl : undefined
})
const progress = ref(0)
const playerItem = computed(() => playback.currentItem)
const videoPlayer = ref<InstanceType<typeof VideoPlayer> | null>(null)

function toggleControls(): void {
  controlsVisible.value = !controlsVisible.value
  if (!controlsVisible.value) showQueue.value = false
  void nextTick(() => playerSurface.value?.focus({ preventScroll: true }))
}

watch(() => playback.playerOpen, (open) => {
  controlsVisible.value = true
  showQueue.value = false
  if (open) void nextTick(() => playerSurface.value?.focus({ preventScroll: true }))
})

watch(() => Boolean(playback.playerOpen && playerItem.value?.type === 'image'), (active) => {
  fullscreenError.value = ''
  const request = active ? window.api.playback.enterFullscreen() : window.api.playback.exitFullscreen()
  void request.catch((error: unknown) => {
    fullscreenError.value = error instanceof Error ? error.message : '无法切换全屏'
    controlsVisible.value = true
  })
}, { flush: 'sync' })

watch(() => [playback.playerOpen, playerItem.value?.id], () => {
  clearTimer()
  imageReady.value = false
  playbackError.value = ''
}, { flush: 'sync' })

watch(playerSurface, surface => { surface?.focus({ preventScroll: true }) }, { flush: 'post' })

function imageLoaded(id: string): void {
  if (id === playerItem.value?.id) imageReady.value = true
}
function imageFailed(message: string): void {
  playbackError.value = message
  controlsVisible.value = true
}

function clearTimer(): void {
  if (timer) window.clearTimeout(timer)
  timer = undefined
  cancelAnimationFrame(progressFrame)
}
function schedule(): void {
  clearTimer(); progress.value = 0
  if (!playback.playerOpen || !playback.isPlaying || !imageReady.value || playerItem.value?.type !== 'image') return
  const seconds = Math.min(120, Math.max(1, Number(playback.imageIntervalSeconds) || 5))
  const started = Date.now()
  const update = () => { progress.value = Math.min(100, ((Date.now() - started) / (seconds * 1000)) * 100); if (progress.value < 100 && playback.isPlaying) progressFrame = window.requestAnimationFrame(update) }
  progressFrame = window.requestAnimationFrame(update)
  timer = window.setTimeout(() => {
    playback.next()
    if (playback.queue.length === 1 && playback.loop) schedule()
  }, seconds * 1000)
}
function handleVideoEnded(): void {
  if (shouldRestartVideo(playback.queue.length, playback.loop)) {
    playback.isPlaying = true
    videoPlayer.value?.restart()
    return
  }
  const continues = playback.currentIndex < playback.queue.length - 1 || playback.loop
  playback.next()
  if (continues) playback.isPlaying = true
}
watch(() => [playback.playerOpen, playback.isPlaying, playback.currentIndex, playback.imageIntervalSeconds, playerItem.value?.id, imageReady.value], () => { schedule() }, { immediate: true })
onBeforeUnmount(() => {
  clearTimer()
  void window.api.playback.exitFullscreen().catch(() => {})
})
</script>

<template>
  <button class="relative grid size-9 place-items-center rounded-xl text-muted transition hover:bg-surface-hover hover:text-foreground" title="播放队列" @click="playback.drawerOpen = true"><ListVideo :size="18" /><span v-if="playback.queue.length" class="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-violet-500 px-1 text-[10px] leading-4 text-white">{{ playback.queue.length }}</span></button>
  <div v-if="playback.drawerOpen" class="fixed inset-0 z-40 bg-zinc-950/20" @click.self="playback.drawerOpen = false"><aside class="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"><div class="flex items-center justify-between border-b border-line p-5"><div><h3 class="font-semibold text-foreground">播放队列</h3><p class="mt-1 text-xs text-muted">{{ playback.queue.length }} 项 · 图片按本次间隔播放</p></div><button class="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-hover" @click="playback.drawerOpen = false"><X :size="18" /></button></div><div class="border-b border-line p-4"><p class="text-xs font-medium text-muted">图片播放间隔</p><div class="mt-2 flex items-center gap-2"><button v-for="seconds in [3, 5, 8, 10]" :key="seconds" :class="['rounded-lg px-2.5 py-1.5 text-xs font-medium transition', playback.imageIntervalSeconds === seconds ? 'bg-violet-500 text-white' : 'bg-canvas text-muted hover:bg-surface-hover']" @click="playback.imageIntervalSeconds = seconds">{{ seconds }} 秒</button><input v-model.number="playback.imageIntervalSeconds" type="number" min="1" max="120" class="h-8 w-16 rounded-lg border border-line bg-canvas px-2 text-xs text-foreground outline-none focus:border-violet-500" /></div></div><div class="min-h-0 flex-1 overflow-auto p-3"><div v-if="playback.queue.length" class="space-y-1"><article v-for="(item, index) in playback.queue" :key="item.id" class="group flex items-center gap-3 rounded-lg p-2 transition hover:bg-surface-hover"><div class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-canvas text-muted"><img v-if="item.previewUrl" :src="item.previewUrl" :alt="item.title" class="size-full object-cover"><FileVideo v-else-if="item.type === 'video'" :size="18" /><FileImage v-else :size="18" /></div><button class="min-w-0 flex-1 text-left" @click="playback.play(index)"><p class="truncate text-sm font-medium text-foreground">{{ item.title }}</p><p class="mt-0.5 text-xs text-muted">{{ item.source }} · {{ item.type === 'video' ? '视频' : '图片' }}</p></button><div class="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100"><button class="grid size-7 place-items-center rounded-md text-muted hover:bg-canvas" :disabled="index === 0" @click="playback.move(item.id, -1)"><ChevronUp :size="15" /></button><button class="grid size-7 place-items-center rounded-md text-muted hover:bg-canvas" :disabled="index === playback.queue.length - 1" @click="playback.move(item.id, 1)"><ChevronDown :size="15" /></button><button class="grid size-7 place-items-center rounded-md text-muted hover:bg-rose-500/10 hover:text-rose-600" @click="playback.remove(item.id)"><Trash2 :size="15" /></button></div></article></div><div v-else class="grid min-h-44 place-items-center text-center"><div><ListVideo class="mx-auto text-muted" :size="24" /><p class="mt-3 text-sm text-muted">从图集或媒体卡片加入播放队列</p></div></div></div><div class="flex items-center gap-2 border-t border-line p-4"><Button class="flex-1" :disabled="!playback.queue.length" @click="playback.play()"><Play :size="16" />开始播放</Button><Button variant="outline" :disabled="!playback.queue.length" @click="playback.clear">清空</Button></div></aside></div>
  <Teleport to="body">
    <div
      v-if="playback.playerOpen && playerItem"
      class="fixed inset-0 z-50 overflow-hidden bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="媒体播放"
      @keydown.esc="() => { if (playerItem.type === 'image') playback.playerOpen = false }"
    >
      <PlaybackImageStage
        v-if="playerItem.type === 'image'"
        :id="playerItem.id"
        :src="playerItem.mediaUrl"
        :title="playerItem.title"
        :next-src="nextImageUrl"
        @loading="imageReady = false"
        @ready="imageLoaded"
        @error="imageFailed"
      />
      <VideoPlayer v-else :key="playerItem.id" ref="videoPlayer" :src="playerItem.mediaUrl" :title="playerItem.title" :subtitle="`${playerItem.source} · ${playback.currentIndex + 1} / ${playback.queue.length}`" :poster="playerItem.previewUrl" v-model:playing="playback.isPlaying" navigation :can-previous="playback.currentIndex > 0 || playback.loop" :can-next="playback.currentIndex < playback.queue.length - 1 || playback.loop" @previous="playback.previous" @next="playback.next" @ended="handleVideoEnded" @close="playback.playerOpen = false">
        <template #header><button class="grid size-9 place-items-center rounded-lg hover:bg-white/10" aria-label="播放队列" :aria-expanded="showQueue" @click="showQueue = !showQueue"><ListVideo :size="19" /></button></template>
        <template #controls><button class="grid size-9 place-items-center rounded-lg hover:bg-white/10" :class="playback.loop ? 'text-violet-300' : 'text-white/50'" aria-label="循环播放" :aria-pressed="playback.loop" @click="playback.loop = !playback.loop"><Repeat2 :size="18" /></button></template>
      <aside v-if="showQueue" class="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-white/15 bg-zinc-950/90 p-5 backdrop-blur">
        <div class="flex items-center justify-between"><h4 class="font-semibold">播放队列</h4><button aria-label="关闭播放队列" @click="showQueue = false"><X :size="18" /></button></div>
        <div class="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
          <button v-for="(item, index) in playback.queue" :key="item.id" :class="['flex w-full items-center gap-3 rounded-lg p-2 text-left', index === playback.currentIndex ? 'bg-white/15' : 'hover:bg-white/10']" @click="playback.jump(index)">
            <span class="text-xs text-white/60">{{ index + 1 }}</span>
            <span class="min-w-0"><span class="block truncate text-sm">{{ item.title }}</span><span class="block truncate text-xs text-white/60">{{ item.source }}</span></span>
          </button>
        </div>
      </aside>
      </VideoPlayer>
      <template v-if="playerItem.type === 'image'">
      <button
        ref="playerSurface"
        class="absolute inset-0 size-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/60"
        :class="{ 'cursor-none': !controlsVisible }"
        :aria-label="controlsVisible ? '隐藏播放控件' : '显示播放控件'"
        :aria-expanded="controlsVisible"
        @click="toggleControls"
      />
      <template v-if="controlsVisible">
        <p v-if="playbackError || fullscreenError" role="alert" class="pointer-events-none absolute inset-x-4 top-24 rounded bg-black/80 p-3 text-center text-sm text-rose-300">{{ playbackError || fullscreenError }}</p>
        <header class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/80 to-transparent p-4 pb-12 lg:p-6 lg:pb-14">
          <div class="min-w-0">
            <p class="truncate text-sm text-white/70">{{ playerItem.source }}</p>
            <h3 class="mt-1 truncate text-lg font-semibold">{{ playerItem.title }}</h3>
          </div>
          <div class="pointer-events-auto flex shrink-0 items-center gap-2">
            <Badge class="border-white/15 bg-black/40 text-white">{{ playback.currentIndex + 1 }} / {{ playback.queue.length }}</Badge>
            <button class="grid size-9 place-items-center rounded-xl bg-black/40 hover:bg-white/20" title="隐藏控件，点击画面重新显示" aria-label="隐藏播放控件" @click="toggleControls"><EyeOff :size="18" /></button>
            <button class="grid size-9 place-items-center rounded-xl bg-black/40 hover:bg-white/20" title="播放队列" aria-label="播放队列" :aria-expanded="showQueue" @click="showQueue = !showQueue"><ListVideo :size="18" /></button>
            <button class="grid size-9 place-items-center rounded-xl bg-black/40 hover:bg-white/20" title="关闭播放（Esc）" aria-label="关闭播放" @click="playback.playerOpen = false"><X :size="18" /></button>
          </div>
        </header>
        <footer class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-12 lg:px-6 lg:pb-6">
          <div class="mx-auto w-full max-w-3xl">
            <div class="h-1 overflow-hidden rounded-full bg-white/25"><div class="h-full bg-white transition-[width] duration-100" :style="{ width: `${progress}%` }"></div></div>
            <div class="mt-4 flex items-center justify-center gap-3">
              <button class="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/40 hover:bg-white/20" aria-label="上一项" @click="playback.previous"><SkipBack :size="19" /></button>
              <button class="pointer-events-auto grid size-14 place-items-center rounded-full bg-white text-zinc-900 shadow-lg" :aria-label="playback.isPlaying ? '暂停' : '播放'" @click="playback.isPlaying = !playback.isPlaying"><Pause v-if="playback.isPlaying" :size="22" fill="currentColor" /><Play v-else :size="22" fill="currentColor" /></button>
              <button class="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/40 hover:bg-white/20" aria-label="下一项" @click="playback.next"><SkipForward :size="19" /></button>
              <button class="pointer-events-auto ml-3 grid size-10 place-items-center rounded-full" :class="playback.loop ? 'bg-violet-500 text-white' : 'bg-black/40 text-white/75 hover:bg-white/20'" aria-label="循环播放" :aria-pressed="playback.loop" @click="playback.loop = !playback.loop"><Repeat2 :size="18" /></button>
            </div>
            <p class="mt-3 text-center text-xs text-white/65">图片停留 {{ playback.imageIntervalSeconds }} 秒 · 点击画面隐藏控件</p>
          </div>
        </footer>
      </template>
      <aside v-if="controlsVisible && showQueue" class="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-white/15 bg-zinc-950/90 p-5 backdrop-blur">
        <div class="flex items-center justify-between"><h4 class="font-semibold">播放队列</h4><button aria-label="关闭播放队列" @click="showQueue = false"><X :size="18" /></button></div>
        <div class="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
          <button v-for="(item, index) in playback.queue" :key="item.id" :class="['flex w-full items-center gap-3 rounded-lg p-2 text-left', index === playback.currentIndex ? 'bg-white/15' : 'hover:bg-white/10']" @click="playback.jump(index)">
            <span class="text-xs text-white/60">{{ index + 1 }}</span>
            <span class="min-w-0"><span class="block truncate text-sm">{{ item.title }}</span><span class="block truncate text-xs text-white/60">{{ item.source }}</span></span>
          </button>
        </div>
      </aside>
      </template>
    </div>
  </Teleport>
</template>
