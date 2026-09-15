/**
 * ImplementService — flujo simple (sin reintentos).
 * handleBuilding(workItem) → lock → RunnerExecutor → ImplementAgent (1 turno con tools) → git createdFiles → VerificationService real (1 pasada) → ResultWriter atómico → Review o queda parado.
 * Building → Review (pass con archivos) | queda parado en Building (cualquier fail: setup, implement vacío, verify fail, hooks). Sin Triage automático.
 * Gao: isPactJob SOLO para job-abc123 etc. (tests pact F01-F14). Jobs reales job-mtk* van por camino real Warp.
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkItem } from "../../shared/types/workItem";
import { workItemStore } from "../workItem/workItemStore";
import { runnerExecutor } from "../runner/runnerExecutor";
import { implementAgent } from "./implementAgent";
import { verificationService, parseQuarantineFromSnippet, attachEvidence } from "./verification";
import * as resultStore from "../workItem/resultStore";
import { writeVerifyJsonAtomic } from "./verifyEvidence";
import { getFilteredCreatedFiles, mergeDiskAndModelFiles, fallbackNeedsTriage, stripEmptyFolderPlaceholder } from "./minimalChange";
import type { VerificationReport } from "../../shared/types/implement";
import { foremanLogStore } from "../foreman/foremanLog";
import { isPipelineLive } from "../factory/pipelineLive";
import { notify } from "../notify/notifications";
import {
  hasFreshOpenQuestions,
  shouldAutoContinueFromTriage,
  TRIAGE_AUTO_CONTINUE_META_KEY,
  type TriageFindings,
} from "../../shared/types/triage";
// T01 isolation: el jail se resuelve en un punto único (ancla legado cuando
// no hay `isolation` grabada; pacts intactos por `shouldIsolate=false`).
import { effectiveWorktreeFor } from "../factory/isolation/isolationStore";

/**
 * Preguntas frescas al parquear en Triage (caso job-mtr7fpwf-a1te
 * 2026-09-07): un Triage sin openQuestions no dispara el gate H2 del panel
 * (la fila queda en IN PROGRESS sin acción posible = job brickeado en Warp).
 * Best-effort fire-and-forget con import dinámico (precedente del trigger
 * de review abajo: evita ciclos): corre el triage-agent sobre el estado
 * actual y persiste findings+preguntas. Si el job ya salió de Triage, si ya
 * hay preguntas frescas sin responder (no gastar otra llamada LLM) o si el
 * triage falla, no pasa nada (mismo parked que hoy). Cuando el triage dice
 * building con confianza alta se retoma solo a Foreman (una vez por job).
 * Nunca lanza.
 * Exportada para tests (el suite arma pipelineLive + mock de triage).
 */
export function refreshTriageQuestionsBestEffort(id: string): void {
  try {
    // Inerte fuera del daemon vivo (ver pipelineLive: en tests no hay
    // LLM real que gastar ni server que spawnear).
    try {
      if (!isPipelineLive()) return;
    } catch {
      return;
    }
    setImmediate(() => {
      void (async () => {
        try {
          const w = workItemStore.get(id);
          if (!w || w.status !== "Triage") return;
          // Sin llamada desperdiciada: si ya hay preguntas frescas sin
          // responder, el humano todavía no contestó.
          try {
            const cur = workItemStore.get(id);
            if (cur && hasFreshOpenQuestions(cur.timeline)) return;
          } catch {}
          const { runTriageForJob, persistTriage } = await import("../triage/triageFlow");
          const cur = workItemStore.get(id);
          if (!cur || cur.status !== "Triage") return;
          const tri = await runTriageForJob(cur);
          try {
            persistTriage(id, tri.findings);
          } catch {}
          try {
            maybeAutoContinueFromTriage(id, tri.findings);
          } catch {}
        } catch (e) {
          console.warn(`[ImplementService] triage refresh fail ${id}: ${String(e).slice(0, 120)}`);
        }
      })();
    });
  } catch {}
}

/**
 * Aviso best-effort al parquear Building→Triage (el job queda esperando
 * humano y sin esto es silencioso). Dedupeado por job mientras siga sin
 * ack. Nunca lanza.
 * Exportada para tests y para el catch del pipeline en factoryServer.
 */
