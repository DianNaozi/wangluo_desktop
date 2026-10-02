import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AssignmentResult } from './coser-assignment'

type Placement = { id: string; folder_id: string | null; coser_id: string | null }

export function createVideoCoserAssignment(sqlite: Database.Database, now = Date.now) {
  let latest: { result: AssignmentResult; videos: Placement[]; target: string } | undefined
  sqlite.exec(`CREATE TEMP TABLE video_coser_undo_changes (id TEXT PRIMARY KEY, changed INTEGER NOT NULL DEFAULT 0);
    CREATE TEMP TRIGGER video_coser_undo_update AFTER UPDATE OF folder_id, coser_id, trash_state, media_kind ON main.media_items BEGIN
      UPDATE video_coser_undo_changes SET changed = 1 WHERE id = NEW.id;
    END;
    CREATE TEMP TRIGGER video_coser_undo_delete AFTER DELETE ON main.media_items BEGIN
      UPDATE video_coser_undo_changes SET changed = 1 WHERE id = OLD.id;
    END;`)
  const linked = sqlite.prepare("SELECT 1 FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = ? AND a.trash_state = 'active' LIMIT 1")
  function assign(mediaIds: unknown, coserId: unknown): AssignmentResult {
    if (!Array.isArray(mediaIds) || !mediaIds.length || mediaIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('请选择有效视频')
    if (typeof coserId !== 'string' || !sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(coserId)) throw new Error('目标 Coser 不存在')
    const ids = [...new Set(mediaIds as string[])]
    const result = { count: ids.length, operationId: randomUUID(), expiresAt: now() + 30_000 }
    const videos = sqlite.transaction(() => {
      const rows = ids.map(id => {
        const row = sqlite.prepare("SELECT id, folder_id, coser_id FROM media_items WHERE id = ? AND media_kind = 'video' AND trash_state = 'active'").get(id) as Placement | undefined
        if (!row) throw new Error('视频不存在或已在回收站，请刷新后重试')
        if (linked.get(id)) throw new Error('图集内视频请通过整份图集归类')
        return row
      })
      sqlite.prepare('DELETE FROM video_coser_undo_changes').run()
      for (const row of rows) {
        sqlite.prepare('UPDATE media_items SET coser_id = ?, folder_id = NULL WHERE id = ?').run(coserId, row.id)
        sqlite.prepare('INSERT INTO video_coser_undo_changes (id) VALUES (?)').run(row.id)
      }
      sqlite.prepare('UPDATE cosers SET updated_at = ? WHERE id = ?').run(now(), coserId)
      return rows
    })()
    latest = { result, videos, target: coserId }
    return result
  }
  function undo(operationId: string): void {
    const operation = latest
    if (!operation || operation.result.operationId !== operationId || now() >= operation.result.expiresAt) throw new Error('撤销已过期或已被下一次归类替代')
    sqlite.transaction(() => {
      for (const row of operation.videos) {
        const current = sqlite.prepare("SELECT folder_id, coser_id FROM media_items WHERE id = ? AND trash_state = 'active' AND media_kind = 'video'").get(row.id) as Placement | undefined
        const changed = sqlite.prepare('SELECT changed FROM video_coser_undo_changes WHERE id = ?').get(row.id) as { changed: number } | undefined
        if (!current || current.coser_id !== operation.target || current.folder_id !== null || !changed || changed.changed || linked.get(row.id)) throw new Error('视频已被修改，无法撤销本次归类')
        if (row.folder_id && !sqlite.prepare("SELECT 1 FROM folders WHERE id = ? AND trash_state = 'active'").get(row.folder_id)) throw new Error('原文件夹已不存在，无法撤销')
        if (row.coser_id && !sqlite.prepare('SELECT 1 FROM cosers WHERE id = ?').get(row.coser_id)) throw new Error('原 Coser 已不存在，无法撤销')
      }
      for (const row of operation.videos) sqlite.prepare('UPDATE media_items SET folder_id = ?, coser_id = ? WHERE id = ?').run(row.folder_id, row.coser_id, row.id)
      sqlite.prepare('DELETE FROM video_coser_undo_changes').run()
    })()
    latest = undefined
  }
  return { assign, undo, invalidate: () => { latest = undefined } }
}
