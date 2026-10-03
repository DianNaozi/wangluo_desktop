import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlaybackStore } from '../src/renderer/src/stores/playback'

type QueueStore = {
  queue: Array<{ id: string; title: string; source: string; type: 'image' | 'video'; mediaUrl: string; previewUrl: string | null }>
  addMediaBatch: (items: Array<{ id: string; originalName: string; mediaKind: 'image' | 'video' | 'file'; previewUrl: string | null; mediaUrl: string }>, source: string) => number
}

const image = { id: 'image-1', originalName: 'cover.jpg', mediaKind: 'image' as const, previewUrl: 'gallery-preview://image-1', mediaUrl: 'gallery-media://image-1' }
const video = { id: 'video-1', originalName: 'clip.mp4', mediaKind: 'video' as const, previewUrl: 'gallery-preview://video-1', mediaUrl: 'gallery-media://video-1' }
const secondImage = { id: 'image-2', originalName: 'sunset.jpg', mediaKind: 'image' as const, previewUrl: 'gallery-preview://image-2', mediaUrl: 'gallery-media://image-2' }
const file = { id: 'file-1', originalName: 'notes.pdf', mediaKind: 'file' as const, previewUrl: null, mediaUrl: 'gallery-media://file-1' }
const libraryImage = (id: string, originalName: string) => ({ id, originalName, mediaKind: 'image' as const, importedAt: 1, previewUrl: `gallery-preview://${id}`, mediaUrl: `gallery-media://${id}`, previewStatus: 'ready' as const, previewError: null })

describe('playback queue', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('adds playable media with their real URLs and skips unsupported files', () => {
    const playback = usePlaybackStore() as unknown as QueueStore

    expect(playback.addMediaBatch([image, video, file], '旅行相册')).toBe(2)
    expect(playback.queue.map(({ id, title, source, type, mediaUrl, previewUrl }) => ({ id, title, source, type, mediaUrl, previewUrl }))).toEqual([
      { id: 'image-1', title: 'cover.jpg', source: '旅行相册', type: 'image', mediaUrl: 'gallery-media://image-1', previewUrl: 'gallery-preview://image-1' },
      { id: 'video-1', title: 'clip.mp4', source: '旅行相册', type: 'video', mediaUrl: 'gallery-media://video-1', previewUrl: 'gallery-preview://video-1' }
    ])
  })

  it('preserves queue order and ignores media already queued', () => {
    const playback = usePlaybackStore() as unknown as QueueStore

    playback.addMediaBatch([image], '旅行相册')
    expect(playback.addMediaBatch([image, video], '旅行相册')).toBe(1)
    expect(playback.queue.map((item) => item.id)).toEqual(['image-1', 'video-1'])
  })

  it('keeps the same media selected after removing an earlier queue item', () => {
    const playback = usePlaybackStore() as unknown as QueueStore & { jump: (index: number) => void; remove: (id: string) => void; currentItem: { id: string } }

    playback.addMediaBatch([image, video, secondImage], '旅行相册')
    playback.jump(1)
    playback.remove(image.id)

    expect(playback.currentItem.id).toBe(video.id)
  })

  it('keeps album boundaries and permits shared media in different albums', () => {
    const playback = usePlaybackStore()
    const shared = libraryImage('shared', 'shared.jpg')

    expect(playback.addAlbums([
      { albumId: 'album-a', title: '图包 A', media: [shared], sortOrder: 'filename' },
      { albumId: 'album-b', title: '图包 B', media: [shared], sortOrder: 'filename' },
      { albumId: 'album-a', title: '图包 A', media: [shared], sortOrder: 'filename' }
    ])).toBe(2)
    expect(playback.entries.map((entry) => entry.entryId)).toEqual(['album:album-a', 'album:album-b'])
    expect(playback.queue.map((item) => item.key)).toEqual(['album:album-a\u0000shared', 'album:album-b\u0000shared'])
  })

  it('moves a package without changing the currently selected item', () => {
    const playback = usePlaybackStore()
    playback.addAlbums([
      { albumId: 'album-a', title: '图包 A', media: [libraryImage('a', 'a.jpg')], sortOrder: 'filename' },
      { albumId: 'album-b', title: '图包 B', media: [libraryImage('b', 'b.jpg')], sortOrder: 'filename' }
    ])
    playback.entryIndex = 1
    playback.currentMediaIndex = 0
    playback.moveEntry('album:album-b', -1)

    expect(playback.entries.map((entry) => entry.entryId)).toEqual(['album:album-b', 'album:album-a'])
    expect(playback.currentItem?.id).toBe('b')
    expect(playback.currentEntryId).toBe('album:album-b')
  })
})