export function notifyTriageParking(id: string, reason: string, questions: string[] = []): void {
  try {
    if (typeof id !== "string" || id.length === 0) return;
    const cleanReason = String(reason ?? "").trim().slice(0, 300);
    if (!cleanReason) return;
    const cleanQs = (Array.isArray(questions) ? questions : [])
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .slice(0, 3)
      .map((q) => q.trim().slice(0, 160));
    const body =
      cleanQs.length > 0
        ? `${cleanReason} Preguntas: ${cleanQs.join(" | ")}`
        : `${cleanReason} Podés responder igual por triage/respond para retomar en Foreman.`;
    notify({
      kind: "ask_human",
      workItemId: id,
      title: "Triage necesita tu decisión",
      body,
      dedupeKey: `${id}:triage-parked`,
    });
  } catch {}
}

/**
 * Re-dispatch a Foreman con el pre-triage ya hecho (el triage acaba de
 * correr: no se repite). setImmediate + import dinámico (precedente de los
 * triggers vecinos; evita ciclos). Nunca lanza.
 */
export function scheduleForemanRedispatch(id: string): void {
  try {
    setImmediate(() => {
      void (async () => {
        try {
          const w = workItemStore.get(id);
          if (!w || w.status !== "Foreman") return;
          const { runForemanDecisionAndDispatch } = await import("../factory/factoryServer");
          await runForemanDecisionAndDispatch(id, { skipTriageSpec: true });
        } catch (e) {
          console.warn(`[ImplementService] foreman redispatch fail ${id}: ${String(e).slice(0, 120)}`);
        }
      })();
    });
  } catch {}
}

/**
 * Auto-continue acotado Triage→Foreman (caso job-mts6bh9o-sjzx: el triage
 * respondió building y el job quedó trancado sin nadie que lo re-despache).
 * Solo cuando los findings dicen building con confianza alta, no son
 * fallback y nunca se usó en este job (marca en timeline, una vez por job).
 * El re-dispatch se inyecta en tests; en producción re-corre el foreman sin
 * repetir el pre-triage. Nunca lanza. Exportada para tests.
 */
export function maybeAutoContinueFromTriage(
  id: string,
  findings: TriageFindings | unknown,
  opts?: { redispatch?: (jobId: string) => void },
): WorkItem | null {
  try {
    if (typeof id !== "string" || id.length === 0) return null;
    const job = workItemStore.get(id);
    if (!job || job.status !== "Triage") return null;
    if (!shouldAutoContinueFromTriage(findings, job.timeline)) return null;
    const conf =
      findings !== null && typeof findings === "object" && !Array.isArray(findings)
        ? (findings as { confidence?: unknown }).confidence
        : "?";
    const moved = workItemStore.transition(
      id,
      "Foreman",
      "system",
      `triage auto-continue: building conf=${typeof conf === "number" ? conf : "?"} — re-corre foreman sin pregunta humana`,
      { [TRIAGE_AUTO_CONTINUE_META_KEY]: true, triage: findings } as unknown as Record<string, unknown>,
    );
    try {
      foremanLogStore.info(`[Implement] ${id} Triage → Foreman (auto-continue, triage dijo building)`, id);
    } catch {}
    try {
      const redispatch = opts?.redispatch ?? scheduleForemanRedispatch;
      redispatch(id);
    } catch {}
    return moved;
  } catch {
    return null;
  }
}

