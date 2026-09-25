import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

const migrations: Array<{ id: string; sql: string }> = [
  {
    id: '0000_initial_imports',
    sql: `
      CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, status TEXT NOT NULL,
        total_entries INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0,
        processed_entries INTEGER NOT NULL DEFAULT 0, imported_entries INTEGER NOT NULL DEFAULT 0,
        duplicate_entries INTEGER NOT NULL DEFAULT 0, failed_entries INTEGER NOT NULL DEFAULT 0,
        skipped_entries INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        started_at INTEGER, completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS import_jobs_status_created_at_idx ON import_jobs(status, created_at);
      CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY, content_hash TEXT NOT NULL UNIQUE, media_kind TEXT NOT NULL,
        original_name TEXT NOT NULL, extension TEXT NOT NULL, byte_size INTEGER NOT NULL,
        object_path TEXT NOT NULL, imported_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS media_items_kind_imported_at_idx ON media_items(media_kind, imported_at);
      CREATE TABLE IF NOT EXISTS import_entries (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL, relative_path TEXT NOT NULL, source_name TEXT NOT NULL,
        source_size INTEGER NOT NULL, source_modified_at INTEGER NOT NULL, media_kind TEXT NOT NULL,
        album_id TEXT REFERENCES albums(id) ON DELETE SET NULL, status TEXT NOT NULL,
        content_hash TEXT, media_id TEXT REFERENCES media_items(id) ON DELETE SET NULL,
        error_code TEXT, error_message TEXT, created_at INTEGER NOT NULL, completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS import_entries_job_status_idx ON import_entries(job_id, status);
      CREATE TABLE IF NOT EXISTS album_items (
        album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (album_id, media_id)
      );
      CREATE INDEX IF NOT EXISTS album_items_album_order_idx ON album_items(album_id, sort_order);
    `
  }
  ,{
    id: '0001_media_previews',
    sql: `
      ALTER TABLE media_items ADD COLUMN preview_status TEXT NOT NULL DEFAULT 'not_requested';
      ALTER TABLE media_items ADD COLUMN preview_error TEXT;
      ALTER TABLE media_items ADD COLUMN preview_priority INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE media_items ADD COLUMN preview_updated_at INTEGER;
      ALTER TABLE media_items ADD COLUMN preview_version INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS media_items_preview_status_priority_idx ON media_items(preview_status, preview_priority, imported_at);
      UPDATE media_items
      SET preview_status = 'pending', preview_priority = 100
      WHERE media_kind IN ('image', 'video') AND preview_status = 'not_requested';
    `
  }
  ,{
    id: '0002_media_trash',
    sql: `
      ALTER TABLE media_items ADD COLUMN trash_state TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE media_items ADD COLUMN trashed_at INTEGER;
      ALTER TABLE albums ADD COLUMN trash_state TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE albums ADD COLUMN trashed_at INTEGER;
      CREATE INDEX IF NOT EXISTS media_items_trash_state_trashed_at_idx ON media_items(trash_state, trashed_at);
      CREATE INDEX IF NOT EXISTS albums_trash_state_trashed_at_idx ON albums(trash_state, trashed_at);
    `
  }
]

export type GalleryDatabase = { sqlite: Database.Database; db: BetterSQLite3Database }

export function createDatabase(databasePath: string): GalleryDatabase {
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.exec('CREATE TABLE IF NOT EXISTS __gallery_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const seen = sqlite.prepare('SELECT 1 FROM __gallery_migrations WHERE id = ?')
  const applied = sqlite.prepare('INSERT INTO __gallery_migrations (id, applied_at) VALUES (?, ?)')
  const applyMigration = sqlite.transaction((migration: (typeof migrations)[number]) => {
    if (seen.get(migration.id)) return
    sqlite.exec(migration.sql)
    applied.run(migration.id, Date.now())
  })
  migrations.forEach(applyMigration)
  sqlite.prepare("UPDATE import_jobs SET status = 'interrupted' WHERE status IN ('planned', 'queued', 'running')").run()
  sqlite.prepare("UPDATE media_items SET preview_status = 'pending', preview_error = NULL WHERE preview_status = 'generating'").run()
  return { sqlite, db: drizzle({ client: sqlite }) }
}
