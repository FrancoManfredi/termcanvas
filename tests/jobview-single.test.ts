/**
 * FASE 4 E1 — vista única en los 4 estados (jobView + jobs/jobService sobre la
 * tienda única, sin rama legacy). Prepara el borrado futuro de la
 * reconciliación cliente (plan §1: solo cuando el server demuestre vista única
 * en los 4 estados). Offline total: tmp + tienda en memoria, sin daemon, sin
 * red, cero LLM real, sin docker.
 *
 * Los 4 estados:
 * 1. Complete (terminal con evidencia).
 * 2. Review (en revisión, `reviewCount` + `lastReview` presentes).
 * 3. Triage por setup-fail (verificación en fail con meta + `createdFiles`
 *    honesto, evidencia de triage preservada).
 * 4. Sin `result.json` (Building fresco: la vista NO inventa resultado).
 *
 * Reglas: las 8 + C1–C10 (C5 aditivo: quirks de forma intactos — lista con
 * `logsCount`+`logs`, detalle con `logs` sin `logsCount`; C3: este módulo solo
 * lee/proyecta, jamás escribe `result.json`).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { getJobDetail, listJobs } from "../headless-runtime/factory/jobs/jobService.ts";
import { toDetail, toListItem, verificationCreatedFiles } from "../headless-runtime/workItem/jobView.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

function mkTmp(prefix = "f4e1-jv-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * El `result.json` de un job vive en su dir propio (`{worktree}/.agents/
 * factory/{id}/`, no en el worktree raíz). Helper único del estado en disco.
 */
function jobDirOf(worktree: string, id: string): string {
  return path.join(worktree, ".agents", "factory", id);
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort (C4)
  }
}

function mkVerification(overall: "pass" | "fail"): VerificationReport {
  const nowIso = new Date().toISOString();
  return {
    steps: [
      {
        name: "build",
        command: "pnpm build",
        exitCode: overall === "pass" ? 0 : 1,
        durationMs: 5,
        status: overall === "pass" ? "pass" : "fail",
        logSnippet: overall === "pass" ? "ok" : "boom",
        logPath: "logs/build.log",
      },
    ],
    overall,
    startedAt: nowIso,
    finishedAt: nowIso,
    durationMs: 5,
  };
}

const ids: string[] = [];
const dirs: string[] = [];

function track(id: string, dir: string): void {
  ids.push(id);
  dirs.push(dir);
}

function cleanup(): void {
  for (const id of ids.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of dirs.splice(0)) rmTmp(dir);
}

/** 1. Complete: Intake→Foreman→Building→Complete. */
function setupComplete(): string {
  const dir = mkTmp();
  const id = `job-f4e1-jv-complete-${Date.now().toString(36)}`;
  workItemStore.create({ id, prompt: "vista complete", worktree: dir });
  workItemStore.transition(id, "Foreman", "system", "a foreman");
  workItemStore.transition(id, "Building", "foreman", "a building");
  workItemStore.transitionWithVerification(id, "Complete", mkVerification("pass"), []);
  track(id, dir);
  return id;
}

/** 2. Review con veredicto (vía setReview, reviewCount + lastReview). */
function setupReview(): string {
  const dir = mkTmp();
  const id = `job-f4e1-jv-review-${Date.now().toString(36)}`;
  workItemStore.create({ id, prompt: "vista review", worktree: dir });
  workItemStore.transition(id, "Foreman", "system", "a foreman");
  workItemStore.transition(id, "Building", "foreman", "a building");
  workItemStore.transitionWithVerification(id, "Review", mkVerification("pass"), []);
  workItemStore.setReview(
    id,
    {
      verdict: "ask_human",
      summary: "duda menor para humano",
      findings: [],
      reviewAttempt: 1,
      reviewedAt: new Date().toISOString(),
    } as never,
    1,
  );
  track(id, dir);
  return id;
}

/** 3. Triage por setup-fail: Building→Triage con verificación en fail. */
function setupTriageFail(): { id: string; dir: string } {
  const dir = mkTmp();
  const id = `job-f4e1-jv-triage-${Date.now().toString(36)}`;
  workItemStore.create({ id, prompt: "vista triage setup-fail", worktree: dir });
  workItemStore.transition(id, "Foreman", "system", "a foreman");
  workItemStore.transition(id, "Building", "foreman", "a building");
  workItemStore.transitionWithVerification(id, "Triage", mkVerification("fail"), []);
  track(id, dir);
  return { id, dir };
}

