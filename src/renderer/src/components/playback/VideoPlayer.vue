<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from 'lucide-vue-next'
import { seekTime, videoShortcut, videoTime } from '@/utils/video-player'

const props = withDefaults(defineProps<{
  src: string; title: string; poster?: string | null; subtitle?: string; playing?: boolean
  canPrevious?: boolean; canNext?: boolean; navigation?: boolean; resumeAtMs?: number; retryToken?: number
}>(), { playing: true, navigation: false, canPrevious: true, canNext: true, resumeAtMs: 0, retryToken: 0 })
const emit = defineEmits<{ 'update:playing': [value: boolean]; ended: []; close: []; previous: []; next: []; state: [value: ReturnType<typeof trackingSample>]; error: [message: string] }>()
const stage = ref<HTMLElement>(); const video = ref<HTMLVideoElement>()
const paused = ref(true); const waiting = ref(true); const error = ref(''); const fullscreenError = ref(''); const seeking = ref(false); const readyToPlay = ref(false)
const current = ref(0); const duration = ref(0); const volume = ref(1); const muted = ref(false); const rate = ref(1)
const visible = ref(true); const fullscreen = ref(false); const interacting = ref(false); const focused = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false; let playRevision = 0
const seekable = computed(() => Number.isFinite(duration.value) && duration.value > 0)
const progress = computed(() => seekable.value ? current.value / duration.value * 100 : 0)
function reveal() {
  visible.value = true
  clearTimeout(timer)
  if (!paused.value && !waiting.value && !error.value && !fullscreenError.value && !interacting.value && !focused.value) timer = setTimeout(() => { visible.value = false }, 3000)
}
async function play() {
  const element = video.value; const revision = ++playRevision
  if (!element) return
  try { await element.play() }
  catch (reason) {
    if (disposed || video.value !== element || revision !== playRevision) return
    if (reason instanceof DOMException && reason.name === 'AbortError') return
    waiting.value = false; paused.value = true; emit('update:playing', false)
    if (!(reason instanceof DOMException && reason.name === 'NotAllowedError')) error.value = '无法播放此视频，请检查文件或编码格式'
    reveal()
  }
}
function toggle() {
  if (!video.value) return
  if (video.value.paused) { if (video.value.ended) video.value.currentTime = 0; void play() }
  else { playRevision++; video.value.pause() }
}
function sync() {
  const element = video.value
  if (!element || disposed) return
  current.value = Number.isFinite(element.currentTime) ? element.currentTime : 0
  duration.value = element.duration
}
function trackingSample() {
  const element = video.value
  return {
    ready: readyToPlay.value && !waiting.value && !error.value,
    playing: Boolean(element && !element.paused && !element.ended), waiting: waiting.value,
    seeking: seeking.value || Boolean(element?.seeking), error: Boolean(error.value),
    positionMs: Math.max(0, Math.floor((Number.isFinite(element?.currentTime) ? element?.currentTime ?? 0 : 0) * 1000)),
    durationMs: Math.max(0, Math.floor((Number.isFinite(element?.duration) ? element?.duration ?? 0 : 0) * 1000)),
    playbackRate: rate.value
  }
}
function emitTracking(): void { emit('state', trackingSample()) }
function metadata(): void {
  sync()
  const element = video.value
  if (!element) return
  if (!element.dataset['resumeApplied']) {
    element.dataset['resumeApplied'] = 'true'
    if (props.resumeAtMs > 0 && Number.isFinite(element.duration) && element.duration > 0) {
      element.currentTime = Math.min(element.duration, props.resumeAtMs / 1000)
      sync()
    }
  }
  emitTracking()
}
function seek(value: number) { const time = seekTime(value, duration.value); if (video.value && time !== null) { video.value.currentTime = time; current.value = time; reveal() } }
function playState() {
  if (!video.value || disposed) return
  paused.value = video.value.paused
  emit('update:playing', !paused.value)
  reveal()
  emitTracking()
}
function ready() { if (disposed) return; readyToPlay.value = true; waiting.value = false; sync(); reveal(); emitTracking() }
function failed() { if (disposed) return; waiting.value = false; readyToPlay.value = false; error.value = '无法播放此视频，请检查文件或编码格式'; emit('update:playing', false); reveal(); emit('error', error.value); emitTracking() }
function ended() { if (disposed) return; paused.value = true; emit('update:playing', false); reveal(); emitTracking(); emit('ended') }
function restart() { if (video.value) { video.value.currentTime = 0; void play() } }
function retryPlayback() {
  const element = video.value
  if (!element) return
  error.value = ''; waiting.value = true; readyToPlay.value = false; seeking.value = false
  element.load()
  void play()
  emitTracking()
}
async function toggleFullscreen() {
  fullscreenError.value = ''
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.value?.requestFullscreen() }
  catch { fullscreenError.value = '无法切换全屏，请重试'; reveal() }
}
function fullscreenChanged() { fullscreen.value = document.fullscreenElement === stage.value; reveal() }
function focusControls(event: FocusEvent) { focused.value = (event.target as HTMLElement).matches(':focus-visible'); reveal() }
async function close() { if (document.fullscreenElement === stage.value) await document.exitFullscreen().catch(() => {}); emit('close') }
function keydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
  const target = event.target as HTMLElement
  if (target.closest('input, select, textarea, [contenteditable="true"]')) return
  const action = videoShortcut(event.key)
  if (!action) return
  if (action === 'play' && target.closest('button')) return
  event.preventDefault(); event.stopPropagation()
  if (action === 'play') toggle()
  else if (action === 'back') seek(current.value - 5)
  else if (action === 'forward') seek(current.value + 5)
  else if (action === 'mute') muted.value = !muted.value
  else if (action === 'fullscreen') void toggleFullscreen()
  else if (fullscreen.value) void toggleFullscreen()
  else void close()
  reveal()
}
watch(() => props.playing, value => { if (value) void play(); else { playRevision++; video.value?.pause(); emitTracking() } })
watch([volume, muted, rate], () => { if (video.value) { video.value.volume = volume.value; video.value.muted = muted.value; video.value.playbackRate = rate.value }; reveal() })
onMounted(() => {
  document.addEventListener('fullscreenchange', fullscreenChanged)
  void nextTick(() => { stage.value?.focus(); if (props.playing) void play() })
})
onBeforeUnmount(() => {
  disposed = true; playRevision++; clearTimeout(timer)
  document.removeEventListener('fullscreenchange', fullscreenChanged)
  if (document.fullscreenElement === stage.value) void document.exitFullscreen().catch(() => {})
  const element = video.value
  if (element) { element.pause(); element.removeAttribute('src'); element.load() }
})
watch(() => props.retryToken, (value, previous) => { if (value !== previous) retryPlayback() })
defineExpose({ restart, retry: retryPlayback, trackingSample })
</script>

