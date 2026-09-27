import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentTypeForPath, createMediaResponse, parseSingleRange } from '../src/main/media-response'

describe('media range responses', () => {
  it('parses explicit, open-ended, and suffix byte ranges', () => {
    expect(parseSingleRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseSingleRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 })
    expect(parseSingleRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
  })

  it('rejects invalid, multiple, and out-of-bounds ranges', () => {
    expect(parseSingleRange('bytes=10-12', 10)).toBeNull()
    expect(parseSingleRange('bytes=2-1', 10)).toBeNull()
    expect(parseSingleRange('bytes=0-1,3-4', 10)).toBeNull()
  })

  it('maps common media extensions to browser-safe MIME types', () => {
    expect(contentTypeForPath('video.mp4')).toBe('video/mp4')
    expect(contentTypeForPath('clip.webm')).toBe('video/webm')
    expect(contentTypeForPath('photo.jpg')).toBe('image/jpeg')
  })

  it('returns a partial media response with the requested bytes and headers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-response-'))
    const file = join(directory, 'clip.mp4')
    try {
      await writeFile(file, '0123456789')
      const response = await createMediaResponse(file, 'bytes=2-5')
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
      expect(response.headers.get('content-type')).toBe('video/mp4')
      await expect(response.text()).resolves.toBe('2345')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
