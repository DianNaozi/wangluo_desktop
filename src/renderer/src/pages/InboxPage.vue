<script setup lang="ts">
import { ArrowRight, CheckCircle2, Clock3, FolderInput, Heart, Image, Images, Play, Sparkles, Tag, TriangleAlert, Video } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import StatusCalendar from '@/components/dashboard/StatusCalendar.vue'
import ImportQueue from '@/components/imports/ImportQueue.vue'
import { useImportStore } from '@/stores/imports'

const imports = useImportStore()

const metrics = [
  { label: '全部媒体', value: '1,248', detail: '图片 1,096 · 视频 152', icon: Images, tone: 'text-violet-600 dark:text-violet-300' },
  { label: '待整理', value: '86', detail: '需要添加归属信息', icon: Sparkles, tone: 'text-amber-600 dark:text-amber-300' },
  { label: '我的收藏', value: '124', detail: '最近新增 8 项', icon: Heart, tone: 'text-rose-600 dark:text-rose-300' },
  { label: '已用空间', value: '18.6 GB', detail: '来自 3 个本地目录', icon: Image, tone: 'text-sky-600 dark:text-sky-300' }
]
const pending = [{ label: '未归入图集', count: 42, icon: Images }, { label: '缺少标签', count: 63, icon: Tag }, { label: '未关联 Coser', count: 28, icon: Sparkles }]
const recent = [{ name: '夏日写真集', type: '图片 · 24 项', color: 'from-violet-400 to-fuchsia-300' }, { name: '漫展现场', type: '视频 · 8 项', color: 'from-sky-400 to-cyan-300' }, { name: '城市夜景', type: '图片 · 32 项', color: 'from-orange-400 to-rose-300' }, { name: '日常收藏', type: '图片 · 15 项', color: 'from-emerald-400 to-teal-300' }]
</script>

<template>
  <div class="mx-auto max-w-7xl p-6 lg:p-8">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4"><div><div class="flex items-center gap-2"><p class="text-sm font-medium text-violet-600 dark:text-violet-300">欢迎回来</p><Badge>本地受管图库</Badge></div><h2 class="mt-1 text-2xl font-semibold tracking-tight text-foreground">你的图库状态一目了然</h2><p class="mt-1.5 text-sm text-muted">从导入任务开始，安全地复制并整理本地媒体。</p></div><Button @click="imports.importFolders"><FolderInput :size="17" />导入本地文件夹</Button></div>

    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><article v-for="item in metrics" :key="item.label" class="rounded-card border border-line bg-surface p-4"><div class="flex items-start justify-between"><p class="text-sm text-muted">{{ item.label }}</p><component :is="item.icon" :class="item.tone" :size="19" /></div><p class="mt-4 text-2xl font-semibold tracking-tight text-foreground">{{ item.value }}</p><p class="mt-1 text-xs text-muted">{{ item.detail }}</p></article></section>

    <div class="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="space-y-5">
        <ImportQueue />
        <section class="rounded-card border border-line bg-surface p-5"><div class="flex items-center justify-between"><div><h3 class="font-semibold text-foreground">待整理</h3><p class="mt-1 text-sm text-muted">为媒体补齐归属信息，之后会更容易找到它们。</p></div><button class="inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-300">查看全部 <ArrowRight :size="15" /></button></div><div class="mt-5 grid gap-2 sm:grid-cols-3"><button v-for="item in pending" :key="item.label" class="flex items-center gap-3 rounded-lg bg-canvas px-3 py-3 text-left hover:bg-surface-hover"><span class="grid size-8 place-items-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300"><component :is="item.icon" :size="16" /></span><span><b class="block text-lg leading-5 text-foreground">{{ item.count }}</b><span class="text-xs text-muted">{{ item.label }}</span></span></button></div></section>

        <section class="rounded-card border border-line bg-surface p-5"><div class="flex items-center justify-between"><div><h3 class="font-semibold text-foreground">最近导入</h3><p class="mt-1 text-sm text-muted">最近 7 天添加到图库的媒体。</p></div><button class="inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-300">进入媒体库 <ArrowRight :size="15" /></button></div><div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><article v-for="item in recent" :key="item.name" class="group"><div :class="['relative aspect-[4/3] overflow-hidden rounded-lg bg-gradient-to-br', item.color]"><div class="absolute inset-0 bg-black/10 transition group-hover:bg-black/0"></div><span v-if="item.type.includes('视频')" class="absolute bottom-2 right-2 grid size-6 place-items-center rounded-full bg-black/50 text-white"><Play :size="12" fill="currentColor" /></span></div><p class="mt-2 truncate text-sm font-medium text-foreground">{{ item.name }}</p><p class="mt-0.5 text-xs text-muted">{{ item.type }}</p></article></div></section>

        <section class="rounded-card border border-line bg-surface p-5"><div class="flex items-center justify-between"><div><h3 class="font-semibold text-foreground">继续浏览</h3><p class="mt-1 text-sm text-muted">最近查看过的图集和播放内容。</p></div><Clock3 class="text-muted" :size="19" /></div><div class="mt-4 flex items-center gap-3 rounded-lg bg-canvas p-3"><div class="grid size-10 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-300"><Play :size="17" fill="currentColor" /></div><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-foreground">夏日写真集</p><p class="mt-0.5 text-xs text-muted">上次浏览至第 8 / 24 项</p></div><button class="text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-300">继续</button></div></section>
      </div>

      <aside class="space-y-5"><StatusCalendar /><section class="rounded-card border border-line bg-surface p-4"><div class="flex items-center gap-2"><CheckCircle2 class="text-emerald-500" :size="18" /><h3 class="font-semibold text-foreground">后台状态正常</h3></div><div class="mt-4 space-y-3 text-sm"><div class="flex items-center justify-between"><span class="text-muted">扫描队列</span><span class="text-foreground">已完成</span></div><div class="flex items-center justify-between"><span class="text-muted">缩略图缓存</span><span class="text-foreground">1.2 GB</span></div><div class="flex items-center justify-between"><span class="inline-flex items-center gap-1.5 text-muted"><TriangleAlert :size="14" />失效路径</span><span class="text-foreground">0</span></div></div></section></aside>
    </div>
  </div>
</template>
