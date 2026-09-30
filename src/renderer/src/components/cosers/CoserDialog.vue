<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '@/components/ui/Button.vue'

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(defineProps<{ title?: string; description?: string; initial?: { name: string; aliases: string[] } | null; busy?: boolean; avatarBusy?: boolean; avatarMessage?: string; error?: string; avatarSelected?: boolean; canSelectAvatar?: boolean; canClearAvatar?: boolean }>(), {
  title: '新建 Coser', description: '主名称用于展示；多个别名请用逗号或换行分隔。', initial: null, busy: false, error: ''
})
const emit = defineEmits<{ confirm: [value: { name: string; aliases: string[] }]; selectAvatar: []; clearAvatar: [] }>()
const name = ref(''); const aliasesText = ref(''); const validationMessage = ref(''); const nameInput = ref<HTMLInputElement | null>(null)
const submitLabel = computed(() => props.initial ? '保存修改' : '创建 Coser')

watch(open, async (visible) => {
  if (!visible) return
  name.value = props.initial?.name ?? ''
  aliasesText.value = props.initial?.aliases.join(', ') ?? ''
  validationMessage.value = ''
  await nextTick(); nameInput.value?.focus()
})
function submit(): void {
  if (props.busy || props.avatarBusy) return
  const normalizedName = name.value.trim().replace(/\s+/g, ' ')
  const aliases = aliasesText.value.split(/[，,\n]/).map((value) => value.trim().replace(/\s+/g, ' ')).filter(Boolean)
  if (!normalizedName) { validationMessage.value = '请输入 Coser 主名称。'; nameInput.value?.focus(); return }
  validationMessage.value = ''
  emit('confirm', { name: normalizedName, aliases })
}
</script>

<template>
  <DialogRoot :open="open" @update:open="(value) => { if (!busy && !avatarBusy) open = value }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-zinc-950/45 backdrop-blur-sm" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-2xl outline-none">
        <div class="flex items-start justify-between gap-4"><div><DialogTitle class="text-base font-semibold text-foreground">{{ title }}</DialogTitle><DialogDescription class="mt-2 text-sm leading-6 text-muted">{{ description }}</DialogDescription></div><DialogClose :disabled="busy || avatarBusy" class="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground" aria-label="关闭"><X :size="16" /></DialogClose></div>
        <form class="mt-5 space-y-4" @submit.prevent="submit">
          <label class="block text-sm font-medium text-foreground">主名称<input ref="nameInput" v-model="name" :disabled="busy || avatarBusy" maxlength="80" autocomplete="off" class="mt-2 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground outline-none focus:border-violet-500 disabled:opacity-60" placeholder="例如：林柚" @input="validationMessage = ''"></label>
          <label class="block text-sm font-medium text-foreground">别名<span class="ml-1 font-normal text-muted">可选</span><textarea v-model="aliasesText" :disabled="busy || avatarBusy" maxlength="500" rows="3" class="mt-2 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500 disabled:opacity-60" placeholder="例如：Yuzu, 柚子" @input="validationMessage = ''" /></label>
          <div class="rounded-lg border border-line bg-canvas p-3"><p class="text-sm font-medium text-foreground">头像</p><p class="mt-1 text-xs text-muted">随机抽取当前 Coser 图包中的图片，自动截取人脸；最多尝试 10 张。</p><div class="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" :disabled="busy || avatarBusy || !canSelectAvatar" @click="emit('selectAvatar')">{{ avatarBusy ? '正在生成…' : avatarSelected ? '随机更换头像' : '随机生成头像' }}</Button><Button v-if="canClearAvatar" type="button" size="sm" variant="outline" :disabled="busy || avatarBusy" @click="emit('clearAvatar')">移除头像</Button></div><p v-if="!canSelectAvatar" class="mt-2 text-xs text-muted">请先将图集归入该 Coser。</p><p v-if="avatarMessage" role="status" aria-live="polite" class="mt-2 text-xs text-muted">{{ avatarMessage }}</p></div>
          <p v-if="validationMessage || error" class="text-sm text-rose-300">{{ validationMessage || error }}</p>
          <div class="flex justify-end gap-2"><DialogClose as-child><Button type="button" variant="outline" :disabled="busy || avatarBusy">取消</Button></DialogClose><Button type="submit" :disabled="busy || avatarBusy">{{ busy ? '保存中…' : submitLabel }}</Button></div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
