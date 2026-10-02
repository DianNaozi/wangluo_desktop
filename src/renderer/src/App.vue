<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { Archive, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, FolderInput, HardDrive, Image, Layers3, LoaderCircle, Moon, Search, Settings, Sun, Tag, UserRound, Clock3 } from 'lucide-vue-next'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import { useAppStore } from '@/stores/app'
import { useLibraryStore } from '@/stores/library'
import { useImportStore } from '@/stores/imports'
import { useCoserAssignmentStore } from '@/stores/coser-assignment'
import PlaybackController from '@/components/playback/PlaybackController.vue'
import FolderTree from '@/components/folders/FolderTree.vue'
import { importProgress } from '@/utils/import-feedback'
import { reportStartupStage } from '@/utils/startup-performance'

const app = useAppStore()
const library = useLibraryStore()
const imports = useImportStore()
const assignment = useCoserAssignmentStore()
const route = useRoute()
const appVersion = ref('—')
const resizing = ref(false)
const externalDropActive = ref(false)
type DropImportDestination = { type: 'library' } | { type: 'folder'; folderId: string } | { type: 'coser'; coserId: string }

const dropDestinationLabel = computed(() => {
  if (route.name === 'folder-detail') return '当前文件夹'
  if (route.name === 'cosers' && typeof route.query.coser === 'string' && route.query.coser) return '当前 Coser'
  return '媒体库'
})

function hasExternalFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function resolveDropDestination(): DropImportDestination {
  if (route.name === 'folder-detail' && typeof route.params.id === 'string') return { type: 'folder', folderId: route.params.id }
  if (route.name === 'cosers' && typeof route.query.coser === 'string' && route.query.coser) return { type: 'coser', coserId: route.query.coser }
  return { type: 'library' }
}

function handleExternalDragEnter(event: DragEvent): void {
  if (!hasExternalFiles(event)) return
  event.preventDefault()
  externalDropActive.value = true
}

function handleExternalDragOver(event: DragEvent): void {
  if (!hasExternalFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  externalDropActive.value = true
}

function handleExternalDragLeave(event: DragEvent): void {
  if (!hasExternalFiles(event)) return
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && document.documentElement.contains(nextTarget)) return
  externalDropActive.value = false
}

function handleExternalDrop(event: DragEvent): void {
  if (!hasExternalFiles(event)) return
  event.preventDefault()
  event.stopPropagation()
  externalDropActive.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) void imports.importDroppedFolders(files, resolveDropDestination())
}

function clearExternalDrop(): void { externalDropActive.value = false }
function handleCanceledExternalDrag(event: KeyboardEvent): void { if (event.key === 'Escape') clearExternalDrop() }

