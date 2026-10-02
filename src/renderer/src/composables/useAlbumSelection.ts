import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'
import { toggleAlbumSelection } from '@/utils/album-selection'
export function useAlbumSelection(albums: ComputedRef<Array<{ id: string }>>, resetKey: () => unknown) {
  const selected = ref(new Set<string>())
  const active = computed(() => selected.value.size > 0)
  let anchor: string | null = null
  function clear() { selected.value = new Set(); anchor = null }
  function toggle(id: string, event: MouseEvent) {
    selected.value = toggleAlbumSelection(selected.value, albums.value.map(a => a.id), id, anchor, event.shiftKey)
    anchor = id
  }
  function all() { selected.value = new Set(albums.value.map(a => a.id)) }
  function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement)?.closest('[role="dialog"]') && !document.querySelector('[role="dialog"]')) clear() }
  watch(resetKey, clear)
  watch(albums, items => { selected.value = new Set([...selected.value].filter(id => items.some(a => a.id === id))) })
  onMounted(() => document.addEventListener('keydown', keydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', keydown))
  return { selected, active, clear, toggle, all }
}
