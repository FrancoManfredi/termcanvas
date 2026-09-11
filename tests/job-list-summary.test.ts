/**
 * job-list-summary — Ola B1 (`GET /factory/jobs?view=summary`).
 *
 * Root cause (medido 2026-09-09): el poll 2.5s descarga 6 MB en ~28s porque
 * la lista full trae 444 jobs con `timeline` (54%) + `logs` (24%) + la
 * envoltura duplicada `{jobs, workItems}`. Cada tick aborta a los 3s y
 * reintenta: churn constante de red + CPU (daemon serializando, renderer
 * parseando) que ningún memo de React puede compensar.
 *
 * Fix (3 archivos):
 * - `workItem/jobView.ts: toListSummary` — lo que el poll necesita y nada
 *   más (sin prompt/timeline/cost/logs/createdFiles/modelRef/reviewerRef/
 *   agentSessions/dir; `timeline: []` + `timelineCount`/`lastEventAt`).
 * - `jobs/jobService.ts: projectSummaryTimeline + listJobSummaries` — una
 *   pasada reversa por item proyecta `issueRef`/`pr`/`triageAnswered`/
 *   `parked` (lo que el renderer leía con reverse-scans por fila y por tick).
 * - `factoryServer.ts` — `?view=summary` responde `{jobs}` de una sola
 *   clave; la vista full queda intacta por default (FactoryLab).
 * Offline en tmp (crear+borrar como jobs-domain), sin daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toListSummary } from "../headless-runtime/workItem/jobView.ts";
import {
  listJobSummaries,
  projectSummaryTimeline,
} from "../headless-runtime/factory/jobs/jobService.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import {
  BOOT_INTERRUPTED_META_KEY,
  RESUMED_META_KEY,
  type WorkItem,
} from "../shared/types/workItem.ts";

// Sandbox del índice (los tests que crean jobs deben apuntar
// TERMCANVAS_FACTORY_DIR a tmp: si no, `recordJobDirInIndex` ensucia el
// `.job-index.json` real del repo — ver tests/job-index.test.ts).
const PREV_FACTORY_DIR = process.env.TERMCANVAS_FACTORY_DIR;
const SANDBOX_FACTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "b1-sum-idx-"));
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY_DIR;
test.after(() => {
  try {
    if (PREV_FACTORY_DIR === undefined) delete process.env.TERMCANVAS_FACTORY_DIR;
    else process.env.TERMCANVAS_FACTORY_DIR = PREV_FACTORY_DIR;
  } catch {
    // best-effort
  }
  rmTmp(SANDBOX_FACTORY_DIR);
});

function mkTmp(prefix = "b1-summary-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

const createdIds: string[] = [];
const createdDirs: string[] = [];

function mkJob(id: string): string {
  const dir = mkTmp();
  createdDirs.push(dir);
  workItemStore.create({ id, prompt: `prompt de prueba ${id}`, worktree: dir });
  createdIds.push(id);
  return dir;
}

function cleanup(): void {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of createdDirs.splice(0)) rmTmp(dir);
}

function item(overrides: Record<string, unknown> = {}): WorkItem {
  return {
    id: "job-b1",
    prompt: "hacer algo",
    worktree: "C:/repo",
    phase: "diagnosisLlm",
    status: "Building",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:01.000Z",
    timeline: [
      {
        id: "job-b1-t0",
        from: "Intake",
        to: "Intake",
        at: "2026-09-01T00:00:00.000Z",
        actor: "user",
        message: "created",
      },
    ],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir: null,
    dotDonePath: "",
    runnerId: "linux-build",
    ...overrides,
  } as unknown as WorkItem;
}

// ─── toListSummary: cae lo pesado, queda el contrato del poll ────────────

test("summary drops timeline/logs/cost/prompt, keeps poll contract", () => {
  const s = toListSummary(
    item({
      logs: ["l1", "l2"],
      createdFiles: ["a.ts"],
      modelRef: { providerID: "p", modelID: "m" },
      agentSessions: { foreman: "s1" },
      dir: "C:/d",
      isolation: { branch: "issue-7", prUrl: "https://x/y/pull/61", prNumber: 61 },
      dashboardUrl: "https://opencode/s1",
    }),
  );
  assert.equal(s.id, "job-b1");
  assert.equal(s.status, "Building");
  assert.equal(s.state, "running");
  assert.equal(s.updatedAt, "2026-09-01T00:00:01.000Z");
  assert.deepEqual(s.timeline, []);
  assert.equal(s.timelineCount, 1);
  assert.equal(s.lastEventAt, "2026-09-01T00:00:00.000Z");
  assert.ok(!("prompt" in s), "prompt stays in full/detail only");
  assert.ok(!("logs" in s), "logs stay in full/detail only");
  assert.ok(!("cost" in s), "cost stays in full/detail only");
  assert.ok(!("createdFiles" in s));
  assert.ok(!("modelRef" in s));
  assert.ok(!("agentSessions" in s));
  assert.ok(!("dir" in s));
  const isolation = s.isolation as Record<string, unknown>;
  assert.equal(isolation.branch, "issue-7");
  assert.equal(isolation.prUrl, "https://x/y/pull/61");
  assert.equal(s.dashboardUrl, "https://opencode/s1");
});

test("summary passes extras through and never throws on junk", () => {
  const s = toListSummary(item(), { triage: { openQuestions: ["q?"] } });
  assert.deepEqual((s.triage as Record<string, unknown>).openQuestions, ["q?"]);
  const junk = toListSummary(null as unknown as WorkItem);
  assert.equal(typeof junk, "object");
});

// ─── projectSummaryTimeline: una pasada, cuatro proyecciones ─────────────

function entry(meta: Record<string, unknown>, at = "2026-09-02T00:00:00.000Z"): unknown {
  return { id: "t", from: "Triage", to: "Triage", at, actor: "system", message: "m", meta };
}

test("newest issueRef and pr win, parked dominates", () => {
  const out = projectSummaryTimeline(
    [
      entry({ issueRef: { provider: "github", issueNumber: 7, repo: "o/r" } }, "2026-09-01T00:00:00.000Z"),
      entry({ issueRef: { provider: "github", issueNumber: 9, repo: "o/r" } }, "2026-09-02T00:00:00.000Z"),
      entry({ pr: { prUrl: "https://x/y/pull/61", prNumber: 61 } }, "2026-09-03T00:00:00.000Z"),
      entry({ [BOOT_INTERRUPTED_META_KEY]: true }, "2026-09-04T00:00:00.000Z"),
    ],
    "Building",
  );
  assert.equal((out.issueRef as Record<string, unknown>).issueNumber, 9);
  assert.equal((out.pr as Record<string, unknown>).prUrl, "https://x/y/pull/61");
  assert.equal(out.parked, true);
  assert.ok(!("triageAnswered" in out));
});

test("foreman decision projected compact; junk/incomplete degrades out", () => {
  const out = projectSummaryTimeline(
    [
      entry(
        {
          foremanDecision: {
            decision: "needs_triage",
            reason: "fallback: LLM no disponible — session.create fallo",
            confidence: 0.52,
            retryable: true,
          },
        },
        "2026-09-03T00:00:00.000Z",
      ),
      entry(
        { foremanDecision: { decision: "building", reason: "prompt claro", confidence: 0.9 } },
        "2026-09-05T00:00:00.000Z",
      ),
    ],
    "Triage",
  );
  assert.deepEqual(out.foreman, {
    decision: "building",
    reason: "prompt claro",
    confidence: 0.9,
  });
  const noDecision = projectSummaryTimeline(
    [entry({ foremanDecision: { reason: "sin decision" } })],
    "Triage",
  );
  assert.ok(!("foreman" in noDecision), "a decision-less meta never claims a route");
  assert.ok(!("foreman" in projectSummaryTimeline(null, "Triage")));
});

test("Triage never parks (PARKABLE = Foreman/Building/Review by design)", () => {
  const out = projectSummaryTimeline(
    [entry({ [BOOT_INTERRUPTED_META_KEY]: true })],
    "Triage",
  );
  assert.ok(!("parked" in out), "same as renderer needsResume semantics");
});

test("resumed clears parked; answers gate triageAnswered to Triage", () => {
  const timeline = [
    entry({ [BOOT_INTERRUPTED_META_KEY]: true }, "2026-09-01T00:00:00.000Z"),
    entry({ [RESUMED_META_KEY]: true }, "2026-09-02T00:00:00.000Z"),
    entry({ triageRespond: { answers: ["sí, dale"] } }, "2026-09-03T00:00:00.000Z"),
  ];
  const triage = projectSummaryTimeline(timeline, "Triage");
  assert.ok(!("parked" in triage));
  assert.equal(triage.triageAnswered, true);
  const building = projectSummaryTimeline(timeline, "Building");
  assert.ok(!("triageAnswered" in building), "answers only matter in Triage");
});

test("junk timeline degrades to honest-empty", () => {
  assert.deepEqual(projectSummaryTimeline(null, "Triage"), {});
  assert.deepEqual(projectSummaryTimeline("junk", null), {});
});

// ─── listJobSummaries: tienda real, forma summary ────────────────────────

test("listJobSummaries returns summary shape for store jobs", () => {
  mkJob("job-b1-sum-a");
  const dirB = mkJob("job-b1-sum-b");
  try {
    workItemStore.appendEvent(
      "job-b1-sum-b",
      "system",
      "resolve link github#67",
      { issueRef: { provider: "github", issueNumber: 67, repo: "o/r" } },
    );
    void dirB;
    const list = listJobSummaries({
      extrasFor: () => ({ probe: true }),
    });
    const a = list.find((j) => j.id === "job-b1-sum-a") as Record<string, unknown>;
    const b = list.find((j) => j.id === "job-b1-sum-b") as Record<string, unknown>;
    assert.ok(a, "store job listed");
    assert.ok(b, "store job with meta listed");
    for (const row of [a, b]) {
      assert.deepEqual(row.timeline, []);
      assert.ok(typeof row.timelineCount === "number" && (row.timelineCount as number) >= 1);
      assert.ok(!("prompt" in row));
      assert.ok(!("logs" in row));
      assert.equal(row.probe, true, "extras applied");
    }
    assert.equal(
      (b.issueRef as Record<string, unknown>).issueNumber,
      67,
      "timeline issueRef projected",
    );
    assert.ok(!("issueRef" in a), "no ref invented");
  } finally {
    cleanup();
  }
});
