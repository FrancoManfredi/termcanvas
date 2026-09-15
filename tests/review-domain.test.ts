/**
 * FASE 2 E2 — dominio review: lecturas, guards y transiciones humanas.
 *
 * Congela parseo exacto (fábrica + alias, caídas a handlers siguientes),
 * guards 404/409 (id desconocido, fuera de Review; sin budget: el humano
 * reintenta siempre),
 * cuerpos del GET (incluido raw best-effort), transiciones Review→Complete
 * y Review→Building con sus mensajes, reintento solo-review sin re-correr
 * implement, ask_human quieto (sin transición) y paridad contra la tabla
 * canónica. Todo offline en tmp, sin daemon, sin docker, sin LLM.
 * Mocks solo acá (run/schedule/onAccepted inyectados, jamás en el dominio).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { buildAskHumanResult, decideReviewNext } from "../shared/types/review.ts";
import {
  acceptReviewEqual,
  getReviewById,
  readReviewRawById,
  requestReviewRetryOnly,
  requestReviewRetryToBuilding,
} from "../headless-runtime/factory/review/reviewActions.ts";
import {
  parseReviewAcceptPath,
  parseReviewPath,
  parseReviewRetryPath,
  parseReviewRetryReviewPath,
  parseReviewStalePath,
} from "../headless-runtime/factory/review/reviewRoutes.ts";
import { matchRoute } from "../headless-runtime/factory/routing/routeTable.ts";
import { writeReviewJsonAtomic, writeReviewRawAtomic } from "../headless-runtime/review/reviewDisk.ts";

function mkTmp(prefix = "f2e2-review-"): string {
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

function mkJob(id: string, prompt = `prompt de prueba ${id}`): string {
  const dir = mkTmp();
  createdDirs.push(dir);
  workItemStore.create({ id, prompt, worktree: dir });
  createdIds.push(id);
  return dir;
}

/** Lleva un job a Review por transiciones permitidas (sin LLM ni daemon). */
function toReview(id: string): void {
  workItemStore.transition(id, "Foreman", "system", "f2e2 → Foreman");
  workItemStore.transition(id, "Building", "foreman", "f2e2 → Building");
  workItemStore.transition(id, "Review", "runner", "f2e2 → Review");
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

function mkReviewResult(id: string, attempt: number) {
  return buildAskHumanResult({
    workItemId: id,
    reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
    reviewAttempt: attempt,
    summary: `resumen de prueba ${id}`,
  });
}

// ── Budget y veredictos intactos ──

test("F2-E2 review: cota MAX_REVIEW_ROUNDS (revise → Building 1 vez, luego stay) y veredictos intactos", () => {
  assert.equal(decideReviewNext("accept", 0), "Complete");
  assert.equal(decideReviewNext("revise", 0), "Building");
  assert.equal(decideReviewNext("revise", 1), null);
  assert.equal(decideReviewNext("revise", 99), null);
});

test("F2-E2 review: ask_human quieto (sin transición, queda en Review)", () => {
  assert.equal(decideReviewNext("ask_human", 0), null);
  assert.equal(decideReviewNext("ask_human", 1), null);
  assert.equal(decideReviewNext("ask_human", 2), null);
});

// ── Matchers ──

test("F2-E2 review: parseReviewPath ok dual + 400 sin id + null ajeno", () => {
  assert.deepEqual(parseReviewPath("GET", "/factory/jobs/job-f2e2-a/review"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseReviewPath("GET", "/work-items/job-f2e2-a/review"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: true,
  });
  assert.deepEqual(parseReviewPath("GET", "/factory/jobs/review"), {
    error: "missing id for review",
  });
  assert.equal(parseReviewPath("POST", "/factory/jobs/job-f2e2-a/review"), null);
  assert.equal(parseReviewPath("GET", "/factory/jobs/job-f2e2-a/review/raw"), null);
  assert.equal(parseReviewPath("GET", "/factory/jobs/job-f2e2-a/review/accept"), null);
  assert.equal(parseReviewPath("GET", "/otro/job-f2e2-a/review"), null);
  assert.equal(parseReviewPath("GET", 123), null);
});

test("F2-E2 review: matchers POST ok dual + null ante método o longitud", () => {
  assert.deepEqual(parseReviewAcceptPath("POST", "/factory/jobs/job-f2e2-a/review/accept"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseReviewAcceptPath("POST", "/work-items/job-f2e2-a/review/accept"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: true,
  });
  assert.deepEqual(parseReviewRetryPath("POST", "/factory/jobs/job-f2e2-a/review/retry"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseReviewRetryReviewPath("POST", "/work-items/job-f2e2-a/review/retry-review"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: true,
  });
  assert.equal(parseReviewAcceptPath("GET", "/factory/jobs/job-f2e2-a/review/accept"), null);
  assert.equal(parseReviewRetryPath("POST", "/factory/jobs/job-f2e2-a/review/retry/extra"), null);
  assert.equal(parseReviewRetryReviewPath("POST", "/factory/jobs/job-f2e2-a/review/retry"), null);
  assert.equal(parseReviewRetryPath("POST", "/factory/jobs/job-f2e2-a/review/retry-review"), null);
});

test("F2-E2 review: parseReviewStalePath ok dual + 400 sin id + null ajeno", () => {
  assert.deepEqual(parseReviewStalePath("GET", "/factory/jobs/job-f2e2-a/review/stale"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseReviewStalePath("GET", "/work-items/job-f2e2-a/review/stale"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: true,
  });
  assert.deepEqual(parseReviewStalePath("GET", "/factory/jobs/review/stale"), {
    error: "missing id for review stale",
  });
  assert.equal(parseReviewStalePath("POST", "/factory/jobs/job-f2e2-a/review/stale"), null);
  assert.equal(parseReviewStalePath("GET", "/factory/jobs/job-f2e2-a/review"), null);
  assert.equal(parseReviewStalePath("GET", "/factory/jobs/job-f2e2-a/review/raw"), null);
  assert.equal(parseReviewStalePath("GET", "/otro/job-f2e2-a/review/stale"), null);
});

test("F2-E2 review: paridad total contra matchRoute (dominio+id+alias)", () => {
  const cases: Array<{ path: string; domain: string | null }> = [
    { path: "/factory/jobs/job-f2e2-a/review", domain: "job-review" },
    { path: "/work-items/job-f2e2-a/review", domain: "job-review" },
    { path: "/factory/jobs/job-f2e2-a/review/accept", domain: "job-review-accept" },
    { path: "/work-items/job-f2e2-a/review/accept", domain: "job-review-accept" },
    { path: "/factory/jobs/job-f2e2-a/review/retry", domain: "job-review-retry" },
    { path: "/work-items/job-f2e2-a/review/retry", domain: "job-review-retry" },
    { path: "/factory/jobs/job-f2e2-a/review/retry-review", domain: "job-review-retry-review" },
    { path: "/work-items/job-f2e2-a/review/retry-review", domain: "job-review-retry-review" },
    { path: "/factory/jobs/job-f2e2-a/review/stale", domain: "job-review-stale" },
    { path: "/work-items/job-f2e2-a/review/stale", domain: "job-review-stale" },
  ];
  for (const { path: p, domain } of cases) {
    const table = matchRoute(domain === "job-review" || domain === "job-review-stale" ? "GET" : "POST", p);
    assert.equal(table?.domain ?? null, domain, `tabla en ${p}`);
    const mine =
      domain === "job-review"
        ? parseReviewPath("GET", p)
        : domain === "job-review-stale"
          ? parseReviewStalePath("GET", p)
          : domain === "job-review-accept"
            ? parseReviewAcceptPath("POST", p)
            : domain === "job-review-retry"
              ? parseReviewRetryPath("POST", p)
              : parseReviewRetryReviewPath("POST", p);
    assert.ok(mine !== null && !("error" in mine), `match propio en ${p}`);
    if (mine !== null && !("error" in mine) && table?.id) {
      assert.equal(mine.id, table.id, `paridad id en ${p}`);
      assert.equal(mine.isWorkItemsAlias, table.isWorkItemsAlias === true, `paridad alias en ${p}`);
    }
  }
});

// ── Lecturas ──

test("F2-E2 review: ver por id 404 ante desconocido", () => {
  assert.deepEqual(getReviewById("job-f2e2-no-existe"), {
    ok: false,
    code: 404,
    error: "job not found: job-f2e2-no-existe",
  });
  assert.deepEqual(readReviewRawById("job-f2e2-no-existe"), {
    ok: false,
    code: 404,
    error: "job not found: job-f2e2-no-existe",
  });
});

test("F2-E2 review: ver por id expone forma con raw ausente y luego presente", () => {
  mkJob("job-f2e2-review-a");
  try {
    toReview("job-f2e2-review-a");
    const before = getReviewById("job-f2e2-review-a");
    assert.equal(before.ok, true);
    if (before.ok) {
      assert.equal(before.workItemId, "job-f2e2-review-a");
      assert.equal(before.status, "Review");
      assert.equal(before.reviewCount, 0);
      assert.equal(before.lastReview, null);
      assert.equal(before.hasRaw, false);
    }
    assert.deepEqual(readReviewRawById("job-f2e2-review-a"), {
      ok: false,
      code: 404,
      error: "review raw not found",
    });
    const wi = workItemStore.get("job-f2e2-review-a");
    assert.ok(wi?.dir);
    writeReviewJsonAtomic(wi.dir as string, mkReviewResult("job-f2e2-review-a", 1));
    writeReviewRawAtomic(wi.dir as string, 1, "crudo de prueba");
    const after = getReviewById("job-f2e2-review-a");
    assert.equal(after.ok, true);
    if (after.ok) {
      assert.equal(after.hasRaw, true);
      assert.deepEqual(
        (after.lastReview as { workItemId?: unknown }).workItemId,
        "job-f2e2-review-a",
      );
    }
    assert.deepEqual(readReviewRawById("job-f2e2-review-a"), {
      ok: true,
      text: "crudo de prueba",
    });
  } finally {
    cleanup();
  }
});

test("F2-E2 review: ver por id lee lastReview de la tienda sin tocar disco", () => {
  mkJob("job-f2e2-review-b");
  try {
    toReview("job-f2e2-review-b");
    workItemStore.setReview("job-f2e2-review-b", mkReviewResult("job-f2e2-review-b", 1), 1);
    const out = getReviewById("job-f2e2-review-b");
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.reviewCount, 1);
      assert.deepEqual(
        (out.lastReview as { verdict?: unknown }).verdict,
        "ask_human",
      );
    }
  } finally {
    cleanup();
  }
});

// ── Transiciones humanas ──

test("F2-E2 review: aceptar igual 404/409 y 200 con .done", () => {
  mkJob("job-f2e2-accept-a");
  mkJob("job-f2e2-accept-b");
  try {
    assert.deepEqual(acceptReviewEqual("job-f2e2-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e2-no-existe",
    });
    assert.deepEqual(acceptReviewEqual("job-f2e2-accept-a"), {
      ok: false,
      code: 409,
      error: "job not in Review (status=Intake)",
    });
    toReview("job-f2e2-accept-b");
    let seen = "";
    const out = acceptReviewEqual("job-f2e2-accept-b", {
      onAccepted: (id) => {
        seen = id;
      },
    });
    assert.deepEqual(out, { ok: true, id: "job-f2e2-accept-b", status: "Complete" });
    assert.equal(seen, "job-f2e2-accept-b");
    assert.equal(workItemStore.get("job-f2e2-accept-b")?.status, "Complete");
    const dir = workItemStore.get("job-f2e2-accept-b")?.dir as string;
    assert.equal(fs.existsSync(path.join(dir, ".done")), true);
    assert.deepEqual(acceptReviewEqual("job-f2e2-accept-b"), {
      ok: false,
      code: 409,
      error: "job not in Review (status=Complete)",
    });
  } finally {
    cleanup();
  }
});

test("F2-E2 review: reintentar a Building 404/409 y 200 limpia .done (sin budget: el humano reintenta siempre)", () => {
  mkJob("job-f2e2-retry-a");
  mkJob("job-f2e2-retry-b");
  mkJob("job-f2e2-retry-c");
  try {
    assert.deepEqual(requestReviewRetryToBuilding("job-f2e2-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e2-no-existe",
    });
    assert.deepEqual(requestReviewRetryToBuilding("job-f2e2-retry-a"), {
      ok: false,
      code: 409,
      error: "job not in Review (status=Intake)",
    });
    toReview("job-f2e2-retry-b");
    workItemStore.setReview("job-f2e2-retry-b", mkReviewResult("job-f2e2-retry-b", 2), 2);
    assert.deepEqual(requestReviewRetryToBuilding("job-f2e2-retry-b"), {
      ok: true,
      id: "job-f2e2-retry-b",
      status: "Building",
    });
    assert.equal(workItemStore.get("job-f2e2-retry-b")?.status, "Building");
    toReview("job-f2e2-retry-c");
    const dirC = workItemStore.get("job-f2e2-retry-c")?.dir as string;
    fs.writeFileSync(path.join(dirC, ".done"), "", "utf-8");
    let seenCount = -1;
    const out = requestReviewRetryToBuilding("job-f2e2-retry-c", {
      onAccepted: (_id, count) => {
        seenCount = count;
      },
    });
    assert.deepEqual(out, { ok: true, id: "job-f2e2-retry-c", status: "Building" });
    assert.equal(seenCount, 0);
    assert.equal(workItemStore.get("job-f2e2-retry-c")?.status, "Building");
    assert.equal(fs.existsSync(path.join(dirC, ".done")), false);
  } finally {
    cleanup();
  }
});

test("F2-E2 review: reintentar solo review valida guards y no re-corre implement (sin budget)", () => {
  mkJob("job-f2e2-ronly-a");
  mkJob("job-f2e2-ronly-b");
  try {
    assert.deepEqual(requestReviewRetryOnly("job-f2e2-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e2-no-existe",
    });
    assert.deepEqual(requestReviewRetryOnly("job-f2e2-ronly-a"), {
      ok: false,
      code: 409,
      error: "job not in Review (status=Intake)",
    });
    toReview("job-f2e2-ronly-b");
    workItemStore.setReview("job-f2e2-ronly-b", mkReviewResult("job-f2e2-ronly-b", 2), 2);
    assert.deepEqual(requestReviewRetryOnly("job-f2e2-ronly-b"), {
      ok: true,
      status: "Review",
    });
  } finally {
    cleanup();
  }
});

test("F2-E2 review: reintentar solo review 200 agenda run sin transicionar", () => {
  mkJob("job-f2e2-ronly-c");
  try {
    toReview("job-f2e2-ronly-c");
    const before = workItemStore.get("job-f2e2-ronly-c");
    const timelineLen = before?.timeline.length ?? 0;
    let ran: string[] = [];
    let logged = "";
    const out = requestReviewRetryOnly("job-f2e2-ronly-c", {
      onAccepted: (id, count) => {
        logged = `${id}:${count}`;
      },
      run: (id) => {
        ran.push(id);
        return Promise.resolve();
      },
      schedule: (fn) => fn(),
    });
    assert.deepEqual(out, { ok: true, status: "Review" });
    assert.deepEqual(ran, ["job-f2e2-ronly-c"]);
    assert.equal(logged, "job-f2e2-ronly-c:0");
    const after = workItemStore.get("job-f2e2-ronly-c");
    assert.equal(after?.status, "Review");
    assert.equal(after?.timeline.length, timelineLen);
  } finally {
    cleanup();
  }
});
