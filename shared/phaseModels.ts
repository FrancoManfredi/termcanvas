// Routing de proveedor/modelo por fase — contrato compartido entre renderer,
// proceso principal y el motor de entrevista.
//
// Este módulo refleja FIELMENTE la conducta actual (cero cambio de
// comportamiento); los valores son los mismos que hoy viven hardcodeados en
// headless-runtime/interview/engine.ts:
//   - Turnos del motor (brief, entrevista de requerimientos, revisión ASR):
//     opencode-go/hy3 SIN variant (camino rápido/barato con json_schema).
//   - Síntesis final: deepseek-v4-flash + variant "max" (ventana 1M para el
//     contexto completo de la entrevista).
//   - Gap-check: deepseek-v4-flash SIN variant.
//   - Fases CLI (planner roadmap/audit, diagnóstico LLM): hoy NO fijan modelo
//     — usan el default global de la config de opencode del usuario. Se
//     representa con null ("sin pin").
//
// Consumo previsto: las preferencias persisten overrides por fase
// (sanitizePhaseModels) y cada fase resuelve su modelo efectivo con
// resolveModelForPhase antes de lanzar. null = no fijar modelo.

export interface ModelRef {
  providerID: string;
  modelID: string;
  variant?: string;
}

/** Fases con routing propio. El orden es solo presentación (Settings). */
export const PHASE_IDS = [
  "brief",
  "requirements",
  "synthesis",
  "gapCheck",
  "asrReview",
  "tactics",
  "diagnosisLlm",
] as const;

export type PhaseId = (typeof PHASE_IDS)[number];

// Defaults del motor de entrevista. Mantener en sync con engine.ts hasta que
// el motor importe de acá (WU4); mientras tanto son la fuente canónica para
// defaults de fases CLI y para la UI.
export const DEFAULT_PROVIDER_ID = "opencode-go";
export const DEFAULT_MODEL_ID = "hy3";
export const HEAVY_MODEL_ID = "deepseek-v4-flash";
export const SYNTHESIS_VARIANT = "max";

/**
 * Modelo efectivo cuando la fase no tiene override del usuario.
 * null = la fase corre SIN pin: el CLI/SDK usa su default global
 * (conducta actual de planner/diagnóstico).
 */
export const DEFAULT_PHASE_MODELS: Record<PhaseId, ModelRef | null> = {
  brief: { providerID: DEFAULT_PROVIDER_ID, modelID: DEFAULT_MODEL_ID },
  requirements: { providerID: DEFAULT_PROVIDER_ID, modelID: DEFAULT_MODEL_ID },
  synthesis: {
    providerID: DEFAULT_PROVIDER_ID,
    modelID: HEAVY_MODEL_ID,
    variant: SYNTHESIS_VARIANT,
  },
  gapCheck: { providerID: DEFAULT_PROVIDER_ID, modelID: HEAVY_MODEL_ID },
  asrReview: { providerID: DEFAULT_PROVIDER_ID, modelID: DEFAULT_MODEL_ID },
  // Tácticas de arquitectura por ASR (candidatas, consolidación, validación
  // de texto libre): llamadas angostas con json_schema — mismo camino rápido
  // que los turnos del motor. Sin variant de thinking.
  tactics: { providerID: DEFAULT_PROVIDER_ID, modelID: DEFAULT_MODEL_ID },
  // diagnosisLlm = flujo de Diagnóstico (Fase B, antes "planner audit").
  // Sin pin por default: usa el modelo global del CLI del usuario.
  diagnosisLlm: null,
};

export function isPhaseId(value: unknown): value is PhaseId {
  return (
    typeof value === "string" &&
    (PHASE_IDS as readonly string[]).includes(value)
  );
}

export function isModelRef(value: unknown): value is ModelRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  if (typeof ref.providerID !== "string" || ref.providerID.length === 0) return false;
  if (typeof ref.modelID !== "string" || ref.modelID.length === 0) return false;
  if (ref.variant !== undefined && typeof ref.variant !== "string") return false;
  return true;
}

/**
 * Evento de actividad de una llamada al modelo por fase (feed "IA actuando").
 * start = la llamada comienza; end = terminó (con usage o error). Solo
 * metadatos — el contenido del modelo viaja por sus canales propios.
 */
export interface PhaseActivityEvent {
  kind: "start" | "end";
  phaseId?: PhaseId;
  /** Label legible de la operación ("Síntesis final", "Generación de pregunta"…). */
  context: string;
  modelRef: ModelRef | null;
  startedAt: number;
  durationMs?: number;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

/**
 * Resuelve el modelo efectivo de una fase: override del usuario si existe,
 * si no el default. Devuelve null solo si ni el override ni el default fijan
 * modelo (fases CLI sin pin).
 */
export function resolveModelForPhase(
  phaseId: PhaseId,
  overrides?: Partial<Record<PhaseId, ModelRef>> | null,
): ModelRef | null {
  return overrides?.[phaseId] ?? DEFAULT_PHASE_MODELS[phaseId];
}

/**
 * Formato canónico "provider/model" para el flag --model del CLI opencode y
 * para mostrar en UI. La variant NO viaja en este formato: se pasa por su
 * propio canal (SDK) o se descarta (CLI).
 */
export function formatModelRef(ref: ModelRef): string {
  return `${ref.providerID}/${ref.modelID}`;
}

/**
 * Parsea "provider/model" (formato del flag --model de opencode). Devuelve
 * null si el string no cumple el formato; nunca lanza. La variant no forma
 * parte del formato: el resultado sale sin variant.
 */
export function parseModelRef(value: string): ModelRef | null {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  const providerID = value.slice(0, slash);
  const modelID = value.slice(slash + 1);
  if (modelID.includes("/")) return null;
  return { providerID, modelID };
}

/**
 * Sanitiza la config persistida de modelos por fase (viene de localStorage /
 * JSON.parse): descarta claves desconocidas y entradas malformadas. Nunca
 * lanza; devuelve solo entradas válidas.
 */
export function sanitizePhaseModels(
  value: unknown,
): Partial<Record<PhaseId, ModelRef>> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<Record<PhaseId, ModelRef>> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isPhaseId(key)) continue;
    if (!isModelRef(entry)) continue;
    out[key] =
      entry.variant === undefined
        ? { providerID: entry.providerID, modelID: entry.modelID }
        : { providerID: entry.providerID, modelID: entry.modelID, variant: entry.variant };
  }
  return out;
}
