/**
 * Ola 18 — Paridad Warp P1.4 + P1.5-engine + P1.7 (lado scorer-engine, E1).
 * node:test + tsx. Juez y análisis mockeados (cero llamadas LLM reales),
 * stores en tmpdirs reales + proposals en sandbox (TERMCANVAS_FACTORY_DIR).
 * No muta `factory/` real ni jobs productivos.
 *
 * - P1.5: vocabulario cerrado de `agents`, gate `scorerAppliesTo`,
 *   `not-applicable` que no cuenta como failure en auto.
 * - P1.7: `resolvePassing` como fuente única; `readScores` re-etiqueta con
 *   el threshold ACTUAL sin tocar el disco.
 * - P1.4: `maybeAutoProposeForScorer` (flag + ≥2 failures NUEVOS + cooldown)
 *   con el mismo engine de análisis; jamás auto-adopta.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SCORER_AGENT_ROLES,
  validateScorerDefinition,
} from "../shared/types/scorer.ts";
import {
  parseScorerFile,
  resetScorerCache,
} from "../headless-runtime/measure/scorerLoader.ts";
import {
  getImproveProposalCooldown,
  parseFactoryYaml,
  resetFactoryConfigCache,
} from "../headless-runtime/factory/agentLoader.ts";
import { shouldSampleJob } from "../headless-runtime/measure/sampler.ts";
import {
  autoScoreCompletedJob,
  collectScorerInputs,
  getScoresSummary,
  isNotApplicable,
  isUnscored,
  maybeAutoProposeForScorer,
  readScores,
  resolvePassing,
  scoreJob,
  scoreJobStatus,
  scorerAppliesTo,
  scorerRequiredStages,
  setScorerPromptMock,
  stagesForInputs,
  toScoreOutcome,
} from "../headless-runtime/measure/scorerEngine.ts";
import {
  collectFailures,
  createPendingProposal,
  createProposal,
  listProposals,
  readProposal,
  setAnalysisPromptMock,
} from "../headless-runtime/measure/improvementEngine.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

// ── Sandbox factory (toda propuesta va acá, nunca al repo real) ──

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "agents-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

const SCORER_MODEL = "opencode-go/muse-spark-1.2-contributor";
const REVIEW_SCORER = "review-formato-valido"; // único con selfImprovement:true
const IMPL_SCORER = "implement-scope-1-3"; // selfImprovement:false
const VERIF_SCORER = "verification-honesta"; // selfImprovement:false

const VALID_DEF = {
  name: "test-agents",
  description: "scorer de prueba",
  agents: ["review"],
  labels: [
    { value: "bueno", score: 1 },
    { value: "malo", score: 0 },
  ],
  passingScore: 0.5,
  samplingRate: 25,
  model: SCORER_MODEL,
  selfImprovement: false,
};

// ── Fixtures ──

const trackedJobs: Array<{ id: string; dir: string }> = [];
let jobSeq = 0;

function nextJobId(): string {
  jobSeq += 1;
  return `job-ag18-${Date.now().toString(36)}-${jobSeq}`;
}

function makeJob(prompt = "hacer algo util en el repo"): string {
  return makeJobWithId(nextJobId(), prompt);
}

function makeJobWithId(id: string, prompt = "hacer algo util en el repo"): string {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "agents-job-"));
  workItemStore.create({ id, prompt: `${prompt} ${id}`, worktree, phase: "diagnosisLlm" });
  const wi = workItemStore.get(id);
  trackedJobs.push({ id, dir: (wi?.dir as string) ?? worktree });
  return id;
}

/**
 * Los failures son globales al store en este proceso: cada test P1.4 parte
 * de cero (jobs previos borrados del store + disco) para que el conteo de
 * "failures NUEVOS" sea determinístico sin importar el orden.
 */
