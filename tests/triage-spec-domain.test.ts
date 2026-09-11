/**
 * FASE 2 E2 — dominio triageSpec: respond, approve y extras para la vista.
 *
 * Congela parseo exacto (fábrica + alias, rechazos), guards 404/409,
 * validación del cuerpo {answers}, transiciones Triage→Foreman con traza
 * (sin estados nuevos), cálculo de extras para la vista y paridad contra
 * los exports delegados del cascarón. Todo offline en tmp, sin daemon,
 * sin docker, sin LLM. Sin mocks: tienda real con ids únicos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { buildFallbackTriageFindings } from "../shared/types/triage.ts";
import { buildSpecApprovalMeta, validateSpecBrief } from "../shared/types/spec.ts";
import {
  parseTriageRespondPath,
} from "../headless-runtime/factory/triageSpec/triageSpecRoutes.ts";
import { parseSpecApprovePath } from "../headless-runtime/factory/triageSpec/triageSpecRoutes.ts";
import { parseSpecRejectPath } from "../headless-runtime/factory/triageSpec/triageSpecRoutes.ts";
import {
  applySpecApproveTransition,
  applySpecRejectTransition,
  applyTriageRespondTransition,
  checkSpecApproveGuards,
  checkSpecRejectGuards,
  checkTriageRespondGuards,
  parseSpecRejectBody,
  parseTriageRespondBody,
  triageSpecExtras,
} from "../headless-runtime/factory/triageSpec/triageSpecService.ts";
import {
  applyTriageRespondTransition as srvApply,
  checkTriageRespondGuards as srvGuards,
  parseTriageRespondBody as srvBody,
  parseTriageRespondPath as srvParse,
} from "../headless-runtime/factory/factoryServer.ts";

function mkTmp(prefix = "f2e2-ts-"): string {
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

/** Lleva un job a Triage con pedido de aprobación de spec pendiente. */
function toTriageWithApproval(id: string, summary = "resumen spec de prueba"): void {
  workItemStore.transition(id, "Foreman", "system", "f2e2 → Foreman");
  workItemStore.transition(id, "Triage", "system", "spec no-trivial → Triage", {
    ...buildSpecApprovalMeta(summary),
  } as unknown as Record<string, unknown>);
}

