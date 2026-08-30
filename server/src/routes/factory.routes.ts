import { Hono } from "hono";
import { getDb } from "../db/sqlite.js";
import { FactoryRepoSQLite } from "../db/factory.repo.js";
import { WorkItemRepoSQLite } from "../db/workItem.repo.js";
import { RunRepoSQLite } from "../db/run.repo.js";
import { isTicketRef, validateFactoryCreate } from "../lib/validation.js";
import { createGitHubAppService } from "../lib/githubApp.js";

let runSeq = 0;
function nextRunId(): string {
  runSeq += 1;
  return `run_api_${Date.now()}_${runSeq}`;
}
let wiSeq = 0;
function nextWorkItemId(): string {
  wiSeq += 1;
  return `wi_${Date.now()}_${wiSeq}`;
}

function derivedTitle(prompt: string): string {
  const first = prompt.trim().split(/\r?\n/, 1)[0] ?? "Factory run";
  return first.slice(0, 120) || "Factory run";
}

export function resetFactoryRoutesSeq(): void {
  runSeq = 0;
  wiSeq = 0;
}

export function createFactoryRoutes(): Hono {
  const app = new Hono();

  const getRepos = () => {
    const db = getDb();
    return {
      factoryRepo: new FactoryRepoSQLite(db),
      workItemRepo: new WorkItemRepoSQLite(db),
      runRepo: new RunRepoSQLite(db),
    };
  };

  app.get("/health", (c) => {
    const db = getDb();
    const factoryRepo = new FactoryRepoSQLite(db);
    let factories = 0;
    try {
      factories = factoryRepo.count();
    } catch {
      factories = factoryRepo.list().length;
    }
    const github = createGitHubAppService();
    return c.json({ ok: true, mode: (process.env.VITE_FACTORY_BACKEND as string) ?? "local", factories, version: "O16", githubMode: github.mode }, 200);
  });
  app.get("/api/v1/health", (c) => {
    const db = getDb();
    const factoryRepo = new FactoryRepoSQLite(db);
    let factories = 0;
    try {
      factories = factoryRepo.count();
    } catch {
      factories = factoryRepo.list().length;
    }
    const github = createGitHubAppService();
    return c.json({ ok: true, mode: (process.env.VITE_FACTORY_BACKEND as string) ?? "local", factories, version: "O16", githubMode: github.mode }, 200);
  });

  // GET /api/v1/factory?search
  app.get("/api/v1/factory", (c) => {
    const search = c.req.query("search");
    const { factoryRepo } = getRepos();
    const factories = factoryRepo.toSummaries(search);
    return c.json({ factories }, 200);
  });

  // GET /api/v1/factory/:uid
  app.get("/api/v1/factory/:uid", (c) => {
    const uid = c.req.param("uid");
    const { factoryRepo } = getRepos();
    const factory = factoryRepo.getByUid(uid);
    if (!factory) {
      return c.json({ error: `Factory '${uid}' not found`, code: "factory_not_found" }, 404);
    }
    return c.json(
      {
        factory: {
          uid: factory.uid,
          name: factory.name,
          alias: factory.alias,
          repositories: (factory as unknown as { repositories?: unknown }).repositories ?? [],
          repositoryCount: factory.repositories.length,
          integrationCount: factory.integrations.length,
          policyId: factory.policyId,
          createdAt: factory.createdAt,
        },
      },
      200
    );
  });

  // POST /api/v1/factory
  app.post("/api/v1/factory", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid json", code: "invalid_json" }, 400);
    }
    const { factoryRepo } = getRepos();
    const input = body as {
      name?: string;
      alias?: string;
      description?: string;
      repositories?: { owner: string; name: string }[];
      integrations?: string[];
    };
    const existing = factoryRepo.list();
    const result = validateFactoryCreate(
      {
        name: input.name ?? "",
        alias: input.alias,
        description: input.description,
        repositories: input.repositories ?? [],
        integrations: input.integrations ?? [],
      },
      { existing, now: () => new Date().toISOString() }
    );
    if (!result.ok || !result.value) {
      const first = result.issues[0];
      const code = first?.code ?? "validation_error";
      return c.json({ error: first?.message ?? "validation failed", code, details: result.issues.map((i) => i.message), issues: result.issues }, 400);
    }
    try {
      factoryRepo.create(result.value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique/i.test(msg) || /UNIQUE/i.test(msg)) {
        return c.json({ error: "Ya existe una factory con ese nombre", code: "name_unique" }, 400);
      }
      return c.json({ error: msg, code: "create_failed" }, 500);
    }
    return c.json({ factory: result.value }, 201);
  });

  // POST /api/v1/factory/:uid/runs — create run + work item, validates ticket_ref, creates GitHub issue (real or dry_run)
  app.post("/api/v1/factory/:uid/runs", async (c) => {
    const uid = c.req.param("uid");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid json", code: "invalid_json" }, 400);
    }
    const { prompt, title, ticket_ref, ticket_url } = body as {
      prompt?: unknown;
      title?: unknown;
      ticket_ref?: unknown;
      ticket_url?: unknown;
    };
    const promptStr = typeof prompt === "string" ? prompt.trim() : "";
    if (!promptStr) {
      return c.json({ error: "prompt is required", code: "missing_prompt" }, 400);
    }
    if (ticket_ref !== undefined && ticket_ref !== null && typeof ticket_ref === "string" && ticket_ref.trim() !== "") {
      if (!isTicketRef(ticket_ref.trim())) {
        return c.json({ error: "ticket_ref must match /^[a-z]+:[A-Za-z0-9-_]+$/", code: "invalid_ticket_ref" }, 400);
      }
    } else if (ticket_ref !== undefined && typeof ticket_ref !== "string" && ticket_ref !== null) {
      return c.json({ error: "ticket_ref must be string", code: "invalid_ticket_ref" }, 400);
    }

    const { factoryRepo, workItemRepo, runRepo } = getRepos();
    const factory = factoryRepo.getByUid(uid);
    if (!factory) {
      return c.json({ error: `Factory '${uid}' not found`, code: "factory_not_found" }, 404);
    }

    // GitHub App handling: create issue if no ticket_ref provided and factory has a repo
    const github = createGitHubAppService();
    let ticketRefToStore = typeof ticket_ref === "string" ? ticket_ref.trim() : undefined;
    let ticketUrlToStore = typeof ticket_url === "string" ? ticket_url.trim() : undefined;
    const titleStr = typeof title === "string" ? title.trim() : "";
    const derived = typeof titleStr === "string" && titleStr ? titleStr : derivedTitle(promptStr);
    const hasTicketRef = Boolean(ticketRefToStore && ticketRefToStore.length > 0);

    // If no ticket_ref and factory has at least one repository, attempt to create GitHub issue
    // This is the O17 GH-P0-01 flow: con B1 -> issue real factory:<alias>+mention en payments-service
    if (!hasTicketRef && factory.repositories.length > 0) {
      const primary = factory.repositories[0] as { owner: string; name: string };
      const owner = primary.owner;
      const repo = primary.name;
      const handle = "@warp-factory";
      const label = `factory:${factory.alias}`;
      const issueTitle = derived;
      const issueBody = `${promptStr}\n\n${handle}`;
      try {
        const issue = await github.createIssue({ owner, repo, title: issueTitle, body: issueBody, labels: [label] });
        ticketRefToStore = `github:${issue.number}`;
        ticketUrlToStore = issue.html_url;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Map to github_error but keep 502 so web can show banner? For real failures we return 502
        return c.json({ error: msg, code: "github_error" }, 502);
      }
    } else if (hasTicketRef) {
      // ticket_ref already supplied; still ensure label exists if real mode and github: ref?
      // No-op for now; don't create extra issue
    } else {
      // No repo to create issue against and no ticket_ref: still produce dry_run banner but no github ticket?
      // For factories without repo, keep ticket_ref undefined
      // But we still want banner for dry_run mode
    }

    const now = new Date().toISOString();
    const wiId = nextWorkItemId();
    const stage: "Triage" | "Planning" | "Building" | "Reviewing" | "Complete" | "Cancelled" = "Triage";
    const workItem = {
      id: wiId,
      factoryName: factory.name,
      title: derived,
      description: promptStr,
      source: "factory" as const,
      sourceRef: ticketRefToStore,
      createdBy: "factory-api",
      createdAt: now,
      stage,
      history: [
        {
          id: `evt_${wiId}_0`,
          workItemId: wiId,
          from: stage,
          to: stage,
          actor: "foreman" as const,
          at: now,
          reason: "intake",
          metadata: {},
        },
      ],
      linkedPRs: [],
      assigneeAgent: "triage" as const,
    };

    try {
      workItemRepo.create(workItem as never);
    } catch (e) {
      return c.json({ error: "failed to create work item", code: "work_item_error", details: [String(e)] }, 500);
    }

    const runId = nextRunId();
    const run = {
      id: runId,
      factory_uid: factory.uid,
      factory_name: factory.name,
      title: workItem.title,
      prompt: promptStr,
      status: "queued" as const,
      stage,
      work_item_id: wiId,
      ticket_ref: ticketRefToStore,
      ticket_url: ticketUrlToStore,
      followups: [] as string[],
    };

    try {
      runRepo.create(run as never);
    } catch (e) {
      return c.json({ error: "failed to create run", code: "run_error", details: [String(e)] }, 500);
    }

    const responseBody: Record<string, unknown> = { ...run };
    if (github.mode === "dry_run") {
      (responseBody as Record<string, unknown>)._dryRun = true;
      (responseBody as Record<string, unknown>)._banner = "dry-run — sin GitHub App";
      (responseBody as Record<string, unknown>).dryRun = true;
      (responseBody as Record<string, unknown>).banner = "dry-run — sin GitHub App";
    }

    return c.json(responseBody, 201);
  });

  // POST /api/v1/factory/import — manual migration from localStorage export
  app.post("/api/v1/factory/import", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid json", code: "invalid_json" }, 400);
    }
    const factoriesInput = (body as { factories?: unknown; selectedUid?: unknown; version?: unknown }).factories;
    if (!Array.isArray(factoriesInput)) {
      return c.json({ error: "factories must be array", code: "invalid_import" }, 400);
    }
    const { factoryRepo } = getRepos();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const raw of factoriesInput) {
      const f = raw as {
        name?: string;
        alias?: string;
        uid?: string;
        description?: string;
        repositories?: { owner: string; name: string }[];
        integrations?: string[];
      };
      const name = f.name?.trim() ?? "";
      if (!name) {
        skipped += 1;
        errors.push("missing name for entry");
        continue;
      }
      const result = validateFactoryCreate(
        {
          name,
          alias: f.alias,
          description: f.description,
          repositories: f.repositories ?? [],
          integrations: f.integrations ?? [],
        },
        {
          existing: [...factoryRepo.list()],
          now: () => new Date().toISOString(),
          uid: () => f.uid ?? `uid_${name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}_${Date.now()}`,
        }
      );
      if (!result.ok || !result.value) {
        skipped += 1;
        errors.push(result.issues[0]?.message ?? "validation failed");
        continue;
      }
      if (factoryRepo.getByUid(result.value.uid) || factoryRepo.getByName(result.value.name)) {
        skipped += 1;
        continue;
      }
      try {
        factoryRepo.create(result.value);
        imported += 1;
      } catch (e) {
        skipped += 1;
        errors.push(String(e));
      }
    }
    return c.json({ imported, skipped, errors: errors.slice(0, 5) }, 200);
  });

  return app;
}
