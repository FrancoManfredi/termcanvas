/**
 * EngineBridge (F8c) — une el pipeline legacy de work items con el engine
 * declarativo para que TODO el panel Warp/FactoryLab siga funcionando cuando
 * `engine=workflow` (default):
 *
 * - Cada job se ejecuta como run de `factory-default` en el worktree del job.
 * - Los eventos del run se espejan al WorkItem: Intake→Foreman→Building,
 *   gate humano→Review, terminal→Complete/Cancelled, nodos→timeline.
 * - Las acciones del panel (accept/retry/approve/reject/respond/resume/cancel)
 *   se traducen a `runtime.respond/resume/cancel` para los jobs espejados.
 * - El mapa itemId↔runId se persiste best-effort junto a los runs.
 *
 * Con `TERMCANVAS_FACTORY_ENGINE=legacy` el pipeline viejo queda intacto.
 */

import fs from "node:fs";
import path from "node:path";
import { workItemStore } from "../workItem/workItemStore";
import { defaultRunsDir, redactSecrets } from "../workflows/artifacts";
import { buildOwnershipLockPath, maybeHeartbeatOwnership } from "./ownership";
import { buildDashboardUrl } from "../workItem/opencodeSessionUrl";
import { loadWorkflow } from "../workflows/loader";
import type { WorkflowDefinition } from "../workflows/schema";
import {
  selectWorkflowForItem,
  type WorkflowRouteDecision,
} from "../workflows/workflowRouter";
import { notify } from "../notify/notifications";
import { writeVerifyJsonAtomic } from "../implement/verifyEvidence";
import { writeReviewJsonAtomic } from "../review/reviewDisk";
import { extractDispositions } from "./isolation/isolationStore";
import {
  buildReviewReport,
  curateSummary,
  parseReviewReportMeta,
} from "../review/reviewReport";
import type { WorkflowRuntime } from "../workflows/runtime";
import type { WorkflowEvent, WorkflowRun } from "../workflows/types";
import type { ApprovalRequest } from "../workflows/executor";
import { getIssueRef } from "./jobs/jobCreate";
import { resolveSessionWorktree } from "./isolation/sessionWorktree";
import type { VerificationReport } from "../../shared/types/implement";
import type { ReviewResult } from "../../shared/types/review";
import type { CostSummary, EngineRun, WorkItemStatus } from "../../shared/types/workItem";
import {
  BOOT_INTERRUPTED_AT_META_KEY,
  BOOT_INTERRUPTED_META_KEY,
  needsResume,
  RESUMED_META_KEY,
} from "../../shared/types/workItem";

/**
 * F12: el engine es el pipeline ÚNICO. El switch legacy
 * (`TERMCANVAS_FACTORY_ENGINE=legacy`) se retiró — no hay segundo pipeline.
 */
export function isWorkflowEngineEnabled(): boolean {
  return true;
}

/** El daemon registra acá su runtime para que automatizaciones puedan disparar jobs. */
let runtimeProvider: (() => WorkflowRuntime) | null = null;

export function setWorkflowRuntimeProvider(provider: () => WorkflowRuntime): void {
  runtimeProvider = provider;
}

/**
 * Dispara el workflow oficial para un job recién creado (automations,
 * benchmarks u otro intake interno). No-op si el runtime aún no fue
 * registrado.
 */
export function dispatchCreatedJob(itemId: string): void {
  const provider = runtimeProvider;
  if (!provider) return;
  try {
    void runWorkflowJob(itemId, provider());
  } catch {
    // best-effort: el job queda en Intake para resume manual
  }
}

/** Dominios del panel que el bridge intercepta cuando el job es un run espejado. */
export const WORKFLOW_ACTION_DOMAINS = new Set<string>([
  "job-review-accept",
  "job-review-retry",
  "job-review-retry-review",
  "job-review-rerun",
  "job-spec-approve",
  "job-spec-reject",
  "job-triage-respond",
  "job-resume",
  "job-cancel",
  "job-discard",
]);

const runToItem = new Map<string, string>();
const itemToRun = new Map<string, string>();

function mapFilePath(): string {
  return path.join(defaultRunsDir(), "engine-map.json");
}

function persistMap(): void {
  try {
    fs.mkdirSync(path.dirname(mapFilePath()), { recursive: true });
    fs.writeFileSync(
      mapFilePath(),
      JSON.stringify(Object.fromEntries(itemToRun.entries())),
      "utf-8",
    );
  } catch {
    // best-effort: el mapa en memoria alcanza para la sesión
  }
}

let hydrated = false;
function hydrateMap(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = JSON.parse(fs.readFileSync(mapFilePath(), "utf-8")) as Record<string, string>;
    for (const [itemId, runId] of Object.entries(raw)) {
      if (typeof itemId === "string" && typeof runId === "string") {
        itemToRun.set(itemId, runId);
        runToItem.set(runId, itemId);
      }
    }
  } catch {
    // sin mapa previo: arranca vacío
  }
}

/**
 * Descartar TODO un issue también borra el run espejado: desvincula el
 * engine-map (memoria + disco) y elimina `workflow-runs/<runId>`. Sin esto
 * un run "running" huérfano queda en disco y, si el job fuera restaurado,
 * la re-sincronización G2 lo reviviría. Best-effort, nunca lanza.
 */
