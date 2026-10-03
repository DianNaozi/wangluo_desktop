// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Detection } from '@mediapipe/tasks-vision'
import { cropFromFaces } from '../src/renderer/src/utils/face-detector'

function face(originX: number, originY: number, width: number, height: number): Detection {
  return { categories: [], keypoints: [], boundingBox: { originX, originY, width, height, angle: 0 } }
}

describe('Coser avatar face crop', () => {
  it('loads MediaPipe resources through the restricted Electron asset protocol', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('../src/renderer/src/utils/face-detector.ts', import.meta.url), 'utf8')

    expect(source).toContain('gallery-app-asset://')
    expect(source).toContain('createFromOptions')
    expect(source).toContain("runningMode: 'IMAGE'")
    expect(source).toContain('detector?.close()')
  })

  it('prioritizes the largest detected face and returns a valid square crop', () => {
    const crop = cropFromFaces([face(420, 420, 160, 160), face(0, 400, 280, 280)], 1000, 1000)

    expect(crop).toEqual({ left: 0, top: 225 / 1000, size: 0.63 })
  })

  it('returns no crop when no usable face is available', () => {
    expect(cropFromFaces([], 1000, 1000)).toBeNull()
  })
})
