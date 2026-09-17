/**
 * review/reviewRerun — RE-REVISAR (flujo simple, sin reintentos).
 *
 * POST /factory/jobs/:id/review/rerun (+ alias): corre UN solo turno del
 * review agent sobre un job en `Complete` (filas Ready to Merge) SIN mover
 * su status (esta ruta nunca transiciona: el único reopen deliberado de
 * Complete es la ronda de reconciliación post-bot, `startBotReconcileRun`).
 * El veredicto se
 * anexa al timeline + raw a disco para auditoría y viaja en la respuesta
 * para que el panel lo muestre; si sale `revise`, el humano decide con los
 * botones existentes (el daemon no reabre nada solo).
 *
 * Guards: 404 ausente, 409 si no está Complete / es pact / hay review en
 * curso (lock tomado). Flujo simple: UNA llamada, sin reintentos ni loops.
 * Nunca lanza.
 */

import path from "node:path";
import { workItemStore } from "../workItem/workItemStore";
import { effectiveWorktreeFor } from "../factory/isolation/isolationStore";
import { reviewAgent } from "./reviewAgent";
import { resolveReviewer } from "./reviewModelSelector";
import { writeReviewRawAtomic } from "./reviewDisk";
import {
  buildAskHumanResult,
  isPactReviewJob,
  type ReviewResult,
} from "../../shared/types/review";

export type ReviewRerunOk = {
  ok: true;
  id: string;
  status: string;
  verdict: ReviewResult["verdict"];
  summary: string;
  findings: number;
  attempt: number;
};
export type ReviewRerunErr = { ok: false; code: 404 | 409 | 500; error: string };

/**
 * Corre el review una vez sobre el job Complete. Nunca lanza.
 */
export async function runReviewRerun(id: unknown): Promise<ReviewRerunOk | ReviewRerunErr> {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const current = workItemStore.get(id);
    if (!current) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    if (current.status !== "Complete") {
      return { ok: false, code: 409, error: `solo jobs Complete se pueden re-revisar (status=${current.status})` };
    }
    try {
      if (
        isPactReviewJob({ id, prompt: current.prompt, worktree: current.worktree })
      ) {
        return { ok: false, code: 409, error: "pact jobs never Review" };
      }
    } catch {
      // ante duda se sigue al lock + LLM (el agent falla honesto)
    }
    if (!workItemStore.acquireReviewLock(id)) {
      return { ok: false, code: 409, error: "review en curso para este job" };
    }
    try {
      const attempt = (current.reviewCount ?? 0) + 1;
      const sel = resolveReviewer(current.modelRef, current.reviewerRef);
      let result: ReviewResult;
      let raw: string | null = null;
      if (sel.shouldAskHuman) {
        result = buildAskHumanResult({
          workItemId: id,
          reviewerModel: sel.reviewerModel,
          reviewAttempt: attempt,
          summary: sel.reason,
        });
      } else {
        try {
          const res = await reviewAgent.consume({
            workItemId: id,
            worktreePath: effectiveWorktreeFor(current),
            reviewerModel: sel.reviewerModel,
            reviewAttempt: attempt,
            prompt: current.prompt,
            ...(current.modelRef ? { builderModelRef: current.modelRef } : {}),
          });
          result = res.result;
          raw = res.raw;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result = buildAskHumanResult({
            workItemId: id,
            reviewerModel: sel.reviewerModel,
            reviewAttempt: attempt,
            summary: `reviewAgent throw: ${msg.slice(0, 160)}`,
            isInfraError: true,
          });
          raw = null;
        }
      }
      const dir =
        current.dir ?? path.join(path.resolve(current.worktree), ".agents", "factory", id);
      try {
        writeReviewRawAtomic(dir, attempt, raw);
      } catch {
        // raw best-effort
      }
      try {
        workItemStore.appendEvent(
          id,
          "system",
          `review: re-run ${result.verdict} (intento ${attempt}, sin mover status): ${result.summary.slice(0, 160)}`,
          { reviewRerun: result } as unknown as Record<string, unknown>,
        );
      } catch {
        // timeline best-effort
      }
      return {
        ok: true,
        id,
        status: "Complete",
        verdict: result.verdict,
        summary: result.summary,
        findings: Array.isArray(result.findings) ? result.findings.length : 0,
        attempt,
      };
    } finally {
      try {
        workItemStore.releaseReviewLock(id);
      } catch {
        // best-effort
      }
    }
  } catch (e) {
    return { ok: false, code: 500, error: e instanceof Error ? e.message : String(e) };
  }
}
