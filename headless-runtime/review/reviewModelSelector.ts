/**
 * ReviewModelSelector — Ola 4.
 * Tabla de pares builder ↔ revisor para evitar auto-revisión.
 * Sin deps nuevas: lógica pura, testeable sin LLM.
 *
 * Tabla (diseño Gao):
 * - muse-spark ↔ big-pickle
 * - anthropic → gpt-4o (openai)
 * - openai → anthropic (claude-sonnet-4-20250514)
 * Si builder === revisor → ask_human sin gastar LLM.
 */

import type { ModelRef } from "../../shared/types/workItem";
import { getFactoryConfig } from "../factory/agentLoader";

export interface ReviewerSelection {
  reviewerModel: ModelRef;
  shouldAskHuman: boolean;
  reason: string;
}

export type ReviewerSource = "explicit" | "auto";

export interface ResolvedReviewer extends ReviewerSelection {
  source: ReviewerSource;
}

export const REVIEWER_DEFAULT: ModelRef = {
  providerID: "opencode",
  modelID: "big-pickle",
};

export const REVIEWER_MUSE_SPARK: ModelRef = {
  providerID: "opencode-go",
  modelID: "muse-spark-1.2-contributor",
};

export const REVIEWER_GPT4O: ModelRef = {
  providerID: "openai",
  modelID: "gpt-4o",
};

export const REVIEWER_ANTHROPIC: ModelRef = {
  providerID: "anthropic",
  modelID: "claude-sonnet-4-20250514",
};

/**
 * Tabla documentada de pares (para UI/debug).
 */
export const REVIEWER_PAIRS: Array<{ match: string; reviewer: string }> = [
  { match: "muse-spark → big-pickle", reviewer: "opencode/big-pickle" },
  { match: "big-pickle → muse-spark", reviewer: "opencode-go/muse-spark-1.2-contributor" },
  { match: "anthropic/* → gpt-4o", reviewer: "openai/gpt-4o" },
  { match: "openai/* → anthropic", reviewer: "anthropic/claude-sonnet-4-20250514" },
];

/**
 * Pares activos — Ola 7 (H4): default desde `factory/factory.yaml`
 * (`getFactoryConfig().reviewerPairs`), con fallback a REVIEWER_PAIRS
 * si el yaml falta o es inválido. Nunca lanza.
 */
export function getActiveReviewerPairs(): Array<{ match: string; reviewer: string }> {
  try {
    const cfg = getFactoryConfig();
    const pairs = cfg?.reviewerPairs;
    if (
      Array.isArray(pairs) &&
      pairs.length > 0 &&
      pairs.every(
        (p) =>
          p &&
          typeof p.match === "string" &&
          p.match.trim().length > 0 &&
          typeof p.reviewer === "string" &&
          p.reviewer.includes("/"),
      )
    ) {
      return pairs.map((p) => ({ match: p.match, reviewer: p.reviewer }));
    }
  } catch {
    // fallback abajo
  }
  return REVIEWER_PAIRS;
}

function parseProviderModel(ref: string): ModelRef | null {
  try {
    const s = String(ref ?? "").trim();
    const i = s.indexOf("/");
    if (i <= 0 || i >= s.length - 1) return null;
    const providerID = s.slice(0, i).trim();
    const modelID = s.slice(i + 1).trim();
    if (!providerID || !modelID) return null;
    return { providerID, modelID };
  } catch {
    return null;
  }
}

/**
 * Rol de una entrada de la tabla según su predicado `match` (H4 final, by-match).
 * Solo se mira el lado builder (izquierda de →/->): así
 * "muse-spark → big-pickle" (builder muse-spark) se distingue de
 * "big-pickle → muse-spark" (builder big-pickle) sin depender del orden.
 * Orden de especificidad: muse-spark > big-pickle > anthropic > openai > default.
 * Puro, nunca lanza.
 */
