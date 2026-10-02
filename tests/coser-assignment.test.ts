import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCoserAssignment } from '../src/main/import/coser-assignment'

describe('atomic Coser assignment and undo', () => {
  let db: Database.Database
  let time: number
  let service: ReturnType<typeof createCoserAssignment>
  beforeEach(() => {
    db = new Database(':memory:'); time = 1000
    db.exec(`CREATE TABLE albums (id TEXT PRIMARY KEY, folder_id TEXT, coser_id TEXT, updated_at INTEGER, trash_state TEXT);
      CREATE TABLE folders (id TEXT PRIMARY KEY, trash_state TEXT);
      CREATE TABLE cosers (id TEXT PRIMARY KEY, updated_at INTEGER);
      INSERT INTO folders VALUES ('folder', 'active');
      INSERT INTO cosers VALUES ('target', 0), ('original', 0);
      INSERT INTO albums VALUES ('a', 'folder', NULL, 10, 'active'), ('b', NULL, NULL, 20, 'active'), ('c', NULL, 'original', 30, 'active');`)
    service = createCoserAssignment(db, () => time)
  })
  afterEach(() => db.close())
  const placements = () => db.prepare('SELECT * FROM albums ORDER BY id').all()

  it('deduplicates, assigns atomically and restores exact original placements', () => {
    const original = placements()
    const result = service.assign(['a', 'b', 'c', 'a'], 'target')
    expect(result.count).toBe(3)
    expect(db.prepare("SELECT COUNT(*) AS n FROM albums WHERE coser_id = 'target' AND folder_id IS NULL").get()).toEqual({ n: 3 })
    service.undo(result.operationId)
    expect(placements()).toEqual(original)
    expect(() => service.undo(result.operationId)).toThrow('过期')
  })
  it('rolls back invalid batches and preserves the prior undo receipt', () => {
    const receipt = service.assign(['a'], 'target')
    const before = placements()
    expect(() => service.assign(['b', 'missing'], 'target')).toThrow('不存在')
    expect(() => service.assign(['b'], 'missing')).toThrow('不存在')
    expect(() => service.assign([], 'target')).toThrow('请选择')
    expect(placements()).toEqual(before)
    service.undo(receipt.operationId)
  })
  it('rejects a trashed album without moving other albums', () => {
    db.prepare("UPDATE albums SET trash_state = 'trashed' WHERE id = 'b'").run()
    const before = placements()
    expect(() => service.assign(['a', 'b'], 'target')).toThrow('回收站')
    expect(placements()).toEqual(before)
  })
  it('invalidates previous receipts and expires after 30 seconds', () => {
    const first = service.assign(['a'], 'target')
    const second = service.assign(['b'], 'target')
    expect(() => service.undo(first.operationId)).toThrow('替代')
    time = second.expiresAt
    expect(() => service.undo(second.operationId)).toThrow('过期')
  })
  it('does not undo any album if one changed even within the same millisecond', () => {
    const result = service.assign(['a', 'b'], 'target')
    db.prepare("UPDATE albums SET updated_at = updated_at WHERE id = 'b'").run()
    const before = placements()
    expect(() => service.undo(result.operationId)).toThrow('已被修改')
    expect(placements()).toEqual(before)
  })
  it.each(['folder', 'coser'])('rejects undo when the original %s no longer exists', kind => {
    const result = service.assign(['a', 'c'], 'target')
    db.exec(kind === 'folder' ? "DELETE FROM folders WHERE id = 'folder'" : "DELETE FROM cosers WHERE id = 'original'")
    const before = placements()
    expect(() => service.undo(result.operationId)).toThrow('已不存在')
    expect(placements()).toEqual(before)
  })
})
