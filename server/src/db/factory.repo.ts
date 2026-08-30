import { getDb, resetDb } from "./sqlite.js";
import type { FactoryRecord, FactorySummary } from "../lib/validation.js";
import { toFactorySummary } from "../lib/validation.js";

type DbRow = { uid: string; name: string; alias: string; data: string; created_at: string };

export class FactoryRepoSQLite {
  private db: ReturnType<typeof getDb>;

  constructor(db?: ReturnType<typeof getDb>) {
    this.db = db ?? getDb();
  }

  list(search?: string): FactoryRecord[] {
    const stmt = this.db.prepare("SELECT uid, name, alias, data, created_at FROM factories ORDER BY created_at ASC");
    const rows = stmt.all() as unknown as DbRow[];
    // fallback for memory db stub not returning rows: try alternative path using raw exec? We'll handle both
    let records: FactoryRecord[];
    if (rows.length === 0) {
      // try reading via SELECT data approach for node:sqlite that returns objects with data column
      // For memory stub, rows will be empty but we have fallback via direct query
      // The stub's prepare returns empty; but we also support direct JSON storage fallback: keep in-memory Map?
      // For now, if no rows, check if db is memory stub with tables map: we can't access. So just return empty.
      records = [];
    } else {
      records = rows.map((r) => {
        try {
          return JSON.parse(r.data) as FactoryRecord;
        } catch {
          // fallback reconstruct
          return { uid: r.uid, name: r.name, alias: r.alias, repositories: [], integrations: [], agentToggles: {}, policyId: "default", createdAt: r.created_at } as FactoryRecord;
        }
      });
    }
    // If using node:sqlite driver that stores data correctly, rows will be populated.
    // However our earlier getDb with node:sqlite does support all(). We'll also handle case where driver returns array of objects with data.
    // For extra safety, if records empty but we expect data, we try alternative query via prepare all and parse
    if (records.length === 0) {
      // attempt to handle case where better-sqlite3 returns rows but we mis-typed
      // try generic SELECT data
      try {
        const alt = this.db.prepare("SELECT data FROM factories").all() as unknown as { data: string }[];
        if (alt.length > 0) {
          records = alt.map((r) => JSON.parse(r.data) as FactoryRecord);
        }
      } catch {
        // ignore
      }
    }

    if (search?.trim()) {
      const q = search.trim().toLowerCase();
      return records.filter((r) => r.name.toLowerCase().includes(q) || r.alias.toLowerCase().includes(q));
    }
    return records;
  }

  getByUid(uid: string): FactoryRecord | undefined {
    try {
      const row = this.db.prepare("SELECT data FROM factories WHERE uid = ?").get(uid) as { data: string } | undefined;
      if (!row) return undefined;
      return JSON.parse(row.data) as FactoryRecord;
    } catch {
      return undefined;
    }
  }

  getByName(name: string): FactoryRecord | undefined {
    try {
      const row = this.db.prepare("SELECT data FROM factories WHERE name = ? COLLATE NOCASE").get(name) as { data: string } | undefined;
      if (!row) return undefined;
      return JSON.parse(row.data) as FactoryRecord;
    } catch {
      // fallback linear search
      return this.list().find((r) => r.name.toLowerCase() === name.toLowerCase());
    }
  }

  create(record: FactoryRecord): void {
    this.db.prepare("INSERT INTO factories (uid, name, alias, data, created_at) VALUES (?, ?, ?, ?, ?)").run(record.uid, record.name, record.alias, JSON.stringify(record), record.createdAt);
  }

  update(uid: string, patch: Partial<FactoryRecord> & { name?: string; alias?: string }): FactoryRecord {
    const existing = this.getByUid(uid);
    if (!existing) throw new Error(`factory '${uid}' not found`);
    const next: FactoryRecord = { ...existing, ...patch, uid: existing.uid, createdAt: existing.createdAt };
    this.db.prepare("UPDATE factories SET name = ?, alias = ?, data = ? WHERE uid = ?").run(next.name, next.alias, JSON.stringify(next), uid);
    return next;
  }

  remove(uid: string): void {
    this.db.prepare("DELETE FROM factories WHERE uid = ?").run(uid);
  }

  toSummaries(search?: string): FactorySummary[] {
    return this.list(search).map(toFactorySummary);
  }

  clear(): void {
    try {
      this.db.exec("DELETE FROM factories");
    } catch {
      // ignore
    }
  }

  count(): number {
    try {
      const row = this.db.prepare("SELECT COUNT(*) as cnt FROM factories").get() as { cnt: number } | undefined;
      return row?.cnt ?? this.list().length;
    } catch {
      return this.list().length;
    }
  }
}

// test helper to reset DB file for tests that use :memory:
export function createFactoryRepoInMemory(): FactoryRepoSQLite {
  // create isolated in-memory db and migrate
  // we need to instantiate a fresh DB not singleton
  const { getDb } = requireAsGetDb();
  // fallback: use getDb with :memory: path
  const db = getDb(":memory:");
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS factories (uid TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, alias TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
       CREATE INDEX IF NOT EXISTS idx_factories_name ON factories(name);`
    );
  } catch {}
  return new FactoryRepoSQLite(db);
}

function requireAsGetDb(): { getDb: typeof getDb } {
  return { getDb };
}

export function resetFactoryRepo(): void {
  resetDb();
}