export function classifyPairRole(match: string): "def" | "spark" | "gpt" | "anth" | "default" {
  try {
    const raw = String(match ?? "").toLowerCase();
    const arrow = raw.indexOf("→");
    const ascii = raw.indexOf("->");
    let cut = -1;
    if (arrow >= 0 && ascii >= 0) cut = Math.min(arrow, ascii);
    else if (arrow >= 0) cut = arrow;
    else if (ascii >= 0) cut = ascii;
    const left = (cut >= 0 ? raw.slice(0, cut) : raw).trim();
    const scope = left.length > 0 ? left : raw.trim();
    if (scope.includes("muse-spark")) return "def";
    if (scope.includes("big-pickle")) return "spark";
    if (scope.includes("anthropic")) return "gpt";
    if (scope.includes("openai")) return "anth";
    return "default";
  } catch {
    return "default";
  }
}

export interface ReviewerRefs {
  def: ModelRef;
  spark: ModelRef;
  gpt: ModelRef;
  anth: ModelRef;
}

/**
 * Lookup puro (H4 final): resuelve refs desde cualquier tabla de pares
 * evaluando el predicado `match` de cada entrada — no posicional, robusto
 * a reordenamientos del yaml. Roles sin reclamar caen a las constantes
 * REVIEWER_*. Ante duplicados del mismo rol gana la primera entrada;
 * las entradas "default" solo rellenan `def` si ninguna regla específica
 * lo reclamó. Nunca lanza.
 */
export function resolveRefsFromPairs(
  pairs: ReadonlyArray<{ match: string; reviewer: string }> | null | undefined,
): ReviewerRefs {
  const refs: ReviewerRefs = {
    def: { ...REVIEWER_DEFAULT },
    spark: { ...REVIEWER_MUSE_SPARK },
    gpt: { ...REVIEWER_GPT4O },
    anth: { ...REVIEWER_ANTHROPIC },
  };
  try {
    if (!Array.isArray(pairs)) return refs;
    const parsed: Array<{ role: string; reviewer: ModelRef }> = [];
    for (const p of pairs) {
      if (!p || typeof p.match !== "string" || typeof p.reviewer !== "string") continue;
      const reviewer = parseProviderModel(p.reviewer);
      if (!reviewer) continue;
      parsed.push({ role: classifyPairRole(p.match), reviewer });
    }
    const claimed = new Set<string>();
    for (const e of parsed) {
      if (e.role === "default") continue;
      if (claimed.has(e.role)) continue;
      (refs as unknown as Record<string, ModelRef>)[e.role] = { ...e.reviewer };
      claimed.add(e.role);
    }
    if (!claimed.has("def")) {
      const fallback = parsed.find((e) => e.role === "default");
      if (fallback) refs.def = { ...fallback.reviewer };
    }
  } catch {
    // fallback a constantes (refs ya inicializados)
  }
  return refs;
}

/**
 * Refs efectivas del revisor — Ola 8 (H4 final): resolución by-match sobre
 * los pares activos del yaml (mismo orden de especificidad siempre), con
 * fallback a las constantes si el yaml falta o es inválido. Nunca lanza
 * y preserva la semántica del selector para la tabla default.
 */
function reviewerRefs(): ReviewerRefs {
  try {
    const pairs = getActiveReviewerPairs();
    if (Array.isArray(pairs) && pairs.length > 0) return resolveRefsFromPairs(pairs);
  } catch {
    // fallback abajo
  }
  return {
    def: { ...REVIEWER_DEFAULT },
    spark: { ...REVIEWER_MUSE_SPARK },
    gpt: { ...REVIEWER_GPT4O },
    anth: { ...REVIEWER_ANTHROPIC },
  };
}

/**
 * Compara solo providerID + modelID (ignora variant).
 */
export function isSameModel(
  a?: Pick<ModelRef, "providerID" | "modelID"> | null,
  b?: Pick<ModelRef, "providerID" | "modelID"> | null,
): boolean {
  if (!a || !b) return false;
  const aP = (a.providerID ?? "").trim();
  const aM = (a.modelID ?? "").trim();
  const bP = (b.providerID ?? "").trim();
  const bM = (b.modelID ?? "").trim();
  if (!aP || !aM || !bP || !bM) return false;
  return aP === bP && aM === bM;
}

