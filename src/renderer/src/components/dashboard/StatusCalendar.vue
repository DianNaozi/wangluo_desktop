<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const cursor = ref(new Date())
const weekLabels = ['一', '二', '三', '四', '五', '六', '日']
const monthLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(cursor.value))
const days = computed(() => {
  const year = cursor.value.getFullYear()
  const month = cursor.value.getMonth()
  const leading = (new Date(year, month, 1).getDay() + 6) % 7
  const total = new Date(year, month + 1, 0).getDate()
  const previousTotal = new Date(year, month, 0).getDate()
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - leading + 1
    if (day < 1) return { label: previousTotal + day, current: false, state: '' }
    if (day > total) return { label: day - total, current: false, state: '' }
    const state = day % 11 === 0 ? 'scan' : day % 7 === 0 ? 'import' : day % 5 === 0 ? 'organize' : ''
    return { label: day, current: true, state }
  })
})
function changeMonth(offset: number): void { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + offset, 1) }
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-4">
    <div class="flex items-center justify-between"><div><p class="text-sm font-semibold text-foreground">整理日历</p><p class="mt-0.5 text-xs text-muted">导入、扫描与整理记录</p></div><div class="flex gap-1"><button class="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground" @click="changeMonth(-1)"><ChevronLeft :size="16" /></button><button class="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground" @click="changeMonth(1)"><ChevronRight :size="16" /></button></div></div>
    <p class="mt-4 text-center text-sm font-medium text-foreground">{{ monthLabel }}</p>
    <div class="mt-3 grid grid-cols-7 gap-y-1 text-center"><span v-for="day in weekLabels" :key="day" class="text-[11px] text-muted">{{ day }}</span><div v-for="(day, index) in days" :key="index" :class="['relative mx-auto grid size-7 place-items-center rounded-md text-xs', day.current ? 'text-foreground hover:bg-surface-hover' : 'text-zinc-400', day.state === 'import' && 'bg-violet-500/15 text-violet-700 dark:text-violet-200', day.state === 'organize' && 'bg-amber-400/20 text-amber-700 dark:text-amber-300', day.state === 'scan' && 'bg-emerald-400/15 text-emerald-700 dark:text-emerald-300']">{{ day.label }}</div></div>
    <div class="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3 text-[11px] text-muted"><span class="inline-flex items-center gap-1.5"><i class="size-1.5 rounded-full bg-violet-500"></i>导入</span><span class="inline-flex items-center gap-1.5"><i class="size-1.5 rounded-full bg-amber-400"></i>整理</span><span class="inline-flex items-center gap-1.5"><i class="size-1.5 rounded-full bg-emerald-400"></i>扫描</span></div>
  </section>
</template>
