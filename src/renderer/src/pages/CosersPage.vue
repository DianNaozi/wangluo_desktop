<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Images, Pencil, Plus, Search, Trash2, UserRound, X } from 'lucide-vue-next'
import MediaCard from '@/components/media/MediaCard.vue'
import MediaViewer from '@/components/media/MediaViewer.vue'
import AlbumCoserActions from '@/components/cosers/AlbumCoserActions.vue'
import AlbumCard from '@/components/albums/AlbumCard.vue'
import CoserDialog from '@/components/cosers/CoserDialog.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { useImportStore } from '@/stores/imports'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { useCoserAssignmentStore } from '@/stores/coser-assignment'
import { useCoserBrowseStore } from '@/stores/coser-browse'
import { sortMedia } from '@/utils/media-sort'
import { detectAvatarFace } from '@/utils/face-detector'
import { generateRandomAvatar } from '@/utils/random-avatar'
import { startCoserPerformanceTrace, type CoserPerformanceTrace } from '@/utils/coser-performance'

const route = useRoute(); const router = useRouter(); const imports = useImportStore(); const library = useLibraryStore(); const playback = usePlaybackStore()
const coserBrowse = useCoserBrowseStore()
const cosers = computed(() => coserBrowse.cosers); const selected = computed(() => coserBrowse.details[selectedId.value] ?? null); const loading = ref(false); const error = ref('')
const dialogOpen = ref(false); const editing = ref(false); const saving = ref(false); const deleteOpen = ref(false); const unavailablePreviews = ref(new Set<string>())
const avatarProcessing = ref(false); const avatarMessage = ref(''); const clearAvatarRequested = ref(false); const unavailableAvatars = ref(new Set<string>())
const selectedId = computed(() => typeof route.query.coser === 'string' ? route.query.coser : '')
const videoActions = ref<InstanceType<typeof AlbumCoserActions> | null>(null)
const viewerMediaId = ref<string | null>(null)
const videoTrashTarget = ref<LibraryMedia | null>(null)
const search = ref('')
const contentRoot = ref<HTMLElement | null>(null)
const filteredCosers = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return cosers.value.filter((coser) => !query || [coser.name, ...coser.aliases].some((name) => name.toLocaleLowerCase().includes(query)))
})
let selectionVersion = 0
let initialized = false
let scheduledRefresh: ReturnType<typeof setTimeout> | undefined
let scheduledListRefresh = false
const dateText = (value: number): string => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)

