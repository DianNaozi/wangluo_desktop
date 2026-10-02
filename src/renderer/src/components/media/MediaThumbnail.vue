<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, File, FileImage, FileVideo, LoaderCircle, RefreshCw, Video } from 'lucide-vue-next'
import { reportFirstVisibleThumbnail } from '@/utils/startup-performance'

type Media = {
  id: string
  originalName: string
  mediaKind: MediaKind
  previewUrl: string | null
  previewStatus: PreviewStatus
  previewError: string | null
}

const props = withDefaults(defineProps<{ media: Media; previewUnavailable?: boolean; loadPreview?: boolean; lazy?: boolean }>(), { previewUnavailable: false, loadPreview: true, lazy: false })
const emit = defineEmits<{ previewError: []; retry: []; loaded: [event: Event] }>()

const isGenerating = computed(() => props.media.previewStatus === 'pending' || props.media.previewStatus === 'generating')
const hasFailed = computed(() => props.previewUnavailable || props.media.previewStatus === 'failed')
const canLoadPreview = computed(() => Boolean(props.loadPreview && props.media.previewUrl && !hasFailed.value))
const failureMessage = computed(() => {
  const message = props.previewUnavailable ? '缩略图文件不可用' : props.media.previewError || '缩略图生成失败'
  return message.replace(/\s+/g, ' ').slice(0, 120)
})
</script>

<template>
  <div class="relative grid place-items-center overflow-hidden" :class="media.mediaKind === 'image' ? 'bg-violet-500/10 text-violet-500' : media.mediaKind === 'video' ? 'bg-sky-500/10 text-sky-500' : 'bg-zinc-500/10 text-zinc-400'">
    <img v-if="canLoadPreview" :src="media.previewUrl!" :alt="media.originalName" :loading="lazy ? 'lazy' : 'eager'" decoding="async" class="size-full object-cover" @error="emit('previewError')" @load="emit('loaded', $event); reportFirstVisibleThumbnail($event)">
    <div v-else-if="hasFailed && media.mediaKind !== 'file'" class="flex size-full flex-col items-center justify-center gap-1.5 bg-rose-500/10 px-2 text-center text-rose-500" :title="failureMessage">
      <AlertTriangle :size="22" />
      <p class="line-clamp-2 text-[11px] leading-4">{{ failureMessage }}</p>
      <button class="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-1 text-[11px] font-medium hover:bg-rose-500/25" title="重新生成缩略图" @click.stop="emit('retry')"><RefreshCw :size="12" />重试</button>
    </div>
    <LoaderCircle v-else-if="isGenerating && media.mediaKind !== 'file'" class="animate-spin" :size="28" aria-label="正在生成缩略图" />
    <FileImage v-else-if="media.mediaKind === 'image'" :size="28" />
    <FileVideo v-else-if="media.mediaKind === 'video'" :size="28" />
    <File v-else :size="28" />
    <span v-if="media.mediaKind === 'video'" class="pointer-events-none absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/55 text-white"><Video :size="12" /></span>
  </div>
</template>
