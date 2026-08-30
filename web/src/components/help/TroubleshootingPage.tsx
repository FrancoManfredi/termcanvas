// SRP: Help / Troubleshooting — static but meaningful, lists HelpSection; no store dependency
// DIP: page lists, HelpSection shows; no side effects, pure render
// Scalable: agregar seccion = agregar HelpSection + data en troubleshooting.data.ts
// Source: WarpFactories.md §18 · US-145→148

import { useEffect } from "react";
import { HelpSection } from "./HelpSection";
import {
  SETUP_ROWS,
  WORK_NOT_STARTING_LEAD,
  WORK_SOURCES,
  TWO_RUNS_WARNING,
  RUNS_ROWS,
  TROUBLESHOOTING_META,
} from "../../lib/factory/domain/troubleshooting.data";

export function TroubleshootingPage() {
  // lazy-safe deep-link: when HelpLink sets location.hash and navigates via onNavigate,
  // the component mounts asynchronously; this effect scrolls after mount.
  useEffect(() => {
    function scrollToHash(): void {
      const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
      if (!hash) return;
      // allow DOM to settle after lazy Suspense
      window.setTimeout(() => {
        const el = document.getElementById(hash);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 40);
    }
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">Help</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Troubleshooting</span>
          <span className="ml-2 hidden text-[11px] text-zinc-400 sm:inline">{TROUBLESHOOTING_META.subtitle}</span>
        </div>
        <span className="ml-auto text-[11px] text-zinc-500">{TROUBLESHOOTING_META.sourceNote}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px] space-y-4">
          <div className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h1 className="text-[16px] font-[650] tracking-[-0.02em] text-zinc-900">{TROUBLESHOOTING_META.title}</h1>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
              Guía estática basada en <span className="font-mono text-[11px] text-zinc-700">WarpFactories.md §18</span> — WarpFactories-UserStories.md E17 US-145 → US-148. Tres bloques: Setting up, Work isn&apos;t
              starting, Runs and work items. Nombres exactos del doc, sin inventar.
            </p>
          </div>

          {/* Anchors for HelpLink deep-link: setup covers Setting up */}
          <div id="setup" className="scroll-mt-4" aria-hidden="true" />
          <HelpSection
            id="setting-up"
            title="Setting up"
            description="WarpFactories.md §18 — 4 casos (US-145). Fuente: factories/troubleshooting."
          >
            <div className="overflow-hidden rounded-[8px] border border-zinc-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]" aria-label="Setting up troubleshooting table">
                  <thead className="bg-zinc-50 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Síntoma</th>
                      <th className="px-3 py-2">Causa</th>
                      <th className="px-3 py-2">Fix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 bg-white">
                    {SETUP_ROWS.map((row) => (
                      <tr key={row.symptom} className="align-top hover:bg-zinc-50/60">
                        <td className="px-3 py-2 font-medium text-zinc-900">{row.symptom}</td>
                        <td className="px-3 py-2 text-zinc-600">{row.cause}</td>
                        <td className="px-3 py-2 text-zinc-600">{row.fix}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </HelpSection>

          {/* work-not-starting anchor */}
          <div id="work-not-starting" className="scroll-mt-4" aria-hidden="true" />
          <HelpSection
            id="work-isnt-starting"
            title="Work isn't starting"
            description={WORK_NOT_STARTING_LEAD}
          >
            <div className="overflow-hidden rounded-[8px] border border-zinc-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]" aria-label="Work isn't starting per-source causes">
                  <thead className="bg-zinc-50 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Causas per-source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 bg-white">
                    {WORK_SOURCES.map((row) => (
                      <tr key={row.source} className="align-top hover:bg-zinc-50/60">
                        <td className="px-3 py-2 font-medium text-zinc-900">{row.source}</td>
                        <td className="px-3 py-2 text-zinc-600">{row.causes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* two-runs anchor inside work-not-starting block */}
              <div id="two-runs" className="scroll-mt-4" aria-hidden="true" />
              <div className="bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-700">
                <span className="font-[600] text-amber-800">Two runs warning:</span> {TWO_RUNS_WARNING}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              Nota diagnóstico del doc: confirmar enabled + event type matchea, check every filter AND (single mismatch frena), confirm
              source conectado a <span className="font-medium">esta</span> factory.
            </p>
          </HelpSection>

          {/* runs anchors */}
          <div id="runs-stuck" className="scroll-mt-4" aria-hidden="true" />
          <HelpSection id="runs-and-work-items" title="Runs and work items" description="WarpFactories.md §18 — 3 filas (US-148).">
            <div className="overflow-hidden rounded-[8px] border border-zinc-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]" aria-label="Runs and work items troubleshooting table">
                  <thead className="bg-zinc-50 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Síntoma</th>
                      <th className="px-3 py-2">Fix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 bg-white">
                    {RUNS_ROWS.map((row) => (
                      <tr key={row.symptom} className="align-top hover:bg-zinc-50/60">
                        <td className="px-3 py-2 font-medium text-zinc-900">{row.symptom}</td>
                        <td className="px-3 py-2 text-zinc-600">{row.fix}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div id="no-pr" className="scroll-mt-4" aria-hidden="true" />
              <div className="bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
                <span className="font-medium">Stop task</span> en Activity es{" "}
                <span className="font-[600] text-zinc-900">inmediato, sin confirmación</span> (Caution explícito). Work item looks stuck
                → a menudo <span className="font-medium">esperando a persona, no fallando</span> (spec approval / clarifying questions / PR):
                ver Event history + View agent + steer si activo vía cloud agent session sharing.
              </div>
            </div>
          </HelpSection>

          {/* factory-api anchor */}
          <div id="factory-api" className="scroll-mt-4" aria-hidden="true" />
          <HelpSection id="factory-api-section" title="Factory API" description="WarpFactories.md §19 · Factory API — troubleshooting y rate limits.">
            <div className="rounded-[8px] border border-zinc-200 bg-white p-3">
              <p className="text-[12px] leading-relaxed text-zinc-600">
                <span className="font-medium text-zinc-900">Factory API</span> es live-managed sin credenciales en LOCAL. Si un dispatch falla, verificar: factory UID válido, prompt no vacío, ticket_ref con formato{" "}
                <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">^[a-z]+:[A-Za-z0-9-_]+$</code>, y que la factory exista en el workspace. Revisar Agent API{" "}
                <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">/agent/runs/:runId</code> para estado y followups.
              </p>
              <ul className="mt-2 list-disc pl-4 text-[11px] leading-relaxed text-zinc-600">
                <li>
                  401 unauthorized → falta <code className="font-mono">warp_local_api_key</code> o header Bearer incorrecto.
                </li>
                <li>404 factory_not_found → UID no existe; crear factory primero o verificar selector.</li>
                <li>422 invalid_ticket_ref → usar formato linear:ABC-123 o jira:PROJ-1.</li>
                <li>429 rate_limited → backoff y reintentar; el stub no limita pero Warp real sí.</li>
              </ul>
            </div>
          </HelpSection>

          <div className="rounded-[8px] border border-dashed border-zinc-300 bg-white px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
            Nombres exactos del doc — no inventados. Routing GitHub: <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">factory:&lt;alias&gt;</code> +{" "}
            <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">@warp-factory</code>. Slack overlapping:{" "}
            <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">app_mention + message_posted</code> → 2 runs. WarpFactories.md
            §6, §9, §10, §18.
          </div>
        </div>
      </div>
    </div>
  );
}
