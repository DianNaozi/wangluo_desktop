import { describe, expect, it } from 'vitest'
import { normalizeFolderName } from '../src/renderer/src/utils/folder-name'

describe('folder name input', () => {
  it('trims valid names and rejects blank names', () => {
    expect(normalizeFolderName('  旅行照片  ')).toBe('旅行照片')
    expect(normalizeFolderName(' \n\t ')).toBeNull()
  })
})
