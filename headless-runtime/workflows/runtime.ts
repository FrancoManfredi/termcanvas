/**
 * WorkflowRuntime — runs en background con gates, esperas por evento y cancelación.
 *
 * Los runs largos no deben bloquear el request que los lanza: `start()` y
 * `resume()` devuelven la fila creada y el run sigue en background. En memoria
 * se guarda, por run activo:
 * - el gate pendiente (approve/reject/custom lo resuelven),
 * - la espera pendiente por evento (+ eventos ya disparados),
 * - el AbortController (cancel).
 *
 * Los runs y eventos viven en disco (runStore): si el daemon reinicia, el run
 * queda huérfano en `running` y se puede resumir/cancelar a mano.
 */

import {
  runWorkflow,
  type ApprovalRequest,
  type ApprovalResponse,
  type RunWorkflowOptions,
  type WaitRequest,
} from "./executor";
import { loadWorkflow } from "./loader";
import { WorkflowRunStore } from "./runStore";
import type { WorkflowRun } from "./types";
import type { LoadedWorkflow } from "./executor";

export interface StartRunParams {
  inputs?: Record<string, unknown>;
  args?: string;
  cwd?: string;
  isolation?: "inherit" | "worktree";
  baseBranch?: string;
}

interface PendingGate {
  request: ApprovalRequest;
  resolve: (response: ApprovalResponse) => void;
}

interface PendingWait {
  request: WaitRequest;
  resolve: () => void;
}

interface ActiveRun {
  abort: AbortController;
  pending: PendingGate | null;
  pendingWait: PendingWait | null;
  firedEvents: Set<string>;
}

export interface WorkflowRuntimeOptions {
  repoRoot: string;
  cwd?: string;
  runsDir: string;
  env?: NodeJS.ProcessEnv;
  aiRunner?: RunWorkflowOptions["aiRunner"];
  onEvent?: RunWorkflowOptions["onEvent"];
  /** Notificación cuando un gate queda esperando (UI/daemon). */
  onGate?: (request: ApprovalRequest) => void;
}

export class WorkflowRuntime {
  private readonly active = new Map<string, ActiveRun>();
  private readonly store: WorkflowRunStore;

  constructor(private readonly opts: WorkflowRuntimeOptions) {
    this.store = new WorkflowRunStore(opts.runsDir);
  }

  async start(name: string, params: StartRunParams = {}): Promise<WorkflowRun> {
    const loaded = loadWorkflow(name, { repoRoot: this.opts.repoRoot });
    return this.launch(loaded, params);
  }

  async resume(runId: string): Promise<WorkflowRun> {
    const existing = this.store.load(runId);
    if (!existing) throw new Error(`run "${runId}" no existe`);
    const loaded = loadWorkflow(existing.workflow, {
      repoRoot: this.opts.repoRoot,
    });
    return this.launch(loaded, {}, runId);
  }

  private async launch(
    loaded: LoadedWorkflow,
    params: StartRunParams,
    resumeRunId?: string,
  ): Promise<WorkflowRun> {
    const abort = new AbortController();
    let resolveCreated: (run: WorkflowRun) => void = () => {};
    const createdPromise = new Promise<WorkflowRun>((resolve) => {
      resolveCreated = resolve;
    });
    const promise = runWorkflow(loaded, {
      cwd: params.cwd ?? this.opts.cwd ?? this.opts.repoRoot,
      runsDir: this.opts.runsDir,
      repoRoot: this.opts.repoRoot,
      inputs: params.inputs,
      args: params.args,
      isolation: params.isolation,
      baseBranch: params.baseBranch,
      env: this.opts.env,
      signal: abort.signal,
      aiRunner: this.opts.aiRunner,
      onEvent: this.opts.onEvent,
      resumeRunId,
      onRunCreated: (run) => {
        this.active.set(run.id, {
          abort,
          pending: null,
          pendingWait: null,
          firedEvents: new Set(),
        });
        resolveCreated(run);
      },
      onApproval: (request) =>
        new Promise<ApprovalResponse>((resolve) => {
          const entry = this.active.get(request.runId);
          if (entry) entry.pending = { request, resolve };
          try {
            this.opts.onGate?.(request);
          } catch {
            // la notificación nunca rompe el gate
          }
        }),
      onWait: (request) =>
        new Promise<void>((resolve, reject) => {
          const entry = this.active.get(request.runId);
          if (!entry) {
            reject(new Error("run no activo"));
            return;
          }
          if (entry.firedEvents.has(request.event)) {
            entry.firedEvents.delete(request.event);
            resolve();
            return;
          }
          let timer: ReturnType<typeof setTimeout> | null = null;
          if (typeof request.deadlineMs === "number" && request.deadlineMs > 0) {
            timer = setTimeout(() => {
              if (entry.pendingWait?.request.event === request.event) {
                entry.pendingWait = null;
              }
              reject(new Error(`wait "${request.event}" expiró`));
            }, request.deadlineMs);
          }
          entry.pendingWait = {
            request,
            resolve: () => {
              if (timer) clearTimeout(timer);
              resolve();
            },
          };
        }),
    });
    promise.catch(() => {});
    const run = await Promise.race([
      createdPromise,
      promise.then(() => {
        throw new Error("el run terminó antes de registrarse");
      }),
    ]);
    promise
      .finally(() => {
        this.active.delete(run.id);
      })
      .catch(() => {});
    return run;
  }

  getPending(runId: string): ApprovalRequest | null {
    return this.active.get(runId)?.pending?.request ?? null;
  }

  getPendingWait(runId: string): WaitRequest | null {
    return this.active.get(runId)?.pendingWait?.request ?? null;
  }

  listActive(): string[] {
    return [...this.active.keys()];
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  respond(runId: string, response: ApprovalResponse): void {
    const entry = this.active.get(runId);
    if (!entry?.pending) {
      throw new Error(`run "${runId}" no tiene gate pendiente`);
    }
    const pending = entry.pending;
    entry.pending = null;
    pending.resolve(response);
  }

  signal(runId: string, event: string): void {
    const entry = this.active.get(runId);
    if (!entry) throw new Error(`run "${runId}" no está activo`);
    if (entry.pendingWait?.request.event === event) {
      const pending = entry.pendingWait;
      entry.pendingWait = null;
      pending.resolve();
      return;
    }
    entry.firedEvents.add(event);
    if (entry.firedEvents.size > 50) {
      const oldest = entry.firedEvents.values().next().value;
      if (typeof oldest === "string") entry.firedEvents.delete(oldest);
    }
  }

  cancel(runId: string): void {
    const entry = this.active.get(runId);
    if (!entry) throw new Error(`run "${runId}" no está activo`);
    entry.abort.abort();
  }

  getRun(runId: string): WorkflowRun | null {
    return this.store.load(runId);
  }

  listRuns(limit = 50): WorkflowRun[] {
    return this.store.list(limit);
  }
}
