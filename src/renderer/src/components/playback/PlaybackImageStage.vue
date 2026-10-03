<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ id: string; src: string; title: string; nextSrc?: string; retryToken?: number }>()
const emit = defineEmits<{ ready: [id: string]; loading: [id: string]; error: [id: string, message: string] }>()
const current = ref<{ src: string; title: string } | null>(null)
const previous = ref<{ src: string; title: string } | null>(null)
const fading = ref(false)
const animating = ref(false)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let frame = 0
let preload: HTMLImageElement | undefined

function cancelTransition(): void {
  clearTimeout(timer)
  cancelAnimationFrame(frame)
  animating.value = false
  fading.value = false
  previous.value = null
}

watch(() => [props.id, props.src, props.retryToken], async () => {
  const request = ++revision
  const id = props.id
  const src = props.src
  const title = props.title
  cancelTransition()
  emit('loading', id)
  try {
    const image = new Image()
    image.src = src
    await image.decode()
    if (request !== revision) return
    previous.value = current.value
    current.value = { src, title }
    const finish = () => {
      if (request !== revision) return
      previous.value = null
      animating.value = false
      fading.value = false
      emit('ready', id)
    }
    if (!previous.value || reducedMotion.matches) { finish(); return }
    animating.value = true
    await nextTick()
    if (request !== revision) return
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (request !== revision) return
        fading.value = true
        timer = setTimeout(finish, 400)
      })
    })
  } catch {
    if (request === revision) emit('error', id, '无法读取图片，可点击上一项或下一项继续播放')
  }
}, { immediate: true })

watch(() => props.nextSrc, (src) => {
  preload = undefined
  if (src) {
    preload = new Image()
    preload.src = src
    void preload.decode().catch(() => {})
  }
}, { immediate: true })

onBeforeUnmount(() => { revision++; cancelTransition(); preload = undefined })
</script>

<template>
  <div class="pointer-events-none absolute inset-0">
    <img v-if="previous" :src="previous.src" alt="" class="absolute inset-0 size-full object-contain" :class="{ 'image-fade': fading }" :style="{ opacity: fading ? 0 : 1 }" draggable="false">
    <img v-if="current" :src="current.src" :alt="current.title" class="absolute inset-0 size-full select-none object-contain" :class="{ 'image-fade': fading }" :style="{ opacity: animating && !fading ? 0 : 1 }" draggable="false">
  </div>
</template>

<style scoped>
.image-fade { transition: opacity 400ms ease-in-out; }
@media (prefers-reduced-motion: reduce) {
  .image-fade { transition: none; }
}
</style>
