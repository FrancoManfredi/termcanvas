/**
 * ScorerEngine — Ola 11 Measure.
 * Juez LLM de scorers estilo Warp: 1 pregunta, labels (no notas), timeout 20s
 * + 1 retry, parse tolerante. Cualquier duda → unscored, NUNCA inventa score.
 *
 * Espeja la ESTRUCTURA de `reviewAgent` (session.create + session.prompt con
 * json_schema + timeout + retry + mock inyectable) sin reutilizar su código:
 * el fallo acá es `unscored`, no `ask_human`.
 *
 * NOTA CUOTA JUEZ (pregunta abierta del proyecto, MASTER-PLAN §7 "Decisiones
 * abiertas"): el modelo del juez sale del `model:` del scorer.md; si es
 * inválido se usa `getDefaultModels().builder` de agentLoader. La cuota del
 * juez es la misma cuota propia del daemon (sin infra managed): si el juez
 * falla por auth/cuota/modelo, el scoring queda `unscored` con la razón
 * visible en vez de inventar un score.
 */

import fs from "node:fs";
import path from "node:path";
import type { VerificationReport } from "../../shared/types/implement";
import {
  SCORER_AGENT_ROLES,
  resolveScoreReason,
  scoreForLabel,
  type ScoreReason,
  type ScoreResult,
  type ScorerDefinition,
} from "../../shared/types/scorer";
import type {
  FailureCase,
  ImprovementProposal,
} from "../../shared/types/improvement";
import {
  getDefaultModels,
  getImproveProposalCooldown,
  parseModelRef,
} from "../factory/agentLoader";
import { opencodeServerManager } from "../opencodeServerManager";
import { promptInSessionWithCost } from "../cost/promptWithCost";
import { isSessionNotFoundError } from "../sessions/agentSessions";
import { tagScorer, withPhaseTag } from "../llm/phaseTags";
import {
  SESSION_CREATE_FUSE_MS,
  attemptPromptOnce,
  isRetryableTransportError,
  parseSessionId,
  withTransportRetry,
} from "../llm/agentTransport";
import { workItemStore } from "../workItem/workItemStore";
import { loadScorer, listScorers } from "./scorerLoader";
import { shouldSampleJob, shouldAutoScore } from "./sampler";

/** Nombre del archivo de scores en el dir del job. */
export const SCORES_JSON_FILE = "scores.json";
// Turnos del juez sin timeout por fase (doctrina agentTransport): el turno
// vive hasta el fusible global GLOBAL_AGENT_FUSE_MS.

export interface ScoreJobOpts {
  /** Scoring manual: bypasea el sampler (siempre corre con inputs mínimos). */
  manual?: boolean;
}

export interface UnscoredResult {
  unscored: true;
  reason: string;
  scorer: string;
  workItemId: string;
  /** True cuando se omitió solo por sampling (elegible pero fuera de muestra). */
  skippedBySampling?: boolean;
}

/**
 * Outcome P1.5: el scorer no aplica al job todavía (el job no alcanzó la
 * etapa de ninguno de sus roles). Es un unscored ESPECIALIZADO:
 * - `unscored: true` → los flujos auto existentes lo saltan en silencio
 *   (nunca cuenta como failure: crucial para P1.4) sin tocarlos.
 * - `notApplicable: true` + `status: "not-applicable"` → E2 lo distingue
 *   del unscored genérico y lo mapea a 409 honesto en scoring manual.
 *   ORDEN DE NARROWING: chequear `isNotApplicable` ANTES que `isUnscored`.
 * Nunca se persiste (no entra a `scores.json` ni a `readScores`).
 */
export interface NotApplicableResult {
  unscored: true;
  notApplicable: true;
  status: "not-applicable";
  /** Etapas requeridas (ver `scorerRequiredStages`), para el mensaje 409. */
  requiredStages: string[];
  reason: string;
  scorer: string;
  workItemId: string;
}

/**
 * Unión rica del engine (Ola 11 + Ola 18): lo que `scoreJob` devuelve.
 * Los pacts de Ola 11 (`isUnscored`, `scores.json`, endpoints) operan sobre
 * esta unión y siguen intactos; el contrato de la Ola 18 (`ScoreOutcome`
 * con `status`) vive debajo y se obtiene vía `toScoreOutcome()`.
 */
export type ScoreJobOutcome = ScoreResult | UnscoredResult | NotApplicableResult;

/** Narrowing para `ScoreJobOutcome` (unscored clásico). Puro, nunca lanza. */
export function isUnscored(outcome: ScoreJobOutcome): outcome is UnscoredResult {
  try {
    return (
      !!outcome &&
      typeof outcome === "object" &&
      (outcome as { unscored?: unknown }).unscored === true
    );
  } catch {
    return false;
  }
}

// ── Contrato Ola 18 (P1.5/P1.7 — E2 consume estas firmas exactas) ──
//
// Nota de compatibilidad (contratos vivos, solo aditivo): el engine conserva
// su unión rica `ScoreJobOutcome = ScoreResult | UnscoredResult |
// NotApplicableResult` (los pacts de Ola 11 — `isUnscored`, persistencia en
// `scores.json`, endpoints — siguen intactos) y expone ADEMÁS el contrato de
// la Ola 18 con estos nombres exactos:
// - `ScoreOutcome`: `{status:"scored",...} | {status:"not-applicable",...}`
// - `scorerAppliesTo(stages, agents): boolean` (P1.5, gate de aplicabilidad)
// - `resolvePassing(score, passingScore): boolean` (P1.7, fuente única)
// El puente entre ambos es `toScoreOutcome()` (null = unscored interno, que
// conserva la semántica fire-and-forget de Ola 11). `SCORER_AGENT_ROLES`
// (vocabulario cerrado) vive en `shared/types/scorer.ts` junto al schema que
// lo enforcea y se re-exporta acá por conveniencia.

export { SCORER_AGENT_ROLES };

/** Etapas del job que el gate de aplicabilidad (P1.5) puede exigir. */
export interface ScorerStageFlags {
  /** El job llegó a Review (tiene lastReview o review.json). */
  review: boolean;
  /** El job tiene createdFiles (el implement escribió algo). */
  implement: boolean;
  /** El job tiene verification (la verificación corrió o intentó correr). */
  verification: boolean;
}

/**
 * Contrato E2: outcome con estado para server/UI.
 * - `scored`: el juez calificó (label/score/passing del ScoreResult).
 * - `not-applicable`: el job no alcanzó la etapa del scorer (E2 lo mapea
 *   a 409 honesto en scoring manual; en auto-score se salta en silencio).
 */
export type ScoreOutcome =
  | { status: "scored"; label: string; score: number; passing: boolean }
  | { status: "not-applicable"; requiredStages: string[] };

