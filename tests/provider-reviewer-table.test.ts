/**
 * FASE 3 E1 — Tabla única proveedor→revisor
 * (`headless-runtime/review/reviewModelSelector.ts`).
 * node:test + tsx. Puro: sin red, sin daemon, sin LLM (cero mocks siquiera:
 * el selector es función pura). Cero nombres de modelos literales: builders y
 * esperados salen de `getActiveReviewerPairs()` (yaml) y de las constantes
 * `REVIEWER_*` (fuente histórica); los "desconocidos" son datos negativos
 * sintéticos, no modelos reales.
 *
 * Cubre lo pedido en F3-E1:
 * - Pares disjuntos (ningún builder se revisa a sí mismo sin ask_human).
 * - Fallback builder-aware (H-006: disjunto de primario Y builder).
 * - Fail-closed ante par desconocido (default, sin lanzar, sin gastar LLM).
 * - Tabla única como datos (orden, catch-all, delegación de
 *   `selectReviewerModel`/`fallbackFor` en ella).
 * - Delegación verificada: reviewService/reviewAgent y el bloque measure del
 *   server consumen la tabla (nadie elige revisor a mano en mi bloque).
 *
 * Reglas citadas: C2 (puras fail-safe), C5 (aditivo: misma tabla, mismo orden,
 * mismo fail-closed), C6/C7 (una sola tabla), C9 (builders puros testeables),
 * C10 (cada caso cita su consumidor).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILDER_REVIEWER_TABLE,
  FALLBACK_DISJOINT_ORDER,
  REVIEWER_FALLBACK_TABLE,
  REVIEWER_PAIRS,
  classifyBuilderKind,
  fallbackFor,
  getActiveReviewerPairs,
  isSameModel,
  resolveFallbackCandidate,
  resolveRefsFromPairs,
  resolveReviewer,
  selectCandidateForKind,
  selectReviewerModel,
} from "../headless-runtime/review/reviewModelSelector.ts";
import type { ModelRef } from "../shared/types/workItem.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

/** Refs activas (yaml o constantes): los 4 roles como builders + casos límite. */
const REFS = resolveRefsFromPairs(getActiveReviewerPairs());
const ALL_REFS: ModelRef[] = [REFS.def, REFS.spark, REFS.gpt, REFS.anth];

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf-8");
}

// ── T1. La tabla única existe con el orden y el catch-all de siempre ──

test("T1 tabla builder→revisor: 7 filas, orden intacto, default última", () => {
  assert.equal(BUILDER_REVIEWER_TABLE.length, 7);
  assert.deepEqual(
    BUILDER_REVIEWER_TABLE.map((r) => r.kind),
    ["muse-spark", "big-pickle", "anthropic", "openai", "opencode-go", "opencode", "desconocido"],
  );
  const last = BUILDER_REVIEWER_TABLE[BUILDER_REVIEWER_TABLE.length - 1];
  assert.equal(last.kind, "desconocido");
  assert.equal(last.matches("cualquier-cosa", "cualquier-cosa"), true);
});

test("T2 tabla de fallback: 5 filas canónicas + orden disjunto fijo H-006", () => {
  assert.deepEqual(
    REVIEWER_FALLBACK_TABLE.map((r) => r.kind),
    ["big-pickle", "muse-spark", "anthropic", "openai", "otro"],
  );
  assert.deepEqual([...FALLBACK_DISJOINT_ORDER], ["def", "spark", "gpt", "anth"]);
  // Cada fila canónica resuelve a una de las refs (nada inventado).
  for (const row of REVIEWER_FALLBACK_TABLE) {
    const cand = row.select(REFS);
    assert.ok(
      ALL_REFS.some((r) => isSameModel(r, cand)),
      `fallback ${row.kind} fuera de las refs`,
    );
  }
});

