<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, ArrowLeft, Download, Folder, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

const router = useRouter(); const trash = ref<TrashSnapshot>({ items: [] }); const error = ref('')
const purgeTarget = ref<TrashItem | 'all' | null>(null)
const dayText = (expiresAt: number): string => `${Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000))} 天后清除`
const items = computed(() => trash.value.items)
async function load(): Promise<void> { try { trash.value = await window.api.library.getTrash(); error.value = '' } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
onMounted(() => { void load() })
async function resume(item: TrashItem): Promise<void> {
  try {
    const movingToTrash = item.state === 'pending_trash'
    const result = item.entityType === 'album' ? (movingToTrash ? await window.api.media.trashAlbum(item.id) : await window.api.media.restoreAlbum(item.id)) : (movingToTrash ? await window.api.media.trashMedia(item.id) : await window.api.media.restoreMedia(item.id))
    const failure = result.failed.map((failed) => failed.reason).join('；')
    await load(); error.value = failure
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); await load() }
}
async function exportOrphan(item: TrashItem): Promise<void> {
  try {
    const result = await window.api.media.exportOrphan(item.id)
    error.value = result.failed.map((failed) => failed.reason).join('；') || '文件已导出，隔离副本会继续保留至到期或手动清除'
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
function purge(item: TrashItem): void { purgeTarget.value = item }
function clear(): void { purgeTarget.value = 'all' }
async function confirmPurge(): Promise<void> {
  const target = purgeTarget.value; if (!target) return; purgeTarget.value = null
  try {
    const result = target === 'all' ? await window.api.media.purgeAllTrash() : target.entityType === 'album' ? await window.api.media.purgeAlbum(target.id) : target.entityType === 'orphan' ? await window.api.media.purgeOrphan(target.id) : await window.api.media.purgeTrash(target.id)
    const failure = result.failed.map((failed) => failed.reason).join('；')
    await load(); error.value = failure
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); await load() }
}
</script>

<template>
  <div class="p-6 lg:p-8"><div class="mb-6 flex items-center justify-between gap-4"><div><button class="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground" @click="router.push('/library')"><ArrowLeft :size="16" />返回媒体库</button><h2 class="text-2xl font-semibold text-foreground">回收站</h2><p class="mt-1 text-sm text-muted">已删除的受管副本和孤儿对象保留 30 天。</p></div><Button v-if="items.length" variant="outline" @click="clear"><Trash2 :size="16" />清空回收站</Button></div><p v-if="error" class="mb-4 text-sm text-rose-400">{{ error }}</p><div v-if="items.length" class="space-y-2"><article v-for="item in items" :key="`${item.entityType}-${item.id}`" class="flex items-center gap-3 rounded-lg border border-line bg-surface p-3"><Folder v-if="item.entityType === 'album'" class="text-violet-400" :size="20" /><Trash2 v-else class="text-muted" :size="20" /><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-foreground">{{ item.title }}</p><p class="text-xs text-muted">{{ item.entityType === 'album' ? `图集 · ${item.mediaCount} 项` : item.entityType === 'orphan' ? '未索引对象' : item.mediaKind }} · {{ dayText(item.expiresAt) }}</p><p v-if="item.failureReason" class="mt-1 flex items-center gap-1 text-xs text-amber-500"><AlertTriangle :size="13" />{{ item.failureReason }}</p></div><Button v-if="item.entityType === 'orphan'" size="sm" variant="outline" @click="exportOrphan(item)"><Download :size="14" />导出</Button><Button v-else size="sm" variant="outline" @click="resume(item)"><RefreshCcw :size="14" />{{ item.state === 'pending_trash' ? '继续移入' : item.state === 'pending_restore' ? '继续恢复' : '恢复' }}</Button><button class="rounded p-2 text-muted hover:text-rose-400" title="永久删除" @click="purge(item)"><Trash2 :size="16" /></button></article></div><div v-else class="grid min-h-64 place-items-center rounded-lg border border-dashed border-line text-sm text-muted">回收站为空</div><ConfirmDialog :open="Boolean(purgeTarget)" title="永久删除" :description="purgeTarget === 'all' ? '永久清空回收站？此操作无法恢复。' : purgeTarget ? `永久删除“${purgeTarget.title}”？此操作无法恢复。` : ''" confirm-text="永久删除" destructive @update:open="(open) => { if (!open) purgeTarget = null }" @confirm="confirmPurge" /></div>
</template>
