import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateRandomAvatar } from '../src/renderer/src/utils/random-avatar'

const sources = Array.from({ length: 15 }, (_, i) => ({ id: String(i), mediaUrl: `image-${i}` }))
const image = {} as HTMLImageElement
const crop = { left: 0, top: 0, size: 1 }
function dependencies() {
  return {
    load: vi.fn(async () => image),
    detect: vi.fn(async (): Promise<import('../src/renderer/src/utils/face-detector').AvatarFaceDetection> => ({ status: 'not-found' })),
    save: vi.fn(async () => {}),
    progress: vi.fn()
  }
}
afterEach(() => vi.restoreAllMocks())

describe('random Coser avatar generation', () => {
  it('randomizes up to ten unique sources without changing the input or saving on exhaustion', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const deps = dependencies()
    const input = [...sources, sources[0]]
    const before = [...input]
    expect(await generateRandomAvatar(input, deps)).toBe('exhausted')
    expect(deps.load).toHaveBeenCalledTimes(10)
    const urls = deps.load.mock.calls.map(call => (call as unknown as [string])[0])
    expect(new Set(urls).size).toBe(10)
    expect(urls[0]).not.toBe(sources[0].mediaUrl)
    expect(input).toEqual(before)
    expect(deps.progress).toHaveBeenLastCalledWith(10, 10)
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('skips unreadable images and missing faces, then saves only the first detected face', async () => {
    const deps = dependencies()
    deps.load.mockRejectedValueOnce(new Error('unreadable'))
    deps.detect.mockResolvedValueOnce({ status: 'not-found' }).mockResolvedValueOnce({ status: 'found', crop })
    expect(await generateRandomAvatar(sources, deps)).toBe('saved')
    expect(deps.load).toHaveBeenCalledTimes(3)
    expect(deps.detect).toHaveBeenCalledTimes(2)
    expect(deps.save).toHaveBeenCalledExactlyOnceWith(expect.any(String), crop)
  })

  it('stops immediately on model or inference failure without saving', async () => {
    const deps = dependencies()
    deps.detect.mockResolvedValueOnce({ status: 'failed', message: 'model unavailable' })
    await expect(generateRandomAvatar(sources, deps)).rejects.toThrow('model unavailable')
    expect(deps.load).toHaveBeenCalledTimes(1)
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('does not retry saving failures or replace them with a successful result', async () => {
    const deps = dependencies()
    deps.detect.mockResolvedValue({ status: 'found', crop })
    deps.save.mockRejectedValueOnce(new Error('save failed'))
    await expect(generateRandomAvatar(sources, deps)).rejects.toThrow('save failed')
    expect(deps.load).toHaveBeenCalledTimes(1)
  })

  it('handles no images and fewer than ten images', async () => {
    const deps = dependencies()
    expect(await generateRandomAvatar([], deps)).toBe('empty')
    expect(deps.load).not.toHaveBeenCalled()
    expect(await generateRandomAvatar(sources.slice(0, 2), deps)).toBe('exhausted')
    expect(deps.load).toHaveBeenCalledTimes(2)
    expect(deps.progress).toHaveBeenLastCalledWith(2, 2)
    expect(deps.save).not.toHaveBeenCalled()
  })
})