// ── FASE 3 E1 — Tabla única proveedor→revisor + fallback builder-aware (C6/C7/C9) ──
// Antes los pares vivían en `if`s dispersos en `selectReviewerModel` y
// `fallbackFor`: misma tabla, mismo orden, mismo fail-closed, ahora como datos
// puros testeables. `factoryServer.ts`, foreman y UI NO eligen revisor a mano
// (verificado: solo `reviewService.resolveReviewer` y `reviewAgent.fallbackFor`
// consumen este módulo); H-006 imposible por construcción (el fallback que
// colisiona con el builder cae al orden disjunto fijo).
// Cero literales nuevos de modelos: las filas referencian las constantes
// REVIEWER_* / refs del yaml, nunca `"provider/model"` escrito a mano.

/** Clase de builder (lado izquierdo del par). El último (`desconocido`) es catch-all. */
export type BuilderKind =
  | "muse-spark"
  | "big-pickle"
  | "anthropic"
  | "openai"
  | "opencode-go"
  | "opencode"
  | "desconocido";

export interface BuilderReviewerRule {
  readonly kind: BuilderKind;
  /** Predicado puro sobre provider/model ya normalizados a minúsculas. */
  readonly matches: (providerLC: string, modelLC: string) => boolean;
  /** Revisor desde las refs activas (yaml o constantes). */
  readonly select: (refs: ReviewerRefs) => ModelRef;
  /** Razón byte a byte la de antes (los labels fijos por fila se conservan). */
  readonly reasonFor: (provider: string, model: string, candidate: ModelRef) => string;
}

/**
 * ÚNICA tabla builder→revisor (mismo orden y semántica que los `if`s de antes:
 * muse-spark > big-pickle > anthropic > openai > opencode-go > opencode >
 * default). La primera fila que matchea gana; `desconocido` siempre matchea.
 * Pura (datos + closures sin efectos), nunca lanza por sí misma.
 */
export const BUILDER_REVIEWER_TABLE: ReadonlyArray<BuilderReviewerRule> = [
  {
    kind: "muse-spark",
    matches: (_providerLC, modelLC) => modelLC.includes("muse-spark"),
    select: (refs) => ({ ...refs.def }),
    reasonFor: (provider, model, candidate) =>
      `builder ${provider}/${model} contiene muse-spark → revisor ${candidate.providerID}/${candidate.modelID}`,
  },
  {
    kind: "big-pickle",
    matches: (_providerLC, modelLC) => modelLC.includes("big-pickle"),
    select: (refs) => ({ ...refs.spark }),
    reasonFor: (provider, model, candidate) =>
      `builder ${provider}/${model} es big-pickle → revisor ${candidate.providerID}/${candidate.modelID}`,
  },
  {
    kind: "anthropic",
    matches: (providerLC) => providerLC === "anthropic",
    select: (refs) => ({ ...refs.gpt }),
    reasonFor: (_provider, model, candidate) =>
      `builder anthropic/${model} → revisor ${candidate.providerID}/${candidate.modelID}`,
  },
  {
    kind: "openai",
    matches: (providerLC) => providerLC === "openai",
    select: (refs) => ({ ...refs.anth }),
    reasonFor: (_provider, model, candidate) =>
      `builder openai/${model} → revisor ${candidate.providerID}/${candidate.modelID}`,
  },
  {
    kind: "opencode-go",
    matches: (providerLC) => providerLC === "opencode-go",
    select: (refs) => ({ ...refs.def }),
    reasonFor: (_provider, model, candidate) =>
      `builder opencode-go/${model} → revisor ${candidate.providerID}/${candidate.modelID}`,
  },
  {
    kind: "opencode",
    matches: (providerLC) => providerLC === "opencode",
    select: (refs) => ({ ...refs.spark }),
    reasonFor: (_provider, model, candidate) =>
      `builder opencode/${model} → revisor ${candidate.providerID}/${candidate.modelID}`,
  },
  {
    kind: "desconocido",
    matches: () => true,
    select: (refs) => ({ ...refs.def }),
    reasonFor: (provider, model, candidate) =>
      `builder ${provider}/${model} sin par específico → default ${candidate.providerID}/${candidate.modelID}`,
  },
];

