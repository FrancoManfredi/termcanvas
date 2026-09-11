/**
 * Approval gates (Fase 3b): decisions, capture_response, on_reject y cancelación.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runWorkflow,
  type ApprovalRequest,
  type ApprovalResponse,
  type LoadedWorkflow,
} from "../headless-runtime/workflows/executor.ts";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";
import type { AiNodeRequest, AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";

function sandbox(): { tmp: string; runsDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-gate-"));
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

function responder(
  answers: ApprovalResponse[],
  log: ApprovalRequest[] = [],
): (request: ApprovalRequest) => Promise<ApprovalResponse> {
  let index = 0;
  return async (request) => {
    log.push(request);
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    return answer;
  };
}

const gateYaml = (approval: string) => `name: gate
description: gate
nodes:
  - id: gate
${approval}
`;

test("approve: completa con la decisión como output", async () => {
  const { tmp, runsDir } = sandbox();
  const log: ApprovalRequest[] = [];
  const run = await runWorkflow(
    loaded(
      gateYaml(`    approval:
      message: "¿Aprobás?"`),
      tmp,
    ),
    {
      cwd: tmp,
      runsDir,
      onApproval: responder([{ decision: "approve", text: "lgtm" }], log),
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.gate.output, "approve");
  assert.deepEqual(run.nodes.gate.outputJson, { decision: "approve", text: "lgtm" });
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].decisions, ["approve", "reject"]);
});

test("capture_response: el texto humano es el output", async () => {
  const { tmp, runsDir } = sandbox();
  const run = await runWorkflow(
    loaded(
      gateYaml(`    approval:
      message: "¿Aprobás?"
      capture_response: true`),
      tmp,
    ),
    {
      cwd: tmp,
      runsDir,
      onApproval: responder([{ decision: "approve", text: "dale" }]),
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.gate.output, "dale");
});

test("reject sin on_reject cancela el run", async () => {
  const { tmp, runsDir } = sandbox();
  const run = await runWorkflow(
    loaded(
      gateYaml(`    approval:
      message: "¿Aprobás?"`),
      tmp,
    ),
    {
      cwd: tmp,
      runsDir,
      onApproval: responder([{ decision: "reject", text: "no me gusta" }]),
    },
  );
  assert.equal(run.status, "cancelled");
  assert.match(run.error ?? "", /gate rechazado: no me gusta/);
  assert.equal(run.nodes.gate.status, "cancelled");
});

test("reject con on_reject: rework y segunda respuesta", async () => {
  const { tmp, runsDir } = sandbox();
  const log: ApprovalRequest[] = [];
  const aiLog: AiNodeRequest[] = [];
  const aiRunner: AiNodeRunner = async (req) => {
    aiLog.push(req);
    return { output: "rework hecho", sessionId: "s-rework" };
  };
  const run = await runWorkflow(
    loaded(
      gateYaml(`    approval:
      message: "¿Aprobás? ($REJECTION_REASON)"
      on_reject:
        prompt: "Arreglá esto: $REJECTION_REASON"
        max_attempts: 2`),
      tmp,
    ),
    {
      cwd: tmp,
      runsDir,
      aiRunner,
      onApproval: responder(
        [
          { decision: "reject", text: "falta test" },
          { decision: "approve", text: "ok" },
        ],
        log,
      ),
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(log.length, 2);
  assert.match(log[1].message, /falta test/);
  assert.equal(aiLog.length, 1);
  assert.equal(aiLog[0].prompt, "Arreglá esto: falta test");
});

test("on_reject agotado: el run falla", async () => {
  const { tmp, runsDir } = sandbox();
  const run = await runWorkflow(
    loaded(
      gateYaml(`    approval:
      message: "¿Aprobás?"
      on_reject:
        prompt: "Rework: $REJECTION_REASON"
        max_attempts: 2`),
      tmp,
    ),
    {
      cwd: tmp,
      runsDir,
      aiRunner: async () => ({ output: "rework" }),
      onApproval: responder([{ decision: "reject", text: "no" }]),
    },
  );
  assert.equal(run.status, "failed");
  assert.match(run.nodes.gate.error ?? "", /gate rechazado tras 2 intento/);
});

test("sin handler de aprobación el nodo falla", async () => {
  const { tmp, runsDir } = sandbox();
  const run = await runWorkflow(
    loaded(
      gateYaml(`    approval:
      message: "¿Aprobás?"`),
      tmp,
    ),
    { cwd: tmp, runsDir },
  );
  assert.equal(run.status, "failed");
  assert.match(run.nodes.gate.error ?? "", /gate sin handler de aprobación/);
});

test("decisión fuera del set declarado falla", async () => {
  const { tmp, runsDir } = sandbox();
  const run = await runWorkflow(
    loaded(
      gateYaml(`    approval:
      message: "¿Aprobás?"
      decisions: [ship, revise]`),
      tmp,
    ),
    {
      cwd: tmp,
      runsDir,
      onApproval: responder([{ decision: "approve" }]),
    },
  );
  assert.equal(run.status, "failed");
  assert.match(run.nodes.gate.error ?? "", /decisión inválida "approve"/);
});

test("decisions custom: cualquier decisión no-reject resuelve el gate", async () => {
  const { tmp, runsDir } = sandbox();
  const run = await runWorkflow(
    loaded(
      gateYaml(`    approval:
      message: "¿?"
      decisions: [ship, revise]`),
      tmp,
    ),
    {
      cwd: tmp,
      runsDir,
      onApproval: responder([{ decision: "ship", text: "a prod" }]),
    },
  );
  assert.equal(run.status, "completed");
  assert.deepEqual(run.nodes.gate.outputJson, { decision: "ship", text: "a prod" });
});
