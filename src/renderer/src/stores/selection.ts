import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
export const useSelectionStore = defineStore('selection', () => {
  const selectedIds = ref(new Set<string>())
  const count = computed(() => selectedIds.value.size)
  function toggle(id: string): void { const next = new Set(selectedIds.value); next.has(id) ? next.delete(id) : next.add(id); selectedIds.value = next }
  function clear(): void { selectedIds.value = new Set() }
  return { selectedIds, count, toggle, clear }
})