function resetJobs(): void {
  for (const { id, dir } of trackedJobs) {
    try {
      workItemStore.delete(id);
    } catch {}
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  trackedJobs.length = 0;
}

function addVerification(
  id: string,
  createdFiles: string[] = ["src/cambio.ts"],
  overall: "pass" | "fail" = "pass",
): void {
  const now = new Date().toISOString();
  workItemStore.appendEvent(id, "runner", `verification ${overall}`, {
    verification: {
      steps: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: overall === "pass" ? 0 : 1,
          durationMs: 5,
          status: overall === "pass" ? "pass" : "fail",
          logPath: "logs/build.log",
        },
      ],
      overall,
      startedAt: now,
      finishedAt: now,
      durationMs: 5,
    },
    createdFiles,
    runnerId: "linux-build",
  } as unknown as Record<string, unknown>);
}

function addReview(id: string, verdict = "accept"): void {
  workItemStore.appendEvent(id, "system", `review ${verdict} (semilla de test)`, {
    review: { verdict, summary: "cambio pertinente con evidencia citada" },
  } as unknown as Record<string, unknown>);
}

async function persistSeed(opts: {
  id: string;
  scorer: string;
  label: string;
  score: number;
  passing: boolean;
  at?: string;
}): Promise<void> {
  const { persistScoreResult: persist } = await import(
    "../headless-runtime/measure/scorerEngine.ts"
  );
  const ok = persist({
    scorer: opts.scorer,
    workItemId: opts.id,
    label: opts.label,
    score: opts.score,
    passing: opts.passing,
    reason: `semilla de test contra ${opts.label}`,
    model: SCORER_MODEL,
    origin: "manual",
    at: opts.at ?? new Date().toISOString(),
  });
  assert.equal(ok, true, "persistScoreResult debe guardar la semilla");
}

function mockJudgeByScorer(labels: Record<string, string>): { calls: Map<string, number> } {
  const calls = new Map<string, number>();
  setScorerPromptMock(async (input) => {
    calls.set(input.scorerName, (calls.get(input.scorerName) ?? 0) + 1);
    const label = labels[input.scorerName] ?? null;
    if (!label) return null;
    return JSON.stringify({ label, reason: `evidencia citada para ${label}` });
  });
  return { calls };
}

function mockValidAnalysis(ids: string[]): void {
  setAnalysisPromptMock(async () =>
    JSON.stringify({
      pattern: "los reviews aceptan cambios sin evidencia de verificacion",
      target: "skills/code-review/SKILL.md",
      rationale: "endurecer la regla de evidencia bloqueante corrige el patron",
      newContent: "# Code Review (propuesto)\n\nRegla: sin evidencia no hay accept.\n",
      regressionsAddressed: ids,
    }),
  );
}

function cleanProposals(): void {
  try {
    fs.rmSync(path.join(SANDBOX_FACTORY, ".proposals"), { recursive: true, force: true });
  } catch {}
}

function sandboxFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      try {
        if (fs.statSync(abs).isDirectory()) walk(abs, r);
        else out.push(r);
      } catch {}
    }
  };
  walk(SANDBOX_FACTORY, "");
  return out.sort();
}

function validScorerMd(overrides: Record<string, string> = {}): string {
  const front: Record<string, string> = {
    name: "mi-scorer",
    description: "d",
    agents: "{review}",
    labels: "{a:1, b:0}",
    passingScore: "0.5",
    samplingRate: "25",
    model: "p/m",
    selfImprovement: "false",
    ...overrides,
  };
  const lines = ["---"];
  for (const [k, v] of Object.entries(front)) {
    if (v !== "") lines.push(`${k}: ${v}`);
  }
  lines.push("---", "body con instrucciones del juez");
  return lines.join("\n");
}

