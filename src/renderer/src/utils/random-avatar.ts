import type { AvatarFaceDetection } from './face-detector'

type Source = { id: string; mediaUrl: string }
type Dependencies = {
  load: (url: string) => Promise<HTMLImageElement>
  detect: (image: HTMLImageElement) => Promise<AvatarFaceDetection>
  save: (mediaId: string, crop: AvatarCrop) => Promise<void>
  progress: (current: number, total: number) => void
}

export async function generateRandomAvatar(sources: Source[], dependencies: Dependencies): Promise<'saved' | 'empty' | 'exhausted'> {
  const candidates = [...new Map(sources.map(source => [source.id, source])).values()]
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  const batch = candidates.slice(0, 10)
  if (!batch.length) return 'empty'
  for (const [index, source] of batch.entries()) {
    dependencies.progress(index + 1, batch.length)
    let image: HTMLImageElement
    try { image = await dependencies.load(source.mediaUrl) }
    catch { continue }
    const result = await dependencies.detect(image)
    if (result.status === 'failed') throw new Error(`人脸识别失败：${result.message}`)
    if (result.status === 'not-found') continue
    await dependencies.save(source.id, result.crop)
    return 'saved'
  }
  return 'exhausted'
}
