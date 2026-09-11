/**
 * ReviewService — flujo simple (sin reintentos).
 * handleReview(workItem) con locks Set para evitar doble trigger.
 * UN solo revise automático (MAX_REVIEW_ROUNDS = 1): implement → review 1
 * → (revise) Building → review 2 terminal. Transiciones:
 * - accept → Complete + .done (Implement ya NO crea .done)
 * - revise && count<MAX → Building con findings en meta (re-dispara Implement fire-and-forget)
 * - revise && count>=MAX → ask_human (stay Review parado, decide el humano)
 * - ask_human → stay Review (parado)
 * Pact jobs nunca Review (guard isPactReviewJob).
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkItem } from "../../shared/types/workItem";
import type { VerificationReport } from "../../shared/types/implement";
import type { ReviewResult } from "../../shared/types/review";
import {
  buildAskHumanResult,
  decideReviewNext,
  isInfraReviewResult,
  isPactReviewJob,
  MAX_REVIEW_ROUNDS,
} from "../../shared/types/review";
import { workItemStore } from "../workItem/workItemStore";
import { notify } from "../notify/notifications";
import { verificationService } from "../implement/verification";
import {
  capReverifyEvidence,
  REVERIFY_IGNORED_NOTE,
  validateReverifyCommands,
} from "./reverifyAllowlist";
import { resolveReviewer } from "./reviewModelSelector";
import { reviewAgent } from "./reviewAgent";
import { writeReviewJsonAtomic, writeReviewRawAtomic } from "./reviewDisk";
import { foremanLogStore } from "../foreman/foremanLog";
// T01 isolation: el reviewer corre sobre la jaula cuando existe (ancla
// legado en caso contrario). El hook post-Complete abre el PR de handoff.
import { effectiveWorktreeFor } from "../factory/isolation/isolationStore";
import { maybeOpenPrForCompletedJob } from "../factory/isolation/gitHubPr";

function extractImplementMeta(item: WorkItem): {
  createdFiles: string[];
  verification: VerificationReport | null;
} {
  let createdFiles: string[] = [];
  let verification: VerificationReport | null = null;
  const rev = [...(item.timeline ?? [])].reverse();
  for (const e of rev) {
    const m = e.meta as Record<string, unknown> | undefined;
    if (!m) continue;
    if (!verification && typeof m.verification === "object" && m.verification !== null) {
      verification = m.verification as VerificationReport;
    }
    if (createdFiles.length === 0 && Array.isArray(m.createdFiles)) {
      createdFiles = (m.createdFiles as unknown[]).map(String).slice(0, 50);
    }
    if (verification && createdFiles.length > 0) break;
  }
  return { createdFiles, verification };
}

/**
 * Gate post-rondas: el review LLM corre hasta MAX_REVIEW_ROUNDS veces por
 * work item. Detecta el turno post-cap: el job vuelve a Review con un
 * `revise` ya emitido y las rondas agotadas (count>=MAX) — el retrabajo de
 * Building ya se aplicó y otro LLM-review solo quemaría tokens sin
 * converger: el humano juzga. Puro, nunca lanza.
 */
export function isPostReviseReview(item: unknown, countBefore: unknown): boolean {
  try {
    if (typeof countBefore !== "number" || countBefore < MAX_REVIEW_ROUNDS) return false;
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const prev = (item as Record<string, unknown>).lastReview;
    if (prev === null || typeof prev !== "object" || Array.isArray(prev)) return false;
    return (prev as Record<string, unknown>).verdict === "revise";
  } catch {
    return false;
  }
}

