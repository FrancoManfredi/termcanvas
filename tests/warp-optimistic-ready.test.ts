/**
 * warp-optimistic-ready — fix #69 + pedido explícito.
 *
 * Fila optimista a Ready to Merge con Merge DESHABILITADO mientras el PR
 * recién creado indexa en GitHub (ventana Complete→lookup). La derivación
 * solo rescata filas que caerían a pending; nunca pisa done, in-progress,
 * awaiting ni veredictos settled. TTL y reconciliación viven en el caller
 * (liveActivity + useWorkItemsPolling); acá se fija la tabla.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { deriveActivityStatus } from "../src/features/warpPanel/adapters/activityDerivation.ts";
import {
  OPTIMISTIC_READY_TTL_MS,
  isOptimisticReadyFresh,
} from "../src/stores/issueReviewStore.ts";

function emptyReview(): never {
  return {
    primaryPrByIssue: {},
    openPrsByIssue: {},
    verdictByIssue: {},
    verdictByPr: {},
    labelsByPr: {},
    labelsByIssue: {},
    conflictByPr: {},
    mergedPrNumbers: [],
    reviewingIssueNumber: null,
    fixingIssueNumber: null,
    mergingIssueNumber: null,
    resolvingConflictIssueNumber: null,
    gateByPr: {},
  } as never;
}

test("optimista: sin PR pero con flag fresco → ready/merge-ready (Merge deshabilitado por falta de PR)", () => {
  const d = deriveActivityStatus(69, emptyReview(), null, "OPEN", false, null, false, true);
  assert.deepEqual(d, { status: "ready", awaitingAction: "merge-ready" });
});

test("optimista: sin flag → pending (no se inventa nada)", () => {
  const d = deriveActivityStatus(69, emptyReview(), null, "OPEN", false, null, false);
  assert.deepEqual(d, { status: "pending" });
  const d2 = deriveActivityStatus(69, emptyReview(), null, "OPEN", false, null, false, false);
  assert.deepEqual(d2, { status: "pending" });
  const d3 = deriveActivityStatus(69, emptyReview(), null, "OPEN", false, null, false, null);
  assert.deepEqual(d3, { status: "pending" });
});

test("optimista: nunca pisa señales fuertes", () => {
  // Done por CLOSED.
  assert.equal(
    deriveActivityStatus(69, emptyReview(), null, "CLOSED", false, null, false, true).status,
    "done",
  );
  // In-progress por resolving.
  assert.equal(
    deriveActivityStatus(69, emptyReview(), 69, "OPEN", false, null, false, true).status,
    "in-progress",
  );
  // Awaiting por gate humano.
  assert.equal(
    deriveActivityStatus(69, emptyReview(), null, "OPEN", true, "spec-approval", false, true).status,
    "awaiting",
  );
});

test("optimista: TTL 5min y frescura", () => {
  assert.equal(OPTIMISTIC_READY_TTL_MS, 5 * 60 * 1000);
  assert.equal(isOptimisticReadyFresh(Date.now()), true);
  assert.equal(isOptimisticReadyFresh(Date.now() - 10 * 60 * 1000), false);
  assert.equal(isOptimisticReadyFresh(null), false);
  assert.equal(isOptimisticReadyFresh(0), false);
});
