import test from "node:test";
import assert from "node:assert/strict";
import { parseVerifyEvidence } from "../src/features/factoryLab/components/verifyEvidence.ts";

// Contrato real Ola 9: result.verification.evidence (no top-level).

test("shape real {verification:{evidence}} se parsea", () => {
  const items = parseVerifyEvidence({
    workItemId: "job-x",
    verification: {
      overall: "pass",
      evidence: [
        { kind: "test", status: "pass", ref: "logs/build.log", summary: "test: pass (exit 0)" },
        { kind: "visual", status: "pending-human", ref: "ui/App.tsx", summary: "requiere prueba visual" },
      ],
    },
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "test");
  assert.equal(items[1].status, "pending-human");
});

test("top-level legacy sigue funcionando (compat)", () => {
  const items = parseVerifyEvidence({
    evidence: [{ kind: "build", status: "skipped" }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "build");
});

test("verification.evidence tiene prioridad sobre top-level", () => {
  const items = parseVerifyEvidence({
    verification: { evidence: [{ kind: "test", status: "pass" }] },
    evidence: [{ kind: "build", status: "fail" }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "test");
});

test("sin evidence en ningún lado → [] (jobs viejos)", () => {
  assert.deepEqual(parseVerifyEvidence({ verification: { overall: "pass" } }), []);
  assert.deepEqual(parseVerifyEvidence({}), []);
  assert.deepEqual(parseVerifyEvidence(null), []);
});

test("items inválidos se ignoran y se topa a 50", () => {
  const items = parseVerifyEvidence({
    verification: {
      evidence: [
        null,
        "x",
        { kind: "", status: "pass" },
        { kind: "test" },
        { kind: "test", status: "pass" },
        ...Array.from({ length: 60 }, (_, i) => ({ kind: `k${i}`, status: "pass" })),
      ],
    },
  });
  assert.equal(items.length, 50);
  assert.equal(items[0].kind, "test");
});
