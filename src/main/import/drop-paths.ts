import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

function isInside(root: string, candidate: string): boolean {
  const relation = relative(resolve(root), resolve(candidate))
  return relation === '' || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`))
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

export function pathsOverlap(first: string, second: string): boolean {
  return isInside(first, second) || isInside(second, first)
}

export async function validateDroppedFolderPaths(rawPaths: unknown, storagePath: string): Promise<string[]> {
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) throw new Error('没有可导入的文件夹')
  if (!rawPaths.every((path): path is string => typeof path === 'string' && path.length > 0)) throw new Error('拖入的路径无效，请重新拖入文件夹')

  let storageRoot: string
  try { storageRoot = await realpath(storagePath) }
  catch { throw new Error('无法访问图库资源目录，暂时不能导入') }

  const resolvedPaths: Array<{ path: string; index: number }> = []
  const seen = new Set<string>()
  for (const [index, sourcePath] of rawPaths.entries()) {
    if (!isAbsolute(sourcePath)) throw new Error('拖入的路径无效，请重新拖入文件夹')
    let info
    try { info = await lstat(sourcePath) }
    catch { throw new Error(`无法访问拖入的路径：${sourcePath}`) }
    if (info.isSymbolicLink()) throw new Error(`不支持导入目录链接：${sourcePath}`)
    if (!info.isDirectory()) {
      if (info.isFile()) throw new Error('拖入了普通文件，请使用“导入文件”入口')
      throw new Error(`拖入的路径不是文件夹：${sourcePath}`)
    }

    let canonicalPath: string
    try { canonicalPath = await realpath(sourcePath) }
    catch { throw new Error(`无法访问拖入的文件夹：${sourcePath}`) }
    if (pathsOverlap(canonicalPath, storageRoot)) throw new Error('不能导入与图库资源目录重叠的文件夹')

    const key = pathKey(canonicalPath)
    if (seen.has(key)) continue
    seen.add(key)
    resolvedPaths.push({ path: canonicalPath, index })
  }

  const roots = resolvedPaths.filter((candidate) => !resolvedPaths.some((other) => other !== candidate && isInside(other.path, candidate.path)))
  return roots.sort((first, second) => first.index - second.index).map(({ path }) => path)
}