export function discardRunArtifacts(itemId: string, runId?: string | null): void {
  try {
    hydrateMap();
    const mapped = itemToRun.get(itemId) ?? null;
    const rid = typeof runId === "string" && runId !== "" ? runId : mapped;
    itemToRun.delete(itemId);
    if (mapped !== null) runToItem.delete(mapped);
    if (rid !== null) runToItem.delete(rid);
    persistMap();
    if (rid !== null && /^run-[A-Za-z0-9-]+$/.test(rid)) {
      fs.rmSync(path.join(defaultRunsDir(), rid), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  } catch {
    // best-effort: el job ya no existe y nada lo revive por el mapa
  }
}

export function runIdForItem(itemId: string): string | null {
  hydrateMap();
  return itemToRun.get(itemId) ?? null;
}

export function itemIdForRun(runId: string): string | null {
  hydrateMap();
  return runToItem.get(runId) ?? null;
}

function registerLink(itemId: string, runId: string): void {
  itemToRun.set(itemId, runId);
  runToItem.set(runId, itemId);
  persistMap();
}

function transitionSafe(
  itemId: string,
  to: WorkItemStatus,
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    workItemStore.transition(itemId, to, "system", message, meta);
  } catch {
    // transición ya aplicada o ilegal: el espejo nunca rompe el run
  }
}

/**
 * Texto legible de `findings` para review.json (WS2): acepta el contrato
 * estructurado (array de findings `{id, severity, message, file?}`) y el
 * legacy string/objeto. Best-effort: nunca lanza, nunca inventa contenido.
 */
function renderFindingsText(findings: unknown): string {
  try {
    if (typeof findings === "string") return findings.trim();
    if (Array.isArray(findings)) {
      const lines: string[] = [];
      for (const entry of findings) {
        if (typeof entry === "string") {
          if (entry.trim() !== "") lines.push(entry.trim());
          continue;
        }
        if (entry === null || typeof entry !== "object") continue;
        const finding = entry as Record<string, unknown>;
        const severity =
          typeof finding.severity === "string" && finding.severity.trim() !== ""
            ? finding.severity.trim()
            : "info";
        const id =
          typeof finding.id === "string" && finding.id.trim() !== ""
            ? ` ${finding.id.trim()}`
            : "";
        const file =
          typeof finding.file === "string" && finding.file.trim() !== ""
            ? ` (${finding.file.trim()})`
            : "";
        const message =
          typeof finding.message === "string" ? finding.message.trim() : "";
        if (message === "") continue;
        lines.push(`[${severity}]${id}${file}: ${message}`);
      }
      return lines.join("\n").trim();
    }
    if (findings !== null && findings !== undefined && typeof findings === "object") {
      return JSON.stringify(findings);
    }
  } catch {
    // best-effort: la UI cae al output crudo del review
  }
  return "";
}

/**
 * Pasos reales del nodo verify determinístico (`verify-runner`): el outputJson
 * trae `{pass, steps[]}`. Null = payload legacy/sintético (narrativa).
 */
function asEngineVerifySteps(outputJson: unknown): Array<Record<string, unknown>> | null {
  try {
    if (!outputJson || typeof outputJson !== "object" || Array.isArray(outputJson)) {
      return null;
    }
    const steps = (outputJson as { steps?: unknown }).steps;
    if (!Array.isArray(steps) || steps.length === 0) return null;
    return steps.filter(
      (step): step is Record<string, unknown> =>
        step !== null && typeof step === "object" && !Array.isArray(step),
    );
  } catch {
    return null;
  }
}

/** Log legible (y redactado) de la verificación real para logs/build.log. */
function renderVerifyLog(
  steps: Array<Record<string, unknown>>,
  run: WorkflowRun,
): string {
  const lines: string[] = [
    `[verify-runner ${run.id} · workflow ${run.workflow} · ${new Date().toISOString()}]`,
  ];
  for (const step of steps) {
    const name = typeof step.name === "string" ? step.name : "step";
    const status = typeof step.status === "string" ? step.status : "unknown";
    const exitCode = typeof step.exitCode === "number" ? step.exitCode : "?";
    const durationMs = typeof step.durationMs === "number" ? step.durationMs : 0;
    lines.push("");
    lines.push(`--- ${name} [${status}] exit=${exitCode} ${durationMs}ms ---`);
    if (typeof step.command === "string" && step.command.trim() !== "") {
      lines.push(`$ ${step.command}`);
    }
    if (typeof step.logSnippet === "string" && step.logSnippet.trim() !== "") {
      lines.push(step.logSnippet.trimEnd());
    }
  }
  return `${redactSecrets(lines.join("\n"))}\n`;
}

/**
 * Espeja la evidencia del run a la carpeta del job para que VerificationPanel
 * y ReviewPanel rendericen datos reales en vez de fallbacks:
 * - `verify.json` (VerifyJsonSchema) desde el nodo verify del run.
 * - `review.json` (ReviewResultSchema) desde el nodo review (green/findings).
 * Best-effort: nunca lanza y no pisa nada si el run no tiene esos nodos.
 */
export function mirrorRunEvidence(itemId: string, run: WorkflowRun | null): void {
  if (!run) return;
  try {
    const item = workItemStore.get(itemId);
    const dir = item?.dir;
    if (!dir) return;
    const nodes = Object.values(run.nodes ?? {});
    const pick = (pattern: RegExp) =>
      nodes
        .filter(
          (node) =>
            pattern.test(node.id) &&
            (node.status === "completed" || node.status === "failed"),
        )
        .at(-1);

    const verifyNode = pick(/verify|verific/i);
    const reviewNode = pick(/review|revis/i);
    const verificationText = (verifyNode?.output ?? "").trim();
    const reviewJson = reviewNode?.outputJson as
      | { green?: unknown; summary?: unknown; findings?: unknown }
      | undefined;
    // Veredicto estructurado primero (Fix D): el campo `summary` del
    // review es lo que lee el humano; la prosa cruda solo como fallback.
    const structuredSummary =
      reviewJson && typeof reviewJson.summary === "string"
        ? reviewJson.summary.trim()
        : "";
    const green =
      typeof reviewJson?.green === "boolean"
        ? reviewJson.green
        : /(^|\b)pass(ed)?\b/i.test(verificationText) &&
          !/(^|\b)fail(ed)?\b/i.test(verificationText);
    const verifySteps = asEngineVerifySteps(verifyNode?.outputJson);
    const verifyPass =
      verifyNode?.outputJson &&
      typeof (verifyNode.outputJson as { pass?: unknown }).pass === "boolean"
        ? (verifyNode.outputJson as { pass: boolean }).pass
        : undefined;
    const verifySummary =
      verifyNode?.outputJson &&
      typeof (verifyNode.outputJson as { summary?: unknown }).summary === "string"
        ? (verifyNode.outputJson as { summary: string }).summary
        : "";
    const overall: "pass" | "fail" =
      verifyPass === false
        ? "fail"
        : verifyPass === true
          ? "pass"
          : green
            ? "pass"
            : "fail";
    const now = new Date().toISOString();

    let report: VerificationReport;
    if (verifySteps) {
      // WS3: evidencia REAL del verify-runner (exit codes y duraciones reales).
      const mappedSteps = verifySteps.slice(0, 20).map((step) => {
        const rawStatus = typeof step.status === "string" ? step.status : "fail";
        const status: "pass" | "fail" | "skipped" =
          rawStatus === "pass" || rawStatus === "fail" || rawStatus === "skipped"
            ? rawStatus
            : "fail";
        const rawName = typeof step.name === "string" ? step.name : "";
        const name: "setup" | "test" | "build" =
          rawName === "setup" ? "setup" : rawName === "build" ? "build" : "test";
        return {
          name,
          command:
            typeof step.command === "string" && step.command !== ""
              ? step.command.slice(0, 300)
              : rawName.slice(0, 300),
          exitCode:
            typeof step.exitCode === "number"
              ? step.exitCode
              : status === "skipped"
                ? 0
                : 1,
          durationMs: typeof step.durationMs === "number" ? step.durationMs : 0,
          status,
          ...(typeof step.logSnippet === "string" && step.logSnippet !== ""
            ? { logSnippet: redactSecrets(step.logSnippet).slice(0, 1200) }
            : {}),
          logPath: "logs/build.log",
        };
      });
      report = {
        steps:
          mappedSteps.length > 0
            ? mappedSteps
            : [
                {
                  name: "test" as const,
                  command: "verify-runner",
                  exitCode: overall === "pass" ? 0 : 1,
                  durationMs: 0,
                  status: overall === "pass" ? ("pass" as const) : ("fail" as const),
                  logPath: "logs/build.log",
                },
              ],
        overall,
        startedAt: typeof run.startedAt === "string" ? run.startedAt : now,
        finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : now,
        durationMs: mappedSteps.reduce((acc, step) => acc + step.durationMs, 0),
        ...(verifySummary
          ? {
              evidence: [
                {
                  kind: "note" as const,
                  status: overall,
                  summary: verifySummary.slice(0, 300),
                },
              ],
            }
          : {}),
      };
      try {
        fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
        fs.writeFileSync(
          path.join(dir, "logs", "build.log"),
          renderVerifyLog(verifySteps, run),
          "utf-8",
        );
      } catch {
        // build.log best-effort: verify.json sigue siendo la fuente real
      }
    } else {
      // Legacy/narrativa: un step sintético con el veredicto del review.
      report = {
        steps: [
          {
            name: "test",
            command: `workflow:${run.workflow}/${verifyNode?.id ?? "verify"}`,
            exitCode: overall === "pass" ? 0 : 1,
            durationMs: 0,
            status: overall === "pass" ? "pass" : "fail",
            ...(verificationText
              ? { logSnippet: verificationText.slice(0, 500) }
              : {}),
            logPath: "",
          },
        ],
        overall,
        startedAt: typeof run.startedAt === "string" ? run.startedAt : now,
        finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : now,
        durationMs: 0,
        ...(verificationText
          ? {
              evidence: [
                {
                  kind: "note" as const,
                  status: overall,
                  summary: verificationText.slice(0, 300),
                },
              ],
            }
          : {}),
      };
    }
    writeVerifyJsonAtomic(dir, {
      workItemId: itemId,
      verification: report,
      createdFiles: [],
    });

    // Reporte del implement para el PR (Solution + Review guidance): la
    // salida de la última ronda, recortada. El PR la lee por secciones.
    const implNode = pick(/implement/i);
    const implReport = (implNode?.output ?? "").trim().slice(0, 3000);
    if (implReport !== "") {
      try {
        workItemStore.appendEvent(itemId, "runner", "engine implement report", {
          implementReport: implReport,
        });
      } catch {
        // best-effort: el PR cae al resumen del review
      }
    }

    if (reviewNode) {
      const findingsText = renderFindingsText(reviewJson?.findings);
      // Summary curado (nunca el razonamiento crudo ni cortado a mitad de
      // frase): el texto de findings estructurados se preserva, la prosa del
      // review pasa por el curador con tope y corte en boundary de oración.
      const rawOutput = (reviewNode.output ?? "").trim();
      const summary =
        findingsText !== ""
          ? findingsText.trim().slice(0, 2000)
          : structuredSummary !== ""
            ? curateSummary(structuredSummary, 500) || (green ? "Review OK" : "Review con hallazgos")
            : curateSummary(rawOutput) || (green ? "Review OK" : "Review con hallazgos");
      const result: ReviewResult = {
        workItemId: itemId,
        reviewerModel: { providerID: "termcanvas", modelID: "workflow-engine" },
        verdict: green ? "accept" : "revise",
        confidence: 0.8,
        summary: summary.length > 0 ? summary : "Review del engine",
        findings: [],
        reviewAttempt: 1,
        reviewedAt: now,
      };
      try {
        writeReviewJsonAtomic(dir, result);
      } catch {
        // payload inválido: jamás rompe el espejo
      }
      // P3a: reporte canónico local (prp-review) junto a review.json:
      // metadata máquina + tabla + dispositions + coverage + validación.
      // Sin PR todavía: `pr: 0, publication: pending`; el publish (P3b)
      // lo refresca con número/head/URL reales. Best-effort.
      try {
        const iso = (item as unknown as { isolation?: { branch?: unknown; baseBranch?: unknown } })?.isolation;
        const rawFindings = Array.isArray(reviewJson?.findings) ? reviewJson.findings : [];
        const dispositions = implReport !== "" ? extractDispositions(implReport) : [];
        const dispById = new Map(dispositions.map((d) => [d.id, d]));
        const engineFindings = rawFindings
          .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e))
          .map((e) => {
            const idRaw = typeof e.id === "string" && e.id.trim() !== "" ? e.id.trim().toLowerCase() : "";
            const disp = idRaw !== "" ? dispById.get(idRaw) : undefined;
            return {
              ...e,
              ...(disp ? { state: disp.disposition, dispositionReason: disp.reason } : {}),
              foundBy: "workflow-engine",
            };
          });
        const engineValidation = verifySteps
          ? verifySteps.map((s) => {
              const statusRaw =
                typeof s.status === "string" ? s.status.toLowerCase() : "";
              const snippet =
                typeof s.logSnippet === "string" ? s.logSnippet.slice(-200) : "";
              const exitRaw = typeof s.exitCode === "number" ? s.exitCode : null;
              return {
                command:
                  typeof s.command === "string"
                    ? s.command
                    : typeof s.name === "string"
                      ? s.name
                      : "verify",
                result:
                  statusRaw === "pass"
                    ? "PASS"
                    : statusRaw === "fail"
                      ? "FAIL"
                      : "NOT RUN",
                // Un PASS sin output igual deja evidencia (exit code): una
                // fila PASS con Evidence vacía no es evidencia decisiva.
                evidence:
                  snippet !== ""
                    ? snippet
                    : statusRaw === "pass" && exitRaw !== null
                      ? `exit ${exitRaw}`
                      : "",
              };
            })
          : [];
        // Solo hubo syntax checks (sin runner de tests en el repo target):
        // el reporte lo dice en vez de un "all green" que sugiere cobertura.
        const syntaxOnly =
          verifySteps !== null &&
          verifySteps.length > 0 &&
          verifySteps.every((s) => {
            const cmd = typeof s.command === "string" ? s.command.trim() : "";
            const name = typeof s.name === "string" ? s.name : "";
            return /^node --check\b/.test(cmd) || /^syntax\b/.test(name);
          });
        const canonical = buildReviewReport({
          pr: 0,
          base: typeof iso?.baseBranch === "string" && iso.baseBranch !== "" ? iso.baseBranch : "(unknown)",
          head: typeof iso?.branch === "string" && iso.branch !== "" ? iso.branch : "(unknown)",
          verdict: green ? "READY TO MERGE" : "NEEDS FIXES",
          summary:
            structuredSummary !== ""
              ? curateSummary(structuredSummary, 500) ||
                (green ? "Review OK" : "Review con hallazgos")
              : curateSummary(rawOutput) || (green ? "Review OK" : "Review con hallazgos"),
          findings: engineFindings,
          validation: engineValidation,
          ...(syntaxOnly ? { validationNote: "syntax only (no test runner in target repo)" } : {}),
          scopes: ["requirements", "tests", "security"],
          reviewer: "workflow-engine",
        });
        try {
          fs.writeFileSync(path.join(dir, "review-report.md"), canonical, "utf-8");
        } catch {
          // archivo best-effort: el evento durable de abajo es el registro
        }
        const meta = parseReviewReportMeta(canonical);
        try {
          workItemStore.appendEvent(itemId, "runner", `review report: ${meta?.verdict ?? "NEEDS FIXES"} (${meta?.open_findings ?? engineFindings.length} open)`, {
            reviewReport: {
              verdict: meta?.verdict ?? "NEEDS FIXES",
              openFindings: meta?.open_findings ?? 0,
              publication: "pending",
              report: canonical.slice(0, 20000),
            },
          });
        } catch {
          // evento best-effort: el archivo ya quedó
        }
      } catch {
        // reporte canónico best-effort: review.json sigue siendo la fuente
      }
    }
  } catch {
    // evidencia best-effort
  }
}