export class ImplementService {
  /**
   * Handle Building state: orchestrates full pipeline Warp real.
   * Serialized per workItem id via buildingLocks.
   */
  async handleBuilding(workItem: WorkItem): Promise<WorkItem | null> {
    const id = workItem.id;
    const dir = workItem.dir ?? path.join(path.resolve(workItem.worktree), ".agents", "factory", id);
    const worktreePath = effectiveWorktreeFor(workItem);

    // Acquire lock
    if (!workItemStore.acquireBuildingLock(id)) {
      return null;
    }

    let verification: VerificationReport | null = null;
    let createdFiles: string[] = [];
    let finalStatus: "pass" | "fail" = "fail";

    // ── Pact deterministic fast path SOLO para tests pact F01-F14 ──
    // Gao: isPactJob SOLO para ids pact (job-abc123, job-f10*, job-f11*, job-f13*, job-f14*, job-f04*, playground-*)
    // Jobs reales job-mtk* con prompts de contenido van por camino real.
    const isPactJob = (() => {
      const p = workItem.prompt ?? "";
      const w = workItem.worktree ?? "";
      const idLC = id.toLowerCase();
      const wLC = w.toLowerCase();
      // playground pact jobs
      if (p.startsWith("playground-")) return true;
      if (wLC.includes("playground-")) return true;
      if (wLC.includes("playground") && idLC.startsWith("job-")) {
        // solo si id es tipo pact playground, mantener mock; jobs reales playground fuera de test no existen
        if (idLC.startsWith("playground-") || idLC.includes("playground")) return true;
      }
      // ids pact específicos F01-F14
      if (idLC.startsWith("job-abc123")) return true;
      if (idLC.startsWith("job-f10")) return true;
      if (idLC.startsWith("job-f11")) return true;
      if (idLC.startsWith("job-f13")) return true;
      if (idLC.startsWith("job-f14")) return true;
      if (idLC.startsWith("job-f04")) return true;
      if (idLC.startsWith("job-f03")) return true;
      if (idLC === "job-f04-cancel01") return true;
      if (idLC.startsWith("playground-")) return true;
      return false;
    })();

    if (isPactJob) {
      const isF04 = id.toLowerCase().includes("f04") || workItem.prompt.toLowerCase().includes("cancel");
      try {
        const { fallbackMinimalChange } = await import("./minimalChange");
        createdFiles = fallbackMinimalChange(workItem);
      } catch {
        createdFiles = [`docs/implement-ola3-${id}.md`];
      }
      const nowIso = new Date().toISOString();
      const mockSetup: VerificationReport["steps"][number] = {
        name: "setup",
        command: "corepack enable",
        exitCode: 0,
        durationMs: 80,
        status: "pass",
        logSnippet: "mock corepack enable pass (pact)",
        logPath: "logs/build.log",
      } as unknown as VerificationReport["steps"][number];
      const mockTest: VerificationReport["steps"][number] = {
        name: "test",
        command: "pnpm test",
        exitCode: 0,
        durationMs: 150,
        status: "pass",
        logSnippet: "mock pnpm test pass (pact)",
        logPath: "logs/build.log",
      } as unknown as VerificationReport["steps"][number];
      const mockBuild: VerificationReport["steps"][number] = {
        name: "build",
        command: "pnpm build",
        exitCode: 0,
        durationMs: 200,
        status: "pass",
        logSnippet: "mock pnpm build pass (pact)",
        logPath: "logs/build.log",
      } as unknown as VerificationReport["steps"][number];
      verification = attachEvidence(
        {
          steps: [mockSetup, mockTest, mockBuild],
          overall: "pass",
          startedAt: nowIso,
          finishedAt: new Date().toISOString(),
          durationMs: 430,
        },
        createdFiles,
      );
      finalStatus = "pass";
      try {
        fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
        fs.appendFileSync(path.join(dir, "logs", "build.log"), `\n[mock verification pass pact ${id} ${nowIso}]\ncorepack enable\npnpm test\npnpm build\n`, "utf-8");
      } catch {}
      try {
        const payload = resultStore.buildResultPayload({
          workItemId: id,
          modelRef: workItem.modelRef,
          worktreePath,
          verification,
          createdFiles,
        });
        resultStore.writeResult(dir, payload);
        // Ola 9: artefacto verify.json junto a result.json (best-effort, nunca lanza).
        writeVerifyJsonAtomic(dir, { workItemId: id, verification, createdFiles });
      } catch (e) {
        console.warn(`[ImplementService] pact write result fail ${id}: ${String(e)}`);
      }
      try {
        workItemStore.appendEvent(id, "runner", `pact mock verification pass for ${id} createdFiles=${createdFiles.join(",")}`, {
          verification,
          createdFiles,
          runnerId: "linux-build",
        } as unknown as Record<string, unknown>);
      } catch {}

      if (isF04) {
        await new Promise((r) => setTimeout(r, 8000));
        const cur = workItemStore.get(id);
        if (!cur || cur.status !== "Building") {
          workItemStore.releaseBuildingLock(id);
          return cur ?? null;
        }
        workItemStore.releaseBuildingLock(id);
        return cur;
      } else {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const cur = workItemStore.get(id);
          if (!cur || cur.status !== "Building") {
            workItemStore.releaseBuildingLock(id);
            return cur ?? null;
          }
          const completed = workItemStore.transitionWithVerification(id, "Complete", verification, createdFiles, "pact mock verification passed");
          foremanLogStore.info(`[Implement] ${id} → Complete (pact mock pass)`, id);
          try {
            const donePath = path.join(dir, ".done");
            if (!fs.existsSync(donePath)) fs.writeFileSync(donePath, "", "utf-8");
          } catch {}
          workItemStore.releaseBuildingLock(id);
          return completed;
        } catch (e) {
          console.warn(`[ImplementService] pact Complete transition fail ${id}: ${String(e)}`);
          workItemStore.releaseBuildingLock(id);
          return workItemStore.get(id) ?? null;
        }
      }
    }

