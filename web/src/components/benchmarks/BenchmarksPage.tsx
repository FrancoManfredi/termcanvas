// BenchmarksPage — compara harness/model/runner configs sobre mismo set de tasks
// Warp §11: 1 agent, N tasks+configs+repetitions, Scorers + Correctness built-in, no ganador, credit totals exclude model usage
import { useMemo, useState } from "react";
import { deriveBenchmark, mockBenchmarkDefinition, mockBenchmarkTrials, createTaskFromRun } from "../../lib/factory/domain/benchmark.derive";
import { CREDIT_DISCLAIMER } from "../../lib/factory/domain/benchmark.types";

export function BenchmarksPage() {
  const definition = useMemo(() => mockBenchmarkDefinition(), []);
  const trials = useMemo(() => mockBenchmarkTrials(definition), [definition]);
  const derived = useMemo(() => deriveBenchmark(definition, trials), [definition, trials]);
  const [newTaskPrompt, setNewTaskPrompt] = useState("Add Local development section to README.md...");
  const [newTaskCriteria, setNewTaskCriteria] = useState("README has section, single file, lint passes");
  const [createdTask, setCreatedTask] = useState<string>("");

  function handleCreateTask() {
    const t = createTaskFromRun({ prompt: newTaskPrompt, successCriteria: newTaskCriteria });
    setCreatedTask(JSON.stringify(t, null, 2));
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-zinc-500">Factory</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Benchmarks</span>
          <span className="ml-2 hidden text-[11px] text-zinc-400 sm:inline">1 agent · {definition.tasks.length} tasks · {definition.configs.length} configs · {definition.repetitions} repetitions · Correctness + Scorers</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px] space-y-4">
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">{definition.name}</h3>
                <p className="mt-1 text-[11px] text-zinc-500">Agent: <span className="font-mono font-medium text-zinc-700">{definition.agent}</span> · Scorers: {definition.scorerNames.join(", ")} · Repetitions per task+config: {definition.repetitions}</p>
              </div>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 border border-amber-200">{CREDIT_DISCLAIMER}</span>
            </div>
            <div className="mt-2 text-[11px] text-zinc-400">Warp <span className="font-medium">no combina signals en un solo score ni elige ganador</span>; el humano pondera y decide. Cada benchmark corre <span className="font-medium">Correctness</span> built-in (pass/fail vs success criteria) además de Scorers configurados.</div>
          </section>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h4 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Comparación de configs — pass rates, cost, quality por config</h4>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                    <th className="pb-2 pr-3">Config (harness / model / runner)</th>
                    <th className="pb-2 pr-3">Trials</th>
                    <th className="pb-2 pr-3">Correctness pass rate</th>
                    <th className="pb-2 pr-3">Avg cost (credits)</th>
                    <th className="pb-2">Avg quality (scorers)</th>
                  </tr>
                </thead>
                <tbody>
                  {derived.configResults.map((cr) => (
                    <tr key={cr.configId} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-zinc-900">{cr.label}</div>
                        <div className="font-mono text-[11px] text-zinc-500">{cr.harness} · {cr.model} · {cr.runner}</div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-zinc-700">{cr.totalTrials}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cr.correctnessPassRate >= 0.6 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{Math.round(cr.correctnessPassRate * 100)}%</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-zinc-700">{cr.avgCostCredits.toFixed(1)}</td>
                      <td className="py-2 tabular-nums text-zinc-700">{cr.avgQuality !== null ? `${Math.round(cr.avgQuality * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] text-zinc-400">Credit totals no incluyen model usage → costo real mayor (§11). Ordenado por Correctness desc, luego cost asc — informativo, no winner.</div>
          </section>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h4 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Per-task detail</h4>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12px]">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                    <th className="pb-2 pr-3">Task</th>
                    {derived.configResults.map((cr) => (
                      <th key={cr.configId} className="pb-2 pr-3">{cr.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {definition.tasks.map((t) => (
                    <tr key={t.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-zinc-800">{t.prompt.slice(0, 60)}…</div>
                        <div className="text-[11px] text-zinc-500">success: {t.successCriteria.slice(0, 60)}…</div>
                      </td>
                      {derived.configResults.map((cr) => (
                        <td key={cr.configId} className="py-2 pr-3 tabular-nums">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cr.perTaskPass[t.id] >= 0.6 ? "bg-emerald-50 text-emerald-700" : cr.perTaskPass[t.id] === 0 ? "bg-zinc-100 text-zinc-500" : "bg-amber-50 text-amber-700"}`}>{Math.round((cr.perTaskPass[t.id] ?? 0) * 100)}%</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h4 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Create task from run detail pane (§11)</h4>
            <p className="mt-1 text-[11px] text-zinc-500">Copia el input de un completed run; agregá success criteria antes de launch.</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={newTaskPrompt} onChange={(e) => setNewTaskPrompt(e.target.value)} placeholder="prompt copied from run" className="rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]" />
              <input value={newTaskCriteria} onChange={(e) => setNewTaskCriteria(e.target.value)} placeholder="success criteria (agregar antes de launch)" className="rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]" />
            </div>
            <button onClick={handleCreateTask} className="mt-2 rounded-[8px] bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800">Create benchmark task</button>
            {createdTask && <pre className="mt-2 max-h-[160px] overflow-auto rounded-[8px] border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-700">{createdTask}</pre>}
          </section>

          <section className="rounded-[12px] border border-zinc-100 bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-500">
            Benchmark: 1 agent fijo · fixed tasks · harness/model/runner combos · Scorers + Correctness · repetitions para confianza. Resultados con per-task detail; Warp no elige ganador — humano pondera cost vs quality.
          </section>
        </div>
      </div>
    </div>
  );
}
