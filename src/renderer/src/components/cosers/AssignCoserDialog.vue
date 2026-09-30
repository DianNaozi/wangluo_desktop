<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '@/components/ui/Button.vue'

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(defineProps<{ cosers: CoserSummary[]; albumTitle: string; busy?: boolean; error?: string }>(), { busy: false, error: '' })
const emit = defineEmits<{ assign: [coserId: string]; create: [] }>()
const selectedId = ref('')
const selected = computed(() => props.cosers.find((coser) => coser.id === selectedId.value))
watch(open, (visible) => { if (visible) selectedId.value = props.cosers[0]?.id ?? '' })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-zinc-950/45 backdrop-blur-sm" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-2xl outline-none">
        <DialogTitle class="text-base font-semibold text-foreground">归入 Coser</DialogTitle>
        <DialogDescription class="mt-2 text-sm leading-6 text-muted">图集“{{ albumTitle }}”会从媒体库和文件夹中移除，并显示在所选 Coser 名下。</DialogDescription>
        <div v-if="cosers.length" class="mt-5 max-h-56 space-y-1 overflow-auto rounded-lg border border-line p-1">
          <button v-for="coser in cosers" :key="coser.id" :class="['flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm', selectedId === coser.id ? 'bg-violet-500/12 text-violet-700 dark:text-violet-200' : 'text-foreground hover:bg-surface-hover']" @click="selectedId = coser.id"><span><span class="block font-medium">{{ coser.name }}</span><span v-if="coser.aliases.length" class="mt-0.5 block text-xs opacity-70">{{ coser.aliases.join(' · ') }}</span></span><span class="text-xs opacity-70">{{ coser.albumCount }} 个图集</span></button>
        </div>
        <p v-else class="mt-5 rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">还没有 Coser，请先创建一位。</p>
        <p v-if="error" class="mt-3 text-sm text-rose-300">{{ error }}</p>
        <div class="mt-6 flex flex-wrap justify-end gap-2"><DialogClose as-child><Button variant="outline" :disabled="busy">取消</Button></DialogClose><Button type="button" variant="outline" :disabled="busy" @click="emit('create')">新建 Coser</Button><Button :disabled="busy || !selected" @click="selected && emit('assign', selected.id)">{{ busy ? '归类中…' : '确认归入' }}</Button></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
