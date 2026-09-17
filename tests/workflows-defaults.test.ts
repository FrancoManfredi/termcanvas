/**
 * Defaults bundled (Fase 5): discovery, validación y corridas con runner stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverWorkflows, loadWorkflow } from "../headless-runtime/workflows/loader.ts";
import { runWorkflow } from "../headless-runtime/workflows/executor.ts";
import type { AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";

const repoRoot = process.cwd();
const emptyGlobal = path.join(os.tmpdir(), "wf-defaults-empty-global");
fs.mkdirSync(emptyGlobal, { recursive: true });
process.env.TERMCANVAS_WORKFLOWS_DIR = emptyGlobal;

function sandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-defaults-"));
}

test("bundled: discovery y validación de los defaults", () => {
  const expected = [
    "smoke",
    "plan-approve-implement",
    "parallel-reviews",
    "review-lens",
    "fix-issue",
    "factory-default",
    "verify-runner",
  ];
  const found = discoverWorkflows({ repoRoot, globalDir: emptyGlobal });
  for (const name of expected) {
    assert.ok(found.has(name), `falta el workflow bundled ${name}`);
  }
  for (const name of expected) {
    const loaded = loadWorkflow(name, { repoRoot, globalDir: emptyGlobal });
    assert.equal(loaded.def.name, name);
    assert.equal(loaded.scope, "bundled");
  }
});

test("guard: ruteables usan las garantías del engine (history + verify + findings)", () => {
  for (const name of ["fix-issue", "factory-default", "plan-approve-implement"]) {
    const def = loadWorkflow(name, { repoRoot, globalDir: emptyGlobal }).def;
    const all = def.nodes.flatMap((n) => [n, ...(n.loop_group?.nodes ?? [])]);
    const groups = def.nodes.filter((n) => n.loop_group);
    assert.ok(groups.length > 0, `${name}: tiene loop_group`);
    for (const group of groups) {
      assert.notEqual(
        group.loop_group?.history,
        false,
        `${name}/${group.id}: historial activo (anti-regresión)`,
      );
      assert.notEqual(
        group.loop_group?.reverify,
        false,
        `${name}/${group.id}: reverify system-owned activo`,
      );
    }
    const verify = all.find((node) => node.id === "verify");
    assert.ok(verify, `${name}: nodo verify presente`);
    assert.equal(
      verify?.workflow,
      "verify-runner",
      `${name}: la verificación es system-owned (verify-runner)`,
    );
    assert.equal(
      verify?.output_type,
      "verify-evidence",
      `${name}: verify deja evidencia`,
    );
    const review = all.find((node) => node.id === "review");
    const findingsType = (
      review?.output_format as
        | { properties?: { findings?: { type?: string } } }
        | undefined
    )?.properties?.findings?.type;
    assert.equal(findingsType, "array", `${name}: findings estructurados`);
  }
});

/** Mensajes resueltos de implement/review del loop (prompt inline o commands/*.md). */
function loopMessages(name: string): { implement: string; review: string } {
  const loaded = loadWorkflow(name, { repoRoot, globalDir: emptyGlobal });
  const dir = path.dirname(loaded.sourcePath);
  const all = loaded.def.nodes.flatMap((n) => [n, ...(n.loop_group?.nodes ?? [])]);
  const bodyOf = (node: { prompt?: string; command?: string } | undefined): string => {
    if (!node) return "";
    if (typeof node.prompt === "string") return node.prompt;
    if (typeof node.command === "string") {
      return fs.readFileSync(
        path.join(dir, "commands", `${node.command}.md`),
        "utf-8",
      );
    }
    return "";
  };
  return {
    implement: bodyOf(all.find((n) => n.id === "implement")),
    review: bodyOf(all.find((n) => n.id === "review")),
  };
}

test("guard: review inyecta evidencia legible ($verify.outputJson), no el JSON crudo", () => {
  for (const name of ["fix-issue", "factory-default", "plan-approve-implement"]) {
    const { review } = loopMessages(name);
    assert.ok(review.length > 0, `${name}: mensaje de review presente`);
    assert.ok(
      review.includes("$verify.outputJson"),
      `${name}: evidencia estructurada legible`,
    );
    assert.ok(
      !/\$verify\.output(?!Json)/.test(review),
      `${name}: sin volcado crudo de evidencia`,
    );
    assert.ok(
      review.includes("FIN EVIDENCIA"),
      `${name}: bloque de datos delimitado`,
    );
    assert.ok(
      review.includes("FIN IMPLEMENTACIÓN"),
      `${name}: implementación delimitada`,
    );
  }
});

