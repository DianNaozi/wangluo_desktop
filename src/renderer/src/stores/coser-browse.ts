import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'

type VersionedRequest<T> = { version: number; promise: Promise<T> }

export const useCoserBrowseStore = defineStore('coser-browse', () => {
  const cosers = shallowRef<CoserSummary[]>([])
  const cosersLoaded = ref(false)
  const details = shallowRef<Record<string, CoserDetail>>({})
  let cosersVersion = 0
  let cosersRequest: VersionedRequest<CoserSummary[]> | undefined
  const detailVersions = new Map<string, number>()
  const detailRequests = new Map<string, VersionedRequest<CoserDetail>>()

  function currentDetailVersion(id: string): number { return detailVersions.get(id) ?? 0 }

  function upsertSummary(summary: CoserSummary): void {
    if (!cosersLoaded.value) return
    const next = [...cosers.value]
    const index = next.findIndex((coser) => coser.id === summary.id)
    if (index >= 0) next[index] = summary
    else next.push(summary)
    next.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
    cosers.value = markRaw(next)
  }

  function invalidateCosers(): void { cosersVersion += 1 }
  function invalidateCoser(id: string): void { detailVersions.set(id, currentDetailVersion(id) + 1) }
  function invalidateAllDetails(): void {
    const ids = new Set([...Object.keys(details.value), ...detailRequests.keys()])
    ids.forEach(invalidateCoser)
  }

  function forgetCoser(id: string): void {
    invalidateCoser(id)
    const next = { ...details.value }
    delete next[id]
    details.value = markRaw(next)
    cosers.value = markRaw(cosers.value.filter((coser) => coser.id !== id))
    invalidateCosers()
  }

  function rememberCoserSummary(summary: CoserSummary): void {
    upsertSummary(summary)
    invalidateCosers()
  }

  function refreshCosers(): Promise<CoserSummary[]> {
    const version = cosersVersion
    if (cosersRequest?.version === version) return cosersRequest.promise

    const promise = window.api.library.getCosers().then((next) => {
      if (version !== cosersVersion) return next
      cosers.value = markRaw(next)
      cosersLoaded.value = true
      const activeIds = new Set(next.map((coser) => coser.id))
      const nextDetails: Record<string, CoserDetail> = {}
      for (const [id, detail] of Object.entries(details.value)) {
        if (activeIds.has(id)) nextDetails[id] = detail
      }
      details.value = markRaw(nextDetails)
      return next
    }).finally(() => {
      if (cosersRequest?.promise === promise) cosersRequest = undefined
    })
    cosersRequest = { version, promise }
    return promise
  }

  function refreshCoser(id: string): Promise<CoserDetail> {
    const version = currentDetailVersion(id)
    const currentRequest = detailRequests.get(id)
    if (currentRequest?.version === version) return currentRequest.promise

    const promise = window.api.library.getCoser(id).then((detail) => {
      if (version === currentDetailVersion(id)) {
        details.value = markRaw({ ...details.value, [id]: markRaw(detail) })
        upsertSummary(detail)
      }
      return detail
    }).finally(() => {
      if (detailRequests.get(id)?.promise === promise) detailRequests.delete(id)
    })
    detailRequests.set(id, { version, promise })
    return promise
  }

  return { cosers, cosersLoaded, details, invalidateCosers, invalidateCoser, invalidateAllDetails, forgetCoser, rememberCoserSummary, refreshCosers, refreshCoser }
})
