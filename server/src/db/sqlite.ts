import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Abstraction over better-sqlite3 vs node:sqlite (stdlib)
// Node 22.5+ ships `node:sqlite` with DatabaseSync. We prefer it to avoid native compilation on Windows.
// If better-sqlite3 is available and preferred, we can load it dynamically.

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
};

let singleton: SqliteDb | null = null;
let singletonPath: string | null = null;

function createNodeSqliteDb(filePath: string): SqliteDb {
  // dynamic import to avoid hard failure if node version < 22.5
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try {
    // Use require to load node:sqlite DatabaseSync
    const requireFn = createRequire(import.meta.url);
    // @ts-ignore - node:sqlite is not in types for older TS
    const sqliteMod = requireFn("node:sqlite") as { DatabaseSync: new (path: string) => unknown };
    if (sqliteMod && sqliteMod.DatabaseSync) {
      const DbCtor = sqliteMod.DatabaseSync as new (p: string) => {
        exec(s: string): void;
        prepare(s: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
        close(): void;
      };
      const db = new DbCtor(filePath);
      try {
        db.exec("PRAGMA journal_mode = WAL;");
      } catch {
        // ignore
      }
      return db as unknown as SqliteDb;
    }
  } catch {
    // fall through
  }
  throw new Error("node:sqlite not available (requires Node >=22.5) and better-sqlite3 not found");
}

function createBetterSqliteDb(filePath: string): SqliteDb | null {
  try {
    const requireFn = createRequire(import.meta.url);
    const BetterSqlite3 = requireFn("better-sqlite3") as new (p: string) => {
      pragma(s: string): void;
      exec(s: string): void;
      prepare(s: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
      close(): void;
    };
    const db = new BetterSqlite3(filePath);
    try {
      db.pragma("journal_mode = WAL");
    } catch {
      // ignore
    }
    return db as unknown as SqliteDb;
  } catch {
    return null;
  }
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:" || filePath === "") return;
  const dir = path.dirname(filePath);
  if (dir && dir !== "." && dir !== "") {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDb(filePath?: string): SqliteDb {
  const resolved = filePath ?? process.env.DATABASE_URL ?? "data/termcanvas.db";
  if (!filePath && singleton && singletonPath === resolved) {
    return singleton;
  }
  // for explicit filePath (e.g. :memory: in tests) always create new instance, don't cache
  if (filePath) {
    ensureDir(resolved);
    const better = createBetterSqliteDb(resolved);
    if (better) return better;
    return createNodeSqliteDb(resolved);
  }
  // singleton path
  ensureDir(resolved);
  const better = createBetterSqliteDb(resolved);
  const db = better ?? createNodeSqliteDb(resolved);
  singleton = db;
  singletonPath = resolved;
  return db;
}

export function resetDb(): void {
  if (singleton) {
    try {
      singleton.close();
    } catch {
      // ignore
    }
  }
  singleton = null;
  singletonPath = null;
}

// In-memory fallback for environments where neither driver is available (e.g. older Node in CI for web tests)
// We expose a simple map-based stub that implements same interface for tests.
// The actual server will fail loudly if neither driver is available; web tests use fetch mocks and don't need SQLite.
export function createMemoryDb(): SqliteDb {
  const tables = new Map<string, Map<string, unknown>>();
  const ensureTable = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  return {
    exec(_sql: string): void {
      // no-op for create table
    },
    prepare(sql: string) {
      const normalized = sql.trim().toLowerCase();
      return {
        run(...params: unknown[]): unknown {
          // very minimal handling for INSERT/DELETE/UPDATE
          if (normalized.startsWith("insert")) {
            // INSERT INTO factories (uid, name, alias, data, created_at) VALUES (?, ?, ?, ?, ?)
            // We parse table name roughly
            const m = /insert\s+into\s+(\w+)/i.exec(sql);
            const table = m?.[1] ?? "unknown";
            const map = ensureTable(table);
            const uid = String(params[0]);
            map.set(uid, params);
            return {};
          }
          if (normalized.startsWith("delete")) {
            const m = /delete\s+from\s+(\w+)\s+where\s+(\w+)\s*=\s*\?/i.exec(sql);
            if (m) {
              const table = m[1];
              const col = m[2];
              const val = String(params[0]);
              const map = ensureTable(table);
              if (col === "uid" || col === "id") {
                map.delete(val);
              } else {
                for (const [k, v] of [...map.entries()]) {
                  const arr = v as unknown[];
                  // heuristics: ignore
                  if (String(arr[1]) === val) map.delete(k);
                }
              }
            }
            return {};
          }
          if (normalized.startsWith("update")) {
            // no-op
            return {};
          }
          return {};
        },
        get(...params: unknown[]): unknown {
          if (normalized.includes("where uid = ?") || normalized.includes("where id = ?")) {
            const m = /from\s+(\w+)/i.exec(sql);
            const table = m?.[1] ?? "unknown";
            const map = ensureTable(table);
            const key = String(params[0]);
            const row = map.get(key);
            if (!row) return undefined;
            // second param handling for select data?
            return row;
          }
          return undefined;
        },
        all(..._params: unknown[]): unknown[] {
          return [];
        },
      };
    },
    close(): void {
      tables.clear();
    },
  };
}
