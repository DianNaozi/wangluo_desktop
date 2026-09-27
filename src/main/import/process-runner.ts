import { spawn } from 'node:child_process'

export type ProcessRunOptions = {
  timeoutMs: number
  maxOutputBytes: number
}

export type ProcessRunResult = {
  stdout: string
  stderr: string
}

function appendBounded(current: string, chunk: Buffer, remaining: number): string {
  if (remaining <= 0) return current
  return current + chunk.subarray(0, remaining).toString()
}

export function runBoundedProcess(binary: string, args: string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let capturedBytes = 0
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    const timeout = setTimeout(() => {
      try { child.kill() } catch { /* The process may have already exited. */ }
      finish(() => reject(new Error(`命令执行超时（${options.timeoutMs}ms）`)))
    }, options.timeoutMs)
    const capture = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const remaining = options.maxOutputBytes - capturedBytes
      const captured = chunk.subarray(0, Math.max(0, remaining))
      capturedBytes += captured.byteLength
      if (stream === 'stdout') stdout = appendBounded(stdout, captured, remaining)
      else stderr = appendBounded(stderr, captured, remaining)
    }
    child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk))
    child.once('error', (error) => finish(() => reject(error)))
    child.once('close', (code) => finish(() => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr || stdout || `命令退出，代码 ${code ?? 'unknown'}`))
    }))
  })
}
