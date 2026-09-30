<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Image } from 'lucide-vue-next'
import { useImportStore } from '@/stores/imports'
import { useLibraryStore } from '@/stores/library'
import { ancestorFolderIds, filterFolderTree, flattenFolderTree, readExpandedFolderIds, sortFolderTree, writeExpandedFolderIds } from '@/utils/folder-tree'

const imports = useImportStore()
const library = useLibraryStore()
const route = useRoute()
const router = useRouter()
const storedExpandedIds = readExpandedFolderIds()
const expandedIds = ref(new Set(storedExpandedIds ?? []))
const initialized = ref(storedExpandedIds !== null)

const sortedTree = computed(() => sortFolderTree(imports.folderTree))
const query = computed(() => library.searchQuery.trim())
const filteredTree = computed(() => filterFolderTree(sortedTree.value, query.value))
const visibleItems = computed(() => flattenFolderTree(filteredTree.value, expandedIds.value, Boolean(query.value)))
const currentFolderId = computed(() => route.name === 'folder-detail' ? String(route.params.id) : null)

function persist(): void { writeExpandedFolderIds(expandedIds.value) }
function replaceExpanded(update: (ids: Set<string>) => void): void {
  const next = new Set(expandedIds.value)
  update(next)
  expandedIds.value = next
  persist()
}
function toggle(folderId: string): void {
  replaceExpanded((ids) => { if (ids.has(folderId)) ids.delete(folderId); else ids.add(folderId) })
}
function openFolder(folderId: string): void { void router.push(`/folders/${folderId}`) }

watch(() => imports.folderTree, (tree) => {
  if (!initialized.value && tree.length) {
    expandedIds.value = new Set(tree.map((item) => item.id))
    initialized.value = true
    persist()
  }
}, { immediate: true })
watch([currentFolderId, sortedTree], ([folderId]) => {
  if (!folderId) return
  const ancestors = ancestorFolderIds(sortedTree.value, folderId)
  if (ancestors.length) replaceExpanded((ids) => ancestors.forEach((id) => ids.add(id)))
}, { immediate: true })
</script>

<template>
  <aside class="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
    <div class="border-b border-line px-3 py-3"><p class="px-2 text-xs font-semibold uppercase tracking-wider text-muted">文件夹</p></div>
    <nav class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="文件夹树">
      <button :class="['mb-1 flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors', route.name === 'library' ? 'bg-violet-500/12 font-medium text-violet-700 dark:text-violet-200' : 'text-muted hover:bg-surface-hover hover:text-foreground']" @click="router.push('/library')"><span class="grid size-6 shrink-0 place-items-center"><Image :size="17" /></span><span class="min-w-0 flex-1 truncate">媒体库</span></button>
      <p v-if="!visibleItems.length" class="px-2 py-4 text-xs text-muted">{{ query ? '没有匹配的文件夹' : '还没有文件夹' }}</p>
      <div v-for="item in visibleItems" :key="item.id" class="flex h-10 items-center" :style="{ paddingLeft: `${2 + item.depth * 18}px` }">
        <button v-if="item.hasChildren" class="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground" :aria-label="expandedIds.has(item.id) ? `收起 ${item.title}` : `展开 ${item.title}`" @click.stop="toggle(item.id)"><ChevronDown v-if="expandedIds.has(item.id) || query" :size="15" /><ChevronRight v-else :size="15" /></button>
        <span v-else class="w-7 shrink-0" />
        <button :class="['flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors', currentFolderId === item.id ? 'bg-violet-500/12 font-medium text-violet-700 dark:text-violet-200' : 'text-muted hover:bg-surface-hover hover:text-foreground']" @click="openFolder(item.id)"><span class="grid size-5 shrink-0 place-items-center"><FolderOpen v-if="currentFolderId === item.id" :size="16" /><Folder v-else :size="16" /></span><span class="min-w-0 flex-1 truncate">{{ item.title }}</span><span class="inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-md bg-canvas px-1.5 text-[11px] font-medium tabular-nums text-muted">{{ item.itemCount }}</span></button>
      </div>
    </nav>
  </aside>
</template>
