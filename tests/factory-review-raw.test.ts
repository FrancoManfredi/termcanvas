import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackBuildId,
  checkRetryReviewGuards,
  isSafeJobId,
  parseReviewRawPath,
  resolveFactoryBuildId,
  resolveReviewRawFileName,
} from "../headless-runtime/factory/reviewRaw.ts";

// Ola 5: parseo del endpoint raw — espejo de GET /:id/review, nunca lanza.

// ── parseReviewRawPath: ids válidos ──

test("raw factory válido parsea id", () => {
  const r = parseReviewRawPath("/factory/jobs/abc123/review/raw");
  assert.deepEqual(r, { id: "abc123", isWorkItemsAlias: false });
});

test("raw alias work-items válido parsea id", () => {
  const r = parseReviewRawPath("/work-items/abc123/review/raw");
  assert.deepEqual(r, { id: "abc123", isWorkItemsAlias: true });
});

test("raw acepta ids con guiones y guion bajo", () => {
  const r = parseReviewRawPath("/factory/jobs/wi-2026_09_02-x1/review/raw");
  assert.deepEqual(r, { id: "wi-2026_09_02-x1", isWorkItemsAlias: false });
});

// ── parseReviewRawPath: ids inválidos ──

test("raw sin id → error missing id o longitud (400)", () => {
  const r = parseReviewRawPath("/factory/jobs/review/raw");
  assert.ok("error" in r);
  assert.match(r.error, /missing id|unexpected|invalid/);
});

test("raw con raw como id → error", () => {
  const r = parseReviewRawPath("/factory/jobs/raw/review/raw");
  // parts len 5 pero id="raw" → reservado/inválido
  assert.ok("error" in r);
});

test("raw traversal .. rechazado", () => {
  const r = parseReviewRawPath("/factory/jobs/../review/raw");
  assert.ok("error" in r);
  assert.match(r.error, /invalid id|missing id|unexpected/);
});

test("raw traversal .. en alias rechazado", () => {
  const r = parseReviewRawPath("/work-items/../review/raw");
  assert.ok("error" in r);
});

test("raw con segmento extra → error de longitud", () => {
  const r = parseReviewRawPath("/factory/jobs/abc/extra/review/raw");
  assert.ok("error" in r);
});

test("raw ruta que no es review-raw → error", () => {
  const r = parseReviewRawPath("/factory/jobs/abc123/review");
  assert.ok("error" in r);
});

// ── isSafeJobId ──

test("isSafeJobId rechaza .., /, \\ y reservados", () => {
  assert.equal(isSafeJobId(".."), false);
  assert.equal(isSafeJobId("a/b"), false);
  assert.equal(isSafeJobId("a\\b"), false);
  assert.equal(isSafeJobId("a..b"), false);
  assert.equal(isSafeJobId("review"), false);
  assert.equal(isSafeJobId("raw"), false);
  assert.equal(isSafeJobId(""), false);
  assert.equal(isSafeJobId("abc123"), true);
});

test("isSafeJobId rechaza traversal codificado %2e%2e y %2f", () => {
  assert.equal(isSafeJobId("%2e%2e"), false);
  assert.equal(isSafeJobId("abc%2fdef"), false);
  assert.equal(isSafeJobId("abc%5cdef"), false);
});

// ── resolveReviewRawFileName ──

test("filename desde reviewCount 2 → review-raw-2.txt", () => {
  assert.equal(resolveReviewRawFileName(2), "review-raw-2.txt");
});

test("filename con count 0 o ausente → fallback review-raw-1.txt", () => {
  assert.equal(resolveReviewRawFileName(0), "review-raw-1.txt");
  assert.equal(resolveReviewRawFileName(undefined), "review-raw-1.txt");
  assert.equal(resolveReviewRawFileName(null), "review-raw-1.txt");
  assert.equal(resolveReviewRawFileName("2"), "review-raw-1.txt");
});

// ── checkRetryReviewGuards ──

test("retry-review ok cuando Review (sin budget: cualquier count)", () => {
  assert.deepEqual(checkRetryReviewGuards({ status: "Review", reviewCount: 0 }, "x"), { ok: true });
  assert.deepEqual(checkRetryReviewGuards({ status: "Review", reviewCount: 1 }, "x"), { ok: true });
  assert.deepEqual(checkRetryReviewGuards({ status: "Review", reviewCount: 2 }, "x"), { ok: true });
  assert.deepEqual(checkRetryReviewGuards({ status: "Review", reviewCount: 99 }, "x"), { ok: true });
});

test("retry-review 404 si no existe el job", () => {
  const r = checkRetryReviewGuards(null, "missing-id");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 404);
    assert.match(r.error, /job not found/);
  }
});

test("retry-review 409 si status no es Review", () => {
  const r = checkRetryReviewGuards({ status: "Building", reviewCount: 0 }, "x");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 409);
    assert.match(r.error, /not in Review/);
  }
});

// (Sin budget de revisiones: el guard 409 por count>=2 se eliminó —
// el humano reintenta siempre. Solo quedan 404 sin job y 409 fuera de Review.)

// ── buildId ──

test("fallback buildId es dev-<base36>", () => {
  assert.equal(buildFallbackBuildId(0), "dev-0");
  assert.match(buildFallbackBuildId(Date.now()), /^dev-[0-9a-z]+$/);
});

test("resolveFactoryBuildId usa git cuando exec devuelve sha", () => {
  const id = resolveFactoryBuildId({ exec: () => "a1b2c3d\n", nowMs: 0 });
  assert.equal(id, "a1b2c3d");
});

test("resolveFactoryBuildId cae a fallback si git falla", () => {
  const id = resolveFactoryBuildId({
    exec: () => {
      throw new Error("not a git repo");
    },
    nowMs: 0,
  });
  assert.equal(id, "dev-0");
});

test("resolveFactoryBuildId cae a fallback si sha tiene espacios", () => {
  const id = resolveFactoryBuildId({ exec: () => "nope nope\n", nowMs: 0 });
  assert.equal(id, "dev-0");
});
