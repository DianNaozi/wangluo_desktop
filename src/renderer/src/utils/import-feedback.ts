export type ImportCompletionNotice = {
  id: string
  tone: 'success' | 'warning'
  title: string
  detail: string
}

export function importProgress(job: ImportJobSummary): number {
  if (job.totalEntries === 0) return 100
  const completedEntries = Math.min(job.totalEntries, job.processedEntries + job.skippedEntries)
  return Math.round(completedEntries / job.totalEntries * 100)
}

export function isTerminalImportJob(status: ImportJobStatus): boolean {
  return status === 'completed' || status === 'partial_failed'
}

export function recordTerminalImportJob(job: ImportJobSummary, completedJobIds: Set<string>): boolean {
  if (!isTerminalImportJob(job.status)) {
    completedJobIds.delete(job.id)
    return false
  }
  if (completedJobIds.has(job.id)) return false
  completedJobIds.add(job.id)
  return true
}

export function importCompletionNotice(job: ImportJobSummary): ImportCompletionNotice {
  const hasWarnings = job.status === 'partial_failed' || job.failedEntries > 0 || job.sourceCleanupFailedEntries > 0
  const details = [`新增 ${job.importedEntries}`, `去重 ${job.duplicateEntries}`, `跳过 ${job.skippedEntries}`]
  if (job.failedEntries > 0) details.push(`失败 ${job.failedEntries}`)
  if (job.sourceCleanupFailedEntries > 0) details.push(`源文件保留 ${job.sourceCleanupFailedEntries}`)
  return {
    id: `${job.id}:${job.completedAt ?? Date.now()}`,
    tone: hasWarnings ? 'warning' : 'success',
    title: hasWarnings ? '导入部分完成' : '导入完成',
    detail: details.join(' · ')
  }
}