/** Lleva un job a Triage simple (sin pedido de spec). */
function toTriagePlain(id: string): void {
  workItemStore.transition(id, "Foreman", "system", "f2e2 → Foreman");
  workItemStore.transition(id, "Triage", "foreman", "f2e2 triaged");
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

function mkBrief() {
  return validateSpecBrief({
    summary: "brief de prueba",
    acceptanceCriteria: ["criterio uno"],
    targetFiles: ["src/a.ts"],
    trivial: false,
    openQuestions: ["¿pregunta?"],
  });
}

// ── Rutas ──

test("F2-E2 triage-spec: respond parsea dual y rechaza ajenas/traversal", () => {
  assert.deepEqual(parseTriageRespondPath("/factory/jobs/job-f2e2-a/triage/respond"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseTriageRespondPath("/work-items/job-f2e2-a/triage/respond"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: true,
  });
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/job-f2e2-a/review/accept"));
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/triage/respond"));
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/../triage/respond"));
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/a/extra/triage/respond"));
  assert.ok("error" in parseTriageRespondPath("/factory/jobs/triage/triage/respond"));
  assert.ok("error" in parseTriageRespondPath(123));
});

test("F2-E2 triage-spec: approve parsea dual (implementación única de specFlow)", () => {
  assert.deepEqual(parseSpecApprovePath("/factory/jobs/job-f2e2-a/spec/approve"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseSpecApprovePath("/work-items/job-f2e2-a/spec/approve"), {
    id: "job-f2e2-a",
    isWorkItemsAlias: true,
  });
  assert.ok("error" in parseSpecApprovePath("/factory/jobs/job-f2e2-a/spec/approve/extra"));
  assert.ok("error" in parseSpecApprovePath("/factory/jobs/../x/spec/approve"));
});

// ── Guards y cuerpo ──

test("F2-E2 triage-spec: respond guards 404 sin job / 409 fuera de Triage", () => {
  const g404 = checkTriageRespondGuards(null, "job-f2e2-x");
  assert.equal(g404.ok, false);
  if (!g404.ok) assert.equal(g404.code, 404);
  assert.deepEqual(checkTriageRespondGuards({ status: "Triage" }, "job-f2e2-x"), { ok: true });
  for (const status of ["Intake", "Foreman", "Building", "Review", "Complete", "Cancelled", undefined, 42]) {
    const g = checkTriageRespondGuards({ status }, "job-f2e2-x");
    assert.equal(g.ok, false, `status=${String(status)} debería ser 409`);
    if (!g.ok) assert.equal(g.code, 409);
  }
});

test("F2-E2 triage-spec: respond body acepta útiles y topa en 10, 400 resto", () => {
  assert.deepEqual(parseTriageRespondBody({ answers: [" área X ", "", "criterio Y"] }), {
    ok: true,
    answers: ["área X", "criterio Y"],
  });
  const big = parseTriageRespondBody({
    answers: Array.from({ length: 15 }, (_, i) => `respuesta ${i}`),
  });
  assert.equal(big.ok, true);
  if (big.ok) assert.equal(big.answers.length, 10);
  for (const bad of [{}, { answers: [] }, { answers: ["   "] }, { answers: "x" }, { answers: [42] }, null, "s"]) {
    const r = parseTriageRespondBody(bad);
    assert.equal(r.ok, false, `body=${JSON.stringify(bad)} debería ser 400`);
    if (!r.ok) assert.match(r.error, /answers must be/);
  }
});

test("F2-E2 triage-spec: approve guards 404/409/ok con pedido pendiente", () => {
  mkJob("job-f2e2-appr-a");
  mkJob("job-f2e2-appr-b");
  try {
    assert.deepEqual(checkSpecApproveGuards(null, "job-f2e2-x"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e2-x",
    });
    assert.deepEqual(
      checkSpecApproveGuards({ status: "Building", timeline: [] }, "job-f2e2-x").ok,
      false,
    );
    toTriagePlain("job-f2e2-appr-a");
    const noPending = checkSpecApproveGuards(workItemStore.get("job-f2e2-appr-a"), "job-f2e2-appr-a");
    assert.equal(noPending.ok, false);
    if (!noPending.ok) assert.equal(noPending.code, 409);
    toTriageWithApproval("job-f2e2-appr-b", "resumen pendiente");
    const ok = checkSpecApproveGuards(workItemStore.get("job-f2e2-appr-b"), "job-f2e2-appr-b");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.specSummary, "resumen pendiente");
  } finally {
    cleanup();
  }
});

// ── Transiciones (sin estados nuevos) ──

test("F2-E2 triage-spec: respond Triage→Foreman con respuestas trazadas", () => {
  mkJob("job-f2e2-resp-a");
  try {
    toTriagePlain("job-f2e2-resp-a");
    const moved = applyTriageRespondTransition("job-f2e2-resp-a", ["área: docs", "criterio: claro"]);
    assert.equal(moved.status, "Foreman");
    const last = moved.timeline[moved.timeline.length - 1];
    assert.equal(last.from, "Triage");
    assert.equal(last.to, "Foreman");
    const prev = moved.timeline[moved.timeline.length - 2];
    assert.match(prev.message, /triage respond \(2 respuestas\)/);
    assert.match(prev.message, /área: docs/);
  } finally {
    cleanup();
  }
});

test("F2-E2 triage-spec: respond 404 ante desconocido, terminal quieto ante fallo", () => {
  mkJob("job-f2e2-resp-b");
  try {
    assert.throws(
      () => applyTriageRespondTransition("job-f2e2-no-existe", ["algo"]),
      (e: unknown) => (e as { status?: number }).status === 404,
    );
    // Las guards 409 viven en el handler; la transición cruda desde un
    // estado terminal falla en la tienda y el status queda quieto.
    workItemStore.transition("job-f2e2-resp-b", "Foreman", "system", "f2e2 → Foreman");
    workItemStore.transition("job-f2e2-resp-b", "Building", "foreman", "f2e2 → Building");
    workItemStore.transition("job-f2e2-resp-b", "Complete", "runner", "f2e2 → Complete");
    assert.throws(
      () => applyTriageRespondTransition("job-f2e2-resp-b", ["algo"]),
      (e: unknown) => (e as { status?: number }).status === 409,
    );
    assert.equal(workItemStore.get("job-f2e2-resp-b")?.status, "Complete");
  } finally {
    cleanup();
  }
});

test("F2-E2 triage-spec: approve Triage→Foreman con resumen trazado", () => {
  mkJob("job-f2e2-appr-c");
  try {
    toTriageWithApproval("job-f2e2-appr-c", "resumen trazado abc");
    const moved = applySpecApproveTransition("job-f2e2-appr-c");
    assert.equal(moved.status, "Foreman");
    const last = moved.timeline[moved.timeline.length - 1];
    assert.equal(last.from, "Triage");
    assert.equal(last.to, "Foreman");
    const prev = moved.timeline[moved.timeline.length - 2];
    assert.match(prev.message, /spec aprobada por humano/);
    assert.match(prev.message, /resumen trazado abc/);
  } finally {
    cleanup();
  }
});

test("F2-E2 triage-spec: approve ante fallo deja Triage quieto (sin transición parcial)", () => {
  mkJob("job-f2e2-appr-d");
  mkJob("job-f2e2-appr-e");
  try {
    assert.throws(
      () => applySpecApproveTransition("job-f2e2-no-existe"),
      (e: unknown) => (e as { status?: number }).status === 404,
    );
    toTriagePlain("job-f2e2-appr-d");
    assert.throws(() => applySpecApproveTransition("job-f2e2-appr-d"));
    assert.equal(workItemStore.get("job-f2e2-appr-d")?.status, "Triage");
    assert.throws(() => applySpecApproveTransition("job-f2e2-appr-e"));
    assert.equal(workItemStore.get("job-f2e2-appr-e")?.status, "Intake");
  } finally {
    cleanup();
  }
});

test("F2-E2 triage-spec: reject parsea dual y valida body feedback", () => {
  assert.deepEqual(parseSpecRejectPath("/factory/jobs/job-f2e2-r/spec/reject"), {
    id: "job-f2e2-r",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseSpecRejectPath("/work-items/job-f2e2-r/spec/reject"), {
    id: "job-f2e2-r",
    isWorkItemsAlias: true,
  });
  assert.ok("error" in parseSpecRejectPath("/factory/jobs/job-f2e2-r/spec/approve"));
  assert.deepEqual(parseSpecRejectBody(null), { ok: true, feedback: null });
  assert.deepEqual(parseSpecRejectBody({}), { ok: true, feedback: null });
  assert.deepEqual(parseSpecRejectBody({ feedback: "  falta el criterio de Windows  " }), {
    ok: true,
    feedback: "falta el criterio de Windows",
  });
  assert.deepEqual(parseSpecRejectBody({ feedback: "   " }), { ok: true, feedback: null });
  assert.equal(parseSpecRejectBody({ feedback: 42 }).ok, false);
  assert.equal(parseSpecRejectBody("texto").ok, false);
});

test("F2-E2 triage-spec: reject guards 404/409/ok espejo de approve", () => {
  mkJob("job-f2e2-rej-a");
  mkJob("job-f2e2-rej-b");
  try {
    assert.deepEqual(checkSpecRejectGuards(null, "job-f2e2-x"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e2-x",
    });
    toTriagePlain("job-f2e2-rej-a");
    const noPending = checkSpecRejectGuards(workItemStore.get("job-f2e2-rej-a"), "job-f2e2-rej-a");
    assert.equal(noPending.ok, false);
    if (!noPending.ok) assert.equal(noPending.code, 409);
    toTriageWithApproval("job-f2e2-rej-b", "resumen pendiente");
    const ok = checkSpecRejectGuards(workItemStore.get("job-f2e2-rej-b"), "job-f2e2-rej-b");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.specSummary, "resumen pendiente");
  } finally {
    cleanup();
  }
});

test("F2-E2 triage-spec: reject queda en Triage e invalida el pedido (anti-loop)", () => {
  mkJob("job-f2e2-rej-c");
  try {
    toTriageWithApproval("job-f2e2-rej-c", "brief flojo");
    const before = workItemStore.get("job-f2e2-rej-c");
    assert.equal(before?.status, "Triage");
    applySpecRejectTransition("job-f2e2-rej-c", "falta criterio de Windows");
    const after = workItemStore.get("job-f2e2-rej-c");
    assert.equal(after?.status, "Triage");
    const tl = after?.timeline ?? [];
    const last = tl[tl.length - 1];
    assert.match(String(last.message ?? ""), /spec rechazada por humano/);
    assert.match(String(last.message ?? ""), /falta criterio de Windows/);
    const meta = (last.meta ?? {}) as Record<string, unknown>;
    assert.equal(meta.specRejected, true);
    assert.equal(meta.specRejectFeedback, "falta criterio de Windows");
    // El pedido viejo murió: ni guards ni extras lo ven pendiente.
    assert.equal(checkSpecRejectGuards(after, "job-f2e2-rej-c").ok, false);
    assert.equal(checkSpecApproveGuards(after, "job-f2e2-rej-c").ok, false);
    assert.equal(
      (triageSpecExtras(after?.timeline ?? [], after?.status) as Record<string, unknown>).specApprovalPending,
      undefined,
    );
  } finally {
    cleanup();
  }
});

// ── Extras para la vista ──

test("F2-E2 triage-spec: extras vacíos sin meta, triage+spec desde timeline", () => {
  assert.deepEqual(triageSpecExtras([], "Intake"), {});
  assert.deepEqual(triageSpecExtras(null, "Triage"), {});
  const now = new Date().toISOString();
  const timeline = [
    {
      id: "t0",
      from: "Intake",
      to: "Intake",
      at: now,
      actor: "system",
      message: "created",
    },
    {
      id: "t1",
      from: "Foreman",
      to: "Foreman",
      at: now,
      actor: "system",
      message: "triage",
      meta: { triage: buildFallbackTriageFindings() },
    },
    {
      id: "t2",
      from: "Foreman",
      to: "Foreman",
      at: now,
      actor: "system",
      message: "spec",
      meta: { spec: mkBrief() },
    },
  ];
  const out = triageSpecExtras(timeline, "Foreman");
  assert.deepEqual((out.triage as { decision?: unknown }).decision, "building");
  assert.deepEqual((out.spec as { summary?: unknown }).summary, "brief de prueba");
  assert.equal("specApprovalPending" in out, false);
});

test("F2-E2 triage-spec: extras marcan specApprovalPending solo en Triage con pedido", () => {
  const now = new Date().toISOString();
  const entry = {
    id: "t1",
    from: "Foreman",
    to: "Triage",
    at: now,
    actor: "system",
    message: "gate",
    meta: { ...buildSpecApprovalMeta("pendiente xyz"), spec: mkBrief() },
  };
  const pending = triageSpecExtras([entry], "Triage");
  assert.equal(pending.specApprovalPending, true);
  const elsewhere = triageSpecExtras([entry], "Foreman");
  assert.equal("specApprovalPending" in elsewhere, false);
});

// ── Paridad con el cascarón (exports delegados, contrato vecina) ──

test("F2-E2 triage-spec: paridad total contra los exports delegados del server", () => {
  assert.deepEqual(srvParse("/factory/jobs/job-f2e2-a/triage/respond"), parseTriageRespondPath("/factory/jobs/job-f2e2-a/triage/respond"));
  assert.deepEqual(srvParse("/work-items/job-f2e2-a/triage/respond"), parseTriageRespondPath("/work-items/job-f2e2-a/triage/respond"));
  assert.deepEqual(srvGuards(null, "job-f2e2-x"), checkTriageRespondGuards(null, "job-f2e2-x"));
  assert.deepEqual(srvGuards({ status: "Triage" }, "job-f2e2-x"), checkTriageRespondGuards({ status: "Triage" }, "job-f2e2-x"));
  assert.deepEqual(srvGuards({ status: "Building" }, "job-f2e2-x"), checkTriageRespondGuards({ status: "Building" }, "job-f2e2-x"));
  assert.deepEqual(srvBody({ answers: [" a ", ""] }), parseTriageRespondBody({ answers: [" a ", ""] }));
  assert.deepEqual(srvBody({ answers: [] }), parseTriageRespondBody({ answers: [] }));
  mkJob("job-f2e2-par-a");
  try {
    toTriagePlain("job-f2e2-par-a");
    const viaServer = srvApply("job-f2e2-par-a", ["zona norte"]);
    assert.equal(viaServer.status, "Foreman");
  } finally {
    cleanup();
  }
});

test("extras: terminales devuelven {} sin escanear (perf lista 2.5s)", () => {
  const timeline = [
    {
      id: "t",
      from: "Foreman",
      to: "Foreman",
      at: new Date().toISOString(),
      actor: "system",
      message: "triage",
      meta: { triage: buildFallbackTriageFindings() },
    },
  ];
  // Complete/Cancelled no tienen lectores de extras (gates exigen activo,
  // UIs leen la meta directo): se ahorra el reverse-scan por item.
  assert.deepEqual(triageSpecExtras(timeline, "Complete"), {});
  assert.deepEqual(triageSpecExtras(timeline, "Cancelled"), {});
  // No-terminales intactos (incluido junk, que degrada a {} honesto).
  const triage = triageSpecExtras(timeline, "Foreman") as Record<string, unknown>;
  assert.ok("triage" in triage, "no-terminal conserva sus extras");
  assert.deepEqual(triageSpecExtras(null, "Triage"), {});
});