test("guard: implement cierra con Review guidance para el reviewer y el PR", () => {
  for (const name of ["fix-issue", "factory-default", "plan-approve-implement"]) {
    const { implement } = loopMessages(name);
    assert.ok(implement.length > 0, `${name}: mensaje de implement presente`);
    assert.ok(
      implement.includes("## Review guidance"),
      `${name}: implement guía al review`,
    );
    assert.ok(
      implement.includes("Empezar por:"),
      `${name}: guidance con punto de entrada`,
    );
  }
});

test("plan-approve-implement: plan -> gate -> implement -> review", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const runner: AiNodeRunner = async (req) => {
    if (req.prompt.includes("Armá un plan")) {
      return { output: '{"summary":"plan ok","steps":["a","b"]}' };
    }
    if (req.prompt.includes("Implementá el plan")) {
      return { output: "impl done" };
    }
    return { output: '{"green":true,"findings":[]}' };
  };
  const run = await runWorkflow(
    loadWorkflow("plan-approve-implement", { repoRoot, globalDir: emptyGlobal }),
    {
      cwd: path.dirname(runsDir),
      runsDir,
      repoRoot,
      inputs: { request: "arreglar login" },
      aiRunner: runner,
      onApproval: async () => ({ decision: "approve", text: "dale" }),
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.plan.outputJson?.summary, "plan ok");
  assert.equal(run.nodes.gate.output, "dale");
  assert.equal(run.nodes["build.implement"].output, "impl done");
  assert.equal(run.nodes["build.review"].outputJson?.green, true);
});

test("parallel-reviews: fan_out de 3 lentes con child runs", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const runner: AiNodeRunner = async (req) => ({
    output: JSON.stringify({ green: true, notes: `lente: ${req.prompt}` }),
  });
  const run = await runWorkflow(
    loadWorkflow("parallel-reviews", { repoRoot, globalDir: emptyGlobal }),
    { cwd: repoRoot, runsDir, repoRoot, aiRunner: runner },
  );
  assert.equal(run.status, "completed");
  const reviews = run.nodes.reviews.outputJson as unknown[];
  assert.equal(Array.isArray(reviews), true);
  assert.equal(reviews.length, 3);
  const runDirs = fs.readdirSync(runsDir).filter((entry) => entry.startsWith("run-"));
  assert.equal(runDirs.length, 4);
});

test("factory-default: pipeline migrado corre por el engine", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const log: AiNodeRequest[] = [];
  const runner: AiNodeRunner = async (req) => {
    log.push(req);
    if (req.prompt.includes("Hacé el triage")) return { output: "triaje" };
    if (req.prompt.includes("Escribí una spec")) return { output: "spec" };
    if (req.prompt.includes("Verificá la implementación")) return { output: "PASS" };
    if (req.prompt.includes("Revisá la implementación")) {
      return { output: '{"green":true,"findings":[]}' };
    }
    return { output: "impl" };
  };
  const run = await runWorkflow(
    loadWorkflow("factory-default", { repoRoot, globalDir: emptyGlobal }),
    {
      cwd: path.dirname(runsDir),
      runsDir,
      repoRoot,
      inputs: { request: "arreglar login" },
      aiRunner: runner,
      onApproval: async () => ({ decision: "approve", text: "ok" }),
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.triage.output, "triaje");
  assert.equal(run.nodes.approve.output, "ok");
  assert.equal(run.nodes["build.verify"].outputJson?.pass, true);
  assert.equal(run.result?.outcome, "succeeded");
  assert.ok(
    fs.existsSync(
      path.join(runsDir, run.id, "artifacts", "nodes", "build.verify.md"),
    ),
    "verify debe dejar evidencia sidecar",
  );
  const agentFor = (needle: string) =>
    log.find((req) => req.prompt.includes(needle))?.agent;
  assert.equal(agentFor("Hacé el triage"), "triage");
  assert.equal(agentFor("Escribí una spec"), "spec");
  assert.equal(agentFor("Implementá la spec"), "implement");
  assert.equal(
    log.some((req) => req.prompt.includes("Verificá la implementación")),
    false,
    "verify es system-owned: no corre por un agente",
  );
  assert.equal(agentFor("Revisá la implementación"), "review");
});

