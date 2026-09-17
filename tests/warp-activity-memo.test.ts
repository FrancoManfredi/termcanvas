/**
 * warp-activity-memo — perf Ola 2 (Activity list re-render storm).
 *
 * Root cause: every 2.5s poll rebuilds all N `Issue` objects and
 * `ActivityPanel` re-rendered all N rows — `IssueCard`/`KanbanColumn` are
 * plain functions (Kanban already had the B1 `memo+isSame*` guard), and the
 * per-row `onSelect={() => onSelect(id)}` closures were unstable so even a
 * memo could never bail. On top, the mount effect fired ONE forced
 * `requestPrLookup` per visible row (N IPC/GitHub lookups at once).
 *
 * Fix (2 files):
 * - `ActivityPanel.tsx`: `IssueCard` is `memo` behind
 *   `isSameActivityCardProps` (rendered fields only), id-based stable
 *   `onSelect` (`handleSelect` via `useCallback`), no more inline
 *   per-row closures.
 * - `useActivity.ts`: `shouldForcePrLookupOnMount` burst gate — done rows
 *   and settled caches skip the forced mount lookup; only uncached
 *   non-done rows force. Explicit `refresh()` still forces everything.
 * Offline: pure, zero network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  activityFactoryStageText,
  declaredHookAgentsByLane,
  factoryEngineStageText,
  humanizeAgentName,
  isDiscardableSection,
  isSameActivityCardProps,
  parseGateMessage,
  parseMermaidFlowchart,
  splitGateBodySegments,
  type ActivityCardProps,
} from "../src/features/warpPanel/components/ActivityPanel.tsx";
import { shouldForcePrLookupOnMount, splitBatches } from "../src/features/warpPanel/hooks/useActivity.ts";
import type { Issue } from "../src/features/warpPanel/types.ts";

function row(overrides: Record<string, unknown> = {}): Issue {
  return {
    id: 7,
    title: "Fix the freeze",
    status: "in-progress",
    phase: "implementing",
    awaitingAction: null,
    prNumber: null,
    branch: "issue-7",
    conflicted: false,
    labels: ["bug"],
    factory: { stage: "building", stageLabel: "Building" },
    ...overrides,
  } as unknown as Issue;
}

const stableSelect = (_id: number): void => {};

function props(overrides: Partial<ActivityCardProps> = {}): ActivityCardProps {
  return { issue: row(), selected: false, onSelect: stableSelect, ...overrides };
}

test("rebuilt-but-identical rows bail out (the poll case)", () => {
  assert.equal(isSameActivityCardProps(props(), props({ issue: row() })), true);
});

test("rendered content changes re-render", () => {
  assert.equal(
    isSameActivityCardProps(props(), props({ issue: row({ title: "New" }) })),
    false,
  );
  assert.equal(
    isSameActivityCardProps(props(), props({ issue: row({ status: "done" }) })),
    false,
  );
  assert.equal(
    isSameActivityCardProps(
      props(),
      props({ issue: row({ awaitingAction: "merge-ready" }) }),
    ),
    false,
  );
  assert.equal(
    isSameActivityCardProps(props(), props({ issue: row({ prNumber: 61 }) })),
    false,
  );
  assert.equal(
    isSameActivityCardProps(props(), props({ issue: row({ branch: "x" }) })),
    false,
  );
  assert.equal(
    isSameActivityCardProps(
      props(),
      props({ issue: row({ labels: ["other"] }) }),
    ),
    false,
  );
  assert.equal(
    isSameActivityCardProps(
      props(),
      props({
        issue: row({ factory: { stage: "review", stageLabel: "Review" } }),
      }),
    ),
    false,
  );
  assert.equal(
    isSameActivityCardProps(
      props(),
      props({
        issue: row({
          factory: {
            stage: "building",
            stageLabel: "Building",
            engineRun: {
              runId: "r",
              workflow: "w",
              status: "running",
              currentNodeId: "build.review",
            },
          },
        }),
      }),
    ),
    false,
    "cambio de nodo del engine re-renderiza",
  );
  assert.equal(
    isSameActivityCardProps(props(), props({ selected: true })),
    false,
  );
});

test("unstable callbacks re-render (parent must keep them stable)", () => {
  assert.equal(
    isSameActivityCardProps(
      props(),
      props({ onSelect: (_id: number): void => {} }),
    ),
    false,
  );
});

test("junk never throws", () => {
  assert.equal(
    isSameActivityCardProps(
      props(),
      { ...props(), issue: null as unknown as Issue },
    ),
    false,
  );
});

test("activityFactoryStageText prefers stageLabel, falls back to stage", () => {
  assert.equal(
    activityFactoryStageText(row()),
    "Building",
  );
  assert.equal(
    activityFactoryStageText(row({ factory: { stage: "review" } })),
    "review",
  );
  assert.equal(activityFactoryStageText(row({ factory: null })), null);
  assert.equal(activityFactoryStageText(row({})), "Building");
  assert.equal(
    activityFactoryStageText({} as unknown as Issue),
    null,
  );
});

test("activityFactoryStageText: el nodo EXACTO del engine manda sobre el legacy", () => {
  const withRun = row({
    factory: {
      stage: "building",
      stageLabel: "Building",
      engineRun: {
        runId: "run-1",
        workflow: "fix-issue",
        status: "running",
        currentNodeId: "build.review",
      },
    },
  });
  assert.equal(activityFactoryStageText(withRun), "review", "nodo namespaced → leaf");
  const withGate = row({
    factory: {
      stage: "building",
      stageLabel: "Building",
      engineGateNodeId: "build.verify",
      engineRun: { runId: "run-1", workflow: "fix-issue", status: "running" },
    },
  });
  assert.equal(activityFactoryStageText(withGate), "verify", "gate pendiente manda");
  assert.equal(
    activityFactoryStageText(
      row({
        factory: {
          stageLabel: "Review",
          engineRun: { runId: "r", workflow: "w", status: "running" },
        },
      }),
    ),
    "Review",
    "sin nodo actual cae al stageLabel del daemon",
  );
  assert.equal(
    factoryEngineStageText({ engineRun: "junk" }),
    null,
    "junk honesto",
  );
  assert.equal(
    factoryEngineStageText({ engineRun: { currentNodeId: "build.implement" } }),
    "implement",
  );
});

test("parseGateMessage: separa prosa + summary/steps del JSON embebido", () => {
  const parts = parseGateMessage(
    'Aprobar el plan y continuar?\n\n{"summary":"Evitar pérdida","steps":["Uno","Dos"]}',
  );
  assert.equal(parts.text, "Aprobar el plan y continuar?");
  assert.equal(parts.summary, "Evitar pérdida");
  assert.deepEqual(parts.steps, ["Uno", "Dos"]);

  assert.deepEqual(parseGateMessage("Aprobar la spec"), {
    text: "Aprobar la spec",
    summary: null,
    steps: [],
  });
  assert.deepEqual(parseGateMessage(null), { text: "", summary: null, steps: [] });
  assert.equal(parseGateMessage("{ no json }").text, "{ no json }", "JSON roto → crudo");
  assert.equal(
    parseGateMessage('X {"foo":1}').text,
    'X {"foo":1}',
    "JSON sin summary/steps → crudo",
  );
  const braceText = parseGateMessage('Usar {llaves} y luego {"summary":"s","steps":["p"]}');
  assert.equal(braceText.summary, "s", "llaves en la prosa no bloquean el payload real");
  assert.equal(braceText.steps.length, 1);
});

test("humanizeAgentName: slug → nombre visible (Title Case), junk a ''", () => {
  assert.equal(humanizeAgentName("playwright-tester"), "Playwright Tester");
  assert.equal(humanizeAgentName("qa_probe"), "Qa Probe");
  assert.equal(humanizeAgentName("gate"), "Gate");
  assert.equal(humanizeAgentName("  doble--guion  "), "Doble Guion");
  assert.equal(humanizeAgentName(""), "");
  assert.equal(humanizeAgentName(null), "");
  assert.equal(humanizeAgentName(42), "");
});

test("declaredHookAgentsByLane: roster por lane, stage real y fallback legacy", () => {
  const byLane = declaredHookAgentsByLane({
    hookAgents: [
      { name: "playwright-tester", stage: "post-review", blocking: false },
      { name: "qa-probe", stage: "pre-build", blocking: true },
      { name: "roto", stage: "no-existe" },
      "junk",
      { name: "", stage: "post-review" },
    ],
  });
  assert.deepEqual(byLane.Complete?.map((a) => a.label), ["Playwright Tester"]);
  assert.equal(byLane.Complete?.[0]?.blocking, false);
  assert.deepEqual(byLane.Building?.map((a) => a.label), ["Qa Probe"]);
  assert.equal(byLane.Building?.[0]?.blocking, true);
  assert.equal(byLane.Review, undefined, "stage desconocido fuera");
  // Fallback legacy: payload sin hookAgents, solo hookStages.
  const legacy = declaredHookAgentsByLane({ hookStages: ["post-review"] });
  assert.deepEqual(legacy.Complete?.map((a) => a.label), ["Post Review"]);
  assert.deepEqual(declaredHookAgentsByLane(null), {});
  assert.deepEqual(declaredHookAgentsByLane("junk"), {});
});

test("mount burst gate: only uncached non-done rows force", () => {
  assert.equal(shouldForcePrLookupOnMount(undefined, "pending"), true);
  assert.equal(shouldForcePrLookupOnMount(null, "in-progress"), true);
  assert.equal(
    shouldForcePrLookupOnMount({ number: 61 }, "in-progress"),
    false,
  );
  assert.equal(shouldForcePrLookupOnMount(undefined, "done"), false);
  assert.equal(shouldForcePrLookupOnMount({ number: 61 }, "done"), false);
  assert.equal(shouldForcePrLookupOnMount("loading", "pending"), false);
});

test("splitBatches chunks mount lookups without losing rows", () => {
  assert.deepEqual(splitBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(splitBatches([], 12), []);
  assert.deepEqual(splitBatches([1, 2], 12), [[1, 2]]);
  assert.deepEqual(splitBatches(null as never, 12), []);
  assert.deepEqual(splitBatches([1, 2, 3], 0), [[1, 2, 3]]);
});

test("onDiscardRequest estabilidad: ref estable baila, closure nuevo re-renderiza", () => {
  const stableMenu = (_issue: Issue, _x: number, _y: number): void => {};
  assert.equal(
    isSameActivityCardProps(
      props({ onDiscardRequest: stableMenu }),
      props({ onDiscardRequest: stableMenu }),
    ),
    true,
  );
  assert.equal(
    isSameActivityCardProps(
      props({ onDiscardRequest: stableMenu }),
      props({ onDiscardRequest: (_issue: Issue, _x: number, _y: number): void => {} }),
    ),
    false,
  );
});

test("splitGateBodySegments: markdown + mermaid cercado y sin cercar", () => {
  const fenced = splitGateBodySegments(
    "**Objetivo:** envolver\n\n```mermaid\nflowchart LR\n  A[x] --> B[y]\n```\n\ncola",
  );
  assert.deepEqual(
    fenced.map((s) => s.type),
    ["markdown", "mermaid", "markdown"],
  );
  assert.match(
    (fenced[1] as { code: string }).code,
    /flowchart LR/,
    "el cercado conserva el código",
  );
  const bare = splitGateBodySegments(
    "## Spec\n\nflowchart LR\n  subgraph Before\n    B1[a] --> B2[b]\n  end\n\nfin",
  );
  assert.deepEqual(
    bare.map((s) => s.type),
    ["markdown", "mermaid", "markdown"],
  );
  assert.deepEqual(splitGateBodySegments("**solo** markdown"), [
    { type: "markdown", text: "**solo** markdown" },
  ]);
  assert.deepEqual(splitGateBodySegments(""), []);
  assert.deepEqual(splitGateBodySegments(null), []);
  assert.deepEqual(splitGateBodySegments(42), []);
});

test("parseMermaidFlowchart: subgraphs Before/After del spec #124", () => {
  const chart = parseMermaidFlowchart(
    "flowchart LR\n" +
      "  subgraph Before\n" +
      "    B1[localStorage corrupto] --> B2[JSON.parse lanza] --> B3[app rota]\n" +
      "  end\n" +
      "  subgraph After\n" +
      "    A1[localStorage corrupto] --> A2[try/catch<br/>return []] --> A3[render vacío]\n" +
      "  end",
  );
  assert.ok(chart, "parsea el diagrama del spec");
  assert.equal(chart?.horizontal, true);
  assert.deepEqual(chart?.groups, ["Before", "After"]);
  assert.equal(chart?.nodes.length, 6);
  assert.equal(chart?.edges.length, 4);
  const a2 = chart?.nodes.find((n) => n.id === "A2");
  assert.deepEqual(a2?.lines, ["try/catch", "return []"], "<br/> parte líneas");
  assert.equal(a2?.group, "After");
  assert.equal(parseMermaidFlowchart("sequenceDiagram\n  A->>B: hola"), null, "no-flowchart → fallback");
  assert.equal(parseMermaidFlowchart("flowchart LR\n  solo texto"), null, "sin nodos → fallback");
  assert.equal(parseMermaidFlowchart(null), null);
  assert.equal(parseMermaidFlowchart(42), null);
});

test("isDiscardableSection: In Progress / Awaiting / Ready solamente", () => {
  assert.equal(isDiscardableSection("in-progress"), true);
  assert.equal(isDiscardableSection("awaiting"), true);
  assert.equal(isDiscardableSection("ready"), true);
  assert.equal(isDiscardableSection("pending"), false);
  assert.equal(isDiscardableSection("done"), false);
  assert.equal(isDiscardableSection(null), false);
  assert.equal(isDiscardableSection("junk"), false);
});
