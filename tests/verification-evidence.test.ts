import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VerificationReportSchema } from "../shared/types/implement.ts";
import type {
  VerificationReport,
  VerificationStep,
} from "../shared/types/implement.ts";
import {
  VerificationService,
  attachEvidence,
  buildStepEvidence,
  detectVisualEvidence,
  UI_EVIDENCE_EXTENSIONS,
} from "../headless-runtime/implement/verification.ts";
import {
  VerifyJsonSchema,
  buildVerifyJson,
  readVerifyJson,
  writeVerifyJsonAtomic,
} from "../headless-runtime/implement/verifyEvidence.ts";
import { buildReviewPrompt } from "../headless-runtime/review/reviewPrompt.ts";

// Ola 9 (Verify como etapa propia, núcleo): evidence en el contrato,
// detección visual, verify.json y bloque en el reviewer. Sin ejecutar
// nada pesado: ningún test spawnea pnpm.

// ── Constante documentada de superficie UI ──

test("UI_EVIDENCE_EXTENSIONS cubre superficies UI típicas", () => {
  for (const ext of [".tsx", ".jsx", ".vue", ".css", ".scss"]) {
    assert.ok(
      (UI_EVIDENCE_EXTENSIONS as readonly string[]).includes(ext),
      `falta ${ext}`,
    );
  }
});

// ── buildStepEvidence: una entrada por step, status real ──

function step(over: Partial<VerificationStep> & { name: VerificationStep["name"] }): VerificationStep {
  return {
    command: `pnpm ${over.name}`,
    exitCode: 0,
    durationMs: 10,
    status: "pass",
    logPath: "logs/build.log",
    ...over,
  };
}

test("step test pass → evidence test/pass con ref y summary", () => {
  const e = buildStepEvidence(step({ name: "test", status: "pass", exitCode: 0 }));
  assert.equal(e.kind, "test");
  assert.equal(e.status, "pass");
  assert.equal(e.ref, "logs/build.log");
  assert.match(e.summary, /test: pass \(exit 0\)/);
});

test("step build pass → kind build; setup pass → kind build", () => {
  assert.equal(buildStepEvidence(step({ name: "build" })).kind, "build");
  assert.equal(
    buildStepEvidence(step({ name: "setup", command: "corepack enable" })).kind,
    "build",
  );
});

test("step fail refleja fail (nada de pass inventados)", () => {
  const e = buildStepEvidence(
    step({ name: "test", status: "fail", exitCode: 1, logSnippet: "not ok 1 - x" }),
  );
  assert.equal(e.kind, "test");
  assert.equal(e.status, "fail");
  assert.match(e.summary, /test: fail \(exit 1\)/);
});

test("step skipped refleja skipped con su razón", () => {
  const e = buildStepEvidence(
    step({
      name: "test",
      status: "skipped",
      exitCode: null,
      logSnippet: "skipped: no package.json in /tmp/w — unknown project kind, JS suite N/A",
    }),
  );
  assert.equal(e.status, "skipped");
  assert.match(e.summary, /test: skipped \(exit null\)/);
  assert.match(e.summary, /no package\.json/);
});

test("step cuarentenado cita la razón de cuarentena", () => {
  const e = buildStepEvidence(
    step({
      name: "test",
      status: "pass",
      exitCode: 0,
      logSnippet:
        "tap output\n[quarantine] quarantined 1 failure(s), no overlap with change [docs/Zeta.md]; failures: not ok 1 - stale",
    }),
  );
  assert.equal(e.kind, "test");
  assert.equal(e.status, "pass");
  assert.match(e.summary, /quarantined 1 failure/);
  assert.match(e.summary, /no overlap with change \[docs\/Zeta\.md\]/);
});

// ── detectVisualEvidence ──

test("detección visual: tsx → pending-human con ref y summary", () => {
  const e = detectVisualEvidence(["src/features/panel/Panel.tsx"]);
  assert.ok(e);
  assert.equal(e.kind, "visual");
  assert.equal(e.status, "pending-human");
  assert.match(e.ref ?? "", /Panel\.tsx/);
  assert.match(e.summary, /superficie visual/);
});

