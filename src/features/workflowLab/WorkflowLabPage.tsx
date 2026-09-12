/**
 * Workflow Lab (Fase 4c) — lista de workflows, form de run, runs persistidos
 * y detalle con gates, cancelación y DAG por capas. Polling 2.5s (mismo ritmo
 * que FactoryLab).
 */

import { useCallback, useEffect, useState } from "react";
import {
  getFactoryWorkflowDefinition,
  getFactoryWorkflowRun,
  getFactoryWorkflowRuns,
  getFactoryWorkflows,
  postFactoryWorkflowCancel,
  postFactoryWorkflowDecision,
  postFactoryWorkflowResume,
  postFactoryWorkflowRun,
  postFactoryWorkflowSignal,
  type WorkflowDefinitionInfo,
  type WorkflowRunDetail,
  type WorkflowRunInfo,
  type WorkflowSummary,
} from "../../lib/factoryClient";
import {
  buildDagLayers,
  defaultsForInputs,
  formatTotals,
  nodeBodyOf,
  parseInputsJson,
  statusTone,
} from "./workflowVm";

const POLL_MS = 2500;

const INPUT_CLASS =
  "w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";

export function WorkflowLabPage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<WorkflowRunInfo[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinitionInfo | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);
  const [args, setArgs] = useState("");
  const [inputsText, setInputsText] = useState("");
  const [gateText, setGateText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [list, runsResult] = await Promise.all([
      getFactoryWorkflows(),
      getFactoryWorkflowRuns(),
    ]);
    if (list.ok) setWorkflows(list.data);
    else setRunsError(list.error);
    if (runsResult.ok) {
      setRuns(runsResult.data);
      setRunsError(null);
    } else {
      setRunsError(runsResult.error);
    }
    if (selectedRunId) {
      const detailResult = await getFactoryWorkflowRun(selectedRunId);
      if (detailResult.ok) setDetail(detailResult.data);
    }
  }, [selectedRunId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const selectWorkflow = async (name: string) => {
    setSelectedWorkflow(name);
    setDefinition(null);
    const result = await getFactoryWorkflowDefinition(name);
    if (result.ok) {
      setDefinition(result.data.info);
      const defaults = defaultsForInputs(result.data.info.def.inputs);
      setInputsText(
        Object.keys(defaults).length > 0
          ? JSON.stringify(defaults, null, 2)
          : "",
      );
    } else setNotice(result.error);
  };

  const startRun = async () => {
    if (!selectedWorkflow) {
      setNotice("Elegí un workflow de la lista");
      return;
    }
    const parsed = parseInputsJson(inputsText);
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    setBusy(true);
    const result = await postFactoryWorkflowRun({
      name: selectedWorkflow,
      args: args.trim().length > 0 ? args : undefined,
      inputs: parsed.value,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setNotice(`run ${result.data.id} lanzado (${result.data.status})`);
    setSelectedRunId(result.data.id);
    void refresh();
  };

  const decide = async (decision: string) => {
    if (!selectedRunId) return;
    setBusy(true);
    const result = await postFactoryWorkflowDecision(
      selectedRunId,
      decision,
      gateText.trim().length > 0 ? gateText : undefined,
    );
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setNotice(`${decision} enviado`);
    setGateText("");
    void refresh();
  };

  const cancelRun = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    const result = await postFactoryWorkflowCancel(selectedRunId);
    setBusy(false);
    if (!result.ok) setNotice(result.error);
    else setNotice("cancel enviado");
    void refresh();
  };

  const resumeRun = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    const result = await postFactoryWorkflowResume(selectedRunId);
    setBusy(false);
    if (!result.ok) setNotice(result.error);
    else setNotice(`run ${result.data.id} reanudado`);
    void refresh();
  };

  const sendSignal = async (event: string) => {
    if (!selectedRunId) return;
    setBusy(true);
    const result = await postFactoryWorkflowSignal(selectedRunId, event);
    setBusy(false);
    if (!result.ok) setNotice(result.error);
    else setNotice(`signal "${event}" enviado`);
    void refresh();
  };

  const defNodes = (definition?.def.nodes ?? []) as Array<
    Record<string, unknown> & { id: string; depends_on?: string[] }
  >;
  const defById = new Map(defNodes.map((node) => [node.id, node]));
  const layers = defNodes.length > 0 ? buildDagLayers(defNodes) : [];
  const runNodes = detail?.run.nodes ?? {};
  const decisions =
    detail?.pending && detail.pending.decisions.length > 0
      ? detail.pending.decisions
      : ["approve", "reject"];

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4 text-sm">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">Workflows</h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Engine declarativo — runs en background, gates humanos y DAG por
            capas.
          </p>
        </div>
        {notice && (
          <button
            type="button"
            onClick={() => setNotice(null)}
            title="Cerrar aviso"
            className="max-w-[520px] truncate rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)]"
          >
            {notice}
          </button>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] gap-3">
        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex min-h-0 flex-col rounded border border-[var(--border)]">
            <div className="border-b border-[var(--border)] px-2 py-1 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Workflows ({workflows.length})
            </div>
            <ul className="max-h-[240px] overflow-auto">
              {workflows.map((workflow) => (
                <li key={workflow.name}>
                  <button
                    type="button"
                    onClick={() => void selectWorkflow(workflow.name)}
                    title={workflow.filePath}
                    className={`w-full px-2 py-1.5 text-left hover:bg-[var(--surface-hover)] ${
                      selectedWorkflow === workflow.name
                        ? "bg-[var(--surface-hover)]"
                        : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{workflow.name}</span>
                      <span className="rounded border border-[var(--border)] px-1 text-[10px] uppercase text-[var(--text-secondary)]">
                        {workflow.scope}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-[var(--text-secondary)]">
                      {workflow.description}
                    </span>
                  </button>
                </li>
              ))}
              {workflows.length === 0 && (
                <li className="px-2 py-2 text-xs text-[var(--text-secondary)]">
                  Sin workflows. Creá .agents/workflows/&lt;name&gt;/workflow.yaml
                </li>
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-2 rounded border border-[var(--border)] p-2">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Nuevo run{selectedWorkflow ? ` — ${selectedWorkflow}` : ""}
            </div>
            <input
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder="args (texto libre, $ARGUMENTS)"
              className={INPUT_CLASS}
            />
            <textarea
              value={inputsText}
              onChange={(event) => setInputsText(event.target.value)}
              placeholder='inputs JSON: {"clave": "valor"}'
              rows={3}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              disabled={busy || !selectedWorkflow}
              onClick={() => void startRun()}
              className="rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              Run
            </button>
          </div>

          {layers.length > 0 && (
            <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border)] p-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                DAG — {definition?.name}
              </div>
              <div className="flex flex-col gap-1">
                {layers.map((layer, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-1">
                    <span className="w-4 text-[10px] text-[var(--text-secondary)]">
                      {index + 1}
                    </span>
                    {layer.map((id) => {
                      const state = runNodes[id];
                      const body = nodeBodyOf(defById.get(id));
                      return (
                        <span
                          key={id}
                          title={`${body}${state?.output ? `\n${state.output.slice(0, 200)}` : ""}`}
                          className={`rounded border px-2 py-1 text-xs ${statusTone(
                            state?.status ?? "pending",
                          )}`}
                        >
                          {id}
                          <span className="ml-1 text-[10px] opacity-60">
                            {body}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="grid min-h-0 grid-cols-[280px_1fr] gap-3">
          <div className="flex min-h-0 flex-col overflow-auto rounded border border-[var(--border)]">
            <div className="border-b border-[var(--border)] px-2 py-1 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Runs ({runs.length})
            </div>
            <ul>
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={`w-full px-2 py-1.5 text-left hover:bg-[var(--surface-hover)] ${
                      selectedRunId === run.id ? "bg-[var(--surface-hover)]" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`rounded border px-1 text-[10px] uppercase ${statusTone(
                          run.status,
                        )}`}
                      >
                        {run.status}
                      </span>
                      <span className="font-medium">{run.workflow}</span>
                    </span>
                    <span className="block truncate text-[10px] text-[var(--text-secondary)]">
                      {run.id}
                    </span>
                  </button>
                </li>
              ))}
              {runs.length === 0 && (
                <li className="px-2 py-2 text-xs text-[var(--text-secondary)]">
                  Sin runs todavía.
                </li>
              )}
            </ul>
            {runsError && (
              <div className="border-t border-[var(--border)] px-2 py-1 text-xs text-red-400">
                {runsError}
              </div>
            )}
          </div>

          <div className="min-h-0 overflow-auto rounded border border-[var(--border)] p-3">
            {!detail ? (
              <p className="text-xs text-[var(--text-secondary)]">
                Elegí un run para ver nodos, gates y evidencia.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-xs uppercase ${statusTone(
                      detail.run.status,
                    )}`}
                  >
                    {detail.run.status}
                  </span>
                  <span className="font-medium">{detail.run.workflow}</span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {detail.run.id}
                  </span>
                  <span className="ml-auto text-xs text-[var(--text-secondary)]">
                    {formatTotals(detail.run)}
                  </span>
                  {(detail.run.status === "failed" ||
                    detail.run.status === "cancelled" ||
                    (detail.run.status === "running" && !detail.active)) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resumeRun()}
                      className="rounded border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--surface-hover)] disabled:opacity-40"
                      title={
                        detail.run.status === "running" && !detail.active
                          ? "Run huérfano (el daemon reinició): reanudar"
                          : "Reanudar el run"
                      }
                    >
                      Resumir
                    </button>
                  )}
                  {(detail.run.status === "running" ||
                    detail.run.status === "pending") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void cancelRun()}
                      className="rounded border border-red-500/40 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                {detail.run.error && (
                  <p className="mt-2 text-xs text-red-400">{detail.run.error}</p>
                )}

                {detail.pending && (
                  <div className="mt-3 rounded border border-amber-500/40 p-2">
                    <div className="text-xs font-medium text-amber-400">
                      Gate pendiente — {detail.pending.nodeId}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs">
                      {detail.pending.message}
                    </p>
                    <input
                      value={gateText}
                      onChange={(event) => setGateText(event.target.value)}
                      placeholder="comentario / razón (opcional)"
                      className={`${INPUT_CLASS} mt-2`}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {decisions.map((decision) => (
                        <button
                          key={decision}
                          type="button"
                          disabled={busy}
                          onClick={() => void decide(decision)}
                          className="rounded border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--surface-hover)] disabled:opacity-40"
                        >
                          {decision}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {detail.wait && (
                  <div className="mt-3 flex items-center gap-2 rounded border border-sky-500/40 p-2 text-xs">
                    <span>
                      Esperando evento{" "}
                      <span className="font-medium">{detail.wait.event}</span> en{" "}
                      {detail.wait.nodeId}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void sendSignal(detail.wait!.event)}
                      className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--surface-hover)] disabled:opacity-40"
                    >
                      Señalizar
                    </button>
                  </div>
                )}

                <table className="mt-3 w-full border-collapse text-xs">
                  <thead>
                    <tr className="text-left text-[var(--text-secondary)]">
                      <th className="border-b border-[var(--border)] py-1 pr-2">
                        nodo
                      </th>
                      <th className="border-b border-[var(--border)] py-1 pr-2">
                        estado
                      </th>
                      <th className="border-b border-[var(--border)] py-1">
                        salida / error
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(detail.run.nodes).map((state) => (
                      <tr key={state.id} className="align-top">
                        <td className="py-1 pr-2 font-medium">{state.id}</td>
                        <td className={`py-1 pr-2 ${statusTone(state.status)}`}>
                          {state.status}
                          {state.attempts > 1 ? ` x${state.attempts}` : ""}
                        </td>
                        <td
                          className="max-w-[520px] truncate py-1 text-[var(--text-secondary)]"
                          title={state.error ?? state.output ?? ""}
                        >
                          {(
                            state.error ??
                            state.skipReason ??
                            state.output ??
                            ""
                          ).slice(0, 200)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
