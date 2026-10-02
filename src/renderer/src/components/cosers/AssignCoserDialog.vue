<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UserRound, Search } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '@/components/ui/Button.vue'
const open = defineModel<boolean>('open', { default: false })
const selectedId = defineModel<string>('selectedId', { default: '' })
const props = withDefaults(defineProps<{ cosers: CoserSummary[]; albumCount: number; itemLabel?: string; recentIds: string[]; busy?: boolean; error?: string }>(), { busy: false, error: '', itemLabel: '图集' })
const emit = defineEmits<{ assign: [coserId: string]; create: [] }>()
const search = ref(''); const input = ref<HTMLInputElement>(); const unavailable = ref(new Set<string>())
const selected = computed(() => props.cosers.find(c => c.id === selectedId.value))
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  const rank = (id: string) => { const index = props.recentIds.indexOf(id); return index < 0 ? 8 : index }
  return props.cosers.filter(c => [c.name, ...c.aliases].some(n => n.toLocaleLowerCase().includes(query))).sort((a, b) => rank(a.id) - rank(b.id))
})
watch(open, value => { if (value) search.value = '' })
</script>
<template>
  <DialogRoot :open="open" @update:open="value => { if (!busy) open = value }">
    <DialogPortal><DialogOverlay class="fixed inset-0 z-40 bg-zinc-950/45 backdrop-blur-sm" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-2xl outline-none" @open-auto-focus.prevent="input?.focus()" @escape-key-down="event => { if (busy) event.preventDefault() }" @interact-outside="event => { if (busy) event.preventDefault() }">
        <DialogTitle class="text-base font-semibold">归入 Coser</DialogTitle>
        <DialogDescription class="mt-2 text-sm leading-6 text-muted">已选 {{ albumCount }} 个{{ itemLabel }}。归类后将从当前媒体库列表或文件夹移出，改在所选 Coser 名下显示；磁盘上的文件不会移动。</DialogDescription>
        <div class="relative mt-4"><Search :size="16" class="absolute left-3 top-3 text-muted" /><input ref="input" v-model="search" :disabled="busy" aria-label="搜索姓名或别名" placeholder="搜索姓名或别名" class="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm outline-none focus:border-accent"></div>
        <div class="mt-4 grid max-h-72 grid-cols-3 gap-2 overflow-auto p-1 sm:grid-cols-4">
          <button v-for="coser in filtered" :key="coser.id" :disabled="busy" :aria-pressed="selectedId === coser.id" :class="['flex min-w-0 flex-col items-center rounded-lg p-3 focus-visible:outline-accent', selectedId === coser.id ? 'bg-accent/10 text-accent' : 'hover:bg-surface-hover']" @click="selectedId = coser.id">
            <span :class="['grid size-16 place-items-center overflow-hidden rounded-full bg-accent/10', selectedId === coser.id && 'ring-2 ring-accent ring-offset-2 ring-offset-surface']"><img v-if="coser.avatarUrl && !unavailable.has(coser.id)" :src="coser.avatarUrl" alt="" class="size-full object-cover" @error="unavailable.add(coser.id)"><UserRound v-else :size="28" /></span>
            <span class="mt-2 w-full truncate text-sm" :title="coser.name">{{ coser.name }}</span>
          </button>
        </div>
        <p v-if="!filtered.length" class="py-5 text-center text-sm text-muted">{{ cosers.length ? '没有匹配的 Coser，可以新建一位。' : '还没有 Coser，请先新建一位。' }}</p>
        <p v-if="error" role="alert" class="mt-3 text-sm text-rose-500">{{ error }}</p>
        <div class="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" :disabled="busy" @click="emit('create')">新建 Coser</Button><DialogClose as-child><Button variant="outline" :disabled="busy">取消</Button></DialogClose><Button :disabled="busy || !selected" @click="selected && emit('assign', selected.id)">{{ busy ? '归类中…' : selected ? '将 ' + albumCount + ' 个' + itemLabel + '归入 ' + selected.name : '请选择 Coser' }}</Button></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