test("detección visual: .ts puro → sin entrada visual", () => {
  assert.equal(detectVisualEvidence(["src/auth.ts"]), null);
  assert.equal(detectVisualEvidence(["docs/Zeta.md", "src/auth.ts"]), null);
  assert.equal(detectVisualEvidence([]), null);
});

test("detección visual: asset bajo public/ → pending-human", () => {
  const e = detectVisualEvidence(["public/logo.png"]);
  assert.ok(e);
  assert.equal(e.kind, "visual");
  assert.equal(e.status, "pending-human");
});

test("detección visual: css/vue/jsx también son superficie", () => {
  assert.ok(detectVisualEvidence(["src/app.css"]));
  assert.ok(detectVisualEvidence(["src/Card.vue"]));
  assert.ok(detectVisualEvidence(["src/legacy.jsx"]));
});

// ── attachEvidence: orden steps + visual al final, sin tocar lo demás ──

function report(over: Partial<VerificationReport> = {}): VerificationReport {
  const now = new Date().toISOString();
  return {
    steps: [
      step({ name: "test", status: "pass", exitCode: 0 }),
      step({ name: "build", status: "pass", exitCode: 0 }),
    ],
    overall: "pass",
    startedAt: now,
    finishedAt: now,
    durationMs: 10,
    ...over,
  };
}

test("attachEvidence: entries por step en orden + visual al final", () => {
  const out = attachEvidence(report(), ["src/Panel.tsx"]);
  assert.ok(out.evidence);
  assert.equal(out.evidence.length, 3);
  assert.equal(out.evidence[0].kind, "test");
  assert.equal(out.evidence[1].kind, "build");
  assert.equal(out.evidence[2].kind, "visual");
  assert.equal(out.evidence[2].status, "pending-human");
  // steps/overall intactos (cero cambio de semántica)
  assert.equal(out.overall, "pass");
  assert.equal(out.steps.length, 2);
});

test("attachEvidence: sin UI no hay entrada visual", () => {
  const out = attachEvidence(report(), ["src/auth.ts"]);
  assert.ok(out.evidence);
  assert.equal(out.evidence.length, 2);
  assert.ok(out.evidence.every((e) => e.kind !== "visual"));
});

// ── run(): evidence real en camino skipped (sin pnpm, rápido) ──

test("run(): skipped adjunta evidence + visual pending-human, overall intacto", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verif-ev-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verif-ev-dir-"));
  // H-001: createdFiles debe existir en disco (invariante: fantasma → fail).
  fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "src", "Panel.tsx"), "export const Panel = 1;\n", "utf-8");
  const svc = new VerificationService();
  const rep = await svc.run(worktree, dir, "anotar pendiente en docs", ["src/Panel.tsx"]);
  assert.equal(rep.overall, "pass");
  assert.equal(rep.steps.length, 2);
  assert.ok(rep.evidence, "run debe adjuntar evidence");
  assert.equal(rep.evidence.length, 3);
  assert.deepEqual(
    rep.evidence.map((e) => e.status),
    ["skipped", "skipped", "pending-human"],
  );
  assert.equal(rep.evidence[2].kind, "visual");
});

test("run(): skipped con .ts puro no agrega visual", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verif-ev2-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verif-ev2-dir-"));
  // H-001: createdFiles debe existir en disco (invariante: fantasma → fail).
  fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "src", "auth.ts"), "export const auth = 1;\n", "utf-8");
  const svc = new VerificationService();
  const rep = await svc.run(worktree, dir, "anotar pendiente en docs", ["src/auth.ts"]);
  assert.equal(rep.overall, "pass");
  assert.ok(rep.evidence);
  assert.ok(rep.evidence.every((e) => e.kind !== "visual"));
});

// ── verify.json: escrito y válido ──

