<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, CheckCircle2, Database, EyeOff, FolderOpen, FolderSearch, HardDrive, MapPin, Plus, RefreshCw, Save, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'

type SourceFolder = { id: string; name: string; path: string; count: number; status: 'ready' | 'offline' }

const sources = ref<SourceFolder[]>([
  { id: 'source-1', name: '写真收藏', path: 'D:\\Gallery\\Portraits', count: 286, status: 'ready' },
  { id: 'source-2', name: '漫展记录', path: 'E:\\Cosplay\\Events', count: 135, status: 'ready' },
  { id: 'source-3', name: '移动硬盘备份', path: 'F:\\Archive\\2025', count: 74, status: 'offline' }
])
const cachePath = ref('C:\\Users\\yxht\\AppData\\Local\\幻视图库\\thumbnails')
const hideCovers = ref(false)
const hideNames = ref(false)
const addDialog = ref(false)
const folderPath = ref('')
const notice = ref('')
const scanProgress = ref(72)
const indexedTotal = computed(() => sources.value.filter((source) => source.status === 'ready').reduce((sum, source) => sum + source.count, 0))

function notify(message: string): void {
  notice.value = message
  window.setTimeout(() => { notice.value = '' }, 2200)
}
function addSource(): void {
  const path = folderPath.value.trim()
  if (!path) return
  sources.value.unshift({ id: `source-${Date.now()}`, name: path.split('\\').filter(Boolean).at(-1) ?? '新建目录', path, count: 0, status: 'ready' })
  folderPath.value = ''
  addDialog.value = false
  notify('已添加目录，等待后续扫描功能接入')
}
function removeSource(id: string): void { sources.value = sources.value.filter((source) => source.id !== id); notify('已从图库移除该目录，不会删除原始文件') }
</script>

