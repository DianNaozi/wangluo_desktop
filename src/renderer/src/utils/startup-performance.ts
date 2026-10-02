const rendererStartedAt = performance.now()
let firstVisibleThumbnailReported = false
let firstVisibleThumbnailObserver: IntersectionObserver | undefined

export function reportStartupStage(stage: string): void {
  if (!import.meta.env.DEV) return
  console.info(`[startup-perf] ${stage}: ${Math.round(performance.now() - rendererStartedAt)} ms after renderer start`)
}

export function reportFirstVisibleThumbnail(event: Event): void {
  if (!import.meta.env.DEV || firstVisibleThumbnailReported) return
  const image = event.currentTarget
  if (!(image instanceof HTMLImageElement)) return

  firstVisibleThumbnailObserver ??= new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    firstVisibleThumbnailReported = true
    firstVisibleThumbnailObserver?.disconnect()
    firstVisibleThumbnailObserver = undefined
    reportStartupStage('first visible thumbnail loaded')
  }, { threshold: 0.01 })
  firstVisibleThumbnailObserver.observe(image)
}
