<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, FileImage, FileVideo, ListVideo, Pause, Play, Repeat2, SkipBack, SkipForward, Trash2, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import { usePlaybackStore } from '@/stores/playback'
import { shouldRestartVideo } from '@/utils/playback-player'

const playback = usePlaybackStore()
const showQueue = ref(false)
let timer: number | undefined
const progress = ref(0)
const playerItem = computed(() => playback.currentItem)
const videoElement = ref<HTMLVideoElement | null>(null)

function clearTimer(): void { if (timer) window.clearTimeout(timer); timer = undefined }
function schedule(): void {
  clearTimer(); progress.value = 0
  if (!playback.playerOpen || !playback.isPlaying || playerItem.value?.type !== 'image') return
  const seconds = playback.imageIntervalSeconds
  const started = Date.now()
  const update = () => { progress.value = Math.min(100, ((Date.now() - started) / (seconds * 1000)) * 100); if (progress.value < 100 && playback.isPlaying) window.requestAnimationFrame(update) }
  window.requestAnimationFrame(update)
  timer = window.setTimeout(() => playback.next(), seconds * 1000)
}
function updateVideoProgress(): void {
  const video = videoElement.value
  if (video?.duration) progress.value = Math.min(100, (video.currentTime / video.duration) * 100)
}
function syncVideoPlayback(): void {
  const video = videoElement.value
  const mediaId = playerItem.value?.id
  if (!video || !mediaId || playerItem.value?.type !== 'video') return
  if (playback.isPlaying) void video.play().catch(() => { if (videoElement.value === video && playerItem.value?.id === mediaId) playback.isPlaying = false })
  else video.pause()
}
function handleVideoEnded(): void {
  if (shouldRestartVideo(playback.queue.length, playback.loop)) {
    const video = videoElement.value
    if (video) video.currentTime = 0
    syncVideoPlayback()
    return
  }
  playback.next()
}
watch(() => [playback.playerOpen, playback.isPlaying, playback.currentIndex, playback.imageIntervalSeconds, playerItem.value?.id], () => { schedule(); void nextTick(syncVideoPlayback) }, { immediate: true })
onBeforeUnmount(clearTimer)
</script>

