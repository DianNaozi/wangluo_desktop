import { describe, expect, it } from 'vitest'
import { toggleAlbumSelection } from '../src/renderer/src/utils/album-selection'
describe('album selection', () => {
  it('toggles without modifying the prior selection', () => {
    const original = new Set(['a'])
    expect([...toggleAlbumSelection(original, ['a', 'b'], 'a', null, false)]).toEqual([])
    expect([...original]).toEqual(['a'])
    expect([...toggleAlbumSelection(original, ['a', 'b'], 'b', null, false)]).toEqual(['a', 'b'])
  })
  it('selects a range in current display order in either direction', () => {
    for (const [anchor, end] of [['a', 'c'], ['c', 'a']]) {
      expect([...toggleAlbumSelection(new Set(), ['d', 'c', 'b', 'a'], end, anchor, true)]).toEqual(['c', 'b', 'a'])
    }
  })
  it('ignores hidden targets and treats a missing anchor as a single toggle', () => {
    expect([...toggleAlbumSelection(new Set(), ['a'], 'b', null, true)]).toEqual([])
    expect([...toggleAlbumSelection(new Set(), ['a'], 'a', 'hidden', true)]).toEqual(['a'])
  })
})
