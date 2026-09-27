import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

export type ByteRange = { start: number; end: number }

export function parseSingleRange(value: string | null, size: number): ByteRange | null {
  if (!value) return { start: 0, end: size - 1 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size <= 0) return null
  const [, startText, endText] = match
  if (!startText && !endText) return null
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startText)
  const end = endText ? Number(endText) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

export function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.mp4': case '.m4v': return 'video/mp4'
    case '.webm': return 'video/webm'
    case '.mov': return 'video/quicktime'
    case '.avi': return 'video/x-msvideo'
    case '.mkv': return 'video/x-matroska'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'application/octet-stream'
  }
}

export async function createMediaResponse(path: string, rangeHeader: string | null): Promise<Response> {
  const info = await stat(path)
  if (!info.isFile()) return new Response('Not found', { status: 404 })
  const range = parseSingleRange(rangeHeader, info.size)
  if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}`, 'Accept-Ranges': 'bytes' } })
  const length = range.end - range.start + 1
  const body = Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as ReadableStream
  const headers: Record<string, string> = { 'Accept-Ranges': 'bytes', 'Content-Type': contentTypeForPath(path), 'Content-Length': String(length) }
  if (rangeHeader) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`
  return new Response(body, { status: rangeHeader ? 206 : 200, headers })
}
