import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('album card', () => {
  it('renders its optional footer slot so folder-only actions remain available', async () => {
    const source = await readFile(new URL('../src/renderer/src/components/albums/AlbumCard.vue', import.meta.url), 'utf8')

    expect(source).toContain('<slot name="footer" />')
  })
})
