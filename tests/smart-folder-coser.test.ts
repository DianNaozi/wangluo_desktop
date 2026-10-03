import { describe, expect, it } from 'vitest'
import { findFolderCoserMatches, normalizeFolderImportIdentity, rankFolderCoserCandidates, validateFolderCoserModelResult, type SmartCoserIndexItem, type SmartFolderModelResult } from '../src/main/import/smart-folder-coser'

const cosers: SmartCoserIndexItem[] = [
  { id: 'yuzu', name: '青柚', aliases: ['Aoi Yuzu'] },
  { id: 'long-yuzu', name: '青柚子', aliases: ['Yuzu'] },
  { id: 'momo', name: '白桃', aliases: ['Momo'] }
]

describe('smart folder Coser matching', () => {
  it('matches an exact name or alias in a folder name after width and punctuation normalization', () => {
    expect(findFolderCoserMatches('【青柚】夏日合集', '2026', cosers)).toEqual(['yuzu'])
    expect(findFolderCoserMatches('[ＡｏｉＹｕｚｕ] Costume', 'Downloads', cosers)).toEqual(['yuzu'])
  })

  it('uses the parent as supporting context and keeps contradictory parent hits for review', () => {
    expect(findFolderCoserMatches('生日合集', '白桃', cosers)).toEqual(['momo'])
    expect(findFolderCoserMatches('青柚', '白桃', cosers)).toEqual(['yuzu', 'momo'])
  })

  it('does not match a shorter name inside a longer token and ranks relevant candidates for the model', () => {
    expect(findFolderCoserMatches('青柚子 泳装', 'Downloads', cosers)).toEqual(['long-yuzu'])
    expect(findFolderCoserMatches('青柚子泳装', 'Downloads', cosers)).toEqual([])
    expect(rankFolderCoserCandidates('青柚子泳装', 'Downloads', cosers)[0]?.id).toBe('long-yuzu')
  })

  it('keeps distinct folder punctuation in learned import identities', () => {
    expect(normalizeFolderImportIdentity(' A-B ')).not.toBe(normalizeFolderImportIdentity('AB'))
  })

  it('accepts only a valid candidate and evidence drawn from the source names', () => {
    const valid: SmartFolderModelResult = { status: 'matched', coserId: 'yuzu', proposedName: '', evidence: '青柚', reason: '主名命中' }
    expect(validateFolderCoserModelResult(valid, { sourceName: '【青柚】泳装', parentName: '2026' }, cosers)?.coserId).toBe('yuzu')
    expect(validateFolderCoserModelResult({ ...valid, evidence: '白桃' }, { sourceName: '生日合集', parentName: '2026' }, cosers)).toBeNull()
    expect(validateFolderCoserModelResult({ ...valid, coserId: 'deleted-coser' }, { sourceName: '【青柚】泳装', parentName: '' }, cosers)).toBeNull()
  })

  it('rejects an ambiguous result carrying one Coser ID and requires new-name evidence in the source', () => {
    const ambiguous: SmartFolderModelResult = { status: 'ambiguous', coserId: 'yuzu', proposedName: '', evidence: '青柚＆白桃', reason: '合拍' }
    expect(validateFolderCoserModelResult(ambiguous, { sourceName: '青柚＆白桃 合拍', parentName: '' }, cosers)).toBeNull()

    const newName: SmartFolderModelResult = { status: 'new', coserId: 'none', proposedName: '茶茶', evidence: '茶茶', reason: '可能的新 Coser' }
    expect(validateFolderCoserModelResult(newName, { sourceName: '[茶茶] 新图', parentName: '' }, cosers)?.proposedName).toBe('茶茶')
    expect(validateFolderCoserModelResult({ ...newName, proposedName: '小茶' }, { sourceName: '[茶茶] 新图', parentName: '' }, cosers)).toBeNull()
  })
})
