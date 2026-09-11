/**
 * Ola 16 E2 — Migración a continuidad conversacional: implement y review
 * resumen su sesión UNA por (job, rol). Jueces (scorer) y análisis
 * (improvement) son STATELESS por diseño (fix #69): sesión fresca por
 * llamada, nunca reusan la del reviewer (reusarla contaminaba la
 * conversación con prompts de jueces incompatibles).
 *
 * Por cada uno de los 2 archivos con continuidad (implement, review), con
 * los seams existentes (setTestClient a nivel SDK + jobs reales en tmp;
 * mocks de prompt de alto nivel NO tocados y en null) y flag ON vía
 * override:
 * - 2 turnos mismo job+rol → creates=1 (reutilización).
 * - sesión muerta (prompt falla not-found una vez) → creates=2, sesión nueva
 *   guardada, evento "sesión renovada (la anterior expiró)" en timeline.
 * - flag OFF (override) → 2 turnos = 2 creates, nada guardado.
 * - fallo no-notfound → sin reintento de sesión (sin creates extra):
 *   implement → "" (su fallback de siempre), review → ask_human con el
 *   mensaje `review prompt fallo` de siempre, scorer → unscored con el
 *   mensaje `juez LLM falló` de siempre, improvement → draft `failed`.
 * Jueces/análisis (stateless):
 * - 2 llamadas mismo job → creates=2, sids distintos, nada guardado.
 * - not-found intra-llamada → 1 retry con sesión fresca (creates=2 en UNA
 *   llamada), sin evento de renovación persistente.
 * Además:
 * - improvement con failures mixtos usa la clave sintética `analysis/<scorer>`
 *   (solo memoria: el store la ignora best-effort) y también es stateless.
 * - test de guarda: implement y review importan y llaman
 *   `promptInAgentSession`; scorer e improvement son stateless a propósito
 *   (sesión fresca por llamada, importan `isSessionNotFoundError` y NO
 *   `promptInAgentSession`).
 *
 * Mocks del SDK solo en tests (fake client vía `setTestClient`); pacts
 * F01–F14 intactos (esta suite no toca endpoints).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAgentSession,
  setAgentSessionsOverrideForTests,
  resetAgentSessionsOverrideForTests,
  resetAgentSessionsMemoryForTests,
} from "../headless-runtime/sessions/agentSessions.ts";
import { setTestClient } from "../headless-runtime/opencodeServerManager.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { ImplementAgent } from "../headless-runtime/implement/implementAgent.ts";
import { ReviewAgent } from "../headless-runtime/review/reviewAgent.ts";
import {
  isUnscored,
  scoreJob,
} from "../headless-runtime/measure/scorerEngine.ts";
import {
  analyzeFailures,
  type FailureCase,
} from "../headless-runtime/measure/improvementEngine.ts";

type TestClientParam = Parameters<typeof setTestClient>[0];

let jobSeq = 0;
function freshJobId(tag: string): string {
  jobSeq += 1;
  return `job-e2-mig-${tag}-${jobSeq}`;
}

const tracked: Array<{ id: string; dirs: string[] }> = [];

function makeJob(id: string, worktree?: string): string {
  const wt =
    worktree ??
    fs.mkdtempSync(path.join(os.tmpdir(), "e2-mig-wt-"));
  workItemStore.create({ id, prompt: `hacer algo util ${id}`, worktree: wt });
  tracked.push({ id, dirs: [wt] });
  return wt;
}

/** Siembra inputs mínimos del juez: verification + createdFiles en timeline. */
function seedJudgeInputs(id: string): void {
  const now = new Date().toISOString();
  workItemStore.appendEvent(id, "runner", "verification pass", {
    verification: {
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
    },
    createdFiles: ["src/cambio.ts"],
    runnerId: "linux-build",
  } as unknown as Record<string, unknown>);
  // Ola-18 P1.5 (applicability gate): review-formato-valido declares
  // agents:{review} and requires a verdict (stages.review). Without it,
  // scoreJob short-circuits to not-applicable BEFORE any LLM call, so the
  // judge session tests exercise nothing (creates=0, deterministic 4/4
  // fail on the scorer block). The verdict is seeded with the SAME
  // production writer (setReview: lastReview + timeline event with
  // meta.review), without changing the job status.
  workItemStore.setReview(
    id,
    {
      workItemId: id,
      reviewerModel: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
      verdict: "accept",
      confidence: 0.9,
      summary: "Cambio mínimo correcto",
      findings: [],
      reviewAttempt: 1,
      reviewedAt: new Date().toISOString(),
    },
    0,
  );
}

