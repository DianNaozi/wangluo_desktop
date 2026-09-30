<script setup lang="ts">
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui'
import { FolderOpen, Images, ListPlus, LoaderCircle, Trash2, UserRound } from 'lucide-vue-next'

type AlbumCardData = { id: string; title: string; mediaCount: number; updatedAt: number; coverPreviewUrl: string | null; coverPreviewPending: boolean }

withDefaults(defineProps<{ album: AlbumCardData; previewUnavailable?: boolean; subtitle: string; canAssignCoser?: boolean }>(), { canAssignCoser: false })
defineEmits<{ open: []; queue: []; delete: []; assignCoser: []; dragstart: [event: DragEvent]; previewError: [] }>()
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <article draggable="true" class="cursor-pointer overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-violet-500/60 hover:bg-surface-hover" @click="$emit('open')" @dragstart="$emit('dragstart', $event)">
        <div class="grid aspect-[16/9] place-items-center overflow-hidden bg-gradient-to-br from-violet-500/25 via-fuchsia-500/10 to-sky-400/20">
          <img v-if="album.coverPreviewUrl && !previewUnavailable" :src="album.coverPreviewUrl" :alt="album.title" class="h-full w-full object-cover" @error="$emit('previewError')">
          <LoaderCircle v-else-if="album.coverPreviewPending" class="animate-spin text-violet-500" :size="30" aria-label="正在生成封面" />
          <Images v-else class="text-violet-500" :size="34" />
        </div>
        <div class="flex items-start gap-2 p-3"><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold text-foreground">{{ album.title }}</p><p class="mt-0.5 text-xs text-muted">{{ subtitle }} · {{ album.mediaCount }} 项</p></div><slot name="footer" /></div>
      </article>
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="z-50 min-w-40 rounded-lg border border-line bg-surface-raised p-1 shadow-xl">
        <ContextMenuItem class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none hover:bg-surface-hover" @select="$emit('open')"><FolderOpen :size="16" />打开</ContextMenuItem>
        <ContextMenuItem class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none hover:bg-surface-hover" @select="$emit('queue')"><ListPlus :size="16" />加入播放队列</ContextMenuItem>
        <ContextMenuItem v-if="canAssignCoser" class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none hover:bg-surface-hover" @select="$emit('assignCoser')"><UserRound :size="16" />归入 Coser</ContextMenuItem>
        <ContextMenuItem class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-rose-400 outline-none hover:bg-rose-500/10" @select="$emit('delete')"><Trash2 :size="16" />删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
