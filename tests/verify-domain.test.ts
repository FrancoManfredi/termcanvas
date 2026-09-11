/**
 * FASE 2 E1 — dominio verify: lectura de verify.json + encolado con dedupe.
 *
 * Congela parseo exacto (fábrica + alias, rechazos), guards 404/409,
 * cuerpos 404/500 del GET, dedupe de uno en vuelo y paridad contra los
 * exports delegados del cascarón. Todo offline en tmp, sin daemon,
 * sin docker, sin LLM. Mocks solo acá (run/schedule inyectados).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { writeVerifyJsonAtomic } from "../headless-runtime/implement/verifyEvidence.ts";
import {
  parseVerifyGetPath,
  parseVerifyRetryPath,
} from "../headless-runtime/factory/verify/verifyRoutes.ts";
import {
  checkVerifyRetryGuards,
  isVerifyRetryInFlight,
  readVerifyById,
  requestVerifyRetry,
  resetVerifyRetryForTests,
  scheduleVerifyRetryRun,
} from "../headless-runtime/factory/verify/verifyService.ts";
import {
  checkVerifyRetryGuards as srvGuards,
  parseVerifyGetPath as srvParseGet,
  parseVerifyRetryPath as srvParseRetry,
} from "../headless-runtime/factory/factoryServer.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

function mkTmp(prefix = "f2e1-verify-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function mkVerification(overall: "pass" | "fail" = "pass"): VerificationReport {
  const nowIso = new Date().toISOString();
  return {
    steps: [
      {
        name: "test",
        command: "pnpm test",
        exitCode: overall === "pass" ? 0 : 1,
        durationMs: 10,
        status: overall === "pass" ? "pass" : "fail",
        logSnippet: "ok",
        logPath: "logs/build.log",
      },
    ],
    overall,
    startedAt: nowIso,
    finishedAt: nowIso,
    durationMs: 10,
  };
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

function jobDir(id: string, fallback: string): string {
  try {
    return (workItemStore.get(id)?.dir as string) ?? fallback;
  } catch {
    return fallback;
  }
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
  resetVerifyRetryForTests();
}

function toTriage(id: string): void {
  workItemStore.transition(id, "Foreman", "foreman", "t");
  workItemStore.transition(id, "Triage", "foreman", "t");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Parseo: formas exactas ──

test("F2-E1 verify: parse retry (fábrica + alias, forma exacta)", () => {
  assert.deepEqual(parseVerifyRetryPath("/factory/jobs/job-abc/review/verify-retry"), {
    id: "job-abc",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseVerifyRetryPath("/work-items/job-abc/review/verify-retry"), {
    id: "job-abc",
    isWorkItemsAlias: true,
  });
});

test("F2-E1 verify: parse retry rechaza ajena/sin-id/traversal/reservada/extra", () => {
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/job-abc/review/retry-review"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/review/verify-retry"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/../review/verify-retry"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/a/extra/review/verify-retry"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/verify/review/verify-retry"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/verify-retry/review/verify-retry"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/job-abc/verify"));
  assert.ok("error" in parseVerifyRetryPath(42));
  assert.ok("error" in parseVerifyRetryPath(null));
});

test("F2-E1 verify: parse get (fábrica + alias, forma exacta, sin confundir retry)", () => {
  assert.deepEqual(parseVerifyGetPath("/factory/jobs/job-abc/verify"), {
    id: "job-abc",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseVerifyGetPath("/work-items/job-abc/verify"), {
    id: "job-abc",
    isWorkItemsAlias: true,
  });
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/job-abc/review/verify-retry"));
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/verify"));
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/verify/verify"));
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/../verify"));
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/job-abc/result"));
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/job-abc/verify/extra"));
});

// ── Guards ──

test("F2-E1 verify: guards (404 sin job, ok solo en Triage, 409 resto)", () => {
  assert.deepEqual(checkVerifyRetryGuards(null, "job-x"), {
    ok: false,
    code: 404,
    error: "job not found: job-x",
  });
  assert.deepEqual(checkVerifyRetryGuards({ status: "Triage" }, "job-x"), { ok: true });
  for (const status of ["Intake", "Foreman", "Building", "Review", "Complete", "Cancelled", undefined, 42]) {
    const g = checkVerifyRetryGuards({ status }, "job-x");
    assert.equal(g.ok, false, `status=${String(status)} debería ser 409`);
    if (!g.ok) {
      assert.equal(g.code, 409);
      assert.match(g.error, /not in Triage/);
    }
  }
});

// ── Lectura: 404 honestos + 500 + 200 ──

test("F2-E1 verify: lectura 200 con payload + 404/500 con cuerpos exactos", () => {
  const dir = mkJob("job-f2e1-verify-a");
  try {
    const jd = jobDir("job-f2e1-verify-a", dir);
    // Sin verify.json: 404 con hint congelado.
    assert.deepEqual(readVerifyById("job-f2e1-verify-a"), {
      ok: false,
      code: 404,
      error: "verify not found",
      hint: "sin verify.json todavía (re-verificación no corrida o writer pendiente)",
    });
    // Con verify.json válido: 200 con el payload.
    const written = writeVerifyJsonAtomic(jd, {
      workItemId: "job-f2e1-verify-a",
      verification: mkVerification("fail"),
      createdFiles: [],
    });
    assert.ok(written !== null);
    const ok = readVerifyById("job-f2e1-verify-a");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.payload.workItemId, "job-f2e1-verify-a");
      assert.equal((ok.payload.verification as VerificationReport).overall, "fail");
      assert.ok(typeof ok.payload.timestamp === "string");
    }
    // Corrupto: 500 inválido (el archivo existe pero no valida).
    fs.writeFileSync(path.join(jd, "verify.json"), "basura{{{", "utf-8");
    assert.deepEqual(readVerifyById("job-f2e1-verify-a"), {
      ok: false,
      code: 500,
      error: "verify.json inválido",
    });
    // Sin job: 404; id vacío: 404.
    assert.deepEqual(readVerifyById("job-f2e1-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e1-no-existe",
    });
    assert.deepEqual(readVerifyById(""), { ok: false, code: 404, error: "job not found: " });
  } finally {
    cleanup();
  }
});

test("F2-E1 verify: lectura con compat anterior (dir ajeno + sin dir)", () => {
  mkJob("job-f2e1-verify-b");
  try {
    const jd = jobDir("job-f2e1-verify-b", "");
    assert.ok(jd.length > 0);
    // La tienda manda aunque la compat traiga otro dir.
    writeVerifyJsonAtomic(jd, {
      workItemId: "job-f2e1-verify-b",
      verification: mkVerification("pass"),
      createdFiles: ["a.txt"],
    });
    const ok = readVerifyById("job-f2e1-verify-b", { legacy: { id: "job-f2e1-verify-b", dir: "/no/existe" } });
    assert.equal(ok.ok, true);
    // Compat sin dir y sin tienda: 404 sin directorio.
    assert.deepEqual(readVerifyById("job-f2e1-verify-c", { legacy: { id: "job-f2e1-verify-c", dir: null } }), {
      ok: false,
      code: 404,
      error: "verify not found",
      hint: "job sin directorio todavía",
    });
    // Compat de otro id se ignora (honesto).
    assert.deepEqual(readVerifyById("job-f2e1-verify-c", { legacy: { id: "otro", dir: jd } }), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e1-verify-c",
    });
  } finally {
    cleanup();
  }
});

// ── Dedupe: uno en vuelo por job ──

test("F2-E1 verify: dedupe (uno en vuelo por job, se libera al asentar)", async () => {
  resetVerifyRetryForTests();
  try {
    let calls = 0;
    const resolvers: Array<() => void> = [];
    const run = (_id: string): Promise<void> => {
      calls += 1;
      return new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    };
    const sync = (fn: () => void): void => fn();
    assert.equal(scheduleVerifyRetryRun("job-f2e1-w1", run, sync), true);
    assert.equal(isVerifyRetryInFlight("job-f2e1-w1"), true);
    assert.equal(scheduleVerifyRetryRun("job-f2e1-w1", run, sync), false);
    assert.equal(calls, 1);
    // Otro job no lo bloquea.
    assert.equal(scheduleVerifyRetryRun("job-f2e1-w2", run, sync), true);
    assert.equal(calls, 2);
    assert.equal(isVerifyRetryInFlight("job-f2e1-w2"), true);
    for (const resolve of resolvers.splice(0)) resolve();
    await sleep(10);
    assert.equal(isVerifyRetryInFlight("job-f2e1-w1"), false);
    // run inválido o planificador roto: false honesto, sin vuelo colgado.
    assert.equal(scheduleVerifyRetryRun("job-f2e1-w3", null as unknown as () => void, sync), false);
    assert.equal(isVerifyRetryInFlight("job-f2e1-w3"), false);
    assert.equal(
      scheduleVerifyRetryRun("job-f2e1-w4", run, () => {
        throw new Error("planificador roto");
      }),
      false,
    );
    assert.equal(isVerifyRetryInFlight("job-f2e1-w4"), false);
  } finally {
    resetVerifyRetryForTests();
  }
});

test("F2-E1 verify: run que falla libera el vuelo (sin colgados)", async () => {
  resetVerifyRetryForTests();
  try {
    const failing = (_id: string): Promise<void> => Promise.reject(new Error("falló"));
    assert.equal(scheduleVerifyRetryRun("job-f2e1-w5", failing, (fn) => fn()), true);
    await sleep(10);
    assert.equal(isVerifyRetryInFlight("job-f2e1-w5"), false);
    const syncThrow = (_id: string): void => {
      throw new Error("falló sync");
    };
    assert.equal(scheduleVerifyRetryRun("job-f2e1-w6", syncThrow, (fn) => fn()), true);
    assert.equal(isVerifyRetryInFlight("job-f2e1-w6"), false);
  } finally {
    resetVerifyRetryForTests();
  }
});

// ── Composición HTTP ──

test("F2-E1 verify: request (404/409 exactos, 200 con forma congelada)", async () => {
  mkJob("job-f2e1-verify-d");
  mkJob("job-f2e1-verify-e");
  try {
    toTriage("job-f2e1-verify-e");
    assert.deepEqual(requestVerifyRetry("job-f2e1-no-existe", {}), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e1-no-existe",
    });
    const guard = requestVerifyRetry("job-f2e1-verify-d", {});
    assert.equal(guard.ok, false);
    if (!guard.ok) {
      assert.equal(guard.code, 409);
      assert.match(guard.error, /not in Triage/);
    }
    let accepted: string[] = [];
    let scheduled = 0;
    const ok = requestVerifyRetry("job-f2e1-verify-e", {
      run: (_id: string) => Promise.resolve(),
      schedule: (fn) => {
        scheduled += 1;
        fn();
      },
      onAccepted: (id) => {
        accepted.push(id);
      },
    });
    assert.deepEqual(ok, { ok: true, id: "job-f2e1-verify-e", status: "Triage" });
    assert.deepEqual(accepted, ["job-f2e1-verify-e"]);
    assert.equal(scheduled, 1);
    await sleep(10);
    assert.equal(isVerifyRetryInFlight("job-f2e1-verify-e"), false);
    // onAccepted roto no rompe el 200.
    const ok2 = requestVerifyRetry("job-f2e1-verify-e", {
      onAccepted: () => {
        throw new Error("aviso roto");
      },
    });
    assert.deepEqual(ok2, { ok: true, id: "job-f2e1-verify-e", status: "Triage" });
    void accepted;
  } finally {
    cleanup();
  }
});

// ── Paridad contra el cascarón (delegación intacta) ──

test("F2-E1 verify: paridad total contra los exports delegados del cascarón", () => {
  const retryPaths = [
    "/factory/jobs/job-abc/review/verify-retry",
    "/work-items/job-abc/review/verify-retry",
    "/factory/jobs/job-abc/review/retry-review",
    "/factory/jobs/review/verify-retry",
    "/factory/jobs/verify/review/verify-retry",
    "/factory/jobs/job-abc/verify",
  ];
  for (const p of retryPaths) {
    assert.deepEqual(parseVerifyRetryPath(p), srvParseRetry(p), `retry delega igual en ${p}`);
  }
  const getPaths = [
    "/factory/jobs/job-abc/verify",
    "/work-items/job-abc/verify",
    "/factory/jobs/job-abc/review/verify-retry",
    "/factory/jobs/verify",
    "/factory/jobs/job-abc/result",
  ];
  for (const p of getPaths) {
    assert.deepEqual(parseVerifyGetPath(p), srvParseGet(p), `get delega igual en ${p}`);
  }
  const jobs: Array<{ status?: unknown } | null | undefined> = [
    null,
    undefined,
    { status: "Triage" },
    { status: "Review" },
    {},
  ];
  for (const j of jobs) {
    assert.deepEqual(checkVerifyRetryGuards(j, "job-x"), srvGuards(j, "job-x"), "guards delegan igual");
  }
});
