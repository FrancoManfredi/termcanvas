/**
 * review-infra-error — T1: el review que NUNCA corrió por fallo de
 * infra/proveedor no se puede aceptar a ciegas.
 *
 * Contrato bajo test (offline: tmp + store en memoria, sin daemon, sin LLM):
 * - Clasificación: rate-limit pelado y familia 5xx/overload matchean como
 *   infra fallbackable; timeout/abort NO (doctrina no-resend); vacío no.
 * - `buildAskHumanResult` con `isInfraError` setea el flag; sin el param la
 *   forma queda byte-idéntica a la de antes (legítimos intactos).
 * - `isInfraReviewResult`: flag explícito manda; para datos viejos sin flag,
 *   heurística por prefijo de summary + findings vacíos; un ask_human
 *   legítimo, accept o revise nunca son infra.
 * - `acceptReviewEqual`: con lastReview de infra (memoria o review.json en
 *   disco) → 409, el job QUEDA en Review, sin `.done`, sin onAccepted. Con
 *   ask_human legítimo o sin lastReview → 200 Complete como siempre.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import {
  buildAskHumanResult,
  isInfraReviewResult,
  matchesAnyInfraPattern,
  REVIEW_FALLBACKABLE_INFRA_PATTERNS,
  REVIEW_INFRA_SUMMARY_PREFIXES,
  type ReviewResult,
} from "../shared/types/review.ts";
import { acceptReviewEqual } from "../headless-runtime/factory/review/reviewActions.ts";
import { writeReviewJsonAtomic } from "../headless-runtime/review/reviewDisk.ts";

function mkTmp(prefix = "review-infra-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

const createdIds: string[] = [];
const createdDirs: string[] = [];

function mkJob(id: string): string {
  const dir = mkTmp();
  createdDirs.push(dir);
  workItemStore.create({ id, prompt: `prompt de prueba ${id}`, worktree: dir });
  createdIds.push(id);
  return dir;
}

/** Lleva un job a Review por transiciones permitidas (sin LLM ni daemon). */
function toReview(id: string): void {
  workItemStore.transition(id, "Foreman", "system", "infra → Foreman");
  workItemStore.transition(id, "Building", "foreman", "infra → Building");
  workItemStore.transition(id, "Review", "runner", "infra → Review");
}

function cleanup(): void {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of createdDirs.splice(0)) rmTmp(dir);
}

function mkModel() {
  return { providerID: "opencode", modelID: "big-pickle" };
}

function mkInfraResult(id: string, attempt = 1): ReviewResult {
  return buildAskHumanResult({
    workItemId: id,
    reviewerModel: mkModel(),
    reviewAttempt: attempt,
    summary: "review prompt fallo: Error from provider (Console): Rate limit exceeded. Please try again later.",
    isInfraError: true,
  });
}

function mkLegitResult(id: string, attempt = 1): ReviewResult {
  return buildAskHumanResult({
    workItemId: id,
    reviewerModel: mkModel(),
    reviewAttempt: attempt,
    summary: `resumen de prueba ${id}`,
  });
}

// ─── Clasificación ───

test("review infra: rate-limit pelado y familia 5xx matchean como fallbackable", () => {
  for (const msg of [
    "Error from provider (Console): Rate limit exceeded. Please try again later.",
    "rate limit exceeded for model",
    "429 Too Many Requests",
    "too many requests, retry later",
    "over quota for this billing period",
    "quota exceeded",
    "The provider is overloaded, try again",
    "service unavailable, try again later",
    "Unexpected server error: 503",
    "status 500 internal error",
  ]) {
    assert.equal(
      matchesAnyInfraPattern(msg, REVIEW_FALLBACKABLE_INFRA_PATTERNS),
      true,
      msg,
    );
  }
});

test("review infra: timeout/abort/vacío/parse no son fallbackables (doctrina intacta)", () => {
  for (const msg of [
    "",
    "   ",
    "review zod parse fallo: {...}",
    "operation timeout after 600000ms",
    "timed out waiting for response",
    "The operation was aborted",
    "signal abort",
    "veredicto accept con 0 findings",
  ]) {
    assert.equal(
      matchesAnyInfraPattern(msg, REVIEW_FALLBACKABLE_INFRA_PATTERNS),
      false,
      JSON.stringify(msg),
    );
  }
});

// ─── Flag y forma ───

