/**
 * workitem-memory-cap — Ola C1 (retención: que nunca más se acumulen 446).
 *
 * Sin tope, el daemon acumula todos los jobs desde el primer arranque en
 * memoria y cada lista los recorre/serializa (6 MB por tick medidos
 * 2026-09-09 con 444 jobs). Fix en `headless-runtime/workItem/`:
 * - `pruneTerminalFromMemory(maxKeep)` — evicta de MEMORIA los terminales
 *   (Complete/Cancelled) más viejos por encima del tope (default 200).
 *   Solo-memoria: el job.json queda en disco.
 * - `get()` con fallback a disco (`resolveJobDir` + `readWorkItemFromDir`)
 *   y rehidratación: el detalle de jobs viejos sigue 200 honesto, y los
 *   guards 409 (cancel de un terminal) ven el item igual que antes.
 * - Hooks: al aterrizar en terminal y tras `restoreFromDisk()`.
 * Nunca toca no-terminales. Sandbox (TERMCANVAS_FACTORY_DIR en tmp).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WORK_ITEM_MEMORY_TERMINAL_CAP,
  workItemStore,
} from "../headless-runtime/workItem/workItemStore.ts";

const PREV_FACTORY_DIR = process.env.TERMCANVAS_FACTORY_DIR;
const SANDBOX_FACTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "c1-cap-"));
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY_DIR;
test.after(() => {
  try {
    if (PREV_FACTORY_DIR === undefined) delete process.env.TERMCANVAS_FACTORY_DIR;
    else process.env.TERMCANVAS_FACTORY_DIR = PREV_FACTORY_DIR;
  } catch {
    // best-effort
  }
  try {
    fs.rmSync(SANDBOX_FACTORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "c1-job-"));
}

const tmpDirs: string[] = [];
const createdIds: string[] = [];

function mkJob(id: string): void {
  const dir = mkTmp();
  tmpDirs.push(dir);
  workItemStore.create({ id, prompt: `prompt ${id}`, worktree: dir });
  createdIds.push(id);
}

function toComplete(id: string): void {
  workItemStore.transition(id, "Foreman", "system", "t");
  workItemStore.transition(id, "Building", "foreman", "t");
  workItemStore.transition(id, "Complete", "runner", "t");
}

function cleanup(): void {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // noop
    }
  }
}

test("prune evicts oldest terminal beyond cap, never live jobs", () => {
  mkJob("job-c1-old");
  mkJob("job-c1-mid");
  mkJob("job-c1-new");
  mkJob("job-c1-live");
  try {
    toComplete("job-c1-old");
    toComplete("job-c1-mid");
    toComplete("job-c1-new");
    const evicted = workItemStore.pruneTerminalFromMemory(2);
    assert.equal(evicted, 1);
    // `has`/`list` son solo-memoria (`get` rehidrataría desde disco).
    assert.equal(workItemStore.has("job-c1-old"), false);
    const ids = workItemStore.list().map((j) => j.id);
    assert.ok(!ids.includes("job-c1-old"));
    assert.ok(ids.includes("job-c1-mid"));
    assert.ok(ids.includes("job-c1-new"));
    assert.ok(ids.includes("job-c1-live"));
    assert.equal(workItemStore.get("job-c1-live")?.status, "Intake");
  } finally {
    cleanup();
  }
});

test("get rehydrates evicted jobs from disk", () => {
  mkJob("job-c1-rehy");
  try {
    toComplete("job-c1-rehy");
    // Evicción real (solo memoria, índice intacto) — no `delete`, que es
    // borrado explícito y corta la rehidratación por diseño.
    assert.equal(workItemStore.pruneTerminalFromMemory(0), 1);
    assert.equal(workItemStore.has("job-c1-rehy"), false);
    const back = workItemStore.get("job-c1-rehy");
    assert.ok(back, "rehidratado desde job.json");
    assert.equal(back?.id, "job-c1-rehy");
    assert.equal(back?.status, "Complete");
    assert.equal(workItemStore.has("job-c1-rehy"), true);
  } finally {
    cleanup();
  }
});

test("delete es solo-memoria: get() rehidrata (documenta semántica C1)", () => {
  mkJob("job-c1-del");
  try {
    assert.equal(workItemStore.delete("job-c1-del"), true);
    assert.equal(workItemStore.has("job-c1-del"), false);
    // A diferencia de la poda (que también rehidrata), el borrado
    // explícito no corta el índice: `get()` trae desde job.json.
    assert.equal(workItemStore.get("job-c1-del")?.id, "job-c1-del");
  } finally {
    cleanup();
  }
});

test("get unknown is honest-undefined, junk never throws", () => {
  assert.equal(workItemStore.get("job-c1-missing"), undefined);
  assert.equal(
    workItemStore.get(null as unknown as string),
    undefined,
  );
  assert.equal(workItemStore.pruneTerminalFromMemory(-1), 0);
  assert.equal(workItemStore.pruneTerminalFromMemory(Number.NaN), 0);
});

test("default cap is sane", () => {
  assert.ok(
    Number.isInteger(WORK_ITEM_MEMORY_TERMINAL_CAP) &&
      WORK_ITEM_MEMORY_TERMINAL_CAP >= 50,
  );
});
