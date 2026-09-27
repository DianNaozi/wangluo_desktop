import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  ALBUM_SORT_STORAGE_KEY,
  LIBRARY_SORT_STORAGE_KEY,
  readMediaSortOrder,
  writeMediaSortOrder,
  type MediaSortOrder
} from '@/utils/media-sort'

export type MediaKind = 'all' | 'image' | 'video' | 'file'
export type { MediaSortOrder }

export const useLibraryStore = defineStore('library', () => {
  const searchQuery = ref('')
  const mediaKind = ref<MediaKind>('all')
  const favoriteOnly = ref(false)
  const organizedOnly = ref(false)
  const librarySortOrder = ref<MediaSortOrder>(readMediaSortOrder(LIBRARY_SORT_STORAGE_KEY))
  const albumSortOrder = ref<MediaSortOrder>(readMediaSortOrder(ALBUM_SORT_STORAGE_KEY))

  watch(librarySortOrder, (value) => writeMediaSortOrder(LIBRARY_SORT_STORAGE_KEY, value))
  watch(albumSortOrder, (value) => writeMediaSortOrder(ALBUM_SORT_STORAGE_KEY, value))

  return { searchQuery, mediaKind, favoriteOnly, organizedOnly, librarySortOrder, albumSortOrder }
})