/**
 * Fuente ÚNICA de `passing` (P1.7): la comparación canónica que ya usaba el
 * engine (`score >= passingScore`, borde inclusivo). Todo lector
 * (`scoreJob`, `readScores`, summary) pasa por acá; lo persistido viejo se
 * re-etiqueta al leer con el `passingScore` ACTUAL del scorer.md.
 * Fail-closed ante no-finitos. Pura, nunca lanza.
 */
export function resolvePassing(score: number, passingScore: number): boolean {
  try {
    if (typeof score !== "number" || !Number.isFinite(score)) return false;
    if (typeof passingScore !== "number" || !Number.isFinite(passingScore)) {
      return false;
    }
    return score >= passingScore;
  } catch {
    return false;
  }
}

/**
 * Roles sin etapa atribuible: no dejan artefacto (lastReview/createdFiles/
 * verification) propio, así que un scorer que los incluya siempre aplica.
 * Decisión documentada (plan §5.2 + §11): gatearlos los 409earía para siempre.
 */
const SCORER_STAGELESS_ROLES: readonly string[] = ["triage", "spec", "foreman"];

/** Orden canónico de etapas (para `requiredStages` determinístico). */
const SCORER_STAGE_ORDER: ReadonlyArray<keyof ScorerStageFlags> = [
  "review",
  "implement",
  "verification",
];

function assertKnownScorerAgents(agents: unknown): asserts agents is string[] {
  if (!Array.isArray(agents)) {
    throw new Error(
      `scorer agents inválido (se esperaba string[], roles válidos: ${SCORER_AGENT_ROLES.join("|")})`,
    );
  }
  for (let i = 0; i < agents.length; i++) {
    if (!(SCORER_AGENT_ROLES as readonly string[]).includes(agents[i])) {
      throw new Error(
        `scorer agents[${i}] rol desconocido "${String(agents[i]).slice(0, 40)}" (roles válidos: ${SCORER_AGENT_ROLES.join("|")})`,
      );
    }
  }
}

/**
 * Gate de aplicabilidad P1.5 (contrato E2): true si el job alcanzó ≥1 etapa
 * de los roles del scorer (mapeo rol→etapa: `review`→stages.review,
 * `implement`→stages.implement, `verification`→stages.verification;
 * `triage|spec|foreman`→ siempre true, ver SCORER_STAGELESS_ROLES).
 * `agents` vacío → false. Rol desconocido → LANZA error accionable
 * (el schema ya lo rechaza en carga; esto es defensa en profundidad).
 * Pura salvo el throw por rol desconocido.
 */
export function scorerAppliesTo(
  stages: ScorerStageFlags,
  agents: string[],
): boolean {
  assertKnownScorerAgents(agents);
  const flags: ScorerStageFlags = {
    review: (stages as ScorerStageFlags | null | undefined)?.review === true,
    implement: (stages as ScorerStageFlags | null | undefined)?.implement === true,
    verification:
      (stages as ScorerStageFlags | null | undefined)?.verification === true,
  };
  if (agents.length === 0) return false;
  for (const role of agents) {
    if ((SCORER_STAGELESS_ROLES as readonly string[]).includes(role)) return true;
    if (role === "review" && flags.review) return true;
    if (role === "implement" && flags.implement) return true;
    if (role === "verification" && flags.verification) return true;
  }
  return false;
}

/**
 * Etapas requeridas por los roles del scorer (para el 409 honesto de E2 y
 * el `requiredStages` del not-applicable). Solo roles con etapa mapeada, en
 * orden canónico; roles sin etapa (`triage|spec|foreman`) no aportan
 * (siempre aplican). Rol desconocido → LANZA error accionable.
 * Pura salvo el throw por rol desconocido.
 */
export function scorerRequiredStages(agents: string[]): string[] {
  assertKnownScorerAgents(agents);
  const out: string[] = [];
  for (const stage of SCORER_STAGE_ORDER) {
    if (
      agents.includes(stage) &&
      !out.includes(stage)
    ) {
      out.push(stage);
    }
  }
  return out;
}

/**
 * Deriva las etapas del gate desde los inputs ya colectados del job:
 * review = hay veredicto (lastReview/review.json/timeline), implement = hay
 * createdFiles, verification = hay verification. Pura, nunca lanza.
 */
export function stagesForInputs(
  inputs: ScorerJobInputs | null | undefined,
): ScorerStageFlags {
  try {
    if (!inputs || typeof inputs !== "object") {
      return { review: false, implement: false, verification: false };
    }
    return {
      review:
        typeof inputs.reviewVerdict === "string" && inputs.reviewVerdict.length > 0,
      implement: inputs.hasCreatedFiles === true,
      verification: inputs.hasVerification === true,
    };
  } catch {
    return { review: false, implement: false, verification: false };
  }
}

/**
 * Display-only reason for any engine outcome (F4-T2, PLAN-100 PARIDAD 4.4).
 * Maps the rich union to the additive ScoreReason WITHOUT touching disk:
 * - ScoreResult → its stored scoreReason (missing/invalid reads as
 *   "unscored-legacy", never rewritten).
 * - NotApplicableResult → "not-applicable".
 * - UnscoredResult with skippedBySampling → "sampled-out".
 * - Any other unscored (judge failure, no inputs, unknown scorer, ...) →
 *   "judge-down".
 * Pure, never throws. Check isNotApplicable BEFORE isUnscored (every
 * not-applicable is also unscored by design).
 */
export function scoreReasonForOutcome(outcome: ScoreJobOutcome | unknown): ScoreReason {
  try {
    if (isNotApplicable(outcome)) return "not-applicable";
    if (!outcome || typeof outcome !== "object") return "judge-down";
    const rec = outcome as Record<string, unknown>;
    if (rec.unscored === true) {
      if ((rec as { skippedBySampling?: unknown }).skippedBySampling === true) {
        return "sampled-out";
      }
      return "judge-down";
    }
    // Scored path: honor the persisted reason, default honestly for legacy.
    return resolveScoreReason((rec as { scoreReason?: unknown }).scoreReason);
  } catch {
    return "judge-down";
  }
}

/**
 * Narrowing para el outcome P1.5. Chequear ANTES que `isUnscored` (todo
 * not-applicable es también unscored por diseño). Puro, nunca lanza.
 */
export function isNotApplicable(
  outcome: ScoreJobOutcome | unknown,
): outcome is NotApplicableResult {
  try {
    if (!outcome || typeof outcome !== "object") return false;
    const rec = outcome as Record<string, unknown>;
    return (
      rec.unscored === true &&
      rec.notApplicable === true &&
      rec.status === "not-applicable" &&
      Array.isArray(rec.requiredStages)
    );
  } catch {
    return false;
  }
}

/**
 * Puente engine → contrato E2: convierte un `ScoreJobOutcome` al
 * `ScoreOutcome` con `status`. Devuelve null ante unscored genérico
 * (sampling/LLM: conserva la semántica fire-and-forget de Ola 11 — E2 no
 * mapea nada, igual que hoy). Puro, nunca lanza.
 */
