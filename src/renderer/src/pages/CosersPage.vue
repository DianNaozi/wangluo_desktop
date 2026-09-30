<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Pencil, Plus, Trash2, UserRound } from 'lucide-vue-next'
import AlbumCard from '@/components/albums/AlbumCard.vue'
import CoserDialog from '@/components/cosers/CoserDialog.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { useImportStore } from '@/stores/imports'
import { useLibraryStore } from '@/stores/library'
import { usePlaybackStore } from '@/stores/playback'
import { sortMedia } from '@/utils/media-sort'
import { detectAvatarFace } from '@/utils/face-detector'
import { generateRandomAvatar } from '@/utils/random-avatar'

const route = useRoute(); const router = useRouter(); const imports = useImportStore(); const library = useLibraryStore(); const playback = usePlaybackStore()
const cosers = ref<CoserSummary[]>([]); const selected = ref<CoserDetail | null>(null); const loading = ref(false); const error = ref('')
const dialogOpen = ref(false); const editing = ref(false); const saving = ref(false); const deleteOpen = ref(false); const unavailablePreviews = ref(new Set<string>())
const avatarProcessing = ref(false); const avatarMessage = ref(''); const clearAvatarRequested = ref(false); const unavailableAvatars = ref(new Set<string>())
const selectedId = computed(() => typeof route.query.coser === 'string' ? route.query.coser : '')
const dateText = (value: number): string => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)

