/**
 * H-008 (parte 2) — VerificationPanel con fallback a verify.json + timeline.
 *
 * El panel SOLO leía `result.json` (ausente en jobs no-terminales) y mostraba
 * "pendiente / CreatedFiles (0)" con verificación pasada o fallada en
 * `verify.json` + timeline. Ahora resuelve una vista honesta:
 * full (result rico) → partial (verify.json + timeline) → empty.
 *
 * Patrón del repo: lógica extraída pura + guards (el panel no se monta).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasFullVerification, resolveVerificationView } from "../src/features/factoryLab/components/verificationFallback.ts";

// Forma real de corrida 6: job-mtmdu116-9u37 (setup `corepack enable` exit 127).
function setupFailVerify(): unknown {
  return {
    workItemId: "job-mtmdu116-9u37",
    verification: {
      steps: [
        {
          name: "setup",
          command: "corepack enable",
          exitCode: 127,
          durationMs: 9233,
          status: "fail",
          logSnippet: "sh: 1: corepack: not found\n",
          logPath: "logs/build.log",
          isolation: "docker",
        },
      ],
      overall: "fail",
      startedAt: "2026-09-04T03:17:27.207Z",
      finishedAt: "2026-09-04T03:17:36.440Z",
      durationMs: 9233,
    },
    createdFiles: [],
    timestamp: "2026-09-04T03:17:36.452Z",
  };
}

function jobWithTimeline(events: number): unknown {
  return {
    id: "job-mtmdu116-9u37",
    status: "Triage",
    createdFiles: [],
    timeline: Array.from({ length: events }, (_, i) => ({
      id: `job-mtmdu116-9u37-t${i}`,
      from: "Building",
      to: "Triage",
      at: new Date().toISOString(),
      actor: "runner",
      message: `evento ${i}`,
    })),
  };
}

test("result rico → full (comportamiento actual intacto)", () => {
  const verification = {
    steps: [{ name: "test", command: "pnpm test", exitCode: 0, durationMs: 10, status: "pass", logPath: "logs/build.log" }],
    overall: "pass",
    startedAt: "x",
    finishedAt: "y",
    durationMs: 10,
  };
  const view = resolveVerificationView({
    result: { workItemId: "job-abc", status: "pass", verification, createdFiles: ["lab3-notas"] },
    verify: null,
    job: jobWithTimeline(3),
  });
  assert.equal(view.mode, "full");
  assert.equal(view.status, "pass");
  assert.deepEqual(view.createdFiles, ["lab3-notas"]);
  assert.equal(view.verification?.steps.length, 1);
  assert.equal(view.note, null);
});

test("sin result.json + verify fail → partial con fail honesto (nunca pendiente)", () => {
  const view = resolveVerificationView({ result: null, verify: setupFailVerify(), job: jobWithTimeline(10) });
  assert.equal(view.mode, "partial");
  assert.equal(view.status, "fail", "con evidence en verify.json jamás pendiente");
  assert.equal(view.verification?.overall, "fail");
  assert.equal(view.verification?.steps[0]?.command, "corepack enable");
  assert.equal(view.verification?.steps[0]?.exitCode, 127);
  assert.deepEqual(view.createdFiles, []);
  assert.match(view.note ?? "", /parcial/);
  assert.match(view.note ?? "", /verify\.json/);
  assert.equal(view.timelineEvents, 10);
});

test("result pobre (sin verification) + verify pass → partial con archivos", () => {
  const view = resolveVerificationView({
    result: { jobId: "job-x", status: "Triage" },
    verify: {
      workItemId: "job-x",
      verification: {
        steps: [{ name: "test", command: "pnpm test", exitCode: 0, durationMs: 5, status: "pass", logPath: "logs/build.log" }],
        overall: "pass",
        startedAt: "x",
        finishedAt: "y",
        durationMs: 5,
      },
      createdFiles: ["lab6-dock/nota.txt"],
      timestamp: new Date().toISOString(),
    },
    job: jobWithTimeline(4),
  });
  assert.equal(view.mode, "partial");
  assert.equal(view.status, "pass");
  assert.deepEqual(view.createdFiles, ["lab6-dock/nota.txt"]);
});

test("sin nada → empty pendiente honesto (sin evidence que mostrar)", () => {
  const view = resolveVerificationView({ result: null, verify: null, job: jobWithTimeline(1) });
  assert.equal(view.mode, "empty");
  assert.equal(view.status, "pending");
  assert.equal(view.verification, null);
  assert.deepEqual(view.createdFiles, []);
  assert.deepEqual(view.evidence, []);
});

test("guards: entradas malformadas nunca lanzan ni mienten", () => {
  for (const input of [null, undefined, "texto", 42, [], {}, { result: {}, verify: {}, job: {} }]) {
    const view = resolveVerificationView(input as unknown as { result: unknown; verify: unknown; job: unknown });
    assert.ok(view.mode === "empty" || view.mode === "partial" || view.mode === "full");
  }
  // verification sin steps válidos no cuenta como verificación.
  const view = resolveVerificationView({
    result: null,
    verify: { verification: { overall: "fail", steps: [{ name: "x", status: "weird" }] } },
    job: null,
  });
  assert.equal(view.mode, "empty");
  assert.equal(view.status, "pending");
});

test("guards del panel (estático): pide /verify + GET single y pinta parcial", () => {
  const src = fs.readFileSync(
    path.resolve("src", "features", "factoryLab", "components", "VerificationPanel.tsx"),
    "utf-8",
  );
  assert.match(src, /\/factory\/jobs\/.*\/verify/, "el panel pide GET /verify existente");
  assert.match(src, /resolveVerificationView/, "el panel usa la vista con fallback");
  assert.match(src, /view\.mode !== "empty"/, "el panel renderiza la vista parcial");
  assert.match(src, /view\.note/, "el panel muestra la nota honesta de origen parcial");
});

test("hasFullVerification: misma regla que la vista full (refactor ① E1, forma única)", () => {
  assert.equal(
    hasFullVerification({ verification: { overall: "pass", steps: [{ name: "test", status: "pass" }] } }),
    true,
  );
  assert.equal(hasFullVerification({ verification: { overall: "pass", steps: [] } }), false);
  assert.equal(hasFullVerification({ status: "fail" }), false);
  assert.equal(hasFullVerification(null), false);
  assert.equal(hasFullVerification({ verification: { overall: "pass", steps: [{ name: "x" }] } }), false);
});