export function toScoreOutcome(outcome: ScoreJobOutcome): ScoreOutcome | null {
  try {
    if (isNotApplicable(outcome)) {
      return {
        status: "not-applicable",
        requiredStages: [...outcome.requiredStages],
      };
    }
    if (isUnscored(outcome)) return null;
    return {
      status: "scored",
      label: outcome.label,
      score: outcome.score,
      passing: outcome.passing,
    };
  } catch {
    return null;
  }
}

/**
 * Atajo manual-friendly para E2: corre `scoreJob` con `manual: true` y
 * devuelve el contrato con `status` (null = unscored genérico, sin mapeo).
 * Nunca lanza (imprevistos → null).
 */
export async function scoreJobStatus(
  workItemId: string,
  scorerName: string,
): Promise<ScoreOutcome | null> {
  try {
    return toScoreOutcome(await scoreJob(workItemId, scorerName, { manual: true }));
  } catch {
    return null;
  }
}

// ── Inputs del job (prompt slice, createdFiles, verification, review) ──

export interface ScorerJobInputs {
  workItemId: string;
  promptSlice: string;
  createdFiles: string[];
  verification: VerificationReport | null;
  verificationSummary: string;
  reviewVerdict: string | null;
  reviewSummary: string | null;
  hasResultJson: boolean;
  hasVerification: boolean;
  hasCreatedFiles: boolean;
}

function asStringArray(value: unknown, cap: number): string[] {
  try {
    if (!Array.isArray(value)) return [];
    return (value as unknown[])
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .slice(0, cap);
  } catch {
    return [];
  }
}

/**
 * Lee los inputs del job para el juez: prompt (slice), createdFiles y
 * verification desde la meta del timeline (con fallback a `result.json`),
 * más el veredicto del review si hay (`lastReview`, meta o `review.json`).
 * Null si el job no existe. Best-effort: nunca lanza.
 */
export function collectScorerInputs(workItemId: string): ScorerJobInputs | null {
  try {
    if (typeof workItemId !== "string" || workItemId.length === 0) return null;
    const wi = workItemStore.get(workItemId);
    if (!wi) return null;
    const promptSlice = String(wi.prompt ?? "").slice(0, 2000);
    let createdFiles: string[] = [];
    let verification: VerificationReport | null = null;
    let reviewVerdict: string | null = null;
    let reviewSummary: string | null = null;
    try {
      const timeline = Array.isArray(wi.timeline) ? wi.timeline : [];
      for (let i = timeline.length - 1; i >= 0; i--) {
        const meta = timeline[i]?.meta as Record<string, unknown> | undefined;
        if (!meta || typeof meta !== "object") continue;
        if (createdFiles.length === 0 && Array.isArray(meta.createdFiles)) {
          createdFiles = asStringArray(meta.createdFiles, 50);
        }
        if (!verification && meta.verification && typeof meta.verification === "object") {
          const v = meta.verification as Record<string, unknown>;
          if (v.overall === "pass" || v.overall === "fail") {
            verification = meta.verification as VerificationReport;
          }
        }
        if (!reviewVerdict) {
          const review = meta.review as Record<string, unknown> | undefined;
          if (review && typeof review === "object" && typeof review.verdict === "string") {
            reviewVerdict = review.verdict;
            if (typeof review.summary === "string") reviewSummary = review.summary.slice(0, 500);
          }
        }
        if (createdFiles.length > 0 && verification && reviewVerdict) break;
      }
    } catch {
      // timeline ilegible: se sigue con fallbacks de disco
    }
    const dir =
      typeof wi.dir === "string" && wi.dir.length > 0 ? wi.dir : null;
    let hasResultJson = false;
    if (dir) {
      // Fallback a result.json (tolerante, sin zod: no perder campos futuros).
      try {
        const resultPath = path.join(dir, "result.json");
        if (fs.existsSync(resultPath)) {
          hasResultJson = true;
          try {
            const parsed = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as Record<
              string,
              unknown
            >;
            if (createdFiles.length === 0) {
              createdFiles = asStringArray(parsed.createdFiles, 50);
            }
            if (!verification && parsed.verification && typeof parsed.verification === "object") {
              const v = parsed.verification as Record<string, unknown>;
              if (v.overall === "pass" || v.overall === "fail") {
                verification = parsed.verification as VerificationReport;
              }
            }
          } catch {
            // result.json corrupto: hasResultJson ya quedó marcado
          }
        }
      } catch {
        // sin acceso a disco
      }
      // lastReview del store + review.json como fuentes del veredicto.
      if (!reviewVerdict) {
        try {
          const lastReview = (wi as unknown as { lastReview?: unknown }).lastReview as
            | Record<string, unknown>
            | undefined;
          if (lastReview && typeof lastReview.verdict === "string") {
            reviewVerdict = lastReview.verdict;
            if (typeof lastReview.summary === "string") {
              reviewSummary = lastReview.summary.slice(0, 500);
            }
          }
        } catch {
          // sin lastReview
        }
      }
      if (!reviewVerdict) {
        try {
          const reviewPath = path.join(dir, "review.json");
          if (fs.existsSync(reviewPath)) {
            const parsed = JSON.parse(fs.readFileSync(reviewPath, "utf-8")) as Record<
              string,
              unknown
            >;
            if (typeof parsed.verdict === "string") reviewVerdict = parsed.verdict;
            if (typeof parsed.summary === "string") {
              reviewSummary = parsed.summary.slice(0, 500);
            }
          }
        } catch {
          // sin review.json legible
        }
      }
    }
    const hasVerification = verification !== null;
    const hasCreatedFiles = createdFiles.length > 0;
    return {
      workItemId,
      promptSlice,
      createdFiles,
      verification,
      verificationSummary: verification
        ? `overall=${verification.overall} steps=${(verification.steps ?? [])
            .map((s) => `${s.name}:${s.status}(exit ${s.exitCode ?? "null"})`)
            .join(", ")}`
        : "(sin verificación)",
      reviewVerdict,
      reviewSummary,
      hasResultJson,
      hasVerification,
      hasCreatedFiles,
    };
  } catch {
    return null;
  }
}

/**
 * Inputs mínimos para juzgar: createdFiles no vacío O verificación presente.
 * Sin esto el juez no tiene evidencia → unscored SIN llamar al LLM.
 * Puro, nunca lanza.
 */
export function hasMinimumScorerInputs(
  inputs: ScorerJobInputs | null | undefined,
): boolean {
  try {
    if (!inputs || typeof inputs !== "object") return false;
    return inputs.hasCreatedFiles === true || inputs.hasVerification === true;
  } catch {
    return false;
  }
}

// ── Prompt del juez + json_schema ──

/**
 * Construye el prompt del juez: instrucciones versionadas del scorer.md +
 * evidencia del job. Los labels se listan SIN scores (el mapeo label→score
 * lo hace el engine, el juez solo elige etiqueta). Puro, nunca lanza.
 */
