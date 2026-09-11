/**
 * TANDA 2 — delegación POST /factory/jobs a jobs/jobCreate.
 *
 * Contrato de delegación (NO duplica asserts de negocio, solo delegación):
 * - El handler del cascarón delega (parse → dominio → 201/400) en ≤15 líneas
 *   con formas/respuestas/códigos byte-idénticos (idempotencia + 201 + queued).
 * - La lógica vive en jobs/jobCreate (validación + tienda + 201, nunca lanza).
 * - Cero lógica de create en el server fuera de la delegación.
 * Todo offline en tmp, sin daemon, sin docker, sin LLM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { createJobRequest } from "../headless-runtime/factory/jobs/jobCreate.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "factoryServer.ts"),
  "utf-8",
);
const DOMAIN_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "jobs", "jobCreate.ts"),
  "utf-8",
);

function mkTmp(prefix = "t2-create-"): string {
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

/** issueRef válido canónico para los 201 del contrato (invariante: todo job nace de Resolve Issue). */
const REF = { provider: "github", issueNumber: 7, repo: "FrancoManfredi/termcanvas", url: "https://github.com/FrancoManfredi/termcanvas/issues/7" };

function track(id: string, dir: string): void {
  createdIds.push(id);
  createdDirs.push(dir);
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

function infraFor(dir: string) {
  return {
    resolveDirectory: (w: string) => w,
    getBaseUrl: () => "http://127.0.0.1:4096",
    buildDashboardUrl: (sid?: string, d?: string) =>
      sid ? `http://127.0.0.1:4096/session/${sid}` : "http://127.0.0.1:4096",
    onIdempotentReset: (_id: string) => {},
  };
}

// ── A. Delegación estática: el server no duplica lógica de create ──

test("A1 create delega: el cascarón importa y llama al dominio (1 llamada lógica)", () => {
  assert.ok(SERVER_SRC.includes("./jobs/jobCreate"), "el server importa jobs/jobCreate");
  assert.ok(SERVER_SRC.includes("createJobRequestT2("), "el handler llama al dominio");
  assert.ok(SERVER_SRC.includes("dispatchJobPostCreateT2("), "el post-201 va por helper (no inline)");
  assert.ok(DOMAIN_SRC.includes("workItemStore.create"), "el dominio crea en la tienda única");
});

test("A2 cero lógica de create en el server fuera de la delegación", () => {
  const start = SERVER_SRC.indexOf("// ── CREATE JOB (TANDA 2");
  const end = SERVER_SRC.indexOf("// ── SINGLE JOB:", start);
  assert.ok(start >= 0 && end > start, "bloque create delimitado");
  const block = SERVER_SRC.slice(start, end);
  for (const token of [
    "prompt is required",
    "worktree is required",
    "model not in catalog",
    "gpt-99",
    "reviewerRef ignorado",
    "modelRef ignorado",
    "idRegex",
    "initialLog",
  ]) {
    assert.equal(block.includes(token), false, `el handler no debe contener ${JSON.stringify(token)} (vive en el dominio)`);
  }
});

test("A3 handler create ≤15 líneas (parse → dominio → 201/400)", () => {
  const start = SERVER_SRC.indexOf("// ── CREATE JOB (TANDA 2");
  const end = SERVER_SRC.indexOf("// ── SINGLE JOB:", start);
  const block = SERVER_SRC.slice(start, end);
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  assert.ok(lines.length <= 18, `handler create compacto, son ${lines.length} líneas no vacías (≤15 + 2 de comentarios)`);
  assert.ok(block.includes("await readBody(req)"), "parsea el body");
  assert.ok(block.includes("res.writeHead(outT2.status"), "mapea status del dominio");
  assert.ok(block.includes("JSON.stringify(outT2.body)"), "responde el body del dominio");
});

test("A4 builders sin duplicar: el server no redefine payloads MVP (solo llama)", () => {
  assert.ok(SERVER_SRC.includes("./intake/mvpBuilders"), "el server delega builders en intake/mvpBuilders");
  const buildersDef = (SERVER_SRC.match(/export function buildMvp/g) ?? []).length;
  assert.equal(buildersDef, 0, "el server no define builders (solo re-exporta/llama)");
  assert.ok(SERVER_SRC.includes("const promptText = buildMvpTrackingPing(job.id)"), "el ping nace del dominio");
});

// ── B. Contrato de delegación: el dominio responde lo mismo que el handler ──

test("B1 parseError → 400 body must be valid JSON (forma exacta)", () => {
  const out = createJobRequest({}, "basura{{{", true, infraFor(os.tmpdir()));
  assert.equal(out.status, 400);
  assert.equal((out.body as Record<string, unknown>).error, "body must be valid JSON");
});

test("B2 sin prompt / sin worktree → 400 exactos", () => {
  const dir = mkTmp();
  try {
    const noPrompt = createJobRequest({}, JSON.stringify({ worktree: dir }), false, infraFor(dir));
    assert.equal(noPrompt.status, 400);
    assert.equal((noPrompt.body as Record<string, unknown>).error, "prompt is required");
    const noWorktree = createJobRequest({ prompt: "hola" }, JSON.stringify({ prompt: "hola" }), false, infraFor(dir));
    assert.equal(noWorktree.status, 400);
    assert.equal((noWorktree.body as Record<string, unknown>).error, "worktree is required");
  } finally {
    rmTmp(dir);
  }
});

test("B2b sin issueRef → 400 (invariante: todo job nace de Resolve Issue)", () => {
  const dir = mkTmp();
  try {
    const sinRef = createJobRequest({ prompt: "hola", worktree: dir }, "{}", false, infraFor(dir));
    assert.equal(sinRef.status, 400);
    const body = sinRef.body as Record<string, unknown>;
    assert.match(String(body.error), /issueRef is required/);
    const refBasura = createJobRequest({ prompt: "hola", worktree: dir, issueRef: { provider: "github", issueNumber: -1 } }, "{}", false, infraFor(dir));
    assert.equal(refBasura.status, 400);
    assert.match(String((refBasura.body as Record<string, unknown>).error), /issueRef is required/);
  } finally {
    rmTmp(dir);
  }
});

test("B3 gate F05: gpt-99 → 400 model not in catalog (fail fast, sin crear)", () => {
  const dir = mkTmp();
  track("job-t2-f05-nocrea", dir);
  try {
    const out = createJobRequest(
      { prompt: "hola", worktree: dir, issueRef: REF, modelRef: { providerID: "openai", modelID: "gpt-99" } },
      JSON.stringify({ prompt: "hola" }),
      false,
      infraFor(dir),
    );
    assert.equal(out.status, 400);
    assert.equal((out.body as Record<string, unknown>).error, "model not in catalog");
    assert.deepEqual((out.body as Record<string, unknown>).alternatives, ["gpt-4o", "claude-sonnet-4", "gemini-2.5-pro"]);
  } finally {
    cleanup();
  }
});

test("B4 201 con forma pact (id/path/dashboardUrl/Intake/queued + workItem/job)", () => {
  const dir = mkTmp();
  const id = "job-t2-create-ok01";
  track(id, dir);
  try {
    const out = createJobRequest({ prompt: "hola mundo", worktree: dir, issueRef: REF }, JSON.stringify({ prompt: "hola" }), false, infraFor(dir));
    assert.equal(out.status, 201);
    const body = out.body as Record<string, unknown>;
    assert.equal(typeof body.id, "string");
    assert.equal(body.status, "Intake");
    assert.equal(typeof body.path, "string");
    assert.equal(typeof body.dashboardUrl, "string");
    assert.ok(Array.isArray(body.timeline));
    assert.ok(body.cost !== null && typeof body.cost === "object");
    assert.equal(body.runnerId, "linux-build");
    const wi = body.workItem as Record<string, unknown>;
    assert.equal(wi.status, "Intake");
    assert.equal(wi.state, "queued");
    const job = body.job as Record<string, unknown>;
    assert.equal(job.status, "Intake");
    assert.equal(job.state, "queued");
    assert.ok(out.job !== undefined, "el dominio devuelve el job para el dispatch");
  } finally {
    cleanup();
  }
});

test("B5 idempotencia pact F03: mismo id determinista recrea sin lanzar", () => {
  const dir = mkTmp();
  const id = "job-t2-create-idem01";
  track(id, dir);
  try {
    let resets = 0;
    const infra = { ...infraFor(dir), onIdempotentReset: (_rid: string) => { resets++; } };
    const first = createJobRequest({ prompt: "uno", worktree: dir, id, issueRef: REF }, "{}", false, infra);
    assert.equal(first.status, 201);
    const second = createJobRequest({ prompt: "dos", worktree: dir, id, issueRef: REF }, "{}", false, infra);
    assert.equal(second.status, 201);
    assert.equal((second.body as Record<string, unknown>).id, id);
    assert.equal(resets, 1);
    const stored = workItemStore.get(id);
    assert.ok(stored !== undefined);
    assert.equal(stored?.prompt, "dos");
  } finally {
    cleanup();
  }
});

test("B6 best-effort: nunca lanza ante entradas rotas", () => {
  const dir = mkTmp();
  try {
    for (const bad of [null, undefined, 42, "texto", []] as unknown[]) {
      assert.doesNotThrow(() => {
        const out = createJobRequest(bad, "", false, infraFor(dir));
        assert.ok(out.status === 400 || out.status === 500 || out.status === 201);
      });
    }
  } finally {
    rmTmp(dir);
  }
});