/**
 * Espeja los totals del run a `costSummary` del work item (CostBadge).
 * Solo cuando el run reportó un USD real: un resumen sin tarifa no inventa
 * 0.00 (misma doctrina que el cost tracker legacy).
 */
export function mirrorRunCost(itemId: string, run: WorkflowRun | null): void {
  try {
    const totals = run?.totals;
    if (!totals || typeof totals.costUsd !== "number") return;
    const tokens = totals.tokens ?? {};
    const summary: CostSummary = {
      llmCalls: 1,
      estimatedInputTokens: tokens.input ?? 0,
      estimatedOutputTokens: tokens.output ?? 0,
      estimatedUSD: totals.costUsd,
      basis: "estimated-chars/4",
      ratesRef: "workflow-run",
      actual: {
        inputTokens: tokens.input ?? 0,
        outputTokens: tokens.output ?? 0,
        reasoningTokens: 0,
        cacheReadTokens: tokens.cacheRead ?? 0,
        cacheWriteTokens: tokens.cacheWrite ?? 0,
        calls: 1,
        usd: totals.costUsd,
        usdSource: "server",
        basis: "opencode-session",
      },
    };
    workItemStore.applyExternalCost(itemId, summary);
  } catch {
    // evidencia de costo best-effort
  }
}

/** Limpia el gate del work item (del nodo dado, o cualquiera sin nodeId). */
function clearEngineGate(itemId: string, nodeId?: string | null): void {
  try {
    const gate = workItemStore.get(itemId)?.engineGate;
    if (!gate) return;
    if (typeof nodeId === "string" && nodeId !== "" && gate.nodeId !== nodeId) {
      return;
    }
    workItemStore.setEngineGate(itemId, null);
  } catch {
    // best-effort: el gate viejo se limpia en el próximo evento terminal
  }
}

/** Merge del avance del run en el work item (no-op sin run asociado). */
function patchEngineRun(itemId: string, patch: Partial<NonNullable<EngineRun>>): void {
  try {
    const cur = workItemStore.get(itemId)?.engineRun;
    if (!cur) return;
    workItemStore.setEngineRun(itemId, { ...cur, ...patch });
  } catch {
    // best-effort
  }
}

/** Estado por nodo que espeja el engine (mismo vocabulario que NodeStatus). */
type EngineNodeStateValue =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * Merge por nodo del `engineRun` (estado + sesión + agente). Punto único para
 * que Agent Progress (stepper) y Agent Sessions lean exactamente lo mismo.
 * Best-effort: nunca lanza.
 */
function patchEngineRunNode(
  itemId: string,
  nodeId: string | null | undefined,
  patch: { state?: EngineNodeStateValue; sessionId?: string; agent?: string },
): void {
  try {
    if (typeof nodeId !== "string" || nodeId === "") return;
    const cur = workItemStore.get(itemId)?.engineRun;
    if (!cur) return;
    const nodeStates = { ...(cur.nodeStates ?? {}) };
    if (patch.state) nodeStates[nodeId] = patch.state;
    const nodeSessions = { ...(cur.nodeSessions ?? {}) };
    if (typeof patch.sessionId === "string" && patch.sessionId !== "") {
      nodeSessions[nodeId] = patch.sessionId;
    }
    const nodeAgents = { ...(cur.nodeAgents ?? {}) };
    if (typeof patch.agent === "string" && patch.agent !== "") {
      nodeAgents[nodeId] = patch.agent.slice(0, 128);
    }
    workItemStore.setEngineRun(itemId, {
      ...cur,
      ...(Object.keys(nodeStates).length > 0 ? { nodeStates } : {}),
      ...(Object.keys(nodeSessions).length > 0 ? { nodeSessions } : {}),
      ...(Object.keys(nodeAgents).length > 0 ? { nodeAgents } : {}),
    });
  } catch {
    // best-effort: el espejo de eventos mantiene el avance
  }
}

/**
 * Reanuda un run del engine tolerando el `running` huérfano post-reinicio:
 * usa `resumeInterrupted` cuando el runtime lo expone (marca el estado
 * viejo y delega), cae a `resume`. Fakes de tests sin el método siguen
 * funcionando.
 */
async function resumeRuntimeRun(
  runtime: WorkflowRuntime,
  runId: string,
): Promise<WorkflowRun> {
  const maybe = runtime as unknown as {
    resumeInterrupted?: (id: string) => Promise<WorkflowRun>;
  };
  if (typeof maybe.resumeInterrupted === "function") {
    return maybe.resumeInterrupted(runId);
  }
  return runtime.resume(runId);
}

/**
 * Limpia el parqueo por reinicio: el timeline necesita un evento POSTERIOR
 * con `resumed` para que `needsResume` deje de devolver true (si no, H0
 * "Retomar" tapa el gate real del engine en el panel). Best-effort.
 */
function markResumed(itemId: string): void {
  try {
    workItemStore.appendEvent(itemId, "system", "engine: run reanudado", {
      [RESUMED_META_KEY]: true,
    });
  } catch {
    // best-effort: el parqueo se limpia en el próximo evento
  }
}

/**
 * Orden real de nodos del workflow (stepper del panel). Fakes de tests sin
 * el método devuelven [] — el panel cae al stepper legacy. Nunca lanza.
 */
function workflowNodeIds(runtime: WorkflowRuntime, workflow: string): string[] {
  try {
    const fn = (
      runtime as unknown as { getWorkflowNodeIds?: (name: string) => string[] }
    ).getWorkflowNodeIds;
    if (typeof fn === "function") {
      return fn.call(runtime, workflow).slice(0, 50);
    }
  } catch {
    // best-effort
  }
  return [];
}

/**
 * Backfill del avance del run en el item desde un run cargado: jobs viejos
 * (creados antes de la proyección) y resumes recuperan `engineRun` con
 * completados + nodo actual + orden real de nodos. Tolerante a runs
 * parciales; nunca lanza.
 */
