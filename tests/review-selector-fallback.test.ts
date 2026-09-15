import test from "node:test";
import assert from "node:assert/strict";
import {
  selectReviewerModel,
  fallbackFor,
  isSameModel,
  describeFallbackCollision,
} from "../headless-runtime/review/reviewModelSelector.ts";

// H-006 — job-mtm7pndk-c4sc: builder opencode-go/muse-spark-1.2-contributor,
// primario opencode/big-pickle, fallback canónico muse-spark == builder.
// El selector elige bien; el que colisionaba era fallbackFor. Sin LLM, sin daemon.

const BUILDER_H006 = { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" };
const PRIMARY_H006 = { providerID: "opencode", modelID: "big-pickle" };

test("H-006: el par del caso (builder muse-spark) selecciona big-pickle disjunto, sin ask_human", () => {
  const sel = selectReviewerModel(BUILDER_H006);
  assert.deepEqual(sel.reviewerModel, PRIMARY_H006);
  assert.equal(sel.shouldAskHuman, false);
  assert.equal(isSameModel(BUILDER_H006, sel.reviewerModel), false);
});

test("H-006: fallback builder-aware evita el par colisionado (disjoint real)", () => {
  const fb = fallbackFor(PRIMARY_H006, BUILDER_H006);
  assert.equal(isSameModel(fb, BUILDER_H006), false, "el fallback no puede ser el builder");
  assert.equal(isSameModel(fb, PRIMARY_H006), false, "el fallback no puede ser el primario");
  // Determinista: dos llamadas, mismo resultado.
  assert.deepEqual(fb, fallbackFor(PRIMARY_H006, BUILDER_H006));
});

test("H-006: fallbackFor sin builder intacto (mapeo canónico, pacts a salvo)", () => {
  assert.deepEqual(fallbackFor(PRIMARY_H006), {
    providerID: "opencode-go",
    modelID: "muse-spark-1.3-contributor",
  });
  assert.deepEqual(fallbackFor({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }), {
    providerID: "openai",
    modelID: "gpt-4o",
  });
});

test("H-006: el mensaje de colisión nombra la causa exacta (primario + error + fallback + builder)", () => {
  const msg = describeFallbackCollision({
    primary: PRIMARY_H006,
    fallback: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    builder: BUILDER_H006,
    cause: "UnknownError: Unexpected server error",
  });
  // Causa exacta: el primario que falló (lo que muestra el badge)…
  assert.ok(msg.includes("opencode/big-pickle"), "nombra al primario (badge)");
  // …el fallback que colisionó y el builder…
  assert.ok(
    msg.includes("opencode-go/muse-spark-1.2-contributor"),
    "nombra fallback/builder",
  );
  // …y el error real, no un genérico.
  assert.ok(msg.includes("UnknownError"), "nombra la causa real");
  // Sin contradicción con el badge: el mensaje arranca con el primario.
  assert.ok(msg.startsWith("revisor primario opencode/big-pickle"), "arranca con el primario");
});

test("H-006: sin causa detallada igual hay mensaje honesto (nunca vacío ni genérico puro)", () => {
  const msg = describeFallbackCollision({
    primary: PRIMARY_H006,
    fallback: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    builder: BUILDER_H006,
    cause: "",
  });
  assert.ok(msg.includes("opencode/big-pickle"));
  assert.ok(msg.includes("ask_human"));
});
