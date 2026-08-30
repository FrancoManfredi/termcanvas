import { Hono } from "hono";
import { getDb } from "../db/sqlite.js";
import { RunRepoSQLite } from "../db/run.repo.js";
import { WorkItemRepoSQLite } from "../db/workItem.repo.js";

let runSeqAgent = 5000;
function nextRunId(): string {
  runSeqAgent += 1;
  return `run_api_${Date.now()}_${runSeqAgent}`;
}

export function createAgentRoutes(): Hono {
  const app = new Hono();

  const getRepos = () => {
    const db = getDb();
    return {
      runRepo: new RunRepoSQLite(db),
      workItemRepo: new WorkItemRepoSQLite(db),
    };
  };

  // GET /agent/runs/:id
  app.get("/agent/runs/:id", (c) => {
    const id = c.req.param("id");
    const { runRepo } = getRepos();
    const run = runRepo.get(id);
    if (!run) return c.json({ error: `Run '${id}' not found`, code: "run_not_found" }, 404);
    // enrich with timeline/cost/Sub-agents placeholders if missing
    const enriched = {
      id: run.id,
      title: run.title,
      prompt: run.prompt,
      status: run.status,
      stage: run.stage,
      factory_uid: run.factory_uid,
      work_item_id: run.work_item_id,
      followups: run.followups ?? [],
      timeline: (run as unknown as Record<string, unknown>).timeline ?? [
        { at: new Date().toISOString(), status: "queued" },
        { at: new Date().toISOString(), status: "running" },
      ],
      cost: (run as unknown as Record<string, unknown>).cost ?? 0,
      subAgents: (run as unknown as Record<string, unknown>).subAgents ?? [],
    };
    return c.json(enriched, 200);
  });

  // POST /agent/runs/:id/followups
  app.post("/agent/runs/:id/followups", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid json", code: "invalid_json" }, 400);
    const prompt = (body as { prompt?: unknown }).prompt;
    const promptStr = typeof prompt === "string" ? prompt.trim() : "";
    if (!promptStr) return c.json({ error: "prompt is required", code: "missing_prompt" }, 400);
    const { runRepo } = getRepos();
    const run = runRepo.get(id);
    if (!run) return c.json({ error: `Run '${id}' not found`, code: "run_not_found" }, 404);
    if (run.status === "cancelled" || run.status === "completed") {
      return c.json({ error: `Run '${id}' is terminal`, code: "run_terminal" }, 400);
    }
    const next = { ...run, status: "running" as const, followups: [...(run.followups ?? []), promptStr] };
    runRepo.update(next as any);
    return c.json({ id: next.id, title: next.title, prompt: next.prompt, status: next.status, stage: next.stage, factory_uid: next.factory_uid, work_item_id: next.work_item_id, followups: next.followups }, 200);
  });

  // POST /agent/runs/:id/cancel
  app.post("/agent/runs/:id/cancel", (c) => {
    const id = c.req.param("id");
    const { runRepo, workItemRepo } = getRepos();
    const run = runRepo.get(id);
    if (!run) return c.json({ error: `Run '${id}' not found`, code: "run_not_found" }, 404);
    if (run.status === "completed" || run.status === "cancelled") {
      return c.json({ id: run.id, status: run.status, stage: run.stage, followups: run.followups }, 200);
    }
    // also cancel work item if exists
    if (run.work_item_id) {
      const wi = workItemRepo.getById(run.work_item_id);
      if (wi && wi.stage !== "Cancelled" && wi.stage !== "Complete") {
        const nextWi = {
          ...wi,
          stage: "Cancelled" as const,
          history: [...wi.history, { id: `evt_${wi.id}_${wi.history.length}`, workItemId: wi.id, from: wi.stage, to: "Cancelled" as const, actor: "system" as const, at: new Date().toISOString(), reason: "cancelled via Agent API", metadata: {} }],
        };
        workItemRepo.update(nextWi as any);
      }
    }
    const cancelled = runRepo.cancel(id);
    // ensure status cancelled if cancel returned undefined (should not)
    if (!cancelled) {
      const fallback = { ...run, status: "cancelled" as const };
      runRepo.update(fallback as any);
      return c.json({ id: fallback.id, status: fallback.status, stage: fallback.stage, followups: fallback.followups }, 200);
    }
    return c.json({ id: cancelled.id, status: cancelled.status, stage: cancelled.stage, followups: cancelled.followups }, 200);
  });

  // POST /agent/run  standalone
  app.post("/agent/run", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid json", code: "invalid_json" }, 400);
    const prompt = (body as { prompt?: unknown }).prompt;
    const title = (body as { title?: unknown }).title;
    const promptStr = typeof prompt === "string" ? prompt.trim() : "";
    if (!promptStr) return c.json({ error: "prompt is required", code: "missing_prompt" }, 400);
    const id = nextRunId();
    const run = {
      id,
      factory_uid: undefined,
      factory_name: "",
      title: typeof title === "string" && title.trim() ? title.trim() : promptStr.slice(0, 120),
      prompt: promptStr,
      status: "queued" as const,
      stage: "Triage" as const,
      work_item_id: "",
      followups: [] as string[],
    };
    const { runRepo } = getRepos();
    runRepo.create(run as any);
    return c.json(run, 201);
  });

  return app;
}
