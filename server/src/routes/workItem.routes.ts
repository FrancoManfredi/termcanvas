import { Hono } from "hono";
import { getDb } from "../db/sqlite.js";
import { WorkItemRepoSQLite } from "../db/workItem.repo.js";
import { FactoryRepoSQLite } from "../db/factory.repo.js";

let wiSeq2 = 1000;
function nextId(): string {
  wiSeq2 += 1;
  return `wi_${Date.now()}_${wiSeq2}`;
}

export function createWorkItemRoutes(): Hono {
  const app = new Hono();

  const getRepos = () => {
    const db = getDb();
    return {
      workItemRepo: new WorkItemRepoSQLite(db),
      factoryRepo: new FactoryRepoSQLite(db),
    };
  };

  // GET /api/v1/work-items?factoryName&stage&search&includeTerminals&createdBy
  app.get("/api/v1/work-items", (c) => {
    const factoryName = c.req.query("factoryName") ?? c.req.query("factory_name") ?? undefined;
    const stage = c.req.query("stage") as any;
    const search = c.req.query("search");
    const createdBy = c.req.query("createdBy") ?? c.req.query("created_by");
    const includeTerminals = c.req.query("includeTerminals") === "true" || c.req.query("include_terminals") === "true";
    const { workItemRepo } = getRepos();
    const items = workItemRepo.list({ factoryName, stage, search, createdBy, includeTerminals });
    return c.json({ workItems: items, work_items: items }, 200);
  });

  // GET /api/v1/work-items/:id
  app.get("/api/v1/work-items/:id", (c) => {
    const id = c.req.param("id");
    const { workItemRepo } = getRepos();
    const item = workItemRepo.getById(id);
    if (!item) return c.json({ error: `work item '${id}' not found`, code: "not_found" }, 404);
    return c.json({ workItem: item }, 200);
  });

  // POST /api/v1/work-items
  app.post("/api/v1/work-items", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid json", code: "invalid_json" }, 400);
    const { factoryName, factory_name, title, description, createdBy, created_by, source, sourceRef, source_ref, linkedPRs } = body as Record<string, unknown>;
    const fName = (factoryName ?? factory_name) as string | undefined;
    const t = (title as string | undefined)?.trim() ?? "";
    const creator = ((createdBy ?? created_by) as string | undefined)?.trim() ?? "";
    if (!fName) return c.json({ error: "factoryName required", code: "missing_factoryName" }, 400);
    if (!t) return c.json({ error: "title required", code: "missing_title" }, 400);
    if (!creator) return c.json({ error: "createdBy required", code: "missing_createdBy" }, 400);
    const { workItemRepo, factoryRepo } = getRepos();
    // verify factory exists
    const factory = factoryRepo.getByName(fName);
    if (!factory) return c.json({ error: `unknown factory '${fName}'`, code: "unknown_factory" }, 400);

    const now = new Date().toISOString();
    const id = nextId();
    const item = {
      id,
      factoryName: fName,
      title: t,
      description: typeof description === "string" ? description : undefined,
      source: typeof source === "string" ? source : "direct",
      sourceRef: (sourceRef ?? source_ref) as string | undefined,
      createdBy: creator,
      createdAt: now,
      stage: "Triage" as const,
      history: [
        { id: `evt_${id}_0`, workItemId: id, from: "Triage" as const, to: "Triage" as const, actor: "foreman" as const, at: now, reason: "intake", metadata: {} },
      ],
      linkedPRs: Array.isArray(linkedPRs) ? (linkedPRs as string[]) : [],
    };
    try {
      workItemRepo.create(item as any);
    } catch (e) {
      return c.json({ error: String(e), code: "create_failed" }, 500);
    }
    return c.json({ workItem: item }, 201);
  });

  // POST /api/v1/work-items/:id/transition
  app.post("/api/v1/work-items/:id/transition", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid json", code: "invalid_json" }, 400);
    const { to, actor, humanApproval, reviewVerdict, handoffConfirmed, reason } = body as Record<string, unknown>;
    if (!to || typeof to !== "string") return c.json({ error: "to stage required", code: "missing_stage" }, 400);
    const { workItemRepo } = getRepos();
    const item = workItemRepo.getById(id);
    if (!item) return c.json({ error: `work item '${id}' not found`, code: "not_found" }, 404);

    // simple transition validation: reuse same logic as WorkItemMachine.canTransition
    const allowed: Record<string, string[]> = {
      Triage: ["Planning", "Building", "Cancelled"],
      Planning: ["Building", "Planning", "Cancelled"],
      Building: ["Reviewing", "Cancelled"],
      Reviewing: ["Building", "Reviewing", "Complete", "Cancelled"],
      Complete: [],
      Cancelled: [],
    };
    const from = item.stage;
    const toStage = to as string;
    if (!allowed[from]?.includes(toStage)) {
      return c.json({ error: `invalid transition '${from}' → '${toStage}'`, code: "invalid_transition" }, 400);
    }
    if (from === "Planning" && toStage === "Building" && humanApproval !== "approved" && item.humanApproval !== "approved") {
      return c.json({ error: "Planning → Building requires humanApproval='approved'", code: "human_gate_pending" }, 400);
    }
    if (from === "Reviewing" && toStage === "Complete" && reviewVerdict !== "accept" && item.reviewVerdict !== "accept") {
      return c.json({ error: "Reviewing → Complete requires reviewVerdict='accept'", code: "review_verdict_required" }, 400);
    }

    const next = {
      ...item,
      stage: toStage as typeof item.stage,
      history: [
        ...item.history,
        {
          id: `evt_${id}_${item.history.length}`,
          workItemId: id,
          from,
          to: toStage as typeof item.stage,
          actor: (actor as string) ?? "system",
          at: new Date().toISOString(),
          reason: typeof reason === "string" ? reason : undefined,
          metadata: {
            ...(humanApproval ? { humanApproval } : {}),
            ...(reviewVerdict ? { reviewVerdict } : {}),
            ...(handoffConfirmed !== undefined ? { handoffConfirmed } : {}),
          },
        },
      ],
      ...(humanApproval ? { humanApproval } : {}),
      ...(reviewVerdict ? { reviewVerdict } : {}),
      ...(handoffConfirmed !== undefined ? { handoffConfirmed } : {}),
    } as typeof item;

    workItemRepo.update(next as any);
    return c.json({ workItem: next }, 200);
  });

  return app;
}