// ── Fake client SDK ──

interface FakeState {
  creates: number;
  prompts: number;
  seenSids: string[];
  createImpl: (n: number) => Promise<unknown>;
  promptImpl: (sid: string, n: number) => Promise<unknown>;
}

function extractSid(arg: unknown): string {
  try {
    if (arg && typeof arg === "object") {
      const rec = arg as Record<string, unknown>;
      const pathObj = rec.path as Record<string, unknown> | undefined;
      if (pathObj && typeof pathObj.id === "string") return pathObj.id;
      if (typeof rec.sessionID === "string") return rec.sessionID;
    }
  } catch {
    // noop
  }
  return "?";
}

function installFake(state: FakeState): void {
  const client = {
    session: {
      create: async (_o: unknown): Promise<unknown> => {
        state.creates += 1;
        return state.createImpl(state.creates);
      },
      prompt: async (a: unknown, _b?: unknown): Promise<unknown> => {
        state.prompts += 1;
        const sid = extractSid(a);
        state.seenSids.push(sid);
        return state.promptImpl(sid, state.prompts);
      },
    },
  };
  setTestClient(client as unknown as TestClientParam);
}

function baseState(
  tag: string,
  promptImpl: (sid: string, n: number) => Promise<unknown>,
): FakeState {
  return {
    creates: 0,
    prompts: 0,
    seenSids: [],
    createImpl: async (n: number) => ({ id: `ses_e2_${tag}_${n}` }),
    promptImpl,
  };
}

function setupFlag(on: boolean): void {
  resetAgentSessionsMemoryForTests();
  setAgentSessionsOverrideForTests(on);
}

function teardown(): void {
  try {
    setTestClient(null);
  } catch {
    // best-effort
  }
  resetAgentSessionsOverrideForTests();
  resetAgentSessionsMemoryForTests();
}

