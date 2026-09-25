import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

export const useImportStore = defineStore('imports', () => {
  const jobs = ref<ImportJobSummary[]>([])
  const snapshot = ref<LibrarySnapshot>({ totals: { all: 0, images: 0, videos: 0, files: 0 }, albums: [], looseMedia: [] })
  const loading = ref(false)
  const error = ref('')
  const activeJobs = computed(() => jobs.value.filter((job) => ['planned', 'queued', 'running'].includes(job.status)))

  async function refresh(): Promise<void> {
    loading.value = true
    try { [jobs.value, snapshot.value] = await Promise.all([window.api.media.getJobs(), window.api.library.getSnapshot()]); error.value = '' }
    catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
    finally { loading.value = false }
  }
  async function importFiles(): Promise<void> { await window.api.media.importFiles(); await refresh() }
  async function importFolders(): Promise<void> { await window.api.media.importFolders(); await refresh() }
  async function retryJob(jobId: string): Promise<void> { await window.api.media.retryJob(jobId); await refresh() }
  async function rebuildPreviews(): Promise<void> { await window.api.media.rebuildPreviews(); await refresh() }
  async function trashMedia(id: string): Promise<void> { await window.api.media.trashMedia(id); await refresh() }
  async function trashAlbum(id: string): Promise<void> { await window.api.media.trashAlbum(id); await refresh() }
  const unsubscribe = window.api.media.onImportProgress((event) => {
    const index = jobs.value.findIndex((job) => job.id === event.job.id)
    if (index === -1) jobs.value.unshift(event.job); else jobs.value.splice(index, 1, event.job)
    void window.api.library.getSnapshot().then((next) => { snapshot.value = next })
  })
  onScopeDispose(unsubscribe)
  const unsubscribePreviews = window.api.media.onPreviewProgress(() => {
    void window.api.library.getSnapshot().then((next) => { snapshot.value = next })
  })
  onScopeDispose(unsubscribePreviews)

  return { jobs, snapshot, loading, error, activeJobs, refresh, importFiles, importFolders, retryJob, rebuildPreviews, trashMedia, trashAlbum }
})
