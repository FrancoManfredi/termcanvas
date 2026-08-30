import { useMemo, useState } from "react";
import { FACTORY_API_SNIPPETS } from "../../lib/factory/domain/factoryApi.snippets";
import type { FactoryRunResponse } from "../../lib/factory/domain/factoryApi.types";
import { createFactoryApiRuntime } from "../../lib/factory/domain/factoryApi.routes";
import { useFactoryWorkspace } from "../../lib/factory/hooks/useFactories";
import { useWorkItemStore } from "../../lib/factory/store/workItemStore.context";
import { HelpLink } from "../help/HelpLinks";

// FactoryApiPage — UI mínima para probar el contrato live-managed sin credenciales.
// Source: WarpFactories.md §19 · US-149→155
export function FactoryApiPage() {
  const workspace = useFactoryWorkspace();
  const workItems = useWorkItemStore();
  const runtime = useMemo(() => createFactoryApiRuntime(workspace.store, workItems), [workspace.store, workItems]);
  const [selectedUid, setSelectedUid] = useState(workspace.selected?.uid ?? workspace.factories[0]?.uid ?? "");
  const [prompt, setPrompt] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  const [lastRun, setLastRun] = useState<FactoryRunResponse | null>(null);
  const [error, setError] = useState("");

  function dispatchRun() {
    setError("");
    const response = runtime.router.dispatch("POST", `/api/v1/factory/${selectedUid}/runs`, {
      prompt,
      ticket_ref: ticketRef.trim() || undefined,
    });
    if (response.status >= 400) {
      const body = response.body as { error?: string };
      setError(body.error ?? "No se pudo crear el run");
      return;
    }
    setLastRun(response.body as FactoryRunResponse);
    setPrompt("");
    setTicketRef("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-panel">
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">Factory API</span>
          <span className="text-zinc-400">›</span>
          <span className="text-zinc-500">Live-managed</span>
          <span className="ml-2 hidden sm:inline-flex">
            <HelpLink anchor="factory-api" label="Ayuda: Factory API" />
          </span>
        </div>
        <HelpLink anchor="factory-api" label="Ayuda: Factory API — troubleshooting" />
      </div>
      <div className="mx-auto w-full max-w-[1080px] space-y-6 p-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Live-managed</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Factory API</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
            Probá el contrato compatible con Warp sin completar credenciales. El simulador crea un work item en la factory seleccionada.
          </p>
        </header>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="factory-run-heading">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 id="factory-run-heading" className="font-semibold text-zinc-900">Enviar trabajo</h2>
              <p className="mt-1 text-xs text-zinc-500">Solo prompt es obligatorio; el título se deriva automáticamente.</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Stub local</span>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-zinc-700">
              Factory
              <select value={selectedUid} onChange={(event) => setSelectedUid(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal text-zinc-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" aria-label="Seleccionar factory">
                {workspace.factories.map((factory) => <option key={factory.uid} value={factory.uid}>{factory.name} · {factory.alias}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-zinc-700">
              Ticket ref <span className="font-normal text-zinc-400">(opcional)</span>
              <input value={ticketRef} onChange={(event) => setTicketRef(event.target.value)} placeholder="linear:PAY-123" className="mt-2 h-11 w-full rounded-lg border border-zinc-300 px-3 font-normal text-zinc-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" aria-label="Ticket ref" />
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium text-zinc-700">
            Prompt
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} placeholder="Fix checkout race" className="mt-2 w-full resize-y rounded-lg border border-zinc-300 p-3 font-normal text-zinc-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" aria-label="Prompt" />
          </label>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          <button type="button" onClick={dispatchRun} disabled={!prompt.trim() || !selectedUid} className="mt-4 h-11 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20">Crear run</button>
        </section>

        {lastRun && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5" aria-live="polite">
            <h2 className="font-semibold text-emerald-900">Run creado</h2>
            <dl className="mt-3 grid gap-2 text-sm text-emerald-900 sm:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wide text-emerald-700">ID</dt><dd className="font-mono">{lastRun.id}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-emerald-700">Estado</dt><dd>{lastRun.status} · {lastRun.stage}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-emerald-700">Work item</dt><dd className="font-mono">{lastRun.work_item_id}</dd></div>
            </dl>
          </section>
        )}

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-zinc-900">Snippets</h2>
          <div className="mt-4 space-y-3">
            {FACTORY_API_SNIPPETS.map((snippet) => (
              <article key={snippet.id} className="rounded-lg bg-zinc-950 p-4 text-zinc-100">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{snippet.label} · {snippet.language}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-5"><code>{snippet.code}</code></pre>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
