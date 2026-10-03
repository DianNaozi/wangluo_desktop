<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Check, LoaderCircle, Sparkles, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { normalizeCoserText, type SmartCoserIndexItem, type SmartFolderImportDecision, type SmartFolderImportSession } from '../../../../main/import/smart-folder-coser'

const props = defineProps<{ sessions: SmartFolderImportSession[]; cosers: SmartCoserIndexItem[]; errors?: Record<string, string> }>()
const emit = defineEmits<{ resolve: [sessionId: string, decisions: SmartFolderImportDecision[]]; cancel: [sessionId: string] }>()
type Draft = { action: string; newName: string; saveAlias: boolean; alias: string; suggestedAlias: string }
const drafts = reactive<Record<string, Draft>>({})
const active = computed(() => props.sessions.find((session) => session.items.some((item) => ['matching', 'review', 'committing'].includes(item.status))))
const readyItems = computed(() => active.value?.items.filter((item) => item.status === 'review') ?? [])
const isWorking = computed(() => Boolean(active.value?.items.some((item) => ['matching', 'committing'].includes(item.status))))
const isCommitting = computed(() => Boolean(active.value?.items.some((item) => item.status === 'committing')))

watch(() => [props.sessions.map((session) => session.items.map((item) => `${item.id}:${item.status}:${item.evidence}:${item.proposedName}:${item.recommendedCoserId}`).join('|')).join(';'), props.cosers.map((coser) => `${coser.id}:${coser.name}`).join('|')], () => {
  for (const session of props.sessions) for (const item of session.items) {
    if (item.status !== 'review') continue
    const suggestedAlias = item.proposedName || item.evidence
    const recommendedCoser = props.cosers.find((coser) => coser.id === item.recommendedCoserId)
    const safeAlias = recommendedCoser && normalizeCoserText(recommendedCoser.name) === normalizeCoserText(suggestedAlias) ? '' : suggestedAlias
    const draft = drafts[item.id]
    if (!draft) {
      drafts[item.id] = { action: item.proposedName ? 'create' : item.recommendedCoserId ?? 'library', newName: item.proposedName, saveAlias: false, alias: safeAlias, suggestedAlias: safeAlias }
    } else if (!draft.saveAlias && draft.alias === draft.suggestedAlias) {
      draft.alias = safeAlias
      draft.suggestedAlias = safeAlias
    }
  }
}, { immediate: true })

function submit(): void {
  const session = active.value
  if (!session || !readyItems.value.length) return
  const decisions: SmartFolderImportDecision[] = readyItems.value.map((item) => {
    const draft = drafts[item.id]!
    if (draft.action === 'skip') return { itemId: item.id, action: 'skip' }
    if (draft.action === 'library') return { itemId: item.id, action: 'library' }
    if (draft.action === 'create') return { itemId: item.id, action: 'create', newName: draft.newName.trim() }
    return { itemId: item.id, action: 'assign', coserId: draft.action, saveAlias: draft.saveAlias, alias: draft.alias.trim() }
  })
  emit('resolve', session.id, decisions)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="fixed inset-0 z-[110] grid place-items-center bg-zinc-950/55 p-4 backdrop-blur-sm" role="presentation">
      <section class="max-h-[min(82vh,850px)] w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="smart-folder-import-title">
        <header class="flex items-start justify-between border-b border-line px-5 py-4">
          <div><div class="flex items-center gap-2"><Sparkles class="text-violet-500" :size="18" /><h2 id="smart-folder-import-title" class="font-semibold text-foreground">确认文件夹归类</h2></div><p class="mt-1 text-sm text-muted">明确匹配的文件夹已经加入导入队列；请检查模型建议和新 Coser。</p></div>
          <button :disabled="isCommitting" class="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50" aria-label="取消尚未提交的文件夹" title="取消尚未提交的文件夹" @click="emit('cancel', active.id)"><X :size="17" /></button>
        </header>

        <div class="max-h-[58vh] space-y-3 overflow-auto p-4 sm:p-5">
          <p v-if="errors?.[active.id]" class="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600" role="alert">{{ errors[active.id] }}</p>
          <div v-if="isWorking" class="flex items-center gap-2 rounded-lg bg-violet-500/10 px-3 py-2.5 text-sm text-violet-700 dark:text-violet-200"><LoaderCircle class="animate-spin" :size="16" />正在逐个检查文件夹名称；明确的匹配已经开始导入。</div>
          <article v-for="item in active.items" :key="item.id" class="rounded-xl border border-line bg-canvas p-3.5">
            <div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><p class="truncate text-sm font-medium text-foreground" :title="item.sourceName">{{ item.sourceName }}</p><p class="mt-0.5 truncate text-xs text-muted" :title="item.parentName">父目录：{{ item.parentName }}</p></div><span :class="['rounded-full px-2 py-1 text-[11px]', item.status === 'imported' ? 'bg-emerald-500/10 text-emerald-600' : item.status === 'skipped' ? 'bg-zinc-500/10 text-muted' : ['queued', 'committing'].includes(item.status) ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'bg-violet-500/10 text-violet-600 dark:text-violet-300']">{{ item.status === 'matching' ? '识别中' : ['queued', 'committing'].includes(item.status) ? '正在提交' : item.status === 'imported' ? '已提交' : item.status === 'skipped' ? '已跳过' : '待确认' }}</span></div>
            <p class="mt-2 text-xs leading-5 text-muted">{{ item.reason }}<span v-if="item.evidence"> · 依据：“{{ item.evidence }}”</span></p>
            <div v-if="item.status === 'review'" class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,.8fr)]">
              <label class="text-xs font-medium text-muted">归类到<select v-model="drafts[item.id]!.action" class="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs text-foreground outline-none focus:border-violet-500"><option value="library">按原位置导入媒体库</option><option value="create">新建 Coser</option><option value="skip">跳过此文件夹</option><option v-for="coser in cosers" :key="coser.id" :value="coser.id">{{ coser.name }}</option></select></label>
              <label v-if="drafts[item.id]!.action === 'create'" class="text-xs font-medium text-muted">确认新 Coser 名称<input v-model.trim="drafts[item.id]!.newName" maxlength="80" class="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground outline-none focus:border-violet-500" placeholder="输入 Coser 名称" /></label>
              <div v-if="!['library', 'create', 'skip'].includes(drafts[item.id]!.action)" class="sm:col-span-2">
                <label class="flex items-center gap-2 text-xs text-muted"><input v-model="drafts[item.id]!.saveAlias" type="checkbox" class="size-4 accent-violet-500" />确认后把识别名称记作此 Coser 的别名</label>
                <label v-if="drafts[item.id]!.saveAlias" class="mt-2 block text-xs font-medium text-muted">要记住的别名<input v-model.trim="drafts[item.id]!.alias" maxlength="80" class="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground outline-none focus:border-violet-500" :placeholder="item.proposedName || item.evidence || '输入完整别名'" /></label>
              </div>
            </div>
          </article>
        </div>

        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4"><p class="text-xs text-muted">{{ readyItems.length ? `待处理 ${readyItems.length} 个文件夹` : '等待模型判断剩余文件夹' }}</p><div class="flex gap-2"><Button variant="outline" :disabled="isCommitting" @click="emit('cancel', active.id)">取消待处理项</Button><Button :disabled="!readyItems.length || isCommitting" @click="submit"><Check :size="15" />确认并导入 {{ readyItems.length }} 个</Button></div></footer>
      </section>
    </div>
  </Teleport>
</template>
