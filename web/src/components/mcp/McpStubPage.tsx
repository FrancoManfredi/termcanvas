// McpStubPage — Factory MCP stub 19 tools mock sobre WorkItemStore real
// SRP: solo renderiza, lógica en FactoryMcpStub (DIP inyecta store/bundle)
import { useMemo, useState } from "react";
import { FactoryMcpStub, MCP_ENDPOINT } from "../../lib/factory/mcp/mcp.stub";
import { getFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import { useWorkItemStore } from "../../lib/factory/store/workItemStore.context";
import type { WorkItemStage } from "../../lib/factory/domain/workItem.types";

export function McpStubPage() {
  const bundleRes = useMemo(() => getFactoryBundle(), []);
  const bundle = bundleRes.ok ? bundleRes.value! : null;
  // Shared app store (DIP): the stub now operates on the same work items as Activity / Runs.
  // No seeding here on purpose — injecting demo tasks would pollute the real boards.
  const store = useWorkItemStore();
  const stub = useMemo(() => new FactoryMcpStub(store, bundle), [store, bundle]);

  const toolDefs = useMemo(() => stub.getToolDefs(), [stub]);
  const [listFilter, setListFilter] = useState<{ creator: string; stage: string; search: string }>({ creator: "", stage: "", search: "" });
  const [listResult, setListResult] = useState<string>("");
  const [getId, setGetId] = useState("");
  const [getStartWorking, setGetStartWorking] = useState(true);
  const [getResult, setGetResult] = useState<string>("");
  const [sendForm, setSendForm] = useState({ factoryName: bundle?.factory.name ?? "payments-factory", title: "", note: "", taskId: "", branchOrPrUrl: "", notificationRoute: "" });
  const [sendResult, setSendResult] = useState<string>("");

  function handleListTasks() {
    const res = stub.list_tasks({
      creator: listFilter.creator || undefined,
      stage: (listFilter.stage || undefined) as WorkItemStage | undefined,
      search: listFilter.search || undefined,
    });
    setListResult(JSON.stringify(res.map((w) => ({ id: w.id, title: w.title, stage: w.stage, createdBy: w.createdBy })), null, 2));
  }

  function handleGetTask() {
    const res = stub.get_task(getId || stub.list_tasks()[0]?.id || "", { start_working: getStartWorking });
    setGetResult(JSON.stringify({ workItem: res.workItem ? { id: res.workItem.id, title: res.workItem.title, stage: res.workItem.stage } : null, dashboardUrl: res.dashboardUrl, worktreeGuidance: res.worktreeGuidance, warning: res.warning, runHistory: res.runHistory.slice(0, 2) }, null, 2));
  }

  function handleSendTask() {
    const res = stub.send_task({
      factoryName: sendForm.factoryName,
      title: sendForm.title,
      note: sendForm.note,
      taskId: sendForm.taskId || undefined,
      branchOrPrUrl: sendForm.branchOrPrUrl || undefined,
      notificationRoute: sendForm.notificationRoute || undefined,
    });
    setSendResult(JSON.stringify(res.ok ? { ok: true, workItem: { id: res.value!.id, title: res.value!.title, stage: res.value!.stage } } : { ok: false, issues: res.issues }, null, 2));
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-zinc-500">Team</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">MCPs and apps — Factory MCP stub</span>
          <span className="ml-2 hidden text-[11px] text-zinc-400 sm:inline">19 tools mock sobre WorkItemStore real — sin scopes per-factory, no claim/lock, best-effort notifications</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px] space-y-4">
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">Factory MCP — 19 tools</h3>
                <p className="mt-1 text-[12px] text-zinc-500">
                  Hosted MCP server <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">{MCP_ENDPOINT}</code> — streamable HTTP. Headless bearer <code className="font-mono text-[11px]">Authorization: Bearer YOUR_API_KEY</code>. Sin read-only ni per-factory scopes: full permissions del account. Guardar API keys en secret storage, nunca en repo.
                </p>
              </div>
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-600">{toolDefs.length} tools</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {toolDefs.map((t) => (
                <div key={t.name} className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                  <div className="font-mono text-[12px] font-medium text-zinc-800">{t.name}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{t.description}</div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-medium text-violet-600">input / output mock</summary>
                    <pre className="mt-1 max-h-[160px] overflow-auto rounded bg-white p-2 font-mono text-[11px] text-zinc-700 border">{JSON.stringify({ inputSchema: t.inputSchema, outputExample: t.outputExample }, null, 2)}</pre>
                  </details>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
              <span className="font-medium">Notas stub:</span> mismo WorkItemStore real, no scopes per-factory, pickup no claimea/lockea/pausa (factory puede seguir corriendo), notifications best-effort, preparado para conectar a endpoint real.
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
              <h4 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Probar list_tasks</h4>
              <p className="mt-1 text-[11px] text-zinc-500">Filtros Warp §12: creator, stage, date, search</p>
              <div className="mt-3 space-y-2">
                <input value={listFilter.creator} onChange={(e) => setListFilter((s) => ({ ...s, creator: e.target.value }))} placeholder="creator (ej. mcp-agent)" className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px] placeholder:text-zinc-400" />
                <select value={listFilter.stage} onChange={(e) => setListFilter((s) => ({ ...s, stage: e.target.value }))} className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]">
                  <option value="">stage — cualquiera</option>
                  <option value="Triage">Triage</option>
                  <option value="Planning">Planning</option>
                  <option value="Building">Building</option>
                  <option value="Reviewing">Reviewing</option>
                  <option value="Complete">Complete</option>
                </select>
                <input value={listFilter.search} onChange={(e) => setListFilter((s) => ({ ...s, search: e.target.value }))} placeholder="search title/desc (ej. checkout)" className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px] placeholder:text-zinc-400" />
                <button onClick={handleListTasks} className="w-full rounded-[8px] bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800">Run list_tasks</button>
                <pre className="max-h-[200px] overflow-auto rounded-[8px] border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-700">{listResult || "—"}</pre>
              </div>
            </section>

            <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
              <h4 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Probar get_task</h4>
              <p className="mt-1 text-[11px] text-zinc-500">Acepta ID o reference (URL, PR, branch). Con start_working=true retorna worktree guidance</p>
              <div className="mt-3 space-y-2">
                <input value={getId} onChange={(e) => setGetId(e.target.value)} placeholder="id o reference (dejá vacío para primero)" className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px] placeholder:text-zinc-400" />
                <label className="flex items-center gap-2 text-[12px] text-zinc-600">
                  <input type="checkbox" checked={getStartWorking} onChange={(e) => setGetStartWorking(e.target.checked)} className="rounded" />
                  start_working=true — worktree guidance (MCP nunca modifica files)
                </label>
                <button onClick={handleGetTask} className="w-full rounded-[8px] bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800">Run get_task</button>
                <pre className="max-h-[240px] overflow-auto rounded-[8px] border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-700 whitespace-pre-wrap">{getResult || "—"}</pre>
              </div>
            </section>

            <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
              <h4 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Probar send_task</h4>
              <p className="mt-1 text-[11px] text-zinc-500">Crea new task o hand-back si taskId. Usa list_notification_routes para destino (best-effort)</p>
              <div className="mt-3 space-y-2">
                <input value={sendForm.factoryName} onChange={(e) => setSendForm((s) => ({ ...s, factoryName: e.target.value }))} placeholder="factoryName" className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]" />
                <input value={sendForm.title} onChange={(e) => setSendForm((s) => ({ ...s, title: e.target.value }))} placeholder="title (goal)" className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]" />
                <textarea value={sendForm.note} onChange={(e) => setSendForm((s) => ({ ...s, note: e.target.value }))} placeholder="note: goal + context + constraints + work done" rows={3} className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]" />
                <input value={sendForm.taskId} onChange={(e) => setSendForm((s) => ({ ...s, taskId: e.target.value }))} placeholder="taskId (hand-back, opcional)" className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]" />
                <input value={sendForm.branchOrPrUrl} onChange={(e) => setSendForm((s) => ({ ...s, branchOrPrUrl: e.target.value }))} placeholder="branch o PR URL (se linkea)" className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]" />
                <input value={sendForm.notificationRoute} onChange={(e) => setSendForm((s) => ({ ...s, notificationRoute: e.target.value }))} placeholder="notificationRoute (route_slack_dm)" className="w-full rounded-[8px] border border-zinc-200 px-2 py-1.5 text-[12px]" />
                <div className="flex gap-1.5">
                  {stub.list_notification_routes().map((r) => (
                    <button key={r.id} onClick={() => setSendForm((s) => ({ ...s, notificationRoute: r.id }))} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 hover:bg-white">{r.label}</button>
                  ))}
                </div>
                <button onClick={handleSendTask} className="w-full rounded-[8px] bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800">Run send_task</button>
                <pre className="max-h-[160px] overflow-auto rounded-[8px] border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-700">{sendResult || "—"}</pre>
              </div>
            </section>
          </div>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h4 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Onboarding tools (§12)</h4>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-violet-50 px-2 py-1 font-mono text-violet-700">list_teams → create_team → join_team → get_team_funding_status</span>
              <span className="rounded-full bg-zinc-50 px-2 py-1">→ list_forge_repositories → list_tracker_scopes → start_connection / get_connection_status → create_factory</span>
            </div>
            <div className="mt-2 text-[11px] text-zinc-500">Flujo: setup prompt canónico <code className="font-mono">Set up a factory for me. Read https://docs.warp.dev/factories/factory-mcp.md...</code> guia por team, code host, repos, factory agents e integrations y linkea dashboard.</div>
          </section>
        </div>
      </div>
    </div>
  );
}
