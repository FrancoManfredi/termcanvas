import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  ALLOWED_TRANSITIONS,
} from "../shared/types/workItem.ts";
import {
  checkVerifyRetryGuards,
  parseVerifyGetPath,
  parseVerifyRetryPath,
} from "../headless-runtime/factory/factoryServer.ts";
import { parseVerifyEvidence } from "../src/features/factoryLab/components/VerificationPanel.tsx";

// Ola 9 — Verify como etapa propia: Triage --(re-verify pass)--> Review.
// Sin estado nuevo; pacts nunca pisan Triage (mock pass→Complete), intactos.

// ── A. Transición Triage→Review ──

test("Ola 9: Triage→Review permitida (loop re-verify, sin estado nuevo)", () => {
  assert.equal(canTransition("Triage", "Review"), true);
  assert.deepEqual(
    [...ALLOWED_TRANSITIONS.Triage].sort(),
    ["Cancelled", "Foreman", "Review"].sort(),
  );
});

test("Ola 9: resto de transiciones intactas (pacts + loops existentes)", () => {
  // Review sigue igual (review-service.test.ts lo asevera; espejo acá).
  assert.deepEqual(
    [...ALLOWED_TRANSITIONS.Review].sort(),
    ["Building", "Cancelled", "Complete", "Triage"].sort(),
  );
  assert.deepEqual(
    [...ALLOWED_TRANSITIONS.Building].sort(),
    ["Cancelled", "Complete", "Review", "Triage"].sort(),
  );
  assert.deepEqual(
    [...ALLOWED_TRANSITIONS.Intake].sort(),
    ["Cancelled", "Foreman"].sort(),
  );
  assert.deepEqual(
    [...ALLOWED_TRANSITIONS.Foreman].sort(),
    ["Building", "Cancelled", "Triage"].sort(),
  );
  // Triage NO salta a Building/Complete/Intake directo (solo vía Review o Foreman).
  assert.equal(canTransition("Triage", "Foreman"), true);
  assert.equal(canTransition("Triage", "Cancelled"), true);
  assert.equal(canTransition("Triage", "Building"), false);
  assert.equal(canTransition("Triage", "Complete"), false);
  assert.equal(canTransition("Triage", "Intake"), false);
  assert.equal(canTransition("Triage", "Triage"), false);
});

// ── B. Guards puros POST .../review/verify-retry ──

test("verify-retry guards: 404 sin job", () => {
  const g = checkVerifyRetryGuards(null, "job-x");
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.code, 404);
    assert.match(g.error, /job not found/);
  }
});

test("verify-retry guards: ok solo en Triage", () => {
  assert.deepEqual(checkVerifyRetryGuards({ status: "Triage" }, "job-x"), {
    ok: true,
  });
});

test("verify-retry guards: 409 en cualquier otro status", () => {
  for (const status of [
    "Intake",
    "Foreman",
    "Building",
    "Review",
    "Complete",
    "Cancelled",
    undefined,
    42,
  ]) {
    const g = checkVerifyRetryGuards({ status }, "job-x");
    assert.equal(g.ok, false, `status=${String(status)} debería ser 409`);
    if (!g.ok) {
      assert.equal(g.code, 409);
      assert.match(g.error, /not in Triage/);
    }
  }
});

// ── B/C. Parseo de rutas (factory + alias work-items) ──

test("parseVerifyRetryPath: factory y alias parsean id", () => {
  assert.deepEqual(parseVerifyRetryPath("/factory/jobs/job-abc/review/verify-retry"), {
    id: "job-abc",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseVerifyRetryPath("/work-items/job-abc/review/verify-retry"), {
    id: "job-abc",
    isWorkItemsAlias: true,
  });
});

test("parseVerifyRetryPath: rechaza ruta ajena, sin id, traversal y extra", () => {
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/job-abc/review/retry-review"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/review/verify-retry"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/../review/verify-retry"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/a/extra/review/verify-retry"));
  assert.ok("error" in parseVerifyRetryPath("/factory/jobs/verify-retry/review/verify-retry"));
});

test("parseVerifyGetPath: factory y alias parsean id", () => {
  assert.deepEqual(parseVerifyGetPath("/factory/jobs/job-abc/verify"), {
    id: "job-abc",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseVerifyGetPath("/work-items/job-abc/verify"), {
    id: "job-abc",
    isWorkItemsAlias: true,
  });
});

test("parseVerifyGetPath: no confunde verify-retry ni acepta sin id/traversal", () => {
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/job-abc/review/verify-retry"));
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/verify"));
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/../verify"));
  assert.ok("error" in parseVerifyGetPath("/factory/jobs/job-abc/result"));
});

// ── D. Evidence tolerante (jobs viejos sin evidence → [] = compat) ──

test("parseVerifyEvidence: ausente/no-array no rompe (jobs viejos)", () => {
  assert.deepEqual(parseVerifyEvidence(null), []);
  assert.deepEqual(parseVerifyEvidence(undefined), []);
  assert.deepEqual(parseVerifyEvidence({}), []);
  assert.deepEqual(parseVerifyEvidence({ evidence: null }), []);
  assert.deepEqual(parseVerifyEvidence({ evidence: "nada" }), []);
  assert.deepEqual(parseVerifyEvidence({ status: "fail" }), []);
});

test("parseVerifyEvidence: filtra items sin kind/status y normaliza", () => {
  const out = parseVerifyEvidence({
    evidence: [
      { kind: "test", status: "pass", ref: "logs/build.log", summary: "  suite verde  " },
      { kind: "build", status: "fail" },
      { kind: "", status: "pass" },
      { kind: "visual" },
      null,
      "hola",
      { kind: "  captura  ", status: " pass ", ref: 42, summary: "" },
    ],
  });
  assert.deepEqual(out, [
    { kind: "test", status: "pass", ref: "logs/build.log", summary: "suite verde" },
    { kind: "build", status: "fail" },
    { kind: "captura", status: "pass" },
  ]);
});

test("parseVerifyEvidence: topa a 50 items", () => {
  const big = Array.from({ length: 60 }, (_, i) => ({
    kind: `k${i}`,
    status: "pass",
  }));
  assert.equal(parseVerifyEvidence({ evidence: big }).length, 50);
});