/** 4. Sin result.json: Building fresco (se borra el compat si existiera). */
function setupNoResult(): { id: string; dir: string } {
  const dir = mkTmp();
  const id = `job-f4e1-jv-nores-${Date.now().toString(36)}`;
  workItemStore.create({ id, prompt: "vista sin result", worktree: dir });
  workItemStore.transition(id, "Foreman", "system", "a foreman");
  workItemStore.transition(id, "Building", "foreman", "a building");
  try {
    fs.unlinkSync(path.join(jobDirOf(dir, id), "result.json"));
  } catch {
    // si no había, mejor: el estado "sin result.json" ya rige
  }
  track(id, dir);
  return { id, dir };
}

test("F4-E1 vista única: Complete se proyecta igual en lista y detalle", () => {
  const id = setupComplete();
  try {
    const wi = workItemStore.get(id);
    assert.ok(wi, "tienda trae el item");
    const listItem = toListItem(wi as never);
    const detail = toDetail(wi as never);
    for (const view of [listItem, detail]) {
      assert.equal(view.id, id);
      assert.equal(view.status, "Complete");
      assert.equal(view.state, "done");
    }
    assert.equal(typeof listItem.logsCount, "number", "lista con logsCount");
    assert.equal("logsCount" in detail, false, "detalle sin logsCount (quirk)");
    const preview = detail.resultPreview as Record<string, unknown>;
    assert.equal(preview.status, "Complete");
    assert.match(String(preview.summary), /completado/);
    // Vía dominio (tienda sola, sin legacy): misma vista.
    const viaDomain = getJobDetail(id) as Record<string, unknown> | null;
    assert.ok(viaDomain);
    assert.equal(viaDomain.status, "Complete");
    assert.equal((viaDomain.resultPreview as Record<string, unknown>).jobId, id);
  } finally {
    cleanup();
  }
});

test("F4-E1 vista única: Review expone reviewCount + lastReview", () => {
  const id = setupReview();
  try {
    const detail = getJobDetail(id) as Record<string, unknown> | null;
    assert.ok(detail);
    assert.equal(detail.status, "Review");
    assert.equal(detail.state, "running");
    assert.equal(detail.reviewCount, 1);
    assert.equal((detail.lastReview as { verdict?: string })?.verdict, "ask_human");
    const inList = listJobs().find((j) => j.id === id) as Record<string, unknown> | undefined;
    assert.ok(inList, "Review también lista");
    assert.equal(inList.status, "Review");
  } finally {
    cleanup();
  }
});

test("F4-E1 vista única: Triage setup-fail conserva evidencia (fail honesto)", () => {
  const { id, dir } = setupTriageFail();
  try {
    const detail = getJobDetail(id) as Record<string, unknown> | null;
    assert.ok(detail);
    assert.equal(detail.status, "Triage");
    // createdFiles [] honesto (H-012): declarado vacío, nada en disco.
    assert.deepEqual(detail.createdFiles, []);
    assert.deepEqual(verificationCreatedFiles({ createdFiles: (detail as { createdFiles?: unknown }).createdFiles }), []);
    // La verificación en fail vive en la meta del timeline (evidencia triage).
    const timeline = detail.timeline as Array<{ meta?: Record<string, unknown> }>;
    const withVerification = timeline.filter((t) => t.meta?.verification !== undefined);
    assert.ok(withVerification.length > 0, "la meta guarda la verificación en fail");
    assert.equal(
      (withVerification[withVerification.length - 1]?.meta?.verification as { overall?: string })?.overall,
      "fail",
    );
    // El escritor único dejó result.json rico (no lo inventa la vista: lo lee el endpoint /result).
    assert.equal(fs.existsSync(path.join(jobDirOf(dir, id), "result.json")), true);
  } finally {
    cleanup();
  }
});

test("F4-E1 vista única: sin result.json la vista no inventa resultado", () => {
  const { id, dir } = setupNoResult();
  try {
    assert.equal(fs.existsSync(path.join(jobDirOf(dir, id), "result.json")), false);
    const wi = workItemStore.get(id);
    assert.ok(wi);
    assert.deepEqual(verificationCreatedFiles({}), [], "ausente → [] honesto (solo vista verificación)");
    const detail = toDetail(wi as never);
    assert.equal(detail.status, "Building");
    assert.equal(detail.state, "running");
    assert.ok(detail.resultPreview, "el preview estable existe igual (no es el resultado)");
    const listItem = toListItem(wi as never);
    assert.equal(listItem.id, id);
    assert.equal(typeof listItem.logsCount, "number");
  } finally {
    cleanup();
  }
});