onMounted(() => {
  reportStartupStage('renderer mounted')
  void imports.refresh()
  void window.api.app.getVersion().then((version) => { appVersion.value = version })
  window.addEventListener('dragenter', handleExternalDragEnter, true)
  window.addEventListener('dragover', handleExternalDragOver, true)
  window.addEventListener('dragleave', handleExternalDragLeave, true)
  window.addEventListener('drop', handleExternalDrop, true)
  window.addEventListener('keydown', handleCanceledExternalDrag, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragenter', handleExternalDragEnter, true)
  window.removeEventListener('dragover', handleExternalDragOver, true)
  window.removeEventListener('dragleave', handleExternalDragLeave, true)
  window.removeEventListener('drop', handleExternalDrop, true)
  window.removeEventListener('keydown', handleCanceledExternalDrag, true)
})

const navigation = [
  { to: '/', label: '首页', icon: Archive },
  { to: '/library', label: '媒体库', icon: Image },
  { to: '/cosers', label: 'Coser', icon: UserRound },
  { to: '/tags', label: '标签', icon: Tag },
  { to: '/timeline', label: '时间轴', icon: Clock3 },
  { to: '/statistics', label: '统计数据', icon: BarChart3 },
  { to: '/storage', label: '存储空间', icon: HardDrive },
  
]
const title = computed(() => String(route.meta.title ?? '幻视图库'))
const showGlobalSearch = computed(() => route.name === 'home' || route.name === 'library')
const showFolderTree = computed(() => route.name === 'library' || route.name === 'folder-detail')

function startResize(event: PointerEvent): void {
  if (app.sidebarCollapsed) return
  resizing.value = true
  const move = (moveEvent: PointerEvent): void => app.setSidebarWidth(moveEvent.clientX)
  const end = (): void => {
    resizing.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end, { once: true })
  event.preventDefault()
}
</script>

<template>
  <div class="relative flex h-screen flex-col overflow-hidden bg-canvas">
    <header class="flex h-16 shrink-0 items-center gap-5 border-b border-line bg-surface px-5 lg:px-7">
      <div class="flex shrink-0 items-center gap-2.5">
        <div class="grid size-9 place-items-center rounded-xl border border-violet-200 bg-violet-50 shadow-sm dark:border-violet-500/20 dark:bg-violet-500/10"><Layers3 class="text-violet-600 dark:text-violet-300" :size="19" :stroke-width="2.1" /></div>
        <div><p class="text-sm font-semibold tracking-tight text-foreground">幻视图库</p><p class="text-[11px] text-muted">Local gallery</p></div>
      </div>
      <span class="hidden h-7 w-px bg-line sm:block"></span>
      <div class="flex min-w-0 flex-1 items-center gap-4">
        <h1 class="min-w-16 text-base font-semibold text-foreground">{{ title }}</h1>
        <div v-if="showGlobalSearch" class="relative mx-auto w-full max-w-2xl flex-1"><Search class="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" :size="18" /><Input v-model="library.searchQuery" class="h-10 rounded-xl border-line bg-canvas pl-10 shadow-none focus-visible:ring-violet-500/20" placeholder="搜索图集、Coser、标签或文件名" /></div>
        <div v-else class="flex-1"></div>
        <div class="flex shrink-0 items-center gap-2"><PlaybackController /><button class="grid size-9 place-items-center rounded-xl text-muted transition hover:bg-surface-hover hover:text-foreground" :title="app.theme === 'dark' ? '切换到亮色主题' : '切换到深色主题'" @click="app.toggleTheme"><Sun v-if="app.theme === 'dark'" :size="17" /><Moon v-else :size="17" /></button><Badge class="hidden sm:inline-flex">本地模式</Badge></div>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <aside :class="['relative flex shrink-0 flex-col border-r border-line bg-surface', !resizing && 'transition-[width] duration-200']" :style="{ width: `${app.sidebarCollapsed ? 72 : app.sidebarWidth}px` }">
        <nav class="flex-1 space-y-0.5 px-2 py-3">
          <RouterLink v-for="item in navigation" :key="item.to" :to="item.to" :title="item.label" :class="['group relative flex h-9 items-center rounded-md text-sm transition-colors', app.sidebarCollapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5', route.path === item.to ? 'bg-violet-500/12 font-medium text-violet-700 dark:text-violet-200' : 'text-muted hover:bg-surface-hover hover:text-foreground']"><span v-if="route.path === item.to" class="absolute inset-y-2 left-0 w-0.5 rounded-full bg-violet-500"></span><component :is="item.icon" :size="18" :stroke-width="route.path === item.to ? 2.3 : 1.9" /><span v-if="!app.sidebarCollapsed">{{ item.label }}</span></RouterLink>
        </nav>
        <div class="border-t border-line p-2"><RouterLink to="/settings" title="设置" :class="['flex h-9 items-center rounded-md text-sm text-muted hover:bg-surface-hover hover:text-foreground', app.sidebarCollapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5']"><Settings :size="18" /><span v-if="!app.sidebarCollapsed">设置</span></RouterLink><button class="mt-0.5 flex h-8 w-full items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground" @click="app.toggleSidebar"><ChevronRight v-if="app.sidebarCollapsed" :size="17" /><ChevronLeft v-else :size="17" /></button></div>
        <div class="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize" @pointerdown="startResize"><span class="absolute inset-y-0 left-1/2 w-px bg-transparent hover:bg-violet-400" /></div>
      </aside>

      <main class="flex min-w-0 flex-1 flex-col"><section :class="['min-h-0 flex-1', showFolderTree ? 'overflow-hidden' : 'overflow-auto']"><div v-if="showFolderTree" class="flex h-full min-w-0"><FolderTree /><div class="min-w-0 flex-1 overflow-auto"><RouterView /></div></div><RouterView v-else /></section><footer class="flex h-9 shrink-0 items-center justify-between border-t border-line px-5 text-xs text-muted"><span>原文件从不移动或删除</span><span>桌面端 v{{ appVersion }}</span></footer></main>
    </div>
    <div class="absolute bottom-12 right-5 z-50 flex w-[min(360px,calc(100vw-2.5rem))] flex-col-reverse gap-3" aria-live="polite">
      <section v-if="imports.droppedFolderScans" class="rounded-xl border border-violet-500/30 bg-surface-raised p-3.5 text-sm text-foreground shadow-xl">
        <div class="flex items-center gap-2"><LoaderCircle class="animate-spin text-violet-500" :size="17" /><p>正在扫描拖入的文件夹，扫描完成后会自动加入导入队列…</p></div>
      </section>
      <section v-if="imports.droppedFolderError" class="rounded-xl border border-rose-500/30 bg-surface-raised p-3.5 text-sm text-rose-600 shadow-xl" role="alert">
        <p>{{ imports.droppedFolderError }}</p>
        <button class="mt-2 text-xs text-muted hover:text-foreground" @click="imports.dismissDroppedFolderError">关闭</button>
      </section>
      <section v-if="assignment.notice || assignment.error" class="rounded-xl border border-line bg-surface-raised p-3.5 text-sm shadow-xl">
        <p>{{ assignment.notice }}</p>
        <p v-if="assignment.error" role="alert" class="mt-1 text-rose-500">{{ assignment.error }}</p>
        <div class="mt-2 flex gap-4"><button v-if="assignment.operationId" :disabled="assignment.busy" class="text-accent disabled:opacity-50" @click="assignment.undo">{{ assignment.busy ? '处理中…' : '撤销' }}</button><button :disabled="assignment.busy" class="text-muted" @click="assignment.notice = ''; assignment.error = ''">关闭</button></div>
      </section>
      <section v-if="imports.activeJob" class="rounded-xl border border-line bg-surface-raised p-3.5 text-xs text-muted shadow-2xl">
        <div class="flex items-center gap-2"><LoaderCircle class="shrink-0 animate-spin text-violet-500" :size="17" /><div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-3"><p class="font-medium text-foreground">{{ imports.activeJob.status === 'running' ? '正在导入媒体' : '等待导入开始' }}</p><span class="shrink-0 text-violet-600 dark:text-violet-300">{{ importProgress(imports.activeJob) }}%</span></div><p class="mt-1">已处理 {{ Math.min(imports.activeJob.totalEntries, imports.activeJob.processedEntries + imports.activeJob.skippedEntries) }} / {{ imports.activeJob.totalEntries }} 项<span v-if="imports.queuedJobCount"> · 另有 {{ imports.queuedJobCount }} 个任务排队</span></p></div></div>
        <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-violet-500 transition-[width] duration-200" :style="{ width: `${importProgress(imports.activeJob)}%` }" /></div>
        <p class="mt-2 text-[11px]">新增 {{ imports.activeJob.importedEntries }} · 去重 {{ imports.activeJob.duplicateEntries }}<span v-if="imports.activeJob.failedEntries"> · 失败 {{ imports.activeJob.failedEntries }}</span></p>
      </section>
      <section v-for="notice in imports.completionNotices" :key="notice.id" :class="['rounded-xl border p-3.5 text-xs shadow-2xl', notice.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-100']">
        <div class="flex items-start gap-2"><CheckCircle2 v-if="notice.tone === 'success'" class="mt-0.5 shrink-0" :size="17" /><CircleAlert v-else class="mt-0.5 shrink-0" :size="17" /><div class="min-w-0"><p class="font-medium">{{ notice.title }}</p><p class="mt-1 leading-5 opacity-85">{{ notice.detail }}</p></div></div>
      </section>
    </div>
    <div v-if="externalDropActive" class="pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-violet-500/10 p-6 backdrop-blur-[1px]">
      <div class="w-full max-w-lg rounded-2xl border-2 border-dashed border-violet-500 bg-surface/95 px-8 py-10 text-center shadow-2xl">
        <FolderInput class="mx-auto text-violet-500" :size="36" />
        <p class="mt-4 text-lg font-semibold text-foreground">松开导入至{{ dropDestinationLabel }}</p>
        <p class="mt-2 text-sm text-muted">每个文件夹会创建一个图集，子文件夹中的媒体会合并导入</p>
      </div>
    </div>
  </div>
</template>
