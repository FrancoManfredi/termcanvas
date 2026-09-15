/**
 * ensureAgentTurnClient — config fresca para TODO turno de agente (fix
 * PLATANO fuera del engine): singleton si sigue vigente; server scopeado
 * recién nacido si la revisión/huella de agentes cambió. Offline: usa el
 * test seam del manager (sin spawn real) y aserciones de fuente para que
 * ningún call site se desincronice del helper.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureAgentTurnClient,
  getRunningAgentsFingerprint,
  getRunningAgentsRevision,
  setTestClient,
} from "../headless-runtime/opencodeServerManager.ts";
import {
  bumpAgentDefsRevision,
  getAgentDefsFingerprint,
  getAgentDefsRevision,
} from "../headless-runtime/factory/agentLoader.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type TestClientParam = Parameters<typeof setTestClient>[0];

const AGENT_TURN_CALL_SITES = [
  "headless-runtime/triage/triageAgent.ts",
  "headless-runtime/spec/specAgent.ts",
  "headless-runtime/review/reviewAgent.ts",
  "headless-runtime/implement/implementAgent.ts",
  "headless-runtime/factory/agents/agentHooks.ts",
  "headless-runtime/foreman/foreman.ts",
];

test("sin singleton vivo, el turno usa ensureClient (test seam) sin marcar fresh", async () => {
  const client = { session: { create: async () => ({ id: "ses_test" }) } };
  setTestClient(client as unknown as TestClientParam);
  try {
    const turn = await ensureAgentTurnClient();
    assert.equal(turn.fresh, false, "sin singleton no hay comparación posible");
    assert.equal(turn.client, client as unknown as typeof turn.client);
    assert.equal(typeof turn.close, "function");
    assert.doesNotThrow(() => turn.close(), "el close del singleton es no-op");
  } finally {
    setTestClient(null);
  }
});

test("el test seam deja la revisión sellada desconocida (sin fresh)", () => {
  const client = { session: {} };
  setTestClient(client as unknown as TestClientParam);
  try {
    assert.equal(getRunningAgentsRevision(), null);
    assert.equal(getRunningAgentsFingerprint(), null);
  } finally {
    setTestClient(null);
  }
});

test("la revisión incorpora la huella de disco y el bump la mueve", () => {
  const before = getAgentDefsRevision();
  assert.equal(typeof before, "number");
  assert.equal(getAgentDefsRevision(), before, "sin cambios, estable");
  bumpAgentDefsRevision();
  const after = getAgentDefsRevision();
  assert.ok(after > before, `bump visible (${before} → ${after})`);
});

test("la huella de disco es un entero estable de factory/agents", () => {
  assert.ok(fs.existsSync(path.join(REPO, "factory", "agents")), "agents dir existe");
  const fp = getAgentDefsFingerprint();
  assert.ok(Number.isInteger(fp) && fp >= 0, `fingerprint numérico (${fp})`);
  assert.equal(getAgentDefsFingerprint(), fp, "sin cambios, estable");
});

test("todos los turnos de agente pasan por el helper de frescura", () => {
  for (const rel of AGENT_TURN_CALL_SITES) {
    const source = fs.readFileSync(path.join(REPO, rel), "utf-8");
    assert.ok(
      source.includes("ensureAgentTurnClient()"),
      `${rel}: turno con config fresca (ensureAgentTurnClient)`,
    );
  }
  const engine = fs.readFileSync(
    path.join(REPO, "headless-runtime/workflows/nodes/ai.ts"),
    "utf-8",
  );
  assert.ok(engine.includes("ensureAgentTurnClient"), "engine: usa el helper compartido");
  assert.ok(engine.includes("shouldUseScopedServer"), "engine: re-exporta el predicado");
});

test("el teardown del turno llega al finally en cada call site", () => {
  for (const rel of AGENT_TURN_CALL_SITES) {
    const source = fs.readFileSync(path.join(REPO, rel), "utf-8");
    assert.ok(source.includes("closeTurn()"), `${rel}: cierra el server efímero`);
    assert.match(
      source,
      /finally\s*\{[\s\S]{0,160}closeTurn\(\)/,
      `${rel}: teardown en finally`,
    );
  }
});
