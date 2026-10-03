import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoserSummary } from '../src/main/import/types'
import type { SmartCoserIndexItem, SmartFolderCoserSettings, SmartFolderImportSession, SmartFolderModelResult } from '../src/main/import/smart-folder-coser'
import { SmartFolderCoserImportService, validateOllamaBaseUrl } from '../src/main/import/smart-folder-coser-service'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.send } }] } }))

const cosers: SmartCoserIndexItem[] = [
  { id: 'yuzu', name: '青柚', aliases: [] },
  { id: 'momo', name: '白桃', aliases: [] }
]
const settings: SmartFolderCoserSettings = { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' }

function coserSummary(id: string, name: string, aliases: string[] = []): CoserSummary {
  return { id, name, aliases, avatarUrl: null, albumCount: 0, videoCount: 0, mediaCount: 0, updatedAt: 0 }
}

function fixture(index = cosers) {
  const manager = {
    validateSmartFolderPaths: vi.fn(async (paths: unknown) => paths as string[]),
    planSmartFolders: vi.fn(async () => ({ id: 'job' })),
    getSmartCoserIndex: vi.fn(async () => index),
    getSmartCoserMapping: vi.fn(async () => null),
    getSmartCoserMappings: vi.fn(async () => ({})),
    saveSmartCoserMapping: vi.fn(async () => undefined),
    getSmartCoserModelCache: vi.fn(async () => null),
    saveSmartCoserModelCache: vi.fn(async () => undefined),
    createCoser: vi.fn(async (name: string) => coserSummary(`created-${name}`, name)),
    updateCoser: vi.fn(async (id: string, name: string, aliases: string[]) => coserSummary(id, name, aliases))
  }
  const service = new SmartFolderCoserImportService(manager, () => settings)
  return { manager, service }
}

function latestSession(): SmartFolderImportSession | undefined {
  return mocks.send.mock.lastCall?.[1] as SmartFolderImportSession | undefined
}

function modelResponse(status = 'matched'): Response {
  const result: SmartFolderModelResult = { status: status as SmartFolderModelResult['status'], coserId: status === 'matched' ? 'yuzu' : 'none', proposedName: '', evidence: '青柚', reason: '名称依据' }
  return new Response(JSON.stringify({ message: { content: JSON.stringify(result) } }), { status: 200 })
}

describe('smart folder Coser import service', () => {
  beforeEach(() => { mocks.send.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('restricts Ollama requests to a local HTTP endpoint', () => {
    expect(() => validateOllamaBaseUrl('http://127.0.0.1:11434')).not.toThrow()
    expect(() => validateOllamaBaseUrl('http://localhost:11434')).not.toThrow()
    expect(() => validateOllamaBaseUrl('https://localhost:11434')).toThrow('本机 HTTP')
    expect(() => validateOllamaBaseUrl('http://example.com:11434')).toThrow('本机 HTTP')
  })

  it('submits an exact local name match without calling Ollama', async () => {
    const { manager, service } = fixture()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const session = await service.start(['C:\\photos\\青柚'])
    await vi.waitFor(() => expect(manager.planSmartFolders).toHaveBeenCalledOnce())

    expect(fetch).not.toHaveBeenCalled()
    expect(manager.planSmartFolders).toHaveBeenCalledWith([{ path: 'C:\\photos\\青柚', coserId: 'yuzu' }])
    expect(latestSession()?.items[0]?.status).toBe('imported')
    expect(session?.items[0]?.status).toBe('queued')
  })

  it('keeps a model suggestion in review until explicitly assigned and remembers the choice', async () => {
    const { manager, service } = fixture()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: { content: JSON.stringify({ status: 'matched', coserId: 'yuzu', proposedName: '', evidence: '青柚', reason: '名称依据' }) } }), { status: 200 })))
    const session = await service.start(['C:\\photos\\青柚2026写真'])
    const item = session!.items[0]!

    await vi.waitFor(() => expect(latestSession()?.items[0]?.status).toBe('review'))
    expect(manager.planSmartFolders).not.toHaveBeenCalled()

    const decision = [{ itemId: item.id, action: 'assign' as const, coserId: 'yuzu' }]
    const [resolved, duplicate] = await Promise.allSettled([service.resolve(session!.id, decision), service.resolve(session!.id, decision)])
    expect(resolved.status).toBe('fulfilled')
    expect(duplicate.status).toBe('rejected')
    if (resolved.status !== 'fulfilled') throw resolved.reason
    expect(manager.planSmartFolders).toHaveBeenCalledWith([{ path: 'C:\\photos\\青柚2026写真', coserId: 'yuzu' }])
    expect(manager.saveSmartCoserMapping).toHaveBeenCalledOnce()
    expect(resolved.value.items[0]?.status).toBe('imported')
  })

  it('preserves earlier aliases when one confirmation batch teaches multiple folder names', async () => {
    const { manager, service } = fixture()
    vi.stubGlobal('fetch', vi.fn(async () => modelResponse()))
    const session = await service.start(['C:\\photos\\青柚2026版1', 'C:\\photos\\青柚2026版2'])
    await vi.waitFor(() => expect(latestSession()?.items.filter((item) => item.status === 'review')).toHaveLength(2))

    await service.resolve(session!.id, session!.items.map((item, index) => ({ itemId: item.id, action: 'assign' as const, coserId: 'yuzu', saveAlias: true, alias: `别名${index + 1}` })))

    expect(manager.updateCoser).toHaveBeenNthCalledWith(1, 'yuzu', '青柚', ['别名1'])
    expect(manager.updateCoser).toHaveBeenNthCalledWith(2, 'yuzu', '青柚', ['别名1', '别名2'])
    expect(manager.saveSmartCoserMapping).toHaveBeenCalledTimes(2)
  })

  it('sends an offline model result to review without submitting it', async () => {
    const { manager, service } = fixture()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    const session = await service.start(['C:\\photos\\未识别文件夹'])

    await vi.waitFor(() => expect(latestSession()?.items[0]?.status).toBe('review'))
    expect(latestSession()?.items[0]?.reason).toContain('无法连接本机 Ollama')
    expect(manager.planSmartFolders).not.toHaveBeenCalled()
    expect(session?.items[0]?.status).toBe('matching')
  })

  it('keeps a timed out model request in review', async () => {
    const { manager, service } = fixture()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('request timed out', 'TimeoutError') }))
    const session = await service.start(['C:\\photos\\慢速未识别目录'])

    await vi.waitFor(() => expect(latestSession()?.items[0]?.status).toBe('review'))
    expect(latestSession()?.items[0]?.reason).toContain('request timed out')
    expect(manager.planSmartFolders).not.toHaveBeenCalled()
  })

  it('cancels unresolved model work without affecting submitted imports', async () => {
    const { manager, service } = fixture()
    const fetch = vi.fn((_url: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const session = await service.start(['C:\\photos\\青柚相册2026'])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    const cancelled = service.cancel(session!.id)
    expect(cancelled?.items[0]?.status).toBe('skipped')
    await vi.waitFor(() => expect(latestSession()?.items[0]?.status).toBe('skipped'))
    expect(manager.planSmartFolders).not.toHaveBeenCalled()
    await expect(service.resolve(session!.id, [{ itemId: session!.items[0]!.id, action: 'library' }])).rejects.toThrow('会话已结束')
  })
})
