<script setup lang="ts">
import { ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import AssignCoserDialog from './AssignCoserDialog.vue'
import CoserDialog from './CoserDialog.vue'
import { useCoserAssignmentStore } from '@/stores/coser-assignment'
import { useCoserBrowseStore } from '@/stores/coser-browse'
const props = withDefaults(defineProps<{ selectedIds: Set<string>; kind?: 'album' | 'video'; disabled?: boolean }>(), { kind: 'album', disabled: false })
const emit = defineEmits<{ clear: []; all: [] }>()
const store = useCoserAssignmentStore()
const coserBrowse = useCoserBrowseStore()
const open = ref(false); const creating = ref(false); const busy = ref(false); const error = ref('')
const cosers = ref<CoserSummary[]>([]); const targets = ref<string[]>([]); const chosen = ref('')
async function show(ids: string[]) {
  if (busy.value || store.busy || !ids.length) return
  busy.value = true; error.value = ''; targets.value = [...ids]; chosen.value = ''
  try { cosers.value = await window.api.library.getCosers(); open.value = true }
  catch (reason) { store.error = `无法加载 Coser：${String(reason)}` }
  finally { busy.value = false }
}
async function assign(id: string) {
  const coser = cosers.value.find(item => item.id === id)
  if (!coser || busy.value) return
  busy.value = true; error.value = ''
  try { await store.assign(targets.value, coser, props.kind) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); busy.value = false; return }
  open.value = false; targets.value = []; emit('clear'); busy.value = false
  await store.refresh()
}
function beginCreate() { open.value = false; creating.value = true; error.value = '' }
function returnToPicker(value: boolean) { creating.value = value; if (!value) { error.value = ''; open.value = true } }
async function create(value: { name: string; aliases: string[] }) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { const coser = await window.api.library.createCoser(value.name, value.aliases); coserBrowse.rememberCoserSummary(coser); cosers.value.push(coser); chosen.value = coser.id; creating.value = false; open.value = true }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { busy.value = false }
}
defineExpose({ show })
</script>
<template>
  <div v-if="selectedIds.size" class="sticky bottom-0 z-20 mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-lg" role="toolbar" :aria-label="kind === 'video' ? '批量整理视频' : '批量整理图集'">
    <span class="mr-auto text-sm">已选 {{ selectedIds.size }} 个{{ kind === 'video' ? '媒体' : '图集' }}</span>
    <Button variant="outline" :disabled="busy || store.busy" @click="emit('all')">全选</Button>
    <span v-if="disabled" class="text-xs text-muted">仅支持散落视频，请取消选择图片。</span>
    <Button :disabled="busy || store.busy || disabled" @click="show([...props.selectedIds])">归入 Coser</Button>
    <Button variant="outline" :disabled="busy" @click="emit('clear')">取消</Button>
  </div>
  <AssignCoserDialog v-model:open="open" v-model:selected-id="chosen" :cosers="cosers" :album-count="targets.length" :item-label="kind === 'video' ? '视频' : '图集'" :recent-ids="store.recent" :busy="busy || store.busy" :error="error" @assign="assign" @create="beginCreate" />
  <CoserDialog :open="creating" :busy="busy" :error="error" @update:open="returnToPicker" @confirm="create" />
</template>