test.after(() => {
  try {
    setScorerPromptMock(null);
  } catch {}
  try {
    setAnalysisPromptMock(null);
  } catch {}
  try {
    resetScorerCache();
  } catch {}
  try {
    resetFactoryConfigCache();
  } catch {}
  for (const { id, dir } of trackedJobs) {
    try {
      workItemStore.delete(id);
    } catch {}
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  trackedJobs.length = 0;
  try {
    delete process.env.TERMCANVAS_FACTORY_DIR;
  } catch {}
  try {
    fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  } catch {}
});

// ── P1.5: vocabulario cerrado ──

test("P1.5 schema: rol desconocido rechaza con error accionable (vocabulario cerrado)", () => {
  assert.deepEqual([...SCORER_AGENT_ROLES].sort(), [
    "foreman",
    "implement",
    "review",
    "spec",
    "triage",
    "verification",
  ]);
  assert.doesNotThrow(() => validateScorerDefinition(VALID_DEF));
  // ZodError serializa los issues (comillas escapadas): se matchea por partes.
  assert.throws(
    () => validateScorerDefinition({ ...VALID_DEF, agents: ["jefe"] }),
    /rol desconocido/,
  );
  assert.throws(
    () => validateScorerDefinition({ ...VALID_DEF, agents: ["jefe"] }),
    /jefe/,
  );
  assert.throws(
    () => validateScorerDefinition({ ...VALID_DEF, agents: ["jefe"] }),
    /roles válidos/,
  );
  assert.throws(
    () => validateScorerDefinition({ ...VALID_DEF, agents: ["review", "jefe"] }),
    /agents\[1\]/,
  );
  // Case-sensitive a propósito: el mensaje lista los válidos.
  assert.throws(
    () => validateScorerDefinition({ ...VALID_DEF, agents: ["Review"] }),
    /roles válidos/,
  );
  assert.throws(() => validateScorerDefinition({ ...VALID_DEF, agents: [] }));
});

test("P1.5 loader: scorer sin agents o con rol desconocido rechaza nombrando el archivo", () => {
  const missing = validScorerMd();
  const withoutAgents = missing
    .split("\n")
    .filter((l) => !l.startsWith("agents:"))
    .join("\n");
  assert.throws(
    () => parseScorerFile(withoutAgents, "mi-scorer"),
    /factory\/scorers\/mi-scorer\/scorer\.md/,
  );
  assert.throws(
    () => parseScorerFile(validScorerMd({ agents: "{jefe}" }), "mi-scorer"),
    /rol desconocido "jefe".*factory\/scorers\/mi-scorer\/scorer\.md|factory\/scorers\/mi-scorer\/scorer\.md.*rol desconocido "jefe"/,
  );
  assert.throws(
    () => parseScorerFile(validScorerMd({ agents: "{}" }), "mi-scorer"),
    /≥1/,
  );
  assert.doesNotThrow(() => parseScorerFile(validScorerMd(), "mi-scorer"));
});

// ── P1.5: gate de aplicabilidad ──

test("P1.5 scorerAppliesTo por rol/etapa incl. triage/spec/foreman (siempre true)", () => {
  const none = { review: false, implement: false, verification: false };
  assert.equal(scorerAppliesTo({ review: true, implement: false, verification: false }, ["review"]), true);
  assert.equal(scorerAppliesTo(none, ["review"]), false);
  assert.equal(scorerAppliesTo(none, ["implement"]), false);
  assert.equal(scorerAppliesTo(none, ["verification"]), false);
  assert.equal(scorerAppliesTo({ ...none, implement: true }, ["implement"]), true);
  assert.equal(scorerAppliesTo({ ...none, verification: true }, ["verification"]), true);
  // Mezcla: basta ≥1 etapa alcanzada.
  assert.equal(scorerAppliesTo({ ...none, implement: true }, ["review", "implement"]), true);
  // triage|spec|foreman no dejan artefacto de etapa: siempre aplican.
  assert.equal(scorerAppliesTo(none, ["triage"]), true);
  assert.equal(scorerAppliesTo(none, ["spec"]), true);
  assert.equal(scorerAppliesTo(none, ["foreman"]), true);
  assert.equal(scorerAppliesTo(none, ["review", "foreman"]), true);
  // Borde: sin roles no aplica; rol desconocido lanza accionable.
  assert.equal(scorerAppliesTo({ review: true, implement: true, verification: true }, []), false);
  assert.throws(() => scorerAppliesTo(none, ["jefe"]), /rol desconocido "jefe"/);
});

test("P1.5 scorerRequiredStages mapea roles a etapas en orden canónico", () => {
  assert.deepEqual(scorerRequiredStages(["review"]), ["review"]);
  assert.deepEqual(scorerRequiredStages(["verification", "review"]), ["review", "verification"]);
  assert.deepEqual(scorerRequiredStages(["triage"]), []);
  assert.deepEqual(scorerRequiredStages(["implement", "spec"]), ["implement"]);
  assert.throws(() => scorerRequiredStages(["jefe"]), /rol desconocido/);
});

test("P1.5 scoreJob fuera de alcance → not-applicable (manual), sin LLM ni persistencia", async () => {
  const id = makeJob("job sin review para gate de aplicabilidad");
  addVerification(id, ["src/cambio.ts"]);
  const inputs = collectScorerInputs(id);
  assert.ok(inputs);
  assert.deepEqual(stagesForInputs(inputs), {
    review: false,
    implement: true,
    verification: true,
  });
  const { calls } = mockJudgeByScorer({ [REVIEW_SCORER]: "valido" });
  try {
    const out = await scoreJob(id, REVIEW_SCORER, { manual: true });
    // ORDEN: isNotApplicable ANTES que isUnscored (todo not-applicable es unscored).
    assert.equal(isNotApplicable(out), true);
    assert.equal(isUnscored(out), true);
    if (isNotApplicable(out)) {
      assert.equal(out.status, "not-applicable");
      assert.deepEqual(out.requiredStages, ["review"]);
      assert.match(out.reason, /no aplica/);
    }
    assert.equal(calls.get(REVIEW_SCORER) ?? 0, 0, "fuera de alcance: el juez no debe llamarse");
    assert.deepEqual(readScores(id), {}, "not-applicable no persiste nada");
    // Puente al contrato E2.
    assert.deepEqual(toScoreOutcome(out), {
      status: "not-applicable",
      requiredStages: ["review"],
    });
    assert.deepEqual(await scoreJobStatus(id, REVIEW_SCORER), {
      status: "not-applicable",
      requiredStages: ["review"],
    });
  } finally {
    setScorerPromptMock(null);
  }
});

test("P1.5 not-applicable no cuenta como failure en auto-score", async () => {
  resetJobs();
  // Id DENTRO de la muestra 25%: si cayera fuera, ningún scorer calificaría
  // y el test no probaría nada (sampling, no aplicabilidad).
  let sampledId = "";
  for (let i = 0; i < 500; i++) {
    const cand = `job-ag18-autoskip-${i}`;
    if (shouldSampleJob(cand, 25)) {
      sampledId = cand;
      break;
    }
  }
  assert.ok(sampledId, "debe existir un id dentro de la muestra 25%");
  const id = makeJobWithId(sampledId, "job sin review para auto-skip silencioso");
  addVerification(id, ["src/cambio.ts"]);
  const { calls } = mockJudgeByScorer({
    [REVIEW_SCORER]: "valido",
    [IMPL_SCORER]: "en-scope",
    [VERIF_SCORER]: "honesta",
  });
  try {
    await autoScoreCompletedJob(id);
    const scores = readScores(id);
    assert.ok(!(REVIEW_SCORER in scores), "el scorer fuera de alcance no deja score");
    assert.equal(calls.get(REVIEW_SCORER) ?? 0, 0);
    assert.ok(IMPL_SCORER in scores, "el scorer en alcance sí califica");
    // Sin failure del scorer de review para este job: el trigger P1.4 no lo ve.
    const mine = collectFailures(REVIEW_SCORER).filter((f) => f.workItemId === id);
    assert.deepEqual(mine, []);
  } finally {
    setScorerPromptMock(null);
  }
});

// ── yaml: improveProposalCooldown aditivo ──

test("yaml: improveProposalCooldown parsea, defaultea 1 y rechaza negativo", () => {
  const text = fs.readFileSync(
    path.join(process.cwd(), "factory", "factory.yaml"),
    "utf-8",
  );
  assert.equal(parseFactoryYaml(text).improveProposalCooldown, 1);
  assert.equal(
    parseFactoryYaml(`${text.replace("improveProposalCooldown: 1", "")}improveProposalCooldown: 0\n`)
      .improveProposalCooldown,
    0,
  );
  assert.throws(() =>
    parseFactoryYaml(`${text}improveProposalCooldown: -1\n`),
  );
  assert.throws(() =>
    parseFactoryYaml(`${text}improveProposalCooldown: mucho\n`),
  );
  assert.equal(getImproveProposalCooldown(), 1);
});

// ── P1.7: passing recomputado ──

test("P1.7 resolvePassing es la comparación canónica (borde inclusivo, fail-closed)", () => {
  assert.equal(resolvePassing(1, 0.5), true);
  assert.equal(resolvePassing(0.5, 0.5), true);
  assert.equal(resolvePassing(0.49, 0.5), false);
  assert.equal(resolvePassing(0, 0.5), false);
  assert.equal(resolvePassing(0, 0), true);
  assert.equal(resolvePassing(Number.NaN, 0.5), false);
  assert.equal(resolvePassing(1, Number.NaN), false);
});

test("P1.7 readScores re-etiqueta con el threshold actual; disco crudo intacto", async () => {
  const stalePass = makeJob("job con passing stale en disco");
  await persistSeed({
    id: stalePass,
    scorer: IMPL_SCORER,
    label: "en-scope",
    score: 1,
    passing: false, // stale: con threshold real 0.5 debería ser pass
  });
  const staleFail = makeJob("job con failing stale en disco");
  await persistSeed({
    id: staleFail,
    scorer: IMPL_SCORER,
    label: "fuera-de-scope",
    score: 0,
    passing: true, // stale: con threshold real 0.5 debería ser fail
  });
  assert.equal(readScores(stalePass)[IMPL_SCORER]?.passing, true);
  assert.equal(readScores(staleFail)[IMPL_SCORER]?.passing, false);
  for (const [id, expectedRaw] of [
    [stalePass, false],
    [staleFail, true],
  ] as const) {
    const wi = workItemStore.get(id);
    const dir = wi?.dir as string;
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "scores.json"), "utf-8")) as Record<
      string,
      { passing: boolean }
    >;
    assert.equal(raw[IMPL_SCORER]?.passing, expectedRaw, "el disco crudo no cambia tras relectura");
  }
  const summary = getScoresSummary();
  const entry = summary.scorers[IMPL_SCORER];
  assert.ok(entry && entry.scored >= 2);
  assert.equal(entry.passing + entry.failing, entry.scored);
});

