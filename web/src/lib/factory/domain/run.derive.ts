// run.derive - pure derivation per WarpFactories.md §2 Run + §10 Runs
// SRP: derive runs from WorkItems via WorkItemEvent, no I/O, no store mutation
// DIP: consumes WorkItem[] abstraction, not concrete store

import type { WorkItem, WorkItemEvent } from "./workItem.types";
import type { Run, RunFilter } from "./run.types";

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function costForActor(actor: string, seed: string): number {
  // deterministic cost per actor + small hash variance (estimate, not billing §10 Cost per PR)
  const base: Record<string, number> = {
    foreman: 0.03,
    triage: 0.07,
    spec: 0.09,
    implement: 0.18,
    review: 0.05,
    human: 0.0,
    system: 0.01,
  };
  const b = base[actor] ?? 0.04;
  const variance = (hashString(seed) % 100) / 1000; // 0..0.099
  const cost = Math.round((b + variance) * 100) / 100;
  return cost;
}

function durationForEvent(index: number, seed: string): number {
  // mock duration: 40s .. 320s deterministic
  const d = 40000 + (hashString(seed + String(index)) % 280000);
  return d;
}

function isOrchestrator(actor: string): boolean {
  const v = actor === "foreman";
  return v;
}

function buildChildRuns(parent: Run): readonly Run[] {
  if (!parent.isOrchestrator) {
    return [];
  }
  // mock 1-2 child runs for orchestrator (triage/spec/implement) deterministic
  const h = hashString(parent.id);
  const count = (h % 2) + 1; // 1 or 2
  const childActors: string[] = ["triage", "implement", "review", "spec"];
  const children: Run[] = [];
  for (let i = 0; i < count; i++) {
    const actor = childActors[(h + i) % childActors.length] as Run["actor"];
    const cid = `${parent.id}_child_${i}`;
    const child: Run = {
      id: cid,
      workItemId: parent.workItemId,
      workItemTitle: parent.workItemTitle,
      factoryName: parent.factoryName,
      source: parent.source,
      from: parent.from,
      to: parent.to,
      actor: actor as never,
      at: parent.at,
      reason: `sub-agent ${actor} for ${parent.id}`,
      metadata: { parentRunId: parent.id, mock: true },
      cost: costForActor(actor, cid),
      durationMs: Math.round(parent.durationMs / (count + 1)),
      isOrchestrator: false,
      childRuns: [],
      event: parent.event,
    };
    children.push(child);
  }
  return children;
}

export function deriveRunFromEvent(event: WorkItemEvent, workItem: WorkItem, index: number): Run {
  const cost = workItem.cost !== undefined ? Math.round((workItem.cost / workItem.history.length) * 100) / 100 : costForActor(event.actor, event.id);
  const durationMs = durationForEvent(index, event.id);
  const orchestrator = isOrchestrator(event.actor);
  const base: Run = {
    id: event.id,
    workItemId: workItem.id,
    workItemTitle: workItem.title,
    factoryName: workItem.factoryName,
    source: workItem.source,
    from: event.from,
    to: event.to,
    actor: event.actor,
    at: event.at,
    reason: event.reason,
    metadata: event.metadata,
    cost,
    durationMs,
    isOrchestrator: orchestrator,
    childRuns: [],
    event,
  };
  const childRuns = buildChildRuns(base);
  const run: Run = { ...base, childRuns };
  return run;
}

export function deriveRuns(workItems: readonly WorkItem[]): Run[] {
  const runs: Run[] = [];
  for (const wi of workItems) {
    for (let i = 0; i < wi.history.length; i++) {
      const ev = wi.history[i];
      const run = deriveRunFromEvent(ev, wi, i);
      runs.push(run);
    }
  }
  // timeline orden: sort by at asc, stable by id
  runs.sort((a, b) => {
    const d = a.at.localeCompare(b.at);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
  return runs;
}

export function deriveRunsForWorkItem(workItem: WorkItem): Run[] {
  const runs = workItem.history.map((ev, idx) => deriveRunFromEvent(ev, workItem, idx));
  runs.sort((a, b) => a.at.localeCompare(b.at));
  return runs;
}

export function filterRuns(runs: readonly Run[], filter: RunFilter = {}): Run[] {
  let out = [...runs];
  if (filter.factoryName) {
    out = out.filter((r) => r.factoryName === filter.factoryName);
  }
  if (filter.actor) {
    out = out.filter((r) => r.actor === filter.actor);
  }
  if (filter.workItemId) {
    out = out.filter((r) => r.workItemId === filter.workItemId);
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    out = out.filter((r) => r.workItemTitle.toLowerCase().includes(q) || r.actor.toLowerCase().includes(q) || `${r.from}->${r.to}`.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  }
  return out;
}

export function getTeamRuns(runs: readonly Run[]): Run[] {
  // team-level: todos los runs accesibles (sin filtro)
  return [...runs];
}

export function getFactoryRuns(runs: readonly Run[], factoryName: string): Run[] {
  return filterRuns(runs, { factoryName });
}

export function groupRunsByWorkItem(runs: readonly Run[]): Map<string, Run[]> {
  const map = new Map<string, Run[]>();
  for (const r of runs) {
    const arr = map.get(r.workItemId) ?? [];
    arr.push(r);
    map.set(r.workItemId, arr);
  }
  // ensure each group sorted by timeline
  for (const arr of map.values()) {
    arr.sort((a, b) => a.at.localeCompare(b.at));
  }
  return map;
}

export function totalCost(runs: readonly Run[]): number {
  const sum = runs.reduce((acc, r) => acc + r.cost, 0);
  const rounded = Math.round(sum * 100) / 100;
  return rounded;
}

export function timelineForWorkItem(workItem: WorkItem): Run[] {
  return deriveRunsForWorkItem(workItem);
}

export function getRunById(runs: readonly Run[], id: string): Run | undefined {
  return runs.find((r) => r.id === id);
}