async function refresh(preferredId = selectedId.value): Promise<void> {
  loading.value = true
  try {
    const next = await window.api.library.getCosers()
    cosers.value = next
    const id = next.some((coser) => coser.id === preferredId) ? preferredId : next[0]?.id ?? ''
    if (id && id !== selectedId.value) { await router.replace({ name: 'cosers', query: { coser: id } }); return }
    selected.value = id ? await window.api.library.getCoser(id) : null
    error.value = ''
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { loading.value = false }
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
    await refresh(coser.id)
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
    await refresh(coserId)
    avatarMessage.value = '头像已立即更新。'
  } catch (reason) { avatarMessage.value = reason instanceof Error ? reason.message : String(reason) }
  finally { avatarProcessing.value = false }
}
function clearAvatar(): void { if (avatarProcessing.value) return; clearAvatarRequested.value = true; avatarMessage.value = '保存修改后移除头像。' }
function hideAvatar(id: string): void { unavailableAvatars.value = new Set(unavailableAvatars.value).add(id) }
async function removeCoser(): Promise<void> {
  if (!selected.value) return
  try { await window.api.library.deleteCoser(selected.value.id); deleteOpen.value = false; await refresh('') }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function unassignAlbum(albumId: string): Promise<void> {
  try { await window.api.library.unassignAlbumCoser(albumId); await refresh(selected.value?.id ?? ''); await imports.refresh() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function addAlbumToQueue(id: string, title: string): Promise<void> {
  try { const album = await window.api.library.getAlbum(id); playback.addMediaBatch(sortMedia(album.media, library.albumSortOrder), title) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function trashAlbum(id: string): Promise<void> {
  try { await imports.trashAlbum(id); await refresh(selected.value?.id ?? '') }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
}
function hidePreview(id: string): void { unavailablePreviews.value = new Set(unavailablePreviews.value).add(id) }

onMounted(() => { void refresh() })
watch(selectedId, () => { if (cosers.value.length) void refresh() })
</script>

<template>
  <div class="p-6 lg:p-8">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div class="flex items-center gap-2"><h2 class="text-2xl font-semibold tracking-tight text-foreground">Coser</h2><Badge>{{ cosers.length }} 人</Badge></div><p class="mt-1.5 text-sm text-muted">每位 Coser 可维护多个名字，并集中浏览所属图包。</p></div><Button @click="create"><Plus :size="17" />新建 Coser</Button></div>
    <p v-if="error" class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{{ error }}</p>
    <section v-if="cosers.length" class="mb-8 rounded-card border border-line bg-surface p-4">
      <div class="flex gap-4 overflow-x-auto pb-1">
        <button v-for="coser in cosers" :key="coser.id" :class="['group flex w-32 shrink-0 flex-col items-center rounded-2xl px-3 py-3 text-center transition', selected?.id === coser.id ? 'bg-violet-500/12 text-violet-700 shadow-sm dark:text-violet-200' : 'text-muted hover:bg-surface-hover hover:text-foreground']" @click="select(coser.id)">
          <span :class="['grid size-20 overflow-hidden place-items-center rounded-full border-2 bg-violet-500/15 text-violet-600 shadow-md transition duration-200 group-hover:scale-105 dark:text-violet-300 sm:size-24', selected?.id === coser.id ? 'border-violet-500 ring-4 ring-violet-500/15' : 'border-white/70 dark:border-white/15']">
            <img v-if="coser.avatarUrl && !unavailableAvatars.has(coser.id)" :src="coser.avatarUrl" :alt="`${coser.name} 的头像`" class="size-full object-cover" @error="hideAvatar(coser.id)">
            <UserRound v-else :size="32" />
          </span>
          <span class="mt-3 w-full truncate text-sm font-semibold">{{ coser.name }}</span>
          <span class="mt-1 text-xs opacity-75">{{ coser.albumCount }} 个图集 · {{ coser.mediaCount }} 项</span>
        </button>
      </div>
    </section>
    <section v-if="selected">
      <div class="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-line bg-surface/70 p-4 sm:p-5">
        <div class="flex items-center gap-4 sm:gap-5">
          <span class="grid size-24 shrink-0 overflow-hidden place-items-center rounded-full border-2 border-violet-500 bg-violet-500/15 text-violet-600 shadow-lg ring-4 ring-violet-500/10 dark:text-violet-300 sm:size-28">
            <img v-if="selected.avatarUrl && !unavailableAvatars.has(selected.id)" :src="selected.avatarUrl" :alt="`${selected.name} 的头像`" class="size-full object-cover" @error="hideAvatar(selected.id)">
            <UserRound v-else :size="42" />
          </span>
          <div><div class="flex flex-wrap items-center gap-2"><h3 class="text-xl font-semibold text-foreground sm:text-2xl">{{ selected.name }}</h3><Badge>{{ selected.albumCount }} 个图集</Badge></div><p class="mt-1 text-sm text-muted">{{ selected.mediaCount }} 项媒体</p><div v-if="selected.aliases.length" class="mt-3 flex flex-wrap gap-1.5"><span v-for="alias in selected.aliases" :key="alias" class="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">{{ alias }}</span></div></div>
        </div>
        <div class="flex gap-2"><Button size="sm" variant="outline" @click="edit"><Pencil :size="15" />编辑</Button><Button size="sm" variant="outline" @click="deleteOpen = true"><Trash2 :size="15" />删除</Button></div>
      </div>
      <div v-if="selected.albums.length" class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"><AlbumCard v-for="album in selected.albums" :key="album.id" :album="album" :preview-unavailable="unavailablePreviews.has(album.id)" :subtitle="`${dateText(album.updatedAt)} 更新`" @open="router.push(`/albums/${album.id}`)" @queue="addAlbumToQueue(album.id, album.title)" @delete="trashAlbum(album.id)" @preview-error="hidePreview(album.id)"><template #footer><button class="shrink-0 text-xs text-muted hover:text-foreground" @click.stop="unassignAlbum(album.id)">移出 Coser</button></template></AlbumCard></div><div v-else class="grid min-h-56 place-items-center rounded-card border border-dashed border-line"><div class="text-center"><UserRound class="mx-auto text-muted" :size="24" /><p class="mt-3 font-medium text-foreground">还没有归属图集</p><p class="mt-1 text-sm text-muted">在媒体库或文件夹中右键图集，选择“归入 Coser”。</p></div></div>
    </section>
    <div v-else-if="!loading" class="grid min-h-72 place-items-center rounded-card border border-dashed border-line"><div class="text-center"><UserRound class="mx-auto text-muted" :size="24" /><p class="mt-3 font-medium text-foreground">还没有 Coser</p><p class="mt-1 text-sm text-muted">创建人物后即可将图集归类到其名下。</p><Button class="mt-4" @click="create"><Plus :size="16" />新建 Coser</Button></div></div>
  </div>
  <CoserDialog v-model:open="dialogOpen" :title="editing ? '编辑 Coser' : '新建 Coser'" :initial="editing && selected ? { name: selected.name, aliases: selected.aliases } : null" :busy="saving" :avatar-busy="avatarProcessing" :avatar-message="avatarMessage" :error="error" :avatar-selected="Boolean(selected?.avatarUrl && !clearAvatarRequested)" :can-select-avatar="Boolean(editing && selected?.mediaCount)" :can-clear-avatar="Boolean(editing && selected?.avatarUrl && !clearAvatarRequested)" @confirm="saveCoser" @select-avatar="pickAvatar" @clear-avatar="clearAvatar" />
  <ConfirmDialog :open="deleteOpen" title="删除 Coser" :description="selected ? `删除“${selected.name}”后，其 ${selected.albumCount} 个图集会回到媒体库，不会删除图集或媒体。` : ''" confirm-text="删除 Coser" destructive @update:open="(open) => { deleteOpen = open }" @confirm="removeCoser" />
</template>