test("fix-issue: cadena triage -> implement -> review", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const runner: AiNodeRunner = async (req) => ({
    output: req.prompt.includes("Analizá el issue")
      ? "triaje"
      : req.prompt.includes("Implementá la solución")
        ? "hecho"
        : '{"green":true,"dispositionsComplete":true,"contractCoverage":[{"requirement":"Rq1: el botón roto responde al click","coveredBy":"R1","status":"covered"}],"findings":[]}',
  });
  const run = await runWorkflow(
    loadWorkflow("fix-issue", { repoRoot, globalDir: emptyGlobal }),
    {
      cwd: path.dirname(runsDir),
      runsDir,
      repoRoot,
      inputs: { request: "botón roto" },
      aiRunner: runner,
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.triage.output, "triaje");
  assert.equal(run.nodes["build.implement"].output, "hecho");
  assert.equal(run.nodes["build.review"].outputJson?.green, true);
});

test("revisión iterativa: review rojo → implement corrige con findings → verde", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const implementPrompts: string[] = [];
  let reviews = 0;
  const runner: AiNodeRunner = async (req) => {
    if (req.prompt.includes("Analizá el issue")) return { output: "triaje" };
    if (req.prompt.includes("Implementá la solución")) {
      implementPrompts.push(req.prompt);
      return { output: implementPrompts.length === 1 ? "v1" : "v2" };
    }
    reviews += 1;
    return {
      output:
        reviews === 1
          ? '{"green":false,"dispositionsComplete":false,"contractCoverage":[{"requirement":"Rq1: el contador se actualiza","coveredBy":"","status":"missing","note":"el contrato no cubre el requisito"}],"findings":[{"id":"f1","severity":"major","message":"el contador no se actualiza"}]}'
          : '{"green":true,"dispositionsComplete":true,"contractCoverage":[{"requirement":"Rq1: el contador se actualiza","coveredBy":"R1","status":"covered"}],"findings":[]}',
    };
  };
  const run = await runWorkflow(
    loadWorkflow("fix-issue", { repoRoot, globalDir: emptyGlobal }),
    {
      cwd: path.dirname(runsDir),
      runsDir,
      repoRoot,
      inputs: { request: "botón roto" },
      aiRunner: runner,
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.result?.outcome, "succeeded");
  assert.equal(implementPrompts.length, 2, "implement corre una vez por ronda");
  assert.equal(
    implementPrompts[1]?.includes("el contador no se actualiza"),
    true,
    "la ronda 2 recibe los findings de la ronda 1",
  );
  assert.equal(
    run.nodes["build.review"].outputJson?.green,
    true,
    "la última ronda queda en verde",
  );
});

test("revisión iterativa: rojo tras agotar las rondas → outcome failed", async () => {
  const runsDir = path.join(sandbox(), "runs");
  let reviews = 0;
  const runner: AiNodeRunner = async (req) => {
    if (req.prompt.includes("Analizá el issue")) return { output: "triaje" };
    if (req.prompt.includes("Implementá la solución")) return { output: "v1" };
    reviews += 1;
    return { output: `{"green":false,"dispositionsComplete":false,"contractCoverage":[{"requirement":"Rq1: el botón responde","coveredBy":"","status":"missing"}],"findings":[{"id":"f1","severity":"major","message":"ronda ${reviews}"}]}` };
  };
  const run = await runWorkflow(
    loadWorkflow("fix-issue", { repoRoot, globalDir: emptyGlobal }),
    {
      cwd: path.dirname(runsDir),
      runsDir,
      repoRoot,
      inputs: { request: "botón roto" },
      aiRunner: runner,
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.result?.outcome, "failed", "rojo final = outcome failed");
  assert.equal(reviews, 4, "4 rondas máximas");
});