<template>
  <section ref="stage" tabindex="-1" role="dialog" aria-modal="true" :aria-label="title" class="cinema-player absolute inset-0 overflow-hidden bg-black text-white outline-none" :class="{ 'cursor-none': !visible }" @mousemove="reveal" @pointerdown="reveal" @keydown="keydown">
    <video ref="video" :src="src" :poster="poster || undefined" playsinline preload="metadata" class="absolute inset-0 size-full object-contain" @click="toggle" @dblclick="toggleFullscreen" @loadedmetadata="metadata" @durationchange="metadata" @timeupdate="sync; emitTracking()" @play="playState" @pause="playState" @playing="ready" @canplay="ready" @waiting="waiting = true; reveal(); emitTracking()" @seeking="seeking = true; emitTracking()" @seeked="seeking = false; emitTracking()" @ended="ended" @error="failed" />
    <div v-if="waiting && !error" role="status" class="pointer-events-none absolute inset-0 grid place-items-center"><LoaderCircle class="animate-spin text-white/80" :size="36" /><span class="sr-only">正在加载视频</span></div>
    <button v-if="paused && !waiting && !error" class="absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/30 text-white shadow-2xl backdrop-blur-md transition hover:scale-105 hover:bg-violet-500/70" aria-label="播放视频" @click="toggle"><Play :size="32" fill="currentColor" /></button>
    <div v-if="error || fullscreenError" role="alert" class="absolute inset-x-6 top-28 flex items-center justify-center gap-3 rounded-xl bg-zinc-900/90 p-4 text-center text-sm text-rose-300"><span>{{ error || fullscreenError }}</span><button v-if="error" class="rounded-lg bg-white/10 px-3 py-1.5 text-white hover:bg-white/20" @click="retryPlayback">重试</button></div>
    <div :class="['pointer-events-none absolute inset-0 transition-opacity duration-200', visible ? 'opacity-100' : 'invisible opacity-0']">
      <header class="pointer-events-auto absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/85 to-transparent px-6 pb-16 pt-6" @mouseenter="interacting = true; reveal()" @mouseleave="interacting = false; reveal()" @focusin="focusControls" @focusout="focused = false; reveal()">
        <div class="min-w-0"><p class="text-[10px] font-semibold tracking-[0.25em] text-violet-300">NOW PLAYING</p><h3 class="mt-2 truncate text-lg font-medium" :title="title">{{ title }}</h3><p v-if="subtitle" class="mt-1 truncate text-xs text-white/50">{{ subtitle }}</p></div>
        <div class="flex shrink-0 items-center gap-2"><slot name="header" /><button class="cinema-button" aria-label="关闭播放" title="关闭播放（Esc）" @click="close"><X :size="20" /></button></div>
      </header>
      <footer class="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-5 pt-20 sm:px-8" @mouseenter="interacting = true; reveal()" @mouseleave="interacting = false; reveal()" @focusin="focusControls" @focusout="focused = false; reveal()">
        <div class="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-zinc-950/65 px-4 pb-3 pt-2 shadow-2xl backdrop-blur-xl sm:px-5">
          <input aria-label="播放进度" type="range" min="0" :max="seekable ? duration : 0" step="0.1" :value="current" :disabled="!seekable" class="cinema-seek w-full" :style="{ '--progress': `${progress}%` }" @input="seek(Number(($event.target as HTMLInputElement).value))" />
          <div class="mt-1 flex flex-wrap items-center gap-1 sm:gap-2">
            <button v-if="navigation" class="cinema-button" :disabled="!canPrevious" aria-label="上一项" @click="emit('previous')"><ChevronLeft :size="20" /></button>
            <button class="cinema-button text-violet-300" :aria-label="paused ? '播放' : '暂停'" @click="toggle"><Play v-if="paused" :size="22" fill="currentColor" /><Pause v-else :size="22" fill="currentColor" /></button>
            <button v-if="navigation" class="cinema-button" :disabled="!canNext" aria-label="下一项" @click="emit('next')"><ChevronRight :size="20" /></button>
            <span class="mr-auto whitespace-nowrap px-2 text-xs tabular-nums text-white/70">{{ videoTime(current) }} <span class="mx-1 text-white/30">/</span> {{ videoTime(duration) }}</span>
            <button class="cinema-button" :aria-label="muted || volume === 0 ? '取消静音' : '静音'" @click="muted = !muted"><VolumeX v-if="muted || volume === 0" :size="19" /><Volume2 v-else :size="19" /></button>
            <input v-model.number="volume" aria-label="音量" type="range" min="0" max="1" step="0.01" class="w-16 accent-violet-400 sm:w-20" @input="muted = false" />
            <select v-model.number="rate" aria-label="播放速度" class="ml-2 rounded-lg bg-white/10 px-2 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><option v-for="speed in [0.5, 1, 1.25, 1.5, 2]" :key="speed" :value="speed" class="bg-zinc-900">{{ speed }}×</option></select>
            <slot name="controls" />
            <button class="cinema-button" :aria-label="fullscreen ? '退出全屏' : '全屏'" @click="toggleFullscreen"><Minimize v-if="fullscreen" :size="19" /><Maximize v-else :size="19" /></button>
          </div>
        </div>
      </footer>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.cinema-button { display: grid; width: 36px; height: 36px; flex-shrink: 0; place-items: center; border-radius: 10px; transition: background .15s; cursor: pointer; }
.cinema-button:hover { background: rgb(255 255 255 / 12%); }
.cinema-button:disabled { opacity: .3; cursor: default; }
.cinema-button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
.cinema-seek { appearance: none; height: 22px; background: transparent; cursor: pointer; }
.cinema-seek::-webkit-slider-runnable-track { height: 4px; border-radius: 8px; background: linear-gradient(to right, #a78bfa var(--progress), rgb(255 255 255 / 20%) var(--progress)); }
.cinema-seek::-webkit-slider-thumb { appearance: none; height: 12px; width: 12px; margin-top: -4px; border-radius: 50%; background: #ddd6fe; box-shadow: 0 0 12px #8b5cf655; }
.cinema-seek:disabled { opacity: .4; cursor: default; }
@media (prefers-reduced-motion: reduce) { .cinema-player * { transition: none !important; animation: none !important; } }
</style>
