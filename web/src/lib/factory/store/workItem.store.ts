// WorkItemStore — SRP: CRUD + delega transiciones a machine
// DIP: depends on WorkItemMachine abstraction, not concrete UI
// LSP: all methods return ParseResult, substitutable
// OCP: add new filters without modifying core transition logic
import { ParseResult } from "../domain/result";
import { isActive } from "../domain/workItem.types";
import type { Actor, CreateWorkItemInput, TransitionContext, WorkItem, WorkItemStage } from "../domain/workItem.types";
import { nextStageForIntake } from "../domain/workItem.machine";
import { WorkItemMachine } from "../domain/workItem.machine";

export interface WorkItemFilter {
  stage?: WorkItemStage;
  createdBy?: string;
  search?: string; // title/description
  factoryName?: string;
  includeTerminals?: boolean; // default false for Activity (Warp §10)
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `wi_${Date.now()}_${idSeq}`;
}

export class WorkItemStore {
  private items = new Map<string, WorkItem>();
  private machine: WorkItemMachine;
  private knownFactories: Set<string>;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(machine = new WorkItemMachine(), knownFactories: string[] = []) {
    this.machine = machine;
    this.knownFactories = new Set(knownFactories);
  }

  setKnownFactories(names: string[]) {
    this.knownFactories = new Set(names);
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version += 1;
    this.listeners.forEach((cb) => cb());
  }

  private isAllowedPrUrl(url: string): boolean {
    try {
      const u = new URL(url.trim());
      if (u.protocol !== "https:") return false;
      if (u.hostname !== "github.com") return false;
      // must be /owner/repo/(pull|issues)/... or generic github path
      if (!u.pathname.startsWith("/")) return false;
      // reject javascript:, data:, etc already via protocol check
      return true;
    } catch {
      return false;
    }
  }

  create(input: CreateWorkItemInput): ParseResult<WorkItem> {
    if (!input.factoryName || !this.knownFactories.has(input.factoryName)) {
      return ParseResult.singleFail("factoryName", `unknown factory '${input.factoryName}'`, "unknown_factory");
    }
    const trimmedTitle = input.title?.trim() ?? "";
    if (!trimmedTitle) {
      return ParseResult.singleFail("title", "title required", "missing_title");
    }
    if (trimmedTitle.length > 200) {
      return ParseResult.singleFail("title", "title max 200 chars", "title_too_long");
    }
    if (input.description && input.description.length > 5000) {
      return ParseResult.singleFail("description", "description max 5000 chars", "description_too_long");
    }
    if (input.linkedPRs) {
      for (const pr of input.linkedPRs) {
        const trimmed = pr.trim();
        if (/^\s*javascript:/i.test(trimmed) || /^\s*data:/i.test(trimmed) || /^\s*vbscript:/i.test(trimmed)) {
          return ParseResult.singleFail("linkedPRs", `blocked javascript: url '${pr}'`, "blocked_url");
        }
        if (!this.isAllowedPrUrl(pr)) {
          return ParseResult.singleFail("linkedPRs", `linkedPRs must be https://github.com/* URL, got '${pr}'`, "invalid_pr_url");
        }
      }
    }
    if (!input.createdBy?.trim()) {
      return ParseResult.singleFail("createdBy", "createdBy required", "missing_createdBy");
    }

    const now = new Date().toISOString();
    const id = nextId();
    const stage = nextStageForIntake(input.foremanDecision);

    const initialEvent = {
      id: `evt_${id}_0`,
      workItemId: id,
      from: stage as WorkItemStage, // self-loop for creation trace
      to: stage,
      actor: "foreman" as Actor,
      at: now,
      reason: input.foremanDecision?.reason ?? "intake",
      metadata: { foremanDecision: input.foremanDecision },
    };

    const item: WorkItem = {
      id,
      factoryName: input.factoryName,
      title: trimmedTitle,
      description: input.description,
      source: input.source,
      sourceRef: input.sourceRef,
      createdBy: input.createdBy,
      createdAt: now,
      stage,
      history: [initialEvent],
      linkedPRs: input.linkedPRs ?? [],
      assigneeAgent: stage === "Triage" ? "triage" : stage === "Planning" ? "spec" : stage === "Building" ? "implement" : stage === "Reviewing" ? "review" : undefined,
      foremanDecision: input.foremanDecision,
      humanApproval: stage === "Planning" ? "pending" : undefined,
    };

    this.items.set(id, item);
    this.notify();
    return ParseResult.ok(item);
  }

  getById(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  list(filter: WorkItemFilter = {}): WorkItem[] {
    let out = [...this.items.values()];
    if (filter.factoryName) out = out.filter((w) => w.factoryName === filter.factoryName);
    if (filter.stage) out = out.filter((w) => w.stage === filter.stage);
    else if (!filter.includeTerminals) out = out.filter((w) => isActive(w.stage));
    if (filter.createdBy) out = out.filter((w) => w.createdBy === filter.createdBy);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      out = out.filter((w) => w.title.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q));
    }
    // Stable sort by createdAt asc
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  transition(id: string, to: WorkItemStage, actor: Actor, ctx: TransitionContext = {}): ParseResult<WorkItem> {
    const item = this.items.get(id);
    if (!item) return ParseResult.singleFail(id, `work item '${id}' not found`, "not_found");
    const res = this.machine.transition(item, to, actor, ctx);
    if (!res.ok) return res;
    this.items.set(id, res.value!);
    this.notify();
    return res;
  }

  cancel(id: string, actor: Actor = "foreman", reason?: string): ParseResult<WorkItem> {
    return this.transition(id, "Cancelled", actor, { reason });
  }

  clear() {
    this.items.clear();
    this.notify();
  }

  size(): number {
    return this.items.size;
  }

  // For tests / persistence
  static _resetIdSeq() {
    idSeq = 0;
  }
}
