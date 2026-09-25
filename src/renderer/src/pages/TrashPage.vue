<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, Folder, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import Button from '@/components/ui/Button.vue'

const router = useRouter(); const trash = ref<TrashSnapshot>({ items: [] }); const error = ref('')
const dayText = (expiresAt: number): string => `${Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000))} 天后清除`
const items = computed(() => trash.value.items)
async function load(): Promise<void> { try { trash.value = await window.api.library.getTrash(); error.value = '' } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
onMounted(() => { void load() })
async function restore(item: TrashItem): Promise<void> { item.entityType === 'album' ? await window.api.media.restoreAlbum(item.id) : await window.api.media.restoreMedia(item.id); await load() }
async function purge(item: TrashItem): Promise<void> { if (window.confirm(`永久删除“${item.title}”？此操作无法恢复。`)) { if (item.entityType === 'album') { await window.api.media.purgeAlbum(item.id) } else await window.api.media.purgeTrash(item.id); await load() } }
async function clear(): Promise<void> { if (window.confirm('永久清空回收站？此操作无法恢复。')) { await window.api.media.purgeAllTrash(); await load() } }
</script>

<template>
  <div class="p-6 lg:p-8"><div class="mb-6 flex items-center justify-between gap-4"><div><button class="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground" @click="router.push('/library')"><ArrowLeft :size="16" />返回媒体库</button><h2 class="text-2xl font-semibold text-foreground">回收站</h2><p class="mt-1 text-sm text-muted">已删除的受管副本保留 30 天；原始导入来源文件不会被删除。</p></div><Button v-if="items.length" variant="outline" @click="clear"><Trash2 :size="16" />清空回收站</Button></div><p v-if="error" class="mb-4 text-sm text-rose-400">{{ error }}</p><div v-if="items.length" class="space-y-2"><article v-for="item in items" :key="`${item.entityType}-${item.id}`" class="flex items-center gap-3 rounded-lg border border-line bg-surface p-3"><Folder v-if="item.entityType === 'album'" class="text-violet-400" :size="20" /><Trash2 v-else class="text-muted" :size="20" /><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-foreground">{{ item.title }}</p><p class="text-xs text-muted">{{ item.entityType === 'album' ? `图集 · ${item.mediaCount} 项` : item.mediaKind }} · {{ dayText(item.expiresAt) }}</p></div><Button size="sm" variant="outline" @click="restore(item)"><RefreshCcw :size="14" />恢复</Button><button class="rounded p-2 text-muted hover:text-rose-400" title="永久删除" @click="purge(item)"><Trash2 :size="16" /></button></article></div><div v-else class="grid min-h-64 place-items-center rounded-lg border border-dashed border-line text-sm text-muted">回收站为空</div></div>
</template>
