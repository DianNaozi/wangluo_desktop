<script setup lang="ts">
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui'
import { ListPlus, Trash2, UserRound } from 'lucide-vue-next'
import MediaThumbnail from './MediaThumbnail.vue'
defineProps<{ media: LibraryMedia; selected?: boolean; selectable?: boolean; previewUnavailable?: boolean; canAssignCoser?: boolean; inCoser?: boolean; inFolder?: boolean }>()
defineEmits<{ open: []; toggle: [event: MouseEvent]; assign: []; queue: []; delete: []; remove: []; root: []; previewError: []; retry: []; dragstart: [event: DragEvent] }>()
</script>
<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <article class="group overflow-hidden rounded-lg border bg-surface transition hover:border-violet-500/60" :class="selected ? 'border-violet-500 ring-1 ring-violet-500/30' : 'border-line'" :draggable="inFolder" @dragstart="$emit('dragstart', $event)">
        <div class="relative aspect-[16/9]">
          <div role="button" tabindex="0" class="size-full cursor-pointer" @keydown.enter.self="$emit('open')" @keydown.space.self.prevent="$emit('open')" :aria-label="`打开 ${media.originalName}`" @click="$emit('open')"><MediaThumbnail :media="media" :preview-unavailable="previewUnavailable" lazy class="size-full" @preview-error="$emit('previewError')" @retry="$emit('retry')" /></div>
          <input v-if="selectable && media.mediaKind !== 'file'" type="checkbox" :aria-label="`选择 ${media.originalName}`" :checked="selected" class="absolute left-2 top-2 size-4 accent-violet-500" @click.stop="$emit('toggle', $event)">
        </div>
        <div class="p-3"><button class="block w-full truncate text-left text-sm font-medium text-foreground" :title="media.originalName" @click="$emit('open')">{{ media.originalName }}</button>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted"><span class="mr-auto">{{ media.mediaKind === 'video' ? '视频' : media.mediaKind === 'image' ? '图片' : '文件' }}</span>
            <button v-if="canAssignCoser && media.mediaKind === 'video'" class="rounded p-1 hover:bg-accent/10 hover:text-accent" title="归入 Coser" aria-label="归入 Coser" @click="$emit('assign')"><UserRound :size="15" /></button>
            <button v-if="inCoser" class="rounded p-1 hover:text-foreground" @click="$emit('remove')">移出 Coser</button>
            <button v-if="inFolder" class="rounded p-1 hover:text-foreground" @click="$emit('root')">移至根目录</button>
            <button class="rounded p-1 hover:bg-rose-500/10 hover:text-rose-400" title="移入回收站" aria-label="移入回收站" @click="$emit('delete')"><Trash2 :size="15" /></button>
          </div>
        </div>
      </article>
    </ContextMenuTrigger>
    <ContextMenuPortal><ContextMenuContent class="z-50 min-w-44 rounded-lg border border-line bg-surface-raised p-1 shadow-xl">
      <ContextMenuItem v-if="media.mediaKind !== 'file'" class="media-menu-item" @select="$emit('queue')"><ListPlus :size="16" />加入播放队列</ContextMenuItem>
      <ContextMenuItem v-if="canAssignCoser && media.mediaKind === 'video'" class="media-menu-item" @select="$emit('assign')"><UserRound :size="16" />归入 Coser</ContextMenuItem>
      <ContextMenuItem v-if="inCoser" class="media-menu-item" @select="$emit('remove')">移出 Coser</ContextMenuItem>
      <ContextMenuItem class="media-menu-item text-rose-400" @select="$emit('delete')"><Trash2 :size="16" />移入回收站</ContextMenuItem>
    </ContextMenuContent></ContextMenuPortal>
  </ContextMenuRoot>
</template>
<style scoped>
.media-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; font-size: 14px; cursor: pointer; outline: none; }
.media-menu-item[data-highlighted] { background: var(--app-surface-hover); }
</style>