test("P1.7 scoreJob persiste el passing canónico en ambos caminos", async () => {
  const id = makeJob("job para passing canónico del engine");
  addVerification(id, ["src/a.ts"]);
  const { calls } = mockJudgeByScorer({ [IMPL_SCORER]: "en-scope" });
  try {
    const first = await scoreJob(id, IMPL_SCORER, { manual: true });
    assert.equal(isNotApplicable(first), false);
    if (!isUnscored(first)) {
      assert.equal(first.passing, true);
      assert.deepEqual(toScoreOutcome(first), {
        status: "scored",
        label: "en-scope",
        score: 1,
        passing: true,
      });
    } else {
      assert.fail("se esperaba score, fue unscored");
    }
    setScorerPromptMock(async () =>
      JSON.stringify({ label: "fuera-de-scope", reason: "toco de mas" }),
    );
    const second = await scoreJob(id, IMPL_SCORER, { manual: true });
    if (!isUnscored(second)) {
      assert.equal(second.passing, false);
    } else {
      assert.fail("se esperaba score, fue unscored");
    }
    void calls;
  } finally {
    setScorerPromptMock(null);
  }
});

// ── P1.4: auto-propose ──

test("P1.4 flag true + 2 fails nuevos → propuesta creada con el mismo engine", async () => {
  cleanProposals();
  resetJobs();
  const failing1 = makeJob("revisar el modulo de pagos sin evidencia");
  await persistSeed({ id: failing1, scorer: REVIEW_SCORER, label: "infra-formato", score: 0, passing: false });
  const failing2 = makeJob("revisar el modulo de envios sin evidencia");
  await persistSeed({ id: failing2, scorer: REVIEW_SCORER, label: "infra-formato", score: 0, passing: false });
  mockValidAnalysis([failing1, failing2]);
  try {
    const before = new Set(sandboxFiles());
    const decision = await maybeAutoProposeForScorer(REVIEW_SCORER);
    assert.equal(decision.proposed, true);
    assert.ok(decision.proposalId);
    const proposal = readProposal(decision.proposalId!);
    assert.equal(proposal?.status, "ready");
    assert.equal(proposal?.scorer, REVIEW_SCORER);
    assert.equal(proposal?.target, "skills/code-review/SKILL.md");
    assert.ok(proposal?.regressionsAddressed.includes(failing1));
    assert.ok(proposal?.regressionsAddressed.includes(failing2));
    // Misma traza que manual: solo .proposals/*.json nuevos en el sandbox
    // (+ .notifications.json de Ola 19, centro aditivo proposal-ready).
    const after = sandboxFiles().filter((f) => !before.has(f));
    assert.ok(after.length > 0);
    for (const f of after) {
      const isProposal = f.startsWith(".proposals/") && f.endsWith(".json");
      const isNotifCenter = f === ".notifications.json";
      assert.ok(isProposal || isNotifCenter, `solo .proposals/*.json (+ .notifications.json Ola 19), fue ${f}`);
    }
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("P1.4 flag false → nada (scoring manual como hoy)", async () => {
  cleanProposals();
  resetJobs();
  const failing1 = makeJob("implement con extras ajenos al pedido uno");
  await persistSeed({ id: failing1, scorer: IMPL_SCORER, label: "fuera-de-scope", score: 0, passing: false });
  const failing2 = makeJob("implement con extras ajenos al pedido dos");
  await persistSeed({ id: failing2, scorer: IMPL_SCORER, label: "fuera-de-scope", score: 0, passing: false });
  mockValidAnalysis([failing1, failing2]);
  try {
    const decision = await maybeAutoProposeForScorer(IMPL_SCORER);
    assert.equal(decision.proposed, false);
    assert.match(decision.reason, /selfImprovement apagado/);
    assert.deepEqual(
      listProposals().filter((p) => p.scorer === IMPL_SCORER),
      [],
    );
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("P1.4 cooldown: propuesta abierta → nada", async () => {
  cleanProposals();
  resetJobs();
  const pending = createPendingProposal(REVIEW_SCORER);
  assert.equal(pending.status, "pending");
  const failing1 = makeJob("review flojo con propuesta ya abierta uno");
  await persistSeed({ id: failing1, scorer: REVIEW_SCORER, label: "infra-formato", score: 0, passing: false });
  const failing2 = makeJob("review flojo con propuesta ya abierta dos");
  await persistSeed({ id: failing2, scorer: REVIEW_SCORER, label: "infra-formato", score: 0, passing: false });
  mockValidAnalysis([failing1, failing2]);
  try {
    const decision = await maybeAutoProposeForScorer(REVIEW_SCORER);
    assert.equal(decision.proposed, false);
    assert.match(decision.reason, /cooldown/);
    assert.equal(
      listProposals().filter((p) => p.scorer === REVIEW_SCORER).length,
      1,
      "el cooldown impide la segunda propuesta (≤1 abierta por scorer)",
    );
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("P1.4 borde: 1 fail nuevo → nada", async () => {
  cleanProposals();
  resetJobs();
  const failing = makeJob("unico review flojo bajo el umbral");
  await persistSeed({ id: failing, scorer: REVIEW_SCORER, label: "infra-formato", score: 0, passing: false });
  mockValidAnalysis([failing]);
  try {
    const decision = await maybeAutoProposeForScorer(REVIEW_SCORER);
    assert.equal(decision.proposed, false);
    assert.match(decision.reason, /insuficientes/);
    assert.deepEqual(
      listProposals().filter((p) => p.scorer === REVIEW_SCORER),
      [],
    );
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("P1.4 fails viejos previos a la última propuesta → nada", async () => {
  cleanProposals();
  resetJobs();
  const old1 = makeJob("review flojo viejo uno");
  await persistSeed({
    id: old1,
    scorer: REVIEW_SCORER,
    label: "infra-formato",
    score: 0,
    passing: false,
    at: "2026-01-01T00:00:00.000Z",
  });
  const old2 = makeJob("review flojo viejo dos");
  await persistSeed({
    id: old2,
    scorer: REVIEW_SCORER,
    label: "infra-formato",
    score: 0,
    passing: false,
    at: "2026-01-01T00:00:00.000Z",
  });
  mockValidAnalysis([old1, old2]);
  try {
    const first = await createProposal(REVIEW_SCORER);
    assert.equal(first.status, "ready");
    const decision = await maybeAutoProposeForScorer(REVIEW_SCORER);
    assert.equal(decision.proposed, false);
    assert.match(decision.reason, /insuficientes|cooldown/);
    assert.equal(
      listProposals().filter((p) => p.scorer === REVIEW_SCORER).length,
      1,
      "los fails previos a la última propuesta no re-disparan",
    );
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("P1.4 autoScoreCompletedJob dispara el trigger (integración)", async () => {
  cleanProposals();
  resetJobs();
  const oldFail = makeJob("review flojo previo para integración");
  await persistSeed({ id: oldFail, scorer: REVIEW_SCORER, label: "infra-formato", score: 0, passing: false });
  let fullId = "";
  for (let i = 0; i < 500; i++) {
    const cand = `job-ag18-full-${i}`;
    if (shouldSampleJob(cand, 25)) {
      fullId = cand;
      break;
    }
  }
  assert.ok(fullId, "debe existir un id dentro de la muestra 25%");
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "agents-job-"));
  workItemStore.create({
    id: fullId,
    prompt: `job completo con review ${fullId}`,
    worktree,
    phase: "diagnosisLlm",
  });
  const wi = workItemStore.get(fullId);
  trackedJobs.push({ id: fullId, dir: (wi?.dir as string) ?? worktree });
  addVerification(fullId, ["src/cambio.ts"]);
  addReview(fullId, "accept");
  const { calls } = mockJudgeByScorer({
    [REVIEW_SCORER]: "infra-formato",
    [IMPL_SCORER]: "en-scope",
    [VERIF_SCORER]: "honesta",
  });
  mockValidAnalysis([oldFail, fullId]);
  try {
    await autoScoreCompletedJob(fullId);
    assert.ok((calls.get(REVIEW_SCORER) ?? 0) >= 1, "el scorer en alcance califica en auto");
    assert.equal(readScores(fullId)[REVIEW_SCORER]?.label, "infra-formato");
    const mine = listProposals().filter((p) => p.scorer === REVIEW_SCORER);
    assert.equal(mine.length, 1, "un auto-score crea como máximo 1 propuesta (cota)");
    assert.ok(mine[0].status === "ready" || mine[0].status === "failed");
    if (mine[0].status === "ready") {
      assert.ok(mine[0].regressionsAddressed.includes(oldFail));
      assert.ok(mine[0].regressionsAddressed.includes(fullId));
    }
  } finally {
    setScorerPromptMock(null);
    setAnalysisPromptMock(null);
  }
});