/**
 * Clasifica un builder ya normalizado (minúsculas) a su `BuilderKind`.
 * Primera fila que matchea gana (mismo orden que la tabla). Fail-closed:
 * ante cualquier imprevisto devuelve `"desconocido"`. Pura, nunca lanza.
 */
export function classifyBuilderKind(
  providerLC: unknown,
  modelLC: unknown,
): BuilderKind {
  try {
    const p = typeof providerLC === "string" ? providerLC : "";
    const m = typeof modelLC === "string" ? modelLC : "";
    const row = BUILDER_REVIEWER_TABLE.find((r) => {
      try {
        return r.matches(p, m);
      } catch {
        return false;
      }
    });
    return row ? row.kind : "desconocido";
  } catch {
    return "desconocido";
  }
}

/**
 * Revisor para una clase ya clasificada (mismo `select` de la tabla).
 * Fail-closed a `refs.def` (y a `REVIEWER_DEFAULT` si hasta eso falla).
 * Pura, nunca lanza.
 */
export function selectCandidateForKind(
  kind: BuilderKind,
  refs: ReviewerRefs,
): ModelRef {
  try {
    const row = BUILDER_REVIEWER_TABLE.find((r) => r.kind === kind);
    if (row) {
      try {
        return row.select(refs);
      } catch {
        // cae al default de abajo
      }
    }
  } catch {
    // cae al default de abajo
  }
  try {
    return { ...refs.def };
  } catch {
    return { ...REVIEWER_DEFAULT };
  }
}

/** Clase de revisor primario (para el fallback canónico). `otro` es catch-all. */
export type ReviewerKind =
  | "big-pickle"
  | "muse-spark"
  | "anthropic"
  | "openai"
  | "otro";

export interface ReviewerFallbackRule {
  readonly kind: ReviewerKind;
  readonly matches: (providerLC: string, modelLC: string) => boolean;
  readonly select: (refs: ReviewerRefs) => ModelRef;
}

/**
 * ÚNICA tabla de fallback canónico (misma semántica que antes: big-pickle→
 * spark, muse-spark→def, anthropic→gpt, openai→anth, resto→def). La colisión
 * con el builder (H-006) se resuelve aparte con `FALLBACK_DISJOINT_ORDER`.
 * Pura, nunca lanza por sí misma.
 */
export const REVIEWER_FALLBACK_TABLE: ReadonlyArray<ReviewerFallbackRule> = [
  {
    kind: "big-pickle",
    matches: (_providerLC, modelLC) => modelLC.includes("big-pickle"),
    select: (refs) => ({ ...refs.spark }),
  },
  {
    kind: "muse-spark",
    matches: (_providerLC, modelLC) => modelLC.includes("muse-spark"),
    select: (refs) => ({ ...refs.def }),
  },
  {
    kind: "anthropic",
    matches: (providerLC) => providerLC === "anthropic",
    select: (refs) => ({ ...refs.gpt }),
  },
  {
    kind: "openai",
    matches: (providerLC) => providerLC === "openai",
    select: (refs) => ({ ...refs.anth }),
  },
  {
    kind: "otro",
    matches: () => true,
    select: (refs) => ({ ...refs.def }),
  },
];

/**
 * Orden fijo de refs disjuntas para H-006 (def→spark→gpt→anth, como antes).
 * Ante colisión fallback==builder se elige la primera disjunta de AMBOS.
 */
export const FALLBACK_DISJOINT_ORDER: ReadonlyArray<keyof ReviewerRefs> = [
  "def",
  "spark",
  "gpt",
  "anth",
];