function syncEngineRunFromRun(
  itemId: string,
  run: WorkflowRun | null,
  nodeIds?: string[],
): void {
  try {
    if (!run || typeof run.id !== "string" || run.id === "") return;
    const nodes = run.nodes ? Object.values(run.nodes) : [];
    const completed = nodes
      .filter((n) => n.status === "completed" || n.status === "skipped")
      .map((n) => n.id)
      .slice(0, 50);
    const nodeSessions: Record<string, string> = {};
    const nodeStates: Record<string, EngineNodeStateValue> = {};
    for (const n of nodes) {
      if (typeof n.id !== "string" || n.id === "") continue;
      if (
        typeof n.sessionId === "string" &&
        n.sessionId !== "" &&
        Object.keys(nodeSessions).length < 50
      ) {
        nodeSessions[n.id] = n.sessionId;
      }
      if (
        typeof n.status === "string" &&
        Object.keys(nodeStates).length < 50
      ) {
        nodeStates[n.id] = n.status;
      }
      if (
        Object.keys(nodeSessions).length >= 50 &&
        Object.keys(nodeStates).length >= 50
      ) {
        break;
      }
    }
    const running = nodes.find((n) => n.status === "running")?.id ?? null;
    const status: NonNullable<EngineRun>["status"] =
      run.status === "pending" ||
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled"
        ? run.status
        : "running";
    const prevAgents = workItemStore.get(itemId)?.engineRun?.nodeAgents;
    // Historial de rondas: `run.nodes` solo trae la última sesión por nodo;
    // el acumulado previo se preserva (el re-sync nunca borra rondas).
    const prevRounds = workItemStore.get(itemId)?.engineRun?.nodeSessionRounds;
    workItemStore.setEngineRun(itemId, {
      runId: run.id,
      workflow:
        typeof run.workflow === "string" && run.workflow !== ""
          ? run.workflow
          : "factory-default",
      status,
      currentNodeId: running,
      ...(completed.length > 0 ? { completedNodes: completed } : {}),
      ...(nodeIds && nodeIds.length > 0 ? { nodes: nodeIds } : {}),
      ...(Object.keys(nodeSessions).length > 0 ? { nodeSessions } : {}),
      ...(Object.keys(nodeStates).length > 0 ? { nodeStates } : {}),
      ...(prevAgents && Object.keys(prevAgents).length > 0
        ? { nodeAgents: prevAgents }
        : {}),
      ...(Array.isArray(prevRounds) && prevRounds.length > 0
        ? { nodeSessionRounds: prevRounds.slice(-NODE_SESSION_ROUNDS_MAX) }
        : {}),
      ...(typeof run.startedAt === "string" && run.startedAt !== ""
        ? { startedAt: run.startedAt }
        : {}),
    });
  } catch {
    // best-effort
  }
}

/**
 * Nodos con rol de sesión canónico (las 5 filas históricas de Agent
 * Sessions). Solo por id EXACTO: los workflows nuevos exponen sus sesiones
 * como filas dinámicas vía `engineRun.nodeSessions` — sin regex, sin mapeos
 * mágicos que se rompan al agregar un workflow.
 */
const CANONICAL_SESSION_NODE_IDS: ReadonlySet<string> = new Set([
  "triage",
  "spec",
  "implement",
  "review",
]);

/**
 * Tope del historial de sesiones por ronda (`engineRun.nodeSessionRounds`).
 */
const NODE_SESSION_ROUNDS_MAX = 50;

