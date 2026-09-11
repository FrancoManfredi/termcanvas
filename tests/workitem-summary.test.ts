import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkItemSummary,
  readCreatedFilesForVerification,
  readCreatedFilesStrict,
} from "../src/features/factoryLab/components/workItemSummary.ts";
import type { WorkItem } from "../shared/types/workItem.ts";

function baseItem(): WorkItem {
  return {
    id: "job-test-copy01",
    prompt: "crear carpeta X con main.py",
    worktree: "C:\\repo\\test",
    status: "Triage",
    createdAt: "2026-09-03T01:48:00.000Z",
    updatedAt: "2026-09-03T01:48:58.000Z",
    timeline: [
      { id: "t0", from: "Intake", to: "Intake", at: "2026-09-03T01:48:00.000Z", actor: "user", message: "created Intake" },
      {
        id: "t1", from: "Building", to: "Triage", at: "2026-09-03T01:48:58.000Z", actor: "runner",
        message: "verification failed: pnpm test exit 1",
        meta: {
          verification: {
            overall: "fail",
            durationMs: 1,
            steps: [
              { name: "test", command: "pnpm test", exitCode: 1, status: "fail", logSnippet: "no package.json — cannot run" },
              { name: "build", command: "pnpm build", exitCode: null, status: "skipped", logSnippet: "skipped due to test failure (fail-fast)" },
            ],
          },
          createdFiles: ["hola_mundo/main.py"],
        },
      },
    ],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir: null,
    dotDonePath: "",
    runnerId: "linux-build",
    phase: "diagnosisLlm",
  } as unknown as WorkItem;
}

test("resumen incluye status, verificación con exit codes y archivos (sin truncar)", () => {
  const s = buildWorkItemSummary(baseItem(), {
    resultUrl: "http://127.0.0.1:17680/factory/jobs/x/result",
    buildLogUrl: "http://127.0.0.1:17680/factory/jobs/x/build-log",
  });
  assert.match(s, /## Job job-test-copy01 — Triage/);
  assert.match(s, /Prompt: crear carpeta/);
  assert.match(s, /Verification: fail \(2 steps, 1ms\)/);
  assert.match(s, /test: fail \(exit 1\)/);
  assert.match(s, /no package\.json/);
  assert.match(s, /CreatedFiles \(1\): hola_mundo\/main\.py/);
  assert.match(s, /Building→Triage \| runner \| verification failed/);
  assert.match(s, /result\.json: http/);
});

test("resumen incluye review cuando existe", () => {
  const wi = baseItem();
  (wi as unknown as Record<string, unknown>).reviewCount = 1;
  (wi as unknown as Record<string, unknown>).lastReview = {
    verdict: "ask_human",
    confidence: 0.5,
    summary: "revisor caído",
    findings: [],
    reviewAttempt: 1,
    reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
  };
  const s = buildWorkItemSummary(wi);
  assert.match(s, /Review: ask_human 50%/);
  assert.match(s, /revisor=opencode\/big-pickle/);
  assert.match(s, /findings: 0/);
});

test("sin verificación ni review no rompe", () => {
  const wi = baseItem();
  wi.timeline = [
    { id: "t0", from: "Intake", to: "Intake", at: "2026-09-03T01:48:00.000Z", actor: "user", message: "created Intake" },
  ];
  const s = buildWorkItemSummary(wi);
  assert.match(s, /Verification: sin datos todavía/);
  assert.doesNotMatch(s, /Review:/);
});

test("forma única createdFiles (refactor ① E1): strict + solo-verificación", () => {
  assert.deepEqual(readCreatedFilesStrict({ createdFiles: ["a.txt"] }), ["a.txt"]);
  assert.deepEqual(readCreatedFilesStrict({ createdFiles: ["a.txt", "", 42] }), ["a.txt"]);
  assert.equal(readCreatedFilesStrict({ createdFiles: [] }), null);
  assert.equal(readCreatedFilesStrict({}), null);
  assert.deepEqual(readCreatedFilesForVerification({ createdFiles: ["a.txt"] }), ["a.txt"]);
  assert.deepEqual(readCreatedFilesForVerification({}), [], "ausente→[] SOLO en vista verificación");
});
