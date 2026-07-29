PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customer_directory_sync_checkpoints (
  connector_id TEXT PRIMARY KEY REFERENCES customer_directory_connectors(id),
  mode TEXT,
  next_link TEXT,
  stats_json TEXT NOT NULL DEFAULT '{}',
  started_by TEXT,
  started_at TEXT,
  last_chunk_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_directory_sync_checkpoint_updated
  ON customer_directory_sync_checkpoints(updated_at DESC);