function cleanRoundIteration(value: unknown): number | null {
  try {
    if (typeof value !== "number" || !Number.isInteger(value)) return null;
    if (value < 1 || value > 100) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Suma pura de la sesión de una ronda al historial (`nodeSessionRounds`):
 * cada ejecución de un nodo con múltiples rondas (`loop` / `loop_group`)
 * abre sesión propia y el espejo `nodeSessions` solo guarda la última.
 * Dedupe por (nodo, sesión) — el attach al enviar y el mirror al completar
 * de la misma ronda comparten sessionId. Sin iteración, se deriva del
 * máximo previo + 1. Nunca lanza.
 */
function appendNodeSessionRound(
  rounds: NonNullable<NonNullable<EngineRun>["nodeSessionRounds"]>,
  nodeId: string,
  iteration: number | null,
  sessionId: string,
): NonNullable<NonNullable<EngineRun>["nodeSessionRounds"]> {
  try {
    const duplicate = rounds.some(
      (entry) => entry.nodeId === nodeId && entry.sessionId === sessionId,
    );
    if (duplicate) return rounds;
    let round = iteration;
    if (round === null) {
      let max = 0;
      for (const entry of rounds) {
        try {
          if (entry.nodeId === nodeId && entry.iteration > max) {
            max = entry.iteration;
          }
        } catch {
          // entrada rota: se ignora para el cómputo
        }
      }
      round = Math.min(max + 1, 100);
    }
    return [...rounds, { nodeId, iteration: round, sessionId }].slice(
      -NODE_SESSION_ROUNDS_MAX,
    );
  } catch {
    return rounds;
  }
}

/**
 * Espeja la sesión de un nodo al work item: rol canónico (compat histórica),
 * `engineRun.nodeSessions` y los campos top-level (View Agent). Se llama al
 * CREAR la sesión (envío del mensaje) y al completar/saltear. Best-effort.
 */
function mirrorNodeSession(
  itemId: string,
  nodeId: string,
  sessionId: string,
  iteration?: number | null,
): void {
  try {
    // F16: los subnodos de loop_group viajan namespaced (`build.implement`);
    // el rol canónico se decide por la hoja para no perder las filas
    // históricas ni el link superior.
    const leaf = nodeId.includes(".")
      ? nodeId.slice(nodeId.lastIndexOf(".") + 1)
      : nodeId;
    if (CANONICAL_SESSION_NODE_IDS.has(leaf)) {
      workItemStore.setAgentSession(itemId, leaf, sessionId);
    }
    const cur = workItemStore.get(itemId)?.engineRun;
    if (cur) {
      const round =
        typeof iteration === "number" ? iteration : null;
      workItemStore.setEngineRun(itemId, {
        ...cur,
        nodeSessions: { ...(cur.nodeSessions ?? {}), [nodeId]: sessionId },
        // Rondas: solo nodos dentro de loops traen `iteration`; cada
        // ejecución suma su sesión al historial (el espejo de arriba solo
        // guarda la última). Nodos de una sola ejecución no ensucian la lista.
        ...(round === null
          ? {}
          : {
              nodeSessionRounds: appendNodeSessionRound(
                [...(cur.nodeSessionRounds ?? [])],
                nodeId,
                round,
                sessionId,
              ),
            }),
      });
    }
    const dir = workItemStore.get(itemId)?.worktree;
    workItemStore.setSessionFields(itemId, {
      sessionId,
      dashboardUrl: buildDashboardUrl(
        sessionId,
        typeof dir === "string" && dir !== "" ? dir : undefined,
      ),
      ...(typeof dir === "string" && dir !== ""
        ? { directory: dir }
        : {}),
    });
  } catch {
    // best-effort: la UI cae al estado honesto "session never attached"
  }
}

/** Espeja un evento del run al work item (status + timeline + logs). */
export function handleRunEvent(
  event: WorkflowEvent,
  runtime?: WorkflowRuntime,
): void {
  const itemId = itemIdForRun(event.runId);
  if (!itemId) return;
  // F2: un run largo mantiene fresco el lease aunque el panel no pollée.
  try {
    maybeHeartbeatOwnership(buildOwnershipLockPath());
  } catch {
    // best-effort: el lease lo refresca también GET /factory/health
  }
  try {
    if (event.type === "node_started") {
      const item = workItemStore.get(itemId);
      if (item?.status === "Foreman" || item?.status === "Intake") {
        if (item.status === "Intake") {
          transitionSafe(itemId, "Foreman", "engine: intake dispatch", {
            workflowRunId: event.runId,
          });
        }
        transitionSafe(itemId, "Building", `engine: nodo ${event.nodeId ?? ""}`, {
          workflowRunId: event.runId,
          nodeId: event.nodeId,
        });
      } else if (item?.status === "Review" && !item.engineGate) {
        // Gate respondido: el run retomó trabajo de agente (implement,
        // verify…). Sin esto el item queda en "Review" mientras implementa.
        transitionSafe(itemId, "Building", `engine: nodo ${event.nodeId ?? ""}`, {
          workflowRunId: event.runId,
          nodeId: event.nodeId,
        });
      }
      patchEngineRun(itemId, {
        status: "running",
        currentNodeId: event.nodeId ?? null,
      });
      patchEngineRunNode(itemId, event.nodeId, { state: "running" });
      return;
    }
    if (event.type === "node_session_attached") {
      // La sesión ya existe: el mensaje está por enviarse. Agent Sessions
      // habilita la fila acá (no al completar) y guarda la identidad real.
      const data = event.data as
        | { sessionId?: unknown; agent?: unknown; iteration?: unknown }
        | undefined;
      const sessionId = typeof data?.sessionId === "string" ? data.sessionId : "";
      const agent = typeof data?.agent === "string" ? data.agent.trim() : "";
      const nodeId =
        typeof event.nodeId === "string" && event.nodeId !== "" ? event.nodeId : null;
      if (sessionId !== "" && nodeId !== null) {
        mirrorNodeSession(
          itemId,
          nodeId,
          sessionId,
          cleanRoundIteration(data?.iteration),
        );
        patchEngineRunNode(itemId, nodeId, {
          state: "running",
          sessionId,
          ...(agent !== "" ? { agent } : {}),
        });
      }
      return;
    }
    if (
      event.type === "node_completed" ||
      event.type === "node_failed" ||
      event.type === "node_skipped"
    ) {
      try {
        workItemStore.appendEvent(
          itemId,
          "runner",
          `engine ${event.type}: ${event.nodeId ?? ""}`,
          { workflowRunId: event.runId, nodeId: event.nodeId },
        );
      } catch {
        // best-effort
      }
      // El nodo del gate se completó (aprobado/rechazado): el gate ya no
      // espera y la fila deja de mostrar "waiting on you".
      if (event.type === "node_completed") {
        clearEngineGate(itemId, event.nodeId ?? null);
      }
      // Sesión del nodo → work item (View Agent + Agent Sessions). Al
      // completar/saltear se re-espeja la sesión persistida (resume incluido).
      const terminalState: EngineNodeStateValue =
        event.type === "node_completed"
          ? "completed"
          : event.type === "node_skipped"
            ? "skipped"
            : "failed";
      if (
        (event.type === "node_completed" || event.type === "node_skipped") &&
        runtime
      ) {
        try {
          const run = runtime.getRun(event.runId);
          const node = event.nodeId ? run?.nodes?.[event.nodeId] : undefined;
          // El evento `node_completed` viaja ANTES de `store.save(run)`: su
          // `data.sessionId` es la fuente fresca; el store cubre los
          // `node_skipped` del resume (sesión de una corrida previa).
          const dataSession = (event.data as { sessionId?: unknown } | undefined)
            ?.sessionId;
          const dataIteration = (event.data as { iteration?: unknown } | undefined)
            ?.iteration;
          const sessionId =
            typeof dataSession === "string" && dataSession !== ""
              ? dataSession
              : typeof node?.sessionId === "string" && node.sessionId !== ""
                ? node.sessionId
                : null;
          const nodeId =
            typeof event.nodeId === "string" && event.nodeId !== ""
              ? event.nodeId
              : null;
          if (sessionId !== null && nodeId !== null) {
            mirrorNodeSession(
              itemId,
              nodeId,
              sessionId,
              cleanRoundIteration(dataIteration),
            );
          }
        } catch {
          // best-effort: la UI cae al estado honesto "session never attached"
        }
      }
      patchEngineRunNode(itemId, event.nodeId, { state: terminalState });
      if (event.type === "node_completed" || event.type === "node_skipped") {
        try {
          const cur = workItemStore.get(itemId)?.engineRun;
          if (cur && typeof event.nodeId === "string" && event.nodeId !== "") {
            const done = new Set(cur.completedNodes ?? []);
            done.add(event.nodeId);
            workItemStore.setEngineRun(itemId, {
              ...cur,
              completedNodes: [...done].slice(0, 50),
              currentNodeId: null,
            });
          }
        } catch {
          // best-effort
        }
      } else {
        // Falló: no entra a completados; el stepper lo pinta failed.
        try {
          patchEngineRun(itemId, { currentNodeId: null });
        } catch {
          // best-effort
        }
      }
      return;
    }
    if (event.type === "run_completed") {
      // F16: el run puede "completar" con outcome failed (review green=false
      // tras agotar el loop de revise). En ese caso NO va a Complete: el job
      // queda en Review con los findings para decisión humana (aceptar igual
      // o descartar). Nunca PR ni auto-score en rojo.
      const resultData = event.data?.result as { outcome?: unknown } | undefined;
      const rejected = resultData?.outcome === "failed";
      const item = workItemStore.get(itemId);
      if (
        item &&
        item.status !== "Complete" &&
        item.status !== "Cancelled"
      ) {
        if (rejected) {
          transitionSafe(itemId, "Review", "engine: review no aprobó (green=false)", {
            workflowRunId: event.runId,
            result: event.data?.result,
          });
        } else {
          transitionSafe(itemId, "Complete", "engine: run completado", {
            workflowRunId: event.runId,
            result: event.data?.result,
          });
        }
      }
      const finishedRun = runtime?.getRun(event.runId) ?? null;
      clearEngineGate(itemId);
      try {
        const nodes = finishedRun?.nodes ? Object.values(finishedRun.nodes) : [];
        const completed = nodes
          .filter((n) => n.status === "completed" || n.status === "skipped")
          .map((n) => n.id)
          .slice(0, 50);
        patchEngineRun(itemId, {
          status: "completed",
          currentNodeId: null,
          ...(completed.length > 0 ? { completedNodes: completed } : {}),
        });
      } catch {
        // best-effort
      }
      mirrorRunEvidence(itemId, finishedRun);
      mirrorRunCost(itemId, finishedRun);
      if (rejected) {
        try {
          workItemStore.appendEvent(
            itemId,
            "system",
            "engine: review no aprobó — revisá los findings y aceptá igual o descartá",
            { workflowRunId: event.runId },
          );
        } catch {
          // best-effort
        }
        try {
          notify({
            kind: "ask_human",
            workItemId: itemId,
            title: "Review no aprobó — necesita tu decisión",
            body: "El loop de revisión terminó en rojo tras agotar las rondas. Revisá los findings: aceptá igual o descartá el trabajo.",
            dedupeKey: `review-rejected:${event.runId}`,
          });
        } catch {
          // best-effort: la campana también ve el estado por polling
        }
      } else {
        // PR de handoff (best-effort, idempotente, solo jobs aislados): el
        // orquestador es el dueño del PR, igual que en el accept legacy.
        void import("./isolation/gitHubPr")
          .then((module) => module.maybeOpenPrForCompletedJob(itemId))
          .catch(() => {});
        // Auto-score como en el pipeline legacy (best-effort, no bloquea nada).
        void import("../measure/scorerEngine")
          .then((module) => module.autoScoreCompletedJob(itemId))
          .catch(() => {});
      }
      return;
    }
    if (event.type === "run_failed" || event.type === "run_cancelled") {
      const reason = String(event.data?.error ?? event.type).slice(0, 220);
      transitionSafe(itemId, "Cancelled", `engine: ${reason}`, {
        workflowRunId: event.runId,
      });
      const failedRun = runtime?.getRun(event.runId) ?? null;
      clearEngineGate(itemId);
      patchEngineRun(itemId, {
        status: event.type === "run_failed" ? "failed" : "cancelled",
        currentNodeId: null,
      });
      mirrorRunEvidence(itemId, failedRun);
      mirrorRunCost(itemId, failedRun);
      if (event.type === "run_failed") {
        try {
          notify({
            kind: "daemon-error",
            workItemId: itemId,
            title: `Run falló: ${event.workflow}`,
            body: reason,
            dedupeKey: `run-failed:${event.runId}`,
          });
        } catch {
          // best-effort: la campana también ve el estado por polling
        }
      }
    }
  } catch {
    // el espejo es best-effort: jamás tumba el run
  }
}

/**
 * Nodo de aprobación del engine (`approve`, `gate`, `plan…`): semántica
 * approve/reject, NUNCA un ask-human de review. Compartido por la
 * clasificación del gate, el guard de Retry review (G1) y el revive (G2).
 */
function isApprovalGateNodeId(nodeId: unknown): boolean {
  try {
    if (typeof nodeId !== "string") return false;
    const id = nodeId.toLowerCase();
    return (
      id.includes("spec") ||
      id.includes("approve") ||
      id.includes("gate") ||
      id.includes("plan")
    );
  } catch {
    return false;
  }
}

/**
 * G2: un run vivo con el job terminal (reject + resume posterior, o un gate
 * re-levantado sobre un job cancelado) deja el status desincronizado y la
 * fila desaparece. Revive SOLO desde Cancelled (Complete no se reabre) a
 * Building; el flujo normal sigue desde ahí. Best-effort, nunca lanza.
 */
function reviveItemForActiveRun(itemId: string): void {
  try {
    const item = workItemStore.get(itemId);
    if (!item) return;
    if (item.status !== "Cancelled") return;
    transitionSafe(
      itemId,
      "Building",
      "engine: run activo (status re-sincronizado)",
    );
  } catch {
    // best-effort: si la transición no aplica, la fila igual la salva G3
  }
}

/** Un gate humano pendiente se refleja como Review para el panel. */
export function handleGate(request: ApprovalRequest): void {
  const itemId = itemIdForRun(request.runId);
  if (!itemId) return;
  try {
    const gateKind: "spec-approval" | "ask-human" =
      isApprovalGateNodeId(request.nodeId) ? "spec-approval" : "ask-human";
    // Gate de primera clase para el panel (proyectado por jobView al poll
    // 2.5s): sin esto la fila queda en "implementing" sin CTA de aprobar.
    try {
      workItemStore.setEngineGate(itemId, {
        nodeId: request.nodeId,
        kind: gateKind,
        message: request.message.slice(0, 2000),
        runId: request.runId,
        ...(typeof request.attempt === "number" ? { attempt: request.attempt } : {}),
      });
    } catch {
      // best-effort: el timeline/notify de abajo siguen siendo la evidencia
    }
    const item = workItemStore.get(itemId);
    if (!item) return;
    // G2: si el job quedó terminal pero el run sigue vivo y levanta un gate,
    // revivir el status (el flujo normal de abajo lo pasa a Review).
    reviveItemForActiveRun(itemId);
    const current = workItemStore.get(itemId);
    if (!current) return;
    if (
      current.status === "Building" ||
      current.status === "Foreman" ||
      current.status === "Intake"
    ) {
      if (current.status === "Intake") {
        transitionSafe(itemId, "Foreman", "engine: intake dispatch", {
          workflowRunId: request.runId,
        });
      }
      transitionSafe(itemId, "Review", `engine: gate pendiente (${request.nodeId})`, {
        workflowRunId: request.runId,
        gate: request.nodeId,
      });
    }
    try {
      workItemStore.appendEvent(
        itemId,
        "system",
        `engine: gate ${request.nodeId} — ${request.message}`.slice(0, 500),
        { workflowRunId: request.runId, gate: request.nodeId },
      );
    } catch {
      // best-effort
    }
    try {
      notify({
        kind: gateKind === "spec-approval" ? "spec-approval" : "ask_human",
        workItemId: itemId,
        title: `Gate pendiente: ${request.nodeId}`,
        body: request.message.slice(0, 400),
        dedupeKey: `gate:${request.runId}:${request.nodeId}:${request.attempt}`,
      });
    } catch {
      // best-effort: la campana también ve el estado por polling
    }
    // Evidencia del gate: review.json ask_human para que ReviewPanel muestre
    // el mensaje real en vez del fallback.
    try {
      const dir = workItemStore.get(itemId)?.dir;
      if (dir) {
        writeReviewJsonAtomic(dir, {
          workItemId: itemId,
          reviewerModel: { providerID: "termcanvas", modelID: "workflow-gate" },
          verdict: "ask_human",
          confidence: 1,
          summary: `Gate ${request.nodeId}: ${request.message}`.slice(0, 2000),
          findings: [],
          reviewAttempt: request.attempt,
          reviewedAt: new Date().toISOString(),
        });
      }
    } catch {
      // best-effort: el panel cae a su fallback
    }
  } catch {
    // best-effort
  }
}

/**
 * Dato MÍNIMO de issue para los mensajes: `#93 — <url>` (o `#93 (repo)`).
 * Vacío cuando el job no tiene issueRef — el def aplica su default.
 * Nunca lanza.
 */
function issueInputText(itemId: string): string {
  try {
    const ref = getIssueRef(itemId);
    if (!ref) return "";
    const head = `#${ref.issueNumber}`;
    const repo =
      typeof ref.repo === "string" && ref.repo.trim() !== "" ? ref.repo.trim() : "";
    const url =
      typeof ref.url === "string" && ref.url.trim() !== "" ? ref.url.trim() : "";
    if (url !== "") return `${head} — ${url}`;
    if (repo !== "") return `${head} (${repo})`;
    return head;
  } catch {
    return "";
  }
}

/**
 * Cuerpo original del issue extraído del prompt del job (`## ORIGINAL BODY`,
 * ver `buildFactoryResolvePrompt` en `factoryIssueJobs.ts`). Es el ground
 * truth que viaja pegado en cada mensaje para que ningún agente tenga que
 * fetchear la URL del issue (404 en repos privados). Cap 2000 (espejo de
 * `PROMPT_BODY_MAX`). Vacío cuando no hay sección legible. Nunca lanza.
 */
export function issueBodyInputText(prompt: string): string {
  try {
    if (typeof prompt !== "string" || prompt.trim() === "") return "";
    const start = prompt.search(/^##\s+ORIGINAL BODY\s*$/m);
    if (start < 0) return "";
    const after = prompt.slice(start).split("\n").slice(1).join("\n");
    const end = after.search(/^##\s+\S/m);
    const body = (end < 0 ? after : after.slice(0, end)).trim();
    if (body === "") return "";
    return body.slice(0, 2000);
  } catch {
    return "";
  }
}

/**
 * Inputs del run oficial para un work item. Contrato compartido con la
 * definición bundled `factory-default`: cada key que se envíe acá DEBE estar
 * declarada en `inputs:` del YAML (el engine rechaza inputs desconocidos).
 * Regresión cubierta en `tests/factory-engine-bridge.test.ts`.
 */
export function factoryDefaultRunInputs(
  prompt: string,
  itemId: string,
  issueText = "",
  issueBody = "",
): Record<string, unknown> {
  return {
    request: prompt,
    workItemId: itemId,
    ...(issueText !== "" ? { issue_ref: issueText } : {}),
    ...(issueBody !== "" ? { issue_body: issueBody } : {}),
  };
}

/**
 * Inputs de un run para un workflow arbitrario: cubre los keys declarados
 * que el panel puede llenar (`request`/`issue`/`prompt` ← pedido;
 * `workItemId`/`itemId`/`jobId` ← job id; `issue_ref` ← `#N — url`;
 * `issue_body` ← cuerpo original extraído del prompt),
 * usa defaults del def y omite los opcionales sin default. Null cuando un
 * `required` queda sin valor (el caller cae a factory-default) — el engine
 * rechaza inputs faltantes. Nunca lanza.
 */
export function runInputsForWorkflowDef(
  def: WorkflowDefinition,
  prompt: string,
  itemId: string,
  issueText = "",
  issueBody = "",
): Record<string, unknown> | null {
  try {
    const out: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(def.inputs)) {
      if (/^(request|issue|prompt)$/i.test(key)) {
        out[key] = prompt;
        continue;
      }
      if (/workitemid|itemid|jobid/i.test(key)) {
        out[key] = itemId;
        continue;
      }
      if (/^issue_?ref$/i.test(key)) {
        if (issueText !== "") {
          out[key] = issueText;
          continue;
        }
        // sin issue: cae al default del def (o se omite si es opcional)
      }
      if (/^issue_?body$/i.test(key)) {
        if (issueBody !== "") {
          out[key] = issueBody;
          continue;
        }
        // sin cuerpo: cae al default del def (o se omite si es opcional)
      }
      if (spec.default !== undefined) {
        out[key] = spec.default;
        continue;
      }
      if (spec.required === true) return null;
    }
    return out;
  } catch {
    return null;
  }
}

function buildInputsForWorkflow(
  workflow: string,
  prompt: string,
  itemId: string,
  repoRoot: string,
  issueText = "",
  issueBody = "",
): Record<string, unknown> | null {
  try {
    const loaded = loadWorkflow(workflow, { repoRoot });
    return runInputsForWorkflowDef(loaded.def, prompt, itemId, issueText, issueBody);
  } catch {
    return null;
  }
}

function runtimeRepoRoot(runtime: WorkflowRuntime): string {
  try {
    const root = (runtime as unknown as { repoRoot?: unknown }).repoRoot;
    return typeof root === "string" ? root : "";
  } catch {
    return "";
  }
}

/** Seam de tests: reemplaza el router LLM por una decisión fija. */
type WorkflowRouterFn = (input: {
  itemId: string;
  prompt: string;
  worktree: string;
  repoRoot: string;
}) => Promise<WorkflowRouteDecision>;

let workflowRouterForTests: WorkflowRouterFn | null = null;

export function setWorkflowRouterForTests(fn: WorkflowRouterFn | null): void {
  workflowRouterForTests = fn;
}

/** Lanza (o reanuda) el workflow oficial para un work item del panel. */
export async function runWorkflowJob(
  itemId: string,
  runtime: WorkflowRuntime,
): Promise<void> {
  try {
    let item = workItemStore.get(itemId);
    if (!item) return;
    const existingRunId = runIdForItem(itemId);
    if (existingRunId) {
      const run = runtime.getRun(existingRunId);
      syncEngineRunFromRun(
        itemId,
        run,
        run ? workflowNodeIds(runtime, run.workflow) : [],
      );
      if (run && (run.status === "failed" || run.status === "cancelled")) {
        await resumeRuntimeRun(runtime, existingRunId);
        // G2: un job terminal (Cancelled) con run reanudado vuelve a Building.
        reviveItemForActiveRun(itemId);
        patchEngineRun(itemId, { status: "running", currentNodeId: null });
        clearEngineGate(itemId);
        markResumed(itemId);
      }
      return;
    }
    if (item.status === "Intake") {
      item = workItemStore.transition(itemId, "Foreman", "system", "engine: intake dispatch", {});
    }
    // Router (F7): el LLM elige el workflow según el pedido; ante cualquier
    // problema cae a factory-default. Nunca bloquea el Resolve.
    const repoRoot = runtimeRepoRoot(runtime);
    let route: WorkflowRouteDecision = {
      workflow: "factory-default",
      reason: "router no disponible",
      routedBy: "fallback",
    };
    try {
      route = workflowRouterForTests
        ? await workflowRouterForTests({
            itemId,
            prompt: item.prompt,
            worktree: item.worktree,
            repoRoot,
          })
        : await selectWorkflowForItem({
            itemId,
            prompt: item.prompt,
            worktree: item.worktree,
            repoRoot,
            issueText: issueInputText(itemId),
          });
    } catch {
      // route queda en fallback
    }
    let workflowName = route.workflow;
    const issueBody = issueBodyInputText(item.prompt);
    let inputs = buildInputsForWorkflow(
      workflowName,
      item.prompt,
      itemId,
      repoRoot,
      issueInputText(itemId),
      issueBody,
    );
    if (inputs === null) {
      workflowName = "factory-default";
      inputs =
        buildInputsForWorkflow(
          workflowName,
          item.prompt,
          itemId,
          repoRoot,
          issueInputText(itemId),
          issueBody,
        ) ??
        factoryDefaultRunInputs(item.prompt, itemId, issueInputText(itemId), issueBody);
    }
    // Identidad foreman (F10): la sesión del router se attachea al rol
    // `foreman` (fila FOREMAN en Agent Sessions, "View FOREMAN agent session"
    // con la conversación completa de la decisión).
    if (typeof route.sessionId === "string" && route.sessionId !== "") {
      try {
        workItemStore.setAgentSession(itemId, "foreman", route.sessionId);
      } catch {
        // best-effort: la decisión igual queda en el timeline
      }
    }
    try {
      workItemStore.appendEvent(
        itemId,
        "system",
        `engine: workflow elegido ${workflowName} — ${route.reason}`.slice(0, 300),
        {
          workflow: workflowName,
          reason: route.reason,
          routedBy: route.routedBy,
          ...(typeof route.sessionId === "string" && route.sessionId !== ""
            ? { sessionId: route.sessionId }
            : {}),
          // Chip "Routing decisions" del detalle: FOREMAN → <workflow> + razón.
          foremanDecision: {
            decision: workflowName,
            reason: route.reason,
          },
        },
      );
    } catch {
      // best-effort
    }
    // El run corre en el jail de aislamiento del job (issue-N), no en el
    // anchor del canvas (item.worktree): sin esto el implementer editaba el
    // checkout principal (bug run #125: cwd = repo main, worktree ignorado).
    const run = await runtime.start(workflowName, {
      inputs,
      args: item.prompt,
      cwd: resolveSessionWorktree(item),
      isolation: "inherit",
    });
    registerLink(itemId, run.id);
    const nodeIds = workflowNodeIds(runtime, workflowName);
    try {
      workItemStore.setEngineRun(itemId, {
        runId: run.id,
        workflow: workflowName,
        status: "running",
        currentNodeId: null,
        completedNodes: [],
        ...(nodeIds.length > 0 ? { nodes: nodeIds } : {}),
        ...(typeof run.startedAt === "string" ? { startedAt: run.startedAt } : {}),
      });
    } catch {
      // best-effort: el espejo de eventos también mantiene el avance
    }
    try {
      workItemStore.appendEvent(itemId, "system", `engine: run ${run.id}`, {
        workflowRunId: run.id,
      });
    } catch {
      // best-effort
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      workItemStore.appendEvent(itemId, "system", `engine: fallo al lanzar — ${message}`.slice(0, 300));
      const item = workItemStore.get(itemId);
      if (item && item.status !== "Cancelled" && item.status !== "Complete") {
        transitionSafe(itemId, "Cancelled", `engine: no se pudo lanzar — ${message}`.slice(0, 300));
      }
    } catch {
      // best-effort
    }
    try {
      workItemStore.setEngineRun(itemId, null);
      workItemStore.setEngineGate(itemId, null);
    } catch {
      // best-effort
    }
    try {
      notify({
        kind: "daemon-error",
        workItemId: itemId,
        title: `Run no pudo arrancar: factory-default`,
        body: message.slice(0, 500),
        dedupeKey: `launch-failed:${itemId}`,
      });
    } catch {
      // best-effort: la campana también ve el estado por polling
    }
  }
}

/** Edad máxima por defecto de una interrupción para auto-reanudarla (24h). */
function autoResumeMaxAgeMs(): number {
  const raw = Number(process.env.TERMCANVAS_FACTORY_AUTORESUME_MAX_AGE_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

/** Cap de resumes automáticos por boot (los más nuevos primero). Default 5. */
function autoResumeMaxPerBoot(): number {
  const raw = Number(process.env.TERMCANVAS_FACTORY_AUTORESUME_MAX ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}

/**
 * Tras esta cantidad de auto-resumes sin llegar a terminal, el job deja de
 * reanudarse solo: queda parqueado para "Retomar" manual. Evita el ciclo
 * infinito de un job trabado (gate humano, worktree roto) que revive en
 * cada reinicio del daemon y vuelve a spawnear procesos.
 */
const AUTO_RESUME_MAX_ATTEMPTS = 3;

interface ResumeMarkerView {
  at?: unknown;
  meta?: Record<string, unknown> | undefined;
}

/** Cantidad de marcadores `resumed` en el timeline. Puro, nunca lanza. */
function countAutoResumes(timeline: readonly ResumeMarkerView[] | null | undefined): number {
  try {
    if (!Array.isArray(timeline)) return 0;
    let count = 0;
    for (const entry of timeline) {
      const meta = entry?.meta;
      if (
        meta &&
        typeof meta === "object" &&
        (meta as Record<string, unknown>)[RESUMED_META_KEY] === true
      ) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Timestamp (ms) de la interrupción más nueva: `meta.interruptedAt` o, para
 * marcadores viejos sin ese dato, el `at` del evento previo al marcador.
 * `null` si no hay marcador o no se puede derivar (se trata como fresca,
 * comportamiento previo). Puro, nunca lanza.
 */
function interruptionMs(timeline: readonly ResumeMarkerView[] | null | undefined): number | null {
  try {
    if (!Array.isArray(timeline)) return null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const meta = timeline[i]?.meta;
      if (!meta || typeof meta !== "object") continue;
      if ((meta as Record<string, unknown>)[BOOT_INTERRUPTED_META_KEY] !== true) continue;
      const raw = (meta as Record<string, unknown>)[BOOT_INTERRUPTED_AT_META_KEY];
      const fromMeta = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
      if (Number.isFinite(fromMeta)) return fromMeta;
      const prevAt = timeline[i - 1]?.at;
      const fromPrev = typeof prevAt === "string" ? Date.parse(prevAt) : Number.NaN;
      return Number.isFinite(fromPrev) ? fromPrev : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Auto-resume de boot: los runs del engine interrumpidos por un reinicio
 * quedan parkeados (`parkInterruptedJobs`) y esperarían un click humano.
 * Este relanzamiento best-effort reanuda SOLO jobs parkeados con run
 * linkeado no terminal, vía `resumeInterrupted` (tolera el `running`
 * huérfano), con stagger para no competir con el boot.
 *
 * Guardas anti-zombie (para que "idle" sea idle de verdad):
 * - Solo interrupciones dentro de `autoResumeMaxAgeMs()` (env
 *   TERMCANVAS_FACTORY_AUTORESUME_MAX_AGE_MS; default 24h). Más viejas
 *   quedan para "Retomar" manual.
 * - Máximo `AUTO_RESUME_MAX_ATTEMPTS` auto-resumes por job; después queda
 *   parqueado (evita que un job trabado reviva en cada reinicio).
 * - Máximo `autoResumeMaxPerBoot()` resumes por boot (env
 *   TERMCANVAS_FACTORY_AUTORESUME_MAX; default 5), los más nuevos primero.
 *
 * Kill switch: TERMCANVAS_FACTORY_NO_AUTORESUME=1. Nunca lanza.
 */
export function autoResumeParkedEngineJobs(delayMs = 3000): void {
  try {
    if ((process.env.TERMCANVAS_FACTORY_NO_AUTORESUME ?? "") === "1") return;
    if (!runtimeProvider) return;
    const timer = setTimeout(() => {
      try {
        const provider = runtimeProvider;
        if (!provider) return;
        const runtime = provider();
        const maxAgeMs = autoResumeMaxAgeMs();
        const candidates: Array<{ itemId: string; runId: string; interruptedMs: number }> = [];
        for (const item of workItemStore.list()) {
          try {
            if (item.status === "Complete" || item.status === "Cancelled") continue;
            const runId = runIdForItem(item.id);
            if (!runId) continue;
            const run = runtime.getRun(runId);
            if (!run) continue;
            // Backfill del avance para jobs creados antes de la proyección.
            if (!item.engineRun) {
              syncEngineRunFromRun(
                item.id,
                run,
                workflowNodeIds(runtime, run.workflow),
              );
            }
            if (!needsResume(item.status, item.timeline)) continue;
            if (run.status === "completed") continue;
            if (runtime.isActive(runId)) continue;
            const interrupted = interruptionMs(item.timeline);
            if (
              interrupted !== null &&
              Date.now() - interrupted > maxAgeMs
            ) {
              continue;
            }
            if (countAutoResumes(item.timeline) >= AUTO_RESUME_MAX_ATTEMPTS) continue;
            candidates.push({
              itemId: item.id,
              runId,
              interruptedMs: interrupted ?? Date.now(),
            });
          } catch {
            // por job: un run roto no frena a los demás
          }
        }
        candidates.sort((a, b) => b.interruptedMs - a.interruptedMs);
        let resumed = 0;
        for (const candidate of candidates.slice(0, autoResumeMaxPerBoot())) {
          try {
            const item = workItemStore.get(candidate.itemId);
            const run = runtime.getRun(candidate.runId);
            if (!item || !run) continue;
            syncEngineRunFromRun(
              item.id,
              run,
              workflowNodeIds(runtime, run.workflow),
            );
            clearEngineGate(item.id);
            patchEngineRun(item.id, { status: "running", currentNodeId: null });
            void resumeRuntimeRun(runtime, candidate.runId).catch(() => {});
            markResumed(item.id);
            resumed += 1;
          } catch {
            // best-effort por job
          }
        }
        if (resumed > 0) {
          try {
          } catch {
            // log best-effort
          }
        }
      } catch {
        // nunca rompe el boot
      }
    }, Math.max(0, delayMs));
    // En procesos cortos (tests) el timer no debe mantener el event loop vivo.
    try {
      (timer as unknown as { unref?: () => void }).unref?.();
    } catch {
      // noop
    }
  } catch {
    // nunca lanza hacia el boot
  }
}

function readBodyText(req: import("node:http").IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = req as unknown as {
      on: (event: string, listener: (...args: never[]) => void) => void;
      destroy: () => void;
    };
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        stream.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (raw.trim().length === 0) {
          resolve(undefined);
          return;
        }
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const candidate =
          parsed.text ?? parsed.comment ?? parsed.reason ?? parsed.feedback ?? parsed.answers;
        resolve(typeof candidate === "string" ? candidate : undefined);
      } catch {
        resolve(undefined);
      }
    });
    stream.on("error", () => resolve(undefined));
  });
}

export interface WorkflowActionResult {
  handled: boolean;
  status?: number;
  body?: unknown;
}

/**
 * Traduce una acción del panel sobre un job espejado a una operación del
 * runtime. Devuelve `handled:false` cuando el job es legacy (sigue su camino).
 */
export async function tryHandleWorkflowAction(input: {
  domain: string;
  itemId: string;
  runtime: WorkflowRuntime;
  req: import("node:http").IncomingMessage;
}): Promise<WorkflowActionResult> {
  if (!WORKFLOW_ACTION_DOMAINS.has(input.domain)) return { handled: false };
  const runId = runIdForItem(input.itemId);
  if (!runId) {
    // Incidente #125: un job parkeado ANTES de crear su run (el worker murió
    // en Foreman/routing) no tiene nada que reanudar. Retomar lo RE-DESPACHA
    // (router + start) en vez de caer al 410 legacy. Solo con la marca de
    // parqueo viva: así nunca re-lanza un job sano sin link por carrera.
    if (input.domain === "job-resume") {
      const item = workItemStore.get(input.itemId);
      if (item && needsResume(item.status, item.timeline)) {
        // El router LLM puede tardar más que el timeout del cliente HTTP: el
        // re-despacho corre en BACKGROUND (mismo patrón `setImmediate` que el
        // create) y el panel recibe 200 al instante. La marca de parqueo se
        // limpia ya para que el auto-resume del boot no lo duplique; si el
        // lanzamiento falla, `runWorkflowJob` deja el job Cancelled +
        // notificación (nunca lanza).
        markResumed(input.itemId);
        setImmediate(() => {
          void runWorkflowJob(input.itemId, input.runtime).catch(() => {});
        });
        return {
          handled: true,
          status: 200,
          body: { ok: true, redispatched: true },
        };
      }
    }
    return { handled: false };
  }
  const { runtime } = input;
  try {
    if (
      input.domain === "job-review-accept" ||
      input.domain === "job-spec-approve" ||
      input.domain === "job-triage-respond"
    ) {
      const text = await readBodyText(input.req);
      if (!runtime.getPending(runId)) {
        if (input.domain === "job-review-accept") {
          // F16: accept sin gate (run terminal con review rojo). Fall-through
          // a la ruta legacy: gateAcceptOnBranchDiff + Complete + PR de handoff.
          return { handled: false };
        }
        return {
          handled: true,
          status: 409,
          body: { error: `run ${runId}: no hay gate pendiente para resolver` },
        };
      }
      runtime.respond(runId, { decision: "approve", text });
      // G2: aprobar un gate sobre un job cancelado revive el status; el run
      // sigue a implement y la fila vuelve a In Progress.
      reviveItemForActiveRun(input.itemId);
      clearEngineGate(input.itemId);
      return { handled: true, status: 200, body: { ok: true, workflowRunId: runId } };
    }
    if (input.domain === "job-spec-reject") {
      const text = await readBodyText(input.req);
      if (!runtime.getPending(runId)) {
        return {
          handled: true,
          status: 409,
          body: { error: `run ${runId}: no hay gate pendiente para rechazar` },
        };
      }
      runtime.respond(runId, { decision: "reject", text });
      clearEngineGate(input.itemId);
      return { handled: true, status: 200, body: { ok: true, workflowRunId: runId } };
    }
    if (input.domain === "job-review-retry") {
      const text = await readBodyText(input.req);
      const pending = runtime.getPending(runId);
      if (pending) {
        // G1: "Retry review" NUNCA rechaza un gate de aprobación — hacerlo
        // cancela el run (reject sin on_reject). 409 honesto: el gate se
        // resuelve con Aprobar/Rechazar.
        if (isApprovalGateNodeId(pending.nodeId)) {
          return {
            handled: true,
            status: 409,
            body: {
              error:
                "el gate pendiente es de aprobación: usá Aprobar o Rechazar (Retry review no aplica)",
            },
          };
        }
        runtime.respond(runId, { decision: "reject", text });
        clearEngineGate(input.itemId);
        return { handled: true, status: 200, body: { ok: true, workflowRunId: runId } };
      }
      // Sin gate pendiente: limpiar el gate VIEJO antes de reanudar. El
      // resume re-levanta el gate vigente de forma asíncrona; limpiarlo
      // después borraba el gate recién levantado (carrera real: #125 quedó
      // con el run vivo en el gate y sin CTA).
      clearEngineGate(input.itemId);
      await resumeRuntimeRun(runtime, runId);
      markResumed(input.itemId);
      reviveItemForActiveRun(input.itemId);
      return { handled: true, status: 200, body: { ok: true, workflowRunId: runId } };
    }
    if (
      input.domain === "job-review-retry-review" ||
      input.domain === "job-review-rerun" ||
      input.domain === "job-resume"
    ) {
      // Mismo orden que arriba: el gate viejo se limpia ANTES del resume
      // para no pisar el gate que el run re-leventa.
      clearEngineGate(input.itemId);
      const resumed = await resumeRuntimeRun(runtime, runId);
      reviveItemForActiveRun(input.itemId);
      syncEngineRunFromRun(
        input.itemId,
        resumed,
        resumed ? workflowNodeIds(runtime, resumed.workflow) : [],
      );
      patchEngineRun(input.itemId, { status: "running", currentNodeId: null });
      markResumed(input.itemId);
      return { handled: true, status: 200, body: { ok: true, run: resumed } };
    }
    if (input.domain === "job-cancel" || input.domain === "job-discard") {
      try {
        runtime.cancel(runId);
      } catch {
        // ya terminal: cancelar es idempotente para el panel
      }
      clearEngineGate(input.itemId);
      patchEngineRun(input.itemId, { status: "cancelled", currentNodeId: null });
      if (input.domain === "job-discard") {
        // Discard humano = teardown completo SIEMPRE (mismo contrato que la
        // ruta legacy): cierra PR sin mergear, borra rama/worktree/archivos
        // y el job dir. Sin esto el job queda en el store (job.json en
        // disco), resurrecta en el próximo restore y vuelve a ser candidato
        // de auto-resume ("descarto y vuelve").
        // El run acaba de cancelarse: el lock de worker puede quedar unos ms
        // (o zombie de un desync Cancelled+run vivo). Es un teardown humano
        // y total — se liberan antes para que el guard "en curso" no frene.
        try {
          workItemStore.releaseBuildingLock(input.itemId);
        } catch {
          // best-effort
        }
        try {
          workItemStore.releaseReviewLock(input.itemId);
        } catch {
          // best-effort
        }
        const { requestJobDiscard } = await import("./jobs/jobDiscard");
        const out = await requestJobDiscard(input.itemId);
        if (!out.ok) {
          return { handled: true, status: out.code, body: { error: out.error } };
        }
        // "Borra TODO": el run espejado también (mapa + dir) — un run
        // "running" huérfano era lo que resucitaba jobs cancelados.
        discardRunArtifacts(input.itemId, runId);
        return {
          handled: true,
          status: 200,
          body: {
            ok: true,
            workflowRunId: runId,
            state: out.state,
            status: out.status,
            cleaned: out.cleaned,
          },
        };
      }
      return { handled: true, status: 200, body: { ok: true, workflowRunId: runId } };
    }
    return { handled: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { handled: true, status: 409, body: { error: message.slice(0, 300) } };
  }
}
