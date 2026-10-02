import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

type Placement = { id: string; folder_id: string | null; coser_id: string | null; updated_at: number }
export type AssignmentResult = { count: number; operationId: string; expiresAt: number }

export function createCoserAssignment(sqlite: Database.Database, now = Date.now) {
  let latest: { result: AssignmentResult; albums: Placement[]; target: string } | undefined
  // Connection-local tracking catches even same-millisecond changes without a migration.
  sqlite.exec(`CREATE TEMP TABLE coser_undo_changes (id TEXT PRIMARY KEY, changed INTEGER NOT NULL DEFAULT 0);
    CREATE TEMP TRIGGER coser_undo_update AFTER UPDATE ON main.albums BEGIN
      UPDATE coser_undo_changes SET changed = 1 WHERE id = NEW.id;
    END;
    CREATE TEMP TRIGGER coser_undo_delete AFTER DELETE ON main.albums BEGIN
      UPDATE coser_undo_changes SET changed = 1 WHERE id = OLD.id;
    END;`)
  function assign(albumIds: unknown, coserId: unknown): AssignmentResult {
    if (!Array.isArray(albumIds) || !albumIds.length || albumIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('请选择有效图集')
    if (typeof coserId !== 'string' || !sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(coserId)) throw new Error('目标 Coser 不存在')
    const ids = [...new Set(albumIds as string[])]
    const result = { count: ids.length, operationId: randomUUID(), expiresAt: now() + 30_000 }
    const albums = sqlite.transaction(() => {
      const rows = ids.map(id => {
        const row = sqlite.prepare("SELECT id, folder_id, coser_id, updated_at FROM albums WHERE id = ? AND trash_state = 'active'").get(id) as Placement | undefined
        if (!row) throw new Error('图集不存在或已在回收站，请刷新后重试')
        return row
      })
      sqlite.prepare('DELETE FROM coser_undo_changes').run()
      for (const row of rows) {
        sqlite.prepare('UPDATE albums SET coser_id = ?, folder_id = NULL, updated_at = ? WHERE id = ?').run(coserId, now(), row.id)
        sqlite.prepare('INSERT INTO coser_undo_changes (id) VALUES (?)').run(row.id)
      }
      sqlite.prepare('UPDATE cosers SET updated_at = ? WHERE id = ?').run(now(), coserId)
      return rows
    })()
    latest = { result, albums, target: coserId }
    return result
  }
  function undo(operationId: string): void {
    const operation = latest
    if (!operation || operation.result.operationId !== operationId || now() >= operation.result.expiresAt) throw new Error('撤销已过期或已被下一次归类替代')
    sqlite.transaction(() => {
      for (const row of operation.albums) {
        const current = sqlite.prepare("SELECT coser_id, folder_id FROM albums WHERE id = ? AND trash_state = 'active'").get(row.id) as Placement | undefined
        const changed = sqlite.prepare('SELECT changed FROM coser_undo_changes WHERE id = ?').get(row.id) as { changed: number } | undefined
        if (!current || current.coser_id !== operation.target || current.folder_id !== null || !changed || changed.changed) throw new Error('图集已被修改，无法撤销本次归类')
        if (row.folder_id && !sqlite.prepare("SELECT 1 FROM folders WHERE id = ? AND trash_state = 'active'").get(row.folder_id)) throw new Error('原文件夹已不存在，无法撤销')
        if (row.coser_id && !sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(row.coser_id)) throw new Error('原 Coser 已不存在，无法撤销')
      }
      for (const row of operation.albums) sqlite.prepare('UPDATE albums SET folder_id = ?, coser_id = ?, updated_at = ? WHERE id = ?').run(row.folder_id, row.coser_id, row.updated_at, row.id)
      sqlite.prepare('DELETE FROM coser_undo_changes').run()
    })()
    latest = undefined
  }
  return { assign, undo, invalidate: () => { latest = undefined } }
}
