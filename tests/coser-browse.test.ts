import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoserBrowseStore } from '../src/renderer/src/stores/coser-browse'

const summary: CoserSummary = { id: 'coser-1', name: '测试 Coser', aliases: ['test'], avatarUrl: null, albumCount: 1, videoCount: 0, mediaCount: 1, updatedAt: 1 }
const detail: CoserDetail = { ...summary, albums: [], videos: [] }

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Coser browse cache', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('deduplicates concurrent list and detail reads and keeps returned detail in session cache', async () => {
    const getCosers = vi.fn().mockResolvedValue([summary])
    const getCoser = vi.fn().mockResolvedValue(detail)
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { api: { library: { getCosers, getCoser } } } })

    const store = useCoserBrowseStore()
    const listReads = await Promise.all([store.refreshCosers(), store.refreshCosers()])
    const detailReads = await Promise.all([store.refreshCoser(summary.id), store.refreshCoser(summary.id)])

    expect(getCosers).toHaveBeenCalledTimes(1)
    expect(getCoser).toHaveBeenCalledTimes(1)
    expect(listReads[0]).toEqual([summary])
    expect(detailReads[0]).toEqual(detail)
    expect(store.details[summary.id]).toEqual(detail)
  })

  it('does not let a request started before invalidation overwrite the newer detail', async () => {
    const oldRequest = deferred<CoserDetail>()
    const newRequest = deferred<CoserDetail>()
    const getCoser = vi.fn().mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { api: { library: { getCosers: vi.fn(), getCoser } } } })

    const store = useCoserBrowseStore()
    const staleRead = store.refreshCoser(summary.id)
    store.invalidateCoser(summary.id)
    const freshRead = store.refreshCoser(summary.id)
    const freshDetail = { ...detail, name: '最新名称' }
    newRequest.resolve(freshDetail)
    await freshRead
    oldRequest.resolve(detail)
    await staleRead

    expect(store.details[summary.id]).toEqual(freshDetail)
  })
})
