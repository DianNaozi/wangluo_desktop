import { defineStore } from 'pinia'
import { ref } from 'vue'
export type MediaKind = 'all' | 'image' | 'video' | 'file'
export type SortOrder = 'importedAt' | 'takenAt' | 'filename' | 'random'
export const useLibraryStore = defineStore('library', () => {
  const searchQuery = ref('')
  const mediaKind = ref<MediaKind>('all')
  const favoriteOnly = ref(false)
  const organizedOnly = ref(false)
  const sortOrder = ref<SortOrder>('importedAt')
  return { searchQuery, mediaKind, favoriteOnly, organizedOnly, sortOrder }
})
