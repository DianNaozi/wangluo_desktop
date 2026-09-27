import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { shouldRefreshFolderDetail } from '@/utils/folder-navigation'

export const useImportStore = defineStore('imports', () => {
  const jobs = ref<ImportJobSummary[]>([])
  const snapshot = ref<LibrarySnapshot>({ totals: { all: 0, images: 0, videos: 0, files: 0 }, folders: [], albums: [], looseMedia: [] })
  const loading = ref(false)
  const error = ref('')
  const completedImportRevision = ref(0)
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  const completedJobIds = new Set<string>()
  const activeJobs = computed(() => jobs.value.filter((job) => ['planned', 'queued', 'running'].includes(job.status)))

  async function refresh(): Promise<void> {
    loading.value = true
    try { [jobs.value, snapshot.value] = await Promise.all([window.api.media.getJobs(), window.api.library.getSnapshot()]); error.value = '' }
    catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
    finally { loading.value = false }
  }
  async function run(action: () => Promise<unknown>): Promise<void> {
    try { await action(); await refresh() }
    catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  }
  function scheduleSnapshotRefresh(immediate = false): void {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    snapshotTimer = setTimeout(() => {
      snapshotTimer = undefined
      void window.api.library.getSnapshot().then((next) => { snapshot.value = next }).catch((reason) => { error.value = reason instanceof Error ? reason.message : String(reason) })
    }, immediate ? 0 : 250)
  }
  async function importFiles(folderId: string | null = null): Promise<void> { await run(() => window.api.media.importFiles(folderId)) }
  async function importFolders(folderId: string | null = null): Promise<void> { await run(() => window.api.media.importFolders(folderId)) }
  async function retryJob(jobId: string): Promise<void> { await run(() => window.api.media.retryJob(jobId)) }
  async function rebuildPreviews(): Promise<void> { await run(() => window.api.media.rebuildPreviews()) }
  async function trashMedia(id: string): Promise<void> { await run(() => window.api.media.trashMedia(id)) }
  async function trashAlbum(id: string): Promise<void> { await run(() => window.api.media.trashAlbum(id)) }
  const unsubscribe = window.api.media.onImportProgress((event) => {
    const index = jobs.value.findIndex((job) => job.id === event.job.id)
    if (index === -1) jobs.value.unshift(event.job); else jobs.value.splice(index, 1, event.job)
    const completed = shouldRefreshFolderDetail(event.job.status)
    if (completed && !completedJobIds.has(event.job.id)) { completedJobIds.add(event.job.id); completedImportRevision.value += 1 }
    if (!completed) completedJobIds.delete(event.job.id)
    scheduleSnapshotRefresh(completed)
  })
  onScopeDispose(unsubscribe)
  const unsubscribePreviews = window.api.media.onPreviewProgress(() => {
    scheduleSnapshotRefresh()
  })
  onScopeDispose(unsubscribePreviews)
  const unsubscribeServiceErrors = window.api.media.onImportServiceError((event) => { error.value = event.message })
  onScopeDispose(unsubscribeServiceErrors)
  onScopeDispose(() => { if (snapshotTimer) clearTimeout(snapshotTimer) })

  return { jobs, snapshot, loading, error, completedImportRevision, activeJobs, refresh, importFiles, importFolders, retryJob, rebuildPreviews, trashMedia, trashAlbum }
})