function replaceCoserRoute(id: string): Promise<void> {
  return router.replace({ name: 'cosers', query: id ? { coser: id } : {} })
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function reportFirstVisibleCoserThumbnail(trace: CoserPerformanceTrace): void {
  const images = contentRoot.value?.querySelectorAll('img')
  const image = images && [...images].find((candidate) => {
    const bounds = candidate.getBoundingClientRect()
    return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth
  })
  if (!image) return
  const report = (stage: string) => trace(stage)
  if (image.complete && image.naturalWidth > 0) { report('first visible thumbnail loaded'); return }
  if (image.complete && image.currentSrc) { report('first visible thumbnail unavailable'); return }
  image.addEventListener('load', () => report('first visible thumbnail loaded'), { once: true })
  image.addEventListener('error', () => report('first visible thumbnail failed'), { once: true })
}

async function reportRenderedCoser(trace: CoserPerformanceTrace): Promise<void> {
  await nextTick()
  await waitForPaint()
  trace('cards rendered')
  reportFirstVisibleCoserThumbnail(trace)
}

async function activateCoser(id: string): Promise<void> {
  const version = ++selectionVersion
  if (!id) { loading.value = false; return }
  const trace = startCoserPerformanceTrace(id)
  trace('selection started')
  const cached = coserBrowse.details[id]
  if (cached) {
    loading.value = false
    error.value = ''
    trace('cached detail displayed')
    void reportRenderedCoser(trace)
    trace('detail request started in background')
    void coserBrowse.refreshCoser(id).then(async () => {
      if (version !== selectionVersion || selectedId.value !== id) return
      error.value = ''
      trace('detail request returned')
      await reportRenderedCoser(trace)
    }).catch((reason) => {
      if (version === selectionVersion && selectedId.value === id) error.value = reason instanceof Error ? reason.message : String(reason)
    })
    return
  }
  loading.value = true
  error.value = ''
  try {
    trace('detail request started')
    await coserBrowse.refreshCoser(id)
    if (version !== selectionVersion || selectedId.value !== id) return
    error.value = ''
    trace('detail request returned')
    await reportRenderedCoser(trace)
  } catch (reason) {
    if (version === selectionVersion && selectedId.value === id) error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (version === selectionVersion && selectedId.value === id) loading.value = false
  }
}

async function refreshBrowse(coserId = selectedId.value, refreshList = true): Promise<void> {
  const requests: Promise<unknown>[] = []
  if (refreshList) {
    coserBrowse.invalidateCosers()
    requests.push(coserBrowse.refreshCosers())
  }
  if (coserId) {
    coserBrowse.invalidateCoser(coserId)
    requests.push(coserBrowse.refreshCoser(coserId))
  }
  await Promise.all(requests)
}

function scheduleBrowseRefresh(refreshList = false): void {
  scheduledListRefresh ||= refreshList
  if (scheduledRefresh) clearTimeout(scheduledRefresh)
  scheduledRefresh = setTimeout(() => {
    scheduledRefresh = undefined
    const includeList = scheduledListRefresh
    scheduledListRefresh = false
    void refreshBrowse(selectedId.value, includeList).catch((reason) => { error.value = reason instanceof Error ? reason.message : String(reason) })
  }, 220)
}
async function select(id: string): Promise<void> { if (id !== selectedId.value) await router.replace({ name: 'cosers', query: { coser: id } }) }
function create(): void { editing.value = false; error.value = ''; avatarMessage.value = ''; clearAvatarRequested.value = false; dialogOpen.value = true }
function edit(): void { if (!selected.value) return; editing.value = true; error.value = ''; avatarMessage.value = ''; clearAvatarRequested.value = false; dialogOpen.value = true }
async function saveCoser(value: { name: string; aliases: string[] }): Promise<void> {
  if (saving.value || avatarProcessing.value) return
  saving.value = true
  try {
    const coser = editing.value && selected.value
      ? await window.api.library.updateCoser(selected.value.id, value.name, value.aliases)
      : await window.api.library.createCoser(value.name, value.aliases)
    if (clearAvatarRequested.value) await window.api.library.clearCoserAvatar(coser.id)
    dialogOpen.value = false; clearAvatarRequested.value = false
    coserBrowse.rememberCoserSummary(coser)
    await refreshBrowse(coser.id)
    if (selectedId.value !== coser.id) await replaceCoserRoute(coser.id)
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { saving.value = false }
}
function loadAvatarImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法读取所选图片'))
    image.src = url
  })
}
async function pickAvatar(): Promise<void> {
  if (!selected.value || avatarProcessing.value || saving.value) return
  const coserId = selected.value.id
  avatarProcessing.value = true; avatarMessage.value = '正在获取图包图片…'
  try {
    const sources = await window.api.library.getCoserAvatarMedia(coserId)
    const result = await generateRandomAvatar(sources, {
      load: loadAvatarImage,
      detect: detectAvatarFace,
      save: (mediaId, crop) => window.api.library.saveCoserAvatar(coserId, mediaId, crop),
      progress: (current, total) => { avatarMessage.value = `正在生成头像（第 ${current}/${total} 张）` }
    })
    if (result === 'empty') { avatarMessage.value = '当前图包没有可用图片，请添加图片后再次随机生成。'; return }
    if (result === 'exhausted') { avatarMessage.value = '本次图片未检测到可用人脸，头像未更改。可以再次随机生成。'; return }
    clearAvatarRequested.value = false
    const unavailable = new Set(unavailableAvatars.value); unavailable.delete(coserId); unavailableAvatars.value = unavailable
    await refreshBrowse(coserId)
    avatarMessage.value = '头像已立即更新。'
  } catch (reason) { avatarMessage.value = reason instanceof Error ? reason.message : String(reason) }
  finally { avatarProcessing.value = false }
}
function clearAvatar(): void { if (avatarProcessing.value) return; clearAvatarRequested.value = true; avatarMessage.value = '保存修改后移除头像。' }
function hideAvatar(id: string): void { unavailableAvatars.value = new Set(unavailableAvatars.value).add(id) }
async function removeCoser(): Promise<void> {
  if (!selected.value) return
  const removedId = selected.value.id
  try {
    await window.api.library.deleteCoser(removedId)
    deleteOpen.value = false
    coserBrowse.forgetCoser(removedId)
    await coserBrowse.refreshCosers()
    await replaceCoserRoute(cosers.value[0]?.id ?? '')
    await imports.refresh()
  }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function unassignAlbum(albumId: string): Promise<void> {
  const coserId = selectedId.value
  try { await window.api.library.unassignAlbumCoser(albumId); await refreshBrowse(coserId); await imports.refresh() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function addAlbumToQueue(id: string, title: string): Promise<void> {
  try { const album = await window.api.library.getAlbum(id); playback.addAlbums([{ albumId: album.id, title, media: sortMedia(album.media, library.albumSortOrder), sortOrder: library.albumSortOrder }]) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function trashAlbum(id: string): Promise<void> {
  const coserId = selectedId.value
  try { await imports.trashAlbum(id); await refreshBrowse(coserId) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function unassignVideo(id: string): Promise<void> {
  const coserId = selectedId.value
  try { await window.api.library.unassignVideoCoser(id); await refreshBrowse(coserId); await imports.refresh() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function trashVideo(): Promise<void> {
  const target = videoTrashTarget.value
  if (!target) return
  const coserId = selectedId.value
  try {
    const result = await window.api.media.trashMedia(target.id)
    if (result.failed.length) throw new Error(result.failed[0].reason)
    videoTrashTarget.value = null; await refreshBrowse(coserId); await imports.refresh()
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function retryVideo(id: string): Promise<void> { const coserId = selectedId.value; await imports.retryPreview(id); unavailablePreviews.value.delete(id); await refreshBrowse(coserId, false) }
function hidePreview(id: string): void { unavailablePreviews.value = new Set(unavailablePreviews.value).add(id) }
function openAlbum(id: string): void {
  void router.push({ name: 'album-detail', params: { id }, query: { fromCoser: selectedId.value } })
}

async function initialize(): Promise<void> {
  const trace = startCoserPerformanceTrace(selectedId.value)
  let list: CoserSummary[]
  try {
    if (coserBrowse.cosersLoaded) {
      list = cosers.value
      trace('cached Coser list displayed')
      void coserBrowse.refreshCosers().then(() => trace('background list request returned')).catch((reason) => { error.value = reason instanceof Error ? reason.message : String(reason) })
    } else {
      trace('list request started')
      list = await coserBrowse.refreshCosers()
      trace('list request returned')
    }
    initialized = true
    const requestedId = selectedId.value
    const targetId = list.some((coser) => coser.id === requestedId) ? requestedId : list[0]?.id ?? ''
    if (targetId !== requestedId) { await replaceCoserRoute(targetId); return }
    if (targetId) await activateCoser(targetId)
  } catch (reason) {
    initialized = true
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

onMounted(() => { void initialize() })
onBeforeUnmount(() => { if (scheduledRefresh) clearTimeout(scheduledRefresh) })
watch(selectedId, (id) => { viewerMediaId.value = null; if (initialized) void activateCoser(id) })
watch(cosers, (next) => {
  if (!initialized || !selectedId.value || next.some((coser) => coser.id === selectedId.value)) return
  void replaceCoserRoute(next[0]?.id ?? '')
})
watch(() => imports.previewRevision, () => scheduleBrowseRefresh(false))
watch(() => imports.completedImportRevision, () => { coserBrowse.invalidateAllDetails(); scheduleBrowseRefresh(true) })
const assignment = useCoserAssignmentStore()
watch(() => assignment.revision, () => { coserBrowse.invalidateAllDetails(); scheduleBrowseRefresh(true) })
</script>

<template>
  <div class="cosers-page p-6 lg:p-8">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3"><h2 class="text-2xl font-semibold tracking-tight text-foreground">Coser</h2><Badge>{{ cosers.length }} 位</Badge></div>
      <div class="flex flex-wrap items-center gap-3">
        <div v-if="cosers.length" class="relative w-48 sm:w-56">
          <Search :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input v-model="search" type="search" aria-label="搜索 Coser 姓名或别名" placeholder="搜索姓名或别名" class="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-9 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15">
          <button v-if="search" type="button" aria-label="清空搜索" class="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-hover focus-visible:outline-accent" @click="search = ''"><X :size="14" /></button>
        </div>
        <Button @click="create"><Plus :size="17" />新建 Coser</Button>
      </div>
    </div>
    <p v-if="error" class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{{ error }}</p>
    <section v-if="cosers.length" class="mb-6 border-b border-line pb-5" aria-label="选择 Coser">
      <div class="coser-grid" role="group" aria-label="Coser 头像选择">
        <button v-for="coser in filteredCosers" :key="coser.id" type="button" :aria-pressed="selectedId === coser.id" :aria-label="`选择 ${coser.name}，${coser.albumCount} 个图集，${coser.videoCount} 个视频`" :class="['coser-choice', { 'is-selected': selectedId === coser.id }]" @click="select(coser.id)">
            <span class="coser-avatar">
              <img v-if="coser.avatarUrl && !unavailableAvatars.has(coser.id)" :src="coser.avatarUrl" alt="" class="size-full object-cover" @error="hideAvatar(coser.id)">
              <UserRound v-else :size="44" :stroke-width="1.4" />
            </span>
          <span class="mt-3 w-full truncate text-sm font-medium" :title="coser.name">{{ coser.name }}</span>
        </button>
      </div>
      <div v-if="!filteredCosers.length" class="py-10 text-center"><p class="text-sm text-muted">没有找到“{{ search }}”</p><button class="mt-3 text-sm text-accent hover:underline" @click="search = ''">查看全部 Coser</button></div>
    </section>
    <div v-if="loading && !selected" role="status" class="py-12 text-center text-sm text-muted">正在加载内容…</div>
    <section v-else-if="selected" ref="contentRoot" aria-labelledby="coser-albums-title">
      <div class="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div class="min-w-0"><div class="flex flex-wrap items-center gap-2.5"><h3 id="coser-albums-title" class="break-all text-base font-semibold text-foreground">{{ selected.name }} 的内容</h3><span class="text-xs text-muted">{{ selected.albumCount }} 个图集 · {{ selected.videoCount }} 个视频 · {{ selected.mediaCount }} 项媒体</span></div><p v-if="selected.aliases.length" class="mt-1 text-xs text-muted">{{ selected.aliases.join(' / ') }}</p></div>
        <div class="flex gap-2"><Button size="sm" variant="outline" @click="edit"><Pencil :size="14" />编辑资料</Button><Button size="sm" variant="outline" aria-label="删除当前 Coser" @click="deleteOpen = true"><Trash2 :size="14" />删除</Button></div>
      </div>
<div v-if="selected.albums.length || selected.videos.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"><AlbumCard v-for="album in selected.albums" :key="album.id" :album="album" :preview-unavailable="unavailablePreviews.has(album.id)" :subtitle="`${dateText(album.updatedAt)} 更新`" @open="openAlbum(album.id)" @queue="addAlbumToQueue(album.id, album.title)" @delete="trashAlbum(album.id)" @preview-error="hidePreview(album.id)"><template #footer><button class="shrink-0 text-xs text-muted hover:text-foreground" @click.stop="unassignAlbum(album.id)">移出 Coser</button></template></AlbumCard><MediaCard v-for="video in selected.videos" :key="video.id" :media="video" in-coser can-assign-coser :preview-unavailable="unavailablePreviews.has(video.id)" @open="viewerMediaId = video.id" @assign="videoActions?.show([video.id])" @queue="playback.addMediaBatch([video], selected.name)" @remove="unassignVideo(video.id)" @delete="videoTrashTarget = video" @preview-error="hidePreview(video.id)" @retry="retryVideo(video.id)" /></div>
      <div v-else class="grid min-h-60 place-items-center rounded-2xl border border-line bg-surface px-5 py-8"><div class="max-w-sm text-center"><span class="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/8 text-accent"><Images :size="24" :stroke-width="1.5" /></span><p class="mt-4 font-medium text-foreground">为 {{ selected.name }} 添加图集或视频</p><p class="mt-2 text-sm leading-6 text-muted">在媒体库中右键图集或视频，选择“归入 Coser”，<br>就能在这里集中浏览。</p><Button class="mt-5" variant="outline" @click="router.push({ name: 'library' })">前往媒体库<ArrowRight :size="15" /></Button></div></div>
    </section>
    <div v-else-if="!loading" class="grid min-h-60 place-items-center"><div class="text-center"><p class="font-medium text-foreground">还没有 Coser</p><p class="mt-2 text-sm text-muted">点击右上方“新建 Coser”开始整理图集和视频。</p></div></div>
  </div>
  <MediaViewer :open="Boolean(viewerMediaId)" :media="selected?.videos ?? []" :active-id="viewerMediaId" @close="viewerMediaId = null" @update:active-id="viewerMediaId = $event" />
  <AlbumCoserActions ref="videoActions" kind="video" :selected-ids="new Set<string>()" />
  <ConfirmDialog :open="Boolean(videoTrashTarget)" title="移入回收站" :description="`将视频“${videoTrashTarget?.originalName ?? ''}”移入回收站？`" confirm-text="移入回收站" @update:open="value => { if (!value) videoTrashTarget = null }" @confirm="trashVideo" />
  <CoserDialog v-model:open="dialogOpen" :title="editing ? '编辑 Coser' : '新建 Coser'" :initial="editing && selected ? { name: selected.name, aliases: selected.aliases } : null" :busy="saving" :avatar-busy="avatarProcessing" :avatar-message="avatarMessage" :error="error" :avatar-selected="Boolean(selected?.avatarUrl && !clearAvatarRequested)" :can-select-avatar="Boolean(editing && selected?.mediaCount)" :can-clear-avatar="Boolean(editing && selected?.avatarUrl && !clearAvatarRequested)" @confirm="saveCoser" @select-avatar="pickAvatar" @clear-avatar="clearAvatar" />
  <ConfirmDialog :open="deleteOpen" title="删除 Coser" :description="selected ? `删除“${selected.name}”后，其 ${selected.albumCount} 个图集和 ${selected.videoCount} 个视频会回到媒体库，不会删除图集或媒体。` : ''" confirm-text="删除 Coser" destructive @update:open="(open) => { deleteOpen = open }" @confirm="removeCoser" />
</template>

<style scoped>
.coser-grid { display: flex; gap: 16px; overflow-x: auto; padding: 8px 4px; }
.coser-choice { display: flex; width: 136px; flex-shrink: 0; min-width: 0; cursor: pointer; flex-direction: column; align-items: center; padding: 8px; border-radius: 12px; color: var(--app-muted); transition: color .2s; }
.coser-choice:hover { color: var(--app-foreground); }
.coser-choice:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.coser-choice.is-selected { color: var(--color-accent); }
.coser-avatar { display: grid; width: 112px; height: 112px; overflow: hidden; place-items: center; border: 3px solid var(--app-canvas); border-radius: 50%; background: rgb(124 58 237 / 10%); color: var(--color-accent); transition: box-shadow .2s; }
.coser-choice:hover .coser-avatar { box-shadow: 0 0 0 2px rgb(124 58 237 / 30%); }
.is-selected .coser-avatar, .is-selected:hover .coser-avatar { box-shadow: 0 0 0 2px var(--color-accent); }
input[type='search']::-webkit-search-cancel-button { display: none; }
@media (max-width: 640px) {
  .coser-grid { gap: 8px; }
  .coser-avatar { width: 88px; height: 88px; }
  .coser-choice { width: 112px; }
}
@media (prefers-reduced-motion: reduce) {
  .coser-choice, .coser-avatar { transition: none; }
}
</style>