test("writeVerifyJsonAtomic: escribe verify.json válido con evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-json-"));
  const verification = attachEvidence(report(), ["src/Panel.tsx"]);
  const payload = writeVerifyJsonAtomic(dir, {
    workItemId: "job-test-verify1",
    verification,
    createdFiles: ["src/Panel.tsx"],
  });
  assert.ok(payload);
  assert.equal(payload.workItemId, "job-test-verify1");
  const raw = fs.readFileSync(path.join(dir, "verify.json"), "utf-8");
  const parsed = VerifyJsonSchema.parse(JSON.parse(raw));
  assert.equal(parsed.workItemId, "job-test-verify1");
  assert.deepEqual(parsed.createdFiles, ["src/Panel.tsx"]);
  assert.ok(parsed.timestamp.length > 0);
  assert.equal(parsed.verification.overall, "pass");
  assert.equal(parsed.verification.evidence?.length, 3);
  assert.equal(readVerifyJson(dir)?.workItemId, "job-test-verify1");
});

test("buildVerifyJson: report sin evidence también es válido (compat)", () => {
  const payload = buildVerifyJson({
    workItemId: "job-test-verify1",
    verification: report(),
    createdFiles: [],
  });
  assert.equal(payload.verification.evidence, undefined);
  assert.ok(payload.timestamp.length > 0);
});

test("writeVerifyJsonAtomic: best-effort, nunca lanza", () => {
  // dir imposible (un archivo, no un directorio) → null, sin throw
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verify-fail-")), "f");
  fs.writeFileSync(file, "x");
  const out = writeVerifyJsonAtomic(path.join(file, "sub"), {
    workItemId: "job-test-verify1",
    verification: report(),
    createdFiles: [],
  });
  assert.equal(out, null);
});

// ── Contrato: report viejo sin evidence sigue válido ──

test("compat: VerificationReport sin evidence sigue válido", () => {
  const now = new Date().toISOString();
  const old = {
    steps: [
      {
        name: "test",
        command: "pnpm test",
        exitCode: 0,
        durationMs: 5,
        status: "pass",
        logPath: "logs/build.log",
      },
    ],
    overall: "pass",
    startedAt: now,
    finishedAt: now,
    durationMs: 5,
  };
  const parsed = VerificationReportSchema.parse(old);
  assert.equal(parsed.overall, "pass");
  assert.equal(parsed.evidence, undefined);
});

// ── buildReviewPrompt: turno flaco (evidencia vive en el espejo) ──

function promptCtx(verification: VerificationReport) {
  return buildReviewPrompt(
    {
      id: "job-review-ev01",
      prompt: "agregar panel con tests",
      worktree: "/tmp/wt",
      modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    },
    {
      createdFiles: ["src/Panel.tsx"],
      verification,
      reviewAttempt: 1,
    },
  );
}

test("turno flaco: ignora verification/evidence aunque se pasen", () => {
  const prompt = promptCtx(attachEvidence(report(), ["src/Panel.tsx"]));
  assert.ok(prompt.includes("agregar panel con tests"), "el issue viaja");
  assert.ok(!prompt.includes("Evidencia de verificación"), "turno flaco: sin evidencia");
  assert.ok(!prompt.includes("visual/pending-human"), "turno flaco: sin entries");
  assert.ok(!prompt.includes("src/Panel.tsx"), "turno flaco: sin lista servida");
  assert.ok(!prompt.includes("Nunca ignorarlo en silencio"), "la regla vive en el espejo");
});

test("regla de evidencia vive en el espejo review/agent.md", () => {
  const mirror = fs.readFileSync(
    path.join(process.cwd(), "factory", "agents", "review", "agent.md"),
    "utf-8",
  );
  assert.match(mirror, /missing proof is blocking/);
  assert.match(mirror, /major/);
  assert.match(mirror, /ask_human/);
  const prompt = promptCtx(report());
  assert.ok(!prompt.includes("Evidencia de verificación"), "turno flaco: sin bloque");
  assert.ok(!prompt.includes("Regla de evidencia"), "turno flaco: sin regla en el turno");
});