test.after(() => {
  teardown();
  for (const { id, dirs } of tracked) {
    if (id) {
      try {
        workItemStore.delete(id);
      } catch {
        // best-effort
      }
    }
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
  tracked.length = 0;
});

function timelineHasRenewal(id: string, role: string): void {
  // El evento puede no ser el ÚLTIMO (el wrap de costo de Ola 15 agrega su
  // evento `cost:` después del 2º prompt): se busca en todo el timeline.
  const item = workItemStore.get(id);
  assert.ok(item, "el job debe existir");
  const found = (item?.timeline ?? []).find((e) =>
    String(e?.message ?? "").includes("sesión renovada (la anterior expiró)"),
  );
  const msg = String(found?.message ?? "");
  assert.ok(found, "timeline debe llevar el evento exacto de renovación");
  assert.equal(found?.actor, "system", "el evento lo emite system");
  assert.ok(msg.includes(role), `el evento debe nombrar el rol ${role} (fue: ${msg})`);
}

// ── Payloads válidos para los fakes ──

const REVIEW_OK = JSON.stringify({
  verdict: "accept",
  confidence: 0.9,
  summary: "Cambio mínimo correcto",
  findings: [],
});

const SCORER_OK = JSON.stringify({ label: "valido", reason: "veredicto accept parseable" });

function analysisOk(jobIds: string[]): string {
  return JSON.stringify({
    pattern: "patron comun de prueba",
    target: "skills/code-review/SKILL.md",
    rationale: "endurecer la regla corrige el patron",
    newContent: "# Code Review (propuesto)\n\nRegla de prueba.\n",
    regressionsAddressed: jobIds,
  });
}

function mkFailure(id: string): FailureCase {
  return {
    workItemId: id,
    scorer: "review-formato-valido",
    label: "infra-formato",
    reason: "sin veredicto registrado",
    at: new Date().toISOString(),
    promptPreview: "hacer algo",
  };
}

// ══ implement (rol "implement", jobId = ImplementInput.id) ══

test("implement: 2 turnos mismo job reutilizan la sesión (creates=1)", async () => {
  setupFlag(true);
  const id = freshJobId("impl");
  const wt = makeJob(id);
  fs.writeFileSync(path.join(wt, "package.json"), '{"name":"x"}\n', "utf-8");
  const state = baseState("impl", async () => "texto llm de prueba");
  installFake(state);
  try {
    const agent = new ImplementAgent();
    const input = { id, prompt: "crear archivo docs/nota.md", worktreePath: wt };
    const t1 = await agent.generateMinimalPatch(input);
    assert.ok(t1.length > 0, "el 1er turno debe traer texto");
    const t2 = await agent.generateMinimalPatch(input);
    assert.ok(t2.length > 0, "el 2º turno debe traer texto");
    assert.equal(state.creates, 1, "el 2º turno NO debe crear sesión");
    assert.deepEqual(state.seenSids, ["ses_e2_impl_1", "ses_e2_impl_1"]);
    assert.equal(getAgentSession(id, "implement"), "ses_e2_impl_1");
  } finally {
    teardown();
  }
});

test("implement: sesión muerta → creates=2, renueva y retorna el 2º texto", async () => {
  setupFlag(true);
  const id = freshJobId("implm");
  const wt = makeJob(id);
  fs.writeFileSync(path.join(wt, "package.json"), '{"name":"x"}\n', "utf-8");
  let warmed = false;
  const state = baseState("implm", async (sid: string) => {
    // Turno 1 OK (calienta); desde el turno 2 la sesión vieja está muerta.
    if (!warmed) {
      warmed = true;
      return "primer texto";
    }
    if (sid === "ses_e2_implm_1") throw new Error("session not found: ses_e2_implm_1");
    return "texto renovado";
  });
  installFake(state);
  try {
    const agent = new ImplementAgent();
    const input = { id, prompt: "crear archivo docs/nota.md", worktreePath: wt };
    const t1 = await agent.generateMinimalPatch(input);
    assert.ok(t1.length > 0);
    const t2 = await agent.generateMinimalPatch(input);
    assert.equal(state.creates, 2, "exactamente 1 create + 1 de renovación");
    assert.equal(t2, "texto renovado", "se retorna el prompt de la sesión nueva");
    assert.equal(getAgentSession(id, "implement"), "ses_e2_implm_2");
    timelineHasRenewal(id, "implement");
  } finally {
    teardown();
  }
});

test("implement: flag OFF → 2 turnos = 2 creates, nada guardado", async () => {
  setupFlag(false);
  const id = freshJobId("imploff");
  const wt = makeJob(id);
  fs.writeFileSync(path.join(wt, "package.json"), '{"name":"x"}\n', "utf-8");
  const state = baseState("imploff", async () => "texto");
  installFake(state);
  try {
    const agent = new ImplementAgent();
    const input = { id, prompt: "crear archivo docs/nota.md", worktreePath: wt };
    await agent.generateMinimalPatch(input);
    await agent.generateMinimalPatch(input);
    assert.equal(state.creates, 2, "apagado = sesión nueva por llamada");
    assert.equal(getAgentSession(id, "implement"), null, "apagado = nada guardado");
  } finally {
    teardown();
  }
});

test("implement: fallo no-notfound → '' sin reintento (su fallback de siempre)", async () => {
  setupFlag(true);
  const id = freshJobId("implfail");
  const wt = makeJob(id);
  fs.writeFileSync(path.join(wt, "package.json"), '{"name":"x"}\n', "utf-8");
  const state = baseState("implfail", async () => {
    throw new Error("boom 500 interno");
  });
  installFake(state);
  try {
    const agent = new ImplementAgent();
    const out = await agent.generateMinimalPatch({
      id,
      prompt: "crear archivo docs/nota.md",
      worktreePath: wt,
    });
    assert.equal(out, "", "fallo total = '' como antes (el caller aplica fallback)");
    assert.equal(state.creates, 1, "cero reintentos de sesión ante fallo no-notfound");
  } finally {
    teardown();
  }
});

// ══ review (rol "review", wrap POR INTENTO) ══

function reviewInput(id: string, wt: string): Parameters<ReviewAgent["consume"]>[0] {
  return {
    workItemId: id,
    worktreePath: wt,
    reviewerModel: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    reviewAttempt: 1,
    prompt: "revisar cambio mínimo",
  };
}

test("review: 2 turnos mismo job reutilizan la sesión (creates=1)", async () => {
  setupFlag(true);
  const id = freshJobId("rev");
  const wt = makeJob(id);
  const state = baseState("rev", async () => REVIEW_OK);
  installFake(state);
  try {
    const agent = new ReviewAgent();
    const r1 = await agent.consume(reviewInput(id, wt));
    assert.equal(r1.result.verdict, "accept");
    const r2 = await agent.consume(reviewInput(id, wt));
    assert.equal(r2.result.verdict, "accept");
    assert.equal(state.creates, 1, "el 2º turno NO debe crear sesión");
    assert.ok(state.seenSids.length >= 2);
    assert.ok(state.seenSids.every((s) => s === "ses_e2_rev_1"), "todos los prompts en la misma sesión");
    assert.equal(getAgentSession(id, "review"), "ses_e2_rev_1");
  } finally {
    teardown();
  }
});

test("review: sesión muerta → creates=2, renueva con evento visible", async () => {
  setupFlag(true);
  const id = freshJobId("revm");
  const wt = makeJob(id);
  let warmed = false;
  const state = baseState("revm", async (sid: string) => {
    if (!warmed) {
      warmed = true;
      return REVIEW_OK;
    }
    if (sid === "ses_e2_revm_1") throw new Error("session not found: ses_e2_revm_1");
    return REVIEW_OK;
  });
  installFake(state);
  try {
    const agent = new ReviewAgent();
    const r1 = await agent.consume(reviewInput(id, wt));
    assert.equal(r1.result.verdict, "accept");
    const r2 = await agent.consume(reviewInput(id, wt));
    assert.equal(r2.result.verdict, "accept", "el re-review decide igual (solo cambia DÓNDE habla)");
    assert.equal(state.creates, 2, "exactamente 1 create + 1 de renovación");
    assert.equal(getAgentSession(id, "review"), "ses_e2_revm_2");
    timelineHasRenewal(id, "review");
  } finally {
    teardown();
  }
});

test("review: flag OFF → 2 turnos = 2 creates, nada guardado", async () => {
  setupFlag(false);
  const id = freshJobId("revoff");
  const wt = makeJob(id);
  const state = baseState("revoff", async () => REVIEW_OK);
  installFake(state);
  try {
    const agent = new ReviewAgent();
    await agent.consume(reviewInput(id, wt));
    await agent.consume(reviewInput(id, wt));
    assert.equal(state.creates, 2, "apagado = sesión nueva por llamada");
    assert.equal(getAgentSession(id, "review"), null, "apagado = nada guardado");
  } finally {
    teardown();
  }
});

test("review: fallo no-notfound → ask_human `review prompt fallo` sin reintento", async () => {
  setupFlag(true);
  const id = freshJobId("revfail");
  const wt = makeJob(id);
  const state = baseState("revfail", async () => {
    throw new Error("boom 500 interno");
  });
  installFake(state);
  try {
    const agent = new ReviewAgent();
    const out = await agent.consume(reviewInput(id, wt));
    assert.equal(out.result.verdict, "ask_human", "el veredicto de fallo no cambia");
    assert.ok(
      out.result.summary.includes("review prompt fallo"),
      `mensaje de siempre byte a byte (fue: ${out.result.summary})`,
    );
    assert.equal(state.creates, 1, "cero reintentos de sesión ante fallo no-notfound");
  } finally {
    teardown();
  }
});

// ══ scorer/juez STATELESS (fix #69: nunca reusar la sesión del reviewer) ══

test("scorer: stateless, 2 turnos mismo job = 2 creates, sids distintos, nada guardado", async () => {
  setupFlag(true);
  const id = freshJobId("sco");
  makeJob(id);
  seedJudgeInputs(id);
  const state = baseState("sco", async () => SCORER_OK);
  installFake(state);
  try {
    const r1 = await scoreJob(id, "review-formato-valido", { manual: true });
    assert.ok(!isUnscored(r1), `el 1er turno debe scorar (fue: ${JSON.stringify(r1)})`);
    const r2 = await scoreJob(id, "review-formato-valido", { manual: true });
    assert.ok(!isUnscored(r2), "el 2º turno debe scorar");
    assert.equal(state.creates, 2, "stateless: cada llamada crea su sesión");
    assert.equal(new Set(state.seenSids).size, 2, "sids distintos por llamada (sin contaminación)");
    assert.equal(getAgentSession(id, "review"), null, "el juez no pisa la sesión del reviewer");
  } finally {
    teardown();
  }
});

test("scorer: not-found intra-llamada → 1 retry con sesión fresca (creates=2 en UNA llamada)", async () => {
  setupFlag(true);
  const id = freshJobId("scom");
  makeJob(id);
  seedJudgeInputs(id);
  let calls = 0;
  const state = baseState("scom", async (_sid: string) => {
    calls += 1;
    if (calls === 1) throw new Error("session not found: efímera del juez");
    return SCORER_OK;
  });
  installFake(state);
  try {
    const r1 = await scoreJob(id, "review-formato-valido", { manual: true });
    assert.ok(!isUnscored(r1), "tras el retry, el juez califica igual");
    if (!isUnscored(r1)) assert.equal(r1.label, "valido");
    assert.equal(state.creates, 2, "exactamente 1 create + 1 de retry");
    assert.equal(getAgentSession(id, "review"), null, "el retry tampoco guarda nada");
  } finally {
    teardown();
  }
});

test("scorer: flag OFF → 2 turnos = 2 creates, nada guardado", async () => {
  setupFlag(false);
  const id = freshJobId("scooff");
  makeJob(id);
  seedJudgeInputs(id);
  const state = baseState("scooff", async () => SCORER_OK);
  installFake(state);
  try {
    await scoreJob(id, "review-formato-valido", { manual: true });
    await scoreJob(id, "review-formato-valido", { manual: true });
    assert.equal(state.creates, 2, "apagado = sesión nueva por llamada");
    assert.equal(getAgentSession(id, "review"), null, "apagado = nada guardado");
  } finally {
    teardown();
  }
});

test("scorer: fallo no-notfound → unscored `juez LLM falló` sin reintento", async () => {
  setupFlag(true);
  const id = freshJobId("scofail");
  makeJob(id);
  seedJudgeInputs(id);
  const state = baseState("scofail", async () => {
    throw new Error("boom 500 interno");
  });
  installFake(state);
  try {
    const out = await scoreJob(id, "review-formato-valido", { manual: true });
    assert.ok(isUnscored(out), "el fallo no inventa score");
    if (isUnscored(out)) {
      assert.ok(
        out.reason.includes("juez LLM falló"),
        `mensaje de siempre (fue: ${out.reason})`,
      );
    }
    assert.equal(state.creates, 1, "cero reintentos de sesión ante fallo no-notfound");
  } finally {
    teardown();
  }
});

// ══ improvement/análisis (rol "review", key = resolveAnalysisCostKey) ══

test("improvement unánime: stateless, 2 análisis = 2 creates, sids distintos, nada guardado", async () => {
  setupFlag(true);
  const id = freshJobId("ana");
  makeJob(id);
  const failures = [mkFailure(id), mkFailure(id)];
  const state = baseState("ana", async () => analysisOk([id]));
  installFake(state);
  try {
    const d1 = await analyzeFailures("review-formato-valido", failures);
    assert.equal(d1.status, "ready");
    const d2 = await analyzeFailures("review-formato-valido", failures);
    assert.equal(d2.status, "ready");
    assert.equal(state.creates, 2, "stateless: cada análisis crea su sesión");
    assert.equal(new Set(state.seenSids).size, 2, "sids distintos por llamada");
    // Unánime usa el jobId real como costKey, pero la sesión NO se guarda:
    // el análisis no pisa la sesión del reviewer.
    assert.equal(getAgentSession(id, "review"), null);
  } finally {
    teardown();
  }
});

test("improvement unánime: not-found intra-llamada → 1 retry con sesión fresca", async () => {
  setupFlag(true);
  const id = freshJobId("anam");
  makeJob(id);
  const failures = [mkFailure(id), mkFailure(id)];
  let calls = 0;
  const state = baseState("anam", async (_sid: string) => {
    calls += 1;
    if (calls === 1) throw new Error("session not found: efímera del análisis");
    return analysisOk([id]);
  });
  installFake(state);
  try {
    const d1 = await analyzeFailures("review-formato-valido", failures);
    assert.equal(d1.status, "ready", "tras el retry, el análisis propone igual");
    assert.equal(state.creates, 2, "exactamente 1 create + 1 de retry");
    assert.equal(getAgentSession(id, "review"), null, "el retry tampoco guarda nada");
  } finally {
    teardown();
  }
});

test("improvement: flag OFF → 2 análisis = 2 creates, nada guardado", async () => {
  setupFlag(false);
  const id = freshJobId("anaoff");
  makeJob(id);
  const failures = [mkFailure(id), mkFailure(id)];
  const state = baseState("anaoff", async () => analysisOk([id]));
  installFake(state);
  try {
    await analyzeFailures("review-formato-valido", failures);
    await analyzeFailures("review-formato-valido", failures);
    assert.equal(state.creates, 2, "apagado = sesión nueva por llamada");
    assert.equal(getAgentSession(id, "review"), null, "apagado = nada guardado");
  } finally {
    teardown();
  }
});

test("improvement: fallo no-notfound → draft `failed` sin reintento", async () => {
  setupFlag(true);
  const id = freshJobId("anafail");
  makeJob(id);
  const failures = [mkFailure(id), mkFailure(id)];
  const state = baseState("anafail", async () => {
    throw new Error("boom 500 interno");
  });
  installFake(state);
  try {
    const draft = await analyzeFailures("review-formato-valido", failures);
    assert.equal(draft.status, "failed", "el fallo no inventa propuesta");
    assert.ok(
      (draft.failureReason ?? "").includes("boom 500"),
      `la causa viaja visible (fue: ${draft.failureReason})`,
    );
    assert.equal(state.creates, 1, "cero reintentos de sesión ante fallo no-notfound");
  } finally {
    teardown();
  }
});

test("improvement mixto: clave sintética `analysis/<scorer>` stateless, nada guardado", async () => {
  setupFlag(true);
  // Los jobs mixtos NO se crean en el store: la clave sintética no persiste.
  const idA = freshJobId("mixA");
  const idB = freshJobId("mixB");
  const failures = [mkFailure(idA), mkFailure(idB)];
  const state = baseState("mix", async () => analysisOk([idA, idB]));
  installFake(state);
  try {
    const d1 = await analyzeFailures("review-formato-valido", failures);
    assert.equal(d1.status, "ready");
    const d2 = await analyzeFailures("review-formato-valido", failures);
    assert.equal(d2.status, "ready");
    assert.equal(state.creates, 2, "stateless: cada análisis crea su sesión");
    assert.equal(
      getAgentSession("analysis/review-formato-valido", "review"),
      null,
      "stateless: nada guardado ni siquiera en memoria",
    );
    assert.equal(workItemStore.get("analysis/review-formato-valido"), undefined);
  } finally {
    teardown();
  }
});

// ── Guarda: cableado vivo (continuidad solo donde hay conversación) ──

test("guarda: implement y review usan promptInAgentSession; jueces/análisis son stateless", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const withContinuity = [
    "headless-runtime/implement/implementAgent.ts",
    "headless-runtime/review/reviewAgent.ts",
  ];
  for (const rel of withContinuity) {
    const text = fs.readFileSync(path.join(here, "..", rel), "utf-8");
    assert.ok(
      text.includes("promptInAgentSession"),
      `${rel} debe llamar promptInAgentSession`,
    );
  }
  // Jueces y análisis: sesión fresca por llamada (fix #69, no contaminar la
  // del reviewer). Importan el guard not-found para el retry, pero NUNCA el
  // helper de reuso.
  const stateless = [
    "headless-runtime/measure/scorerEngine.ts",
    "headless-runtime/measure/improvementEngine.ts",
  ];
  for (const rel of stateless) {
    const text = fs.readFileSync(path.join(here, "..", rel), "utf-8");
    assert.ok(
      text.includes("isSessionNotFoundError"),
      `${rel} debe importar el guard not-found para su retry`,
    );
    assert.ok(
      !text.includes("promptInAgentSession"),
      `${rel} NO debe reusar sesiones (stateless por fix #69)`,
    );
  }
});
