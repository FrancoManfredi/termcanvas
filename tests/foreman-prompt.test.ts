// Ola 6 H1: buildForemanPrompt sin literales de máquina; worktree vacío no bloquea.
// El LLM debe seguir orientando a building para prompts claros aunque el worktree venga vacío.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildForemanPrompt,
  parseForemanLLMResponse,
  mapDecisionToStatus,
} from "../headless-runtime/foreman/foremanPrompt.ts";

function baseInput(overrides: { prompt?: string; worktree?: string } = {}): {
  prompt: string;
  worktree: string;
} {
  return {
    prompt: "fix auth bug",
    worktree: "",
    ...overrides,
  };
}

test("worktree nunca viaja en el turno (vive en la sesión)", () => {
  const out = buildForemanPrompt(baseInput({ prompt: "agrega test para X", worktree: "" }));
  assert.ok(out.includes("agrega test para X"), "el issue viaja");
  assert.ok(!out.includes("Proyecto activo"), "sin línea de proyecto");
  assert.ok(!out.includes("no especificado"), "sin marca de worktree");
  const blank = buildForemanPrompt(baseInput({ worktree: "   " }));
  assert.ok(!blank.includes("no especificado"));
});

test("turno único de datos: issue + cierre, sin reglas ni header", () => {
  const out = buildForemanPrompt(
    baseInput({ prompt: "crear una carpeta en la raiz que se llame X", worktree: "" }),
  );
  assert.ok(out.includes('"crear una carpeta en la raiz que se llame X"'));
  assert.ok(out.includes("Decidí ahora en JSON"), "el cierre orienta");
  assert.ok(!out.includes("factory/agents/foreman/agent.md"), "sin header");
  assert.ok(!out.includes("Decidís UNA cosa"), "sin rol (vive en el espejo)");
  assert.ok(!out.includes("confidence 0.85"), "sin rangos (viven en el espejo)");
  assert.ok(!out.includes("ModelRef"), "sin modelRef");
});

test("cero literales de máquina y cero nombres propios de test en el prompt generado", () => {
  const cases = [
    baseInput({}),
    baseInput({ prompt: "crear una carpeta en la raiz que se llame X", worktree: "" }),
    baseInput({ prompt: "fix auth bug", worktree: "D:\\repos\\demo" }),
    baseInput({ prompt: "", worktree: "   " }),
  ];
  for (const input of cases) {
    const out = buildForemanPrompt(input);
    assert.ok(!/c:\\users/i.test(out), "sin rutas de perfil de máquina");
    assert.ok(!/estudiante ucu/i.test(out), "sin nombre de usuario de máquina");
    assert.ok(!/c:\\tmp/i.test(out), "sin rutas temporales de máquina");
    assert.ok(!/\bhola mundo\b/i.test(out), "sin ejemplo con nombre propio de test");
    assert.ok(!/\bcarepta\b/i.test(out), "sin typo carepta");
    assert.ok(!/\bcarpta\b/i.test(out), "sin typo carpta");
  }
});

test("sin ejemplos bakeados (viven en el espejo)", () => {
  const out = buildForemanPrompt(baseInput({ worktree: "" }));
  assert.ok(!out.includes("docs/demo.md"), "sin ejemplos del baked");
  assert.ok(out.includes("fix auth bug"), "el issue del input viaja");
  assert.ok(out.length < 800, `turno mínimo, son ${out.length} chars`);
});

test("worktree informado tampoco viaja (lo lleva la sesión)", () => {
  const wt = "D:\\repos\\demo";
  const out = buildForemanPrompt(baseInput({ worktree: wt }));
  assert.ok(!out.includes(wt));
  assert.ok(out.includes("fix auth bug"));
});

test("prompt vacío se marca como faltante (el needs_input lo decide el md)", () => {
  const out = buildForemanPrompt(baseInput({ prompt: "", worktree: "" }));
  assert.ok(out.includes("(vacío — falta prompt)"));
  assert.ok(!out.includes("needs_input"), "sin decisiones en el turno");
});

test("schema de decisión intacto: building/needs_triage/needs_input + reason + confidence", () => {
  const building = parseForemanLLMResponse(
    JSON.stringify({ decision: "building", reason: "claro y ejecutable", confidence: 0.9 }),
  );
  assert.equal(building.decision, "building");
  assert.equal(building.confidence, 0.9);

  const triage = parseForemanLLMResponse(
    '```json\n{"decision":"needs_triage","reason":"falta contexto","confidence":0.8}\n```',
  );
  assert.equal(triage.decision, "needs_triage");

  const input = parseForemanLLMResponse(
    'texto previo {"decision":"needs_input","reason":"falta prompt","confidence":0.85} texto posterior',
  );
  assert.equal(input.decision, "needs_input");

  assert.throws(() => parseForemanLLMResponse("sin json acá"), /no JSON object found|LLM JSON parse error/);
  assert.throws(() =>
    parseForemanLLMResponse(JSON.stringify({ decision: "building", reason: "x", confidence: 2 })),
  );
});

test("mapDecisionToStatus preserva pacts: building→Building, resto→Triage", () => {
  assert.equal(mapDecisionToStatus("building"), "Building");
  assert.equal(mapDecisionToStatus("needs_triage"), "Triage");
  assert.equal(mapDecisionToStatus("needs_input"), "Triage");
});

test("solo issue + contexto + cierre, sin reglas (el agente las aporta)", () => {
  const out = buildForemanPrompt(
    baseInput({ prompt: "fix auth bug", worktree: "" }),
    undefined,
    undefined,
  );
  assert.ok(out.includes("fix auth bug"), "el issue viaja");
  assert.ok(!out.includes("Proyecto activo"), "sin línea de proyecto (la sesión ya abre ahí)");
  assert.ok(out.includes("Decidí ahora en JSON"), "el cierre orienta sin dos puntos");
  assert.ok(!out.includes("factory/agents/foreman/agent.md"), "sin header versionado");
  assert.ok(!out.includes("Sos el Foreman"), "sin rol duplicado");
  assert.ok(!out.includes("needs_triage"), "sin rúbrica (vive en el espejo)");
  assert.ok(!out.includes("docs/demo.md"), "sin ejemplos");
});

test("retira el SCOPE canónico y deja el issue", () => {
  const prompt =
    `issue con criterios\n\n## SCOPE\n` +
    `Implement only what this issue asks for. Do not add features outside its scope and do not skip its no-goals.\n` +
    `Work in the issue worktree. NEVER open a pull request, push, or commit: the orchestrator creates the PR automatically (body "Closes #86"). Leave all changes uncommitted in the worktree.`;
  const out = buildForemanPrompt(baseInput({ prompt, worktree: "" }), undefined, undefined);
  assert.ok(out.includes("issue con criterios"));
  assert.ok(!out.includes("Implement only what this issue asks for"));
  assert.ok(!out.includes("NEVER open a pull request"));
  assert.ok(!out.match(/^## SCOPE\s*$/m));
});

test("preserva contexto repo cuando hay", () => {
  const out = buildForemanPrompt(
    baseInput({ prompt: "x", worktree: "" }),
    "ARCHIVO=todo.ts",
    undefined,
  );
  assert.ok(out.includes("ARCHIVO=todo.ts"));
});

test("triage/spec previos viajan como contexto cuando hay", () => {
  const out = buildForemanPrompt(
    baseInput({}),
    undefined,
    {
      triage: { decision: "building", scope: "auth", complexity: "simple", openQuestions: [], reason: "claro", confidence: 0.9 },
    },
  );
  assert.ok(out.includes("Triage previo"));
  assert.ok(out.includes("fix auth bug"));
});
