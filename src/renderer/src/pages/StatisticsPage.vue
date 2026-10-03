<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Award, BarChart3, Clock3, Layers3, Star } from 'lucide-vue-next'
import Badge from '@/components/ui/Badge.vue'
import { usePlaybackStore } from '@/stores/playback'

const playback = usePlaybackStore()
const stat = computed(() => playback.stats)
const days = computed(() => stat.value?.days ?? [])
const dailyMax = computed(() => Math.max(1, ...days.value.map((day) => day.watchedMs)))
const watchedPacks = computed(() => new Set((stat.value?.progress ?? []).filter((item) => item.entryId.startsWith('album:')).map((item) => item.entryId)).size)
const achievements = [
  { id: 'first-album', title: '初次完成', detail: '完整看完一个图包', icon: Layers3 },
  { id: 'ten-albums', title: '图包漫游者', detail: '完整看完 10 个不同图包', icon: Award },
  { id: 'one-hour', title: '沉浸时光', detail: '累计有效观看 1 小时', icon: Clock3 }
]

function duration(value: number): string {
  const total = Math.max(0, Math.floor(value / 1_000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  return hours ? `${hours} 小时 ${minutes} 分` : minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}
function dayLabel(date: string): string {
  const parts = date.split('-').map(Number)
  return parts.length === 3 ? `${parts[1]}月${parts[2]}日` : date
}
function hasAchievement(id: string): boolean { return Boolean(stat.value?.achievements.some((item) => item.id === id)) }

onMounted(() => { void playback.hydrate() })
</script>

<template>
  <div class="mx-auto max-w-6xl p-6 lg:p-8">
    <div><div class="flex items-center gap-2"><h2 class="text-2xl font-semibold tracking-tight text-foreground">观看成长</h2><Badge>本地记录</Badge></div><p class="mt-1.5 text-sm text-muted">队列播放累计的有效观看时间、经验和图包完成情况。</p></div>

    <section class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">有效观看</span><Clock3 :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">{{ duration(stat?.totalWatchedMs ?? 0) }}</p><p class="mt-1 text-xs text-muted">只计算前台实际播放</p></article>
      <article class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">当前等级</span><Star :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">Lv.{{ stat?.level ?? 1 }}</p><div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-violet-500 transition-[width]" :style="{ width: `${stat?.xpInLevel ?? 0}%` }"></div></div><p class="mt-1 text-xs text-muted">{{ stat?.xpInLevel ?? 0 }} / 100 XP · 共 {{ stat?.xp ?? 0 }} XP</p></article>
      <article class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">看过的图包</span><Layers3 :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">{{ watchedPacks }}</p><p class="mt-1 text-xs text-muted">包含有观看记录的图包</p></article>
      <article class="rounded-xl border border-line bg-surface p-4"><div class="flex items-center justify-between text-muted"><span class="text-sm">已解锁成就</span><Award :size="17" /></div><p class="mt-3 text-2xl font-semibold text-foreground">{{ stat?.achievements.length ?? 0 }} <span class="text-sm font-medium text-muted">/ 3</span></p><p class="mt-1 text-xs text-muted">记录保存在本机图库</p></article>
    </section>

    <section class="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,.8fr)]">
      <article class="rounded-xl border border-line bg-surface p-5"><div class="flex items-center gap-2"><BarChart3 class="text-violet-500" :size="19" /><h3 class="font-semibold text-foreground">最近 7 天</h3></div><p class="mt-1 text-xs text-muted">按本地日期汇总有效观看时间</p><div v-if="days.length" class="mt-6 grid h-48 grid-cols-7 items-end gap-3 sm:gap-5"><div v-for="day in days" :key="day.date" class="flex h-full min-w-0 flex-col justify-end gap-2"><div class="group relative flex h-full items-end"><div class="w-full rounded-t-md bg-violet-500/80 transition hover:bg-violet-500" :style="{ height: `${day.watchedMs ? Math.max(5, day.watchedMs / dailyMax * 100) : 0}%` }" :title="`${dayLabel(day.date)} · ${duration(day.watchedMs)}`"><span class="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted opacity-0 transition group-hover:opacity-100">{{ day.watchedMs ? duration(day.watchedMs) : '0 秒' }}</span></div></div><p class="truncate text-center text-[10px] text-muted">{{ dayLabel(day.date) }}</p></div></div><div v-else class="mt-6 grid h-44 place-items-center text-sm text-muted">开始播放后会显示每日记录</div></article>
      <article class="rounded-xl border border-line bg-surface p-5"><h3 class="font-semibold text-foreground">成长规则</h3><p class="mt-1 text-xs text-muted">实际播放时长累计经验</p><div class="mt-5 space-y-3"><div class="flex items-center justify-between rounded-lg bg-canvas p-3"><span class="text-sm text-muted">观看 10 秒</span><Badge>+1 XP</Badge></div><div class="flex items-center justify-between rounded-lg bg-canvas p-3"><span class="text-sm text-muted">升一级</span><Badge>100 XP</Badge></div><div class="rounded-lg bg-violet-500/10 p-3 text-xs leading-5 text-violet-700 dark:text-violet-200">暂停、切换到后台、加载或缓冲时不计时；视频拖动进度不增加完成度。</div></div></article>
    </section>

    <section class="mt-6 rounded-xl border border-line bg-surface p-5"><div class="flex items-center gap-2"><Award class="text-violet-500" :size="19" /><h3 class="font-semibold text-foreground">成就</h3></div><div class="mt-4 grid gap-3 md:grid-cols-3"><article v-for="achievement in achievements" :key="achievement.id" class="flex items-start gap-3 rounded-xl border p-4" :class="hasAchievement(achievement.id) ? 'border-violet-500/35 bg-violet-500/5' : 'border-line bg-canvas'"><div class="grid size-10 shrink-0 place-items-center rounded-lg" :class="hasAchievement(achievement.id) ? 'bg-violet-500/10 text-violet-500' : 'bg-surface text-muted'"><component :is="achievement.icon" :size="19" /></div><div class="min-w-0"><div class="flex items-center gap-2"><p class="font-medium text-foreground">{{ achievement.title }}</p><Badge v-if="hasAchievement(achievement.id)">已解锁</Badge></div><p class="mt-1 text-xs text-muted">{{ achievement.detail }}</p></div></article></div></section>
  </div>
</template>
