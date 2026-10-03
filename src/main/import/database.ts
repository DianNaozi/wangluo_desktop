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
  ,{
    id: '0003_import_queue',
    sql: `
      ALTER TABLE import_jobs ADD COLUMN queued_at INTEGER NOT NULL DEFAULT 0;
      UPDATE import_jobs SET queued_at = created_at WHERE queued_at = 0;
      CREATE INDEX IF NOT EXISTS import_jobs_queue_idx ON import_jobs(status, queued_at, created_at);
    `
  }
  ,{
    id: '0004_source_cleanup',
    sql: `
      ALTER TABLE import_jobs ADD COLUMN delete_sources_after_import INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE import_jobs ADD COLUMN source_cleanup_failed_entries INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE import_entries ADD COLUMN source_root_path TEXT;
      ALTER TABLE import_entries ADD COLUMN source_cleanup_status TEXT NOT NULL DEFAULT 'not_requested';
      ALTER TABLE import_entries ADD COLUMN source_cleanup_error TEXT;
      ALTER TABLE import_entries ADD COLUMN source_cleaned_at INTEGER;
      CREATE INDEX IF NOT EXISTS import_entries_source_cleanup_idx ON import_entries(job_id, source_cleanup_status);
    `
  }
  ,{
    id: '0005_storage_orphans',
    sql: `
      CREATE TABLE storage_orphans (
        id TEXT PRIMARY KEY,
        original_relative_path TEXT NOT NULL,
        quarantined_path TEXT NOT NULL UNIQUE,
        byte_size INTEGER NOT NULL,
        discovered_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX storage_orphans_expires_at_idx ON storage_orphans(expires_at);
    `
  }
  ,{
    id: '0006_library_folders',
    sql: `
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        trash_state TEXT NOT NULL DEFAULT 'active',
        trashed_at INTEGER
      );
      CREATE INDEX folders_parent_state_updated_idx ON folders(parent_id, trash_state, updated_at);
      ALTER TABLE albums ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
      ALTER TABLE media_items ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
      CREATE INDEX albums_folder_state_updated_idx ON albums(folder_id, trash_state, updated_at);
      CREATE INDEX media_items_folder_state_imported_idx ON media_items(folder_id, trash_state, imported_at);
    `
  }
  ,{
    id: '0007_import_folder_targets',
    sql: `
      ALTER TABLE import_entries ADD COLUMN target_folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
      CREATE INDEX import_entries_target_folder_idx ON import_entries(target_folder_id);
    `
  }
  ,{
    id: '0008_coser_albums',
    sql: `
      CREATE TABLE cosers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE coser_aliases (
        id TEXT PRIMARY KEY,
        coser_id TEXT NOT NULL REFERENCES cosers(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        alias_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(coser_id, alias_key)
      );
      CREATE INDEX coser_aliases_coser_idx ON coser_aliases(coser_id);
      ALTER TABLE albums ADD COLUMN coser_id TEXT REFERENCES cosers(id) ON DELETE SET NULL;
      CREATE INDEX albums_coser_state_updated_idx ON albums(coser_id, trash_state, updated_at);
    `
  }
  ,{
    id: '0009_coser_avatars',
    sql: `
      ALTER TABLE cosers ADD COLUMN avatar_updated_at INTEGER;
    `
  }
  ,{
    id: '0010_coser_videos',
    sql: `
      ALTER TABLE media_items ADD COLUMN coser_id TEXT REFERENCES cosers(id) ON DELETE SET NULL;
      CREATE INDEX media_items_coser_state_imported_idx ON media_items(coser_id, trash_state, imported_at);
      CREATE TRIGGER album_video_placement_insert AFTER INSERT ON album_items
      WHEN EXISTS (SELECT 1 FROM albums WHERE id = NEW.album_id AND trash_state = 'active') BEGIN
        UPDATE media_items SET coser_id = NULL WHERE id = NEW.media_id AND coser_id IS NOT NULL;
      END;
      CREATE TRIGGER album_video_placement_restore AFTER UPDATE OF trash_state ON albums
      WHEN NEW.trash_state = 'active' BEGIN
        UPDATE media_items SET coser_id = NULL WHERE coser_id IS NOT NULL
          AND id IN (SELECT media_id FROM album_items WHERE album_id = NEW.id);
      END;
    `
  }
  ,{
    id: '0011_playback_rewards',
    sql: `
      CREATE TABLE playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        queue_json TEXT NOT NULL DEFAULT '[]',
        cursor_entry_id TEXT,
        cursor_media_id TEXT,
        last_entry_id TEXT,
        last_media_id TEXT,
        image_interval_seconds INTEGER NOT NULL DEFAULT 5,
        loop_enabled INTEGER NOT NULL DEFAULT 1,
        total_watched_ms INTEGER NOT NULL DEFAULT 0,
        xp_remainder_ms INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO playback_state (id, updated_at) VALUES (1, 0);
      CREATE TABLE playback_media_progress (
        entry_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        watched_ms INTEGER NOT NULL DEFAULT 0,
        image_elapsed_ms INTEGER NOT NULL DEFAULT 0,
        video_position_ms INTEGER NOT NULL DEFAULT 0,
        video_duration_ms INTEGER NOT NULL DEFAULT 0,
        video_ranges_json TEXT NOT NULL DEFAULT '[]',
        last_watched_at INTEGER,
        PRIMARY KEY (entry_id, media_id)
      );
      CREATE INDEX playback_media_progress_media_idx ON playback_media_progress(media_id);
      CREATE TABLE playback_sessions (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE playback_days (
        date TEXT PRIMARY KEY,
        watched_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE playback_achievements (
        id TEXT PRIMARY KEY,
        earned_at INTEGER NOT NULL
      );
      CREATE TABLE playback_completed_albums (
        album_id TEXT PRIMARY KEY,
        completed_at INTEGER NOT NULL
      );
    `
  }
  ,{
    id: '0012_smart_coser_import',
    sql: `
      CREATE TABLE smart_coser_folder_mappings (
        mapping_key TEXT PRIMARY KEY,
        coser_id TEXT NOT NULL REFERENCES cosers(id) ON DELETE CASCADE,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE smart_coser_model_cache (
        cache_key TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
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
  return { sqlite, db: drizzle({ client: sqlite }) }
}
