import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const importJobs = sqliteTable('import_jobs', {
  id: text('id').primaryKey(),
  sourceKind: text('source_kind').notNull(),
  status: text('status').notNull(),
  totalEntries: integer('total_entries').notNull().default(0),
  totalBytes: integer('total_bytes').notNull().default(0),
  processedEntries: integer('processed_entries').notNull().default(0),
  importedEntries: integer('imported_entries').notNull().default(0),
  duplicateEntries: integer('duplicate_entries').notNull().default(0),
  failedEntries: integer('failed_entries').notNull().default(0),
  skippedEntries: integer('skipped_entries').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  queuedAt: integer('queued_at').notNull().default(0),
  deleteSourcesAfterImport: integer('delete_sources_after_import').notNull().default(0),
  sourceCleanupFailedEntries: integer('source_cleanup_failed_entries').notNull().default(0),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at')
}, (table) => [index('import_jobs_status_created_at_idx').on(table.status, table.createdAt)])

export const importEntries = sqliteTable('import_entries', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => importJobs.id, { onDelete: 'cascade' }),
  sourcePath: text('source_path').notNull(),
  relativePath: text('relative_path').notNull(),
  sourceName: text('source_name').notNull(),
  sourceSize: integer('source_size').notNull(),
  sourceModifiedAt: integer('source_modified_at').notNull(),
  mediaKind: text('media_kind').notNull(),
  albumId: text('album_id').references(() => albums.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  contentHash: text('content_hash'),
  mediaId: text('media_id').references(() => mediaItems.id, { onDelete: 'set null' }),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
  sourceRootPath: text('source_root_path'),
  sourceCleanupStatus: text('source_cleanup_status').notNull().default('not_requested'),
  sourceCleanupError: text('source_cleanup_error'),
  sourceCleanedAt: integer('source_cleaned_at')
}, (table) => [index('import_entries_job_status_idx').on(table.jobId, table.status)])

export const mediaItems = sqliteTable('media_items', {
  id: text('id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  mediaKind: text('media_kind').notNull(),
  originalName: text('original_name').notNull(),
  extension: text('extension').notNull(),
  byteSize: integer('byte_size').notNull(),
  objectPath: text('object_path').notNull(),
  previewStatus: text('preview_status').notNull().default('not_requested'),
  previewError: text('preview_error'),
  previewPriority: integer('preview_priority').notNull().default(0),
  previewUpdatedAt: integer('preview_updated_at'),
  previewVersion: integer('preview_version').notNull().default(1),
  trashState: text('trash_state').notNull().default('active'),
  trashedAt: integer('trashed_at'),
  importedAt: integer('imported_at').notNull()
}, (table) => [uniqueIndex('media_items_content_hash_unique').on(table.contentHash), index('media_items_kind_imported_at_idx').on(table.mediaKind, table.importedAt)])

export const albums = sqliteTable('albums', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
  ,trashState: text('trash_state').notNull().default('active')
  ,trashedAt: integer('trashed_at')
})

export const cosers = sqliteTable('cosers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  avatarUpdatedAt: integer('avatar_updated_at')
})

export const coserAliases = sqliteTable('coser_aliases', {
  id: text('id').primaryKey(),
  coserId: text('coser_id').notNull().references(() => cosers.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  aliasKey: text('alias_key').notNull(),
  createdAt: integer('created_at').notNull()
}, (table) => [uniqueIndex('coser_aliases_coser_key_unique').on(table.coserId, table.aliasKey)])

export const albumItems = sqliteTable('album_items', {
  albumId: text('album_id').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  mediaId: text('media_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull()
}, (table) => [primaryKey({ columns: [table.albumId, table.mediaId] }), index('album_items_album_order_idx').on(table.albumId, table.sortOrder)])
