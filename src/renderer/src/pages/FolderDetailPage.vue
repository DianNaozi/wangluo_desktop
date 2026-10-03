<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, File, Folder, FolderInput, FolderPlus, Trash2 } from 'lucide-vue-next'
import AlbumCoserActions from '@/components/cosers/AlbumCoserActions.vue'
import { useAlbumSelection } from '@/composables/useAlbumSelection'
import { useCoserAssignmentStore } from '@/stores/coser-assignment'
import AlbumCard from '@/components/albums/AlbumCard.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import FolderNameDialog from '@/components/folders/FolderNameDialog.vue'
import MediaCard from '@/components/media/MediaCard.vue'
import MediaViewer from '@/components/media/MediaViewer.vue'
import { useImportStore } from '@/stores/imports'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { folderParentRoute } from '@/utils/folder-navigation'
import { sortFolderContent } from '@/utils/folder-content-sort'
import { sortMedia } from '@/utils/media-sort'

const route = useRoute(); const router = useRouter(); const imports = useImportStore(); const library = useLibraryStore(); const playback = usePlaybackStore()
const folder = ref<FolderDetail | null>(null); const error = ref(''); const unavailablePreviews = ref(new Set<string>())
const trashTarget = ref<{ id: string; name: string } | null>(null)
const dragging = ref<{ kind: 'album' | 'media'; id: string } | null>(null)
const viewerMediaId = ref<string | null>(null)
const folderDialogOpen = ref(false)
const creatingFolder = ref(false)
const sortedFolders = computed(() => folder.value ? sortFolderContent(folder.value.folders, library.folderChildrenSortOrder) : [])
const sortedAlbums = computed(() => folder.value ? sortFolderContent(folder.value.albums, library.folderAlbumsSortOrder) : [])
const sortedMedia = computed(() => folder.value ? sortMedia(folder.value.media, library.librarySortOrder) : [])
const assignment = useCoserAssignmentStore()
const videoActions = ref<InstanceType<typeof AlbumCoserActions> | null>(null)
const { selected: selectedVideos, clear: clearVideos, toggle: toggleVideo, all: selectAllVideos } = useAlbumSelection(computed(() => sortedMedia.value.filter(item => item.mediaKind !== 'file')), () => route.params.id)
const selectedMedia = computed(() => sortedMedia.value.filter(item => selectedVideos.value.has(item.id)))
const actions = ref<InstanceType<typeof AlbumCoserActions> | null>(null)
const { selected: selectedAlbums, active: selectingAlbums, clear: clearAlbums, toggle: toggleAlbum, all: selectAllAlbums } = useAlbumSelection(sortedAlbums, () => [route.params.id, library.folderAlbumsSortOrder, library.searchQuery])
watch(() => assignment.revision, () => { void load() })
const dateText = (value: number): string => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)
function hidePreview(id: string): void { unavailablePreviews.value = new Set(unavailablePreviews.value).add(id) }
async function retryPreview(id: string): Promise<void> {
  await imports.retryPreview(id)
  unavailablePreviews.value = new Set([...unavailablePreviews.value].filter((mediaId) => mediaId !== id))
}
async function load(): Promise<void> {
  const folderId = String(route.params.id)
  try {
    const next = await window.api.library.getFolder(folderId)
    if (String(route.params.id) !== folderId) return
    folder.value = next
    error.value = ''
  } catch (reason) {
    if (String(route.params.id) === folderId) error.value = reason instanceof Error ? reason.message : String(reason)
  }
}
function goUp(): void { void router.push(folderParentRoute(folder.value?.parentId ?? null)) }
async function createFolder(title: string): Promise<void> {
  if (!folder.value || creatingFolder.value) return
  creatingFolder.value = true
  try {
    await window.api.library.createFolder(title, folder.value.id)
    folderDialogOpen.value = false
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    creatingFolder.value = false
  }
}
function beginDrag(kind: 'album' | 'media', id: string): void { dragging.value = { kind, id } }
async function dropInto(folderId: string): Promise<void> { const item = dragging.value; dragging.value = null; if (!item) return; try { if (item.kind === 'album') await window.api.library.moveAlbum(item.id, folderId); else await window.api.library.moveMedia(item.id, folderId); await load() } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
async function moveToRoot(kind: 'album' | 'media', id: string): Promise<void> { try { if (kind === 'album') await window.api.library.moveAlbum(id, null); else await window.api.library.moveMedia(id, null); await load() } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
async function trashFolder(): Promise<void> { if (!folder.value || !window.confirm(`将文件夹“${folder.value.title}”及其全部内容移入回收站？`)) return; try { await window.api.media.trashFolder(folder.value.id); await router.push('/library') } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
async function addAlbumToQueue(id: string, title: string): Promise<void> { try { const album = await window.api.library.getAlbum(id); playback.addAlbums([{ albumId: album.id, title, media: sortMedia(album.media, library.albumSortOrder), sortOrder: library.albumSortOrder }]) } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
function trashAlbum(id: string, name: string): void { trashTarget.value = { id, name } }
async function confirmTrashAlbum(): Promise<void> { const target = trashTarget.value; if (!target) return; trashTarget.value = null; try { await window.api.media.trashAlbum(target.id); await load() } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
async function trashLooseMedia(id: string): Promise<void> {
  try { const result = await window.api.media.trashMedia(id); if (result.failed.length) throw new Error(result.failed[0].reason); await load(); await imports.refresh() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
onMounted(() => { void load() }); watch(() => route.params.id, () => { viewerMediaId.value = null; void load() }); watch(() => imports.completedImportRevision, () => { void load() }); watch(() => imports.previewRevision, () => { void load() })
</script>

<template>
  <div class="p-6 lg:p-8">
    <button class="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground" @click="goUp"><ArrowLeft :size="16" />返回上一级</button>
    <p v-if="error" class="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{{ error }}</p>
    <template v-else-if="folder">
      <section class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5">
        <div><div class="flex flex-wrap items-center gap-1 text-sm text-muted"><button class="hover:text-foreground" @click="router.push('/library')">媒体库</button><template v-for="crumb in folder.breadcrumbs" :key="crumb.id"><span>/</span><button class="hover:text-foreground" @click="router.push(`/folders/${crumb.id}`)">{{ crumb.title }}</button></template></div><div class="mt-3 flex items-center gap-2"><Badge>文件夹</Badge><Badge>{{ folder.albumCount + folder.mediaCount }} 项</Badge></div><h2 class="mt-2 text-2xl font-semibold text-foreground">{{ folder.title }}</h2></div>
        <div class="flex flex-wrap gap-2"><Button v-if="folder.parentId === null" variant="outline" @click="folderDialogOpen = true"><FolderPlus :size="16" />新建子文件夹</Button><Button variant="outline" @click="imports.importFiles(folder.id)"><File :size="16" />导入文件</Button><Button @click="imports.importFolders(folder.id)"><FolderInput :size="16" />导入文件夹</Button><Button variant="outline" @click="trashFolder"><Trash2 :size="16" />删除文件夹</Button></div>
      </section>

      <section v-if="sortedFolders.length" class="mt-6">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold text-foreground">子文件夹</h3><label class="flex items-center gap-2 text-sm text-muted">排序<select v-model="library.folderChildrenSortOrder" class="rounded-md border border-line bg-surface px-2 py-1 text-foreground"><option value="title">名称（A → Z）</option><option value="updatedAt">最近更新</option></select></label></div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"><article v-for="child in sortedFolders" :key="child.id" class="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-violet-500/60 hover:bg-surface-hover" @dragover.prevent @drop.prevent="dropInto(child.id)"><button class="flex w-full items-start gap-3 text-left" @click="router.push(`/folders/${child.id}`)"><span class="grid size-11 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-400"><Folder :size="24" /></span><span class="min-w-0"><span class="block truncate text-sm font-semibold text-foreground">{{ child.title }}</span><span class="mt-1 block text-xs text-muted">{{ child.albumCount }} 个图集 · {{ child.mediaCount }} 项媒体</span></span></button></article></div>
      </section>

      <section v-if="sortedAlbums.length" class="mt-6">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold text-foreground">图集</h3><label class="flex items-center gap-2 text-sm text-muted">排序<select v-model="library.folderAlbumsSortOrder" class="rounded-md border border-line bg-surface px-2 py-1 text-foreground"><option value="title">名称（A → Z）</option><option value="updatedAt">最近更新</option></select></label></div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"><AlbumCard v-for="album in sortedAlbums" :key="album.id" :album="album" :preview-unavailable="unavailablePreviews.has(album.id)" :subtitle="`${dateText(album.updatedAt)} 更新`" can-assign-coser selectable :selected="selectedAlbums.has(album.id)" :selection-mode="selectingAlbums" @toggle-selection="toggleAlbum(album.id, $event)" @open="router.push(`/albums/${album.id}`)" @queue="addAlbumToQueue(album.id, album.title)" @assign-coser="actions?.show([album.id])" @delete="trashAlbum(album.id, album.title)" @dragstart="beginDrag('album', album.id)" @preview-error="hidePreview(album.id)"><template #footer><button v-if="!selectingAlbums" class="shrink-0 text-xs text-muted hover:text-foreground" @click.stop="moveToRoot('album', album.id)">移至根目录</button></template></AlbumCard></div>
      </section>

      <section v-if="sortedMedia.length" class="mt-6"><div class="mb-3 flex items-center justify-between"><h3 class="font-semibold text-foreground">文件夹内媒体</h3><label class="flex items-center gap-2 text-sm text-muted">排序<select v-model="library.librarySortOrder" class="rounded-md border border-line bg-surface px-2 py-1 text-foreground"><option value="filename">名称（A → Z）</option><option value="importedAt">导入时间（最新优先）</option></select></label></div><div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><MediaCard v-for="media in sortedMedia" :key="media.id" :media="media" selectable can-assign-coser in-folder :selected="selectedVideos.has(media.id)" :preview-unavailable="unavailablePreviews.has(media.id)" @open="viewerMediaId = media.id" @toggle="toggleVideo(media.id, $event)" @assign="videoActions?.show([media.id])" @queue="playback.addMediaBatch([media], folder.title)" @delete="trashLooseMedia(media.id)" @root="moveToRoot('media', media.id)" @dragstart="beginDrag('media', media.id)" @preview-error="hidePreview(media.id)" @retry="retryPreview(media.id)" /></div></section>
      <p v-if="!folder.folders.length && !folder.albums.length && !sortedMedia.length" class="mt-6 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">此文件夹还没有内容。可直接导入文件，或导入一个文件夹创建图集。</p>
    </template>
    <AlbumCoserActions ref="videoActions" :key="`videos-${route.params.id}`" kind="video" :selected-ids="selectedVideos" :disabled="selectedMedia.some(item => item.mediaKind !== 'video')" @clear="clearVideos" @all="selectAllVideos" />
    <AlbumCoserActions :key="String(route.params.id)" ref="actions" :selected-ids="selectedAlbums" @clear="clearAlbums" @all="selectAllAlbums" />
  </div>
  <MediaViewer :open="Boolean(viewerMediaId)" :media="sortedMedia" :active-id="viewerMediaId" @close="viewerMediaId = null" @update:active-id="viewerMediaId = $event" />
  <ConfirmDialog :open="Boolean(trashTarget)" title="移入回收站" :description="trashTarget ? `将图集“${trashTarget.name}”及其全部媒体移入回收站？原始导入来源文件不会被删除。` : ''" confirm-text="移入回收站" @update:open="(open) => { if (!open) trashTarget = null }" @confirm="confirmTrashAlbum" />
  <FolderNameDialog v-model:open="folderDialogOpen" title="新建子文件夹" description="子文件夹最多可创建一层。" :busy="creatingFolder" :error="error" @confirm="createFolder" />
</template>
