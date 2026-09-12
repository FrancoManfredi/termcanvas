/**
 * Validación de `output_format` contra el JSON Schema declarado (Fase 9).
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateAgainstSchema } from "../headless-runtime/workflows/jsonSchema.ts";
import { runWorkflow, type LoadedWorkflow } from "../headless-runtime/workflows/executor.ts";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";

function sandbox(): { tmp: string; runsDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-schema-"));
  return { tmp, runsDir: path.join(tmp, "runs") };
}

function loaded(yaml: string, tmp: string): LoadedWorkflow {
  const sourcePath = path.join(tmp, "workflow.yaml");
  fs.writeFileSync(sourcePath, yaml, "utf-8");
  return {
    def: parseWorkflowDefinition(yaml, sourcePath),
    source: yaml,
    sourcePath,
    digest: crypto.createHash("sha256").update(yaml).digest("hex"),
    dir: tmp,
  };
}

test("validador: type, required, properties, items y enum", () => {
  const schema = {
    type: "object",
    required: ["green", "notes"],
    additionalProperties: false,
    properties: {
      green: { type: "boolean" },
      notes: { type: "string" },
      score: { type: "integer" },
      tags: { type: "array", items: { type: "string" } },
      verdict: { enum: ["ok", "bad"] },
    },
  };

  assert.equal(validateAgainstSchema({ green: true, notes: "ok" }, schema), null);
  assert.match(
    validateAgainstSchema({ green: true }, schema) ?? "",
    /falta el campo requerido "notes"/,
  );
  assert.match(
    validateAgainstSchema({ green: "yes", notes: "x" }, schema) ?? "",
    /se esperaba boolean/,
  );
  assert.match(
    validateAgainstSchema({ green: true, notes: "x", score: 1.5 }, schema) ?? "",
    /se esperaba integer/,
  );
  assert.match(
    validateAgainstSchema({ green: true, notes: "x", tags: ["a", 2] }, schema) ?? "",
    /output\.tags\[1\]: se esperaba string/,
  );
  assert.match(
    validateAgainstSchema({ green: true, notes: "x", verdict: "maybe" }, schema) ?? "",
    /fuera del enum/,
  );
  assert.match(
    validateAgainstSchema({ green: true, notes: "x", extra: 1 }, schema) ?? "",
    /campo no permitido "extra"/,
  );
  assert.equal(validateAgainstSchema(undefined, undefined), null);
});

test("executor: output que no cumple el schema falla el nodo", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: strict
description: schema estricto
nodes:
  - id: verdict
    output_format:
      type: object
      required: [green, summary]
      properties:
        green: { type: boolean }
        summary: { type: string }
    bash: |
      node -e "process.stdout.write(JSON.stringify({green: true}))"
`;
  const run = await runWorkflow(loaded(yaml, tmp), { cwd: tmp, runsDir });
  assert.equal(run.status, "failed");
  assert.match(run.nodes.verdict.error ?? "", /output_format inválido/);
  assert.match(run.nodes.verdict.error ?? "", /summary/);
});

test("executor: output válido guarda outputJson", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: strict-ok
description: schema ok
nodes:
  - id: verdict
    output_format:
      type: object
      required: [green, summary]
      properties:
        green: { type: boolean }
        summary: { type: string }
    bash: |
      node -e "process.stdout.write(JSON.stringify({green: true, summary: 'ok'}))"
`;
  const run = await runWorkflow(loaded(yaml, tmp), { cwd: tmp, runsDir });
  assert.equal(run.status, "completed");
  assert.deepEqual(run.nodes.verdict.outputJson, { green: true, summary: "ok" });
});
