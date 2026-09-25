import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type PlaybackQueueItem = { id: string; kind: 'album' | 'media'; title: string; source: string; type: 'image' | 'video'; color: string; duration?: string }
type MediaInput = Omit<PlaybackQueueItem, 'kind'>

const albumMedia: Record<string, Array<Omit<PlaybackQueueItem, 'kind'>>> = {
  summer: [
    { id: 'summer-1', title: '夏日写真 · 01', source: '夏日写真集', type: 'image', color: 'from-fuchsia-500 via-rose-400 to-orange-100' },
    { id: 'summer-2', title: '夏日花絮', source: '夏日写真集', type: 'video', duration: '00:32', color: 'from-violet-800 via-indigo-500 to-sky-300' },
    { id: 'summer-3', title: '夏日写真 · 02', source: '夏日写真集', type: 'image', color: 'from-orange-500 via-amber-300 to-yellow-100' }
  ],
  con: [
    { id: 'con-1', title: '漫展现场 · 01', source: '漫展现场', type: 'image', color: 'from-sky-600 via-cyan-400 to-teal-100' },
    { id: 'con-2', title: '舞台记录', source: '漫展现场', type: 'video', duration: '00:48', color: 'from-zinc-900 via-purple-600 to-rose-300' },
    { id: 'con-3', title: '漫展现场 · 02', source: '漫展现场', type: 'image', color: 'from-indigo-700 via-violet-400 to-pink-200' }
  ],
  night: [
    { id: 'night-1', title: '城市夜景 · 01', source: '城市夜景', type: 'image', color: 'from-slate-950 via-indigo-600 to-blue-300' },
    { id: 'night-2', title: '霓虹街景', source: '城市夜景', type: 'image', color: 'from-rose-600 via-orange-400 to-amber-100' }
  ],
  daily: [{ id: 'daily-1', title: '日常收藏 · 01', source: '日常收藏', type: 'image', color: 'from-emerald-500 via-teal-300 to-cyan-100' }]
}

export const usePlaybackStore = defineStore('playback', () => {
  const queue = ref<PlaybackQueueItem[]>([])
  const drawerOpen = ref(false)
  const playerOpen = ref(false)
  const isPlaying = ref(true)
  const loop = ref(true)
  const currentIndex = ref(0)
  const imageIntervalSeconds = ref(5)
  const currentItem = computed(() => queue.value[currentIndex.value])

  function addMedia(item: MediaInput): boolean { if (queue.value.some((entry) => entry.id === item.id)) return false; queue.value.push({ ...item, kind: 'media' }); return true }
  function addAlbum(id: string, title: string): boolean { const items = albumMedia[id] ?? [{ id: `${id}-cover`, title, source: title, type: 'image' as const, color: 'from-violet-500 via-fuchsia-400 to-rose-200' }]; const added = items.filter((item) => !queue.value.some((entry) => entry.id === item.id)); if (!added.length) return false; queue.value.push(...added.map((item) => ({ ...item, kind: 'album' as const }))); return true }
  function remove(id: string): void { const index = queue.value.findIndex((item) => item.id === id); if (index < 0) return; queue.value.splice(index, 1); if (currentIndex.value >= queue.value.length) currentIndex.value = Math.max(0, queue.value.length - 1) }
  function move(id: string, offset: -1 | 1): void { const index = queue.value.findIndex((item) => item.id === id); const target = index + offset; if (index < 0 || target < 0 || target >= queue.value.length) return; [queue.value[index], queue.value[target]] = [queue.value[target], queue.value[index]] }
  function clear(): void { queue.value = []; currentIndex.value = 0; playerOpen.value = false }
  function play(index = 0): void { if (!queue.value.length) return; currentIndex.value = Math.min(index, queue.value.length - 1); isPlaying.value = true; drawerOpen.value = false; playerOpen.value = true }
  function next(): void { if (!queue.value.length) return; if (currentIndex.value < queue.value.length - 1) currentIndex.value += 1; else if (loop.value) currentIndex.value = 0; else isPlaying.value = false }
  function previous(): void { if (!queue.value.length) return; currentIndex.value = currentIndex.value > 0 ? currentIndex.value - 1 : loop.value ? queue.value.length - 1 : 0 }
  function jump(index: number): void { if (index >= 0 && index < queue.value.length) currentIndex.value = index }

  return { queue, drawerOpen, playerOpen, isPlaying, loop, currentIndex, imageIntervalSeconds, currentItem, addMedia, addAlbum, remove, move, clear, play, next, previous, jump }
})
