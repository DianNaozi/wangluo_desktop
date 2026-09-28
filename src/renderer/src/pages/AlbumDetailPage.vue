<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Directive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, File, FileImage, FileVideo, ListPlus, Trash2 } from 'lucide-vue-next'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import MediaViewer from '@/components/media/MediaViewer.vue'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { buildJustifiedRows, getGalleryTargetRowHeight } from '@/utils/justified-gallery'
import { sortMedia } from '@/utils/media-sort'
import { activatePreviewIds, observePreviewElement, retainPreviewIds, stopObservingPreviewElement } from '@/utils/progressive-previews'

const route = useRoute(); const router = useRouter(); const library = useLibraryStore(); const playback = usePlaybackStore(); const album = ref<AlbumDetail | null>(null); const error = ref('')
const trashTarget = ref<{ id: string; name: string; isAlbum: boolean } | null>(null)
const viewerMediaId = ref<string | null>(null)
const sortedMedia = computed(() => album.value ? sortMedia(album.value.media, library.albumSortOrder) : [])
const galleryElement = ref<HTMLElement | null>(null)
const galleryWidth = ref(0)
const aspectRatios = ref<Record<string, number>>({})
const activePreviewIds = ref<Set<string>>(new Set())
const rowHeight = computed(() => getGalleryTargetRowHeight(galleryWidth.value))
const galleryRows = computed(() => {
  const mediaById = new Map(sortedMedia.value.map((media) => [media.id, media]))
  return buildJustifiedRows(sortedMedia.value.map((media) => ({ id: media.id, aspectRatio: aspectRatios.value[media.id] ?? 4 / 3 })), galleryWidth.value, rowHeight.value, 2)
    .map((row) => ({ ...row, items: row.items.map((item) => ({ ...item, media: mediaById.get(item.id)! })) }))
})
let resizeObserver: ResizeObserver | undefined
let previewObserver: IntersectionObserver | undefined
const previewMediaIds = new Map<Element, string>()
function updateGalleryWidth(): void { galleryWidth.value = galleryElement.value?.clientWidth ?? 0 }
type PreviewDirectiveValue = { mediaId: string; hasPreview: boolean }
function updatePreviewObservation(element: Element, value: PreviewDirectiveValue): void {
  if (!value.hasPreview) { previewObserver?.unobserve(element); stopObservingPreviewElement(previewMediaIds, element); return }
  if (previewMediaIds.get(element) === value.mediaId) return
  previewObserver?.unobserve(element)
  observePreviewElement(previewMediaIds, element, value.mediaId)
  previewObserver?.observe(element)
}
const vPreview: Directive<Element, PreviewDirectiveValue> = {
  mounted: (element, binding) => updatePreviewObservation(element, binding.value),
  updated: (element, binding) => updatePreviewObservation(element, binding.value),
  unmounted: (element) => { previewObserver?.unobserve(element); stopObservingPreviewElement(previewMediaIds, element) }
}
function clearPreviewObservation(): void { previewObserver?.disconnect(); previewMediaIds.clear() }
function rememberAspectRatio(mediaId: string, event: Event): void {
  const image = event.target as HTMLImageElement
  if (image.naturalWidth > 0 && image.naturalHeight > 0) aspectRatios.value = { ...aspectRatios.value, [mediaId]: image.naturalWidth / image.naturalHeight }
}
async function load(): Promise<void> {
  try {
    const nextAlbum = await window.api.library.getAlbum(String(route.params.id))
    const isRefreshingCurrentAlbum = album.value?.id === nextAlbum.id
    clearPreviewObservation()
    if (isRefreshingCurrentAlbum) {
      activePreviewIds.value = retainPreviewIds(activePreviewIds.value, nextAlbum.media.map((media) => media.id))
      aspectRatios.value = Object.fromEntries(Object.entries(aspectRatios.value).filter(([id]) => nextAlbum.media.some((media) => media.id === id)))
    } else { activePreviewIds.value = new Set(); aspectRatios.value = {} }
    album.value = nextAlbum
    error.value = ''
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
onMounted(() => {
  resizeObserver = new ResizeObserver(updateGalleryWidth)
  previewObserver = new IntersectionObserver((entries) => {
    const visibleIds = entries.filter((entry) => entry.isIntersecting).flatMap((entry) => previewMediaIds.get(entry.target) ?? [])
    if (visibleIds.length) activePreviewIds.value = activatePreviewIds(activePreviewIds.value, visibleIds)
  }, { rootMargin: '100% 0px' })
  void load().then(() => nextTick(updateGalleryWidth))
})
onBeforeUnmount(() => { resizeObserver?.disconnect(); clearPreviewObservation() })
watch(galleryElement, (element) => { resizeObserver?.disconnect(); if (element) { resizeObserver?.observe(element); updateGalleryWidth() } })
watch(() => route.params.id, () => { void load().then(() => nextTick(updateGalleryWidth)) })
function trashMedia(id: string, name: string): void { trashTarget.value = { id, name, isAlbum: false } }
function openViewer(id: string): void { viewerMediaId.value = id }
function addAlbumToQueue(): void { if (album.value) playback.addMediaBatch(sortedMedia.value, album.value.title) }
function trashAlbum(): void { if (album.value) trashTarget.value = { id: album.value.id, name: album.value.title, isAlbum: true } }
async function confirmTrash(): Promise<void> { const target = trashTarget.value; if (!target) return; trashTarget.value = null; if (target.isAlbum) { await window.api.media.trashAlbum(target.id); await router.push('/library') } else { await window.api.media.trashMedia(target.id); await load() } }
</script>

<template>
  <div class="p-6 lg:p-8"><button class="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground" @click="router.push('/library')"><ArrowLeft :size="16" />返回媒体库</button><div v-if="error" class="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{{ error }}</div><template v-else-if="album"><section class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5"><div><div class="flex items-center gap-2"><Badge>图集</Badge><Badge>{{ album.media.length }} 项</Badge></div><h2 class="mt-2 text-2xl font-semibold text-foreground">{{ album.title }}</h2></div><div class="flex flex-wrap items-center gap-2"><label class="flex items-center gap-2 text-sm text-muted">排序<select v-model="library.albumSortOrder" class="rounded-md border border-line bg-surface px-2 py-1 text-foreground outline-none focus:border-violet-500"><option value="filename">名称（A → Z）</option><option value="importedAt">导入时间（最新优先）</option></select></label><Button variant="outline" @click="addAlbumToQueue"><ListPlus :size="16" />加入播放队列</Button><Button variant="outline" @click="trashAlbum"><Trash2 :size="16" />删除图集</Button></div></section><div ref="galleryElement" class="mt-6 flex flex-col gap-0.5"><div v-for="(row, rowIndex) in galleryRows" :key="rowIndex" class="flex gap-0.5" :class="row.isLast ? 'justify-start' : ''" :style="{ height: `${row.height}px` }"><article v-for="item in row.items" :key="item.id" v-preview="{ mediaId: item.media.id, hasPreview: Boolean(item.media.previewUrl) }" class="group relative shrink-0 cursor-zoom-in overflow-hidden bg-surface-hover" :style="{ width: `${item.width}px` }" @click="openViewer(item.media.id)"><img v-if="item.media.previewUrl && activePreviewIds.has(item.media.id)" :src="item.media.previewUrl" :alt="item.media.originalName" class="size-full object-cover" loading="lazy" decoding="async" @load="rememberAspectRatio(item.media.id, $event)"><div v-else-if="!item.media.previewUrl" class="grid size-full place-items-center text-muted"><FileImage v-if="item.media.mediaKind === 'image'" :size="28" /><FileVideo v-else-if="item.media.mediaKind === 'video'" :size="28" /><File v-else :size="28" /></div><div class="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full items-end justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-8 text-white transition-transform group-hover:translate-y-0"><p class="min-w-0 flex-1 truncate text-xs font-medium">{{ item.media.originalName }}</p><button class="pointer-events-auto grid size-7 shrink-0 place-items-center rounded-md bg-black/35 hover:bg-rose-500/80" title="移入回收站" @click.stop="trashMedia(item.media.id, item.media.originalName)"><Trash2 :size="14" /></button></div></article></div></div></template><MediaViewer :open="Boolean(viewerMediaId)" :media="sortedMedia" :active-id="viewerMediaId" @close="viewerMediaId = null" @update:active-id="viewerMediaId = $event" /><ConfirmDialog :open="Boolean(trashTarget)" title="移入回收站" :description="trashTarget ? `将${trashTarget.isAlbum ? '图集“' : '“'}${trashTarget.name}${trashTarget.isAlbum ? '”及其全部媒体' : '”'}移入回收站？原始导入来源文件不会被删除。` : ''" confirm-text="移入回收站" @update:open="(open) => { if (!open) trashTarget = null }" @confirm="confirmTrash" /></div>
</template>
