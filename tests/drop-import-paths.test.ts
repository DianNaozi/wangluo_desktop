import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateDroppedFolderPaths } from '../src/main/import/drop-paths'

describe('dropped folder path validation', () => {
  let root: string

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'gallery-drop-paths-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('deduplicates roots and keeps a dropped parent instead of its child', async () => {
    const parent = join(root, 'parent')
    const child = join(parent, 'child')
    const storage = join(root, 'managed-storage')
    await mkdir(child, { recursive: true })
    await mkdir(storage)

    await expect(validateDroppedFolderPaths([child, parent, parent], storage)).resolves.toEqual([resolve(parent)])
  })

  it('rejects regular files with guidance to use the file importer', async () => {
    const file = join(root, 'picture.jpg')
    const storage = join(root, 'managed-storage')
    await writeFile(file, 'image')
    await mkdir(storage)

    await expect(validateDroppedFolderPaths([file], storage)).rejects.toThrow('请使用“导入文件”入口')
  })

  it('rejects a dropped source that contains or is inside managed storage', async () => {
    const source = join(root, 'source')
    const storage = join(source, 'managed-storage')
    await mkdir(storage, { recursive: true })

    await expect(validateDroppedFolderPaths([source], storage)).rejects.toThrow('与图库资源目录重叠')
    await expect(validateDroppedFolderPaths([storage], storage)).rejects.toThrow('与图库资源目录重叠')
  })
})