export class ReviewService {
  /**
   * Handle Review state. Serialized per workItem id via reviewLocks.
   * Nunca lanza: fallos internos → ask_human stay.
   */
  async handleReview(workItem: WorkItem): Promise<WorkItem | null> {
    const id = workItem.id;

    // Pact nunca Review
    try {
      if (
        isPactReviewJob({ id, prompt: workItem.prompt, worktree: workItem.worktree })
      ) {
        return workItemStore.get(id) ?? null;
      }
    } catch {}

    const snapshot = workItemStore.get(id) ?? workItem;
    if (snapshot.status !== "Review") return null;

    if (!workItemStore.acquireReviewLock(id)) {
      console.log(`[ReviewService] ${id} already handling Review — skip duplicate`);
      return null;
    }

    try {
      const current = workItemStore.get(id);
      if (!current || current.status !== "Review") {
        return current ?? null;
      }
      const countBefore = current.reviewCount ?? 0;
      const attempt = countBefore + 1;
      const dir =
        current.dir ?? path.join(path.resolve(current.worktree), ".agents", "factory", id);

      // Selección revisor: explícito del usuario (reviewerRef) o automático disjunto.
      // Explícito igual al builder → ask_human sin gastar LLM (anti auto-aprobación).
      const sel = resolveReviewer(current.modelRef, current.reviewerRef);
      // Traza visible: qué revisor se usó (el caso bloqueado ya lo loguea la rama shouldAskHuman)
      if (sel.source === "explicit" && !sel.shouldAskHuman) {
        try {
          workItemStore.appendEvent(id, "system", `review selector: ${sel.reason}`, {
            reviewSelector: sel,
          } as unknown as Record<string, unknown>);
        } catch {}
      }
      let result: ReviewResult;
      let raw: string | null = null;
      if (isPostReviseReview(current, countBefore)) {
        // Post-cap: rondas agotadas, el retrabajo ya está aplicado; el
        // humano lo juzga. Sin LLM-call, sin parse, sin costo: el gate del
        // panel muestra el resumen del último revise para decidir
        // Accept/Reject.
        const prev = (current as unknown as Record<string, unknown>).lastReview as Record<string, unknown>;
        const prevSummary =
          typeof prev.summary === "string" && prev.summary.trim() !== ""
            ? (prev.summary as string).trim().slice(0, 1000)
            : "(sin resumen previo)";
        const prevFindings = Array.isArray(prev.findings) ? (prev.findings as unknown[]).length : 0;
        result = buildAskHumanResult({
          workItemId: id,
          reviewerModel: sel.reviewerModel,
          reviewAttempt: attempt,
          summary: `rondas de review agotadas (${MAX_REVIEW_ROUNDS}): Building aplicó el retrabajo (${prevFindings} finding(s)) sin llegar a accept. Se requiere tu decisión sobre el retrabajo. Último revise: ${prevSummary}`,
        });
        try {
          workItemStore.appendEvent(id, "system", `review: post-cap → ask_human sin LLM-review extra (cota ${MAX_REVIEW_ROUNDS} rondas)`, {
            review: result,
          } as unknown as Record<string, unknown>);
        } catch {}
      } else if (sel.shouldAskHuman) {
        result = buildAskHumanResult({
          workItemId: id,
          reviewerModel: sel.reviewerModel,
          reviewAttempt: attempt,
          summary: sel.reason,
        });
        try {
          workItemStore.appendEvent(id, "system", `review selector: ${sel.reason}`, {
            reviewSelector: sel,
          } as unknown as Record<string, unknown>);
        } catch {}
      } else {
        const { createdFiles, verification } = extractImplementMeta(current);
        const worktreePath = effectiveWorktreeFor(current);
        try {
          const res = await reviewAgent.consume({
            workItemId: id,
            worktreePath,
            reviewerModel: sel.reviewerModel,
            reviewAttempt: attempt,
            prompt: current.prompt,
            ...(current.modelRef ? { builderModelRef: current.modelRef } : {}),
            ...(createdFiles.length > 0 ? { createdFiles } : {}),
            ...(verification ? { verification } : {}),
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

      // Con cota de rondas (Regla 7, MAX_REVIEW_ROUNDS): un `revise` vuelve
      // a Building mientras queden rondas — el loop termina por accept,
      // ask_human, acción humana (cancel/reject) o rondas agotadas.
      const effective = result;

      const newCount = attempt;

      // Persistir review.json + review-raw + store (count + lastReview)
      try {
        fs.mkdirSync(dir, { recursive: true });
        writeReviewJsonAtomic(dir, effective);
        writeReviewRawAtomic(dir, attempt, raw);
      } catch (e) {
        console.warn(`[ReviewService] write review.json fail ${id}: ${String(e)}`);
      }
      try {
        workItemStore.setReview(id, effective, newCount);
      } catch (e) {
        console.warn(`[ReviewService] setReview fail ${id}: ${String(e)}`);
      }

      // Flujo simple: sin reverify (el reviewer no re-valida con comandos;
      // revise clásico directo a Building con findings).
      const reverifyForBuilding: { commands: string[]; evidence: string } | null = null;

      const next = decideReviewNext(effective.verdict, countBefore);

      if (next === "Complete") {
        // accept → hooks post-review → Complete + .done (Implement ya NO crea .done).
        // Hook blocking con fail/error → Building con sus findings (como un
        // revise); advisory solo anexa evidencia y nunca frena.
        try {
          let hookBlocked: { results: import("../factory/agents/agentHooks").HookResult[] } | null = null;
          try {
            const { runStageHooks, hasBlockingFailure } = await import("../factory/agents/agentHooks");
            const hookResults = await runStageHooks("post-review", {
              workItemId: id,
              worktreePath: effectiveWorktreeFor(current),
              prompt: current.prompt,
              ...(current.modelRef ? { modelRef: current.modelRef } : {}),
              extra: `accept intento ${attempt}: ${effective.summary.slice(0, 500)}`,
            });
            if (hasBlockingFailure(hookResults)) hookBlocked = { results: hookResults };
          } catch {
            hookBlocked = null;
          }
          if (hookBlocked) {
            const hookFindings = hookBlocked.results
              .filter((r) => r.blocking && (r.status === "fail" || r.status === "error"))
              .flatMap((r) =>
                r.findings.map((f) => ({
                  id: `hook-${r.name}`,
                  axis: "tests" as const,
                  severity: "major" as const,
                  message: `[${r.name}] ${f.message}`,
                  ...(f.file ? { file: f.file } : {}),
                  ...(f.suggestion ? { suggestion: f.suggestion } : {}),
                })),
              );
            const back = workItemStore.transition(
              id,
              "Building",
              "system",
              `review accept con hook blocking en fail → Building (${hookFindings.length} finding(s) de hooks)`,
              {
                review: effective,
                reviewCount: newCount,
                reviewFindings: hookFindings,
              } as unknown as Record<string, unknown>,
            );
            try {
              fs.unlinkSync(path.join(dir, ".done"));
            } catch {}
            try {
              foremanLogStore.info(`[Review] ${id} → Building (hook blocking fail)`, id);
            } catch {}
            setImmediate(() => {
              void (async () => {
                try {
                  const w = workItemStore.get(id);
                  if (!w || w.status !== "Building") return;
                  const { implementService } = await import("../implement/implementService");
                  await implementService.handleBuilding(w);
                } catch (e) {
                  console.warn(`[ReviewService] re-implement fail tras hook ${id}: ${String(e)}`);
                }
              })();
            });
            return back;
          }
          const completed = workItemStore.transition(
            id,
            "Complete",
            "system",
            `review accept intento ${attempt}: ${effective.summary.slice(0, 120)}`,
            { review: effective, reviewCount: newCount } as unknown as Record<string, unknown>,
          );
          try {
            const donePath = path.join(dir, ".done");
            if (!fs.existsSync(donePath)) fs.writeFileSync(donePath, "", "utf-8");
          } catch {}
          try {
            foremanLogStore.info(`[Review] ${id} → Complete (accept intento ${attempt})`, id);
          } catch {}
          // Ola 11: auto-scoring fire-and-forget (muestra determinística por
          // scorer; best-effort, nunca bloquea ni rompe el Complete).
          setImmediate(() => {
            void (async () => {
              try {
                const { autoScoreCompletedJob } = await import("../measure/scorerEngine");
                await autoScoreCompletedJob(id);
              } catch (e) {
                console.warn(`[ReviewService] auto-score fail ${id}: ${String(e).slice(0, 120)}`);
              }
            })();
          });
          // T01 isolation (§5.1 Store→PR): el accept automático también abre
          // el PR de handoff (una vez por job, best-effort). Sin esta arista
          // el camino principal Building→Review→Complete nunca abriría PR.
          setImmediate(() => {
            void maybeOpenPrForCompletedJob(id);
          });
          return completed;
        } catch (e) {
          console.warn(`[ReviewService] Complete transition fail ${id}: ${String(e)}`);
          return workItemStore.get(id) ?? null;
        }
      }

      if (next === "Building") {
        // revise → Building con findings en meta + re-disparo Implement
        try {
          const back = workItemStore.transition(
            id,
            "Building",
            "system",
            `review revise intento ${attempt} → Building (${effective.findings.length} findings)`,
            {
              review: effective,
              reviewCount: newCount,
              reviewFindings: effective.findings,
              // Ola 17: la evidence del reverify viaja para Building (aditivo;
              // ausente cuando no hubo ejecución: revise clásico intacto).
              ...(reverifyForBuilding ? { reverify: reverifyForBuilding } : {}),
            } as unknown as Record<string, unknown>,
          );
          try {
            fs.unlinkSync(path.join(dir, ".done"));
          } catch {}
          try {
            foremanLogStore.info(
              `[Review] ${id} → Building (revise intento ${attempt}, ${effective.findings.length} findings)`,
              id,
            );
          } catch {}
          // Re-disparar Implement fire-and-forget (loop Building↔Review)
          setImmediate(() => {
            void (async () => {
              try {
                const w = workItemStore.get(id);
                if (!w || w.status !== "Building") return;
                const { implementService } = await import("../implement/implementService");
                const res = await implementService.handleBuilding(w);
                void res;
              } catch (e) {
                console.warn(`[ReviewService] re-implement fail ${id}: ${String(e)}`);
              }
            })();
          });
          return back;
        } catch (e) {
          console.warn(`[ReviewService] Building transition fail ${id}: ${String(e)}`);
          return workItemStore.get(id) ?? null;
        }
      }

      // ask_human → stay en Review (ya persistido arriba)
      try {
        workItemStore.appendEvent(id, "system", `review ask_human intento ${attempt} — stay Review`, {
          review: effective,
          reviewCount: newCount,
        } as unknown as Record<string, unknown>);
      } catch {}
      // Ola 19 (a) ask_human → centro de notificaciones (1 línea best-effort,
      // espeja el texto ya construido en `effective.summary`, jamás bloquea).
      // Infra (el review nunca corrió: rate limit, 5xx, timeout...): copy
      // de fallo con la acción correcta (reintentar el review). Aceptar sin
      // review está bloqueado en POST review/accept (409).
      try {
        if (isInfraReviewResult(effective)) {
          notify({
            kind: "ask_human",
            workItemId: id,
            title: "El review falló (infraestructura, sin gastar tu decisión)",
            body: `El reviewer no pudo correr: ${effective.summary.slice(0, 400)}. Reintentá el review cuando quieras; aceptar igual está bloqueado hasta que haya un review real.`,
          });
        } else {
          notify({ kind: "ask_human", workItemId: id, title: "Revisión necesita tu decisión", body: effective.summary.slice(0, 500) });
        }
      } catch {}
      try {
        foremanLogStore.info(`[Review] ${id} ask_human intento ${attempt} — stay Review`, id);
      } catch {}
      return workItemStore.get(id) ?? null;
    } finally {
      workItemStore.releaseReviewLock(id);
    }
  }

  /**
   * Rama reverify (Ola 17, Paridad Warp: review que re-valida).
   * El reviewer pide, el SISTEMA ejecuta: ante `revise` con findings que
   * traen `reverify`, valida contra la allowlist cerrada y —si hay ≥1
   * comando válido Y es el primer review del ciclo— corre UNA
   * verificación enfocada (1 reverify por review como máximo), adjunta el
   * evento `reverify` al timeline y devuelve `{commands, evidence}` para
   * enriquecer la meta del Building. Pedidos inválidos → nota fail-closed
   * (el finding se conserva intacto). Sin pedidos válidos → null (revise
   * clásico). Corre una vez por review, en cada ronda del loop. Nunca lanza.
   */
  private async maybeRunReverify(
    id: string,
    result: ReviewResult,
    item: WorkItem,
    countBefore: number,
  ): Promise<{ commands: string[]; evidence: string } | null> {
    try {
      const findings = Array.isArray(result.findings) ? result.findings : [];
      const requested = findings.filter(
        (f) => !!f && typeof f === "object" && (f as unknown as { reverify?: unknown }).reverify !== undefined,
      );
      if (requested.length === 0) return null;
      const { createdFiles } = extractImplementMeta(item);
      const worktree = path.resolve(item.worktree);
      const validAll: string[] = [];
      let sawInvalid = false;
      for (const finding of requested) {
        const rawCommands = (finding as unknown as { reverify?: { commands?: unknown } }).reverify
          ?.commands;
        let checked: { valid: string[]; invalid: string[] };
        try {
          checked = validateReverifyCommands(rawCommands, worktree, createdFiles);
        } catch {
          checked = { valid: [], invalid: [] };
        }
        for (const cmd of checked.valid) {
          if (!validAll.includes(cmd)) validAll.push(cmd);
        }
        if (checked.invalid.length > 0) sawInvalid = true;
      }
      if (sawInvalid) {
        try {
          workItemStore.appendEvent(
            id,
            "system",
            `${REVERIFY_IGNORED_NOTE} — el pedido queda como finding para el humano`,
            { reverifyIgnored: true } as unknown as Record<string, unknown>,
          );
        } catch {}
      }
      // 1 reverify por review como máximo: cada ronda del loop ejecuta el
      // suyo (evidencia fresca sobre el retrabajo nuevo), siempre acotado
      // por allowlist + topes. La cota del loop (MAX_REVIEW_ROUNDS) frena al
      // mock que siempre pide reverify.
      if (validAll.length === 0) return null;
      let focused: { commands: string[]; evidence: string };
      try {
        focused = await verificationService.runFocused(validAll, {
          worktree,
          jobPaths: createdFiles,
        });
      } catch {
        return null;
      }
      const commands = Array.isArray(focused.commands) ? focused.commands : [];
      const evidence = capReverifyEvidence(focused.evidence);
      try {
        workItemStore.appendEvent(
          id,
          "system",
          `reverify: ejecutados ${commands.length} comando(s): ${commands.join(", ")}`,
          { reverify: { commands, evidence } } as unknown as Record<string, unknown>,
        );
      } catch {}
      return { commands, evidence };
    } catch {
      return null;
    }
  }

  decideNext(
    verdict: ReviewResult["verdict"],
    countBefore: number,
  ): "Complete" | "Building" | null {
    return decideReviewNext(verdict, countBefore);
  }
}

export const reviewService = new ReviewService();
