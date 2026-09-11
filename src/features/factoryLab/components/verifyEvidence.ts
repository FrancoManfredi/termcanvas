/**
 * verifyEvidence — helper puro (sin React) para leer la evidencia de
 * verificación de un result.json.
 * Contrato real (Ola 9): `result.verification.evidence: [{kind, status, ref?, summary?}]`.
 * Se acepta además el top-level legacy `result.evidence` por compatibilidad.
 * Jobs viejos no traen nada → [] (no se muestra nada nuevo).
 * Tolerant-by-design: ignora items sin kind/status string, recorta y topa a 50.
 */

export interface VerifyEvidenceItem {
  kind: string;
  status: string;
  ref?: string;
  summary?: string;
}

const VERIFY_EVIDENCE_MAX = 50;

export function parseVerifyEvidence(input: unknown): VerifyEvidenceItem[] {
  if (!input || typeof input !== "object") return [];
  const rec = input as { evidence?: unknown; verification?: unknown };
  // Contrato real (Ola 9 E1): result.verification.evidence. Se acepta además
  // el top-level legacy por compatibilidad con shapes sintéticos.
  const fromVerification =
    rec.verification && typeof rec.verification === "object"
      ? (rec.verification as { evidence?: unknown }).evidence
      : undefined;
  const raw = Array.isArray(fromVerification) ? fromVerification : rec.evidence;
  if (!Array.isArray(raw)) return [];
  const out: VerifyEvidenceItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.kind !== "string" || r.kind.trim().length === 0) continue;
    if (typeof r.status !== "string" || r.status.trim().length === 0) continue;
    out.push({
      kind: r.kind.trim().slice(0, 80),
      status: r.status.trim().slice(0, 40),
      ...(typeof r.ref === "string" && r.ref.trim().length > 0
        ? { ref: r.ref.trim().slice(0, 300) }
        : {}),
      ...(typeof r.summary === "string" && r.summary.trim().length > 0
        ? { summary: r.summary.trim().slice(0, 500) }
        : {}),
    });
    if (out.length >= VERIFY_EVIDENCE_MAX) break;
  }
  return out;
}
