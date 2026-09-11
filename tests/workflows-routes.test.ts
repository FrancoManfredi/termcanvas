/**
 * Rutas HTTP de workflows (Fase 4b) contra un server http real.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntime } from "../headless-runtime/workflows/runtime.ts";
import { createWorkflowRouteHandler } from "../headless-runtime/workflows/workflowRoutes.ts";
import type { WorkflowRun } from "../headless-runtime/workflows/types.ts";

function sandbox(): { tmp: string; runsDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-routes-"));
  return { tmp, runsDir: path.join(tmp, "runs") };
}

function writeRepoWorkflow(tmp: string, name: string, yaml: string): void {
  const dir = path.join(tmp, ".agents", "workflows", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workflow.yaml"), yaml, "utf-8");
}

async function startServer(tmp: string, runsDir: string) {
  const runtime = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  const handler = createWorkflowRouteHandler(
    () => runtime,
    () => tmp,
  );
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const handled = await handler(req, res, url.pathname);
    if (!handled) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no ruta" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    address && typeof address === "object" ? address.port : 0;
  return {
    runtime,
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 5_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timeout");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function postJson(base: string, route: string, body: unknown) {
  return fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("GET /factory/workflows lista los workflows del repo", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "quick",
    `name: quick
description: rápido
nodes:
  - id: a
    bash: |
      node -e "process.stdout.write('ok')"
`,
  );
  const server = await startServer(tmp, runsDir);
  try {
    const response = await fetch(`${server.base}/factory/workflows`);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      workflows: Array<{ name: string; description: string }>;
    };
    assert.equal(payload.workflows.length, 1);
    assert.equal(payload.workflows[0].name, "quick");
  } finally {
    await server.close();
  }
});

test("POST run + detalle + lista persistida", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "quick",
    `name: quick
description: rápido
nodes:
  - id: a
    bash: |
      node -e "process.stdout.write('ok')"
`,
  );
  const server = await startServer(tmp, runsDir);
  try {
    const created = await postJson(server.base, "/factory/workflows/run", {
      name: "quick",
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { run: WorkflowRun };
    const runId = createdBody.run.id;
    const finished = await waitFor(async () => {
      const response = await fetch(
        `${server.base}/factory/workflows/runs/${runId}`,
      );
      const payload = (await response.json()) as { run: WorkflowRun };
      return payload.run.status === "completed" ? payload.run : null;
    });
    assert.equal(finished.nodes.a.output, "ok");
    const list = await fetch(`${server.base}/factory/workflows/runs`);
    const listBody = (await list.json()) as { runs: WorkflowRun[] };
    assert.equal(listBody.runs.length, 1);
    assert.equal(listBody.runs[0].id, runId);
  } finally {
    await server.close();
  }
});

test("gate: detalle expone pending y approve lo resuelve", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "gated",
    `name: gated
description: gate
nodes:
  - id: gate
    approval:
      message: "¿Sigo?"
      capture_response: true
`,
  );
  const server = await startServer(tmp, runsDir);
  try {
    const created = await postJson(server.base, "/factory/workflows/run", {
      name: "gated",
    });
    const { run } = (await created.json()) as { run: WorkflowRun };
    await waitFor(async () => {
      const response = await fetch(
        `${server.base}/factory/workflows/runs/${run.id}`,
      );
      const payload = (await response.json()) as { pending: unknown };
      return payload.pending ? payload.pending : null;
    });
    const approved = await postJson(
      server.base,
      `/factory/workflows/runs/${run.id}/approve`,
      { text: "dale" },
    );
    assert.equal(approved.status, 200);
    const finished = await waitFor(async () => {
      const response = await fetch(
        `${server.base}/factory/workflows/runs/${run.id}`,
      );
      const payload = (await response.json()) as { run: WorkflowRun };
      return payload.run.status === "completed" ? payload.run : null;
    });
    assert.equal(finished.nodes.gate.output, "dale");
  } finally {
    await server.close();
  }
});

test("cancel aborta un run activo", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "sleeper",
    `name: sleeper
description: espera
nodes:
  - id: dormir
    wait:
      duration_ms: 60000
`,
  );
  const server = await startServer(tmp, runsDir);
  try {
    const created = await postJson(server.base, "/factory/workflows/run", {
      name: "sleeper",
    });
    const { run } = (await created.json()) as { run: WorkflowRun };
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cancelled = await postJson(
      server.base,
      `/factory/workflows/runs/${run.id}/cancel`,
      {},
    );
    assert.equal(cancelled.status, 200);
    const finished = await waitFor(async () => {
      const response = await fetch(
        `${server.base}/factory/workflows/runs/${run.id}`,
      );
      const payload = (await response.json()) as { run: WorkflowRun };
      return payload.run.status === "cancelled" ? payload.run : null;
    });
    assert.equal(finished.error, "cancelado");
  } finally {
    await server.close();
  }
});

test("errores: sin name, id inválido, gate inexistente y ruta no-workflow", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "quick",
    `name: quick
description: rápido
nodes:
  - id: a
    bash: |
      node -e "process.stdout.write('ok')"
`,
  );
  const server = await startServer(tmp, runsDir);
  try {
    const noName = await postJson(server.base, "/factory/workflows/run", {});
    assert.equal(noName.status, 400);
    const badId = await fetch(
      `${server.base}/factory/workflows/runs/%2E%2E%2Fevil`,
    );
    assert.equal(badId.status, 400);
    const noGate = await postJson(
      server.base,
      "/factory/workflows/runs/run-inexistente/approve",
      {},
    );
    assert.equal(noGate.status, 409);
  } finally {
    await server.close();
  }
});