/**
 * Fallback canónico desde la tabla (sin la rama H-006: esa la aplica
 * `fallbackFor`). Fail-closed a `refs.def`. Pura, nunca lanza.
 */
export function resolveFallbackCandidate(
  reviewer: Pick<ModelRef, "providerID" | "modelID"> | null | undefined,
  refs: ReviewerRefs,
): ModelRef {
  try {
    const modelLC = String(reviewer?.modelID ?? "").toLowerCase();
    const providerLC = String(reviewer?.providerID ?? "").trim().toLowerCase();
    const row = REVIEWER_FALLBACK_TABLE.find((r) => {
      try {
        return r.matches(providerLC, modelLC);
      } catch {
        return false;
      }
    });
    if (row) {
      try {
        return row.select(refs);
      } catch {
        // cae al default de abajo
      }
    }
  } catch {
    // cae al default de abajo
  }
  try {
    return { ...refs.def };
  } catch {
    return { ...REVIEWER_DEFAULT };
  }
}

// ── FIN FASE 3 E1 — tabla única ──

/**
 * Selecciona modelo revisor dado el builder.
 * Nunca lanza: siempre devuelve un candidato + flag ask_human.
 */
export function selectReviewerModel(builder?: ModelRef | null): ReviewerSelection {
  if (
    !builder ||
    typeof builder.providerID !== "string" ||
    builder.providerID.trim().length === 0 ||
    typeof builder.modelID !== "string" ||
    builder.modelID.trim().length === 0
  ) {
    return {
      reviewerModel: { ...REVIEWER_DEFAULT },
      shouldAskHuman: false,
      reason: "sin builder — default opencode/big-pickle",
    };
  }
  const provider = builder.providerID.trim();
  const providerLC = provider.toLowerCase();
  const model = builder.modelID.trim();
  const modelLC = model.toLowerCase();

  // FASE 3 E1: candidatos desde la tabla única (misma semántica y orden que
  // los `if`s de antes; las refs siguen saliendo del yaml con fallback a
  // constantes). El fail-closed vive en `classifyBuilderKind` (desconocido).
  const refs = reviewerRefs();
  const kind = classifyBuilderKind(providerLC, modelLC);
  const candidate = selectCandidateForKind(kind, refs);
  const row =
    BUILDER_REVIEWER_TABLE.find((r) => r.kind === kind) ??
    BUILDER_REVIEWER_TABLE[BUILDER_REVIEWER_TABLE.length - 1];
  const reason = row.reasonFor(provider, model, candidate);

  if (isSameModel(builder, candidate)) {
    return {
      reviewerModel: candidate,
      shouldAskHuman: true,
      reason: `mismo modelo builder=revisor (${provider}/${model}) — ask_human sin gastar LLM`,
    };
  }
  return { reviewerModel: candidate, shouldAskHuman: false, reason };
}

/**
 * Resuelve el revisor efectivo dado el builder y la preferencia explícita del usuario.
 * - Explícito válido y distinto → se usa directo (source explicit).
 * - Explícito igual al builder → ask_human sin gastar LLM (anti auto-aprobación).
 * - Explícito ausente/inválido → selector automático disjunto (source auto).
 * Puro, testeable sin LLM ni disco.
 */
export function resolveReviewer(
  builder?: ModelRef | null,
  explicit?: Pick<ModelRef, "providerID" | "modelID"> & { variant?: string } | null,
): ResolvedReviewer {
  const hasExplicit =
    !!explicit &&
    typeof explicit.providerID === "string" &&
    explicit.providerID.trim().length > 0 &&
    typeof explicit.modelID === "string" &&
    explicit.modelID.trim().length > 0;
  if (hasExplicit) {
    const reviewerModel: ModelRef = {
      providerID: (explicit as { providerID: string }).providerID.trim(),
      modelID: (explicit as { modelID: string }).modelID.trim(),
      ...((explicit as { variant?: string }).variant
        ? { variant: (explicit as { variant?: string }).variant as string }
        : {}),
    };
    if (isSameModel(builder, reviewerModel)) {
      return {
        reviewerModel,
        shouldAskHuman: true,
        reason: `revisor explícito igual al builder (${reviewerModel.providerID}/${reviewerModel.modelID}) — ask_human sin gastar LLM`,
        source: "explicit",
      };
    }
    return {
      reviewerModel,
      shouldAskHuman: false,
      reason: `revisor explícito elegido por el usuario: ${reviewerModel.providerID}/${reviewerModel.modelID}`,
      source: "explicit",
    };
  }
  const auto = selectReviewerModel(builder);
  return { ...auto, source: "auto" };
}