<template>
  <div class="mx-auto max-w-6xl p-6 lg:p-8">
    <div><h2 class="text-2xl font-semibold tracking-tight text-foreground">设置</h2><p class="mt-1.5 text-sm text-muted">管理本地目录、缓存、索引任务与隐私显示方式。</p></div>

    <section class="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.75fr)]">
      <div class="space-y-5">
        <article class="rounded-xl border border-line bg-surface"><div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h3 class="font-semibold text-foreground">本地导入目录</h3><p class="mt-1 text-xs text-muted">图库只建立索引，不会移动或删除你的原始文件。</p></div><Button size="sm" @click="addDialog = true"><Plus :size="16" />添加目录</Button></div><div class="divide-y divide-line"><div v-for="source in sources" :key="source.id" class="group flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-violet-500/[0.045] dark:hover:bg-violet-500/[0.08]"><div class="grid size-9 shrink-0 place-items-center rounded-lg transition-transform duration-150 group-hover:scale-105" :class="source.status === 'ready' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'"><FolderOpen :size="18" /></div><div class="min-w-0 flex-1"><div class="flex items-center gap-2"><p class="truncate text-sm font-medium text-foreground transition-colors group-hover:text-violet-700 dark:group-hover:text-violet-200">{{ source.name }}</p><Badge v-if="source.status === 'offline'" class="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300">已断开</Badge></div><p class="mt-0.5 truncate font-mono text-[11px] text-muted">{{ source.path }}</p></div><div class="hidden text-right sm:block"><p class="text-sm font-medium text-foreground">{{ source.count }}</p><p class="mt-0.5 text-[11px] text-muted">已索引媒体</p></div><div class="flex items-center gap-1 opacity-60 transition-opacity duration-150 group-hover:opacity-100"><button v-if="source.status === 'offline'" class="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground" title="重新定位目录" @click="notify('重新定位目录功能将在扫描模块接入后启用')"><FolderSearch :size="16" /></button><button class="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-rose-500/10 hover:text-rose-600" title="移除目录" @click="removeSource(source.id)"><Trash2 :size="16" /></button></div></div></div></article>

        <article class="rounded-xl border border-line bg-surface"><div class="border-b border-line px-5 py-4"><h3 class="font-semibold text-foreground">缩略图缓存</h3><p class="mt-1 text-xs text-muted">缩略图与视频封面会保存在此位置，可随时清理并重新生成。</p></div><div class="p-5"><label class="text-xs font-medium text-muted">缓存位置</label><div class="mt-2 flex gap-2"><input v-model="cachePath" class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 font-mono text-xs text-foreground outline-none focus:border-violet-500" /><Button variant="outline" size="sm" @click="notify('缓存位置已保存')"><Save :size="15" />保存</Button></div><div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-canvas px-3 py-2.5 text-xs transition-colors hover:bg-surface-hover"><span class="text-muted">当前缓存占用 <strong class="font-medium text-foreground">682 MB</strong></span><button class="text-violet-600 transition hover:text-violet-700 dark:text-violet-300" @click="notify('缩略图缓存清理功能将在本地扫描接入后启用')">清理缓存</button></div></div></article>

        <article class="rounded-xl border border-line bg-surface"><div class="border-b border-line px-5 py-4"><h3 class="font-semibold text-foreground">数据库备份与恢复</h3><p class="mt-1 text-xs text-muted">备份图集、Coser、标签和本地索引关系，不包含原始媒体文件。</p></div><div class="flex flex-wrap gap-2 p-5"><Button variant="outline" size="sm" @click="notify('数据库备份功能将在 SQLite 接入后启用')"><Database :size="16" />创建备份</Button><Button variant="outline" size="sm" @click="notify('数据库恢复功能将在 SQLite 接入后启用')"><RefreshCw :size="16" />从备份恢复</Button></div></article>
      </div>

      <div class="space-y-5">
        <article class="rounded-xl border border-line bg-surface p-5"><div class="flex items-center gap-2"><HardDrive class="text-violet-500" :size="18" /><h3 class="font-semibold text-foreground">后台任务</h3></div><div class="mt-5 rounded-lg bg-canvas p-3"><div class="flex items-center justify-between text-xs"><span class="text-muted">索引与缩略图生成</span><span class="font-medium text-foreground">{{ scanProgress }}%</span></div><div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-violet-500" :style="{ width: `${scanProgress}%` }"></div></div><p class="mt-3 text-xs leading-5 text-muted">已准备 {{ indexedTotal }} 项媒体。真实后台扫描将在本地索引功能接入后开始。</p></div></article>
        <article class="rounded-xl border border-line bg-surface p-5"><div class="flex items-center gap-2"><EyeOff class="text-violet-500" :size="18" /><h3 class="font-semibold text-foreground">隐私显示</h3></div><p class="mt-2 text-xs leading-5 text-muted">这些选项只影响应用中的视觉展示，不会修改原始文件。</p><label class="mt-5 flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-canvas"><span><span class="block text-sm font-medium text-foreground">隐藏封面预览</span><span class="mt-0.5 block text-xs text-muted">在图集和媒体网格中使用中性占位</span></span><input v-model="hideCovers" type="checkbox" class="size-4 accent-violet-500" /></label><label class="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-canvas"><span><span class="block text-sm font-medium text-foreground">隐藏文件名</span><span class="mt-0.5 block text-xs text-muted">预览面板外不显示媒体文件名</span></span><input v-model="hideNames" type="checkbox" class="size-4 accent-violet-500" /></label></article>
        <article class="rounded-xl border border-line bg-surface p-5"><div class="flex items-center gap-2"><MapPin class="text-violet-500" :size="18" /><h3 class="font-semibold text-foreground">来源状态</h3></div><div class="mt-4 flex gap-3 rounded-lg bg-amber-500/8 p-3"><AlertTriangle class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" :size="16" /><p class="text-xs leading-5 text-muted">检测到 1 个外接磁盘目录未连接。重新接入磁盘后，可在目录列表中重新定位。</p></div><div class="mt-3 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 :size="15" />其余目录状态正常</div></article>
      </div>
    </section>

    <div v-if="addDialog" class="fixed inset-0 z-40 grid place-items-center bg-zinc-950/45 p-5 backdrop-blur-sm" @click.self="addDialog = false"><div class="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-2xl"><div class="flex items-center justify-between"><h3 class="font-semibold text-foreground">添加本地目录</h3><button class="text-muted" @click="addDialog = false">×</button></div><p class="mt-2 text-sm text-muted">输入将要建立索引的本地文件夹路径。</p><input v-model="folderPath" class="mt-5 h-10 w-full rounded-lg border border-line bg-canvas px-3 font-mono text-sm text-foreground outline-none focus:border-violet-500" placeholder="例如 D:\\Gallery\\2026" @keydown.enter="addSource" /><div class="mt-5 flex justify-end gap-2"><Button variant="outline" @click="addDialog = false">取消</Button><Button @click="addSource">添加目录</Button></div></div></div>
    <div v-if="notice" class="fixed bottom-12 right-5 z-50 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-foreground shadow-xl">{{ notice }}</div>
  </div>
</template>
