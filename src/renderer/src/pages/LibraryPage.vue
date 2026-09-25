<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { File, FileImage, FileVideo, FolderInput, Images, RotateCcw, Trash2 } from 'lucide-vue-next'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import { useImportStore } from '@/stores/imports'
import { useLibraryStore } from '@/stores/library'

const imports = useImportStore(); const library = useLibraryStore(); const router = useRouter()
const unavailablePreviews = ref(new Set<string>())
onMounted(() => { void imports.refresh() })
const query = computed(() => library.searchQuery.trim().toLocaleLowerCase())
const albums = computed(() => imports.snapshot.albums.filter((item) => !query.value || item.title.toLocaleLowerCase().includes(query.value)))
const looseMedia = computed(() => imports.snapshot.looseMedia.filter((item) => (!query.value || item.originalName.toLocaleLowerCase().includes(query.value)) && (library.mediaKind === 'all' || library.mediaKind === item.mediaKind)))
const dateText = (value: number): string => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)
function hidePreview(id: string): void { unavailablePreviews.value = new Set(unavailablePreviews.value).add(id) }
async function trashMedia(id: string, name: string): Promise<void> { if (window.confirm(`将“${name}”移入回收站？原始导入来源文件不会被删除。`)) await imports.trashMedia(id) }
async function trashAlbum(id: string, title: string): Promise<void> { if (window.confirm(`将图集“${title}”及其全部媒体移入回收站？原始导入来源文件不会被删除。`)) await imports.trashAlbum(id) }
</script>

<template>
  <div class="p-6 lg:p-8">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div class="flex items-center gap-2"><h2 class="text-2xl font-semibold tracking-tight text-foreground">媒体库</h2><Badge>{{ imports.snapshot.totals.all }} 项</Badge></div><p class="mt-1.5 text-sm text-muted">图片 {{ imports.snapshot.totals.images }} · 视频 {{ imports.snapshot.totals.videos }} · 普通文件 {{ imports.snapshot.totals.files }}</p></div><div class="flex gap-2"><Button variant="outline" @click="router.push('/trash')"><Trash2 :size="16" />回收站</Button><Button variant="outline" @click="imports.rebuildPreviews"><RotateCcw :size="16" />重新生成预览</Button><Button variant="outline" @click="imports.importFiles"><File :size="16" />导入文件</Button><Button @click="imports.importFolders"><FolderInput :size="16" />导入文件夹</Button></div></div>
    <section v-if="albums.length"><div class="mb-3 flex items-center gap-2"><h3 class="font-semibold text-foreground">图集</h3><span class="text-sm text-muted">{{ albums.length }}</span></div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"><article v-for="album in albums" :key="album.id" class="overflow-hidden rounded-lg border border-line bg-surface"><button class="block w-full text-left" @click="router.push(`/albums/${album.id}`)"><div class="grid aspect-[16/9] place-items-center overflow-hidden bg-gradient-to-br from-violet-500/25 via-fuchsia-500/10 to-sky-400/20"><img v-if="album.coverPreviewUrl && !unavailablePreviews.has(album.id)" :src="album.coverPreviewUrl" :alt="album.title" class="h-full w-full object-cover" @error="hidePreview(album.id)"><Images v-else class="text-violet-500" :size="34" /></div></button><div class="flex items-center justify-between gap-2 p-3"><div class="min-w-0"><p class="truncate text-sm font-semibold text-foreground">{{ album.title }}</p><p class="mt-0.5 text-xs text-muted">{{ dateText(album.updatedAt) }} 更新 · {{ album.mediaCount }} 项</p></div><button class="rounded p-1.5 text-muted hover:bg-surface-hover hover:text-rose-400" title="移入回收站" @click="trashAlbum(album.id, album.title)"><Trash2 :size="16" /></button></div></article></div></section>
    <section v-if="looseMedia.length" class="mt-8"><div class="mb-3 flex items-center gap-2 border-t border-line pt-6"><h3 class="font-semibold text-foreground">未归档媒体</h3><span class="text-sm text-muted">{{ looseMedia.length }}</span></div><div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"><article v-for="media in looseMedia" :key="media.id" class="rounded-lg border border-line bg-surface p-3"><div class="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-md" :class="media.mediaKind === 'image' ? 'bg-violet-500/10 text-violet-500' : media.mediaKind === 'video' ? 'bg-sky-500/10 text-sky-500' : 'bg-zinc-500/10 text-zinc-400'"><img v-if="media.previewUrl && !unavailablePreviews.has(media.id)" :src="media.previewUrl" :alt="media.originalName" class="h-full w-full object-cover" @error="hidePreview(media.id)"><FileImage v-else-if="media.mediaKind === 'image'" :size="28" /><FileVideo v-else-if="media.mediaKind === 'video'" :size="28" /><File v-else :size="28" /></div><div class="mt-2 flex items-start gap-1"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-foreground">{{ media.originalName }}</p><p class="mt-0.5 text-xs text-muted">{{ media.mediaKind === 'image' ? '图片' : media.mediaKind === 'video' ? '视频' : '文件' }} · {{ dateText(media.importedAt) }}</p></div><button class="rounded p-1 text-muted hover:bg-surface-hover hover:text-rose-400" title="移入回收站" @click="trashMedia(media.id, media.originalName)"><Trash2 :size="15" /></button></div></article></div></section>
    <div v-if="!albums.length && !looseMedia.length" class="grid min-h-72 place-items-center rounded-card border border-dashed border-line"><div class="text-center"><Images class="mx-auto text-muted" :size="24" /><p class="mt-3 font-medium text-foreground">还没有已导入的媒体</p><Button class="mt-4" @click="imports.importFiles"><File :size="16" />选择文件</Button></div></div>
  </div>
</template>