test("review infra: buildAskHumanResult setea el flag solo cuando se pide", () => {
  const flagged = buildAskHumanResult({
    workItemId: "job-infra-a",
    reviewerModel: mkModel(),
    reviewAttempt: 1,
    summary: "review prompt fallo: boom",
    isInfraError: true,
  });
  assert.equal(flagged.isInfraError, true);
  const legit = buildAskHumanResult({
    workItemId: "job-infra-a",
    reviewerModel: mkModel(),
    reviewAttempt: 1,
    summary: "resumen legítimo",
  });
  assert.equal("isInfraError" in legit, false);
});

// ─── isInfraReviewResult ───

test("review infra: flag explícito manda sobre todo", () => {
  assert.equal(isInfraReviewResult(mkInfraResult("job-infra-b")), true);
  const acceptWithFlag = { ...mkInfraResult("job-infra-b"), verdict: "accept" };
  assert.equal(isInfraReviewResult(acceptWithFlag), true);
});

test("review infra: heurística por prefijo cubre datos viejos sin flag", () => {
  for (const prefix of REVIEW_INFRA_SUMMARY_PREFIXES) {
    const old = {
      workItemId: "job-infra-c",
      reviewerModel: mkModel(),
      verdict: "ask_human",
      confidence: 0.5,
      summary: `${prefix} detalle del fallo`,
      findings: [],
      reviewAttempt: 1,
      reviewedAt: new Date().toISOString(),
    };
    assert.equal(isInfraReviewResult(old), true, prefix);
  }
});

test("review infra: legítimos y junk nunca son infra", () => {
  assert.equal(isInfraReviewResult(mkLegitResult("job-infra-d")), false);
  const withFindings = {
    ...mkInfraResult("job-infra-d"),
    isInfraError: undefined,
    findings: [{ id: "f1", axis: "tests", severity: "major", message: "falta test" }],
  };
  assert.equal(isInfraReviewResult(withFindings), false);
  const accept = { ...mkLegitResult("job-infra-d"), verdict: "accept" };
  assert.equal(isInfraReviewResult(accept), false);
  const revise = { ...mkLegitResult("job-infra-d"), verdict: "revise" };
  assert.equal(isInfraReviewResult(revise), false);
  for (const junk of [null, undefined, 42, "ask_human", [], {}]) {
    assert.equal(isInfraReviewResult(junk), false, String(junk));
  }
});

// ─── Guarda del Accept ───

test("review infra: accept sobre lastReview de infra → 409, queda en Review, sin .done", () => {
  mkJob("job-infra-accept-a");
  try {
    toReview("job-infra-accept-a");
    workItemStore.setReview("job-infra-accept-a", mkInfraResult("job-infra-accept-a", 1), 1);
    let accepted = "";
    const out = acceptReviewEqual("job-infra-accept-a", {
      onAccepted: (id) => {
        accepted = id;
      },
    });
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.code, 409);
      assert.match(out.error, /review never ran/);
      assert.match(out.error, /retry-review/);
    }
    assert.equal(accepted, "");
    assert.equal(workItemStore.get("job-infra-accept-a")?.status, "Review");
    const dir = workItemStore.get("job-infra-accept-a")?.dir as string;
    assert.equal(fs.existsSync(path.join(dir, ".done")), false);
  } finally {
    cleanup();
  }
});

test("review infra: accept con ask_human legítimo o sin lastReview → 200 como siempre", () => {
  mkJob("job-infra-accept-b");
  mkJob("job-infra-accept-c");
  try {
    toReview("job-infra-accept-b");
    workItemStore.setReview("job-infra-accept-b", mkLegitResult("job-infra-accept-b", 1), 1);
    assert.deepEqual(acceptReviewEqual("job-infra-accept-b"), {
      ok: true,
      id: "job-infra-accept-b",
      status: "Complete",
    });
    toReview("job-infra-accept-c");
    assert.deepEqual(acceptReviewEqual("job-infra-accept-c"), {
      ok: true,
      id: "job-infra-accept-c",
      status: "Complete",
    });
  } finally {
    cleanup();
  }
});

test("review infra: accept con infra solo en disco (restore parcial) → 409", () => {
  mkJob("job-infra-accept-d");
  try {
    toReview("job-infra-accept-d");
    const dir = workItemStore.get("job-infra-accept-d")?.dir as string;
    assert.ok(dir);
    writeReviewJsonAtomic(dir, mkInfraResult("job-infra-accept-d", 1));
    // Sin setReview: la memoria no tiene lastReview, el disco sí.
    const out = acceptReviewEqual("job-infra-accept-d");
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.code, 409);
    assert.equal(workItemStore.get("job-infra-accept-d")?.status, "Review");
  } finally {
    cleanup();
  }
});
