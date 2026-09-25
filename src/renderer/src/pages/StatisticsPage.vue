<script setup lang="ts">
import { FolderOpen, HardDrive, Image, PlayCircle, Video } from 'lucide-vue-next'

const activity = [
  { month: '4月', value: 28 }, { month: '5月', value: 43 }, { month: '6月', value: 35 }, { month: '7月', value: 68 }, { month: '8月', value: 84 }, { month: '9月', value: 52 }
]
const albums = [
  { name: '漫展现场', media: 36, size: '8.4 GB', color: 'bg-sky-500' },
  { name: '城市夜景', media: 32, size: '6.7 GB', color: 'bg-indigo-500' },
  { name: '夏日写真集', media: 24, size: '5.2 GB', color: 'bg-violet-500' },
  { name: '日常收藏', media: 15, size: '2.1 GB', color: 'bg-amber-500' }
]
</script>

<template>
  <div class="mx-auto max-w-6xl p-6 lg:p-8">
    <div><h2 class="text-2xl font-semibold tracking-tight text-foreground">统计数据</h2><p class="mt-1.5 text-sm text-muted">本地图集的内容规模、存储使用与近期整理情况。</p></div>

    <section class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">全部媒体</span><Image :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">421</p><p class="mt-1 text-xs text-emerald-600 dark:text-emerald-400">本月新增 52 项</p></article>
      <article class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">图集数量</span><FolderOpen :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">18</p><p class="mt-1 text-xs text-muted">4 个近期更新</p></article>
      <article class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">视频内容</span><Video :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">46</p><p class="mt-1 text-xs text-muted">占全部媒体 10.9%</p></article>
      <article class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">已使用空间</span><HardDrive :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">32.8 <span class="text-sm font-medium text-muted">GB</span></p><p class="mt-1 text-xs text-muted">缩略图缓存 682 MB</p></article>
    </section>

    <section class="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.8fr)]">
      <article class="rounded-xl border border-line bg-surface p-5"><div class="flex items-center justify-between"><div><h3 class="font-semibold text-foreground">导入趋势</h3><p class="mt-1 text-xs text-muted">近 6 个月新增媒体</p></div><span class="rounded-md bg-violet-500/10 px-2 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">310 项</span></div><div class="mt-7 flex h-44 items-end gap-3 sm:gap-5"><div v-for="item in activity" :key="item.month" class="flex h-full flex-1 flex-col justify-end"><div class="group relative rounded-t-md bg-violet-500/80 transition hover:bg-violet-500" :style="{ height: `${item.value}%` }"><span class="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-medium text-muted opacity-0 transition group-hover:opacity-100">{{ item.value }} 项</span></div><p class="mt-2 text-center text-xs text-muted">{{ item.month }}</p></div></div></article>
      <article class="rounded-xl border border-line bg-surface p-5"><h3 class="font-semibold text-foreground">媒体类型</h3><p class="mt-1 text-xs text-muted">按文件数量统计</p><div class="mt-6 flex items-center gap-5"><div class="grid size-28 place-items-center rounded-full" style="background: conic-gradient(#8b5cf6 0 89%, #38bdf8 89% 100%)"><div class="grid size-[78px] place-items-center rounded-full bg-surface text-center"><strong class="text-lg text-foreground">421</strong><span class="text-[10px] text-muted">全部媒体</span></div></div><div class="space-y-3 text-sm"><div><p class="flex items-center gap-2 text-foreground"><span class="size-2.5 rounded-full bg-violet-500"></span>图片 <b class="ml-auto pl-5">375</b></p><p class="mt-1 pl-4.5 text-xs text-muted">89.1%</p></div><div><p class="flex items-center gap-2 text-foreground"><span class="size-2.5 rounded-full bg-sky-400"></span>视频 <b class="ml-auto pl-5">46</b></p><p class="mt-1 pl-4.5 text-xs text-muted">10.9%</p></div></div></div></article>
    </section>

    <section class="mt-6 rounded-xl border border-line bg-surface p-5"><div class="flex items-center justify-between"><div><h3 class="font-semibold text-foreground">图集占用排行</h3><p class="mt-1 text-xs text-muted">按已索引文件大小估算</p></div><PlayCircle class="text-violet-500" :size="19" /></div><div class="mt-5 space-y-4"><div v-for="(album, index) in albums" :key="album.name" class="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3"><span class="text-sm font-medium text-muted">0{{ index + 1 }}</span><div><div class="flex justify-between gap-3 text-sm"><span class="truncate font-medium text-foreground">{{ album.name }}</span><span class="shrink-0 text-muted">{{ album.media }} 项 · {{ album.size }}</span></div><div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full" :class="album.color" :style="{ width: `${100 - index * 18}%` }"></div></div></div></div></div></section>
  </div>
</template>
