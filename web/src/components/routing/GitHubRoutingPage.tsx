// GitHubRoutingPage — SRP: simulador visual de routing GitHub y traza de cinco checks.
// DIP: consume datos de github.routing.derive y delega reglas en github.routing.
// Source: WarpFactories.md §9 · US-074, US-075, US-076, US-077

import { useMemo, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import {
  continuationKey,
  evaluateGitHubEvent,
  factoryLabel,
  routeGitHubEvent,
} from "../../lib/factory/domain/github.routing";
import type { GitHubRoutingEvent, RoutingPolicy } from "../../lib/factory/domain/github.routing";
import {
  GITHUB_EVENTS,
  GITHUB_FILTER_APPEARS_ON,
  GITHUB_ROUTING_PRESETS,
} from "../../lib/factory/domain/github.routing.derive";
import { useFactoryWorkspace } from "../../lib/factory/hooks/useFactories";
import { getFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import { HelpLink } from "../help/HelpLinks";

const DEFAULT_HANDLE = "@warp-factory";
const DEFAULT_REPO = "acme/payments-service";
const DEFAULT_EVENT = "issue_comment_created";
const DEFAULT_BODY = "Please review this @warp-factory";

function parseLabels(raw: string): readonly string[] {
  return raw
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

export function GitHubRoutingPage() {
  const { factories, selected } = useFactoryWorkspace();
  const [factoryUid, setFactoryUid] = useState(selected?.uid ?? factories[0]?.uid ?? "");
  const [handle, setHandle] = useState(DEFAULT_HANDLE);
  const [requireFactoryLabel, setRequireFactoryLabel] = useState(true);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [eventName, setEventName] = useState(DEFAULT_EVENT);
  const [labels, setLabels] = useState(factoryLabel(selected?.alias ?? "payments"));
  const [body, setBody] = useState(DEFAULT_BODY);
  const [isEdit, setIsEdit] = useState(false);
  const [authorIsBot, setAuthorIsBot] = useState(false);
  const [number, setNumber] = useState("42");

  const factory = factories.find((candidate) => candidate.uid === factoryUid) ?? selected ?? factories[0];
  const foremanName = factory?.alias ?? "payments";
  const policy: RoutingPolicy = {
    foremanName,
    handle,
    requireFactoryLabel,
  };
  const routingEvent: GitHubRoutingEvent = {
    provider: "github",
    event: eventName,
    repo,
    number: Number(number) || undefined,
    labels: parseLabels(labels),
    body,
    isEdit,
    authorIsBot,
  };
  // Derive during render: routing is pure and cheap; this avoids stale object dependencies.
  const decision = routeGitHubEvent(routingEvent, policy);
  const bundle = useMemo(() => getFactoryBundle(), []);
  const evaluated = evaluateGitHubEvent(bundle.ok ? bundle.value?.automations ?? [] : [], routingEvent, policy);

  function applyPreset(presetId: string): void {
    const preset = GITHUB_ROUTING_PRESETS.find((candidate) => candidate.id === presetId);
    if (preset === undefined) return;
    setHandle(preset.policy.handle);
    setRequireFactoryLabel(preset.policy.requireFactoryLabel);
    setRepo(preset.event.repo);
    setEventName(preset.event.event);
    // Factory-aware: adapta labels hardcodeados "factory:payments" al foreman actual.
    // - valid_routing siempre fuerza el label de la factory seleccionada para que enrute (OCP, sin tocar dominio)
    // - los 4 negativos reemplazan factory:payments por el label actual cuando hay factory distinta,
    //   preservando su razón específica de "No enruta" (missing mention, code block, edit) y evitando mismatch
    const currentLabel = factoryLabel(foremanName);
    let labelsToApply: readonly string[] = preset.event.labels;
    if (preset.id === "valid_routing") {
      labelsToApply = [currentLabel];
    } else if (labelsToApply.length > 0 && labelsToApply.some((candidateLabel) => candidateLabel.trim().toLowerCase() === "factory:payments")) {
      labelsToApply = labelsToApply.map((candidateLabel) =>
        candidateLabel.trim().toLowerCase() === "factory:payments" ? currentLabel : candidateLabel,
      );
    }
    setLabels(labelsToApply.join(", "));
    setBody(preset.event.body);
    setIsEdit(preset.event.isEdit);
    setAuthorIsBot(preset.event.authorIsBot);
    setNumber(String(preset.event.number ?? ""));
  }

  function copyLabel(): void {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(factoryLabel(foremanName));
    }
  }

  function copyContinuation(): void {
    const key = continuationKey(routingEvent);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(key);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-panel">
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 text-[13px]">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">GitHub routing</span>
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">
            WarpFactories.md §9 + US-076
          </span>
          <span className="ml-2 hidden sm:inline-flex">
            <HelpLink anchor="work-not-starting" label="Ayuda: GitHub routing — troubleshooting" />
          </span>
        </div>
        <HelpLink anchor="work-not-starting" label="Ayuda: GitHub routing" />
      </div>

      <div className="mx-auto w-full max-w-[1080px] p-4">
        <div className="mb-4">
          <h2 className="text-[18px] font-[650] tracking-[-0.02em] text-zinc-900">GitHub dual-label routing</h2>
          <p className="mt-1 max-w-[760px] text-[12.5px] leading-snug text-zinc-500">
            Simulá el requisito dual: el label de la factory y la mention del Foreman deben estar presentes.
            Ediciones, bots y menciones dentro de código no disparan automations.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {GITHUB_ROUTING_PRESETS.map((preset) => {
            const isValid = preset.id === "valid_routing";
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                title={`${preset.description} — ${preset.trace}`}
                aria-label={`Preset: ${preset.label}`}
                className={
                  isValid
                    ? "rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 shadow-sm transition-[background-color,border-color,color,scale] duration-150 hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-800 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                    : "rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11.5px] font-medium text-zinc-600 transition-[background-color,border-color,color,scale] duration-150 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                }
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="text-[13px] font-[650] text-zinc-900">Evento de prueba</h3>
            <div className="mt-3 space-y-3">
              <label className="block text-[11.5px] font-medium text-zinc-700">
                Factory / Foreman
                <select
                  value={factoryUid}
                  onChange={(event) => {
                    const nextUid = event.target.value;
                    setFactoryUid(nextUid);
                    const nextFactory = factories.find((candidate) => candidate.uid === nextUid);
                    if (nextFactory) setLabels(factoryLabel(nextFactory.alias));
                  }}
                  className="mt-1 h-8 w-full rounded-[8px] border border-zinc-200 bg-white px-2 text-[12.5px] font-normal text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
                  aria-label="Seleccionar factory"
                >
                  {factories.length === 0 && <option value="">payments</option>}
                  {factories.map((candidate) => (
                    <option key={candidate.uid} value={candidate.uid}>
                      {candidate.name} · {candidate.alias}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[11.5px] font-medium text-zinc-700">
                Handle del Foreman
                <input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder={DEFAULT_HANDLE}
                  className="mt-1 h-8 w-full rounded-[8px] border border-zinc-200 px-2 text-[12.5px] font-normal text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
                  aria-label="Handle del Foreman"
                />
              </label>

              <label className="flex items-center justify-between rounded-[8px] border border-zinc-200 bg-subsurface px-2.5 py-2 text-[11.5px] text-zinc-700">
                <span>Requerir label {factoryLabel(foremanName)}</span>
                <input
                  type="checkbox"
                  checked={requireFactoryLabel}
                  onChange={(event) => setRequireFactoryLabel(event.target.checked)}
                  className="h-4 w-4 accent-violet-600"
                  aria-label="Requerir label de factory"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                <label className="block text-[11.5px] font-medium text-zinc-700">
                  Repo
                  <input
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                    className="mt-1 h-8 w-full rounded-[8px] border border-zinc-200 px-2 text-[12.5px] font-normal text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
                    aria-label="Repo"
                  />
                </label>
                <label className="block text-[11.5px] font-medium text-zinc-700">
                  Número
                  <input
                    value={number}
                    onChange={(event) => setNumber(event.target.value)}
                    inputMode="numeric"
                    className="mt-1 h-8 w-full rounded-[8px] border border-zinc-200 px-2 text-[12.5px] font-normal text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
                    aria-label="Número de issue/PR"
                  />
                </label>
              </div>

              <label className="block text-[11.5px] font-medium text-zinc-700">
                Evento
                <select
                  value={eventName}
                  onChange={(event) => setEventName(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[8px] border border-zinc-200 bg-white px-2 text-[12.5px] font-normal text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
                  aria-label="Evento"
                >
                  {GITHUB_EVENTS.map((eventOption) => (
                    <option key={eventOption.id} value={eventOption.id}>
                      {eventOption.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[11.5px] font-medium text-zinc-700">
                Labels (separados por coma)
                <input
                  value={labels}
                  onChange={(event) => setLabels(event.target.value)}
                  className="mt-1 h-8 w-full rounded-[8px] border border-zinc-200 px-2 text-[12.5px] font-normal text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
                  aria-label="Labels"
                />
              </label>

              <label className="block text-[11.5px] font-medium text-zinc-700">
                Body / comentario nuevo
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={6}
                  className="mt-1 w-full resize-y rounded-[8px] border border-zinc-200 px-2 py-1.5 font-mono text-[12px] font-normal leading-relaxed text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
                  aria-label="Body del comentario"
                />
              </label>

              <div className="flex flex-wrap gap-3 text-[11.5px] text-zinc-700">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={isEdit} onChange={(event) => setIsEdit(event.target.checked)} className="h-4 w-4 accent-violet-600" aria-label="Es edición" />
                  Es edición
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={authorIsBot} onChange={(event) => setAuthorIsBot(event.target.checked)} className="h-4 w-4 accent-violet-600" aria-label="Autor es bot" />
                  Autor es bot
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-[650] text-zinc-900">Veredicto</h3>
              <span className={[
                "rounded-full px-2 py-1 text-[11.5px] font-semibold",
                decision.routable ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
              ].join(" ")}>
                {decision.routable ? "✓ Enruta" : "✗ No enruta"}
              </span>
            </div>
            <p className="mt-2 rounded-[8px] bg-subsurface p-2.5 text-[12px] leading-relaxed text-zinc-700">
              {decision.reason}
            </p>

            <h4 className="mt-4 text-[12px] font-[650] text-zinc-900">Traza por check</h4>
            <ul className="mt-2 space-y-2">
              {decision.checks.map((routingCheck) => (
                <li key={routingCheck.id} className="rounded-[8px] border border-zinc-200 p-2">
                  <div className="flex items-start gap-1.5">
                    {routingCheck.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />}
                    <div className="min-w-0">
                      <p className="text-[11.5px] font-medium text-zinc-800">{routingCheck.label}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{routingCheck.detail}</p>
                      <p className="mt-1 font-mono text-[10px] text-zinc-400">{routingCheck.source}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* continuationKey visible siempre (P1-03) — visible aunque no enrute, copiable */}
            <div className="mt-4 flex items-center justify-between gap-2 rounded-[8px] border border-zinc-200 bg-subsurface p-2.5">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-zinc-500">continuationKey</p>
                <p className="mt-1 break-all font-mono text-[11px] text-zinc-700" data-testid="continuation-key">{continuationKey(routingEvent)}</p>
              </div>
              <button
                type="button"
                onClick={copyContinuation}
                aria-label="Copiar continuationKey"
                title="Copiar continuationKey"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-zinc-500 hover:bg-white hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>

            {decision.routable && (
              <div className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 p-2.5">
                <p className="text-[11.5px] font-medium text-emerald-800">
                  {evaluated.matched.length} automation(s) coinciden con este evento.
                </p>
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-white/70 p-2 text-[10px] text-zinc-600">
                  {JSON.stringify({ event: routingEvent, matched: evaluated.matched.map((automation) => automation.name) }, null, 2)}
                </pre>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-2 rounded-[8px] border border-zinc-200 bg-subsurface p-2.5">
              <p className="text-[11px] leading-snug text-zinc-500">
                Las PRs que abre la factory llevan automáticamente este label:
                <span className="ml-1 font-mono text-zinc-700" data-testid="factory-label">{factoryLabel(foremanName)}</span>
              </p>
              <button
                type="button"
                onClick={copyLabel}
                aria-label="Copiar label"
                title="Copiar factory:alias"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-zinc-500 transition-[background-color,color,scale] duration-150 hover:bg-white hover:text-zinc-800 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="text-[13px] font-[650] text-zinc-900">Filtros disponibles</h3>
          <p className="mt-1 text-[11.5px] text-zinc-500">Tabla de referencia para configurar triggers (§9 + US-075).</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {GITHUB_FILTER_APPEARS_ON.map((filter) => (
              <div key={filter.key} className="rounded-[8px] border border-zinc-200 bg-subsurface p-2">
                <p className="font-mono text-[11.5px] font-medium text-zinc-800">{filter.label}</p>
                <p className="mt-1 text-[10.5px] leading-snug text-zinc-500">Appears on: {filter.appearsOn.length} eventos</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
