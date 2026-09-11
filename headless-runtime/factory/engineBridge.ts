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
import { defaultRunsDir } from "../workflows/artifacts";
import { notify } from "../notify/notifications";
import type { WorkflowRuntime } from "../workflows/runtime";
import type { WorkflowEvent } from "../workflows/types";
import type { ApprovalRequest } from "../workflows/executor";
import type { WorkItemStatus } from "../../shared/types/workItem";

export function isWorkflowEngineEnabled(): boolean {
  try {
    const raw = (process.env.TERMCANVAS_FACTORY_ENGINE ?? "").trim().toLowerCase();
    if (raw === "legacy") return false;
    return true;
  } catch {
    return true;
  }
}

/** El daemon registra acá su runtime para que automatizaciones puedan disparar jobs. */
let runtimeProvider: (() => WorkflowRuntime) | null = null;

export function setWorkflowRuntimeProvider(provider: () => WorkflowRuntime): void {
  runtimeProvider = provider;
}

/**
 * Dispara el workflow oficial para un job recién creado (automations,
 * benchmarks u otro intake interno). No-op si el engine está en legacy o el
 * runtime aún no fue registrado.
 */
export function dispatchCreatedJob(itemId: string): void {
  if (!isWorkflowEngineEnabled()) return;
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

/** Espeja un evento del run al work item (status + timeline + logs). */
export function handleRunEvent(event: WorkflowEvent): void {
  const itemId = itemIdForRun(event.runId);
  if (!itemId) return;
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
      return;
    }
    if (event.type === "run_completed") {
      const item = workItemStore.get(itemId);
      if (
        item &&
        item.status !== "Complete" &&
        item.status !== "Cancelled"
      ) {
        transitionSafe(itemId, "Complete", "engine: run completado", {
          workflowRunId: event.runId,
          result: event.data?.result,
        });
      }
      return;
    }
    if (event.type === "run_failed" || event.type === "run_cancelled") {
      const reason = String(event.data?.error ?? event.type).slice(0, 220);
      transitionSafe(itemId, "Cancelled", `engine: ${reason}`, {
        workflowRunId: event.runId,
      });
    }
  } catch {
    // el espejo es best-effort: jamás tumba el run
  }
}

/** Un gate humano pendiente se refleja como Review para el panel. */
export function handleGate(request: ApprovalRequest): void {
  const itemId = itemIdForRun(request.runId);
  if (!itemId) return;
  try {
    const item = workItemStore.get(itemId);
    if (!item) return;
    if (item.status === "Building" || item.status === "Foreman" || item.status === "Intake") {
      if (item.status === "Intake") {
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
        kind:
          request.nodeId.includes("spec") || request.nodeId.includes("approve")
            ? "spec-approval"
            : "ask_human",
        workItemId: itemId,
        title: `Gate pendiente: ${request.nodeId}`,
        body: request.message.slice(0, 400),
        dedupeKey: `gate:${request.runId}:${request.nodeId}:${request.attempt}`,
      });
    } catch {
      // best-effort: la campana también ve el estado por polling
    }
  } catch {
    // best-effort
  }
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
      if (run && (run.status === "failed" || run.status === "cancelled")) {
        await runtime.resume(existingRunId);
      }
      return;
    }
    if (item.status === "Intake") {
      item = workItemStore.transition(itemId, "Foreman", "system", "engine: intake dispatch", {});
    }
    const run = await runtime.start("factory-default", {
      inputs: {
        request: item.prompt,
        workItemId: itemId,
      },
      args: item.prompt,
      cwd: item.worktree,
      isolation: "inherit",
    });
    registerLink(itemId, run.id);
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
  if (!isWorkflowEngineEnabled()) return { handled: false };
  const runId = runIdForItem(input.itemId);
  if (!runId) return { handled: false };
  const { runtime } = input;
  try {
    if (
      input.domain === "job-review-accept" ||
      input.domain === "job-spec-approve" ||
      input.domain === "job-triage-respond"
    ) {
      const text = await readBodyText(input.req);
      if (!runtime.getPending(runId)) {
        return {
          handled: true,
          status: 409,
          body: { error: `run ${runId}: no hay gate pendiente para resolver` },
        };
      }
      runtime.respond(runId, { decision: "approve", text });
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
      return { handled: true, status: 200, body: { ok: true, workflowRunId: runId } };
    }
    if (input.domain === "job-review-retry") {
      const text = await readBodyText(input.req);
      if (runtime.getPending(runId)) {
        runtime.respond(runId, { decision: "reject", text });
      } else {
        await runtime.resume(runId);
      }
      return { handled: true, status: 200, body: { ok: true, workflowRunId: runId } };
    }
    if (
      input.domain === "job-review-retry-review" ||
      input.domain === "job-review-rerun" ||
      input.domain === "job-resume"
    ) {
      const resumed = await runtime.resume(runId);
      return { handled: true, status: 200, body: { ok: true, run: resumed } };
    }
    if (input.domain === "job-cancel" || input.domain === "job-discard") {
      try {
        runtime.cancel(runId);
      } catch {
        // ya terminal: cancelar es idempotente para el panel
      }
      return { handled: true, status: 200, body: { ok: true, workflowRunId: runId } };
    }
    return { handled: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { handled: true, status: 409, body: { error: message.slice(0, 300) } };
  }
}
