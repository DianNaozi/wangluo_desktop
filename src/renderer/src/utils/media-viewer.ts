export type ImageTransform = { scale: number; x: number; y: number }

export function clampViewerIndex(index: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), index))
}

export function previousViewerIndex(index: number): number { return Math.max(0, index - 1) }
export function nextViewerIndex(index: number, length: number): number { return clampViewerIndex(index + 1, length) }
export function resetImageTransform(): ImageTransform { return { scale: 1, x: 0, y: 0 } }
