/**
 * workItemSummary — helper puro (sin React) para copiar el resumen de un
 * WorkItem como texto markdown compacto, listo para pegar en el chat.
 * Incluye: status, prompt, verificación con exit codes, createdFiles,
 * review, timeline completo y links. Sin truncar lo importante.
 */

import type { WorkItem } from "../../../../shared/types/workItem";

interface ReviewLike {
  verdict?: string;
  confidence?: number;
  summary?: string;
  findings?: Array<{ id?: string; axis?: string; severity?: string; message?: string }>;
  reviewAttempt?: number;
  reviewerModel?: { providerID?: string; modelID?: string };
}

function asReviewLike(wi: WorkItem): (ReviewLike & { count?: number }) | null {
  const w = wi as unknown as { reviewCount?: number; lastReview?: ReviewLike };
  if (!w.lastReview && typeof w.reviewCount !== "number") return null;
  return { ...(w.lastReview ?? {}), count: w.reviewCount };
}

/**
 * Lee `createdFiles` con el top-level primero (E1 agregó `createdFiles` en
 * `job.json` por H-001, aditivo; la meta vieja sigue) y fallback a la meta
 * del timeline. Un top-level `[]` nunca borra evidencia: cae a la meta
 * (espejo de la regla de E1 en `transitionWithVerification`). Puro, nunca
 * lanza (null = sin datos).
 *
 * Refactor ① E1 (A3): lector canónico único — `readCreatedFilesStrict` es la
 * forma única y este helper solo agrega el fallback a meta (compat vieja).
 */
export function readCreatedFiles(
  wi: Pick<WorkItem, "timeline"> & { createdFiles?: unknown },
): string[] | null {
  try {
    const top = readCreatedFilesStrict(wi);
    if (top && top.length > 0) return top;
    const rev = [...(wi.timeline ?? [])].reverse();
    for (const e of rev) {
      const m = e.meta as Record<string, unknown> | undefined;
      if (m && Array.isArray(m.createdFiles)) {
        return (m.createdFiles as unknown[]).map(String);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Forma única (refactor ① E1, A3): `createdFiles` top-level, limpio.
 * `null` si ausente/inválido/vacío (el caller decide el fallback).
 * Puro, nunca lanza.
 */
export function readCreatedFilesStrict(
  wi: { createdFiles?: unknown },
): string[] | null {
  try {
    const top = (wi as { createdFiles?: unknown }).createdFiles;
    if (!Array.isArray(top)) return null;
    const clean = (top as unknown[])
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .map(String);
    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}

/**
 * `createdFiles` para la VISTA VERIFICACIÓN (espejo del helper `jobView`
 * del daemon; duplicado a propósito en 5 líneas: el renderer jamás importa
 * headless — capas, no DRY ciego). Ausente → `[]` SOLO acá; `[]` jamás es
 * prueba de entrega (H-012). Puro, nunca lanza.
 */
export function readCreatedFilesForVerification(
  wi: { createdFiles?: unknown },
): string[] {
  return readCreatedFilesStrict(wi) ?? [];
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

interface VerificationLike {
  overall?: string;
  steps?: Array<{ name?: string; status?: string; exitCode?: number | null; logSnippet?: string }>;
  durationMs?: number;
}

export function buildWorkItemSummary(
  wi: WorkItem,
  opts: { resultUrl?: string; buildLogUrl?: string } = {},
): string {
  const lines: string[] = [];
  lines.push(`## Job ${wi.id} — ${wi.status}`);

  const prompt = (wi.prompt ?? "").trim();
  if (prompt) lines.push(`Prompt: ${prompt}`);
  if (wi.worktree) lines.push(`Worktree: ${wi.worktree}`);
  if (wi.runnerId) lines.push(`Runner: ${wi.runnerId}`);

  // Verificación (del timeline meta) + createdFiles (top-level primero, H-001)
  const rev = [...(wi.timeline ?? [])].reverse();
  let verification: VerificationLike | null = null;
  for (const e of rev) {
    const m = e.meta as Record<string, unknown> | undefined;
    if (!m) continue;
    if (!verification && typeof m.verification === "object" && m.verification !== null) {
      verification = m.verification as VerificationLike;
      break;
    }
  }
  const createdFiles = readCreatedFiles(wi);
  if (verification) {
    const steps = verification.steps ?? [];
    lines.push(
      `Verification: ${verification.overall ?? "?"} (${steps.length} steps${typeof verification.durationMs === "number" ? `, ${verification.durationMs}ms` : ""})`,
    );
    for (const s of steps) {
      const extra =
        s.status === "fail" && s.logSnippet
          ? ` — ${s.logSnippet.trim().slice(0, 300)}`
          : "";
      lines.push(`  - ${s.name ?? "?"}: ${s.status ?? "?"} (exit ${s.exitCode ?? "null"})${extra}`);
    }
  } else {
    lines.push(`Verification: sin datos todavía`);
  }

  if (createdFiles && createdFiles.length > 0) {
    lines.push(`CreatedFiles (${createdFiles.length}): ${createdFiles.join(", ")}`);
  }

  // Review
  const review = asReviewLike(wi);
  if (review && (review.verdict || typeof review.count === "number")) {
    const conf =
      typeof review.confidence === "number" ? ` ${Math.round(review.confidence * 100)}%` : "";
    const who = review.reviewerModel
      ? ` revisor=${review.reviewerModel.providerID}/${review.reviewerModel.modelID}`
      : "";
    const findings = Array.isArray(review.findings) ? review.findings.length : 0;
    lines.push(
      `Review: ${review.verdict ?? "?"}${conf} (intento ${review.reviewAttempt ?? "?"} · count ${review.count ?? "?"} · ${wi.status})${who}`,
    );
    if (review.summary) lines.push(`  ${review.summary.slice(0, 400)}`);
    lines.push(`  findings: ${findings}`);
  }

  // Timeline completo, sin truncar mensajes
  lines.push(`Timeline (${(wi.timeline ?? []).length}):`);
  for (const e of (wi.timeline ?? [])) {
    lines.push(`  - ${e.from}→${e.to} | ${e.actor} | ${e.message} (${fmtTime(e.at)})`);
    const m = e.meta as Record<string, unknown> | undefined;
    const fd = m?.foremanDecision as Record<string, unknown> | undefined;
    if (fd && typeof fd.reason === "string") {
      lines.push(`    reason: "${fd.reason}" confidence=${String(fd.confidence ?? "?")} decision=${String(fd.decision ?? "?")}`);
    }
  }

  if (opts.resultUrl) lines.push(`result.json: ${opts.resultUrl}`);
  if (opts.buildLogUrl) lines.push(`build.log: ${opts.buildLogUrl}`);

  return lines.join("\n");
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // cae al fallback legacy
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
