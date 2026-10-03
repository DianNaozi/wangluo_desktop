<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { File, FolderInput, FolderPlus, Images, ListPlus, RotateCcw, Trash2 } from 'lucide-vue-next'
import AlbumCoserActions from '@/components/cosers/AlbumCoserActions.vue'
import { useAlbumSelection } from '@/composables/useAlbumSelection'
import AlbumCard from '@/components/albums/AlbumCard.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import FolderNameDialog from '@/components/folders/FolderNameDialog.vue'
import MediaCard from '@/components/media/MediaCard.vue'
import MediaViewer from '@/components/media/MediaViewer.vue'
import ImportQueue from '@/components/imports/ImportQueue.vue'
import { useImportStore } from '@/stores/imports'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useSelectionStore } from '@/stores/selection'
import { sortMedia } from '@/utils/media-sort'

const imports = useImportStore(); const library = useLibraryStore(); const router = useRouter(); const playback = usePlaybackStore(); const selection = useSelectionStore()
const unavailablePreviews = ref(new Set<string>()); const trashTarget = ref<{ id: string; name: string; isAlbum: boolean } | null>(null)
const viewerMediaId = ref<string | null>(null)
const folderDialogOpen = ref(false)
const creatingFolder = ref(false)
const showImportQueue = ref(false)
const query = computed(() => library.searchQuery.trim().toLocaleLowerCase())
const albums = computed(() => imports.snapshot.albums.filter((item) => !query.value || item.title.toLocaleLowerCase().includes(query.value)))
const looseMedia = computed(() => sortMedia(imports.snapshot.looseMedia.filter((item) => (!query.value || item.originalName.toLocaleLowerCase().includes(query.value)) && (library.mediaKind === 'all' || library.mediaKind === item.mediaKind)), library.librarySortOrder))
const selectedMedia = computed(() => sortMedia(imports.snapshot.looseMedia.filter((item) => selection.selectedIds.has(item.id)), library.librarySortOrder))
const videoActions = ref<InstanceType<typeof AlbumCoserActions> | null>(null)
const selectedMediaIds = computed(() => new Set(selectedMedia.value.map(item => item.id)))
const actions = ref<InstanceType<typeof AlbumCoserActions> | null>(null)
const { selected: selectedAlbums, active: selectingAlbums, clear: clearAlbums, toggle: toggleAlbum, all: selectAllAlbums } = useAlbumSelection(albums, () => library.searchQuery)
const dateText = (value: number): string => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)
function hidePreview(id: string): void { unavailablePreviews.value = new Set(unavailablePreviews.value).add(id) }
async function retryPreview(id: string): Promise<void> {
  await imports.retryPreview(id)
  unavailablePreviews.value = new Set([...unavailablePreviews.value].filter((mediaId) => mediaId !== id))
}
function trashMedia(id: string, name: string): void { trashTarget.value = { id, name, isAlbum: false } }
function trashAlbum(id: string, title: string): void { trashTarget.value = { id, name: title, isAlbum: true } }
async function confirmTrash(): Promise<void> { const target = trashTarget.value; if (!target) return; trashTarget.value = null; if (target.isAlbum) await imports.trashAlbum(target.id); else await imports.trashMedia(target.id) }
async function createFolder(title: string): Promise<void> {
  if (creatingFolder.value) return
  creatingFolder.value = true
  try {
    await window.api.library.createFolder(title, null)
    folderDialogOpen.value = false
    await imports.refresh()
  } catch (reason) {
    imports.error = reason instanceof Error ? reason.message : String(reason)
  } finally {
    creatingFolder.value = false
  }
}
async function addAlbumToQueue(id: string, title: string): Promise<void> {
  try {
    const album = await window.api.library.getAlbum(id)
    playback.addAlbums([{ albumId: album.id, title, media: sortMedia(album.media, library.albumSortOrder), sortOrder: library.albumSortOrder }])
  } catch (reason) {
    imports.error = reason instanceof Error ? reason.message : String(reason)
  }
}
async function addSelectedAlbumsToQueue(): Promise<void> {
  const selected = albums.value.filter((album) => selectedAlbums.value.has(album.id))
  try {
    const details = await Promise.all(selected.map((album) => window.api.library.getAlbum(album.id)))
    playback.addAlbums(details.map((album) => ({ albumId: album.id, title: album.title, media: sortMedia(album.media, library.albumSortOrder), sortOrder: library.albumSortOrder })))
    clearAlbums()
  } catch (reason) {
    imports.error = reason instanceof Error ? reason.message : String(reason)
  }
}
function addSelectedMediaToQueue(): void {
  playback.addMediaBatch(selectedMedia.value, '未归档媒体')
  selection.clear()
}
</script>

