<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '@/components/ui/Button.vue'
import { normalizeFolderName } from '@/utils/folder-name'

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(defineProps<{ title?: string; description?: string; error?: string; busy?: boolean }>(), {
  title: '新建文件夹',
  description: '输入一个便于识别的文件夹名称。',
  busy: false
})
const emit = defineEmits<{ confirm: [title: string] }>()

const name = ref('')
const validationMessage = ref('')
const input = ref<HTMLInputElement | null>(null)

watch(open, async (isOpen) => {
  if (isOpen) {
    validationMessage.value = ''
    await nextTick()
    input.value?.focus()
    return
  }

  name.value = ''
  validationMessage.value = ''
})

function submit(): void {
  const title = normalizeFolderName(name.value)
  if (!title) {
    validationMessage.value = '请输入文件夹名称。'
    input.value?.focus()
    return
  }

  validationMessage.value = ''
  emit('confirm', title)
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-zinc-950/45 backdrop-blur-sm" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-2xl outline-none">
        <div class="flex items-start justify-between gap-4">
          <div>
            <DialogTitle class="text-base font-semibold text-foreground">{{ props.title }}</DialogTitle>
            <DialogDescription class="mt-2 text-sm leading-6 text-muted">{{ props.description }}</DialogDescription>
          </div>
          <DialogClose class="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground" aria-label="关闭">
            <X :size="16" />
          </DialogClose>
        </div>
        <form class="mt-5" @submit.prevent="submit">
          <label class="block text-sm font-medium text-foreground" for="folder-name">文件夹名称</label>
          <input id="folder-name" ref="input" v-model="name" :disabled="props.busy" maxlength="120" autocomplete="off" class="mt-2 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-60" placeholder="例如：2026 年旅行" @input="validationMessage = ''">
          <p v-if="validationMessage" class="mt-2 text-sm text-rose-300">{{ validationMessage }}</p>
          <p v-else-if="props.error" class="mt-2 text-sm text-rose-300">{{ props.error }}</p>
          <div class="mt-6 flex justify-end gap-2">
            <DialogClose as-child><Button type="button" variant="outline" :disabled="props.busy">取消</Button></DialogClose>
            <Button type="submit" :disabled="props.busy">{{ props.busy ? '创建中…' : '创建文件夹' }}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
