import { describe, expect, it } from 'vitest'
import { importCompletionNotice, importProgress, recordTerminalImportJob } from '../src/renderer/src/utils/import-feedback'

function job(overrides: Partial<ImportJobSummary> = {}): ImportJobSummary {
  return {
    id: 'job-1', sourceKind: 'files', status: 'running', totalEntries: 10, totalBytes: 1024,
    processedEntries: 0, importedEntries: 0, duplicateEntries: 0, failedEntries: 0, skippedEntries: 0,
    sourceCleanupFailedEntries: 0, createdAt: 1, startedAt: 1, completedAt: null,
    ...overrides
  }
}

describe('import feedback', () => {
  it('calculates progress from processed and skipped file entries', () => {
    expect(importProgress(job({ totalEntries: 0 }))).toBe(100)
    expect(importProgress(job({ processedEntries: 3, skippedEntries: 2 }))).toBe(50)
    expect(importProgress(job({ processedEntries: 12 }))).toBe(100)
  })

  it('emits a completion result once until the job is retried', () => {
    const completedJobIds = new Set<string>()
    const complete = job({ status: 'completed', completedAt: 100 })
    expect(recordTerminalImportJob(complete, completedJobIds)).toBe(true)
    expect(recordTerminalImportJob(complete, completedJobIds)).toBe(false)
    expect(recordTerminalImportJob(job({ status: 'running' }), completedJobIds)).toBe(false)
    expect(recordTerminalImportJob(complete, completedJobIds)).toBe(true)
  })

  it('summarizes successful and partially failed imports', () => {
    expect(importCompletionNotice(job({ status: 'completed', completedAt: 100, importedEntries: 3, duplicateEntries: 2, skippedEntries: 1 }))).toMatchObject({ tone: 'success', title: '导入完成', detail: '新增 3 · 去重 2 · 跳过 1' })
    expect(importCompletionNotice(job({ status: 'partial_failed', completedAt: 200, importedEntries: 2, failedEntries: 1, sourceCleanupFailedEntries: 1 }))).toMatchObject({ tone: 'warning', title: '导入部分完成', detail: '新增 2 · 去重 0 · 跳过 0 · 失败 1 · 源文件保留 1' })
  })
})
