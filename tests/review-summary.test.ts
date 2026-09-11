import test from "node:test";
import assert from "node:assert/strict";
import { humanizeReviewSummary } from "../src/features/factoryLab/components/reviewSummary.ts";

// Helper puro del ReviewPanel: traduce fallos de infra a mensaje humano.

test("UnknownError del server efímero → friendly de infra, conserva technical", () => {
  const raw =
    'review prompt fallo (20s+retry): {"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_b928aa49"}}';
  const h = humanizeReviewSummary(raw);
  assert.equal(h.isInfraFailure, true);
  assert.equal(h.technical, raw);
  assert.match(h.friendly, /no pudo responder/);
  assert.doesNotMatch(h.friendly, /UnknownError/);
});

test("mismo modelo bloqueado → friendly específico", () => {
  const h = humanizeReviewSummary("mismo modelo builder=revisor (x/y) — ask_human sin gastar LLM");
  assert.equal(h.isInfraFailure, true);
  assert.match(h.friendly, /auto-aprobación/);
});

test("máximo revisiones → friendly específico", () => {
  const h = humanizeReviewSummary("máximo 2 revisiones alcanzado — se requiere input humano.");
  assert.equal(h.isInfraFailure, true);
  assert.match(h.friendly, /decisión humana/);
});

test("summary normal de accept → se muestra tal cual, sin flag infra", () => {
  const raw = "Cambio trivial verificado: carpeta creada, sin riesgos.";
  const h = humanizeReviewSummary(raw);
  assert.equal(h.isInfraFailure, false);
  assert.equal(h.friendly, raw);
});

test("summary vacío no rompe", () => {
  const h = humanizeReviewSummary("");
  assert.equal(h.isInfraFailure, false);
  assert.equal(h.friendly, "");
});
