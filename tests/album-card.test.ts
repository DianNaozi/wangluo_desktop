import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('album card', () => {
  it('renders its optional footer slot so folder-only actions remain available', async () => {
    const source = await readFile(new URL('../src/renderer/src/components/albums/AlbumCard.vue', import.meta.url), 'utf8')

    expect(source).toContain('<slot name="footer" />')
  })

  it('offers optional Coser assignment without changing card rendering by default', async () => {
    const source = await readFile(new URL('../src/renderer/src/components/albums/AlbumCard.vue', import.meta.url), 'utf8')

    expect(source).toContain('canAssignCoser')
    expect(source).toContain("$emit('assignCoser')")
  })

  it('reuses AlbumCard for Coser-owned image packages', async () => {
    const source = await readFile(new URL('../src/renderer/src/pages/CosersPage.vue', import.meta.url), 'utf8')

    expect(source).toContain("import AlbumCard from '@/components/albums/AlbumCard.vue'")
    expect(source).toContain('<AlbumCard v-for="album in selected.albums"')
  })

  it('renders saved avatars and generates replacements without a crop editor', async () => {
    const page = await readFile(new URL('../src/renderer/src/pages/CosersPage.vue', import.meta.url), 'utf8')

    expect(page).toContain('avatarUrl')
    expect(page).toContain('detectAvatarFace')
    expect(page).toContain('saveCoserAvatar')
    expect(page).toContain("image.crossOrigin = 'anonymous'")
    expect(page).not.toContain('CoserAvatarCropDialog')
  })

  it('automatically detects a face without falling back to a manual crop', async () => {
    const page = await readFile(new URL('../src/renderer/src/pages/CosersPage.vue', import.meta.url), 'utf8')
    const detector = await readFile(new URL('../src/renderer/src/utils/face-detector.ts', import.meta.url), 'utf8')

    expect(page).toContain('本次图片未检测到可用人脸，头像未更改。可以再次随机生成。')
    expect(detector).toContain('@mediapipe/tasks-vision')
  })

  it('chooses an avatar source from the current Coser image packages', async () => {
    const page = await readFile(new URL('../src/renderer/src/pages/CosersPage.vue', import.meta.url), 'utf8')
    expect(page).toContain('getCoserAvatarMedia')
    expect(page).not.toContain('CoserAvatarSourceDialog')
  })
})
