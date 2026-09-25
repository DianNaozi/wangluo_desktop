<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderOpen, Grid2X2, Image, Plus, Search, Tag, TrendingUp, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'

type TagItem = { id: string; name: string; mediaCount: number; albumCount: number; color: string; softColor: string }

const tags = ref<TagItem[]>([
  { id: 'portrait', name: '写真', mediaCount: 248, albumCount: 8, color: '#8b5cf6', softColor: 'rgba(139, 92, 246, .13)' },
  { id: 'daily', name: '日常', mediaCount: 181, albumCount: 12, color: '#0ea5e9', softColor: 'rgba(14, 165, 233, .12)' },
  { id: 'con', name: '漫展', mediaCount: 134, albumCount: 6, color: '#10b981', softColor: 'rgba(16, 185, 129, .12)' },
  { id: 'event', name: '活动', mediaCount: 89, albumCount: 5, color: '#f59e0b', softColor: 'rgba(245, 158, 11, .14)' },
  { id: 'night', name: '夜景', mediaCount: 62, albumCount: 4, color: '#6366f1', softColor: 'rgba(99, 102, 241, .12)' },
  { id: 'street', name: '街拍', mediaCount: 42, albumCount: 3, color: '#f43f5e', softColor: 'rgba(244, 63, 94, .11)' },
  { id: 'favorite', name: '精选', mediaCount: 35, albumCount: 2, color: '#d946ef', softColor: 'rgba(217, 70, 239, .11)' },
  { id: 'waiting', name: '待整理', mediaCount: 26, albumCount: 0, color: '#71717a', softColor: 'rgba(113, 113, 122, .12)' }
])

const query = ref('')
const dialog = ref(false)
const name = ref('')
const filtered = computed(() => tags.value.filter((tag) => tag.name.includes(query.value.trim())).sort((a, b) => b.albumCount - a.albumCount || b.mediaCount - a.mediaCount))
const totalMedia = computed(() => tags.value.reduce((sum, tag) => sum + tag.mediaCount, 0))
const totalAlbums = computed(() => tags.value.reduce((sum, tag) => sum + tag.albumCount, 0))
const maxAlbums = computed(() => Math.max(...tags.value.map((tag) => tag.albumCount), 1))
const donutStyle = computed(() => {
  const colors = tags.value.slice(0, 5)
  let cursor = 0
  const stops = colors.map((tag) => {
    const end = cursor + (tag.mediaCount / totalMedia.value) * 100
    const stop = `${tag.color} ${cursor}% ${end}%`
    cursor = end
    return stop
  })
  return { background: `conic-gradient(${stops.join(', ')}, var(--color-line) ${cursor}% 100%)` }
})

function addTag(): void {
  const value = name.value.trim()
  if (!value) return
  tags.value.unshift({ id: `tag-${Date.now()}`, name: value, mediaCount: 0, albumCount: 0, color: '#8b5cf6', softColor: 'rgba(139, 92, 246, .13)' })
  name.value = ''
  dialog.value = false
}
</script>

<template>
  <div class="mx-auto max-w-6xl p-6 lg:p-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><div class="flex items-center gap-2"><h2 class="text-2xl font-semibold tracking-tight text-foreground">标签</h2><Badge>{{ tags.length }} 个</Badge></div><p class="mt-1.5 text-sm text-muted">用标签串联媒体与图集，一眼查看整理覆盖情况。</p></div>
      <Button @click="dialog = true"><Plus :size="17" />新建标签</Button>
    </div>

    <section class="mt-6 grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">标签总数</span><Tag :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">{{ tags.length }}</p><p class="mt-1 text-xs text-muted">已建立的分类标签</p></div>
      <div class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">关联图集</span><FolderOpen :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">{{ totalAlbums }}</p><p class="mt-1 text-xs text-muted">图集可拥有多个标签</p></div>
      <div class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">已标记媒体</span><Image :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">{{ totalMedia }}</p><p class="mt-1 text-xs text-muted">标签关联次数</p></div>
    </section>

    <section class="mt-6 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div class="rounded-xl border border-line bg-surface p-5">
        <div class="flex items-center gap-2 text-sm font-medium text-foreground"><TrendingUp :size="16" class="text-violet-500" />使用分布</div>
        <div class="relative mx-auto mt-5 grid size-32 place-items-center rounded-full" :style="donutStyle"><div class="grid size-20 place-items-center rounded-full bg-surface text-center"><strong class="text-xl text-foreground">{{ totalMedia }}</strong><span class="text-[11px] text-muted">关联次数</span></div></div>
        <p class="mt-5 text-center text-xs leading-5 text-muted">圆环按媒体关联量展示前五个常用标签。</p>
      </div>

      <div class="min-w-0">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-2 text-sm font-medium text-foreground"><Grid2X2 :size="16" class="text-violet-500" />标签与图集</div><div class="relative w-full sm:w-52"><Search class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" :size="16" /><input v-model="query" class="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-violet-500" placeholder="搜索标签" /></div></div>
        <div v-if="filtered.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <article v-for="tag in filtered" :key="tag.id" class="group rounded-xl border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-sm dark:hover:border-violet-700">
            <div class="flex items-start justify-between gap-3"><div class="flex min-w-0 items-center gap-2"><span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }"></span><h3 class="truncate font-semibold text-foreground">{{ tag.name }}</h3></div><span class="rounded-md px-2 py-1 text-xs font-medium" :style="{ color: tag.color, backgroundColor: tag.softColor }">{{ tag.mediaCount }} 媒体</span></div>
            <div class="mt-5 flex items-end justify-between"><div><p class="text-xs text-muted">关联图集</p><p class="mt-1 text-2xl font-semibold text-foreground">{{ tag.albumCount }}<span class="ml-1 text-xs font-normal text-muted">个</span></p></div><div class="w-24"><div class="mb-1.5 flex justify-between text-[11px] text-muted"><span>图集覆盖</span><span>{{ Math.round((tag.albumCount / maxAlbums) * 100) }}%</span></div><div class="h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full transition-all" :style="{ width: `${(tag.albumCount / maxAlbums) * 100}%`, backgroundColor: tag.color }"></div></div></div></div>
          </article>
        </div>
        <div v-else class="grid min-h-60 place-items-center rounded-xl border border-dashed border-line"><div class="text-center"><Tag class="mx-auto text-muted" :size="22" /><p class="mt-3 text-sm text-muted">没有匹配的标签</p></div></div>
      </div>
    </section>

    <div v-if="dialog" class="fixed inset-0 z-40 grid place-items-center bg-zinc-950/45 p-5 backdrop-blur-sm" @click.self="dialog = false"><div class="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-2xl"><div class="flex items-center justify-between"><h3 class="font-semibold text-foreground">新建标签</h3><button class="text-muted" @click="dialog = false"><X :size="17" /></button></div><input v-model="name" class="mt-5 h-9 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-foreground outline-none focus:border-violet-500" placeholder="标签名称" @keydown.enter="addTag" /><div class="mt-5 flex justify-end gap-2"><Button variant="outline" @click="dialog = false">取消</Button><Button @click="addTag">保存</Button></div></div></div>
  </div>
</template>
