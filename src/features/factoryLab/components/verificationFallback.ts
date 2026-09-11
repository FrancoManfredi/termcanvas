/**
 * verificationFallback — lógica pura del fallback del VerificationPanel (H-008, parte 2).
 *
 * Problema: el panel SOLO leía `result.json`, que solo existe en jobs
 * terminales con forma rica. Un job en Triage por setup-fail tiene
 * `verify.json` + timeline con evidence, pero el panel mostraba
 * "Sin result.json todavía" (stale).
 *
 * Fallback honesto (sin importar tipos headless — tipado estructural):
 * - `result` con `verification.steps` → modo "full" (comportamiento actual).
 * - si no, `verify` (GET /verify, artefacto Ola 9) con `verification` →
 *   modo "partial": se muestra "parcial", NUNCA "pendiente" cuando hay
 *   evidence en verify.json. `createdFiles` y timeline (N eventos) vienen
 *   de `verify` + `job` (GET single, datos que el panel ya puede pedir).
 * - sin nada útil → modo "empty" (pendiente honesto, sin evidence).
 *
 * Puro, nunca lanza.
 */

import { parseVerifyEvidence, type VerifyEvidenceItem } from "./verifyEvidence";

export type VerificationViewMode = "full" | "partial" | "empty";
export type VerificationViewStatus = "pass" | "fail" | "pending";

export interface FallbackStep {
  name: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  status: "pass" | "fail" | "skipped";
  logSnippet?: string;
  logPath?: string;
  isolation?: "docker" | "none";
  isolationFallback?: string;
}

export interface FallbackVerification {
  overall: "pass" | "fail";
  steps: FallbackStep[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface VerificationView {
  mode: VerificationViewMode;
  status: VerificationViewStatus;
  verification: FallbackVerification | null;
  createdFiles: string[];
  evidence: VerifyEvidenceItem[];
  /** Nota honesta del origen ("parcial: ..." / null en full). */
  note: string | null;
  /** Eventos de timeline vistos (0 si el job no trajo timeline). */
  timelineEvents: number;
}

export interface VerificationViewInput {
  result: unknown;
  verify: unknown;
  job: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function cleanSteps(raw: unknown): FallbackStep[] {
  if (!Array.isArray(raw)) return [];
  const out: FallbackStep[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name : "";
    if (name !== "setup" && name !== "test" && name !== "build") continue;
    const status = item.status === "pass" || item.status === "fail" ? item.status : "skipped";
    const exitCode =
      typeof item.exitCode === "number" && Number.isInteger(item.exitCode) ? item.exitCode : null;
    out.push({
      name,
      command: typeof item.command === "string" ? item.command : "",
      exitCode,
      durationMs:
        typeof item.durationMs === "number" && item.durationMs >= 0 ? item.durationMs : 0,
      status,
      ...(typeof item.logSnippet === "string" ? { logSnippet: item.logSnippet.slice(0, 4000) } : {}),
      ...(typeof item.logPath === "string" ? { logPath: item.logPath.slice(0, 300) } : {}),
      ...(item.isolation === "docker" || item.isolation === "none" ? { isolation: item.isolation } : {}),
      ...(typeof item.isolationFallback === "string" && item.isolationFallback.length > 0
        ? { isolationFallback: item.isolationFallback.slice(0, 300) }
        : {}),
    });
    if (out.length >= 50) break;
  }
  return out;
}

function cleanVerification(raw: unknown): FallbackVerification | null {
  if (!isRecord(raw)) return null;
  if (raw.overall !== "pass" && raw.overall !== "fail") return null;
  const steps = cleanSteps(raw.steps);
  if (steps.length === 0) return null;
  return {
    overall: raw.overall,
    steps,
    ...(typeof raw.startedAt === "string" ? { startedAt: raw.startedAt } : {}),
    ...(typeof raw.finishedAt === "string" ? { finishedAt: raw.finishedAt } : {}),
    ...(typeof raw.durationMs === "number" && raw.durationMs >= 0 ? { durationMs: raw.durationMs } : {}),
  };
}

function cleanCreatedFiles(...sources: unknown[]): string[] {
  for (const src of sources) {
    if (Array.isArray(src)) {
      const clean = src
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .map((x) => x.slice(0, 300))
        .slice(0, 50);
      if (clean.length > 0) return clean;
    }
  }
  return [];
}

function countTimelineEvents(job: unknown): number {
  try {
    if (isRecord(job) && Array.isArray(job.timeline)) return job.timeline.length;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Forma única (refactor ① E1, A3): ¿trae `result` verificación completa?
 * Misma regla que `resolveVerificationView` para el modo "full" (steps no
 * vacío), extraída para que el panel no duplique el chequeo inline.
 * Puro, nunca lanza.
 */
export function hasFullVerification(result: unknown): boolean {
  try {
    if (!isRecord(result)) return false;
    return cleanVerification(result.verification) !== null;
  } catch {
    return false;
  }
}

/**
 * Resuelve qué mostrar en el VerificationPanel. Puro, nunca lanza.
 * Regla honesta: con evidence en verify.json el estado jamás es "pendiente".
 */export function resolveVerificationView(input: VerificationViewInput): VerificationView {
  try {
    const result = isRecord(input?.result) ? input.result : null;
    const verify = isRecord(input?.verify) ? input.verify : null;
    const job = isRecord(input?.job) ? input.job : null;
    const timelineEvents = countTimelineEvents(job);

    const resultVerification = result ? cleanVerification(result.verification) : null;
    if (resultVerification) {
      const status: VerificationViewStatus = resultVerification.overall;
      const createdFiles = cleanCreatedFiles(result?.createdFiles, verify?.createdFiles, job?.createdFiles);
      return {
        mode: "full",
        status,
        verification: resultVerification,
        createdFiles,
        evidence: parseVerifyEvidence(result),
        note: null,
        timelineEvents,
      };
    }

    const verifyVerification = verify ? cleanVerification(verify.verification) : null;
    const verifyEvidence = verify ? parseVerifyEvidence(verify) : [];
    if (verifyVerification || verifyEvidence.length > 0) {
      const createdFiles = cleanCreatedFiles(verify?.createdFiles, job?.createdFiles);
      const status: VerificationViewStatus = verifyVerification ? verifyVerification.overall : "fail";
      const origin = verifyVerification ? "verify.json" : "evidence de verify.json";
      return {
        mode: "partial",
        status,
        verification: verifyVerification,
        createdFiles,
        evidence: verifyEvidence,
        note:
          `parcial: sin result.json con verification — datos de ${origin}` +
          (timelineEvents > 0 ? ` + timeline (${timelineEvents} eventos)` : "") +
          ". El job no terminó (sin .done).",
        timelineEvents,
      };
    }

    return {
      mode: "empty",
      status: "pending",
      verification: null,
      createdFiles: [],
      evidence: [],
      note: null,
      timelineEvents,
    };
  } catch {
    return {
      mode: "empty",
      status: "pending",
      verification: null,
      createdFiles: [],
      evidence: [],
      note: null,
      timelineEvents: 0,
    };
  }
}
