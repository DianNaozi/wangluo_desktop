<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { CheckCircle2, FileWarning, FolderInput, LoaderCircle, RefreshCw, Upload } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { useImportStore } from '@/stores/imports'

const imports = useImportStore()
onMounted(() => { void imports.refresh() })
const shownJobs = computed(() => imports.jobs.slice(0, 5))
const formatSize = (bytes: number): string => bytes < 1024 * 1024 ? `${Math.max(0, Math.round(bytes / 1024))} KB` : bytes < 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
const statusText: Record<ImportJobStatus, string> = { planned: '已规划', queued: '等待执行', running: '导入中', completed: '已完成', partial_failed: '部分失败', interrupted: '已中断' }
function progress(job: ImportJobSummary): number { return job.totalEntries ? Math.round((job.processedEntries + job.skippedEntries) / job.totalEntries * 100) : 100 }
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-5">
    <div class="flex flex-wrap items-start justify-between gap-4"><div><div class="flex items-center gap-2"><Upload class="text-violet-500" :size="19" /><h3 class="font-semibold text-foreground">导入本地媒体</h3></div><p class="mt-1 text-sm text-muted">先扫描并建立任务清单，随后自动复制到受管图库。压缩包暂不支持。</p></div><div class="flex flex-wrap gap-2"><Button variant="outline" size="sm" @click="imports.importFiles"><Upload :size="15" />选择文件</Button><Button size="sm" @click="imports.importFolders"><FolderInput :size="15" />选择文件夹</Button></div></div>
    <p v-if="imports.error" class="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{{ imports.error }}</p>
    <div v-if="shownJobs.length" class="mt-5 divide-y divide-line rounded-xl border border-line"><article v-for="job in shownJobs" :key="job.id" class="px-3.5 py-3"><div class="flex items-center gap-3"><LoaderCircle v-if="job.status === 'running' || job.status === 'queued' || job.status === 'planned'" class="shrink-0 animate-spin text-violet-500" :size="17" /><CheckCircle2 v-else-if="job.status === 'completed'" class="shrink-0 text-emerald-500" :size="17" /><FileWarning v-else class="shrink-0 text-amber-500" :size="17" /><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><p class="text-sm font-medium text-foreground">{{ statusText[job.status] }}</p><span class="text-xs text-muted">{{ job.totalEntries }} 项 · {{ formatSize(job.totalBytes) }}</span></div><div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-violet-500 transition-[width]" :style="{ width: `${progress(job)}%` }" /></div><p class="mt-1.5 text-xs text-muted">新增 {{ job.importedEntries }} · 去重 {{ job.duplicateEntries }} · 跳过 {{ job.skippedEntries }}<span v-if="job.failedEntries"> · 失败 {{ job.failedEntries }}</span></p></div><button v-if="job.status === 'interrupted' || job.status === 'partial_failed'" class="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground" title="重试" @click="imports.retryJob(job.id)"><RefreshCw :size="15" /></button></div></article></div>
    <p v-else class="mt-5 rounded-xl border border-dashed border-line bg-canvas px-4 py-7 text-center text-sm text-muted">选择文件或文件夹以创建第一个导入任务。</p>
  </section>
</template>
