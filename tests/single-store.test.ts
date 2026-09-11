/**
 * TANDA 1 — tienda única sin Map dual (cierre anti-God, `writeJobJson` +
 * Map `jobs` extirpados del server).
 *
 * Fija el contrato de la tienda única post-entierro:
 * 1. escribe→lee→restaura→proyecta sin Map (solo `workItemStore` + `jobView`
 *    vía `jobs/jobService`, sin alimento legacy).
 * 2. `.done` solo en pass (Complete con verificación pass lo crea; Triage
 *    con fail no lo crea; semántica intacta, hay test que la fija).
 * 3. poda del pobre (`resultStore.pruneIfPoor`: rico con `verification` se
 *    conserva, pobre se borra, ausente intacto).
 *
 * Offline total (tmp + tienda en memoria, sin daemon, sin red, cero LLM
 * real, sin docker). Reglas: las 8 + C1–C10 (C1 ESM/cotas sin loops escritos
 * a mano salvo `for...of` acotado sobre colecciones finitas; C2 fail-safe con
 * cleanup best-effort; C5 aditivo: formas intactas).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { getJobDetail, listJobs } from "../headless-runtime/factory/jobs/jobService.ts";
import { pruneIfPoor, readResult } from "../headless-runtime/workItem/resultStore.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

function mkWorktree(prefix = "factory-lab-t1-"): string {
  // Prefijo `factory-lab-*`: el restore del store escanea `os.tmpdir()` por
  // ese prefijo (ver `scanAndRestoreBases`), así el ciclo restaura de verdad.
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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

function dropFromMemory(id: string): void {
  try {
    workItemStore.delete(id);
  } catch {
    // noop
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

test("T1 tienda única: escribe→lee sin Map (job.json en disco + memoria)", () => {
  const worktree = mkWorktree();
  const id = `job-t1-store-${Date.now().toString(36)}`;
  workItemStore.create({ id, prompt: "tienda única escribe lee", worktree });
  try {
    const mem = workItemStore.get(id);
    assert.ok(mem, "la memoria trae el item");
    assert.equal(mem.prompt, "tienda única escribe lee");
    assert.equal(mem.status, "Intake");
    assert.equal(fs.existsSync(path.join(jobDirOf(worktree, id), "job.json")), true);
    const raw = JSON.parse(fs.readFileSync(path.join(jobDirOf(worktree, id), "job.json"), "utf-8")) as Record<string, unknown>;
    assert.equal(raw.id, id);
    assert.equal(raw.status, "Intake");
  } finally {
    dropFromMemory(id);
    rmTmp(worktree);
  }
});

test("T1 tienda única: restaura→proyecta sin Map (disco→memoria→vista)", () => {
  const worktree = mkWorktree();
  const id = `job-t1-restore-${Date.now().toString(36)}`;
  workItemStore.create({ id, prompt: "restaura y proyecta", worktree });
  workItemStore.transition(id, "Foreman", "system", "a foreman");
  try {
    // Suelta solo la memoria (el disco queda): `has()` (vista memoria)
    // pierde el item; `get()` rehidrataría bajo demanda (C1), así que la
    // ausencia post-drop se fija con `has()` y el restore la trae de vuelta.
    dropFromMemory(id);
    assert.equal(workItemStore.has(id), false);
    const n = workItemStore.restoreFromDisk();
    assert.ok(n >= 1, "el restore encuentra al menos el item");
    const back = workItemStore.get(id);
    assert.ok(back, "el item vuelve solo desde disco");
    assert.equal(back.status, "Foreman");
    // Proyección única sin alimento legacy: lista + detalle con forma intacta.
    const inList = listJobs().find((j) => j.id === id) as Record<string, unknown> | undefined;
    assert.ok(inList, "la lista sirve el item restaurado sin legacy");
    assert.equal(inList.status, "Foreman");
    assert.equal(typeof inList.logsCount, "number");
    const detail = getJobDetail(id) as Record<string, unknown> | null;
    assert.ok(detail, "el detalle sirve el item restaurado sin legacy");
    assert.equal(detail.id, id);
    assert.equal(detail.status, "Foreman");
    assert.equal("logsCount" in detail, false, "quirk compat intacto");
  } finally {
    dropFromMemory(id);
    rmTmp(worktree);
  }
});

test("T1 tienda única: .done solo en pass (Complete lo crea, Triage-fail no)", () => {
  const worktreePass = mkWorktree("factory-lab-t1-pass-");
  const idPass = `job-t1-done-pass-${Date.now().toString(36)}`;
  const worktreeFail = mkWorktree("factory-lab-t1-fail-");
  const idFail = `job-t1-done-fail-${Date.now().toString(36)}x`;
  workItemStore.create({ id: idPass, prompt: "done en pass", worktree: worktreePass });
  workItemStore.create({ id: idFail, prompt: "sin done en fail", worktree: worktreeFail });
  try {
    workItemStore.transition(idPass, "Foreman", "system", "a foreman");
    workItemStore.transition(idPass, "Building", "foreman", "a building");
    workItemStore.transitionWithVerification(idPass, "Complete", mkVerification("pass"), []);
    assert.equal(fs.existsSync(path.join(jobDirOf(worktreePass, idPass), ".done")), true, "pass→Complete crea .done");
    assert.ok(readResult(jobDirOf(worktreePass, idPass)), "pass deja result.json rico");

    workItemStore.transition(idFail, "Foreman", "system", "a foreman");
    workItemStore.transition(idFail, "Building", "foreman", "a building");
    workItemStore.transitionWithVerification(idFail, "Triage", mkVerification("fail"), []);
    assert.equal(fs.existsSync(path.join(jobDirOf(worktreeFail, idFail), ".done")), false, "fail→Triage NO crea .done");
    assert.ok(readResult(jobDirOf(worktreeFail, idFail)), "fail deja result.json rico (evidencia triage)");
  } finally {
    dropFromMemory(idPass);
    dropFromMemory(idFail);
    rmTmp(worktreePass);
    rmTmp(worktreeFail);
  }
});

test("T1 tienda única: poda del pobre (rico se conserva, pobre se borra)", () => {
  const dirRich = fs.mkdtempSync(path.join(os.tmpdir(), "t1-rich-"));
  const dirPoor = fs.mkdtempSync(path.join(os.tmpdir(), "t1-poor-"));
  const dirAbsent = fs.mkdtempSync(path.join(os.tmpdir(), "t1-absent-"));
  try {
    fs.writeFileSync(
      path.join(dirRich, "result.json"),
      JSON.stringify({ status: "fail", verification: mkVerification("fail") }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(dirPoor, "result.json"),
      JSON.stringify({ jobId: "job-x", status: "Complete" }),
      "utf-8",
    );
    assert.equal(pruneIfPoor(dirRich), "kept");
    assert.equal(fs.existsSync(path.join(dirRich, "result.json")), true);
    assert.equal(pruneIfPoor(dirPoor), "pruned");
    assert.equal(fs.existsSync(path.join(dirPoor, "result.json")), false);
    assert.equal(pruneIfPoor(dirAbsent), "absent");
  } finally {
    rmTmp(dirRich);
    rmTmp(dirPoor);
    rmTmp(dirAbsent);
  }
});
