/**
 * JobView — proyección única para lista/detalle/preview (refactor ① E1, A1).
 *
 * Rico/pobre(viejo)/ausente; lista-vs-detalle consistentes; `createdFiles`
 * ausente→`[]` SOLO en vista verificación; default histórico de runnerId sin
 * reescribir disco; opcionales ausentes se omiten. Contra-chequeo contra
 * `WorkItemStore.toJSON` (la delegación de A3 no debe cambiar ni una clave).
 * Todo offline en tmp, sin daemon, sin docker, sin LLM.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  toDetail,
  toListItem,
  toResultPreview,
  toStoreJson,
  verificationCreatedFiles,
} from "../headless-runtime/workItem/jobView.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import type { WorkItem } from "../shared/types/workItem.ts";

function mkItem(extra: Record<string, unknown> = {}): WorkItem {
  const nowIso = new Date().toISOString();
  return {
    id: "job-jv01",
    prompt: "Creá el archivo notas.txt con el resumen del lab",
    worktree: path.join(os.tmpdir(), "jv-wt"),
    phase: "diagnosisLlm",
    status: "Review",
    state: "running",
    createdAt: nowIso,
    updatedAt: nowIso,
    timeline: [
      {
        id: "job-jv01-t0",
        from: "Intake",
        to: "Intake",
        at: nowIso,
        actor: "user",
        message: "created Intake",
      },
    ],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir: path.join(os.tmpdir(), "jv-wt", ".agents", "factory", "job-jv01"),
    dotDonePath: path.join(os.tmpdir(), "jv-wt", ".agents", "factory", "job-jv01", ".done"),
    runnerId: "linux-build",
    logsNdjsonPath: path.join(os.tmpdir(), "jv-wt", ".agents", "factory", "job-jv01", "logs.ndjson"),
    reviewCount: 1,
    logs: ["[t] hola"],
    ...extra,
  } as unknown as WorkItem;
}

function mkRich(): WorkItem {
  return mkItem({
    costSummary: {
      llmCalls: 3,
      estimatedInputTokens: 100,
      estimatedOutputTokens: 50,
      estimatedUSD: null,
      basis: "estimated-chars/4",
      ratesRef: null,
    },
    agentSessions: { foreman: "ses-1" },
    createdFiles: ["notas.txt"],
    lastReview: {
      workItemId: "job-jv01",
      verdict: "ask_human",
      confidence: 0.5,
      summary: "revisar a mano",
      findings: [],
      reviewAttempt: 1,
    },
    sessionId: "ses-1",
    dashboardUrl: "http://x",
    directory: "lab",
    modelRef: { providerID: "p", modelID: "m" },
    reviewerRef: { providerID: "p", modelID: "r" },
  });
}

describe("jobView: vista store (réplica de WorkItemStore.toJSON)", () => {
  it("rico: expone costSummary/agentSessions/createdFiles/review/identidad", () => {
    const v = toStoreJson(mkRich()) as Record<string, unknown>;
    assert.equal(v.id, "job-jv01");
    assert.equal(v.status, "Review");
    assert.equal(v.state, "running");
    assert.deepEqual((v.costSummary as { llmCalls?: number })?.llmCalls, 3);
    assert.deepEqual(v.agentSessions, { foreman: "ses-1" });
    assert.deepEqual(v.createdFiles, ["notas.txt"]);
    assert.equal(v.reviewCount, 1);
    assert.ok(v.lastReview, "lastReview presente");
    assert.equal(v.logsCount, 1);
    assert.deepEqual(v.logs, ["[t] hola"]);
    assert.equal(v.runnerId, "linux-build");
    assert.equal(v.sessionId, "ses-1");
    assert.deepEqual(v.modelRef, { providerID: "p", modelID: "m" });
    assert.deepEqual(v.reviewerRef, { providerID: "p", modelID: "r" });
    assert.deepEqual((v.cost as { estimatedUSD?: number })?.estimatedUSD, 0);
  });

  it("viejo (mínimo): opcionales ausentes se omiten, defaults históricos", () => {
    const minimal = mkItem();
    delete (minimal as unknown as Record<string, unknown>).costSummary;
    delete (minimal as unknown as Record<string, unknown>).agentSessions;
    delete (minimal as unknown as Record<string, unknown>).createdFiles;
    delete (minimal as unknown as Record<string, unknown>).lastReview;
    delete (minimal as unknown as Record<string, unknown>).sessionId;
    delete (minimal as unknown as Record<string, unknown>).dashboardUrl;
    delete (minimal as unknown as Record<string, unknown>).directory;
    delete (minimal as unknown as Record<string, unknown>).modelRef;
    delete (minimal as unknown as Record<string, unknown>).reviewerRef;
    (minimal as unknown as Record<string, unknown>).reviewCount = undefined;
    const v = toStoreJson(minimal) as Record<string, unknown>;
    for (const k of [
      "costSummary",
      "agentSessions",
      "createdFiles",
      "lastReview",
      "sessionId",
      "dashboardUrl",
      "directory",
      "modelRef",
      "reviewerRef",
    ]) {
      assert.ok(!(k in v), `${k} debe omitirse`);
    }
    assert.equal(v.reviewCount, 0);
    assert.ok("cost" in v, "cost legacy intacto");
  });

  it("runnerId ausente → default histórico (sin tocar disco)", () => {
    const item = mkItem();
    delete (item as unknown as Record<string, unknown>).runnerId;
    assert.equal(toStoreJson(item).runnerId, "linux-build");
    assert.equal(toListItem(item).runnerId, "linux-build");
    assert.equal(toDetail(item).runnerId, "linux-build");
  });

  it("idéntico a WorkItemStore.toJSON (contra-chequeo pre-A3)", () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "jv-store-"));
    const id = "job-jvstore01";
    try {
      const created = workItemStore.create({ id, prompt: "hola", worktree: wt });
      const fromStore = workItemStore.toJSON(created) as Record<string, unknown>;
      const fromView = toStoreJson(created) as Record<string, unknown>;
      assert.deepEqual(fromView, fromStore);
    } finally {
      workItemStore.delete(id);
    }
  });
});

describe("jobView: lista vs detalle consistentes", () => {
  it("misma identidad/estado/timeline/cost/createdFiles en ambas", () => {
    const item = mkRich();
    const extras = { triage: { decision: "x" } };
    const list = toListItem(item, extras) as Record<string, unknown>;
    const detail = toDetail(item, extras) as Record<string, unknown>;
    for (const k of [
      "id",
      "prompt",
      "worktree",
      "phase",
      "state",
      "status",
      "createdAt",
      "updatedAt",
      "timeline",
      "cost",
      "costSummary",
      "createdFiles",
      "runnerId",
      "reviewCount",
      "lastReview",
      "triage",
    ]) {
      assert.deepEqual(detail[k], list[k], `clave ${k} consistente`);
    }
    // Quirk compat documentado: el detalle trae logs pero NO logsCount.
    assert.ok("logs" in detail);
    assert.ok(!("logsCount" in detail));
    assert.equal(list.logsCount, 1);
  });

  it("detalle trae resultPreview con promptPreview(120) + summary por estado", () => {
    const item = mkRich();
    const preview = toResultPreview(item) as Record<string, unknown>;
    assert.equal(preview.jobId, "job-jv01");
    assert.equal(
      preview.promptPreview,
      "Creá el archivo notas.txt con el resumen del lab".slice(0, 120),
    );
    assert.match(String(preview.summary), /aun no finalizado/);
    const done = toResultPreview({ ...item, status: "Complete" } as WorkItem);
    assert.match(String(done.summary), /completado correctamente/);
    const detail = toDetail(item) as { resultPreview?: unknown };
    assert.deepEqual(detail.resultPreview, preview);
  });

  it("createdFiles ausente se omite en lista/detalle/store (no [] fantasma)", () => {
    const item = mkItem();
    delete (item as unknown as Record<string, unknown>).createdFiles;
    assert.ok(!("createdFiles" in toListItem(item)));
    assert.ok(!("createdFiles" in toDetail(item)));
    assert.ok(!("createdFiles" in toStoreJson(item)));
  });
});

describe("jobView: createdFiles solo-verificación", () => {
  it("ausente/inválido → [] SOLO en vista verificación", () => {
    assert.deepEqual(verificationCreatedFiles({}), []);
    assert.deepEqual(verificationCreatedFiles({ createdFiles: undefined }), []);
    assert.deepEqual(verificationCreatedFiles({ createdFiles: null }), []);
    assert.deepEqual(verificationCreatedFiles({ createdFiles: "notas.txt" }), []);
    assert.deepEqual(
      verificationCreatedFiles({ createdFiles: ["a.txt", "", 42, "b.txt"] }),
      ["a.txt", "b.txt"],
    );
  });
});
