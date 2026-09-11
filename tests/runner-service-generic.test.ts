/**
 * runner-service-generic (FASE 1 E2 — fin de la trampa `linux-build`).
 *
 * `RunnerService.loadSpec/loadSpecSync` delegan en el loader genérico
 * `agentLoader.getRunner(id)` (ya existe y valida con zod4):
 * - Runner nuevo aceptado por el loader (`windows-local`, antes 404 por la
 *   allowlist) es aceptado por el service (sync + async + resolveForWorkItem).
 * - `linux-build` intacto: id + setupCommands no vacío + valida como RunnerSpec.
 * - Id desconocido (`no-existe-xyz`, traversal) → 404 como hoy (sync + async).
 * - Yaml ausente en nombre conocido → degradación honesta al fallback
 *   (documentada: isolation `none`, spec válido, con warn).
 * - ESM: cero `require()`.
 *
 * Offline total: filesystem real (yamls del repo) + loader con cache.
 * Cero docker, cero red, cero LLM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRunner,
  resetRunnersCache,
} from "../headless-runtime/factory/agentLoader.ts";
import { validateRunnerSpec } from "../headless-runtime/runner/runnerConfig.ts";
import { RunnerService } from "../headless-runtime/runner/runnerService.ts";
import type { WorkItem } from "../shared/types/workItem.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function statusOf(e: unknown): number | undefined {
  return (e as { status?: number } | null)?.status;
}

function fakeWorkItem(runnerId?: string): WorkItem {
  return { runnerId } as unknown as WorkItem;
}

test.beforeEach(() => {
  resetRunnersCache();
});

test.afterEach(() => {
  resetRunnersCache();
});

test("precondición: el loader acepta windows-local (yaml real del repo)", () => {
  const def = getRunner("windows-local");
  assert.ok(def, "windows-local debe resolver por loader");
  assert.equal(def?.isolation, "none");
});

test("runner nuevo aceptado por loader es aceptado por el service (sync)", () => {
  const svc = new RunnerService();
  const spec = svc.loadSpecSync("windows-local");
  assert.equal(spec.id, "windows-local");
  assert.ok(Array.isArray(spec.setupCommands) && spec.setupCommands.length > 0);
  assert.doesNotThrow(() => validateRunnerSpec(spec));
});

test("runner nuevo aceptado por loader es aceptado por el service (async + resolveForWorkItem)", async () => {
  const svc = new RunnerService();
  const spec = await svc.loadSpec("windows-local");
  assert.equal(spec.id, "windows-local");
  const viaWorkItem = await svc.resolveForWorkItem(fakeWorkItem("windows-local"));
  assert.equal(viaWorkItem.id, "windows-local");
  assert.equal(svc.resolveForWorkItemSync(fakeWorkItem("windows-local")).id, "windows-local");
});

test("linux-build intacto: id + setup + spec válido (sync + async + default)", async () => {
  const svc = new RunnerService();
  const syncSpec = svc.loadSpecSync("linux-build");
  assert.equal(syncSpec.id, "linux-build");
  assert.ok(syncSpec.setupCommands.length > 0, "setupCommands no vacío");
  assert.doesNotThrow(() => validateRunnerSpec(syncSpec));
  const asyncSpec = await svc.loadSpec("linux-build");
  assert.equal(asyncSpec.id, "linux-build");
  // Default sin runnerId sigue siendo linux-build (comportamiento intacto).
  assert.equal(svc.resolveForWorkItemSync(fakeWorkItem()).id, "linux-build");
  assert.equal((await svc.resolveForWorkItem(fakeWorkItem())).id, "linux-build");
});

test("id desconocido → 404 como hoy (sync lanza, async rechaza, traversal incluido)", async () => {
  const svc = new RunnerService();
  assert.throws(() => svc.loadSpecSync("no-existe-xyz"), (e: unknown) => statusOf(e) === 404);
  assert.throws(() => svc.loadSpecSync("../escape"), (e: unknown) => statusOf(e) === 404);
  await assert.rejects(svc.loadSpec("no-existe-xyz"), (e: unknown) => statusOf(e) === 404);
  await assert.rejects(svc.loadSpec(""), (e: unknown) => statusOf(e) === 404);
});

test("ESM: cero require() en runnerService", () => {
  const src = fs.readFileSync(
    path.join(REPO, "headless-runtime", "runner", "runnerService.ts"),
    "utf-8",
  );
  assert.equal(/\brequire\s*\(\s*["'`]/.test(src), false, "cero require()");
  assert.ok(src.includes("getRunner"), "delega en el loader genérico");
  assert.equal(src.includes('id !== "linux-build"'), false, "sin allowlist hardcodeada");
});