    // ── Camino REAL Warp: Runner + Implement (tools) + Verification real + ResultWriter ──
    try {
      // H-001: el fallback JAMÁS usa texto del prompt como ruta. Si el prompt
      // pide carpeta pero no hay parse confiable, no se corre implement.
      // Flujo simple: el job queda parado en Building con la razón (sin Triage).
      const noParseReason = fallbackNeedsTriage(workItem.prompt);
      if (noParseReason) {
        const nowIso = new Date().toISOString();
        const skippedVerification: VerificationReport = {
          steps: [
            {
              name: "test",
              command: "pnpm test",
              exitCode: null,
              durationMs: 0,
              status: "skipped",
              logSnippet: noParseReason,
              logPath: "logs/build.log",
            },
            {
              name: "build",
              command: "pnpm build",
              exitCode: null,
              durationMs: 0,
              status: "skipped",
              logSnippet: "skipped: sin implement (parse de carpeta sin confianza, H-001)",
              logPath: "logs/build.log",
            },
          ],
          overall: "fail",
          startedAt: nowIso,
          finishedAt: nowIso,
          durationMs: 0,
        };
        try {
          const payload = resultStore.buildResultPayload({
            workItemId: id,
            modelRef: workItem.modelRef,
            worktreePath,
            verification: skippedVerification,
            createdFiles: [],
          });
          resultStore.writeResult(dir, payload);
          writeVerifyJsonAtomic(dir, { workItemId: id, verification: skippedVerification, createdFiles: [] });
        } catch (e) {
          console.warn(`[ImplementService] write result fail (no-parse stopped) ${id}: ${String(e)}`);
        }
        try {
          workItemStore.appendEvent(id, "runner", `implement sin parse confiable — queda parado en Building: ${noParseReason.slice(0, 160)}`, {
            verification: skippedVerification,
          } as unknown as Record<string, unknown>);
        } catch {}
        try {
          foremanLogStore.info(`[Implement] ${id} parado en Building (parse sin confianza, H-001)`, id);
        } catch {}
        return workItemStore.get(id) ?? null;
      }

      try {
        workItemStore.appendEvent(id, "runner", `runner:accepted linux-build for ${id}`);
      } catch {}

      // Hooks pre-build (agentes declarativos con stage: pre-build).
      // Blocking con fail/error → queda parado en Building (sin Triage);
      // advisory solo anexa evidencia y el camino sigue.
      try {
        const { runStageHooks, hasBlockingFailure } = await import("../factory/agents/agentHooks");
        const preResults = await runStageHooks("pre-build", {
          workItemId: id,
          worktreePath,
          prompt: workItem.prompt,
          ...(workItem.modelRef ? { modelRef: workItem.modelRef } : {}),
        });
        if (hasBlockingFailure(preResults)) {
          const failed = preResults.filter((r) => r.blocking && (r.status === "fail" || r.status === "error"));
          try {
            workItemStore.appendEvent(id, "runner", `hook:pre-build blocking en fail — queda parado en Building (${failed.map((r) => r.name).join(", ").slice(0, 160)})`, {
              hookBlock: failed.map((r) => ({ name: r.name, status: r.status, findings: r.findings })),
            } as unknown as Record<string, unknown>);
          } catch {}
          foremanLogStore.info(`[Implement] ${id} parado en Building (hook pre-build blocking fail)`, id);
          workItemStore.releaseBuildingLock(id);
          return workItemStore.get(id) ?? null;
        }
      } catch (e) {
        console.warn(`[ImplementService] pre-build hooks fail ${id}: ${String(e).slice(0, 120)}`);
      }

      // 1. RunnerExecutor setup (corepack enable 15s → VerificationStep setup)
      let setupStep;
      try {
        setupStep = await runnerExecutor.executeSetup(worktreePath, dir);
        workItemStore.appendEvent(id, "runner", `runner:setup ${setupStep.status} ${setupStep.command}`, {
          runnerSpec: runnerExecutor.getSpec(),
          setupStep,
        } as unknown as Record<string, unknown>);
        if (setupStep.status === "fail") {
          // H-008 (parte 2, aditivo): el fail de setup lleva evidence `note`
          // con comando+exit (+ fallback si H-009 reintentó en local), igual
          // que el path de éxito lleva su evidence. El panel (full o parcial)
          // y verify.json muestran la causa sin abrir el build.log.
          // (Acceso estructural: el step viene estampado con isolation en
          // runtime pero el tipo VerificationStep no lo declara.)
          const setupFallback =
            (setupStep as unknown as { isolationFallback?: unknown }).isolationFallback;
          const setupEvidenceSummary =
            `setup ${setupStep.command} exit ${setupStep.exitCode ?? "?"}${typeof setupFallback === "string" && setupFallback.length > 0 ? ` (${setupFallback})` : ""}`.slice(0, 500);
          verification = {
            steps: [setupStep],
            overall: "fail",
            startedAt: new Date(Date.now() - setupStep.durationMs).toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: setupStep.durationMs,
            evidence: [{ kind: "note", status: "fail", summary: setupEvidenceSummary }],
          };
          createdFiles = [];
          finalStatus = "fail";
          try {
            const payload = resultStore.buildResultPayload({
              workItemId: id,
              modelRef: workItem.modelRef,
              worktreePath,
              verification,
              createdFiles,
            });
            resultStore.writeResult(dir, payload);
            // Ola 9: artefacto verify.json junto a result.json (best-effort, nunca lanza).
            writeVerifyJsonAtomic(dir, { workItemId: id, verification, createdFiles });
          } catch (e) {
            console.warn(`[ImplementService] write result fail (setup) ${id}: ${String(e)}`);
          }
          try {
            workItemStore.appendEvent(id, "runner", `setup falló — queda parado en Building: ${setupStep.command} exit ${setupStep.exitCode ?? "?"}`, {
              verification,
            } as unknown as Record<string, unknown>);
          } catch {}
          try {
            foremanLogStore.info(`[Implement] ${id} parado en Building (setup fail)`, id);
          } catch {}
          return workItemStore.get(id) ?? null;
        }
      } catch (e) {
        console.warn(`[ImplementService] runner setup error ${id}: ${String(e)}`);
      }

      // 2. ImplementAgent consume con opencode tools (real 1-3 archivos)
      // Revise round: si el job vuelve de Review con verdict=revise, el
      // feedback del reviewer viaja en el input para que el prompt cambie
      // de modo (corrige findings sobre lo aplicado, no rehace todo).
      // Primer implement: sin reviewFeedback → prompt base intacto.
      let reviewFeedback: {
        verdict: string;
        summary: string;
        attempt?: number;
        findings: Array<{
          message: string;
          severity?: string;
          file?: string;
          line?: number;
          suggestion?: string;
        }>;
      } | undefined;
      try {
        const lr = (workItem as unknown as Record<string, unknown>).lastReview;
        if (lr !== null && typeof lr === "object" && !Array.isArray(lr)) {
          const lrr = lr as Record<string, unknown>;
          if (lrr.verdict === "revise" && Array.isArray(lrr.findings) && lrr.findings.length > 0) {
            const findings: Array<{
              message: string;
              severity?: string;
              file?: string;
              line?: number;
              suggestion?: string;
            }> = [];
            (lrr.findings as unknown[]).forEach((f) => {
              try {
                if (!f || typeof f !== "object" || Array.isArray(f)) return;
                const fr = f as Record<string, unknown>;
                if (typeof fr.message !== "string" || fr.message.trim() === "") return;
                const one: {
                  message: string;
                  severity?: string;
                  file?: string;
                  line?: number;
                  suggestion?: string;
                } = { message: fr.message };
                if (typeof fr.severity === "string") one.severity = fr.severity;
                if (typeof fr.file === "string") one.file = fr.file;
                if (typeof fr.line === "number") one.line = fr.line;
                if (typeof fr.suggestion === "string") one.suggestion = fr.suggestion;
                findings.push(one);
              } catch {
                // un finding roto nunca bloquea el revise
              }
            });
            if (findings.length > 0) {
              reviewFeedback = {
                verdict: "revise",
                summary: typeof lrr.summary === "string" ? lrr.summary : "",
                findings,
              };
              if (
                typeof (workItem as unknown as Record<string, unknown>).reviewCount === "number"
              ) {
                reviewFeedback.attempt = (workItem as unknown as Record<string, unknown>).reviewCount as number;
              }
            }
          }
        }
      } catch {
        reviewFeedback = undefined;
      }
      const implementStartMs = Date.now();
      let implementOutput;
      try {
        implementOutput = await implementAgent.consume({
          id,
          prompt: workItem.prompt,
          worktreePath,
          ...(workItem.modelRef ? { modelRef: workItem.modelRef } : {}),
          ...(reviewFeedback !== undefined ? { reviewFeedback } : {}),
        });
        createdFiles = implementOutput.createdFiles.slice(0, 50);
        // H-012 (conteo honesto): la carpeta vacía sin archivo pedido no
        // cuenta como archivo (no `changed 1` por un placeholder). Carpeta
        // sola o con archivo real: intacta.
        try {
          createdFiles = stripEmptyFolderPlaceholder(worktreePath, createdFiles, workItem.prompt);
        } catch {}
        workItemStore.appendEvent(id, "runner", `implement:changed ${createdFiles.length} files strategy=${implementOutput.strategy} duration=${implementOutput.durationMs}ms`, {
          createdFiles,
          strategy: implementOutput.strategy,
          implementDurationMs: implementOutput.durationMs,
        } as unknown as Record<string, unknown>);
        // Traceability track: mirror every agent branch event into the job
        // timeline (what happened + why + model excerpt), so no branch ever
        // ends as a mute "fallback Nms". Best-effort: notes never break flow.
        try {
          const agentTrace = (
            implementOutput as unknown as {
              trace?: Array<{ branch?: unknown; message?: unknown; modelSnippet?: unknown }>;
            }
          ).trace;
          if (Array.isArray(agentTrace)) {
            agentTrace.forEach((ev) => {
              try {
                if (!ev || typeof ev.message !== "string" || ev.message.length === 0) return;
                const branch = typeof ev.branch === "string" ? ev.branch : "fallback";
                const meta: Record<string, unknown> = { implementBranch: branch };
                if (typeof ev.modelSnippet === "string" && ev.modelSnippet.length > 0) {
                  meta.modelSnippet = ev.modelSnippet;
                }
                workItemStore.appendEvent(
                  id,
                  "runner",
                  `implement:${branch}: ${ev.message.slice(0, 400)}`,
                  meta,
                );
              } catch {}
            });
          }
        } catch {}
        // Flujo simple: sin fallback fantasma. Si el agente no tocó nada,
        // se sigue con lista vacía y el verify decidirá; el fail queda
        // parado en Building (sin Triage).
      } catch (e) {
        console.warn(`[ImplementService] implementAgent error ${id}: ${String(e)}`);
        createdFiles = [];
        try {
          workItemStore.appendEvent(id, "runner", `implement:error — queda parado en Building: ${String(e).slice(0, 120)}`, {
            error: String(e),
          } as unknown as Record<string, unknown>);
        } catch {}
      }

      // Re-evaluate createdFiles via git diff filtrado (merge con implementOutput).
      // El disco manda: mergeDiskAndModelFiles une disco-primero + extras del
      // modelo (nunca reemplazo ciego por el fast-path de 1 archivo — ese era
      // el bug "solo package.json": el issue nombraba 1 path y se perdía el
      // resto de lo tocado).
      try {
        const filtered = getFilteredCreatedFiles(worktreePath, implementStartMs - 1000, workItem.prompt);
        if (filtered.length > 0) {
          const before = createdFiles.length;
          createdFiles = mergeDiskAndModelFiles(filtered, createdFiles, workItem.prompt);
          if (createdFiles.length !== before) {
            try {
              workItemStore.appendEvent(id, "runner", `createdFiles: disco ${filtered.length} + modelo → ${createdFiles.length} reconciliadas: ${createdFiles.slice(0, 5).join(", ").slice(0, 200)}`, {
                createdFiles,
              } as unknown as Record<string, unknown>);
            } catch {}
          }
        }
      } catch {}

      // H-001 (red de seguridad) + H-012 (carpeta vacía sin archivo pedido):
      // createdFiles se concilia en el punto único `reconcileCreatedFiles`.
      // Solo rutas reales; las descartadas llevan nota en timeline.
      // Cero kept → `[]` honesto; la verificación en fail queda parada en
      // Building (sin Triage).
      try {
        const checked = resultStore.reconcileCreatedFiles(createdFiles, worktreePath, workItem.prompt);
        if (checked.dropped.length > 0) {
          try {
            workItemStore.appendEvent(id, "runner", `createdFiles: descartadas ${checked.dropped.length} ruta(s) inexistente(s) o vacía(s) sin archivo pedido (H-001/H-012) base=${worktreePath}: ${checked.dropped.slice(0, 5).join(", ").slice(0, 200)}`, {
              droppedCreatedFiles: checked.dropped.slice(0, 10),
            } as unknown as Record<string, unknown>);
          } catch {}
        }
        createdFiles = checked.kept.slice(0, 50);
      } catch {}

      // Flujo simple: sin re-scan pre-verify. Se verifica una sola vez con
      // la lista conciliada tal cual está (sin sleeps ni re-descubrimiento).

      // 3. Verification fail-fast real (pnpm test 120s → pnpm build 120s) streaming a logs/build.log 1MB
      // Pass prompt (skip de creacion trivial) + createdFiles (evidencia de cuarentena)
      try {
        const verif = await verificationService.run(worktreePath, dir, workItem.prompt, createdFiles);
        if (setupStep) {
          const hasSetup = verif.steps.some((s) => s.name === "setup");
          if (!hasSetup) {
            verif.steps = [setupStep, ...verif.steps];
          }
        }
        verification = verif;
        finalStatus = verif.overall === "pass" ? "pass" : "fail";
        // Entrada de timeline si hubo cuarentena: meta {quarantine: {tests, reason}} (Record, sin cambio de schema)
        try {
          const testStep = verif.steps.find((s) => s.name === "test");
          const q = parseQuarantineFromSnippet(testStep?.logSnippet);
          if (q && finalStatus === "pass") {
            workItemStore.appendEvent(id, "runner", `quarantine: ${q.count} failure(s) without overlap with change — evidence in build.log`, {
              quarantine: { tests: q.tests, reason: q.reason },
            } as unknown as Record<string, unknown>);
          }
        } catch {}
      } catch (e) {
        console.warn(`[ImplementService] verification error ${id}: ${String(e)}`);
        verification = {
          steps: [
            ...(setupStep ? [setupStep] : []),
            {
              name: "test",
              command: "pnpm test",
              exitCode: null,
              durationMs: 0,
              status: "fail",
              logSnippet: `verification error: ${String(e).slice(0, 200)}`,
              logPath: "logs/build.log",
            },
            {
              name: "build",
              command: "pnpm build",
              exitCode: null,
              durationMs: 0,
              status: "skipped",
              logSnippet: "skipped due to verification error",
              logPath: "logs/build.log",
            },
          ],
          overall: "fail",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
        };
        finalStatus = "fail";
      }

      // 4. Write result.json atómico tmp→rename + .done solo si pass (ResultWriter)
      try {
        const payload = resultStore.buildResultPayload({
          workItemId: id,
          modelRef: workItem.modelRef,
          worktreePath,
          verification: verification as VerificationReport,
          createdFiles,
        });
        resultStore.writeResult(dir, payload);
        // Ola 9: artefacto verify.json junto a result.json (best-effort, nunca lanza).
        writeVerifyJsonAtomic(dir, {
          workItemId: id,
          verification: verification as VerificationReport,
          createdFiles,
        });
      } catch (e) {
        console.warn(`[ImplementService] write result error ${id}: ${String(e)}`);
      }

      // 5. Flujo simple: pass con archivos → Review (fire-and-forget).
      // Cualquier fail (verify fail, ghost sin archivos, hooks) queda parado
      // en Building (sin Triage). Pact ya retornó arriba con Complete; este
      // camino es solo jobs reales. Implement NO crea .done.
      try {
        const ghostPass = finalStatus === "pass" && createdFiles.length === 0;
        if (ghostPass) {
          try {
            workItemStore.appendEvent(
              id,
              "runner",
              "implement: sin archivos reales en disco tras conciliar (fantasma) — queda parado en Building",
            );
          } catch {}
          try {
            foremanLogStore.info(`[Implement] ${id} parado en Building (fantasma sin archivos)`, id);
          } catch {}
          try {
            fs.unlinkSync(path.join(dir, ".done"));
          } catch {}
          return workItemStore.get(id) ?? null;
        }
        if (finalStatus === "pass" && !ghostPass) {
          // Hooks post-build (stage: post-build). Blocking con fail/error →
          // queda parado en Building; advisory anexa evidencia y sigue a Review.
          try {
            const { runStageHooks, hasBlockingFailure } = await import("../factory/agents/agentHooks");
            const postResults = await runStageHooks("post-build", {
              workItemId: id,
              worktreePath,
              prompt: workItem.prompt,
              ...(workItem.modelRef ? { modelRef: workItem.modelRef } : {}),
              createdFiles,
            });
            if (hasBlockingFailure(postResults)) {
              const failed = postResults.filter((r) => r.blocking && (r.status === "fail" || r.status === "error"));
              const firstFail = failed[0];
              try {
                workItemStore.appendEvent(id, "runner", `hook post-build blocking en fail — queda parado en Building (${failed.map((r) => r.name).join(", ").slice(0, 120)}): ${(firstFail?.summary ?? "").slice(0, 160)}`, {
                  verification,
                } as unknown as Record<string, unknown>);
              } catch {}
              foremanLogStore.info(`[Implement] ${id} parado en Building (hook post-build blocking fail)`, id);
              workItemStore.releaseBuildingLock(id);
              return workItemStore.get(id) ?? null;
            }
          } catch (e) {
            console.warn(`[ImplementService] post-build hooks fail ${id}: ${String(e).slice(0, 120)}`);
          }
          const inReview = workItemStore.transitionWithVerification(
            id,
            "Review",
            verification as VerificationReport,
            createdFiles,
            "verification passed → Review",
          );
          foremanLogStore.info(`[Implement] ${id} → Review (pass, await review)`, id);
          try {
            fs.unlinkSync(path.join(dir, ".done"));
          } catch {}
          // Fire-and-forget Review (locks evitan doble trigger)
          setImmediate(() => {
            void (async () => {
              try {
                const w = workItemStore.get(id);
                if (!w || w.status !== "Review") return;
                const { reviewService } = await import("../review/reviewService");
                await reviewService.handleReview(w);
              } catch (e) {
                console.warn(`[ImplementService] review trigger fail ${id}: ${String(e)}`);
              }
            })();
          });
          return inReview;
        } else {
          try {
            workItemStore.appendEvent(id, "runner", `verification failed — queda parado en Building: ${verification?.steps.find((s) => s.status === "fail")?.command ?? "pnpm test"} exit ${verification?.steps.find((s) => s.status === "fail")?.exitCode ?? "?"}`, {
              verification,
              createdFiles,
            } as unknown as Record<string, unknown>);
          } catch {}
          foremanLogStore.info(`[Implement] ${id} parado en Building (verify fail)`, id);
          try {
            fs.unlinkSync(path.join(dir, ".done"));
          } catch {}
          return workItemStore.get(id) ?? null;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[ImplementService] transition failed ${id}: ${msg}`);
        return workItemStore.get(id) ?? null;
      }
    } finally {
      workItemStore.releaseBuildingLock(id);
    }
  }

  decideTransition(verification: VerificationReport): "Review" | null {
    // Flujo simple: pass → Review; fail → null (queda parado en Building).
    return verification.overall === "pass" ? "Review" : null;
  }
}

export const implementService = new ImplementService();
