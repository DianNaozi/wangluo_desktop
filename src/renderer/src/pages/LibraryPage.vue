<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { File, FileImage, FileVideo, Folder, FolderInput, FolderPlus, Images, ListPlus, RotateCcw, Trash2 } from 'lucide-vue-next'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import FolderNameDialog from '@/components/folders/FolderNameDialog.vue'
import MediaViewer from '@/components/media/MediaViewer.vue'
import { useImportStore } from '@/stores/imports'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useSelectionStore } from '@/stores/selection'
import { sortMedia } from '@/utils/media-sort'

const imports = useImportStore(); const library = useLibraryStore(); const router = useRouter(); const playback = usePlaybackStore(); const selection = useSelectionStore()
const unavailablePreviews = ref(new Set<string>()); const trashTarget = ref<{ id: string; name: string; isAlbum: boolean } | null>(null)
const dragging = ref<{ kind: 'album' | 'media'; id: string } | null>(null)
const viewerMediaId = ref<string | null>(null)
const folderDialogOpen = ref(false)
const creatingFolder = ref(false)
onMounted(() => { void imports.refresh() })
const query = computed(() => library.searchQuery.trim().toLocaleLowerCase())
const folders = computed(() => imports.snapshot.folders.filter((item) => !query.value || item.title.toLocaleLowerCase().includes(query.value)))
const albums = computed(() => imports.snapshot.albums.filter((item) => !query.value || item.title.toLocaleLowerCase().includes(query.value)))
const looseMedia = computed(() => sortMedia(imports.snapshot.looseMedia.filter((item) => (!query.value || item.originalName.toLocaleLowerCase().includes(query.value)) && (library.mediaKind === 'all' || library.mediaKind === item.mediaKind)), library.librarySortOrder))
const selectedMedia = computed(() => sortMedia(imports.snapshot.looseMedia.filter((item) => selection.selectedIds.has(item.id)), library.librarySortOrder))
const dateText = (value: number): string => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)
function hidePreview(id: string): void { unavailablePreviews.value = new Set(unavailablePreviews.value).add(id) }
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
    playback.addMediaBatch(sortMedia(album.media, library.albumSortOrder), title)
  } catch (reason) {
    imports.error = reason instanceof Error ? reason.message : String(reason)
  }
}
function addSelectedMediaToQueue(): void {
  playback.addMediaBatch(selectedMedia.value, '未归档媒体')
  selection.clear()
}
function beginDrag(kind: 'album' | 'media', id: string): void { dragging.value = { kind, id } }
async function dropInto(folderId: string): Promise<void> { const item = dragging.value; dragging.value = null; if (!item) return; try { if (item.kind === 'album') await window.api.library.moveAlbum(item.id, folderId); else await window.api.library.moveMedia(item.id, folderId); await imports.refresh() } catch (reason) { imports.error = reason instanceof Error ? reason.message : String(reason) } }
</script>

