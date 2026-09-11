/**
 * triageUi — helpers puros del panel de Triage (H-002, E2).
 *
 * La lógica vive acá (testeable sin React/DOM, patrón Ola 17/19);
 * `TriageQuestions.tsx` solo orquesta inputs + POST y `WorkItemList.tsx`
 * solo renderiza. Este archivo nunca importa React ni hace I/O.
 *
 * Fuentes de datos (descubiertas por lectura, sin inventar):
 * - `meta.triage.openQuestions` (TriageFindings del triage-agent, persistido
 *   por `persistTriage` + `runForemanDecisionAndDispatch`): las preguntas
 *   concretas con LLM sano (job job-mtm7uuhe-o5aw, 3 preguntas).
 * - `meta.foremanDecision` ({reason, confidence, decision}): lo que la UI ya
 *   mostraba (reason/confidence). `openQuestions` NO vive acá.
 *
 * ESM puro, cero `require()`.
 */

export interface TriageInfo {
  /** Razón del triage (foremanDecision.reason, fallback triage.reason). */
  reason: string | null;
  /** Confianza 0..1 (solo si es número finito). */
  confidence: number | null;
  /** Decisión del foreman (`needs_triage`/`needs_input`/…). */
  decision: string | null;
  /** Preguntas concretas (vacío = fallback o LLM caído, ver H-002). */
  openQuestions: string[];
  /** True si hay ≥1 pregunta para mostrar. */
  hasQuestions: boolean;
}

const TRIAGE_QUESTIONS_CAP = 10;

function asRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function cleanQuestions(raw: unknown): string[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (trimmed.length === 0) continue;
      out.push(trimmed.slice(0, 500));
      if (out.length >= TRIAGE_QUESTIONS_CAP) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Extrae la info de triage desde el timeline (último evento que la traiga).
 * Pura, nunca lanza: sin datos retorna objeto vacío con hasQuestions=false
 * (la UI muestra reason + mensaje honesto, sin romper — H-002).
 */
export function extractTriageInfo(timeline: unknown): TriageInfo {
  const empty: TriageInfo = {
    reason: null,
    confidence: null,
    decision: null,
    openQuestions: [],
    hasQuestions: false,
  };
  try {
    if (!Array.isArray(timeline) || timeline.length === 0) return empty;
    let reason: string | null = null;
    let confidence: number | null = null;
    let decision: string | null = null;
    let openQuestions: string[] = [];
    // Del más nuevo al más viejo: el primer hallazgo manda por campo.
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = asRecord(timeline[i]);
      const meta = entry ? asRecord(entry.meta) : null;
      if (!meta) continue;
      if (reason === null || confidence === null || decision === null) {
        const fd = asRecord(meta.foremanDecision);
        if (fd) {
          if (reason === null && typeof fd.reason === "string" && fd.reason.trim().length > 0) {
            reason = fd.reason.trim().slice(0, 600);
          }
          if (confidence === null && typeof fd.confidence === "number" && Number.isFinite(fd.confidence)) {
            const clamped = Math.min(1, Math.max(0, fd.confidence));
            confidence = clamped;
          }
          if (decision === null && typeof fd.decision === "string" && fd.decision.length > 0) {
            decision = fd.decision.slice(0, 60);
          }
        }
      }
      if (openQuestions.length === 0) {
        const tri = asRecord(meta.triage);
        if (tri) {
          const cleaned = cleanQuestions(tri.openQuestions);
          if (cleaned.length > 0) openQuestions = cleaned;
          // Fallback de reason solo si el foreman no dejó una.
          if (reason === null && typeof tri.reason === "string" && tri.reason.trim().length > 0) {
            reason = tri.reason.trim().slice(0, 600);
          }
        }
      }
      if (reason !== null && confidence !== null && decision !== null && openQuestions.length > 0) break;
    }
    return {
      reason,
      confidence,
      decision,
      openQuestions,
      hasQuestions: openQuestions.length > 0,
    };
  } catch {
    return empty;
  }
}

/**
 * Normaliza respuestas humanas para `POST .../triage/respond`.
 * Retorna el array limpio o null si no hay ni una respuesta útil
 * (el server responde 400 en ese caso; la UI deshabilita el envío).
 */
export function normalizeTriageAnswers(input: unknown): string[] | null {
  try {
    if (!Array.isArray(input)) return null;
    const out: string[] = [];
    for (const item of input) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (trimmed.length === 0) continue;
      out.push(trimmed.slice(0, 500));
      if (out.length >= TRIAGE_QUESTIONS_CAP) break;
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * URL del endpoint de respuesta. El puerto viene por discovery
 * (`discoverFactoryPort`), jamás literal en el código (Regla 1).
 */
export function buildTriageRespondUrl(port: number, jobId: string): string {
  return `http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(jobId)}/triage/respond`;
}

/** URL del endpoint existente de derivación (POST /cancel, reuse, H-002). */
export function buildTriageDeriveUrl(port: number, jobId: string): string {
  return `http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(jobId)}/cancel`;
}

export type TriageRespondResult =
  | { ok: true; status: string; answers: number }
  | { ok: false; error: string };

/**
 * POST .../triage/respond con fetch inyectado (testeable sin red real;
 * en prod se pasa el `fetch` global). Nunca lanza: todo fallo es
 * `{ok:false}` con mensaje corto. Timeout propio 3s (espejo ReviewPanel).
 */
export async function postTriageRespond(
  fetchFn: typeof fetch,
  port: number,
  jobId: string,
  answers: string[],
  timeoutMs = 3000,
): Promise<TriageRespondResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(buildTriageRespondUrl(port, jobId), {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const text = await res.text().catch(() => "");
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      const err = typeof body.error === "string" && body.error.length > 0 ? body.error : `error ${res.status}`;
      return { ok: false, error: err.slice(0, 200) };
    }
    return {
      ok: true,
      status: typeof body.status === "string" ? body.status : "Foreman",
      answers: typeof body.answers === "number" ? body.answers : answers.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.toLowerCase().includes("abort") ? "timeout 3s" : msg.slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}