/**
 * Fallback de modelo revisor — Ola 5 Review blindado.
 * Dado el revisor primario, devuelve 1 alternativa disjunta reutilizando REVIEWER_*.
 * Mapeo: big-pickle → MUSE_SPARK, muse-spark → DEFAULT, anthropic → GPT4O,
 * openai → ANTHROPIC, resto → DEFAULT.
 * H-006 (aditivo): con `builder` presente, si el fallback canónico coincide
 * con el builder (colisión que el guard anti-auto-review voltearía a
 * ask_human, como big-pickle→muse-spark con builder muse-spark), se elige la
 * primera ref disjunta de AMBOS (orden fijo def→spark→gpt→anth). Sin builder
 * o sin colisión el resultado es byte a byte el de antes (pacts intactos).
 * Puro, nunca lanza.
 */
export function fallbackFor(reviewer: ModelRef, builder?: Pick<ModelRef, "providerID" | "modelID"> | null): ModelRef {
  try {
    // FASE 3 E1: canónico desde la tabla única (misma semántica que antes);
    // la rama H-006 usa el orden disjunto fijo (mismo orden def→spark→gpt→anth).
    const refs = reviewerRefs();
    const canonical = resolveFallbackCandidate(reviewer, refs);
    // H-006: colisión fallback==builder → buscar disjunto real de ambos.
    if (builder && isSameModel(builder, canonical)) {
      const primary: Pick<ModelRef, "providerID" | "modelID"> = {
        providerID: reviewer?.providerID ?? "",
        modelID: reviewer?.modelID ?? "",
      };
      const ordered: ModelRef[] = FALLBACK_DISJOINT_ORDER.map((k) => ({ ...refs[k] }));
      const found = ordered.find(
        (cand) => !isSameModel(builder, cand) && !isSameModel(primary, cand),
      );
      if (found) return found;
    }
    return canonical;
  } catch {
    return { ...REVIEWER_DEFAULT };
  }
}

/**
 * H-006: mensaje honesto para la rama fallback-igual-al-builder. Nombra la
 * causa exacta (qué primario falló, con qué error recortado, y qué fallback
 * colisionó con qué builder) para que NUNCA contradiga al badge (que muestra
 * el primario). Puro, nunca lanza.
 */
export function describeFallbackCollision(params: {
  primary: Pick<ModelRef, "providerID" | "modelID">;
  fallback: Pick<ModelRef, "providerID" | "modelID">;
  builder?: Pick<ModelRef, "providerID" | "modelID"> | null;
  cause?: string | null;
}): string {
  try {
    const p = `${params.primary?.providerID ?? "?"}/${params.primary?.modelID ?? "?"}`;
    const f = `${params.fallback?.providerID ?? "?"}/${params.fallback?.modelID ?? "?"}`;
    const b = params.builder ? `${params.builder.providerID}/${params.builder.modelID}` : "desconocido";
    const cause = typeof params.cause === "string" && params.cause.trim().length > 0
      ? params.cause.trim().slice(0, 140)
      : "sin detalle";
    return (
      `revisor primario ${p} falló (${cause}) y su fallback ${f} igual al builder (${b}) — ` +
      `ask_human sin gastar llamada adicional`
    );
  } catch {
    return "revisor fallback igual al builder — ask_human sin gastar llamada adicional";
  }
}