export function buildScorerPrompt(
  definition: ScorerDefinition,
  instructions: string,
  inputs: ScorerJobInputs,
): string {
  try {
    const labelList = definition.labels
      .map(
        (l) =>
          `- ${l.value}${l.description ? `: ${l.description.slice(0, 200)}` : ""}`,
      )
      .join("\n");
    const filesBlock =
      inputs.createdFiles.length > 0
        ? inputs.createdFiles.slice(0, 20).map((f) => `- ${f}`).join("\n")
        : "(sin archivos registrados)";
    const evidenceEntries = inputs.verification?.evidence ?? [];
    const evidenceBlock =
      evidenceEntries.length > 0
        ? evidenceEntries
            .slice(0, 10)
            .map(
              (e) =>
                `- [${e.kind}/${e.status}]${e.ref ? ` ref=${e.ref.slice(0, 120)}` : ""} ${e.summary.slice(0, 200)}`,
            )
            .join("\n")
        : "(sin evidencia adjunta)";
    const reviewBlock = inputs.reviewVerdict
      ? `verdict=${inputs.reviewVerdict}${inputs.reviewSummary ? ` summary="${inputs.reviewSummary.slice(0, 300)}"` : ""}`
      : "(el job aún no llegó a Review o no hay veredicto registrado)";
    return [
      `Sos el JUEZ del scorer "${definition.name}". Respondés UNA sola pregunta con UNA etiqueta.`,
      "",
      `Definición versionada (factory/scorers/${definition.name}/scorer.md — ${definition.description}):`,
      instructions.trim(),
      "",
      "---",
      "",
      `WorkItem: ${inputs.workItemId}`,
      `Prompt original (slice): """${inputs.promptSlice || "(vacío)"}"""`,
      `CreatedFiles:\n${filesBlock}`,
      `Verification: ${inputs.verificationSummary}`,
      `Evidencia de verificación:\n${evidenceBlock}`,
      `Review: ${reviewBlock}`,
      "",
      "Etiquetas permitidas (elegí EXACTAMENTE una):",
      labelList,
      "",
      'INSTRUCCIÓN DE FORMATO ESTRICTA: Responde SOLO JSON válido, sin texto antes ni después, keys exactas {"label","reason"}. Sin markdown, sin fences, sin explicación fuera del JSON.',
      "",
      "Juzgá ahora y devolvé el JSON:",
    ].join("\n");
  } catch {
    return `{"label":"","reason":"prompt build fallo"}`;
  }
}

/**
 * json_schema strict para session.prompt: `{label (enum), reason}`.
 * El enum sale de los labels del scorer. Puro, nunca lanza.
 */
export function scorerJsonSchemaFor(definition: ScorerDefinition): {
  type: "object";
  properties: {
    label: { type: "string"; enum: string[]; description: string };
    reason: { type: "string"; description: string };
  };
  required: ["label", "reason"];
  additionalProperties: false;
} {
  let values: string[] = [];
  try {
    values = definition.labels.map((l) => l.value);
  } catch {
    values = [];
  }
  return {
    type: "object",
    properties: {
      label: {
        type: "string",
        enum: values,
        description: `Etiqueta del scorer "${definition?.name ?? "?"}": elegí exactamente una`,
      },
      reason: {
        type: "string",
        description: "Justificación breve (1-2 frases) citando la evidencia del job",
      },
    },
    required: ["label", "reason"],
    additionalProperties: false,
  };
}

/**
 * Parsea la respuesta cruda del juez (strip fences, primer `{` último `}`)
 * y valida `{label ∈ enum, reason no vacío}`. Lanza si es inválida — el
 * caller convierte a unscored (nunca se inventa un score).
 */
export function parseScorerLLMResponse(
  raw: string,
  definition: ScorerDefinition,
): { label: string; reason: string } {
  if (!raw || typeof raw !== "string") throw new Error("scorer LLM response vacía");
  let s = raw.trim();
  if (s.length === 0) throw new Error("scorer LLM response vacía");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    s = fence[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.substring(first, last + 1).trim();
  }
  if (!s.startsWith("{") || !s.endsWith("}")) {
    throw new Error(`scorer JSON parse error: no object — raw=${raw.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new Error(
      `scorer JSON parse error: ${e instanceof Error ? e.message : String(e)} — raw=${raw.slice(0, 200)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("scorer JSON parse error: no object");
  }
  const rec = parsed as Record<string, unknown>;
  const label = typeof rec.label === "string" ? rec.label.trim() : "";
  const allowed = definition.labels.map((l) => l.value);
  if (!label || !allowed.includes(label)) {
    throw new Error(
      `scorer label inválido "${String(rec.label ?? "").slice(0, 60)}" (permitidos: ${allowed.join("|")})`,
    );
  }
  const reason = typeof rec.reason === "string" ? rec.reason.trim() : "";
  if (!reason) throw new Error("scorer reason vacío");
  return { label, reason: reason.slice(0, 2000) };
}

// ── Esqueleto LLM (transporte único en ../llm/agentTransport) ──

let sdkCache: boolean | null = null;
async function hasSdk(): Promise<boolean> {
  if (sdkCache !== null) return sdkCache;
  try {
    await import("@opencode-ai/sdk");
    sdkCache = true;
    return true;
  } catch {}
  try {
    await import("@opencode-ai/sdk/v2");
    sdkCache = true;
    return true;
  } catch {
    sdkCache = false;
    return false;
  }
}

/**
 * Errores de transporte donde el reenvío es seguro (la request nunca se
 * estableció). Delega en el módulo único (agentTransport): el fallo acá es
 * `unscored`, no `ask_human`, pero la física del reenvío es la misma —
 * timeout/abort es FALSE (el juez seguía pensando: reenviar duplica).
 * Se mantiene el export por compatibilidad (tests + callers).
 */
export function isRetryableScorerError(msg: string): boolean {
  try {
    return isRetryableTransportError(msg);
  } catch {
    return false;
  }
}

/** Extracción de texto y errores: viven en el módulo único agentTransport. */

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "");
}

export interface ScorerPromptMockInput {
  workItemId: string;
  scorerName: string;
  prompt: string;
  model: string;
}

/** Test seam: permite inyectar respuesta del juez sin red (igual que reviewAgent). */
let scorerPromptMock:
  | ((input: ScorerPromptMockInput) => Promise<string | null>)
  | null = null;
export function setScorerPromptMock(
  fn: ((input: ScorerPromptMockInput) => Promise<string | null>) | null,
): void {
  scorerPromptMock = fn;
}

