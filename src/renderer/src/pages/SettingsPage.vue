<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { FolderOpen, RefreshCw, Save, Sparkles } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import type { SmartFolderCoserSettings } from '../../../main/import/smart-folder-coser'

const resourcePath = ref('')
const savingResourcePath = ref(false)
const deleteSourcesAfterImport = ref(false)
const savingImportBehavior = ref(false)
const smartCoserSettings = ref<SmartFolderCoserSettings>({ enabled: false, baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' })
const smartCoserModels = ref<string[]>([])
const testingSmartCoser = ref(false)
const savingSmartCoser = ref(false)
const confirmDeleteSources = ref(false)
const notice = ref('')

function notify(message: string): void {
  notice.value = message
  window.setTimeout(() => { notice.value = '' }, 2200)
}
async function loadResourceDirectory(): Promise<void> {
  const directory = await window.api.settings.getResourceDirectory()
  resourcePath.value = directory.path
}
async function chooseResourceDirectory(): Promise<void> {
  const path = await window.api.settings.pickResourceDirectory()
  if (path) resourcePath.value = path
}
async function saveResourceDirectory(): Promise<void> {
  if (!resourcePath.value.trim()) return
  savingResourcePath.value = true
  try {
    const directory = await window.api.settings.setResourceDirectory(resourcePath.value)
    resourcePath.value = directory.path
    notify('资源目录已切换，之后导入的文件将保存到此目录')
  } catch (error) {
    notify(error instanceof Error ? error.message : '无法保存资源目录')
  } finally { savingResourcePath.value = false }
}
async function loadImportBehavior(): Promise<void> { deleteSourcesAfterImport.value = (await window.api.settings.getImportBehavior()).deleteSourcesAfterImport }
async function loadSmartCoserSettings(): Promise<void> { smartCoserSettings.value = await window.api.settings.getSmartCoserImport() }
async function saveSmartCoserSettings(): Promise<void> {
  savingSmartCoser.value = true
  try { smartCoserSettings.value = await window.api.settings.setSmartCoserImport({ ...smartCoserSettings.value }); notify(smartCoserSettings.value.enabled ? '智能 Coser 归类已启用' : '智能 Coser 归类已关闭') }
  catch (error) { notify(error instanceof Error ? error.message : '无法保存智能归类设置'); await loadSmartCoserSettings().catch(() => undefined) }
  finally { savingSmartCoser.value = false }
}
async function testSmartCoserConnection(): Promise<void> {
  testingSmartCoser.value = true
  try {
    const models = await window.api.settings.testSmartCoserImport(smartCoserSettings.value.baseUrl)
    smartCoserModels.value = models.map((model) => model.name)
    const selectedModelAvailable = smartCoserModels.value.includes(smartCoserSettings.value.model)
    notify(selectedModelAvailable ? `Ollama 已连接，可用模型 ${models.length} 个` : `Ollama 已连接，但未找到当前模型；可用模型 ${models.length} 个`)
  } catch (error) { notify(error instanceof Error ? error.message : '无法连接 Ollama') }
  finally { testingSmartCoser.value = false }
}
async function saveDeleteSourcesAfterImport(enabled: boolean): Promise<void> {
  savingImportBehavior.value = true
  try {
    deleteSourcesAfterImport.value = (await window.api.settings.setDeleteSourcesAfterImport(enabled)).deleteSourcesAfterImport
    notify(enabled ? '已启用：之后新建的导入任务会将成功源文件移入系统回收站' : '已关闭：之后新建的导入任务会保留源文件')
  } catch (error) { notify(error instanceof Error ? error.message : '无法保存导入设置') }
  finally { savingImportBehavior.value = false }
}
function requestDeleteSourcesChange(event: Event): void {
  if ((event.target as HTMLInputElement).checked) confirmDeleteSources.value = true
  else void saveDeleteSourcesAfterImport(false)
}
onMounted(() => { void Promise.all([loadResourceDirectory(), loadImportBehavior(), loadSmartCoserSettings()]).catch(() => notify('无法读取本地设置')) })
</script>

<template>
  <div class="mx-auto max-w-6xl p-6 lg:p-8">
    <div><h2 class="text-2xl font-semibold tracking-tight text-foreground">设置</h2><p class="mt-1.5 text-sm text-muted">管理资源存储位置和导入行为。</p></div>

    <section class="mx-auto mt-6 max-w-3xl space-y-5">
      <div class="space-y-5">
        <article class="rounded-xl border border-line bg-surface"><div class="border-b border-line px-5 py-4"><h3 class="font-semibold text-foreground">资源存储目录</h3><p class="mt-1 text-xs text-muted">导入的原始文件、缩略图、回收站和图库数据库都会存放在此目录下。</p></div><div class="p-5"><label class="text-xs font-medium text-muted">存储位置</label><div class="mt-2 flex gap-2"><input :value="resourcePath" readonly aria-label="选择资源存储目录" class="h-9 min-w-0 flex-1 cursor-pointer rounded-lg border border-line bg-canvas px-3 font-mono text-xs text-foreground outline-none focus:border-violet-500" placeholder="点击选择资源目录" @click="chooseResourceDirectory" @keydown.enter.prevent="chooseResourceDirectory" @keydown.space.prevent="chooseResourceDirectory" /><Button variant="outline" size="sm" @click="chooseResourceDirectory"><FolderOpen :size="15" />选择</Button><Button size="sm" :disabled="savingResourcePath" @click="saveResourceDirectory"><Save :size="15" />{{ savingResourcePath ? '保存中' : '保存' }}</Button></div><div class="mt-4 rounded-lg bg-canvas px-3 py-2.5 text-xs text-muted">仅空图库可以更改资源目录：已有媒体、图集、回收站记录或可恢复导入任务时，系统会拒绝切换；目标目录也必须为空。不会自动迁移已有资源。</div></div></article>

        <article class="rounded-xl border border-amber-500/25 bg-surface p-5"><div class="flex items-start justify-between gap-4"><div><h3 class="font-semibold text-foreground">导入后删除源文件</h3><p class="mt-1 text-xs leading-5 text-muted">仅对开启后新建的任务生效。媒体成功入库或确认去重后，源文件会移入 Windows 系统回收站；失败、跳过或发生变化的文件会保留。</p></div><input :checked="deleteSourcesAfterImport" :disabled="savingImportBehavior" type="checkbox" class="mt-1 size-4 shrink-0 accent-amber-500" aria-label="导入后删除源文件" @change="requestDeleteSourcesChange" /></div><p class="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">文件夹导入会同时清理成功回收后留下的空目录。此操作不会永久删除文件，可在系统回收站恢复。</p></article>

        <article class="rounded-xl border border-line bg-surface p-5">
          <div class="flex items-start justify-between gap-4"><div><div class="flex items-center gap-2"><Sparkles class="text-violet-500" :size="18" /><h3 class="font-semibold text-foreground">智能 Coser 归类</h3></div><p class="mt-1 text-xs leading-5 text-muted">明确匹配的名称自动归类；模型建议和新名字由你确认。识别只把文件夹名和父目录名发送给本机 Ollama。</p></div><input v-model="smartCoserSettings.enabled" :disabled="savingSmartCoser" type="checkbox" class="mt-1 size-4 shrink-0 accent-violet-500" aria-label="启用智能 Coser 归类" @change="saveSmartCoserSettings" /></div>
          <div class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(190px,.8fr)]">
            <label class="text-xs font-medium text-muted">本机 Ollama 地址<input v-model.trim="smartCoserSettings.baseUrl" :disabled="savingSmartCoser" class="mt-1.5 h-9 w-full rounded-lg border border-line bg-canvas px-3 font-mono text-xs text-foreground outline-none focus:border-violet-500" @change="saveSmartCoserSettings" /></label>
            <label class="text-xs font-medium text-muted">使用模型<select v-model="smartCoserSettings.model" :disabled="savingSmartCoser" class="mt-1.5 h-9 w-full rounded-lg border border-line bg-canvas px-3 text-xs text-foreground outline-none focus:border-violet-500" @change="saveSmartCoserSettings"><option v-if="!smartCoserModels.includes(smartCoserSettings.model)" :value="smartCoserSettings.model">{{ smartCoserSettings.model }} · 尚未检测</option><option v-for="model in smartCoserModels" :key="model" :value="model">{{ model }}</option></select></label>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" :disabled="testingSmartCoser || savingSmartCoser" @click="testSmartCoserConnection"><RefreshCw :size="14" :class="testingSmartCoser && 'animate-spin'" />{{ testingSmartCoser ? '正在检测…' : '检测连接并读取模型' }}</Button><span class="text-xs text-muted">默认使用 qwen2.5:7b；改动设置后，新导入任务生效。</span></div>
        </article>

      </div>
    </section>

    <ConfirmDialog :open="confirmDeleteSources" title="启用源文件回收" description="之后新建的导入任务在媒体成功入库后，会将源文件移入 Windows 系统回收站。失败、跳过或被修改的文件不会处理；已创建的任务不受影响。" confirm-text="启用" destructive @update:open="(open) => { if (!open) confirmDeleteSources = false }" @confirm="() => { confirmDeleteSources = false; void saveDeleteSourcesAfterImport(true) }" />
    <div v-if="notice" class="fixed bottom-12 right-5 z-50 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-foreground shadow-xl">{{ notice }}</div>
  </div>
</template>