<template>
  <div class="p-6 lg:p-8">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div class="flex items-center gap-2"><h2 class="text-2xl font-semibold tracking-tight text-foreground">媒体库</h2><Badge>{{ imports.snapshot.totals.all }} 项</Badge></div><p class="mt-1.5 text-sm text-muted">图片 {{ imports.snapshot.totals.images }} · 视频 {{ imports.snapshot.totals.videos }} · 普通文件 {{ imports.snapshot.totals.files }}</p></div><div class="flex flex-wrap gap-2"><Button variant="outline" @click="router.push('/trash')"><Trash2 :size="16" />回收站</Button><Button variant="outline" @click="imports.rebuildPreviews"><RotateCcw :size="16" />重新生成预览</Button><Button variant="outline" @click="folderDialogOpen = true"><FolderPlus :size="16" />新建文件夹</Button><Button variant="outline" @click="imports.importFiles"><File :size="16" />导入文件</Button><Button @click="imports.importFolders"><FolderInput :size="16" />导入文件夹</Button></div></div>
    <p v-if="imports.error" class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{{ imports.error }}</p>
    <section v-if="folders.length"><div class="mb-3 flex items-center gap-2"><h3 class="font-semibold text-foreground">文件夹</h3><span class="text-sm text-muted">{{ folders.length }}</span></div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"><article v-for="folder in folders" :key="folder.id" class="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-violet-500/60 hover:bg-surface-hover" @dragover.prevent @drop.prevent="dropInto(folder.id)"><button class="flex w-full items-start gap-3 text-left" @click="router.push(`/folders/${folder.id}`)"><span class="grid size-11 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-400"><Folder :size="24" /></span><span class="min-w-0"><span class="block truncate text-sm font-semibold text-foreground">{{ folder.title }}</span><span class="mt-1 block text-xs text-muted">{{ folder.folderCount }} 个文件夹 · {{ folder.albumCount }} 个图集 · {{ folder.mediaCount }} 项媒体</span></span></button></article></div></section>
    <section v-if="albums.length" :class="folders.length ? 'mt-8 border-t border-line pt-6' : ''"><div class="mb-3 flex items-center gap-2"><h3 class="font-semibold text-foreground">图集</h3><span class="text-sm text-muted">{{ albums.length }}</span></div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"><article v-for="album in albums" :key="album.id" draggable="true" class="overflow-hidden rounded-lg border border-line bg-surface" @dragstart="beginDrag('album', album.id)"><button class="block w-full text-left" @click="router.push(`/albums/${album.id}`)"><div class="grid aspect-[16/9] place-items-center overflow-hidden bg-gradient-to-br from-violet-500/25 via-fuchsia-500/10 to-sky-400/20"><img v-if="album.coverPreviewUrl && !unavailablePreviews.has(album.id)" :src="album.coverPreviewUrl" :alt="album.title" class="h-full w-full object-cover" @error="hidePreview(album.id)"><Images v-else class="text-violet-500" :size="34" /></div></button><div class="flex items-center justify-between gap-2 p-3"><div class="min-w-0"><p class="truncate text-sm font-semibold text-foreground">{{ album.title }}</p><p class="mt-0.5 text-xs text-muted">{{ dateText(album.updatedAt) }} 更新 · {{ album.mediaCount }} 项</p></div><div class="flex items-center"><button class="rounded p-1.5 text-muted hover:bg-violet-500/10 hover:text-violet-500" title="加入播放队列" @click="addAlbumToQueue(album.id, album.title)"><ListPlus :size="16" /></button><button class="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-rose-400" title="移入回收站" @click="trashAlbum(album.id, album.title)"><Trash2 :size="16" /></button></div></div></article></div></section>
    <section v-if="looseMedia.length" class="mt-8"><div class="mb-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-6"><div class="flex items-center gap-2"><h3 class="font-semibold text-foreground">未归档媒体</h3><span class="text-sm text-muted">{{ looseMedia.length }}</span></div><div class="flex items-center gap-2"><Button v-if="selectedMedia.length" variant="outline" @click="addSelectedMediaToQueue"><ListPlus :size="16" />加入播放队列（{{ selectedMedia.length }}）</Button><label class="flex items-center gap-2 text-sm text-muted">排序<select v-model="library.librarySortOrder" class="rounded-md border border-line bg-surface px-2 py-1 text-foreground outline-none focus:border-violet-500"><option value="filename">名称（A → Z）</option><option value="importedAt">导入时间（最新优先）</option></select></label></div></div><div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"><article v-for="media in looseMedia" :key="media.id" draggable="true" :class="['cursor-zoom-in rounded-lg border bg-surface p-3', selection.selectedIds.has(media.id) ? 'border-violet-500 ring-1 ring-violet-500/30' : 'border-line']" @dragstart="beginDrag('media', media.id)" @click="viewerMediaId = media.id"><div class="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-md" :class="media.mediaKind === 'image' ? 'bg-violet-500/10 text-violet-500' : media.mediaKind === 'video' ? 'bg-sky-500/10 text-sky-500' : 'bg-zinc-500/10 text-zinc-400'"><img v-if="media.previewUrl && !unavailablePreviews.has(media.id)" :src="media.previewUrl" :alt="media.originalName" class="h-full w-full object-cover" @error="hidePreview(media.id)"><FileImage v-else-if="media.mediaKind === 'image'" :size="28" /><FileVideo v-else-if="media.mediaKind === 'video'" :size="28" /><File v-else :size="28" /><Checkbox v-if="media.mediaKind !== 'file'" class="absolute left-2 top-2" :model-value="selection.selectedIds.has(media.id)" @click.stop @update:model-value="selection.toggle(media.id)" /></div><div class="mt-2 flex items-start gap-1"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-foreground">{{ media.originalName }}</p><p class="mt-0.5 text-xs text-muted">{{ media.mediaKind === 'image' ? '图片' : media.mediaKind === 'video' ? '视频' : '文件' }} · {{ dateText(media.importedAt) }}</p></div><button class="rounded p-1 text-muted hover:bg-surface-hover hover:text-rose-400" title="移入回收站" @click.stop="trashMedia(media.id, media.originalName)"><Trash2 :size="15" /></button></div></article></div></section>
    <MediaViewer :open="Boolean(viewerMediaId)" :media="looseMedia" :active-id="viewerMediaId" @close="viewerMediaId = null" @update:active-id="viewerMediaId = $event" />
    <div v-if="!folders.length && !albums.length && !looseMedia.length" class="grid min-h-72 place-items-center rounded-card border border-dashed border-line"><div class="text-center"><Images class="mx-auto text-muted" :size="24" /><p class="mt-3 font-medium text-foreground">还没有已导入的媒体</p><Button class="mt-4" @click="imports.importFiles"><File :size="16" />选择文件</Button></div></div>
    <ConfirmDialog :open="Boolean(trashTarget)" title="移入回收站" :description="trashTarget ? `将${trashTarget.isAlbum ? '图集“' : '“'}${trashTarget.name}${trashTarget.isAlbum ? '”及其全部媒体' : '”'}移入回收站？原始导入来源文件不会被删除。` : ''" confirm-text="移入回收站" @update:open="(open) => { if (!open) trashTarget = null }" @confirm="confirmTrash" />
    <FolderNameDialog v-model:open="folderDialogOpen" :busy="creatingFolder" :error="imports.error" @confirm="createFolder" />
  </div>
</template>
