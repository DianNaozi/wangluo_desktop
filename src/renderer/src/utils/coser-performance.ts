export type CoserPerformanceTrace = (stage: string) => void

export function startCoserPerformanceTrace(coserId: string): CoserPerformanceTrace {
  const startedAt = performance.now()
  return (stage) => {
    if (!import.meta.env.DEV) return
    console.info(`[coser-perf] ${coserId || 'route'} ${stage}: ${Math.round(performance.now() - startedAt)} ms`)
  }
}
