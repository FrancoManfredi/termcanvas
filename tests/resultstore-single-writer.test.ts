/**
 * FASE 4 E1 — `resultStore` como escritor único de `result.json` (una tienda un
 * escritor, C3 validado+atómico). Fija post-entierro: rico conservado, pobre
 * podado, escritura atómica tmp→rename sin restos, `.done` acoplado al status
 * y `ensureResultJsonCompat` que jamás pisa un rico. Offline total: tmp, sin
 * daemon, sin red, cero LLM real, sin docker.
 *
 * Reglas: las 8 + C1–C10 (C1 ESM/cotas; C2 fail-safe salvo validación zod que
 * lanza por diseño y se aserta; C3 un escritor; C4 disco best-effort donde
 * toca; C5 aditivo: formas intactas).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildResultPayload,
  ensureResultJsonCompat,
  isRichResultJson,
  pruneIfPoor,
  readResult,
  writeResult,
} from "../headless-runtime/workItem/resultStore.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

function mkTmp(prefix = "f4e1-rs-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
        logSnippet: "ok",
        logPath: "logs/build.log",
      },
    ],
    overall,
    startedAt: nowIso,
    finishedAt: nowIso,
    durationMs: 5,
  };
}

function tmpLeftovers(dir: string): string[] {
  return fs.readdirSync(dir).filter((n) => n.includes(".tmp-"));
}

test("F4-E1 escritor único: rico se conserva, pobre se poda, ausente intacto", () => {
  const dirRich = mkTmp();
  const dirPoor = mkTmp();
  const dirAbsent = mkTmp();
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
    assert.equal(isRichResultJson(path.join(dirRich, "result.json")), true);
  } finally {
    rmTmp(dirRich);
    rmTmp(dirPoor);
    rmTmp(dirAbsent);
  }
});

test("F4-E1 escritor único: writeResult es atómico (tmp→rename sin restos) y acopla .done", () => {
  const dir = mkTmp();
  try {
    const passPayload = buildResultPayload({
      workItemId: "job-f4e1-rs-pass",
      worktreePath: dir,
      verification: mkVerification("pass"),
      createdFiles: [],
    });
    writeResult(dir, passPayload);
    assert.deepEqual(tmpLeftovers(dir), [], "sin restos tmp tras write pass");
    assert.equal(fs.existsSync(path.join(dir, ".done")), true, "pass crea .done");
    const back = readResult(dir);
    assert.ok(back, "roundtrip legible y válido");
    assert.equal(back?.status, "pass");
    assert.equal(back?.workItemId, "job-f4e1-rs-pass");

    const failPayload = buildResultPayload({
      workItemId: "job-f4e1-rs-pass",
      worktreePath: dir,
      verification: mkVerification("fail"),
      createdFiles: [],
    });
    writeResult(dir, failPayload);
    assert.deepEqual(tmpLeftovers(dir), [], "sin restos tmp tras write fail");
    assert.equal(fs.existsSync(path.join(dir, ".done")), false, "fail borra .done");
    assert.equal(readResult(dir)?.status, "fail");
  } finally {
    rmTmp(dir);
  }
});

test("F4-E1 escritor único: payload inválido lanza (zod) y no deja archivo", () => {
  const dir = mkTmp();
  try {
    assert.throws(() => {
      writeResult(dir, { status: "pass" } as never);
    });
    assert.equal(fs.existsSync(path.join(dir, "result.json")), false);
    assert.deepEqual(tmpLeftovers(dir), [], "sin restos tmp tras throw");
  } finally {
    rmTmp(dir);
  }
});

test("F4-E1 escritor único: ensureResultJsonCompat jamás pisa un rico", () => {
  const dir = mkTmp();
  const id = `job-f4e1-rs-compat-${Date.now().toString(36)}`;
  try {
    const rich = {
      jobId: id,
      status: "fail",
      verification: mkVerification("fail"),
      createdFiles: ["evidencia.txt"],
    };
    fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(rich), "utf-8");
    ensureResultJsonCompat({
      id,
      prompt: "p",
      worktree: dir,
      phase: "diagnosisLlm",
      status: "Triage",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: [],
      cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
      dir,
    } as never);
    const after = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf-8")) as Record<string, unknown>;
    assert.deepEqual(after.createdFiles, ["evidencia.txt"], "el rico no se pisa");
    assert.equal((after.verification as { overall?: string })?.overall, "fail");
  } finally {
    rmTmp(dir);
  }
});

test("F4-E1 escritor único: ensureResultJsonCompat crea compat pobre solo si ausente", () => {
  const dir = mkTmp();
  const id = `job-f4e1-rs-absent-${Date.now().toString(36)}`;
  try {
    assert.equal(fs.existsSync(path.join(dir, "result.json")), false);
    ensureResultJsonCompat({
      id,
      prompt: "p",
      worktree: dir,
      phase: "diagnosisLlm",
      status: "Building",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: [],
      cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
      dir,
    } as never);
    assert.equal(fs.existsSync(path.join(dir, "result.json")), true, "crea el compat si ausente");
    assert.equal(isRichResultJson(path.join(dir, "result.json")), false, "el compat sin meta es pobre honesto");
  } finally {
    rmTmp(dir);
  }
});
