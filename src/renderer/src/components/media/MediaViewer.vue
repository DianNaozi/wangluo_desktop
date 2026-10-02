<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch, ref } from 'vue'
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-vue-next'
import VideoPlayer from '@/components/playback/VideoPlayer.vue'
import { clampViewerIndex, nextViewerIndex, previousViewerIndex, resetImageTransform } from '@/utils/media-viewer'

const props = defineProps<{ open: boolean; media: LibraryMedia[]; activeId: string | null }>()
const emit = defineEmits<{ close: []; 'update:activeId': [id: string] }>()
const transform = ref(resetImageTransform()); const dragging = ref<{ x: number; y: number } | null>(null); const error = ref('')
const activeIndex = computed(() => clampViewerIndex(props.media.findIndex((item) => item.id === props.activeId), props.media.length))
const current = computed(() => props.media[activeIndex.value] ?? null)
const canPrevious = computed(() => activeIndex.value > 0); const canNext = computed(() => activeIndex.value < props.media.length - 1)
function reset(): void { transform.value = resetImageTransform(); error.value = '' }
function show(index: number): void { const item = props.media[clampViewerIndex(index, props.media.length)]; if (item) emit('update:activeId', item.id) }
function previous(): void { show(previousViewerIndex(activeIndex.value)) }
function next(): void { show(nextViewerIndex(activeIndex.value, props.media.length)) }
function close(): void { emit('close') }
function wheel(event: WheelEvent): void { if (!current.value || current.value.mediaKind !== 'image') return; event.preventDefault(); transform.value = { ...transform.value, scale: Math.max(1, Math.min(5, transform.value.scale + (event.deltaY < 0 ? 0.2 : -0.2))) } }
function pointerDown(event: PointerEvent): void { if (transform.value.scale > 1) dragging.value = { x: event.clientX - transform.value.x, y: event.clientY - transform.value.y } }
function pointerMove(event: PointerEvent): void { if (dragging.value) transform.value = { ...transform.value, x: event.clientX - dragging.value.x, y: event.clientY - dragging.value.y } }
function keydown(event: KeyboardEvent): void { if (!props.open || current.value?.mediaKind === 'video') return; if (event.key === 'Escape') close(); else if (event.key === 'ArrowLeft') previous(); else if (event.key === 'ArrowRight') next() }
watch(() => [props.open, props.activeId], reset)
onMounted(() => document.addEventListener('keydown', keydown))
onBeforeUnmount(() => document.removeEventListener('keydown', keydown))
</script>

<template>
  <Teleport to="body"><div v-if="open && current" class="fixed inset-0 z-50 flex bg-black/95" @click.self="close"><VideoPlayer v-if="current.mediaKind === 'video'" :key="current.id" :src="current.mediaUrl" :title="current.originalName" :poster="current.previewUrl" :subtitle="`${activeIndex + 1} / ${media.length}`" navigation :can-previous="canPrevious" :can-next="canNext" @previous="previous" @next="next" @close="close" /><template v-else><header class="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4 text-white"><p class="min-w-0 truncate text-sm">{{ current.originalName }} <span class="ml-2 text-white/60">{{ activeIndex + 1 }} / {{ media.length }}</span></p><div class="flex items-center gap-2"><button v-if="current.mediaKind === 'image'" class="rounded bg-white/10 p-2 hover:bg-white/20" title="重置缩放" @click="reset"><RotateCcw :size="18" /></button><button class="rounded bg-white/10 p-2 hover:bg-white/20" title="关闭" @click="close"><X :size="20" /></button></div></header><button class="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white disabled:opacity-30" :disabled="!canPrevious" @click="previous"><ChevronLeft :size="26" /></button><main class="flex size-full items-center justify-center overflow-hidden p-16" @wheel="wheel" @pointermove="pointerMove" @pointerup="dragging = null" @pointerleave="dragging = null"><img v-if="current.mediaKind === 'image'" :src="current.mediaUrl" :alt="current.originalName" class="max-h-full max-w-full select-none object-contain" :class="transform.scale > 1 ? 'cursor-grab' : ''" :style="{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }" draggable="false" @pointerdown="pointerDown" @error="error = '无法读取原始图片'" /><p v-else class="text-sm text-white/70">此文件类型暂不支持预览</p><p v-if="error" class="absolute bottom-8 rounded bg-rose-500/80 px-3 py-2 text-sm text-white">{{ error }}</p></main><button class="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white disabled:opacity-30" :disabled="!canNext" @click="next"><ChevronRight :size="26" /></button></template></div></Teleport>
</template>