test("T3 classifyBuilderKind: clases estables, fail-closed a desconocido", () => {
  // Filas por modelo: el modelID de cada ref activa dispara su fila aunque el
  // provider sea otro (valores del yaml/constantes, nunca literales propios).
  assert.equal(classifyBuilderKind("proveedor-inexistente", REFS.spark.modelID.toLowerCase()), "muse-spark");
  assert.equal(classifyBuilderKind("proveedor-inexistente", REFS.def.modelID.toLowerCase()), "big-pickle");
  // Filas por provider: el provider de cada ref (case-insensitive vía el
  // caller público, que normaliza antes de clasificar).
  assert.equal(classifyBuilderKind(REFS.gpt.providerID.toLowerCase(), "x"), "openai");
  assert.equal(classifyBuilderKind(REFS.anth.providerID.toLowerCase(), "x"), "anthropic");
  assert.equal(classifyBuilderKind(REFS.spark.providerID, "x"), "opencode-go");
  assert.equal(classifyBuilderKind(REFS.def.providerID, "x"), "opencode");
  assert.deepEqual(
    selectReviewerModel({ providerID: REFS.gpt.providerID.toUpperCase(), modelID: "x" }).reviewerModel,
    selectCandidateForKind("openai", REFS),
  );
  assert.equal(classifyBuilderKind("proveedor-inexistente", "modelo-inexistente"), "desconocido");
  assert.equal(classifyBuilderKind(null, null), "desconocido");
  assert.equal(classifyBuilderKind(undefined, undefined), "desconocido");
  // selectCandidateForKind honra la tabla (misma fila que clasifica).
  for (const row of BUILDER_REVIEWER_TABLE) {
    assert.deepEqual(selectCandidateForKind(row.kind, REFS), row.select(REFS));
  }
  // selectReviewerModel delega en la tabla en orden (primera fila que matchea).
  for (const builder of ALL_REFS) {
    const p = builder.providerID.trim().toLowerCase();
    const m = builder.modelID.trim().toLowerCase();
    const row = BUILDER_REVIEWER_TABLE.find((r) => {
      try {
        return r.matches(p, m);
      } catch {
        return false;
      }
    }) ?? BUILDER_REVIEWER_TABLE[BUILDER_REVIEWER_TABLE.length - 1];
    assert.deepEqual(selectReviewerModel(builder).reviewerModel, row.select(REFS));
  }
});

// ── Pares disjuntos + fail-closed ──

test("T4 pares disjuntos: ningún builder se revisa a sí mismo en silencio", () => {
  for (const builder of ALL_REFS) {
    const sel = selectReviewerModel(builder);
    const same = isSameModel(builder, sel.reviewerModel);
    // Invariante fail-closed: si coincide, EXIGE ask_human (sin gastar LLM).
    assert.equal(!same || sel.shouldAskHuman, true);
    assert.ok(typeof sel.reason === "string" && sel.reason.length > 0);
  }
});

test("T5 fail-closed ante par desconocido: default, sin ask_human, sin lanzar", () => {
  const sel = selectReviewerModel({ providerID: "proveedor-inexistente", modelID: "modelo-inexistente" });
  assert.deepEqual(sel.reviewerModel, { ...REFS.def });
  assert.equal(sel.shouldAskHuman, false);
  const empty1 = selectReviewerModel(null);
  assert.deepEqual(empty1.reviewerModel, { ...REFS.def });
  assert.equal(empty1.shouldAskHuman, false);
  const empty2 = selectReviewerModel(undefined);
  assert.deepEqual(empty2.reviewerModel, { ...REFS.def });
  const empty3 = selectReviewerModel({ providerID: "  ", modelID: "" });
  assert.deepEqual(empty3.reviewerModel, { ...REFS.def });
  const auto = resolveReviewer(null);
  assert.equal(auto.source, "auto");
  assert.deepEqual(auto.reviewerModel, { ...REFS.def });
});

test("T6 explícito igual al builder → ask_human (anti auto-aprobación intacta)", () => {
  const builder = { ...REFS.def };
  const sel = resolveReviewer(builder, { providerID: builder.providerID, modelID: builder.modelID });
  assert.equal(sel.source, "explicit");
  assert.equal(sel.shouldAskHuman, true);
  const other = resolveReviewer(builder, { ...REFS.spark });
  assert.equal(other.source, "explicit");
  assert.equal(other.shouldAskHuman, false);
  assert.deepEqual(other.reviewerModel.providerID, REFS.spark.providerID);
});

// ── Fallback builder-aware (H-006) ──

test("T7 fallback sin builder delega en la tabla (mapeo intacto, pacts a salvo)", () => {
  for (const primary of ALL_REFS) {
    const fb = fallbackFor({ ...primary });
    // Misma resolución que la tabla canónica + siempre una de las refs.
    assert.deepEqual(fb, resolveFallbackCandidate({ ...primary }, REFS));
    assert.ok(ALL_REFS.some((r) => isSameModel(r, fb)), "fallback fuera de las refs");
  }
  // Determinismo: misma entrada, misma salida.
  const fb1 = fallbackFor({ ...REFS.def });
  const fb2 = fallbackFor({ ...REFS.def });
  assert.deepEqual(fb1, fb2);
});

