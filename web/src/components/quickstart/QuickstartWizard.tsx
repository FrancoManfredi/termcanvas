// QuickstartWizard — SRP: seven-step onboarding UI with progressive disclosure.
// Source: WarpFactories.md §14 · US-142→144

import { useState } from "react";
import {
  DEMO_REPOS,
  FACTORY_MCP_DASHBOARD_URL,
  MCP_ONBOARDING_PROMPT,
  STEP_COPY,
  repositoryLabel,
} from "../../lib/factory/domain/quickstart.data";
import { QUICKSTART_STEPS, isLastStep, progressLabel } from "../../lib/factory/domain/quickstart.wizard";
import type { QuickstartAction, QuickstartStep } from "../../lib/factory/domain/quickstart.wizard";
import { useQuickstart } from "../../lib/factory/hooks/useQuickstart";
import type { AgentToggleKey } from "../../lib/factory/domain/factory.record";

export interface QuickstartWizardProps {
  readonly onComplete?: () => void;
}

const AGENT_LABELS: Readonly<Record<AgentToggleKey, string>> = {
  triage: "Triage",
  spec: "Spec",
  implement: "Implement",
  review: "Review",
};

function stepLabel(step: QuickstartStep): string {
  return STEP_COPY[step].title;
}

export function QuickstartWizard({ onComplete }: QuickstartWizardProps) {
  const { state, dispatch, stepResult, finish } = useQuickstart();
  const [finishMessage, setFinishMessage] = useState("");
  const currentStep = QUICKSTART_STEPS[state.stepIndex] ?? "source";
  const copy = STEP_COPY[currentStep];
  const isReview = isLastStep(state);

  function send(action: QuickstartAction): void {
    setFinishMessage("");
    dispatch(action);
  }

  function handleNext(): void {
    if (!stepResult.ok) return;
    if (isReview && state.useMcpOnboarding) {
      setFinishMessage(`MCP externo seleccionado. Abre ${FACTORY_MCP_DASHBOARD_URL} y usa este prompt: ${MCP_ONBOARDING_PROMPT}`);
      return;
    }
    if (isReview) {
      const result = finish();
      if (result.ok && result.value !== undefined) {
        setFinishMessage(`Factory ${result.value.factory.name} creada. Primer work item enviado a Activity.`);
        onComplete?.();
      } else {
        setFinishMessage(result.issues.map((issue) => issue.message).join(". "));
      }
      return;
    }
    send({ type: "next" });
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-panel" aria-label="Quickstart">
      <header className="border-b border-zinc-200 px-8 py-6">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Warp Factories · Quickstart</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Crea tu primera factory</h1>
          <p className="mt-1 text-sm text-zinc-500">Configura lo esencial sin salir del flujo. Siempre podrás ajustar los detalles después.</p>
          <nav className="mt-6" aria-label="Progreso del Quickstart">
            <ol className="grid grid-cols-7 gap-2">
              {QUICKSTART_STEPS.map((step, index) => {
                const completed = index < state.stepIndex;
                const active = index === state.stepIndex;
                return (
                  <li key={step}>
                    <button
                      type="button"
                      disabled={!completed && !active}
                      onClick={() => send({ type: "goto", step: index })}
                      className={`w-full border-t-2 pt-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20 ${active ? "border-blue-600 text-blue-700" : completed ? "border-emerald-500 text-emerald-700" : "border-zinc-200 text-zinc-400"}`}
                      aria-current={active ? "step" : undefined}
                    >
                      <span className="block font-semibold">{index + 1}</span>
                      <span className="mt-1 block truncate">{stepLabel(step)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <p className="mt-3 text-xs font-medium text-zinc-500">{progressLabel(state)}</p>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-zinc-900">{copy.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{copy.hint}</p>
          <div className="mt-6">
            {currentStep === "source" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {(["github", "gitlab"] as const).map((provider) => (
                  <button
                    type="button"
                    key={provider}
                    onClick={() => send({ type: "setProvider", provider })}
                    className={`rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20 ${state.provider === provider ? "border-blue-600 bg-blue-50" : "border-zinc-200"}`}
                    aria-pressed={state.provider === provider}
                  >
                    <span className="block font-medium text-zinc-900">{provider === "github" ? "GitHub" : "GitLab"}</span>
                    <span className="mt-1 block text-xs text-zinc-500">Repositorio conectado para esta factory</span>
                  </button>
                ))}
              </div>
            )}
            {currentStep === "repos" && (
              <div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {DEMO_REPOS.map((repository) => {
                    const selected = state.repos.some((item) => repositoryLabel(item) === repositoryLabel(repository));
                    const isAtLimit = state.repos.length >= 2;
                    const isDisabledChip = !selected && isAtLimit;
                    return (
                      <button
                        type="button"
                        key={repositoryLabel(repository)}
                        onClick={() => send({ type: "toggleRepo", repo: repository })}
                        className={`rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20 ${selected ? "border-blue-600 bg-blue-50" : isDisabledChip ? "border-zinc-200 bg-zinc-50 opacity-70" : "border-zinc-200 hover:bg-zinc-50"}`}
                        aria-pressed={selected}
                        aria-disabled={isDisabledChip ? "true" : undefined}
                        title={isDisabledChip ? "2 máx — el 3º reemplaza al más viejo" : undefined}
                      >
                        <span className="font-mono text-sm text-zinc-900">{repositoryLabel(repository)}</span>
                        <span className="mt-1 block text-xs text-zinc-500">{selected ? "Seleccionado" : isDisabledChip ? "2 máx — el 3º reemplaza al más viejo" : "Disponible"}</span>
                      </button>
                    );
                  })}
                </div>
                {state.repos.length >= 2 && (
                  <p className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800" role="status">
                    2 máx — el 3º reemplaza al más viejo
                  </p>
                )}
              </div>
            )}
            {currentStep === "identity" && (
              <div className="grid gap-5">
                <label className="grid gap-2 text-sm font-medium text-zinc-700">
                  Nombre de la factory
                  <input className="rounded-lg border border-zinc-300 px-3 py-2 font-normal focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20" value={state.name} onChange={(event) => send({ type: "setName", name: event.target.value })} />
                </label>
                <label className="grid gap-2 text-sm font-medium text-zinc-700">
                  Alias del Foreman
                  <input className="rounded-lg border border-zinc-300 px-3 py-2 font-normal focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20" value={state.alias} onChange={(event) => send({ type: "setAlias", alias: event.target.value })} />
                  <span className="text-xs font-normal text-zinc-500">Se deriva del nombre hasta que lo edites.</span>
                </label>
              </div>
            )}
            {currentStep === "slack" && (
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-200 p-4">
                <span><span className="block font-medium text-zinc-900">Conectar Slack</span><span className="mt-1 block text-xs text-zinc-500">Recibir menciones y actualizaciones en un canal.</span></span>
                <input type="checkbox" checked={state.slack} onChange={() => send({ type: "toggleSlack" })} />
              </label>
            )}
            {currentStep === "agents" && (
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(AGENT_LABELS) as AgentToggleKey[]).map((agent) => (
                  <label key={agent} className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 focus-within:ring-2 focus-within:ring-violet-500/20">
                    <span className="font-medium text-zinc-900">{AGENT_LABELS[agent]}</span>
                    <input type="checkbox" checked={state.agents[agent]} disabled={agent === "implement"} onChange={() => send({ type: "toggleAgent", agent })} />
                  </label>
                ))}
              </div>
            )}
            {currentStep === "tracker" && (
              <div className="grid gap-2 sm:grid-cols-3">
                {(["none", "linear", "jira"] as const).map((tracker) => (
                  <button type="button" key={tracker} onClick={() => send({ type: "setTracker", tracker })} className={`rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20 ${state.tracker === tracker ? "border-blue-600 bg-blue-50" : "border-zinc-200"}`} aria-pressed={state.tracker === tracker}>
                    <span className="font-medium text-zinc-900">{tracker === "none" ? "Ahora no" : tracker === "linear" ? "Linear" : "Jira"}</span>
                  </button>
                ))}
              </div>
            )}
            {currentStep === "review" && (
              <div className="grid gap-5">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  <p className="font-medium text-zinc-900">Verificación del proveedor</p>
                  <p className="mt-1">{state.provider === "github" ? "GitHub" : "GitLab"} seleccionado. No se guardan credenciales en este paso.</p>
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 focus-within:ring-2 focus-within:ring-violet-500/20">
                  <input type="checkbox" checked={state.useMcpOnboarding} onChange={(event) => send({ type: "setUseMcpOnboarding", value: event.target.checked })} />
                  <span><span className="block font-medium text-zinc-900">Usar Factory MCP para el onboarding</span><span className="mt-1 block text-xs text-zinc-600">{MCP_ONBOARDING_PROMPT}</span></span>
                </label>
                <p className="text-sm text-zinc-600">
                  {state.useMcpOnboarding
                    ? `La ruta externa de Factory MCP abrirá el onboarding en ${FACTORY_MCP_DASHBOARD_URL}; no se creará una factory ni un work item local.`
                    : "Al crearla, se abrirá el camino de Activity con el primer work item listo para ejecutar."}
                </p>
              </div>
            )}
          </div>
          {stepResult.ok === false && <p className="mt-5 text-sm text-red-600" role="alert">{stepResult.issues.map((issue) => issue.message).join(". ")}</p>}
          {finishMessage && <p className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{finishMessage}</p>}
          <div className="mt-8 flex items-center justify-between border-t border-zinc-100 pt-5">
            <button type="button" disabled={state.stepIndex === 0} onClick={() => send({ type: "back" })} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20">Atrás</button>
            <button type="button" disabled={!stepResult.ok} onClick={handleNext} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20">{isReview ? (state.useMcpOnboarding ? "Abrir onboarding externo de Factory MCP" : "Crear factory y enviar el primer work item") : "Continuar"}</button>
          </div>
        </div>

        <aside className="h-fit rounded-xl border border-zinc-200 bg-subsurface p-5" aria-label="Resumen de la factory">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-600">Resumen en vivo</h2>
          <dl className="mt-4 grid gap-4 text-sm">
            <div><dt className="text-zinc-500">Factory</dt><dd className="mt-1 font-medium text-zinc-900">{state.name || "Sin nombre"}</dd></div>
            <div><dt className="text-zinc-500">Alias</dt><dd className="mt-1 font-medium text-zinc-900">{state.alias || "Sin alias"}</dd></div>
            <div><dt className="text-zinc-500">Repositorios</dt><dd className="mt-1 text-zinc-800">{state.repos.length ? state.repos.map(repositoryLabel).join(", ") : "Pendiente"}</dd></div>
            <div><dt className="text-zinc-500">Agentes</dt><dd className="mt-1 text-zinc-800">{(Object.keys(state.agents) as AgentToggleKey[]).filter((agent) => state.agents[agent]).map((agent) => AGENT_LABELS[agent]).join(", ")}</dd></div>
            <div><dt className="text-zinc-500">Tracker</dt><dd className="mt-1 text-zinc-800">{state.tracker === "none" ? "No conectado" : state.tracker}</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
