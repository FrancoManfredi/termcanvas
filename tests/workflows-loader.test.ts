/**
 * Loader Fase 0: discovery, precedencia repo > global > bundled y layouts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverWorkflows,
  listWorkflowSummaries,
  loadWorkflow,
} from "../headless-runtime/workflows/loader.ts";
import { WorkflowValidationError } from "../headless-runtime/workflows/errors.ts";

interface Layout {
  repoRoot: string;
  globalDir: string;
  bundledDir: string;
}

function makeLayout(): Layout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-loader-"));
  const repoRoot = path.join(root, "repo");
  const globalDir = path.join(root, "global");
  const bundledDir = path.join(root, "bundled");

  const repoShared = path.join(repoRoot, ".agents", "workflows", "shared");
  fs.mkdirSync(repoShared, { recursive: true });
  fs.writeFileSync(
    path.join(repoShared, "workflow.yaml"),
    `name: shared
description: version del repo
nodes:
  - id: a
    bash: echo repo
`,
    "utf-8",
  );

  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalDir, "shared.yaml"),
    `name: shared
description: version global
nodes:
  - id: a
    bash: echo global
`,
    "utf-8",
  );

  const bundledSmoke = path.join(bundledDir, "smoke");
  fs.mkdirSync(bundledSmoke, { recursive: true });
  fs.writeFileSync(
    path.join(bundledSmoke, "workflow.yaml"),
    `name: smoke
description: bundled
nodes:
  - id: a
    bash: echo smoke
`,
    "utf-8",
  );
  return { repoRoot, globalDir, bundledDir };
}

test("discovery: layouts flat y empaquetado, con scopes", () => {
  const layout = makeLayout();
  const found = discoverWorkflows(layout);
  assert.deepEqual([...found.keys()].sort(), ["shared", "smoke"]);
  assert.equal(found.get("shared")?.scope, "repo");
  assert.equal(found.get("smoke")?.scope, "bundled");
});

test("precedencia: el repo gana sobre global y bundled", () => {
  const layout = makeLayout();
  const loaded = loadWorkflow("shared", layout);
  assert.equal(loaded.def.description, "version del repo");
  assert.equal(loaded.scope, "repo");
  assert.match(loaded.digest, /^[a-f0-9]{64}$/);
});

test("workflow inexistente lista los disponibles", () => {
  const layout = makeLayout();
  assert.throws(
    () => loadWorkflow("nope", layout),
    (error: unknown) =>
      error instanceof WorkflowValidationError &&
      /no encontrado/.test(error.message) &&
      /shared/.test(error.message) &&
      /smoke/.test(error.message),
  );
});

test("listWorkflowSummaries ordena y describe", () => {
  const layout = makeLayout();
  const summaries = listWorkflowSummaries(layout);
  assert.deepEqual(
    summaries.map((summary) => summary.name),
    ["shared", "smoke"],
  );
  assert.equal(summaries[1].description, "bundled");
});
