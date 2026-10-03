import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { importCompletionNotice, isTerminalImportJob, recordTerminalImportJob, type ImportCompletionNotice } from '@/utils/import-feedback'
import { reportStartupStage } from '@/utils/startup-performance'
import type { SmartCoserIndexItem, SmartFolderImportDecision, SmartFolderImportSession } from '../../../main/import/smart-folder-coser'

type DropImportDestination = { type: 'library' } | { type: 'folder'; folderId: string } | { type: 'coser'; coserId: string }

export const useImportStore = defineStore('imports', () => {
  const jobs = ref<ImportJobSummary[]>([])
  const snapshot = ref<LibrarySnapshot>({ totals: { all: 0, images: 0, videos: 0, files: 0 }, folders: [], albums: [], looseMedia: [] })
  const folderTree = ref<FolderTreeNode[]>([])
  const loading = ref(false)
  const error = ref('')
  const droppedFolderScans = ref(0)
  const droppedFolderError = ref('')
  const completedImportRevision = ref(0)
  const previewRevision = ref(0)
  const completionNotices = ref<ImportCompletionNotice[]>([])
  const smartFolderSessions = ref<SmartFolderImportSession[]>([])
  const smartCoserChoices = ref<SmartCoserIndexItem[]>([])
  const smartFolderErrors = ref<Record<string, string>>({})
  let smartCoserChoicesPromise: Promise<void> | undefined
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  let refreshInFlight: Promise<void> | undefined
  let refreshRequestedAgain = false
  let startupRefreshRecorded = false
  const completedJobIds = new Set<string>()
  const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const activeJobs = computed(() => jobs.value.filter((job) => ['planned', 'queued', 'running'].includes(job.status)))
  const activeJob = computed(() => activeJobs.value.find((job) => job.status === 'running') ?? activeJobs.value[0] ?? null)
  const queuedJobCount = computed(() => activeJobs.value.filter((job) => job.id !== activeJob.value?.id).length)

  async function refresh(): Promise<void> {
    if (refreshInFlight) {
      refreshRequestedAgain = true
      await refreshInFlight
      if (refreshInFlight) {
        await refreshInFlight
        return
      }
      if (refreshRequestedAgain) {
        refreshRequestedAgain = false
        await refresh()
      }
      return
    }
    loading.value = true
    const startedAt = performance.now()
    refreshInFlight = (async () => {
      try {
        [jobs.value, snapshot.value, folderTree.value] = await Promise.all([window.api.media.getJobs(), window.api.library.getSnapshot(), window.api.library.getFolderTree()])
        error.value = ''
        if (!startupRefreshRecorded) {
          startupRefreshRecorded = true
          reportStartupStage(`initial library data returned in ${Math.round(performance.now() - startedAt)} ms`)
        }
      } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
      finally {
        loading.value = false
        refreshInFlight = undefined
      }
    })()
    return refreshInFlight
  }
  async function run(action: () => Promise<unknown>): Promise<void> {
    try { await action(); await refresh() }
    catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  }
  function scheduleSnapshotRefresh(immediate = false): void {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    snapshotTimer = setTimeout(() => {
      snapshotTimer = undefined
      void Promise.all([window.api.library.getSnapshot(), window.api.library.getFolderTree()]).then(([nextSnapshot, nextTree]) => {
        snapshot.value = nextSnapshot
        folderTree.value = nextTree
      }).catch((reason) => { error.value = reason instanceof Error ? reason.message : String(reason) })
    }, immediate ? 0 : 250)
  }
  async function importFiles(folderId: string | null | Event = null): Promise<void> {
    await run(() => window.api.media.importFiles(typeof folderId === 'string' ? folderId : null))
  }
  async function importFolders(folderId: string | null | Event = null): Promise<void> {
    await run(async () => {
      const result = await window.api.media.importFolders(typeof folderId === 'string' ? folderId : null)
      if (result && 'items' in result) acceptSmartFolderSession(result)
    })
  }
  async function importDroppedFolders(files: File[], destination: DropImportDestination): Promise<void> {
    if (!files.length) return
    droppedFolderScans.value += 1
    droppedFolderError.value = ''
    try {
      const result = await window.api.media.importDroppedFolders(files, destination)
      if ('items' in result) acceptSmartFolderSession(result)
      await refresh()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      droppedFolderError.value = message
    } finally {
      droppedFolderScans.value = Math.max(0, droppedFolderScans.value - 1)
    }
  }
  function dismissDroppedFolderError(): void { droppedFolderError.value = '' }
  function acceptSmartFolderSession(session: SmartFolderImportSession): void {
    const reviewable = session.items.some((item) => ['matching', 'review', 'committing'].includes(item.status))
    const index = smartFolderSessions.value.findIndex((current) => current.id === session.id)
    if (!reviewable) {
      if (index !== -1) smartFolderSessions.value.splice(index, 1)
      delete smartFolderErrors.value[session.id]
      return
    }
    if (index === -1) smartFolderSessions.value.unshift(session)
    else smartFolderSessions.value.splice(index, 1, session)
    if (!smartCoserChoicesPromise) smartCoserChoicesPromise = window.api.library.getSmartCoserIndex().then((cosers) => { smartCoserChoices.value = cosers }).catch((reason) => { error.value = reason instanceof Error ? reason.message : String(reason) }).finally(() => { smartCoserChoicesPromise = undefined })
  }
  async function resolveSmartFolderImport(sessionId: string, decisions: SmartFolderImportDecision[]): Promise<void> {
    delete smartFolderErrors.value[sessionId]
    try {
      acceptSmartFolderSession(await window.api.media.resolveSmartFolderImport(sessionId, decisions))
      await refresh()
    } catch (reason) { smartFolderErrors.value[sessionId] = reason instanceof Error ? reason.message : String(reason) }
  }
  async function cancelSmartFolderImport(sessionId: string): Promise<void> {
    try {
      const session = await window.api.media.cancelSmartFolderImport(sessionId)
      if (session) acceptSmartFolderSession(session)
    } catch (reason) { smartFolderErrors.value[sessionId] = reason instanceof Error ? reason.message : String(reason) }
  }
  async function retryJob(jobId: string): Promise<void> { await run(() => window.api.media.retryJob(jobId)) }
  async function rebuildPreviews(): Promise<void> { await run(() => window.api.media.rebuildPreviews()) }
  async function retryPreview(mediaId: string): Promise<void> { await run(() => window.api.media.retryPreview(mediaId)) }
  async function trashMedia(id: string): Promise<void> { await run(() => window.api.media.trashMedia(id)) }
  async function trashAlbum(id: string): Promise<void> { await run(() => window.api.media.trashAlbum(id)) }
  function dismissCompletionNotice(id: string): void {
    completionNotices.value = completionNotices.value.filter((notice) => notice.id !== id)
    const timer = noticeTimers.get(id)
    if (timer) clearTimeout(timer)
    noticeTimers.delete(id)
  }
  function showCompletionNotice(job: ImportJobSummary): void {
    const notice = importCompletionNotice(job)
    completionNotices.value = [...completionNotices.value, notice]
    noticeTimers.set(notice.id, setTimeout(() => dismissCompletionNotice(notice.id), 5_000))
  }
  const unsubscribe = window.api.media.onImportProgress((event) => {
    const index = jobs.value.findIndex((job) => job.id === event.job.id)
    if (index === -1) jobs.value.unshift(event.job); else jobs.value.splice(index, 1, event.job)
    const completed = isTerminalImportJob(event.job.status)
    if (recordTerminalImportJob(event.job, completedJobIds)) {
      completedImportRevision.value += 1
      showCompletionNotice(event.job)
    }
    scheduleSnapshotRefresh(completed)
  })
  onScopeDispose(unsubscribe)
  const unsubscribePreviews = window.api.media.onPreviewProgress(() => {
    previewRevision.value += 1
    scheduleSnapshotRefresh()
  })
  onScopeDispose(unsubscribePreviews)
  const unsubscribeServiceErrors = window.api.media.onImportServiceError((event) => { error.value = event.message })
  onScopeDispose(unsubscribeServiceErrors)
  const unsubscribeSmartFolderSessions = window.api.media.onSmartFolderImportProgress(acceptSmartFolderSession)
  onScopeDispose(unsubscribeSmartFolderSessions)
  onScopeDispose(() => {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    noticeTimers.forEach((timer) => clearTimeout(timer))
    noticeTimers.clear()
  })

  return { jobs, snapshot, folderTree, loading, error, droppedFolderScans, droppedFolderError, completedImportRevision, previewRevision, completionNotices, smartFolderSessions, smartCoserChoices, smartFolderErrors, activeJobs, activeJob, queuedJobCount, dismissCompletionNotice, dismissDroppedFolderError, resolveSmartFolderImport, cancelSmartFolderImport, refresh, importFiles, importFolders, importDroppedFolders, retryJob, rebuildPreviews, retryPreview, trashMedia, trashAlbum }
})