<template>
  <div class="p-6 lg:p-8">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div class="flex items-center gap-2"><h2 class="text-2xl font-semibold tracking-tight text-foreground">媒体库</h2><Badge>{{ imports.snapshot.totals.all }} 项</Badge></div><p class="mt-1.5 text-sm text-muted">图片 {{ imports.snapshot.totals.images }} · 视频 {{ imports.snapshot.totals.videos }} · 普通文件 {{ imports.snapshot.totals.files }}</p></div><div class="flex flex-wrap gap-2"><Button variant="outline" @click="router.push('/trash')"><Trash2 :size="16" />回收站</Button><Button variant="outline" @click="imports.rebuildPreviews"><RotateCcw :size="16" />重新生成预览</Button><Button variant="outline" @click="folderDialogOpen = true"><FolderPlus :size="16" />新建文件夹</Button><Button variant="outline" @click="imports.importFiles"><File :size="16" />导入文件</Button><Button @click="imports.importFolders"><FolderInput :size="16" />导入文件夹</Button></div></div>
    <p v-if="imports.error" class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{{ imports.error }}</p>
    <section class="mb-6">
      <div class="flex flex-wrap items-center gap-3">
        <Button variant="outline" :aria-expanded="showImportQueue" @click="showImportQueue = !showImportQueue"><ListPlus :size="16" />{{ showImportQueue ? '收起导入任务' : '导入任务' }}</Button>
        <span v-if="imports.activeJob" class="text-sm text-violet-600 dark:text-violet-300">正在导入 · {{ imports.activeJob.processedEntries + imports.activeJob.skippedEntries }} / {{ imports.activeJob.totalEntries }}</span>
      </div>
      <ImportQueue v-if="showImportQueue" class="mt-3" />
    </section>
    <section v-if="albums.length"><div class="mb-3 flex flex-wrap items-center gap-2"><h3 class="font-semibold text-foreground">图包</h3><span class="text-sm text-muted">{{ albums.length }}</span><Button v-if="selectedAlbums.size" class="ml-auto" variant="outline" @click="addSelectedAlbumsToQueue"><ListPlus :size="16" />加入 {{ selectedAlbums.size }} 个图包</Button></div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"><AlbumCard v-for="album in albums" :key="album.id" :album="album" :preview-unavailable="unavailablePreviews.has(album.id)" :subtitle="`${dateText(album.updatedAt)} 更新`" can-assign-coser selectable :selected="selectedAlbums.has(album.id)" :selection-mode="selectingAlbums" @toggle-selection="toggleAlbum(album.id, $event)" @open="router.push(`/albums/${album.id}`)" @queue="addAlbumToQueue(album.id, album.title)" @assign-coser="actions?.show([album.id])" @delete="trashAlbum(album.id, album.title)" @preview-error="hidePreview(album.id)" /></div></section>
    <section v-if="looseMedia.length" class="mt-8"><div class="mb-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-6"><div class="flex items-center gap-2"><h3 class="font-semibold text-foreground">未归档媒体</h3><span class="text-sm text-muted">{{ looseMedia.length }}</span></div><div class="flex items-center gap-2"><Button v-if="selectedMedia.length" variant="outline" @click="addSelectedMediaToQueue"><ListPlus :size="16" />加入播放队列（{{ selectedMedia.length }}）</Button><label class="flex items-center gap-2 text-sm text-muted">排序<select v-model="library.librarySortOrder" class="rounded-md border border-line bg-surface px-2 py-1 text-foreground outline-none focus:border-violet-500"><option value="filename">名称（A → Z）</option><option value="importedAt">导入时间（最新优先）</option></select></label></div></div><div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"><MediaCard v-for="media in looseMedia" :key="media.id" :media="media" selectable can-assign-coser :selected="selection.selectedIds.has(media.id)" :preview-unavailable="unavailablePreviews.has(media.id)" @open="viewerMediaId = media.id" @toggle="selection.toggle(media.id)" @assign="videoActions?.show([media.id])" @queue="playback.addMediaBatch([media], '未归档媒体')" @delete="trashMedia(media.id, media.originalName)" @preview-error="hidePreview(media.id)" @retry="retryPreview(media.id)" /></div></section>
    <MediaViewer :open="Boolean(viewerMediaId)" :media="looseMedia" :active-id="viewerMediaId" @close="viewerMediaId = null" @update:active-id="viewerMediaId = $event" />
    <div v-if="!imports.folderTree.length && !albums.length && !looseMedia.length" class="grid min-h-72 place-items-center rounded-card border border-dashed border-line"><div class="text-center"><Images class="mx-auto text-muted" :size="24" /><p class="mt-3 font-medium text-foreground">还没有已导入的媒体</p><Button class="mt-4" @click="imports.importFiles"><File :size="16" />选择文件</Button></div></div>
    <ConfirmDialog :open="Boolean(trashTarget)" title="移入回收站" :description="trashTarget ? `将${trashTarget.isAlbum ? '图集“' : '“'}${trashTarget.name}${trashTarget.isAlbum ? '”及其全部媒体' : '”'}移入回收站？原始导入来源文件不会被删除。` : ''" confirm-text="移入回收站" @update:open="(open) => { if (!open) trashTarget = null }" @confirm="confirmTrash" />
    <AlbumCoserActions ref="videoActions" kind="video" :selected-ids="selectedMediaIds" :disabled="selectedMedia.some(item => item.mediaKind !== 'video')" @clear="selection.clear" @all="looseMedia.filter(item => item.mediaKind === 'video').forEach(item => { if (!selection.selectedIds.has(item.id)) selection.toggle(item.id) })" />
    <AlbumCoserActions ref="actions" :selected-ids="selectedAlbums" @clear="clearAlbums" @all="selectAllAlbums" />
    <FolderNameDialog v-model:open="folderDialogOpen" :busy="creatingFolder" :error="imports.error" @confirm="createFolder" />
  </div>
</template>
