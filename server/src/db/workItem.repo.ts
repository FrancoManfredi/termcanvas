import { getDb } from "./sqlite.js";

export type WorkItemStage = "Triage" | "Planning" | "Building" | "Reviewing" | "Complete" | "Cancelled";
export type WorkItemSource = string;
export interface WorkItemEvent {
  id: string;
  workItemId: string;
  from: WorkItemStage;
  to: WorkItemStage;
  actor: string;
  at: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}
export interface WorkItem {
  id: string;
  factoryName: string;
  title: string;
  description?: string;
  source: WorkItemSource;
  sourceRef?: string;
  createdBy: string;
  createdAt: string;
  stage: WorkItemStage;
  history: WorkItemEvent[];
  linkedPRs: string[];
  assigneeAgent?: string;
  humanApproval?: string;
  reviewVerdict?: string;
  handoffConfirmed?: boolean;
  foremanDecision?: unknown;
}

export interface WorkItemFilter {
  factoryName?: string;
  stage?: WorkItemStage;
  search?: string;
  createdBy?: string;
  includeTerminals?: boolean;
}

const TERMINAL = new Set(["Complete", "Cancelled"]);

export class WorkItemRepoSQLite {
  private db: ReturnType<typeof getDb>;

  constructor(db?: ReturnType<typeof getDb>) {
    this.db = db ?? getDb();
  }

  private rowToItem(row: { data: string }): WorkItem {
    return JSON.parse(row.data) as WorkItem;
  }

  list(filter: WorkItemFilter = {}): WorkItem[] {
    let rows: { data: string }[] = [];
    try {
      rows = this.db.prepare("SELECT data FROM work_items ORDER BY created_at ASC").all() as { data: string }[];
    } catch {
      rows = [];
    }
    // If driver returns empty but we used earlier factory repo pattern where rows are objects with uid etc, fallback try generic
    let items: WorkItem[] = rows.map((r) => {
      try {
        return JSON.parse(r.data) as WorkItem;
      } catch {
        return null as unknown as WorkItem;
      }
    }).filter(Boolean);

    // Fallback if rows empty but using alternative row shape (uid, data, etc)
    if (items.length === 0) {
      try {
        const alt = this.db.prepare("SELECT data FROM work_items").all() as unknown as { data: string }[];
        if (alt.length > 0) items = alt.map((r) => JSON.parse(r.data) as WorkItem);
      } catch {
        // ignore
      }
    }

    if (filter.factoryName) items = items.filter((w) => w.factoryName === filter.factoryName);
    if (filter.stage) items = items.filter((w) => w.stage === filter.stage);
    else if (!filter.includeTerminals) items = items.filter((w) => !TERMINAL.has(w.stage));
    if (filter.createdBy) items = items.filter((w) => w.createdBy === filter.createdBy);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      items = items.filter((w) => w.title.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q));
    }
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return items;
  }

  getById(id: string): WorkItem | undefined {
    try {
      const row = this.db.prepare("SELECT data FROM work_items WHERE id = ?").get(id) as { data: string } | undefined;
      if (!row) return undefined;
      return JSON.parse(row.data) as WorkItem;
    } catch {
      return undefined;
    }
  }

  create(item: WorkItem): void {
    this.db
      .prepare("INSERT INTO work_items (id, factory_name, stage, source, source_ref, created_by, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.factoryName, item.stage, item.source, item.sourceRef ?? null, item.createdBy, item.createdAt, JSON.stringify(item));
  }

  update(item: WorkItem): void {
    this.db
      .prepare("UPDATE work_items SET factory_name = ?, stage = ?, source = ?, source_ref = ?, created_by = ?, data = ? WHERE id = ?")
      .run(item.factoryName, item.stage, item.source, item.sourceRef ?? null, item.createdBy, JSON.stringify(item), item.id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM work_items WHERE id = ?").run(id);
  }

  clear(): void {
    try {
      this.db.exec("DELETE FROM work_items");
    } catch {}
  }

  count(): number {
    try {
      const row = this.db.prepare("SELECT COUNT(*) as cnt FROM work_items").get() as { cnt: number } | undefined;
      return row?.cnt ?? this.list().length;
    } catch {
      return this.list().length;
    }
  }
}
