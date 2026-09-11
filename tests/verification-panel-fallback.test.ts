/**
 * H-008 (parte 2) — VerificationPanel con fallback a verify.json + timeline.
 *
 * Contrato del panel (nivel vista, sin montar React — patrón del repo):
 * - job NO-terminal sin `result.json` pero con `verify.json` (GET /verify,
 *   artefacto Ola 9) + timeline del GET single → vista "partial" honesta.
 * - Con evidence en verify.json el estado JAMÁS es "pendiente".
 * - JAMÁS se inventa un pass: sin verification válida el status es fail/pending,
 *   nunca pass.
 * - `result` rico con verification.steps sigue mandando (modo full intacto).
 * - Sin polling nuevo: el panel conserva su único setInterval preexistente.
 * - Tipado estructural: sin tipos headless, ESM puro (cero require).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveVerificationView } from "../src/features/factoryLab/components/verificationFallback.ts";

const PANEL_PATH = path.resolve("src", "features", "factoryLab", "components", "VerificationPanel.tsx");
const FALLBACK_PATH = path.resolve("src", "features", "factoryLab", "components", "verificationFallback.ts");

/** Forma real de corrida 6: verify.json de job-mtmdu116-9u37 (setup exit 127). */
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
      at: "2026-09-04T03:17:36.455Z",
      actor: "runner",
      message: `evento ${i}`,
    })),
  };
}

test("setup-fail sin result.json → parcial fail con nota verify.json + timeline", () => {
  const view = resolveVerificationView({ result: null, verify: setupFailVerify(), job: jobWithTimeline(10) });
  assert.equal(view.mode, "partial");
  assert.equal(view.status, "fail");
  assert.equal(view.verification?.overall, "fail");
  assert.equal(view.verification?.steps[0]?.exitCode, 127);
  assert.deepEqual(view.createdFiles, []);
  assert.equal(view.timelineEvents, 10);
  assert.match(view.note ?? "", /parcial/);
  assert.match(view.note ?? "", /verify\.json/);
  assert.match(view.note ?? "", /timeline \(10 eventos\)/);
});

test("nunca pendiente con evidence; nunca inventa pass", () => {
  // verify fail → fail (no pendiente, no pass).
  const failView = resolveVerificationView({ result: null, verify: setupFailVerify(), job: jobWithTimeline(3) });
  assert.notEqual(failView.status, "pending");
  assert.notEqual(failView.status, "pass");
  // evidence suelta sin verification válida → tampoco pendiente ni pass.
  const evView = resolveVerificationView({
    result: null,
    verify: { evidence: [{ kind: "build-log", status: "fail", ref: "logs/build.log" }] },
    job: jobWithTimeline(2),
  });
  assert.equal(evView.mode, "partial");
  assert.notEqual(evView.status, "pending");
  assert.notEqual(evView.status, "pass");
  assert.ok(evView.evidence.length > 0);
});

test("result rico con verification manda (full intacto) aunque exista verify", () => {
  const view = resolveVerificationView({
    result: {
      workItemId: "job-mtmdu116-9u37",
      status: "pass",
      verification: {
        steps: [{ name: "test", command: "pnpm test", exitCode: 0, durationMs: 10, status: "pass", logPath: "logs/build.log" }],
        overall: "pass",
        startedAt: "x",
        finishedAt: "y",
        durationMs: 10,
      },
      createdFiles: ["lab6-dock/nota.txt"],
    },
    verify: setupFailVerify(),
    job: jobWithTimeline(10),
  });
  assert.equal(view.mode, "full");
  assert.equal(view.status, "pass");
  assert.deepEqual(view.createdFiles, ["lab6-dock/nota.txt"]);
  assert.equal(view.note, null);
});

test("sin nada útil → pendiente honesto (empty solo sin evidence)", () => {
  const view = resolveVerificationView({ result: null, verify: null, job: jobWithTimeline(1) });
  assert.equal(view.mode, "empty");
  assert.equal(view.status, "pending");
  assert.equal(view.verification, null);
  assert.deepEqual(view.createdFiles, []);
  assert.deepEqual(view.evidence, []);
});

test("timeline disponible: cuenta eventos del GET single (0 si no hay)", () => {
  const withTimeline = resolveVerificationView({ result: null, verify: setupFailVerify(), job: jobWithTimeline(7) });
  assert.equal(withTimeline.timelineEvents, 7);
  const noTimeline = resolveVerificationView({ result: null, verify: setupFailVerify(), job: { id: "job-x" } });
  assert.equal(noTimeline.mode, "partial");
  assert.equal(noTimeline.timelineEvents, 0);
  assert.doesNotMatch(noTimeline.note ?? "", /timeline \(/);
});

test("guards estáticos del panel: fallback cableado y sin polling nuevo", () => {
  const src = fs.readFileSync(PANEL_PATH, "utf-8");
  assert.match(src, /\/factory\/jobs\/.*\/verify/, "pide GET /verify existente (Ola 9)");
  assert.match(src, /resolveVerificationView/, "resuelve la vista con fallback");
  assert.match(src, /view\.mode !== "empty"/, "renderiza la vista parcial");
  assert.match(src, /view\.note/, "muestra la nota honesta de origen parcial");
  const intervals = src.match(/setInterval/g) ?? [];
  assert.equal(intervals.length, 1, `sin polling nuevo: 1 único setInterval preexistente (2.5s), hallados ${intervals.length}`);
  assert.doesNotMatch(src, /require\(/, "ESM puro: cero require()");
});

test("tipado estructural: el fallback no importa tipos headless", () => {
  const src = fs.readFileSync(FALLBACK_PATH, "utf-8");
  assert.doesNotMatch(src, /headless-runtime/, "sin tipos headless (solo unknown + estructural)");
  assert.doesNotMatch(src, /require\(/, "ESM puro: cero require()");
});
