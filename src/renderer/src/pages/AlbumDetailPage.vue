<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, File, FileImage, FileVideo, Trash2 } from 'lucide-vue-next'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { useLibraryStore } from '@/stores/library'
import { sortMedia } from '@/utils/media-sort'

const route = useRoute(); const router = useRouter(); const library = useLibraryStore(); const album = ref<AlbumDetail | null>(null); const error = ref('')
const trashTarget = ref<{ id: string; name: string; isAlbum: boolean } | null>(null)
const sortedMedia = computed(() => album.value ? sortMedia(album.value.media, library.albumSortOrder) : [])
async function load(): Promise<void> { try { album.value = await window.api.library.getAlbum(String(route.params.id)); error.value = '' } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) } }
onMounted(() => { void load() }); watch(() => route.params.id, () => { void load() })
function trashMedia(id: string, name: string): void { trashTarget.value = { id, name, isAlbum: false } }
function trashAlbum(): void { if (album.value) trashTarget.value = { id: album.value.id, name: album.value.title, isAlbum: true } }
async function confirmTrash(): Promise<void> { const target = trashTarget.value; if (!target) return; trashTarget.value = null; if (target.isAlbum) { await window.api.media.trashAlbum(target.id); await router.push('/library') } else { await window.api.media.trashMedia(target.id); await load() } }
</script>

<template>
  <div class="p-6 lg:p-8"><button class="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground" @click="router.push('/library')"><ArrowLeft :size="16" />返回媒体库</button><div v-if="error" class="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{{ error }}</div><template v-else-if="album"><section class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5"><div><div class="flex items-center gap-2"><Badge>图集</Badge><Badge>{{ album.media.length }} 项</Badge></div><h2 class="mt-2 text-2xl font-semibold text-foreground">{{ album.title }}</h2></div><div class="flex flex-wrap items-center gap-2"><label class="flex items-center gap-2 text-sm text-muted">排序<select v-model="library.albumSortOrder" class="rounded-md border border-line bg-surface px-2 py-1 text-foreground outline-none focus:border-violet-500"><option value="filename">名称（A → Z）</option><option value="importedAt">导入时间（最新优先）</option></select></label><Button variant="outline" @click="trashAlbum"><Trash2 :size="16" />删除图集</Button></div></section><div class="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><article v-for="media in sortedMedia" :key="media.id" class="rounded-lg border border-line bg-surface p-3"><div class="grid aspect-[4/3] place-items-center overflow-hidden rounded-md bg-surface-hover"><img v-if="media.previewUrl" :src="media.previewUrl" :alt="media.originalName" class="h-full w-full object-cover"><FileImage v-else-if="media.mediaKind === 'image'" :size="28" /><FileVideo v-else-if="media.mediaKind === 'video'" :size="28" /><File v-else :size="28" /></div><div class="mt-2 flex gap-1"><p class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{{ media.originalName }}</p><button class="rounded p-1 text-muted hover:text-rose-400" title="移入回收站" @click="trashMedia(media.id, media.originalName)"><Trash2 :size="15" /></button></div></article></div></template><ConfirmDialog :open="Boolean(trashTarget)" title="移入回收站" :description="trashTarget ? `将${trashTarget.isAlbum ? '图集“' : '“'}${trashTarget.name}${trashTarget.isAlbum ? '”及其全部媒体' : '”'}移入回收站？原始导入来源文件不会被删除。` : ''" confirm-text="移入回收站" @update:open="(open) => { if (!open) trashTarget = null }" @confirm="confirmTrash" /></div>
</template>
