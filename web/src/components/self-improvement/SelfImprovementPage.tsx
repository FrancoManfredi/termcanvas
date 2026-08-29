// SelfImprovementPage — 3 PRs mock con Regressions addressed (WarpFactories.md:806, §11)
// Sin date filter: 3 newest, cada PR linkea failing runs + Scorer results
import { useMemo } from "react";
import { mockSelfImprovementPRs } from "../../lib/factory/domain/benchmark.derive";

export function SelfImprovementPage() {
  const prs = useMemo(() => mockSelfImprovementPRs(), []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-zinc-500">Factory</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Self-improvement</span>
          <span className="ml-2 hidden text-[11px] text-zinc-400 sm:inline">3 newest PRs sin importar date range — WarpFactories.md:806</span>
        </div>
        <span className="ml-auto rounded-full bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white">{prs.length} PRs</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px] space-y-4">
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">Self-improvement PRs</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
              Cuando <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">selfImprovement: true</code> por Scorer y flaggea failure recurrente, el flow agrupa failures y filea follow-up tasks como ordinary agent runs que pueden editar <span className="font-medium text-zinc-700">app code o factory definition</span> (skills, prompts). Nada se adopta sin review humano. Cada PR incluye sección <span className="font-medium text-zinc-700">Regressions addressed</span> que linkea los failing runs + Scorer results (traceability).
            </p>
          </section>

          {prs.map((pr) => (
            <article key={pr.id} className="rounded-[12px] border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <a href={pr.prUrl} target="_blank" rel="noreferrer" className="text-[13px] font-[600] tracking-[-0.01em] text-violet-700 hover:underline">{pr.title}</a>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                    <span className="font-mono">#{pr.prUrl.split("/").pop()}</span>
                    <span>·</span>
                    <span>{new Date(pr.createdAt).toLocaleDateString()}</span>
                    <span>·</span>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5">scorer: {pr.scorerName}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${pr.status === "merged" ? "bg-violet-600 text-white" : "bg-emerald-50 text-emerald-700"}`}>{pr.status}</span>
                    <span>·</span>
                    <span>factory: {pr.factoryName}</span>
                  </div>
                </div>
                <a href={pr.prUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-[8px] border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50">Open PR ↗</a>
              </div>

              <div className="mt-3 rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Regressions addressed</div>
                <ul className="mt-2 space-y-1.5">
                  {pr.regressions.map((r) => (
                    <li key={r.runId} className="flex flex-wrap items-start justify-between gap-2 rounded-[8px] border bg-white px-3 py-2">
                      <div className="min-w-0">
                        <a href={r.runUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] font-medium text-violet-700 hover:underline">{r.runId}</a>
                        <span className="ml-1.5 text-[11px] text-zinc-500">· {r.scorerName} · label <span className="rounded bg-amber-50 px-1 py-0.5 font-mono text-amber-700">{r.label}</span> · score {r.score}</span>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-600">{r.reasoning}</div>
                      </div>
                      <a href={r.runUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-medium text-zinc-500 hover:text-zinc-700">View run ↗</a>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-[11px] text-zinc-400">Traceability: cada PR linkea failing runs + Scorer results que lo motivan. Revisar con mismos estándares que cambios humanos.</div>
              </div>

              <div className="mt-2 text-[11px] text-zinc-400">Author: {pr.author} — nada se adopta sin review (app y factory).</div>
            </article>
          ))}

          <section className="rounded-[12px] border border-zinc-100 bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-500">
            Los 3 newest Self-improvement PRs, sin importar date range. Improvement loop: Define Scorer → Collect baseline → Inspect failures → Benchmark candidate → Review and adopt → Keep monitoring. Principio: cambiar una cosa medible a la vez.
          </section>
        </div>
      </div>
    </div>
  );
}
