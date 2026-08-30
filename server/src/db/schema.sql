-- factories(uid PK, name UNIQUE COLLATE NOCASE, alias, data JSON, created_at)
CREATE TABLE IF NOT EXISTS factories (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  alias TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_factories_name ON factories(name);
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  factory_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_items_factory ON work_items(factory_name);
CREATE INDEX IF NOT EXISTS idx_work_items_stage ON work_items(stage);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  factory_uid TEXT,
  work_item_id TEXT,
  status TEXT NOT NULL,
  ticket_ref TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_factory ON runs(factory_uid);
