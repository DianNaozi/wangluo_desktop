import { describe, expect, it } from 'vitest'
import { runBoundedProcess } from '../src/main/import/process-runner'

describe('runBoundedProcess', () => {
  it('terminates a process that exceeds its deadline', async () => {
    await expect(runBoundedProcess(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 25, maxOutputBytes: 1024 }))
      .rejects.toThrow('命令执行超时')
  })

  it('caps captured command output when a process fails', async () => {
    await expect(runBoundedProcess(process.execPath, ['-e', "process.stderr.write('x'.repeat(4096)); process.exit(2)"], { timeoutMs: 1000, maxOutputBytes: 128 }))
      .rejects.toThrow(/x{128}/)
  })

  it('shares the output cap between stdout and stderr', async () => {
    const result = await runBoundedProcess(process.execPath, ['-e', "process.stdout.write('a'.repeat(96)); process.stderr.write('b'.repeat(96))"], { timeoutMs: 1000, maxOutputBytes: 128 })
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(128)
    expect(result.stdout).toContain('a')
  })
})
