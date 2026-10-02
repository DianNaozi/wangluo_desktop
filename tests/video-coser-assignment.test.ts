import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from '../src/main/import/database'
import { createVideoCoserAssignment } from '../src/main/import/video-coser-assignment'

describe('standalone video Coser placement', () => {
  let db: ReturnType<typeof createDatabase>['sqlite']
  let service: ReturnType<typeof createVideoCoserAssignment>
  let time: number
  beforeEach(() => {
    db = createDatabase(':memory:').sqlite; time = 1000
    db.exec(`INSERT INTO cosers (id, name, name_key, created_at, updated_at) VALUES ('target', 'Target', 'target', 0, 0), ('old', 'Old', 'old', 0, 0);
      INSERT INTO folders (id, title, created_at, updated_at) VALUES ('folder', 'Folder', 0, 0);
      INSERT INTO albums (id, title, created_at, updated_at) VALUES ('album', 'Album', 0, 0);`)
    const insert = db.prepare("INSERT INTO media_items (id, content_hash, media_kind, original_name, extension, byte_size, object_path, imported_at, folder_id) VALUES (?, ?, ?, ?, '.mp4', 1, 'objects/test.mp4', 0, ?)")
    insert.run('a', 'a', 'video', 'a.mp4', 'folder'); insert.run('b', 'b', 'video', 'b.mp4', null); insert.run('image', 'image', 'image', 'photo.jpg', null)
    db.exec("UPDATE media_items SET coser_id = 'old' WHERE id = 'b'")
    service = createVideoCoserAssignment(db, () => time)
  })
  afterEach(() => db.close())
  const rows = () => db.prepare('SELECT id, folder_id, coser_id FROM media_items ORDER BY id').all()
  it('deduplicates batches and restores original folder and Coser', () => {
    const before = rows(); const receipt = service.assign(['a', 'b', 'a'], 'target')
    expect(receipt.count).toBe(2)
    expect(db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE coser_id = 'target' AND folder_id IS NULL").get()).toEqual({ n: 2 })
    service.undo(receipt.operationId); expect(rows()).toEqual(before)
  })
  it.each(['missing', 'image', 'trashed', 'linked'])('rolls back invalid batches containing %s', invalid => {
    if (invalid === 'trashed') { db.exec("UPDATE media_items SET trash_state = 'trashed' WHERE id = 'b'"); invalid = 'b' }
    if (invalid === 'linked') { db.exec("INSERT INTO album_items VALUES ('album', 'b', 0)"); invalid = 'b' }
    const before = rows()
    expect(() => service.assign(['a', invalid], 'target')).toThrow()
    expect(rows()).toEqual(before)
  })
  it('rejects invalid input and targets without losing the previous receipt', () => {
    const receipt = service.assign(['a'], 'target')
    for (const ids of [[], null, [''], [1]]) expect(() => service.assign(ids, 'target')).toThrow()
    expect(() => service.assign(['b'], 'missing')).toThrow()
    service.undo(receipt.operationId)
  })
  it('invalidates replaced and expired receipts', () => {
    const first = service.assign(['a'], 'target'); const second = service.assign(['b'], 'target')
    expect(() => service.undo(first.operationId)).toThrow()
    time = second.expiresAt; expect(() => service.undo(second.operationId)).toThrow()
  })
  it('rejects same-millisecond placement changes but allows preview updates', () => {
    const receipt = service.assign(['a', 'b'], 'target')
    db.exec("UPDATE media_items SET preview_status = 'ready' WHERE id = 'a'")
    service.undo(receipt.operationId)
    const next = service.assign(['a', 'b'], 'target')
    db.exec("UPDATE media_items SET coser_id = coser_id WHERE id = 'b'")
    expect(() => service.undo(next.operationId)).toThrow('修改')
    expect(db.prepare("SELECT coser_id FROM media_items WHERE id = 'a'").get()).toEqual({ coser_id: 'target' })
  })
  it('rejects deleted original destinations', () => {
    const receipt = service.assign(['a'], 'target'); db.exec("DELETE FROM folders WHERE id = 'folder'")
    expect(() => service.undo(receipt.operationId)).toThrow('原文件夹')
  })
  it('releases videos when their Coser is deleted, including trashed videos', () => {
    service.assign(['a', 'b'], 'target'); db.exec("UPDATE media_items SET trash_state = 'trashed' WHERE id = 'b'; DELETE FROM cosers WHERE id = 'target'")
    expect(rows().filter((r: any) => r.id !== 'image')).toEqual([{ id: 'a', folder_id: null, coser_id: null }, { id: 'b', folder_id: null, coser_id: null }])
  })
  it('clears direct placement when imported into an active album or when an album is restored', () => {
    const receipt = service.assign(['a'], 'target')
    db.exec("INSERT INTO album_items VALUES ('album', 'a', 0)")
    expect(() => service.undo(receipt.operationId)).toThrow()
    expect(db.prepare("SELECT coser_id FROM media_items WHERE id = 'a'").get()).toEqual({ coser_id: null })
    db.exec("UPDATE albums SET trash_state = 'trashed' WHERE id = 'album'")
    service.assign(['a'], 'target')
    db.exec("UPDATE albums SET trash_state = 'active' WHERE id = 'album'")
    expect(db.prepare("SELECT coser_id FROM media_items WHERE id = 'a'").get()).toEqual({ coser_id: null })
  })
})