/** Modelo efectivo del juez: el del scorer.md, o el builder default. Nunca lanza. */
export function resolveScorerModel(modelRef: string): {
  providerID: string;
  modelID: string;
  modelStr: string;
  fromDefault: boolean;
} | null {
  try {
    const direct = parseModelRef(modelRef);
    if (direct) {
      return {
        providerID: direct.providerID,
        modelID: direct.modelID,
        modelStr: `${direct.providerID}/${direct.modelID}`,
        fromDefault: false,
      };
    }
    let builder = "";
    try {
      builder = getDefaultModels().builder;
    } catch {
      builder = "";
    }
    const fallback = parseModelRef(builder);
    if (fallback) {
      return {
        providerID: fallback.providerID,
        modelID: fallback.modelID,
        modelStr: `${fallback.providerID}/${fallback.modelID}`,
        fromDefault: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── scoreJob ──

/**
 * Califica un job con un scorer.
 * - Sin inputs mínimos (ni createdFiles ni verification) → unscored SIN LLM.
 * - Sin `manual`, fuera de muestra → unscored `skippedBySampling` SIN LLM.
 * - Fallo LLM (timeout/server/parse/cuota) → unscored, NUNCA inventa score.
 * - Éxito → ScoreResult persistido (scores.json + evento) y devuelto.
 * Nunca lanza: cualquier imprevisto es unscored con razón visible.
 */
export async function scoreJob(
  workItemId: string,
  scorerName: string,
  opts?: ScoreJobOpts,
): Promise<ScoreJobOutcome> {
  const manual = opts?.manual === true;
  const unscored = (
    reason: string,
    skippedBySampling = false,
  ): UnscoredResult => ({
    unscored: true as const,
    reason: reason.slice(0, 300),
    scorer: String(scorerName ?? ""),
    workItemId: String(workItemId ?? ""),
    ...(skippedBySampling ? { skippedBySampling: true as const } : {}),
  });
  try {
    const loaded = loadScorer(scorerName);
    if (!loaded) return unscored(`scorer no encontrado o inválido: ${scorerName}`);
    const definition = loaded.definition;
    const wi = workItemStore.get(workItemId);
    if (!wi) return unscored(`job not found: ${workItemId}`);
    const inputs = collectScorerInputs(workItemId);
    if (!inputs || !hasMinimumScorerInputs(inputs)) {
      return unscored(
        "sin inputs mínimos (sin createdFiles ni verification): no se llama al juez",
      );
    }
    // Ola 18 P1.5: gate de aplicabilidad. Fuera de alcance → not-applicable
    // (E2 lo mapea a 409 en manual); en auto se salta en silencio arriba
    // (nunca persiste, nunca cuenta como failure). Sin llamada LLM.
    if (!scorerAppliesTo(stagesForInputs(inputs), definition.agents)) {
      const requiredStages = scorerRequiredStages(definition.agents);
      const need =
        requiredStages.length > 0 ? requiredStages.join("+") : "etapa del scorer";
      return {
        unscored: true as const,
        notApplicable: true as const,
        status: "not-applicable" as const,
        requiredStages,
        reason: `scorer "${definition.name}" no aplica a ${workItemId} todavía (requiere ${need})`.slice(0, 300),
        scorer: definition.name,
        workItemId,
      };
    }
    if (!manual && !shouldSampleJob(workItemId, definition.samplingRate)) {
      return unscored(
        `omitido por sampling (hash%100 >= ${definition.samplingRate}): usar scoring manual`,
        true,
      );
    }
    const resolved = resolveScorerModel(definition.model);
    if (!resolved) {
      return unscored(
        `modelo del scorer inválido ("${definition.model}") y sin default usable`,
      );
    }
    const promptText = withPhaseTag(
      buildScorerPrompt(definition, loaded.instructions, inputs),
      tagScorer(definition.name, manual),
    );
    const origin = manual ? "manual" : "sampled";

    // Camino mock (tests / suites sin red): nunca toca el server real.
    if (scorerPromptMock) {
      let mocked: string | null = null;
      try {
        mocked = await scorerPromptMock({
          workItemId,
          scorerName: definition.name,
          prompt: promptText,
          model: resolved.modelStr,
        });
        if (!mocked) return unscored("mock del juez sin respuesta");
        const parsed = parseScorerLLMResponse(mocked, definition);
        const score = scoreForLabel(definition, parsed.label);
        if (score === null) return unscored(`mock con label desconocido: ${parsed.label}`);
        const result: ScoreResult = {
          scorer: definition.name,
          workItemId,
          label: parsed.label,
          score,
          passing: resolvePassing(score, definition.passingScore),
          reason: parsed.reason,
          model: resolved.modelStr,
          origin,
          at: new Date().toISOString(),
          // F4-T2: additive display-only reason (judge graded this job).
          scoreReason: "scored",
        };
        persistScoreResult(result);
        return result;
      } catch (e) {
        return unscored(`mock/parse del juez falló: ${errMsg(e).slice(0, 160)}`);
      }
    }

    const ok = await hasSdk();
    if (!ok) return unscored("SDK no detectado: sin gastar LLM");

    let client: {
      session: {
        create: (o: unknown) => Promise<unknown>;
        prompt?: (a: unknown, b?: unknown) => Promise<unknown>;
        promptAsync?: (o: unknown) => Promise<unknown>;
      };
    };
    try {
      client = (await opencodeServerManager.ensureClient()) as unknown as typeof client;
    } catch (e) {
      const existing = opencodeServerManager.getClient() as unknown as typeof client | null;
      if (!existing) {
        return unscored(`opencode server no disponible: ${errMsg(e).slice(0, 140)}`);
      }
      client = existing;
    }

    let directory = process.cwd();
    try {
      directory = path.resolve(wi.worktree);
    } catch {
      directory = process.cwd();
    }
    const title = `Scorer ${definition.name} ${workItemId}`;
    // Ola 16: create extraído a closure byte a byte (título, directorio,
    // doble forma y extracción intactos). El fallo LANZA el MISMO mensaje que
    // antes iba al unscored, marcado con el prefijo
    // `scorer session.create falló:` para devolverlo byte a byte abajo.
    // El camino mock previo no se toca (primera llamada sin guardada = flujo
    // viejo: los mocks del juez existentes siguen válidos).
    const createScorerSession = async (): Promise<string> => {
      let sessionId: string | null = null;
      try {
        const res: unknown = await withTransportRetry(
          () => client.session.create({ title, directory }),
          SESSION_CREATE_FUSE_MS,
          "scorer session.create",
        );
        sessionId = parseSessionId(res);
        if (!sessionId) throw new Error("session.create sin sessionId");
      } catch {
        try {
          const res2: unknown = await withTransportRetry(
            () => client.session.create({ body: { title, directory } }),
            SESSION_CREATE_FUSE_MS,
            "scorer session.create body",
          );
          sessionId = parseSessionId(res2);
          if (!sessionId) throw new Error("session.create sin sessionId (fallback)");
        } catch (e2) {
          throw new Error(`scorer session.create falló: ${errMsg(e2).slice(0, 140)}`);
        }
      }
      if (!sessionId) throw new Error("scorer session.create falló: session.create sin sessionId");
      return sessionId;
    };

    const sessionAny = client.session as unknown as Record<string, unknown>;
    const promptFn = sessionAny.prompt as
      | ((a: unknown, b?: unknown) => Promise<unknown>)
      | undefined;
    const promptAsyncFn = sessionAny.promptAsync as
      | ((o: unknown) => Promise<unknown>)
      | undefined;
    if (typeof promptFn !== "function" && typeof promptAsyncFn !== "function") {
      return unscored("session.prompt no disponible");
    }

    const body = {
      model: { providerID: resolved.providerID, modelID: resolved.modelID },
      parts: [{ type: "text", text: promptText }],
      json_schema: scorerJsonSchemaFor(definition),
    };

    // UN solo intento por turno (doctrina agentTransport): la escalera vieja
    // (sync → sync legacy idéntico → async → async legacy idéntico) reenviaba
    // el mismo prompt hasta 4 veces por llamada — con timeouts cortos, cada
    // reenvío clonaba el mensaje en la sesión. promptAsync devuelve un
    // handle sin texto: solo se usa cuando promptFn no existe.
    // Ola 16: la escalera toma sid (no cierra sobre sessionId). YA devolvía
    // {raw,lastErr} sin tragar (el not-found viaja en lastErr): promptWith
    // lo RELANZA para la renovación lazy. Sin cambios de variantes.
    // El costo de Ola 15 queda ADENTRO de promptWith (1 llamada lógica del
    // juez = 1 conteo; mock/sampling/sin-inputs previos no usan LLM: 0).
    const runScorerLadder = async (sid: string): Promise<{ raw: string | null; lastErr: unknown }> => {
      if (typeof promptFn === "function") {
        // Plano SDK 1.18.18 (ver reviewAgent.buildReviewPromptPayload):
        // el envelope {path,body} se dropea y hace 500 instantáneo.
        const out = await attemptPromptOnce(
          (signal) =>
            (promptFn as (a: unknown, b: unknown) => Promise<unknown>).call(
              client.session,
              { sessionID: sid, ...body },
              { signal },
            ),
          { label: "scorer session.prompt", preferKey: "label", jobId: workItemId, sessionId: sid },
        );
        return { raw: out.raw, lastErr: out.lastErr };
      }
      if (typeof promptAsyncFn === "function") {
        const out = await attemptPromptOnce(
          () =>
            // Plano SDK 1.18.18 (mismo motivo que arriba).
            (promptAsyncFn as (o: unknown) => Promise<unknown>).call(client.session, {
              sessionID: sid,
              ...body,
            }),
          { label: "scorer session.promptAsync", preferKey: "label", jobId: workItemId, sessionId: sid },
        );
        return { raw: out.raw, lastErr: out.lastErr };
      }
      return { raw: null, lastErr: new Error("session.prompt no disponible") };
    };
    // Ola 16: promptWith lleva el costo adentro (ortogonal) y re-lanza
    // not-found para renovación UNA vez; cualquier otro null/fallo cae al
    // unscored sano.
    const promptWithScorerSession = async (
      sid: string,
    ): Promise<{ raw: string | null; lastErr: unknown }> => {
      let out: { raw: string | null; lastErr: unknown };
      try {
        out = await promptInSessionWithCost(workItemId, () => runScorerLadder(sid), promptText, body.model);
      } catch (e) {
        out = { raw: null, lastErr: e };
      }
      if (out.raw) return out;
      if (isSessionNotFoundError(out.lastErr)) throw out.lastErr;
      return out;
    };
    let ladderOut: { raw: string | null; lastErr: unknown };
    try {
      // Jueces STATELESS (fix #69): sesión fresca por scoring, NUNCA reusar
      // la del reviewer (`job::review`). Reusarla contaminaba la conversación
      // con prompts de jueces incompatibles (3 mensajes juez seguidos en la
      // sesión del review) y ensuciaba futuros re-reviews. Cotas Regla 7:
      // ≤1 create y ≤2 prompts por llamada (create + 1 retry not-found).
      const freshSid = await createScorerSession();
      try {
        ladderOut = await promptWithScorerSession(freshSid);
      } catch (e) {
        if (!isSessionNotFoundError(e)) throw e;
        const retrySid = await createScorerSession();
        ladderOut = await promptWithScorerSession(retrySid);
      }
    } catch (e) {
      ladderOut = { raw: null, lastErr: e };
    }
    const raw = ladderOut.raw;
    const lastErr = ladderOut.lastErr;
    if (!raw) {
      const createMsg = errMsg(lastErr || "sin respuesta");
      // Ola 16: el create marcado ya trae el unscored final byte a byte.
      if (createMsg.startsWith("scorer session.create falló:")) return unscored(createMsg);
      return unscored(
        `juez LLM falló: ${createMsg.slice(0, 160)}`,
      );
    }
    try {
      const parsed = parseScorerLLMResponse(raw, definition);
      const score = scoreForLabel(definition, parsed.label);
      if (score === null) return unscored(`juez con label desconocido: ${parsed.label}`);
      const result: ScoreResult = {
        scorer: definition.name,
        workItemId,
        label: parsed.label,
        score,
        passing: resolvePassing(score, definition.passingScore),
        reason: parsed.reason,
        model: resolved.modelStr,
        origin,
        at: new Date().toISOString(),
        // F4-T2: additive display-only reason (judge graded this job).
        scoreReason: "scored",
      };
      persistScoreResult(result);
      return result;
    } catch (e) {
      return unscored(`juez zod/parse falló: ${errMsg(e).slice(0, 160)}`);
    }
  } catch (e) {
    return {
      unscored: true as const,
      reason: `scorer unexpected: ${errMsg(e).slice(0, 160)}`,
      scorer: String(scorerName ?? ""),
      workItemId: String(workItemId ?? ""),
    };
  }
}

// ── Persistencia: scores.json (tmp→rename) + evento timeline ──

/**
 * Persiste un ScoreResult: merge `{[scorer]: result}` en `scores.json`
 * (tmp + rename atómico, best-effort) + evento timeline con meta
 * `{scores: {[scorer]: result}}`. Re-score REEMPLAZA, no acumula.
 * Nunca lanza (devuelve false si no pudo).
 */
export function persistScoreResult(result: ScoreResult): boolean {
  try {
    if (!result || typeof result !== "object") return false;
    if (!result.workItemId || !result.scorer) return false;
    const wi = workItemStore.get(result.workItemId);
    if (!wi) return false;
    const dir = wi.dir as string | null | undefined;
    if (typeof dir !== "string" || dir.length === 0) return false;
    // F4-T2 display-only rule: merge from the RAW scores.json bytes (never
    // from readScores, which resolves "unscored-legacy" in memory). This keeps
    // legacy entries without scoreReason untouched on disk — history is never
    // rewritten; only the new/updated scorer key carries its reason.
    let current: Record<string, ScoreResult> = {};
    try {
      const rawDir = wi.dir as string | null | undefined;
      if (typeof rawDir === "string" && rawDir.length > 0) {
        const rawTarget = path.join(rawDir, SCORES_JSON_FILE);
        if (fs.existsSync(rawTarget)) {
          const rawParsed = JSON.parse(fs.readFileSync(rawTarget, "utf-8")) as Record<
            string,
            unknown
          >;
          if (rawParsed && typeof rawParsed === "object") {
            for (const [key, value] of Object.entries(rawParsed)) {
              const parsed = safeParseScoreResult(value);
              if (parsed && key === parsed.scorer) current[key] = parsed;
            }
          }
        }
      }
    } catch {
      current = {};
    }
    const next: Record<string, ScoreResult> = {
      ...current,
      [result.scorer]: result,
    };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, SCORES_JSON_FILE);
      const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
      fs.renameSync(tmp, target);
    } catch {
      return false;
    }
    try {
      workItemStore.appendEvent(
        result.workItemId,
        "system",
        `score ${result.scorer}=${result.label} (${result.passing ? "passing" : "failing"}) — ${result.reason.slice(0, 120)}`,
        { scores: { [result.scorer]: result } } as unknown as Record<string, unknown>,
      );
    } catch {
      // scores.json ya quedó: el evento es auditoría best-effort
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Lee los scores de un job: merge de eventos timeline `{scores: {...}}`
 * (el último por scorer gana) + `scores.json` (gana sobre el timeline).
 * `{}` si no hay nada. Cada entrada se valida con zod; las inválidas se
 * omiten. Nunca lanza.
 *
 * Ola 18 P1.7 (threshold display-only): el `passing` se RECOMPUTA al leer
 * con el `passingScore` ACTUAL del scorer.md (vía `resolvePassing`, fuente
 * única). Lo persistido viejo se re-etiqueta solo; el disco queda INTACTO
 * (esta función nunca escribe). Si el scorer ya no carga, se conserva lo
 * persistido tal cual.
 */
export function readScores(workItemId: string): Record<string, ScoreResult> {
  const out: Record<string, ScoreResult> = {};
  try {
    if (typeof workItemId !== "string" || workItemId.length === 0) return out;
    const wi = workItemStore.get(workItemId);
    if (!wi) return out;
    try {
      const timeline = Array.isArray(wi.timeline) ? wi.timeline : [];
      for (const entry of timeline) {
        const meta = entry?.meta as Record<string, unknown> | undefined;
        if (!meta || typeof meta !== "object") continue;
        const scores = meta.scores as Record<string, unknown> | undefined;
        if (!scores || typeof scores !== "object") continue;
        for (const [key, value] of Object.entries(scores)) {
          const parsed = safeParseScoreResult(value);
          if (parsed && key === parsed.scorer) out[key] = parsed;
        }
      }
    } catch {
      // timeline ilegible
    }
    try {
      const dir = wi.dir as string | null | undefined;
      if (typeof dir === "string" && dir.length > 0) {
        const target = path.join(dir, SCORES_JSON_FILE);
        if (fs.existsSync(target)) {
          const fileParsed = JSON.parse(fs.readFileSync(target, "utf-8")) as Record<
            string,
            unknown
          >;
          if (fileParsed && typeof fileParsed === "object") {
            for (const [key, value] of Object.entries(fileParsed)) {
              const parsed = safeParseScoreResult(value);
              if (parsed && key === parsed.scorer) out[key] = parsed;
            }
          }
        }
      }
    } catch {
      // scores.json ilegible: vale lo del timeline
    }
    // Ola 18 P1.7: re-etiqueta en memoria con el threshold actual (disco intacto).
    // F4-T2 note: scoreReason is intentionally NOT defaulted here. Legacy
    // entries keep their stored shape (no scoreReason key); display layers
    // resolve them via resolveScoreReason() to "unscored-legacy" in memory
    // only. Defaulting here would break round-trip fidelity and risk writing
    // the resolved value back on the next persist (history must never be
    // rewritten). This function never writes.
    for (const [key, entry] of Object.entries(out)) {
      try {
        const loaded = loadScorer(key);
        if (!loaded) continue;
        const fixed = resolvePassing(entry.score, loaded.definition.passingScore);
        if (fixed !== entry.passing) out[key] = { ...entry, passing: fixed };
      } catch {
        // scorer ilegible: se conserva lo persistido
      }
    }
    return out;
  } catch {
    return out;
  }
}

function safeParseScoreResult(value: unknown): ScoreResult | null {
  try {
    if (!value || typeof value !== "object") return null;
    const rec = value as Record<string, unknown>;
    if (typeof rec.scorer !== "string" || typeof rec.workItemId !== "string") return null;
    if (typeof rec.label !== "string" || typeof rec.score !== "number") return null;
    if (typeof rec.passing !== "boolean" || typeof rec.reason !== "string") return null;
    if (typeof rec.model !== "string") return null;
    if (rec.origin !== "sampled" && rec.origin !== "manual") return null;
    if (typeof rec.at !== "string") return null;
    // F4-T2 additive: preserve a valid stored scoreReason; leave missing or
    // invalid absent here (readScores resolves "unscored-legacy" in memory
    // only, so raw disk bytes are never rewritten by the resolution).
    const out: ScoreResult = {
      scorer: rec.scorer,
      workItemId: rec.workItemId,
      label: rec.label,
      score: rec.score,
      passing: rec.passing,
      reason: rec.reason,
      model: rec.model,
      origin: rec.origin,
      at: rec.at,
    };
    try {
      const rawReason = (rec as { scoreReason?: unknown }).scoreReason;
      if (typeof rawReason === "string" && resolveScoreReason(rawReason) === rawReason) {
        out.scoreReason = rawReason as ScoreResult["scoreReason"];
      }
    } catch {
      // reason ilegible: se deja ausente (lectura lo resuelve en memoria)
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Resumen agregado best-effort (máx 100 jobs): por scorer
 * `{scored, passing, failing, passRate}`. Nunca lanza.
 */
export function getScoresSummary(
  maxJobs = 100,
): import("../../shared/types/scorer").ScoresSummary {
  const empty = { scorers: {} } as import("../../shared/types/scorer").ScoresSummary;
  try {
    const limit =
      Number.isInteger(maxJobs) && (maxJobs as number) > 0
        ? Math.min(maxJobs as number, 100)
        : 100;
    let jobs: Array<{ id: string }>;
    try {
      jobs = workItemStore.list().slice(0, limit);
    } catch {
      return empty;
    }
    const acc: Record<string, { scored: number; passing: number; failing: number }> = {};
    for (const job of jobs) {
      try {
        const scores = readScores(job.id);
        for (const [name, result] of Object.entries(scores)) {
          if (!acc[name]) acc[name] = { scored: 0, passing: 0, failing: 0 };
          acc[name].scored += 1;
          if (result.passing) acc[name].passing += 1;
          else acc[name].failing += 1;
        }
      } catch {
        // job ilegible: se saltea
      }
    }
    const scorers: Record<string, { scored: number; passing: number; failing: number; passRate: number }> = {};
    for (const [name, entry] of Object.entries(acc)) {
      const passRate =
        entry.scored === 0 ? 0 : Math.round((entry.passing / entry.scored) * 10000) / 10000;
      scorers[name] = { ...entry, passRate };
    }
    return { scorers };
  } catch {
    return empty;
  }
}

/**
 * Auto-scoring de un job completado: corre cada scorer cuyo sampling
 * incluye a este job (determinístico por id). Best-effort total: nunca
 * lanza, nunca bloquea al llamador (pensado para fire-and-forget tras
 * Complete). Jobs no elegibles o fuera de muestra se saltean en silencio.
 *
 * Ola 18 P1.4: al terminar, dispara el trigger de auto-propose por scorer
 * (`maybeAutoProposeForScorer`, best-effort; nunca adopta solo — regla 4).
 */
export async function autoScoreCompletedJob(workItemId: string): Promise<void> {
  try {
    if (typeof workItemId !== "string" || workItemId.length === 0) return;
    let defs: ScorerDefinition[] = [];
    try {
      defs = listScorers();
    } catch {
      return;
    }
    for (const def of defs) {
      try {
        const rate =
          typeof def.samplingRate === "number" && Number.isInteger(def.samplingRate)
            ? def.samplingRate
            : 0;
        if (!shouldAutoScore(workItemId, rate)) continue;
        await scoreJob(workItemId, def.name);
      } catch {
        // un scorer roto no frena a los demás
      }
    }
    for (const def of defs) {
      try {
        await maybeAutoProposeForScorer(def.name);
      } catch {
        // el trigger es best-effort: nunca rompe el auto-score
      }
    }
  } catch {
    // nunca lanzar
  }
}

// ── Trigger P1.4: auto-propose ante failures nuevos (Ola 18) ──

export interface AutoProposeDecision {
  proposed: boolean;
  reason: string;
  proposalId?: string;
}

/**
 * Trigger de self-improvement automático (P1.4): por scorer con
 * `selfImprovement: true` en su md + ≥2 failures NUEVOS + cupo de
 * `improveProposalCooldown` propuestas `pending|ready` abiertas → crea UNA
 * propuesta con EL MISMO engine de análisis existente (`createProposal`:
 * cero código nuevo de análisis; nunca adopta solo — regla 4 intacta).
 *
 * Semántica exacta de "NUEVO": failures (`passing=false`) con `at` posterior
 * al `createdAt` de la última propuesta de ESE scorer (cualquier estado);
 * si el scorer nunca tuvo propuesta, TODOS sus failures cuentan. Un `at`
 * inparseable no cuenta como nuevo (fail-closed: evita tormentas).
 *
 * Semántica exacta del cooldown: si las propuestas abiertas (`pending` o
 * `ready`) del scorer ya llegan a `improveProposalCooldown` (yaml, default
 * 1; 0 = auto-propose apagado), no se crea nada.
 *
 * Cotas (Regla 7): ≤1 `createProposal` por scorer por corrida (esta
 * función crea como máximo una) + cooldown persistido + tests. La
 * propuesta auto deja la MISMA traza que la manual (Regla 5: mismo
 * `.proposals/<id>.json` del engine existente).
 *
 * Vive acá (no en improvementEngine) para no crear un ciclo estático de
 * imports (improvementEngine ya importa este módulo): el engine de mejora
 * se carga con import dinámico, solo en este camino. Best-effort total:
 * nunca lanza (imprevistos → `{proposed:false}`).
 */
export async function maybeAutoProposeForScorer(
  scorerName: string,
): Promise<AutoProposeDecision> {
  const no = (reason: string): AutoProposeDecision => ({
    proposed: false,
    reason: reason.slice(0, 200),
  });
  try {
    const clean = typeof scorerName === "string" ? scorerName.trim() : "";
    if (!clean) return no("scorer vacío");
    const loaded = loadScorer(clean);
    if (!loaded) return no(`scorer no encontrado o inválido: ${clean}`);
    const canonical = loaded.definition.name;
    if (loaded.definition.selfImprovement !== true) {
      return no(`selfImprovement apagado en ${canonical} (scoring manual como hoy)`);
    }
    let cooldown = 1;
    try {
      cooldown = getImproveProposalCooldown();
    } catch {
      cooldown = 1;
    }
    if (!Number.isInteger(cooldown) || cooldown < 1) {
      return no(`improveProposalCooldown=${String(cooldown)} (0 = auto-propose apagado)`);
    }
    let improve: typeof import("./improvementEngine");
    try {
      improve = await import("./improvementEngine");
    } catch (e) {
      return no(
        `motor de mejora no disponible: ${e instanceof Error ? e.message : String(e).slice(0, 80)}`,
      );
    }
    let mine: ImprovementProposal[];
    try {
      mine = improve
        .listProposals()
        .filter((p) => p && p.scorer === canonical);
    } catch {
      return no("no se pudieron listar propuestas");
    }
    let open = 0;
    let sinceMs = -1;
    for (const p of mine) {
      try {
        if (p.status === "pending" || p.status === "ready") open += 1;
        const ms = Date.parse(p.createdAt);
        if (Number.isFinite(ms) && ms > sinceMs) sinceMs = ms;
      } catch {
        // propuesta ilegible: se ignora
      }
    }
    if (open >= cooldown) {
      return no(
        `cooldown: ${open} propuesta(s) abierta(s) de ${canonical} >= ${cooldown}`,
      );
    }
    let failures: FailureCase[];
    try {
      failures = improve.collectFailures(canonical, 50);
    } catch {
      return no("no se pudieron colectar failures");
    }
    const fresh = (
      Array.isArray(failures) ? failures : []
    ).filter((f) => {
      try {
        if (sinceMs < 0) return true;
        const ms = Date.parse(f.at);
        return Number.isFinite(ms) && ms > sinceMs;
      } catch {
        return false;
      }
    });
    if (fresh.length < 2) {
      return no(
        `failures nuevos insuficientes en ${canonical} (${fresh.length}/2 desde la última propuesta)`,
      );
    }
    // Cota: UNA sola propuesta por corrida (el cooldown frena las siguientes).
    let created: ImprovementProposal;
    try {
      created = await improve.createProposal(canonical);
    } catch (e) {
      return no(
        `createProposal falló: ${e instanceof Error ? e.message : String(e).slice(0, 100)}`,
      );
    }
    return {
      proposed: true,
      reason: `propuesta auto de ${canonical} ante ${fresh.length} failures nuevos`,
      ...(created && typeof created.id === "string" ? { proposalId: created.id } : {}),
    };
  } catch {
    return no("auto-propose inesperado");
  }
}
