// sessions.repo — SRP: persistencia híbrida token en server (SQLite o Map fallback)
// Si better-sqlite3/node:sqlite disponible usa tabla sessions; sino Map en memoria

import fs from "node:fs";
import path from "node:path";
import { getDb } from "./sqlite.js";

export interface SessionRow {
  id: string;
  token: string;
  username: string;
  avatarUrl: string;
  scope: string;
  createdAt: string;
}

const memory = new Map<string, SessionRow>();

let tableEnsured = false;
function ensureTable(): boolean {
  if (tableEnsured) return true;
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token TEXT NOT NULL, username TEXT, avatar_url TEXT, scope TEXT, created_at TEXT NOT NULL)`);
    tableEnsured = true;
    return true;
  } catch {
    return false;
  }
}

export function createSession(row: SessionRow): void {
  memory.set(row.id, row);
  if (ensureTable()) {
    try {
      const db = getDb();
      db.prepare(`INSERT OR REPLACE INTO sessions (id, token, username, avatar_url, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(row.id, row.token, row.username, row.avatarUrl, row.scope, row.createdAt);
    } catch {
      // fallback to memory
    }
  }
  // también guardar en data/github-session.json como file fallback (gitignored)
  try {
    const dir = path.resolve("data");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "github-session.json");
    const all = Object.fromEntries(memory.entries());
    fs.writeFileSync(file, JSON.stringify(all, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

export function getSession(id: string): SessionRow | undefined {
  const mem = memory.get(id);
  if (mem) return mem;
  if (ensureTable()) {
    try {
      const db = getDb();
      const row = db.prepare(`SELECT id, token, username, avatar_url as avatarUrl, scope, created_at as createdAt FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
      if (row) {
        memory.set(id, row);
        return row;
      }
    } catch {
      // ignore
    }
  }
  // file fallback
  try {
    const file = path.resolve("data/github-session.json");
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      const data = JSON.parse(raw) as Record<string, SessionRow>;
      const found = data[id];
      if (found) {
        memory.set(id, found);
        return found;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function deleteSession(id: string): void {
  memory.delete(id);
  if (ensureTable()) {
    try {
      const db = getDb();
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    } catch {
      // ignore
    }
  }
}
