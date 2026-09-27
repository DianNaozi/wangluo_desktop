<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import Button from './Button.vue'

const open = defineModel<boolean>('open', { default: false })
withDefaults(defineProps<{ title?: string; description: string; confirmText?: string; destructive?: boolean }>(), { title: '确认操作', confirmText: '确认', destructive: false })
const emit = defineEmits<{ confirm: [] }>()
// Emit before closing so parents can still read the target associated with this dialog.
function confirm(): void { emit('confirm'); open.value = false }
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-zinc-950/45 backdrop-blur-sm" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-2xl outline-none">
        <div class="flex items-start justify-between gap-4"><div><DialogTitle class="text-base font-semibold text-foreground">{{ title }}</DialogTitle><DialogDescription class="mt-2 text-sm leading-6 text-muted">{{ description }}</DialogDescription></div><DialogClose class="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground" aria-label="关闭"><X :size="16" /></DialogClose></div>
        <div class="mt-6 flex justify-end gap-2"><DialogClose as-child><Button variant="outline">取消</Button></DialogClose><Button :class="destructive ? 'bg-rose-600 hover:bg-rose-500 focus-visible:outline-rose-500' : undefined" @click="confirm">{{ confirmText }}</Button></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