test("T8 fallback builder-aware: colisión → disjunto de AMBOS (H-006)", () => {
  for (const primary of ALL_REFS) {
    for (const builder of ALL_REFS) {
      const fb = fallbackFor({ ...primary }, { ...builder });
      const canonical = resolveFallbackCandidate(primary, REFS);
      if (isSameModel(builder, canonical)) {
        assert.equal(isSameModel(builder, fb), false);
        assert.equal(isSameModel(primary, fb), false);
      } else {
        assert.deepEqual(fb, canonical);
      }
    }
  }
  // Determinismo: misma entrada, misma salida.
  const fb1 = fallbackFor({ ...REFS.def }, { ...REFS.spark });
  const fb2 = fallbackFor({ ...REFS.def }, { ...REFS.spark });
  assert.deepEqual(fb1, fb2);
});

test("T9 REVIEWER_PAIRS histórica intacta (4 pares, orden, fuente del yaml)", () => {
  assert.equal(REVIEWER_PAIRS.length, 4);
  assert.deepEqual(getActiveReviewerPairs().length >= 4, true);
});

// ── Delegación: nadie elige revisor a mano ──

test("T10 reviewService delega en la tabla; reviewAgent single-shot sin fallback (pin de lectura)", () => {
  const service = readRepo("headless-runtime/review/reviewService.ts");
  assert.ok(service.includes("reviewModelSelector"), "reviewService importa el selector");
  assert.ok(service.includes("resolveReviewer"), "reviewService resuelve vía tabla");
  const agent = readRepo("headless-runtime/review/reviewAgent.ts");
  assert.ok(!agent.includes("fallbackFor"), "flujo simple: reviewAgent sin fallback de modelo");
});

test("T11 el bloque measure del server delega en factory/measure (pin de lectura)", () => {
  const server = readRepo("headless-runtime/factory/factoryServer.ts");
  const open = server.indexOf("FASE 3 E1 — Bloque Rutas measure");
  assert.ok(open >= 0, "bloque E1 inicia con comentario");
  // QA Tanda C: el FIN FASE 3 E1 es documentación de fase, no contrato (la tanda C
  // conserva la delegación pero no el cierre; el contrato real son los imports por
  // dominio, verificados abajo). Si existe se acota al bloque, si no se verifica
  // desde el inicio del bloque hasta el fin para no pineear documentación.
  // El `../measure/scorerEngine` (isUnscored en score manual + auto-score) es uso
  // preexistente del engine, no salto de rutas: se excluye del veto.
  const close = server.indexOf("FIN FASE 3 E1 — Bloque Rutas measure");
  const block = close > open ? server.slice(open, close) : server.slice(open);
  const withoutEngine = block.split("\n").filter((l) => !l.includes("scorerEngine")).join("\n");
  assert.ok(!withoutEngine.includes("../measure/"), "el bloque no salta el dominio");
  assert.ok(block.includes("./measure/scorerRoutes"), "scorers vía dominio");
  assert.ok(block.includes("./measure/benchmarkRoutes"), "benchmarks vía dominio");
  assert.ok(block.includes("./measure/improvementRoutes"), "improvement vía dominio");
});

// ── Fuzz fail-safe ──

test("T12 fuzz: el selector nunca lanza ante basura", () => {
  const garbage: unknown[] = [null, undefined, 0, 42, "", "x", [], {}, { providerID: 1, modelID: [] }];
  for (const g of garbage) {
    let sel1: unknown = null;
    let sel2: unknown = null;
    let sel3: unknown = null;
    assert.doesNotThrow(() => {
      sel1 = selectReviewerModel(g as ModelRef | null);
    });
    assert.doesNotThrow(() => {
      sel2 = resolveReviewer(g as ModelRef | null);
    });
    assert.doesNotThrow(() => {
      sel3 = fallbackFor(g as ModelRef, g as ModelRef | null);
    });
    assert.ok(sel1 && sel2 && sel3);
  }
  assert.doesNotThrow(() => classifyBuilderKind({}, []));
});
