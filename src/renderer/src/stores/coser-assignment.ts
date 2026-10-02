import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'
import { useImportStore } from './imports'
export const useCoserAssignmentStore = defineStore('coser-assignment', () => {
  const notice = ref(''); const error = ref(''); const operationId = ref(''); const busy = ref(false); const revision = ref(0)
  let operationKind: 'album' | 'video' = 'album'
  let timer: ReturnType<typeof setTimeout> | undefined
  const recent = ref<string[]>([])
  try { const value: unknown = JSON.parse(localStorage.getItem('recent-cosers') || '[]'); if (Array.isArray(value)) recent.value = value.filter((id): id is string => typeof id === 'string').slice(0, 8) } catch { /* optional preference */ }
  async function refresh() {
    revision.value++
    const imports = useImportStore()
    await imports.refresh()
    if (imports.error) error.value = `操作已完成，但列表刷新失败：${imports.error}`
  }
  async function assign(ids: string[], coser: CoserSummary, kind: 'album' | 'video' = 'album') {
    if (busy.value) throw new Error('正在处理上一次操作')
    busy.value = true
    try {
      const result = await (kind === 'video' ? window.api.library.assignVideosCoser([...ids], coser.id) : window.api.library.assignAlbumsCoser([...ids], coser.id))
      operationKind = kind
      operationId.value = result.operationId; notice.value = `已将 ${result.count} 个${kind === 'video' ? '视频' : '图集'}归入 ${coser.name}`; error.value = ''
      recent.value = [coser.id, ...recent.value.filter(id => id !== coser.id)].slice(0, 8)
      try { localStorage.setItem('recent-cosers', JSON.stringify(recent.value)) } catch { /* assignment already succeeded */ }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { operationId.value = ''; notice.value = '' }, Math.max(0, result.expiresAt - Date.now()))
    } finally { busy.value = false }
  }
  async function undo() {
    if (busy.value || !operationId.value) return
    busy.value = true; error.value = ''
    try {
      if (operationKind === 'video') await window.api.library.undoVideoCoserAssignment(operationId.value)
      else await window.api.library.undoAlbumCoserAssignment(operationId.value)
      operationId.value = ''; notice.value = '已撤销归类，已恢复原位置'
      await refresh()
    } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
    finally { busy.value = false }
  }
  onScopeDispose(() => { if (timer) clearTimeout(timer) })
  return { notice, error, operationId, busy, revision, recent, assign, undo, refresh }
})
