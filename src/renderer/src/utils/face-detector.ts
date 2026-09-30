import { FaceDetector, FilesetResolver, type Detection } from '@mediapipe/tasks-vision'

export type AvatarFaceDetection =
  | { status: 'found'; crop: AvatarCrop }
  | { status: 'not-found' }
  | { status: 'failed'; message: string }

let wasmPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
let modelPromise: Promise<Uint8Array> | null = null

function modelAsset(path: string): string {
  return `gallery-app-asset://${path}`
}

async function faceDetector(): Promise<FaceDetector> {
  if (!wasmPromise) wasmPromise = FilesetResolver.forVisionTasks(modelAsset('mediapipe/'))
  if (!modelPromise) {
    modelPromise = fetch(modelAsset('models/blaze_face_short_range.tflite')).then(async (response) => {
      if (!response.ok) throw new Error(`无法读取人脸模型（HTTP ${response.status}）`)
      return new Uint8Array(await response.arrayBuffer())
    })
  }
  try {
    const [wasm, model] = await Promise.all([wasmPromise, modelPromise])
    // A static image task has no meaningful frame clock. Create an IMAGE-mode
    // graph for this one image, then close it, so consecutive avatar choices
    // cannot reuse the graph's previous packet timestamp.
    return FaceDetector.createFromOptions(wasm, {
      baseOptions: { modelAssetBuffer: model },
      runningMode: 'IMAGE'
    })
  } catch (error) {
    wasmPromise = null
    modelPromise = null
    throw error
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function cropFromFaces(detections: Detection[], imageWidth: number, imageHeight: number): AvatarCrop | null {
  if (!imageWidth || !imageHeight) return null
  const candidates = detections.flatMap((detection) => {
    const box = detection.boundingBox
    if (!box || box.width <= 0 || box.height <= 0) return []
    const centerX = box.originX + box.width / 2
    const centerY = box.originY + box.height / 2
    const areaScore = (box.width * box.height) / (imageWidth * imageHeight)
    const centerDistance = Math.hypot(centerX - imageWidth / 2, centerY - imageHeight / 2) / Math.hypot(imageWidth / 2, imageHeight / 2)
    return [{ box, score: areaScore + (1 - clamp(centerDistance, 0, 1)) * 0.01 }]
  })
  const face = candidates.sort((left, right) => right.score - left.score)[0]?.box
  if (!face) return null

  const smallestDimension = Math.min(imageWidth, imageHeight)
  const side = clamp(Math.max(face.width, face.height) * 2.25, smallestDimension * 0.25, smallestDimension)
  const left = clamp(face.originX + face.width / 2 - side / 2, 0, imageWidth - side)
  const top = clamp(face.originY + face.height / 2 - side / 2, 0, imageHeight - side)
  return { left: left / imageWidth, top: top / imageHeight, size: side / smallestDimension }
}

export async function detectAvatarFace(image: HTMLImageElement): Promise<AvatarFaceDetection> {
  let detector: FaceDetector | null = null
  try {
    detector = await faceDetector()
    const result = detector.detect(image)
    const crop = cropFromFaces(result.detections, image.naturalWidth, image.naturalHeight)
    return crop ? { status: 'found', crop } : { status: 'not-found' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('Coser 头像人脸检测失败', error)
    return { status: 'failed', message }
  } finally {
    detector?.close()
  }
}
