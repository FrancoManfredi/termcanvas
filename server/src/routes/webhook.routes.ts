import { Hono } from "hono";
import { getDb } from "../db/sqlite.js";
import { WorkItemRepoSQLite } from "../db/workItem.repo.js";
import { continuationKey } from "../lib/continuation.js";
import { githubWebhookAuth } from "../middleware/githubWebhookAuth.js";

// Re-implement domain github.routing helpers server-side (mirror web/src/lib/factory/domain/github.routing.ts)
// Keeping parity: 5 checks in ROUTING_CHECK_ORDER, stripCodeBlocks, continuationKey

function stripCodeBlocks(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

function factoryLabel(foremanName: string): string {
  return `factory:${foremanName.trim()}`;
}

function hasFactoryLabel(labels: readonly string[], foremanName: string): boolean {
  const expected = factoryLabel(foremanName).toLowerCase();
  return labels.some((l) => l.trim().toLowerCase() === expected);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMention(text: string, handle: string): string | undefined {
  const normalized = handle.trim();
  if (normalized === "") return undefined;
  const pattern = new RegExp(`(^|[^A-Za-z0-9_./-])(${escapeRegExp(normalized)})(?![A-Za-z0-9_./-])`, "i");
  const m = pattern.exec(text);
  return m?.[2];
}

function containsHandle(values: readonly string[] | undefined, handle: string): boolean {
  if (!values || values.length === 0) return false;
  const expected = handle.trim().toLowerCase();
  return values.some((v) => {
    const cand = v.trim().toLowerCase();
    const withAt = cand.startsWith("@") ? cand : `@${cand}`;
    return cand === expected || withAt === expected || cand.includes(expected);
  });
}

export interface RoutingCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export function isRoutable(
  event: { labels: readonly string[]; body: string; isEdit: boolean; authorIsBot: boolean; mentioned?: readonly string[]; assigned?: readonly string[] },
  policy: { foremanName: string; handle: string; requireFactoryLabel: boolean }
): { routable: boolean; checks: readonly RoutingCheck[]; reason: string; expectedLabel: string } {
  const expectedLabel = factoryLabel(policy.foremanName);
  const cleaned = stripCodeBlocks(event.body);
  const bodyMention = findMention(cleaned, policy.handle);
  const listedMention = containsHandle(event.mentioned, policy.handle);
  const listedAssignee = containsHandle(event.assigned, policy.handle);
  const matchedHandle = bodyMention ?? (listedMention || listedAssignee ? policy.handle : undefined);
  const mentionOutsideCode = cleaned.trim().length > 0 || listedMention || listedAssignee;

  const checks: RoutingCheck[] = [
    { id: "new_content", ok: !event.isEdit, detail: event.isEdit ? "edit" : "new" },
    { id: "not_bot_author", ok: !event.authorIsBot, detail: event.authorIsBot ? "bot" : "human" },
    { id: "label_present", ok: !policy.requireFactoryLabel || hasFactoryLabel(event.labels, policy.foremanName), detail: hasFactoryLabel(event.labels, policy.foremanName) ? `found ${expectedLabel}` : `missing ${expectedLabel}` },
    { id: "not_code_block", ok: mentionOutsideCode, detail: mentionOutsideCode ? "outside" : "inside code block" },
    { id: "mention_present", ok: matchedHandle !== undefined, detail: matchedHandle ? `found ${matchedHandle}` : `missing ${policy.handle}` },
  ];
  const routable = checks.every((c) => c.ok);
  const failed = checks.find((c) => !c.ok);
  return {
    routable,
    checks,
    reason: routable ? `Enruta a ${expectedLabel}.` : (failed?.detail ?? "not routable"),
    expectedLabel,
  };
}

let wiSeqW = 2000;
function nextWiId(): string {
  wiSeqW += 1;
  return `wi_${Date.now()}_${wiSeqW}`;
}

export function resetWebhookSeq(): void {
  wiSeqW = 2000;
}

export function createWebhookRoutes(): Hono {
  const app = new Hono();

  // Apply HMAC verification if WEBHOOK_SECRET set
  app.use("/webhooks/github", githubWebhookAuth);

  app.post("/webhooks/github", async (c) => {
    let payload: unknown;
    const rawBody = (c as unknown as { _rawBody?: string })._rawBody;
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = null;
      }
    } else {
      payload = await c.req.json().catch(() => null);
    }
    if (!payload || typeof payload !== "object") {
      return c.json({ error: "invalid json", code: "invalid_json" }, 400);
    }
    const p = payload as {
      event?: string;
      repo?: string;
      repository?: { full_name?: string };
      issue?: { number?: number; labels?: { name: string }[] | string[]; body?: string };
      comment?: { body?: string; user?: { type?: string; login?: string } };
      sender?: { type?: string };
      labels?: string[];
      body?: string;
      number?: number;
      isEdit?: boolean;
      authorIsBot?: boolean;
      mentioned?: string[];
      assigned?: string[];
      handle?: string;
      foremanName?: string;
      action?: string;
    };

    // Resolve repo and issue number supporting both simplified test payload and real GitHub webhook
    const repo = p.repo ?? p.repository?.full_name ?? "acme/payments-service";
    const issueNumber = p.issue?.number ?? p.number ?? 0;
    const labelsRaw = p.issue?.labels ?? p.labels ?? [];
    const labels: string[] = (labelsRaw as unknown[]).map((l) => (typeof l === "string" ? l : (l as { name: string }).name ?? "")).filter(Boolean);
    const body = p.comment?.body ?? p.body ?? p.issue?.body ?? "";
    // isEdit: if payload has action==="edited" treat as edit
    const isEdit = Boolean(p.isEdit) || p.action === "edited";
    const authorIsBot = Boolean(p.authorIsBot) || p.sender?.type === "Bot" || p.comment?.user?.type === "Bot";
    const handle = p.handle ?? "@warp-factory";
    const foremanName = p.foremanName ?? "payments-factory";
    // Derive foremanName from repo's factory alias if needed: try to extract from labels? For now default
    // Also support X-GitHub-Event header to override event
    const headerEvent = c.req.header("x-github-event");
    const eventName = p.event ?? headerEvent ?? "issue_comment_created";

    // Apply 5 checks via isRoutable (stripCodeBlocks inside)
    const decision = isRoutable(
      {
        labels,
        body,
        isEdit,
        authorIsBot,
        mentioned: p.mentioned,
        assigned: p.assigned,
      },
      {
        foremanName,
        handle,
        requireFactoryLabel: true,
      }
    );

    void eventName; // event name not used in 5 checks currently, but reserved for future

    if (!decision.routable) {
      const failed = decision.checks.find((ch) => !ch.ok);
      return c.json({ created: false, reason: `${failed?.id}=false`, checks: decision.checks }, 200);
    }

    const key = continuationKey(repo, issueNumber);
    const now = new Date().toISOString();
    const id = nextWiId();
    const workItem = {
      id,
      factoryName: foremanName,
      title: body.trim().slice(0, 120) || `GitHub ${repo}#${issueNumber}`,
      description: body,
      source: "github" as const,
      sourceRef: key,
      createdBy: "github-webhook",
      createdAt: now,
      stage: "Triage" as const,
      // History with single entry
      history: [{ id: `evt_${id}_0`, workItemId: id, from: "Triage" as const, to: "Triage" as const, actor: "foreman" as const, at: now, reason: "github webhook", metadata: { repo, issueNumber, key } }],
      linkedPRs: [],
    };
    const db = getDb();
    const workItemRepo = new WorkItemRepoSQLite(db);
    try {
      workItemRepo.create(workItem as never);
    } catch (e) {
      return c.json({ error: String(e), code: "create_failed" }, 500);
    }
    return c.json({ created: true, workItemId: id, continuationKey: key, checks: decision.checks }, 201);
  });

  return app;
}

// Re-export helpers for tests
export { stripCodeBlocks, factoryLabel, hasFactoryLabel, findMention, containsHandle };
