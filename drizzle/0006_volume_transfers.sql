CREATE TABLE volume_transfers (
  id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('copying', 'published', 'committed', 'complete')),
  manifest_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX volume_transfers_active_group
  ON volume_transfers(group_key) WHERE stage <> 'complete';