<template>
  <button class="relative grid size-9 place-items-center rounded-xl text-muted transition hover:bg-surface-hover hover:text-foreground" title="播放队列" @click="playback.drawerOpen = true"><ListVideo :size="18" /><span v-if="playback.queue.length" class="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-violet-500 px-1 text-[10px] leading-4 text-white">{{ playback.queue.length }}</span></button>
  <div v-if="playback.drawerOpen" class="fixed inset-0 z-40 bg-zinc-950/20" @click.self="playback.drawerOpen = false"><aside class="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"><div class="flex items-center justify-between border-b border-line p-5"><div><h3 class="font-semibold text-foreground">播放队列</h3><p class="mt-1 text-xs text-muted">{{ playback.queue.length }} 项 · 图片按本次间隔播放</p></div><button class="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-hover" @click="playback.drawerOpen = false"><X :size="18" /></button></div><div class="border-b border-line p-4"><p class="text-xs font-medium text-muted">图片播放间隔</p><div class="mt-2 flex items-center gap-2"><button v-for="seconds in [3, 5, 8, 10]" :key="seconds" :class="['rounded-lg px-2.5 py-1.5 text-xs font-medium transition', playback.imageIntervalSeconds === seconds ? 'bg-violet-500 text-white' : 'bg-canvas text-muted hover:bg-surface-hover']" @click="playback.imageIntervalSeconds = seconds">{{ seconds }} 秒</button><input v-model.number="playback.imageIntervalSeconds" type="number" min="1" max="120" class="h-8 w-16 rounded-lg border border-line bg-canvas px-2 text-xs text-foreground outline-none focus:border-violet-500" /></div></div><div class="min-h-0 flex-1 overflow-auto p-3"><div v-if="playback.queue.length" class="space-y-1"><article v-for="(item, index) in playback.queue" :key="item.id" class="group flex items-center gap-3 rounded-lg p-2 transition hover:bg-surface-hover"><div class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-canvas text-muted"><img v-if="item.previewUrl" :src="item.previewUrl" :alt="item.title" class="size-full object-cover"><FileVideo v-else-if="item.type === 'video'" :size="18" /><FileImage v-else :size="18" /></div><button class="min-w-0 flex-1 text-left" @click="playback.play(index)"><p class="truncate text-sm font-medium text-foreground">{{ item.title }}</p><p class="mt-0.5 text-xs text-muted">{{ item.source }} · {{ item.type === 'video' ? '视频' : '图片' }}</p></button><div class="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100"><button class="grid size-7 place-items-center rounded-md text-muted hover:bg-canvas" :disabled="index === 0" @click="playback.move(item.id, -1)"><ChevronUp :size="15" /></button><button class="grid size-7 place-items-center rounded-md text-muted hover:bg-canvas" :disabled="index === playback.queue.length - 1" @click="playback.move(item.id, 1)"><ChevronDown :size="15" /></button><button class="grid size-7 place-items-center rounded-md text-muted hover:bg-rose-500/10 hover:text-rose-600" @click="playback.remove(item.id)"><Trash2 :size="15" /></button></div></article></div><div v-else class="grid min-h-44 place-items-center text-center"><div><ListVideo class="mx-auto text-muted" :size="24" /><p class="mt-3 text-sm text-muted">从图集或媒体卡片加入播放队列</p></div></div></div><div class="flex items-center gap-2 border-t border-line p-4"><Button class="flex-1" :disabled="!playback.queue.length" @click="playback.play()"><Play :size="16" />开始播放</Button><Button variant="outline" :disabled="!playback.queue.length" @click="playback.clear">清空</Button></div></aside></div>
  <div v-if="playback.playerOpen && playerItem" class="fixed inset-0 z-50 bg-zinc-950 text-white"><div class="relative flex h-full flex-col p-6 lg:p-8"><div class="flex items-center justify-between"><div><p class="text-sm text-white/70">{{ playerItem.source }}</p><h3 class="mt-1 text-lg font-semibold">{{ playerItem.title }}</h3></div><div class="flex items-center gap-2"><Badge class="border-white/15 bg-white/10 text-white">{{ playback.currentIndex + 1 }} / {{ playback.queue.length }}</Badge><button class="grid size-9 place-items-center rounded-xl bg-white/10 hover:bg-white/20" @click="showQueue = !showQueue"><ListVideo :size="18" /></button><button class="grid size-9 place-items-center rounded-xl bg-white/10 hover:bg-white/20" @click="playback.playerOpen = false"><X :size="18" /></button></div></div><div class="flex min-h-0 flex-1 items-center justify-center py-4"><img v-if="playerItem.type === 'image'" :src="playerItem.mediaUrl" :alt="playerItem.title" class="max-h-full max-w-full object-contain"><video v-else :key="playerItem.id" ref="videoElement" :src="playerItem.mediaUrl" class="max-h-full max-w-full" autoplay playsinline @ended="handleVideoEnded" @timeupdate="updateVideoProgress" /></div><div class="mx-auto w-full max-w-3xl"><div class="h-1 overflow-hidden rounded-full bg-white/25"><div class="h-full bg-white transition-[width] duration-100" :style="{ width: `${progress}%` }"></div></div><div class="mt-5 flex items-center justify-center gap-3"><button class="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" @click="playback.previous"><SkipBack :size="19" /></button><button class="grid size-14 place-items-center rounded-full bg-white text-zinc-900 shadow-lg" @click="playback.isPlaying = !playback.isPlaying"><Pause v-if="playback.isPlaying" :size="22" fill="currentColor" /><Play v-else :size="22" fill="currentColor" /></button><button class="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" @click="playback.next"><SkipForward :size="19" /></button><button class="ml-3 grid size-10 place-items-center rounded-full" :class="playback.loop ? 'bg-violet-500 text-white' : 'bg-white/10 text-white/75 hover:bg-white/20'" @click="playback.loop = !playback.loop"><Repeat2 :size="18" /></button></div><p class="mt-4 text-center text-xs text-white/65">{{ playerItem.type === 'video' ? '视频播放结束后切换' : `图片停留 ${playback.imageIntervalSeconds} 秒` }}</p></div></div><aside v-if="showQueue" class="absolute inset-y-0 right-0 w-full max-w-sm border-l border-white/15 bg-zinc-950/85 p-5 backdrop-blur"><div class="flex items-center justify-between"><h4 class="font-semibold">播放队列</h4><button @click="showQueue = false"><X :size="18" /></button></div><div class="mt-4 space-y-1"><button v-for="(item, index) in playback.queue" :key="item.id" :class="['flex w-full items-center gap-3 rounded-lg p-2 text-left', index === playback.currentIndex ? 'bg-white/15' : 'hover:bg-white/10']" @click="playback.jump(index)"><span class="text-xs text-white/60">{{ index + 1 }}</span><span class="min-w-0"><span class="block truncate text-sm">{{ item.title }}</span><span class="block truncate text-xs text-white/60">{{ item.source }}</span></span></button></div></aside></div>
</template>
