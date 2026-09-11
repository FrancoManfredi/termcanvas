// review-sdk-envelope: the review UnknownError was a client envelope bug,
// not a model bug. SDK 1.18.18 Session.prompt (POST /session/id/message)
// only understands FLAT params; the old path/body envelope was silently
// dropped -> literal sessionID in URL -> instant 500 UnknownError, and the
// 20s timeout killed the only shape that reached the model (~31s measured).
// Evidence 2026-09-07: live probes vs ephemeral 20274 + debug 29876
// (server log: Expected a string starting with ses, got encoded sessionID).
// Offline: zero network, zero daemon.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildReviewPromptPayload,
} from "../headless-runtime/review/reviewAgent.ts";
import { GLOBAL_AGENT_FUSE_MS } from "../headless-runtime/llm/agentTransport.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

// The payload must be flat: top-level sessionID, no path/body envelope,
// no json_schema key (v2 client ignores unknown top-level keys; structured
// output travels as body.format — the only real accept came back as free
// text before format existed server-side).
test("review prompt payload is flat and SDK-compatible", () => {
  const payload = buildReviewPromptPayload(
    "ses_abc123",
    { providerID: "opencode", modelID: "big-pickle" },
    "texto del prompt",
  ) as Record<string, unknown>;
  assert.equal(payload.sessionID, "ses_abc123");
  assert.ok(!("path" in payload), "must not use the path envelope");
  assert.ok(!("body" in payload), "must not use the body envelope");
  assert.ok(!("json_schema" in payload), "json_schema is dropped by the SDK");
  const model = payload.model as Record<string, unknown>;
  assert.equal(model.providerID, "opencode");
  assert.equal(model.modelID, "big-pickle");
  const tools = payload.tools as Record<string, unknown>;
  assert.equal(tools.read, true);
  assert.equal(tools.glob, true);
  assert.equal(tools.grep, true);
  assert.equal(tools.webfetch, true, "webfetch en el set readonly (docs puntuales)");
  assert.equal((tools as Record<string, unknown>).write, undefined);
  assert.equal((tools as Record<string, unknown>).bash, undefined);
  const parts = payload.parts as Array<Record<string, unknown>>;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "text");
  assert.equal(parts[0].text, "texto del prompt");
});

// The same broken envelope lived in the other 6 phase agents (issue
// 2026-09-07: all migrated to flat; factoryServer MVP path excluded on
// purpose — intake works via its legacy shape and H-010 pins it).
test("phase agents never send the dropped path/body envelope", () => {
  const files = [
    ["headless-runtime", "review", "reviewAgent.ts"],
    ["headless-runtime", "foreman", "foreman.ts"],
    ["headless-runtime", "triage", "triageAgent.ts"],
    ["headless-runtime", "spec", "specAgent.ts"],
    ["headless-runtime", "implement", "implementAgent.ts"],
    ["headless-runtime", "measure", "scorerEngine.ts"],
    ["headless-runtime", "measure", "improvementEngine.ts"],
  ];
  for (const parts of files) {
    const src = readFileSync(join(repoRoot, ...parts), "utf8");
    assert.ok(
      !src.includes("path: { id: sid }"),
      parts.join("/") + " must stay on the flat envelope",
    );
  }
  const reviewSrc = readFileSync(
    join(repoRoot, "headless-runtime", "review", "reviewAgent.ts"),
    "utf8",
  );
  assert.ok(
    !reviewSrc.includes("promptAsync("),
    "review promptAsync returns a handle, never text (mentions in comments are fine)",
  );
});

// Sin timeouts por fase (doctrina sin-límites): el turno vive hasta el
// fusible global único — el timeout corto mataba turnos sanos con tool loop.
test("review sin timeout por fase: fusible global único", () => {
  assert.equal(GLOBAL_AGENT_FUSE_MS, 600_000);
});

// Sin skill tool: el payload nunca otorga skill (turnos de datos, reglas en el espejo).
test("payload nunca lleva skill:true (sub-agentes sin skills)", () => {
  const base = buildReviewPromptPayload(
    "ses_abc123",
    { providerID: "opencode", modelID: "big-pickle" },
    "texto",
  ) as Record<string, unknown>;
  assert.equal((base.tools as Record<string, unknown>).skill, undefined);
  assert.equal((base.tools as Record<string, unknown>).read, true, "el set base intacto");
});
