/**
 * WorkflowRuntime — runs en background con gates y cancelación en proceso.
 *
 * Los runs largos no deben bloquear el request que los lanza: `start()`
 * devuelve la fila creada y el run sigue en background. En memoria se guarda:
 * - el gate pendiente por run (approve/reject lo resuelven),
 * - el AbortController por run (cancel).
 *
 * Los runs y eventos viven en disco (runStore): si el daemon reinicia, el run
 * queda huérfano en `running` y se resuelve a mano (cancel/resume en F6).
 */

import {
  runWorkflow,
  type ApprovalRequest,
  type ApprovalResponse,
  type RunWorkflowOptions,
} from "./executor";
import { loadWorkflow } from "./loader";
import { WorkflowRunStore } from "./runStore";
import type { WorkflowRun } from "./types";

export interface StartRunParams {
  inputs?: Record<string, unknown>;
  args?: string;
}

interface PendingGate {
  request: ApprovalRequest;
  resolve: (response: ApprovalResponse) => void;
}

interface ActiveRun {
  abort: AbortController;
  pending: PendingGate | null;
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
    const abort = new AbortController();
    let resolveCreated: (run: WorkflowRun) => void = () => {};
    const createdPromise = new Promise<WorkflowRun>((resolve) => {
      resolveCreated = resolve;
    });
    const promise = runWorkflow(loaded, {
      cwd: this.opts.cwd ?? this.opts.repoRoot,
      runsDir: this.opts.runsDir,
      repoRoot: this.opts.repoRoot,
      inputs: params.inputs,
      args: params.args,
      env: this.opts.env,
      signal: abort.signal,
      aiRunner: this.opts.aiRunner,
      onEvent: this.opts.onEvent,
      onRunCreated: (run) => {
        this.active.set(run.id, { abort, pending: null });
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
    });
    promise.catch(() => {});
    const run = await createdPromise;
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
