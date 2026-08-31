// QuickstartWizard — SRP: seven-step onboarding UI with progressive disclosure.
// Source: WarpFactories.md §14 · US-142→144
// ADR-003: P0-3..P0-8 — GitHub tick, repos reales, nombre custom, skip, crear→dashboard

import { useMemo, useState } from "react";
import {
  FACTORY_MCP_DASHBOARD_URL,
  MCP_ONBOARDING_PROMPT,
  STEP_COPY,
} from "../../lib/factory/domain/quickstart.data";
import { QUICKSTART_STEPS, isLastStep, progressLabel } from "../../lib/factory/domain/quickstart.wizard";
import type { QuickstartStep } from "../../lib/factory/domain/quickstart.wizard";
import { useQuickstart } from "../../lib/factory/hooks/useQuickstart";
import { useGitHubAuth } from "../../lib/factory/hooks/useGitHubAuth";
import { RemoteGitHubReposAdapter } from "../../lib/factory/adapters/githubRepos.adapter";
import { StepConnectProvider } from "./steps/StepConnectProvider";
import { StepRepos } from "./steps/StepRepos";
import { StepIdentity } from "./steps/StepIdentity";
import { StepSlackSkip } from "./steps/StepSlackSkip";
import { StepAgents } from "./steps/StepAgents";
import { StepTrackerMspSkip } from "./steps/StepTrackerMspSkip";
import { StepReviewCreate } from "./steps/StepReviewCreate";
import type { AgentToggleKey } from "../../lib/factory/domain/factory.record";

export interface QuickstartWizardProps {
  readonly onComplete?: (uid: string) => void;
}

function stepLabel(step: QuickstartStep): string {
  return STEP_COPY[step].title;
}

export function QuickstartWizard({ onComplete }: QuickstartWizardProps) {
  const { state, dispatch, stepResult, finish } = useQuickstart();
  const { status: githubStatus } = useGitHubAuth();
  const [finishMessage, setFinishMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const currentStep = QUICKSTART_STEPS[state.stepIndex] ?? "source";
  const copy = STEP_COPY[currentStep];
  const isReview = isLastStep(state);

  const githubReposAdapter = useMemo(() => new RemoteGitHubReposAdapter(), []);

  function send(action: Parameters<typeof dispatch>[0]): void {
    setFinishMessage("");
    setCreateError("");
    dispatch(action);
  }

  async function handleNext(): Promise<void> {
    if (!stepResult.ok) return;
    if (isReview && state.useMcpOnboarding) {
      setFinishMessage(`MCP externo seleccionado. Abre ${FACTORY_MCP_DASHBOARD_URL} y usa este prompt: ${MCP_ONBOARDING_PROMPT}`);
      return;
    }
    if (isReview) {
      setCreating(true);
      setCreateError("");
      try {
        const result = await finish();
        if (result.ok && result.value !== undefined) {
          const uid = result.value.factory.uid;
          setFinishMessage(`Factory ${result.value.factory.name} creada.`);
          // Navegación directa a dashboard de esa factory
          try {
            window.history.pushState(null, "", `/factory/${encodeURIComponent(uid)}/dashboard`);
            window.dispatchEvent(new PopStateEvent("popstate"));
          } catch {
            // ignore
          }
          onComplete?.(uid);
        } else {
          setCreateError(result.issues.map((i) => i.message).join(". "));
        }
      } finally {
        setCreating(false);
      }
      return;
    }
    send({ type: "next" });
  }

  // Guard P0-4: paso source requiere tick para habilitar Continuar
  const isSourceStep = currentStep === "source";
  const sourceCanContinue = !isSourceStep || githubStatus.connected;

  const canContinue = stepResult.ok && sourceCanContinue && !creating;

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
          <p className="mt-3 text-xs font-medium text-zinc-500">{progressLabel(state)} {isSourceStep && githubStatus.connected ? "· ✓ GitHub conectado" : ""}</p>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-zinc-900">{copy.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{copy.hint}</p>
          <div className="mt-6">
            {currentStep === "source" && (
              <StepConnectProvider
                provider={state.provider}
                onSelectProvider={(p) => send({ type: "setProvider", provider: p })}
              />
            )}
            {currentStep === "repos" && (
              <StepRepos
                selected={state.repos}
                onToggle={(repo) => send({ type: "toggleRepo", repo })}
                reposPort={githubReposAdapter}
              />
            )}
            {currentStep === "identity" && (
              <StepIdentity
                name={state.name}
                alias={state.alias}
                onName={(v) => send({ type: "setName", name: v })}
                onAlias={(v) => send({ type: "setAlias", alias: v })}
              />
            )}
            {currentStep === "slack" && <StepSlackSkip />}
            {currentStep === "agents" && (
              <StepAgents agents={state.agents} onToggle={(agent: AgentToggleKey) => send({ type: "toggleAgent", agent })} />
            )}
            {currentStep === "tracker" && <StepTrackerMspSkip />}
            {currentStep === "review" && (
              <StepReviewCreate
                state={state}
                githubConnected={githubStatus.connected}
                githubUsername={githubStatus.username}
                onCreate={() => void handleNext()}
                creating={creating}
                error={createError}
              />
            )}
          </div>
          {stepResult.ok === false && <p className="mt-5 text-sm text-red-600" role="alert">{stepResult.issues.map((i) => i.message).join(". ")}</p>}
          {isSourceStep && !githubStatus.connected && (
            <p className="mt-3 text-xs text-amber-700">Conectá GitHub para habilitar Continuar.</p>
          )}
          {finishMessage && <p className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{finishMessage}</p>}
          <div className="mt-8 flex items-center justify-between border-t border-zinc-100 pt-5">
            <button type="button" disabled={state.stepIndex === 0} onClick={() => send({ type: "back" })} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20">Atrás</button>
            {currentStep !== "review" && (
              <button type="button" disabled={!canContinue} onClick={() => void handleNext()} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20">Continuar</button>
            )}
            {currentStep === "review" && !state.useMcpOnboarding && (
              <span className="text-xs text-zinc-400">Revisá y creá</span>
            )}
          </div>
        </div>

        <aside className="h-fit rounded-xl border border-zinc-200 bg-subsurface p-5" aria-label="Resumen de la factory">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-600">Resumen en vivo</h2>
          <dl className="mt-4 grid gap-4 text-sm">
            <div><dt className="text-zinc-500">Factory</dt><dd className="mt-1 font-medium text-zinc-900">{state.name || "Sin nombre"}</dd></div>
            <div><dt className="text-zinc-500">Alias</dt><dd className="mt-1 font-medium text-zinc-900">{state.alias || "Sin alias"}</dd></div>
            <div><dt className="text-zinc-500">Repositorios</dt><dd className="mt-1 text-zinc-800">{state.repos.length ? state.repos.map((r) => `${r.owner}/${r.name}`).join(", ") : "Pendiente"}</dd></div>
            <div><dt className="text-zinc-500">Agentes</dt><dd className="mt-1 text-zinc-800">{(Object.keys(state.agents) as AgentToggleKey[]).filter((a) => state.agents[a]).join(", ")}</dd></div>
            <div><dt className="text-zinc-500">Tracker</dt><dd className="mt-1 text-zinc-800">{state.tracker === "none" ? "No conectado" : state.tracker}</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
