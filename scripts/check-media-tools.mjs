import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')
const ffprobe = require('ffprobe-static').path
const repair = process.argv.includes('--repair')

function check(path) {
  if (!path) return '当前平台没有可用的程序'
  const result = spawnSync(path, ['-version'], { windowsHide: true, timeout: 15_000 })
  return result.status === 0 ? null : result.error?.message || result.stderr?.toString() || `退出码 ${result.status}`
}

async function repairFfmpeg() {
  if (!ffmpeg || process.env.FFMPEG_BIN) throw new Error('请检查 FFMPEG_BIN 指定的程序或当前平台支持情况')
  const pkg = require('ffmpeg-static/package.json')['ffmpeg-static']
  const release = process.env.FFMPEG_BINARY_RELEASE || pkg['binary-release-tag']
  const base = process.env.FFMPEG_BINARIES_URL || 'https://github.com/eugeneware/ffmpeg-static/releases/download'
  const temporary = `${ffmpeg}.${process.pid}.download${process.platform === 'win32' ? '.exe' : ''}`
  try {
    const response = await fetch(`${base}/${release}/ffmpeg-${process.platform}-${process.arch}.gz`, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok || !response.body) throw new Error(`FFmpeg 下载失败：HTTP ${response.status}`)
    await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(temporary, { mode: 0o755 }))
    const error = check(temporary)
    if (error) throw new Error(`下载的 FFmpeg 无法运行：${error}`)
    await rename(temporary, ffmpeg)
    console.log('FFmpeg 已重新下载并通过运行校验。')
  } finally {
    await rm(temporary, { force: true })
  }
}

try {
  if (check(ffmpeg) && repair) await repairFfmpeg()
  for (const [name, path] of [['FFmpeg', ffmpeg], ['FFprobe', ffprobe]]) {
    const error = check(path)
    if (error) throw new Error(`${name} 不可用（${path}）：${error}\n视频封面无法生成。${name === 'FFmpeg' ? '请运行 npm.cmd run repair:media。' : '请重新安装 ffprobe-static。'}`)
  }
  console.log('FFmpeg / FFprobe 校验通过。')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
