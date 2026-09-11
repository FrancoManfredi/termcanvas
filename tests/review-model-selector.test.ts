import test from "node:test";
import assert from "node:assert/strict";
import {
  isSameModel,
  selectReviewerModel,
} from "../headless-runtime/review/reviewModelSelector.ts";

// Ola 4 T05 — tabla de pares builder ↔ revisor.

test("muse-spark → big-pickle (no gasta LLM extra)", () => {
  const sel = selectReviewerModel({
    providerID: "opencode-go",
    modelID: "muse-spark-1.2-contributor",
  });
  assert.equal(sel.reviewerModel.providerID, "opencode");
  assert.equal(sel.reviewerModel.modelID, "big-pickle");
  assert.equal(sel.shouldAskHuman, false);
});

test("big-pickle → muse-spark", () => {
  const sel = selectReviewerModel({ providerID: "opencode", modelID: "big-pickle" });
  assert.equal(sel.reviewerModel.providerID, "opencode-go");
  assert.ok(sel.reviewerModel.modelID.includes("muse-spark"));
  assert.equal(sel.shouldAskHuman, false);
});

test("anthropic → gpt-4o y openai → anthropic", () => {
  const a = selectReviewerModel({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" });
  assert.equal(a.reviewerModel.providerID, "openai");
  assert.equal(a.reviewerModel.modelID, "gpt-4o");
  const b = selectReviewerModel({ providerID: "openai", modelID: "gpt-4o" });
  assert.equal(b.reviewerModel.providerID, "anthropic");
  assert.equal(b.shouldAskHuman, false);
});

test("mismo modelo → ask_human sin gastar LLM", () => {
  // Si el candidato coincide con el builder, debe marcar ask_human.
  // Caso directo: isSameModel detecta igualdad (ignora variant).
  assert.equal(
    isSameModel(
      { providerID: "opencode", modelID: "big-pickle" },
      { providerID: "opencode", modelID: "big-pickle" },
    ),
    true,
  );
  assert.equal(
    isSameModel(
      { providerID: "opencode", modelID: "big-pickle" },
      { providerID: "openai", modelID: "gpt-4o" },
    ),
    false,
  );
  // Sin builder → default sin ask_human (no rompe creación)
  const def = selectReviewerModel(undefined);
  assert.equal(def.shouldAskHuman, false);
  assert.equal(def.reviewerModel.modelID, "big-pickle");
});
