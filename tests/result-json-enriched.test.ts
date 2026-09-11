/**
 * result.json enriquecido (H-001, micro-fix orquestador).
 *
 * `ensureResultJson` (workItemDisk) reescribe result.json en cada persist;
 * antes lo hacía con forma pobre (sin verification ni createdFiles), pisando
 * el archivo rico y dejando al VerificationPanel en stale
 * ("pendiente / CreatedFiles (0)"). Ahora espeja la última verification de
 * la meta del timeline + createdFiles top-level (aditivo, jamás lanza).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeWorkItemJsonAtomic } from "../headless-runtime/workItem/workItemDisk.ts";

function mkItem(dir: string, extra: Record<string, unknown> = {}): any {
  return {
    id: "job-test",
    prompt: "prompt de prueba",
    worktree: dir,
    phase: "diagnosisLlm",
    status: "Complete",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: [],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir,
    runnerId: "linux-build",
    ...extra,
  };
}

function readResult(dir: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf-8"));
}

describe("result.json enriquecido (H-001)", () => {
  it("espeja createdFiles + última verification de la meta del timeline", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "result-enr-"));
    const verification = { overall: "pass", steps: [{ name: "test", status: "pass" }] };
    writeWorkItemJsonAtomic(
      mkItem(dir, {
        createdFiles: ["lab3-notas"],
        timeline: [{ id: "t0", from: "Building", to: "Review", at: new Date().toISOString(), actor: "runner", message: "verification passed → Review", meta: { verification, createdFiles: ["lab3-notas"] } }],
      }),
    );
    const r = readResult(dir);
    assert.deepEqual(r.createdFiles, ["lab3-notas"]);
    assert.deepEqual(r.verification, verification);
  });

  it("sin verification en timeline: omite la clave; sin createdFiles: [] honesto", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "result-enr-"));
    writeWorkItemJsonAtomic(mkItem(dir));
    const r = readResult(dir);
    assert.ok(!("verification" in r));
    assert.deepEqual(r.createdFiles, []);
  });

  it("con dos verifications gana la última del timeline", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "result-enr-"));
    const v1 = { overall: "fail", steps: [] };
    const v2 = { overall: "pass", steps: [] };
    const meta = (v: unknown) => ({ id: "t", from: "Building", to: "Review", at: new Date().toISOString(), actor: "runner", message: "m", meta: { verification: v } });
    writeWorkItemJsonAtomic(mkItem(dir, { timeline: [meta(v1), meta(v2)] }));
    assert.deepEqual(readResult(dir).verification, v2);
  });
});
