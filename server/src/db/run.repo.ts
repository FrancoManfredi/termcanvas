import { getDb } from "./sqlite.js";

export interface RunRecord {
  id: string;
  factory_uid?: string;
  factory_name?: string;
  title: string;
  prompt: string;
  status: "queued" | "running" | "completed" | "cancelled";
  stage: string;
  work_item_id: string;
  ticket_ref?: string;
  ticket_url?: string;
  followups: string[];
  cost?: number;
  timeline?: unknown[];
}

export class RunRepoSQLite {
  private db: ReturnType<typeof getDb>;

  constructor(db?: ReturnType<typeof getDb>) {
    this.db = db ?? getDb();
  }

  create(run: RunRecord): void {
    this.db
      .prepare("INSERT INTO runs (id, factory_uid, work_item_id, status, ticket_ref, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(run.id, run.factory_uid ?? null, run.work_item_id, run.status, run.ticket_ref ?? null, JSON.stringify(run));
  }

  get(id: string): RunRecord | undefined {
    try {
      const row = this.db.prepare("SELECT data FROM runs WHERE id = ?").get(id) as { data: string } | undefined;
      if (!row) return undefined;
      return JSON.parse(row.data) as RunRecord;
    } catch {
      return undefined;
    }
  }

  update(run: RunRecord): void {
    this.db
      .prepare("UPDATE runs SET factory_uid = ?, work_item_id = ?, status = ?, ticket_ref = ?, data = ? WHERE id = ?")
      .run(run.factory_uid ?? null, run.work_item_id, run.status, run.ticket_ref ?? null, JSON.stringify(run), run.id);
  }

  list(): RunRecord[] {
    try {
      const rows = this.db.prepare("SELECT data FROM runs").all() as { data: string }[];
      return rows.map((r) => JSON.parse(r.data) as RunRecord);
    } catch {
      return [];
    }
  }

  cancel(id: string): RunRecord | undefined {
    const run = this.get(id);
    if (!run) return undefined;
    if (run.status === "completed" || run.status === "cancelled") return run;
    const next: RunRecord = { ...run, status: "cancelled" };
    this.update(next);
    return next;
  }

  clear(): void {
    try {
      this.db.exec("DELETE FROM runs");
    } catch {}
  }
}
