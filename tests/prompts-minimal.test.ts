/**
 * F14 — Mensajes MÍNIMOS del pipeline oficial: tarea + issue #/URL, sin
 * repetir el pedido completo en cada nodo, sin artefactos de test y con el
 * contrato de salida en el mensaje (no en el agent.md).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  factoryDefaultRunInputs,
  issueBodyInputText,
  runInputsForWorkflowDef,
} from "../headless-runtime/factory/engineBridge.ts";
import { loadWorkflow } from "../headless-runtime/workflows/loader.ts";
import { loadAgentDef } from "../headless-runtime/factory/agentLoader.ts";
import { selectWorkflowForItem } from "../headless-runtime/workflows/workflowRouter.ts";
import type { AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS = path.join(REPO, "factory", "workflows", "factory-default", "commands");

function readCommand(name: string): string {
  return fs.readFileSync(path.join(COMMANDS, `${name}.md`), "utf-8");
}

test("input issue_ref: viaja cuando hay issue y cae al default cuando no", () => {
  const withIssue = factoryDefaultRunInputs("tarea", "job-1", "#93 — https://x/93", "cuerpo 93");
  assert.equal(withIssue.request, "tarea");
  assert.equal(withIssue.workItemId, "job-1");
  assert.equal(withIssue.issue_ref, "#93 — https://x/93");
  assert.equal(withIssue.issue_body, "cuerpo 93");

  const without = factoryDefaultRunInputs("tarea", "job-1");
  assert.equal("issue_ref" in without, false, "sin issue no se inventa el dato");
  assert.equal("issue_body" in without, false, "sin cuerpo no se inventa el dato");

  const loaded = loadWorkflow("factory-default", { repoRoot: REPO });
  const resolved = runInputsForWorkflowDef(
    loaded.def,
    "tarea",
    "job-2",
    "#7 — https://x/7",
    "cuerpo 7",
  );
  assert.ok(resolved);
  assert.equal(resolved.issue_ref, "#7 — https://x/7");
  assert.equal(resolved.issue_body, "cuerpo 7");

  const fallback = runInputsForWorkflowDef(loaded.def, "tarea", "job-3");
  assert.ok(fallback);
  assert.equal(fallback.issue_ref, "(sin issue vinculado)", "default del def aplicado");
  assert.equal(fallback.issue_body, "(sin cuerpo disponible)", "default del body aplicado");
});

test("issueBodyInputText: extrae ## ORIGINAL BODY acotado, vacío sin sección", () => {
  const prompt = [
    "# Resolve issue #92 — Doc",
    "",
    "## ISSUE",
    "- URL: https://x/92",
    "",
    "## ORIGINAL BODY",
    "Body real.",
    "",
    "## SCOPE",
    "reglas de orquestador",
  ].join("\n");
  assert.equal(issueBodyInputText(prompt), "Body real.");
  assert.equal(issueBodyInputText("arreglar login"), "");
  assert.equal(issueBodyInputText(""), "");
  const long = `## ORIGINAL BODY\n${"x".repeat(5000)}`;
  assert.equal(issueBodyInputText(long).length, 2000, "cap 2000 como PROMPT_BODY_MAX");
});

test("commands mínimos: solo triage lleva el pedido completo", () => {
  const triage = readCommand("triage");
  assert.match(triage, /\$INPUTS\.issue_ref/, "triage muestra el issue");
  assert.match(triage, /\$INPUTS\.request/, "triage lleva el pedido");
  assert.match(triage, /\$INPUTS\.issue_body/, "triage lleva el cuerpo pegado");

  for (const name of ["spec", "implement", "review"]) {
    const text = readCommand(name);
    assert.equal(
      text.includes("$INPUTS.request"),
      false,
      `${name}: sin repetir el pedido completo`,
    );
    assert.match(text, /\$INPUTS\.issue_body/, `${name}: cuerpo pegado sin fetchear URL`);
    assert.ok(text.trim().length > 0, `${name}: no vacío`);
  }
  assert.match(readCommand("review"), /green/, "el contrato {green,findings} vive en el mensaje");
  assert.match(readCommand("spec"), /\$triage\.output/, "spec encadena el triage");
});

test("agent.md: sin artefactos de test, sin reverify muerto, contrato en el mensaje", () => {
  for (const name of ["foreman", "triage", "spec", "implement", "review"]) {
    const def = loadAgentDef(name);
    assert.ok(def, `${name} existe`);
    assert.doesNotMatch(def.body, /Platano/i, `${name}: sin artefacto de test`);
    assert.equal(def.frontmatter.mode, "primary", `${name}: primario`);
  }
  const review = loadAgentDef("review");
  assert.ok(review);
  assert.match(review.body, /reverify/i, "review: reverify system-owned documentado");
  assert.match(
    review.body,
    /sistema/i,
    "review: el reverify read-only lo ejecuta el sistema",
  );
  assert.match(
    review.body,
    /formato exacto/i,
    "review: el formato de salida lo define el mensaje",
  );
});

test("agent.md: el contrato máquina vive en el turno, no en el body", () => {
  const review = loadAgentDef("review");
  assert.ok(review);
  assert.doesNotMatch(review.body, /"green"/, "review: sin keys del engine en el body");
  assert.doesNotMatch(review.body, /"verdict"/, "review: sin keys legacy en el body");
  const triage = loadAgentDef("triage");
  assert.ok(triage);
  assert.doesNotMatch(triage.body, /"decision"/, "triage: sin keys en el body");
  const spec = loadAgentDef("spec");
  assert.ok(spec);
  assert.doesNotMatch(spec.body, /"acceptanceCriteria"/, "spec: sin keys en el body");
  assert.doesNotMatch(spec.body, /"summary"/, "spec: sin keys del plan en el body");
  assert.doesNotMatch(
    spec.body,
    /\{"summary"/,
    "spec: sin shape JSON propio en el body",
  );
  assert.doesNotMatch(
    spec.body,
    /```json/,
    "spec: sin bloques JSON en el body (regresión ed63630d)",
  );
  assert.match(
    spec.body,
    /formato de cierre lo define el mensaje/i,
    "spec: el formato de salida lo define el mensaje del nodo",
  );
  assert.doesNotMatch(
    spec.body,
    /Respondé con una spec breve que incluya/,
    "spec: sin lista de secciones obligatorias como formato",
  );
  const implement = loadAgentDef("implement");
  assert.ok(implement);
  assert.doesNotMatch(implement.body, /```json/, "implement: sin bloques JSON en el body");
});

test("fix-issue minimal: issue_ref + tarea una vez + review JSON", () => {
  const wf = loadWorkflow("fix-issue", { repoRoot: REPO }).def;
  const all = wf.nodes.flatMap((n) => [n, ...(n.loop_group?.nodes ?? [])]);
  const byId = (id: string) => all.find((n) => n.id === id);
  const triage = byId("triage")?.prompt ?? "";
  assert.match(triage, /\$INPUTS\.issue_ref/);
  assert.match(triage, /\$INPUTS\.request/);
  assert.match(triage, /\$INPUTS\.issue_body/, "cuerpo pegado en triage");

  const implement = byId("implement")?.prompt ?? "";
  assert.equal(implement.includes("$INPUTS.request"), false, "sin repetir el pedido");
  assert.match(implement, /\$INPUTS\.issue_ref/);
  assert.match(implement, /\$INPUTS\.issue_body/, "cuerpo pegado en implement");
  assert.match(implement, /\$triage\.output/);
  assert.equal(
    implement.includes("$LOOP_PREV"),
    false,
    "findings por ronda: los inyecta el historial del engine",
  );

  const review = byId("review");
  assert.ok(review?.output_format, "review con output_format");
  const reviewFormat = review?.output_format as {
    properties?: { findings?: { type?: string } };
  };
  assert.equal(
    reviewFormat.properties?.findings?.type,
    "array",
    "findings estructurados",
  );
  assert.match(review?.prompt ?? "", /green/);
  assert.match(review?.prompt ?? "", /\$INPUTS\.issue_body/, "cuerpo pegado en review");
  assert.match(review?.prompt ?? "", /\$triage\.output/, "review juzga contra el triaje");
  assert.equal(wf.returns, "build", "returns al grupo del loop");
  assert.equal(wf.outcome_field, "green");
  for (const node of all) {
    assert.equal(
      (node.prompt ?? "").includes("## SCOPE"),
      false,
      `${node.id}: sin bloque SCOPE`,
    );
  }
});

test("plan-approve-implement minimal: plan con issue_ref, implement sin pedido completo", () => {
  const wf = loadWorkflow("plan-approve-implement", { repoRoot: REPO }).def;
  const all = wf.nodes.flatMap((n) => [n, ...(n.loop_group?.nodes ?? [])]);
  const byId = (id: string) => all.find((n) => n.id === id);
  const planCommand = fs.readFileSync(
    path.join(REPO, "factory", "workflows", "plan-approve-implement", "commands", "plan-request.md"),
    "utf-8",
  );
  assert.match(planCommand, /\$INPUTS\.issue_ref/);
  assert.match(planCommand, /\$INPUTS\.request/);
  assert.match(planCommand, /\$INPUTS\.issue_body/, "plan lleva el cuerpo pegado");
  assert.match(planCommand, /JSON/i, "plan: contrato JSON en el mensaje");
  assert.match(planCommand, /summary/, "plan: key summary en el contrato");
  assert.match(planCommand, /steps/, "plan: key steps en el contrato");
  assert.match(
    planCommand,
    /sin prosa/i,
    "plan: cierre JSON-only (sin prosa fuera del objeto)",
  );
  assert.match(
    planCommand,
    /nada fuera del objeto/i,
    "plan: prohibido agregar markdown alrededor del JSON",
  );

  const implement = byId("implement")?.prompt ?? "";
  assert.equal(implement.includes("$INPUTS.request"), false, "sin repetir el pedido");
  assert.match(implement, /\$INPUTS\.issue_ref/);
  assert.match(implement, /\$INPUTS\.issue_body/, "cuerpo pegado en implement");
  assert.match(implement, /\$plan\.output/);
  assert.equal(
    implement.includes("$LOOP_PREV"),
    false,
    "findings por ronda: los inyecta el historial del engine",
  );

  const review = byId("review");
  assert.ok(review?.output_format, "review con output_format");
  const reviewFormat = review?.output_format as {
    properties?: { findings?: { type?: string } };
  };
  assert.equal(
    reviewFormat.properties?.findings?.type,
    "array",
    "findings estructurados",
  );
  assert.match(review?.prompt ?? "", /green/);
  assert.match(review?.prompt ?? "", /\$INPUTS\.issue_body/, "cuerpo pegado en review");
  assert.equal(wf.returns, "build", "returns al grupo del loop");
  assert.equal(wf.outcome_field, "green");
});

test("router: issue_ref presente y bloque SCOPE fuera del prompt", async () => {  let captured = "";
  const runner: AiNodeRunner = async (req) => {
    captured = req.prompt;
    return { output: '{"workflow":"factory-default","reason":"test"}' };
  };
  const route = await selectWorkflowForItem({
    itemId: "job-router-min",
    prompt:
      "# Resolve issue #92 — Doc\n\n## ISSUE\n- URL: https://x/92\n\n## ORIGINAL BODY\nBody.\n\n## SCOPE\nImplement only what this issue asks for.",
    worktree: REPO,
    repoRoot: REPO,
    issueText: "#92 — https://x/92",
    runner,
  });
  assert.equal(route.workflow, "factory-default");
  assert.match(captured, /Issue: #92 — https:\/\/x\/92/);
  assert.ok(captured.includes("Body."), "la tarea viaja");
  assert.equal(captured.includes("## SCOPE"), false, "SCOPE fuera del ruteo");
  assert.equal(captured.includes("Implement only what this issue asks for"), false);
});

test("p4: spec enriquecida slim (outcome/invariant/evidence/gate, sin JSON)", () => {
  const spec = readCommand("spec");
  for (const anchor of ["Outcome", "Invariant", "Success signal", "Evidence"]) {
    assert.match(spec, new RegExp(anchor), `spec command: ${anchor}`);
  }
  assert.match(spec, /Root cause/, "spec command: root cause solo bugs");
  assert.match(spec, /Mermaid/, "spec command: visual condicional");
  assert.match(spec, /Delivery considerations/, "spec command: delivery condicional");
  assert.match(spec, /DECISION NEEDED/, "spec command: design gate");
  assert.equal(spec.includes("$INPUTS.request"), false, "spec: sin repetir el pedido");

  const agent = loadAgentDef("spec");
  assert.ok(agent);
  assert.match(agent.body, /Outcome/, "spec agent: outcome");
  assert.match(agent.body, /Invariant/, "spec agent: invariante");
  assert.match(agent.body, /\{path:line\}/, "spec agent: evidencia con rutas reales");
  assert.match(agent.body, /DECISION NEEDED/, "spec agent: design gate");
  assert.doesNotMatch(agent.body, /"acceptanceCriteria"/, "spec agent: sin keys máquina");
});

test("p2: dispositions en el loop (estados terminales + IDs estables)", () => {
  const implement = readCommand("implement");
  assert.match(implement, /## Dispositions/, "implement command: sección");
  for (const state of ["FIXED", "NOT_A_FINDING", "TRACKED_FOLLOW_UP", "DECLINED"]) {
    assert.match(implement, new RegExp(state), `implement command: ${state}`);
  }
  assert.match(implement, /deferred/, "implement command: prohibido deferred pelado");

  const review = readCommand("review");
  assert.match(review, /conserva su ID|renumeres/, "review command: IDs estables");

  const reviewAgent = loadAgentDef("review");
  assert.ok(reviewAgent);
  assert.match(reviewAgent.body, /FIXED/, "review agent: taxonomía conocida");
  assert.match(reviewAgent.body, /renumeres/, "review agent: IDs estables");

  for (const name of ["fix-issue", "plan-approve-implement"]) {
    const wf = loadWorkflow(name, { repoRoot: REPO }).def;
    const all = wf.nodes.flatMap((n) => [n, ...(n.loop_group?.nodes ?? [])]);
    const byId = (id: string) => all.find((n) => n.id === id);
    assert.match(byId("implement")?.prompt ?? "", /Dispositions/, `${name}: implement dispone`);
    assert.match(byId("review")?.prompt ?? "", /renumeres/, `${name}: review preserva IDs`);
  }
});

test("p5: veredicto de contrato del triage (READY/BLOCKED/ESCALATE)", () => {
  const triage = readCommand("triage");
  assert.match(triage, /Contract:/, "triage command: línea de veredicto");
  for (const v of ["READY", "NEEDS_CONTRACT_WORK", "BLOCKED", "NO_ACTION"]) {
    assert.match(triage, new RegExp(v), `triage command: ${v}`);
  }
  assert.match(triage, /\$INPUTS\.request/, "triage sigue llevando el pedido");

  const triageAgent = loadAgentDef("triage");
  assert.ok(triageAgent);
  assert.match(triageAgent.body, /Contract:/, "triage agent: veredicto");
  assert.doesNotMatch(triageAgent.body, /"decision"/, "triage agent: sin keys máquina");

  const spec = readCommand("spec");
  assert.match(spec, /ESCALATE/, "spec command: honra BLOCKED/NO_ACTION");

  const implement = readCommand("implement");
  assert.match(implement, /ESCALATE/, "implement command: no toca código bloqueado");

  const review = readCommand("review");
  assert.match(review, /ESCALATE/, "review command: sin findings inventados ante ESCALATE");
});

test("p-fix146: veredicto primero + regresión citada (sin dumps de razonamiento)", () => {
  const review = readCommand("review");
  assert.match(review, /Veredicto primero/, "review command: veredicto primero");
  assert.match(review, /Let me analyze/, "review command: tics prohibidos nombrados");
  assert.match(review, /0 findings/, "review command: sin problemas abiertos con 0 findings");
  assert.match(review, /regresi/, "review command: prueba de regresión para bugfix");
  assert.match(review, /node --check/, "review command: sintaxis sola no prueba comportamiento");
  assert.match(review, /major.*blocker.*abierto|blocker.*major/s, "review command: gate de severidades");
  assert.match(review, /no-examinado nunca es limpio|no examinado/i, "review command: regla de clase");
  assert.match(review, /camino viejo/, "review command: regla espejo");

  const reviewAgent = loadAgentDef("review");
  assert.ok(reviewAgent);
  assert.match(reviewAgent.body, /Veredicto primero/, "review agent: veredicto primero");
  assert.match(reviewAgent.body, /regresi/, "review agent: regresión en eje tests");
  assert.match(reviewAgent.body, /No inventes convenciones/, "review agent: sin convenciones inventadas");
  assert.match(reviewAgent.body, /major.*blocker.*verde|verde.*major/s, "review agent: gate de severidades");
  assert.match(reviewAgent.body, /Defecto-clase|defecto.*clase/i, "review agent: regla de clase");
  assert.match(reviewAgent.body, /camino viejo/, "review agent: regla espejo");
  assert.doesNotMatch(reviewAgent.body, /"green"/, "review agent: sin keys máquina");

  for (const name of ["fix-issue", "plan-approve-implement"]) {
    const wf = loadWorkflow(name, { repoRoot: REPO }).def;
    const all = wf.nodes.flatMap((n) => [n, ...(n.loop_group?.nodes ?? [])]);
    const byId = (id: string) => all.find((n) => n.id === id);
    assert.match(byId("review")?.prompt ?? "", /Veredicto primero/, `${name}: veredicto primero`);
    assert.match(byId("review")?.prompt ?? "", /regresi/, `${name}: regresión citada`);
    assert.match(byId("review")?.prompt ?? "", /camino viejo/, `${name}: regla espejo`);
    assert.match(byId("review")?.prompt ?? "", /No inventes convenciones/, `${name}: sin convenciones inventadas`);
  }
});
