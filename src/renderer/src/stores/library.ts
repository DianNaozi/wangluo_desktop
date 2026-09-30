import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  ALBUM_SORT_STORAGE_KEY,
  LIBRARY_SORT_STORAGE_KEY,
  readMediaSortOrder,
  writeMediaSortOrder,
  type MediaSortOrder
} from '@/utils/media-sort'
import {
  FOLDER_ALBUMS_SORT_STORAGE_KEY,
  FOLDER_CHILDREN_SORT_STORAGE_KEY,
  readFolderContentSortOrder,
  writeFolderContentSortOrder,
  type FolderContentSortOrder
} from '@/utils/folder-content-sort'

export type MediaKind = 'all' | 'image' | 'video' | 'file'
export type { MediaSortOrder }
export type { FolderContentSortOrder }

export const useLibraryStore = defineStore('library', () => {
  const searchQuery = ref('')
  const mediaKind = ref<MediaKind>('all')
  const favoriteOnly = ref(false)
  const organizedOnly = ref(false)
  const librarySortOrder = ref<MediaSortOrder>(readMediaSortOrder(LIBRARY_SORT_STORAGE_KEY))
  const albumSortOrder = ref<MediaSortOrder>(readMediaSortOrder(ALBUM_SORT_STORAGE_KEY))
  const folderChildrenSortOrder = ref<FolderContentSortOrder>(readFolderContentSortOrder(FOLDER_CHILDREN_SORT_STORAGE_KEY))
  const folderAlbumsSortOrder = ref<FolderContentSortOrder>(readFolderContentSortOrder(FOLDER_ALBUMS_SORT_STORAGE_KEY))

  watch(librarySortOrder, (value) => writeMediaSortOrder(LIBRARY_SORT_STORAGE_KEY, value))
  watch(albumSortOrder, (value) => writeMediaSortOrder(ALBUM_SORT_STORAGE_KEY, value))
  watch(folderChildrenSortOrder, (value) => writeFolderContentSortOrder(FOLDER_CHILDREN_SORT_STORAGE_KEY, value))
  watch(folderAlbumsSortOrder, (value) => writeFolderContentSortOrder(FOLDER_ALBUMS_SORT_STORAGE_KEY, value))

  return { searchQuery, mediaKind, favoriteOnly, organizedOnly, librarySortOrder, albumSortOrder, folderChildrenSortOrder, folderAlbumsSortOrder }
})
