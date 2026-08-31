import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseFailedTests,
  isNodeTest,
  extractTestFiles,
  computeNewLines,
} from "../scripts/run-issue-gate.mjs";
import {
  watchIssuePrLabels,
  type IssueLabelWatcherDeps,
  type PrDecisionResult,
  type PrLookupResult,
} from "../src/canvas/issueLabelWatcher.ts";

// ─── parseFailedTests ─────────────────────────────────────────────────────

test("parseFailedTests: node:test TAP con nombre y archivo (basename)", () => {
  const names = parseFailedTests(
    [
      "not ok 101 - GitFileWatcher detects repository presence",
      "not ok 66 - C:\\repo\\tests\\session-watcher.test.ts",
    ].join("\n"),
  );
  assert.ok(names.has("GitFileWatcher detects repository presence"));
  // Los fallos a nivel de ARCHIVO reportan el path absoluto: se normaliza a
  // basename para que la comparación base/head sea estable (el base corre en
  // un worktree temporal con otra ruta).
  assert.ok(names.has("session-watcher.test.ts"));
  assert.equal(names.size, 2);
});

test("parseFailedTests: vitest con sufijo de duración", () => {
  const names = parseFailedTests("  × add > suma dos números 15ms\n");
  assert.deepEqual([...names], ["add > suma dos números"]);
});

test("parseFailedTests: sin fallos → vacío", () => {
  assert.equal(parseFailedTests("Tests 4 passed (4)\n").size, 0);
});

// ─── Detección de runner de tests ─────────────────────────────────────────

test("isNodeTest: detecta node --test y tsx --test", () => {
  assert.equal(isNodeTest("tsx --test tests/a.test.ts"), true);
  assert.equal(isNodeTest("node --test tests/a.test.ts"), true);
  assert.equal(isNodeTest("vitest run"), false);
  assert.equal(isNodeTest(undefined), false);
});

test("extractTestFiles: extrae los archivos tras --test", () => {
  assert.deepEqual(
    extractTestFiles("tsx --test tests/a.test.ts tests/b.test.ts"),
    ["tests/a.test.ts", "tests/b.test.ts"],
  );
  assert.deepEqual(extractTestFiles("vitest run"), []);
});

// ─── computeNewLines (con mini repo git real) ─────────────────────────────

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-newlines-"));
  const git = (cmd: string) =>
    execSync(cmd, { cwd: dir, stdio: "pipe" });
  git("git init -q");
  git("git config user.email test@test");
  git("git config user.name test");
  git("git checkout -q -b main");
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  git("git add -A");
  git("git commit -q -m base");
  git("git checkout -q -b feature");
  writeFileSync(
    path.join(dir, "src", "a.ts"),
    "export const a = 1;\nexport const b = 2;\n",
  );
  git("git add -A");
  git("git commit -q -m add-b");
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("computeNewLines: mapea solo las líneas nuevas por archivo", async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const newLines = await computeNewLines(
      { sourceFiles: ["src/a.ts"] },
      { repoPath: dir, base: "main", head: "HEAD" },
    );
    const lines = newLines.get("src/a.ts");
    assert.ok(lines, "debería mapear src/a.ts");
    // La línea 2 (export const b) es nueva; la línea 1 es preexistente.
    assert.ok(lines.has(2));
    assert.ok(!lines.has(1));
  } finally {
    cleanup();
  }
});

// ─── Label watcher: integración con el gate ───────────────────────────────

function prResult(
  pr: { number: number; state: string } | null,
): PrLookupResult {
  return { ok: true, pr };
}

function decisionResult(
  reviewDecision: PrDecisionResult["reviewDecision"],
  labels: string[],
): PrDecisionResult {
  return { ok: true, reviewDecision, labels };
}

interface ScriptedDeps {
  deps: IssueLabelWatcherDeps;
  findQueue: PrLookupResult[];
  decisionQueue: PrDecisionResult[];
  applied: Array<{ prNumber: number; label: string }>;
  live: { value: boolean };
}

function scriptedDeps(): ScriptedDeps {
  const state: ScriptedDeps = {
    deps: {
      findPrForIssue: async () => state.findQueue.shift() ?? prResult(null),
      getPrReviewDecision: async () =>
        state.decisionQueue.shift() ?? decisionResult(null, []),
      applyCycleLabel: async (_repoPath, prNumber, _issue, label) => {
        state.applied.push({ prNumber, label });
        return { ok: true };
      },
      isLive: () => state.live.value,
      notify: () => {},
    },
    findQueue: [],
    decisionQueue: [],
    applied: [],
    live: { value: true },
  };
  return state;
}

async function waitUntil(cond: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("label watcher: con runGate, PR nuevo dispara el gate y no materializa review:pendiente", async () => {
  const s = scriptedDeps();
  s.findQueue = [prResult({ number: 12, state: "OPEN" })];
  s.decisionQueue = [decisionResult("REVIEW_REQUIRED", [])];
  let gateCalls = 0;
  let lastGate: {
    repoPath: string;
    issueNumber: number;
    prNumber: number;
    headRefOid: string | null;
  } | null = null;
  s.deps.runGate = (options) => {
    gateCalls += 1;
    lastGate = options;
  };

  const stop = watchIssuePrLabels(s.deps, {
    repoPath: "C:/repo",
    issueNumber: 7,
    intervalMs: 5,
    timeoutMs: 2000,
  });
  try {
    await waitUntil(() => gateCalls > 0);
    assert.equal(gateCalls, 1, "el gate se dispara una sola vez por PR");
    assert.equal(lastGate?.prNumber, 12);
    assert.equal(lastGate?.issueNumber, 7);
    assert.equal(lastGate?.headRefOid, null);
    // El label NO se materializa: lo aplica runGateForIssue al terminar.
    assert.equal(s.applied.length, 0);
  } finally {
    stop();
  }
});

test("label watcher: converge (sin aplicar labels) cuando el PR lleva gate:fallo", async () => {
  const s = scriptedDeps();
  s.findQueue = [prResult({ number: 12, state: "OPEN" })];
  s.decisionQueue = [decisionResult(null, ["gate:fallo"])];

  const stop = watchIssuePrLabels(s.deps, {
    repoPath: "C:/repo",
    issueNumber: 7,
    intervalMs: 5,
    timeoutMs: 2000,
  });
  try {
    // El PR ya tiene gate:fallo: no es review:pendiente ni fix-aplicado; el
    // watcher no pisa el label y converge (gate:fallo está en la lista de
    // convergencia).
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(s.applied.length, 0);
  } finally {
    stop();
  }
});
