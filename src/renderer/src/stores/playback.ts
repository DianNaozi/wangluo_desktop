import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type PlaybackQueueItem = {
  id: string
  title: string
  source: string
  type: 'image' | 'video'
  mediaUrl: string
  previewUrl: string | null
}

export type PlaybackMediaInput = {
  id: string
  originalName: string
  mediaKind: 'image' | 'video' | 'file'
  mediaUrl: string
  previewUrl: string | null
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

  function addMedia(item: PlaybackQueueItem): boolean {
    if (queue.value.some((entry) => entry.id === item.id)) return false
    queue.value.push(item)
    return true
  }

  function addMediaBatch(items: PlaybackMediaInput[], source: string): number {
    return items.reduce((added, item) => {
      if (item.mediaKind === 'file') return added
      return addMedia({ id: item.id, title: item.originalName, source, type: item.mediaKind, mediaUrl: item.mediaUrl, previewUrl: item.previewUrl }) ? added + 1 : added
    }, 0)
  }

  function remove(id: string): void {
    const index = queue.value.findIndex((item) => item.id === id)
    if (index < 0) return
    queue.value.splice(index, 1)
    if (index < currentIndex.value) currentIndex.value -= 1
    else if (currentIndex.value >= queue.value.length) currentIndex.value = Math.max(0, queue.value.length - 1)
  }

  function move(id: string, offset: -1 | 1): void {
    const index = queue.value.findIndex((item) => item.id === id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= queue.value.length) return
    ;[queue.value[index], queue.value[target]] = [queue.value[target], queue.value[index]]
  }

  function clear(): void {
    queue.value = []
    currentIndex.value = 0
    playerOpen.value = false
  }

  function play(index = 0): void {
    if (!queue.value.length) return
    currentIndex.value = Math.min(index, queue.value.length - 1)
    isPlaying.value = true
    drawerOpen.value = false
    playerOpen.value = true
  }

  function next(): void {
    if (!queue.value.length) return
    if (currentIndex.value < queue.value.length - 1) currentIndex.value += 1
    else if (loop.value) currentIndex.value = 0
    else isPlaying.value = false
  }

  function previous(): void {
    if (!queue.value.length) return
    currentIndex.value = currentIndex.value > 0 ? currentIndex.value - 1 : loop.value ? queue.value.length - 1 : 0
  }

  function jump(index: number): void {
    if (index >= 0 && index < queue.value.length) currentIndex.value = index
  }

  return { queue, drawerOpen, playerOpen, isPlaying, loop, currentIndex, imageIntervalSeconds, currentItem, addMedia, addMediaBatch, remove, move, clear, play, next, previous, jump }
})
