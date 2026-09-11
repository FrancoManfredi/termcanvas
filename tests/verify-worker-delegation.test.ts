/**
 * TANDA 2 — delegación verify-retry worker a verify/verifyService.
 *
 * Contrato de delegación (NO duplica asserts de negocio, solo delegación):
 * - El handler del cascarón responde lo mismo llamando al dominio (1 llamada).
 * - El worker vive en verifyService.runVerifyRetryWorker con reconcile H-013
 *   intacto + nota reconciledLateFiles; dedupe/budget/veredictos intactos.
 * - Cero lógica de retry en el server fuera de la delegación.
 * Todo offline en tmp, sin daemon, sin docker, sin LLM (verificación mockeada
 * por archivos: el worker usa disco + tienda, sin red).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import {
  isVerifyRetryInFlight,
  isVerifyWorkerInFlight,
  requestVerifyRetry,
  resetVerifyRetryForTests,
  resetVerifyWorkerForTests,
  runVerifyRetryWorker,
} from "../headless-runtime/factory/verify/verifyService.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "factoryServer.ts"),
  "utf-8",
);
const DOMAIN_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "verify", "verifyService.ts"),
  "utf-8",
);

function mkTmp(prefix = "t2-verify-"): string {
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
  workItemStore.create({ id, prompt: "hola", worktree: dir });
  createdIds.push(id);
  return dir;
}

function toTriage(id: string): void {
  workItemStore.transition(id, "Foreman", "foreman", "t");
  workItemStore.transition(id, "Triage", "foreman", "t");
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
  try {
    resetVerifyRetryForTests();
  } catch {}
  try {
    resetVerifyWorkerForTests();
  } catch {}
}

// ── A. Delegación estática ──

test("A1 worker mudado: el dominio expone el worker con H-013 y el server lo llama", () => {
  assert.ok(DOMAIN_SRC.includes("export async function runVerifyRetryWorker"), "el dominio expone el worker");
  assert.ok(DOMAIN_SRC.includes("reconciledLateFiles"), "el worker deja la nota tardía");
  assert.ok(DOMAIN_SRC.includes("resolveVerifyRetryCreatedFiles"), "reconcilia contra disco");
  assert.ok(SERVER_SRC.includes("runVerifyRetryWorkerT2("), "el server llama al worker del dominio");
  assert.ok(SERVER_SRC.includes("requestVerifyRetryT2("), "el handler compone con el dominio");
});

test("A2 cero lógica de retry en el server fuera de la delegación", () => {
  const start = SERVER_SRC.indexOf("// ── Ola 9: POST .../verify-retry (TANDA 2");
  const end = SERVER_SRC.indexOf("// ── Ola 9: GET", start);
  assert.ok(start >= 0 && end > start, "bloque verify-retry delimitado");
  const block = SERVER_SRC.slice(start, end);
  for (const token of [
    "resolveVerifyRetryCreatedFiles",
    "verificationService.run",
    "buildResultPayload",
    "transitionWithVerification",
    "reconciledLateFiles",
  ]) {
    assert.equal(block.includes(token), false, `el handler no debe contener ${JSON.stringify(token)} (vive en el dominio)`);
  }
});

test("A3 handler verify-retry ≤15 líneas y 1 llamada al dominio", () => {
  const start = SERVER_SRC.indexOf("// ── Ola 9: POST .../verify-retry (TANDA 2");
  const end = SERVER_SRC.indexOf("// ── Ola 9: GET", start);
  const block = SERVER_SRC.slice(start, end);
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  assert.ok(lines.length <= 16, `handler compacto, son ${lines.length} líneas no vacías`);
  assert.ok(block.includes("parseVerifyRetryPath(pathname)"), "parsea por el dominio");
  assert.ok(block.includes("requestVerifyRetryT2("), "compón guards + dedupe + worker en 1 llamada");
  assert.ok(block.includes("runVerifyWithServerEffectsT2"), "el worker corre con efectos del cascarón");
  assert.ok(block.includes('"Triage"'), "forma 200 intacta");
});

test("A4 builders sin duplicar + variante C ping-only intacta (solo delegación)", () => {
  assert.ok(SERVER_SRC.includes("./intake/mvpBuilders"), "el server delega builders");
  assert.ok(SERVER_SRC.includes("buildMvpChatParts(promptText)"), "la variante C usa el builder (ping-only intacto)");
  assert.ok(SERVER_SRC.includes("const promptText = buildMvpTrackingPing(job.id)"), "el texto nace del ping");
  assert.equal(SERVER_SRC.includes("const promptText = job.prompt"), false, "el crudo no cruza la sesión");
});

// ── B. Contrato de delegación: el dominio responde lo mismo ──

test("B1 request compone guards + dedupe con la MISMA forma {ok:true,id,status} (sin duplicar negocio)", () => {
  const dir = mkJob("job-t2-vw-a");
  try {
    toTriage("job-t2-vw-a");
    const ok = requestVerifyRetry("job-t2-vw-a", { run: () => {}, schedule: (fn) => fn() });
    assert.deepEqual(ok, { ok: true, id: "job-t2-vw-a", status: "Triage" });
    assert.deepEqual(requestVerifyRetry("job-t2-vw-nope", {}), {
      ok: false,
      code: 404,
      error: "job not found: job-t2-vw-nope",
    });
    void dir;
  } finally {
    cleanup();
  }
});

test("B2 worker sin dir deja evento y no lanza (queda en Triage)", async () => {
  const dir = mkJob("job-t2-vw-b");
  try {
    toTriage("job-t2-vw-b");
    const wi = workItemStore.get("job-t2-vw-b");
    assert.ok(wi !== undefined);
    // Simula job sin dir (rara avis, misma rama del cascarón).
    const hacked = { ...wi!, dir: null };
    workItemStore.getMap().set("job-t2-vw-b", hacked as never);
    await assert.doesNotReject(async () => {
      await runVerifyRetryWorker("job-t2-vw-b", {});
    });
    assert.equal(workItemStore.get("job-t2-vw-b")?.status, "Triage");
    assert.equal(isVerifyWorkerInFlight("job-t2-vw-b"), false);
    void dir;
  } finally {
    cleanup();
  }
});

test("B3 worker fuera de Triage no hace nada y libera el vuelo", async () => {
  mkJob("job-t2-vw-c");
  try {
    await runVerifyRetryWorker("job-t2-vw-c", {});
    assert.equal(workItemStore.get("job-t2-vw-c")?.status, "Intake");
    assert.equal(isVerifyWorkerInFlight("job-t2-vw-c"), false);
    assert.equal(isVerifyRetryInFlight("job-t2-vw-c"), false);
  } finally {
    cleanup();
  }
});

test("B4 dedupe uno-en-vuelo intacto (encolado + worker, sin colgados)", async () => {
  mkJob("job-t2-vw-d");
  try {
    toTriage("job-t2-vw-d");
    // Encolado: segundo intento con el mismo id no lanza otro.
    const { scheduleVerifyRetryRun } = await import("../headless-runtime/factory/verify/verifyService.ts");
    let runs = 0;
    const run = () => {
      runs++;
      return new Promise<void>((resolve) => setImmediate(() => resolve()));
    };
    const sync = (fn: () => void) => fn();
    assert.equal(scheduleVerifyRetryRun("job-t2-vw-d", run, sync), true);
    assert.equal(isVerifyRetryInFlight("job-t2-vw-d"), true);
    assert.equal(scheduleVerifyRetryRun("job-t2-vw-d", run, sync), false);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(isVerifyRetryInFlight("job-t2-vw-d"), false);
    assert.ok(runs >= 1);
  } finally {
    cleanup();
  }
});

test("B5 worker nunca lanza ante id roto", async () => {
  await assert.doesNotReject(async () => {
    await runVerifyRetryWorker("", {});
    await runVerifyRetryWorker(null as unknown as string, {});
  });
});
