<script setup lang="ts">
import { computed, ref } from 'vue'
import { CalendarDays, ChevronDown, Clock3, Filter, Image, Video } from 'lucide-vue-next'
import Badge from '@/components/ui/Badge.vue'

type TimelineMedia = { id: string; type: 'image' | 'video'; color: string; title: string; album: string; coser?: string; tags: string[]; duration?: string }
type TimelineGroup = { month: string; label: string; total: number; media: TimelineMedia[] }

const source = ref('all')
const order = ref('shot')
const tag = ref('all')
const groups: TimelineGroup[] = [
  { month: '09', label: '2026 年 9 月', total: 52, media: [
    { id: 's1', type: 'image', title: 'summer_001.jpg', album: '夏日写真集', coser: '林柚', tags: ['写真'], color: 'from-fuchsia-500 via-rose-400 to-orange-100' },
    { id: 's2', type: 'video', title: 'behind_scene.mp4', album: '夏日写真集', coser: 'Momo', tags: ['写真', '活动'], duration: '00:32', color: 'from-violet-800 via-indigo-500 to-sky-300' },
    { id: 's3', type: 'image', title: 'portrait_082.jpg', album: '未归档', tags: ['日常'], color: 'from-sky-500 via-cyan-300 to-teal-100' },
    { id: 's4', type: 'image', title: 'summer_007.jpg', album: '夏日写真集', coser: '林柚', tags: ['写真'], color: 'from-orange-500 via-amber-300 to-yellow-100' },
    { id: 's5', type: 'video', title: 'walkthrough.mp4', album: '未归档', tags: ['待整理'], duration: '01:06', color: 'from-slate-900 via-violet-600 to-fuchsia-300' },
    { id: 's6', type: 'image', title: 'daily_104.jpg', album: '日常收藏', tags: ['日常'], color: 'from-emerald-500 via-teal-300 to-cyan-100' }
  ] },
  { month: '08', label: '2026 年 8 月', total: 118, media: [
    { id: 'a1', type: 'image', title: 'con_201.jpg', album: '漫展现场', coser: '小满', tags: ['漫展'], color: 'from-blue-700 via-cyan-400 to-teal-100' },
    { id: 'a2', type: 'image', title: 'con_202.jpg', album: '漫展现场', coser: '小满', tags: ['漫展', '活动'], color: 'from-indigo-700 via-violet-400 to-pink-200' },
    { id: 'a3', type: 'video', title: 'stage.mov', album: '漫展现场', tags: ['漫展'], duration: '00:48', color: 'from-zinc-900 via-purple-600 to-rose-300' },
    { id: 'a4', type: 'image', title: 'night_018.jpg', album: '城市夜景', coser: '阿樱', tags: ['夜景'], color: 'from-slate-950 via-indigo-600 to-blue-300' },
    { id: 'a5', type: 'image', title: 'night_019.jpg', album: '城市夜景', tags: ['夜景', '街拍'], color: 'from-rose-600 via-orange-400 to-amber-100' }
  ] }
]

const visibleGroups = computed(() => groups.map((group) => ({ ...group, media: group.media.filter((item) => (source.value === 'all' || item.album === source.value) && (tag.value === 'all' || item.tags.includes(tag.value))) })).filter((group) => group.media.length))
</script>

<template>
  <div class="mx-auto max-w-6xl p-6 lg:p-8">
    <div class="flex flex-wrap items-end justify-between gap-4"><div><h2 class="text-2xl font-semibold tracking-tight text-foreground">时间轴</h2><p class="mt-1.5 text-sm text-muted">按拍摄或文件时间回顾全部已索引媒体。</p></div><Badge>2026 年</Badge></div>
    <div class="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3"><Filter :size="16" class="ml-1 text-violet-500" /><label class="relative"><select v-model="source" class="h-9 appearance-none rounded-lg border border-line bg-canvas pl-3 pr-8 text-sm text-foreground outline-none focus:border-violet-500"><option value="all">全部图集</option><option value="夏日写真集">夏日写真集</option><option value="漫展现场">漫展现场</option><option value="城市夜景">城市夜景</option><option value="未归档">未归档媒体</option></select><ChevronDown class="pointer-events-none absolute right-2 top-2 text-muted" :size="15" /></label><label class="relative"><select v-model="tag" class="h-9 appearance-none rounded-lg border border-line bg-canvas pl-3 pr-8 text-sm text-foreground outline-none focus:border-violet-500"><option value="all">全部标签</option><option value="写真">写真</option><option value="漫展">漫展</option><option value="夜景">夜景</option><option value="日常">日常</option></select><ChevronDown class="pointer-events-none absolute right-2 top-2 text-muted" :size="15" /></label><label class="relative ml-auto"><select v-model="order" class="h-9 appearance-none rounded-lg border border-line bg-canvas pl-3 pr-8 text-sm text-foreground outline-none focus:border-violet-500"><option value="shot">按拍摄时间</option><option value="file">按文件时间</option></select><ChevronDown class="pointer-events-none absolute right-2 top-2 text-muted" :size="15" /></label></div>
    <div class="mt-7 space-y-8"><section v-for="group in visibleGroups" :key="group.month" class="grid gap-4 md:grid-cols-[96px_minmax(0,1fr)]"><div class="flex gap-3 md:block"><div class="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300"><CalendarDays :size="19" /></div><div class="md:mt-3"><p class="text-lg font-semibold text-foreground">{{ group.month }} 月</p><p class="mt-0.5 text-xs text-muted">{{ group.label }}</p><p class="mt-2 text-xs text-muted">{{ group.total }} 项</p></div></div><div><div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"><article v-for="media in group.media" :key="media.id" class="group relative aspect-[4/3] overflow-hidden rounded-lg bg-zinc-300 dark:bg-zinc-800"><div :class="['size-full bg-gradient-to-br', media.color]"></div><div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-2.5 pb-2 pt-7 opacity-0 transition group-hover:opacity-100"><p class="truncate text-xs font-medium text-white">{{ media.title }}</p><p class="mt-0.5 truncate text-[11px] text-white/75">{{ media.album }}<span v-if="media.coser"> · {{ media.coser }}</span></p></div><span v-if="media.type === 'video'" class="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-1 text-[10px] text-white"><Video :size="11" />{{ media.duration }}</span><Image v-else class="absolute right-1.5 top-1.5 text-white/75 opacity-0 drop-shadow transition group-hover:opacity-100" :size="15" /></article></div></div></section><div v-if="!visibleGroups.length" class="grid min-h-56 place-items-center rounded-xl border border-dashed border-line"><div class="text-center"><Clock3 class="mx-auto text-muted" :size="22" /><p class="mt-3 text-sm text-muted">没有符合筛选条件的媒体</p></div></div></div>
  </div>
</template>
