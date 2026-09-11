/**
 * Schema y validación estructural del workflow engine (Fase 0).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";
import { WorkflowValidationError } from "../headless-runtime/workflows/errors.ts";

function parse(yaml: string) {
  return parseWorkflowDefinition(yaml, "test.yaml");
}

test("parsea un workflow mínimo y aplica defaults", () => {
  const def = parse(`name: mini
description: demo
nodes:
  - id: a
    bash: echo hola
`);
  assert.equal(def.name, "mini");
  assert.equal(def.interactive, false);
  assert.equal(def.mutates_checkout, true);
  assert.deepEqual(def.tags, []);
  assert.deepEqual(def.inputs, {});
  assert.equal(def.nodes[0].trigger_rule, "all_success");
  assert.equal(def.nodes[0].always_run, false);
  assert.deepEqual(def.nodes[0].depends_on, []);
});

test("rechaza nodo con dos bodies", () => {
  assert.throws(
    () =>
      parse(`name: x
description: d
nodes:
  - id: a
    bash: echo hola
    prompt: hacelo
`),
    /exactamente un body/,
  );
});

test("rechaza nodo sin body", () => {
  assert.throws(
    () =>
      parse(`name: x
description: d
nodes:
  - id: a
    depends_on: []
`),
    /exactamente un body/,
  );
});

test("rechaza id inválido", () => {
  assert.throws(
    () =>
      parse(`name: x
description: d
nodes:
  - id: "1 mal"
    bash: echo hola
`),
    /id inválido/,
  );
});

test("rechaza ids duplicados", () => {
  assert.throws(
    () =>
      parse(`name: x
description: d
nodes:
  - id: a
    bash: echo 1
  - id: a
    bash: echo 2
`),
    /duplicado/,
  );
});

test("rechaza depends_on inexistente", () => {
  assert.throws(
    () =>
      parse(`name: x
description: d
nodes:
  - id: a
    depends_on: [ghost]
    bash: echo 1
`),
    /inexistente/,
  );
});

test("rechaza ciclos en el DAG", () => {
  assert.throws(
    () =>
      parse(`name: x
description: d
nodes:
  - id: a
    depends_on: [b]
    bash: echo 1
  - id: b
    depends_on: [a]
    bash: echo 2
`),
    /ciclo detectado/,
  );
});

test("rechaza input required con default", () => {
  assert.throws(
    () =>
      parse(`name: x
description: d
inputs:
  spec:
    required: true
    default: algo
nodes:
  - id: a
    bash: echo 1
`),
    /mutuamente excluyentes/,
  );
});

test("rechaza fan_out sin workflow/include", () => {
  assert.throws(
    () =>
      parse(`name: x
description: d
nodes:
  - id: a
    bash: echo 1
    fan_out:
      items: "$x"
      as: item
`),
    /fan_out requiere/,
  );
});

test("rechaza YAML inválido con error de archivo", () => {
  assert.throws(
    () => parseWorkflowDefinition("name: [unclosed", "roto.yaml"),
    (error: unknown) =>
      error instanceof WorkflowValidationError &&
      /roto\.yaml/.test(error.message),
  );
});
