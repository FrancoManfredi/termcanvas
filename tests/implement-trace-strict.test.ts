/**
 * Implement traceability — flujo simple (sin reintentos).
 *
 * Every consume() hace UN solo turno LLM y emite un trace event explícito
 * (what happened + why + model excerpt capped at IMPLEMENT_MODEL_SNIPPET_MAX
 * chars) que el service espeja al timeline. Prosa sin tool writes, vacío o
 * error → lista vacía y el job queda parado en Building (sin second pass,
 * sin patch-apply ni fallback fantasma). H-001/H-012 intact, pacts untouched.
 *
 * Fully offline: tmp worktrees, injected model seams, zero network, zero
 * daemon, zero jobs. Explicit timeouts throughout.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  IMPLEMENT_MODEL_SNIPPET_MAX,
} from "../shared/types/implement.ts";
import {
  buildImplementPrompt,
} from "../headless-runtime/implement/implementPrompt.ts";
import {
  extractFirstCodeBlock,
  fallbackRefusalReason,
  hasModifyIntent,
  listPromptFileTokens,
  truncateModelSnippet,
  tryApplyTextAsPatch,
  tryBoundedFallback,
} from "../headless-runtime/implement/minimalChange.ts";
import {
  ImplementAgent,
  implementAgent,
  type ImplementAgentSeams,
} from "../headless-runtime/implement/implementAgent.ts";
import { verificationService } from "../headless-runtime/implement/verification.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { implementService } from "../headless-runtime/implement/implementService.ts";
import { runnerExecutor } from "../headless-runtime/runner/runnerExecutor.ts";

const TEST_TIMEOUT_MS = 30_000;

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "impl-trace-"));
}

function rmRf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

/** Tmp worktree that reads as a repo (package.json, no .git needed). */
function makeRepoTmp(): string {
  const wt = makeTmp();
  fs.writeFileSync(path.join(wt, "package.json"), '{"name":"trace-fixture"}\n', "utf-8");
  return wt;
}

/**
 * Backdate a fixture file so the mtime baseline treats it as pre-existing
 * (fresh writes would read as model-made changes).
 */
function backdate(filePath: string): void {
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(filePath, old, old);
}

function branchesOf(out: { trace?: Array<{ branch: string }> }): string[] {
  return (out.trace ?? []).map((e) => e.branch);
}

// ── Bounds ──

test("snippet bound is explicit (flujo simple, sin L12)", { timeout: TEST_TIMEOUT_MS }, () => {
  assert.equal(IMPLEMENT_MODEL_SNIPPET_MAX, 200);
});

test("truncateModelSnippet caps excerpts at 200 chars", { timeout: TEST_TIMEOUT_MS }, () => {
  assert.equal(truncateModelSnippet(""), "");
  assert.equal(truncateModelSnippet("  hello   world  "), "hello world");
  const long = `x${"y".repeat(500)}`;
  assert.equal(truncateModelSnippet(long).length, 200);
  assert.equal(truncateModelSnippet(null), "");
});

// ── Strict prompt ──

test("turno único: issue flaco, sin doctrina (contrato en el espejo)", { timeout: TEST_TIMEOUT_MS }, () => {
  const out = buildImplementPrompt({ prompt: "fix auth bug", worktreePath: "/tmp/wt" } as never);
  assert.ok(out.includes("fix auth bug"), "el issue viaja");
  assert.ok(!out.includes("/tmp/wt"), "turno flaco: sin worktree (es el directory de la sesión)");
  assert.ok(!out.includes("Make the minimal change now with tools"), "turno flaco: sin cierre en el turno");
  assert.ok(!out.includes('"files"'), "el contrato JSON vive en el espejo, no en el turno");
  assert.ok(!out.includes("factory/agents/implement/agent.md"), "sin header");
  assert.ok(!out.includes("CAMBIO MÍNIMO"), "sin doctrina (vive en el espejo)");
  assert.ok(!out.includes("Strict executor rules"), "sin reglas");
  assert.ok(!out.includes("Suggested steps"), "sin pasos");
  assert.ok(!out.includes("ModelRef:"), "sin modelRef");
});

test("turno flaco retira el boilerplate SCOPE canónico", { timeout: TEST_TIMEOUT_MS }, () => {
  const out = buildImplementPrompt({
    prompt: "fix auth bug\n\nImplement only what this issue asks for. Do not add features outside its scope and do not skip its no-goals.",
    worktreePath: "/tmp/wt",
  } as never);
  assert.ok(out.includes("fix auth bug"), "el issue viaja");
  assert.ok(!out.includes("Implement only what this issue asks for"), "sin boilerplate scope");
});

test("flujo simple: el turno base no trae STRICT SECOND PASS", { timeout: TEST_TIMEOUT_MS }, () => {
  const out = buildImplementPrompt({ prompt: "fix auth bug", worktreePath: "/tmp/wt" } as never);
  assert.ok(out.includes("fix auth bug"), "el issue viaja");
  assert.ok(!out.includes("STRICT SECOND PASS"), "sin second pass");
  assert.ok(!out.includes("ZERO tool writes"), "sin acusación de retry");
});

// ── Modify intent + refusal ──

test("hasModifyIntent needs a verb plus a file token (prefix/suffix never count)", { timeout: TEST_TIMEOUT_MS }, () => {
  assert.equal(hasModifyIntent("Fix the bug in src/app.ts"), true);
  assert.equal(hasModifyIntent("Edit src/app.ts to handle null"), true);
  assert.equal(hasModifyIntent("Update docs/nota.md with the new steps"), true);
  assert.equal(hasModifyIntent("hotfix"), false);
  assert.equal(hasModifyIntent("crear un prefix.md con contenido"), false);
  assert.equal(hasModifyIntent("agregar un suffix para el reporte"), false);
  assert.equal(hasModifyIntent("cual es el estado del repo"), false);
  assert.equal(hasModifyIntent(""), false);
});

test("fallbackRefusalReason fires only for modify requests without an exact parse", { timeout: TEST_TIMEOUT_MS }, () => {
  const reason = fallbackRefusalReason("Fix the bug in src/app.ts");
  assert.ok(typeof reason === "string" && reason.length > 0);
  assert.match(reason, /ghost doc/);
  assert.equal(fallbackRefusalReason("crear carepta Zeta en raiz"), null);
  assert.equal(fallbackRefusalReason("crear un docs/demo-feature.md con contenido"), null);
  assert.equal(fallbackRefusalReason("cual es el estado del repo"), null);
});

test("tryBoundedFallback refuses modify requests with zero disk writes", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeRepoTmp();
  try {
    const res = tryBoundedFallback({ id: "job-trace-mod01", prompt: "Fix the bug in src/app.ts", worktree: wt });
    assert.deepEqual(res.files, []);
    assert.ok(typeof res.refused === "string" && res.refused.length > 0);
    assert.equal(fs.existsSync(path.join(wt, "docs", "implement-ola3-job-trace-mod01.md")), false);
  } finally {
    rmRf(wt);
  }
});

test("tryBoundedFallback keeps exact creates and the ambiguous marker", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeRepoTmp();
  try {
    const folder = tryBoundedFallback({ id: "job-trace-ex01", prompt: "crear carepta Zeta en raiz", worktree: wt });
    assert.deepEqual(folder.files, ["Zeta"]);
    assert.equal(folder.refused, null);
    const vague = tryBoundedFallback({ id: "job-trace-ex02", prompt: "hacer algo util", worktree: wt });
    assert.deepEqual(vague.files, ["docs/implement-ola3-job-trace-ex02.md"]);
    assert.equal(vague.refused, null);
  } finally {
    rmRf(wt);
  }
});

// ── Patch apply ──

test("extractFirstCodeBlock takes fenced code only, prose is not applicable", { timeout: TEST_TIMEOUT_MS }, () => {
  assert.equal(extractFirstCodeBlock("just prose, no block"), null);
  assert.equal(extractFirstCodeBlock("```\n"), null);
  assert.equal(
    extractFirstCodeBlock('Here is the fix:\n```ts\nconst a = 1;\n```\nDone.'),
    "const a = 1;",
  );
});

test("listPromptFileTokens is capped and bounded", { timeout: TEST_TIMEOUT_MS }, () => {
  assert.deepEqual(listPromptFileTokens("Fix src/app.ts and src/other.ts"), ["src/app.ts", "src/other.ts"]);
  assert.deepEqual(listPromptFileTokens("no files here"), []);
  const many = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`).join(" ");
  assert.equal(listPromptFileTokens(many, 10).length, 10);
});

test("tryApplyTextAsPatch writes the block into the named existing file", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeRepoTmp();
  try {
    fs.writeFileSync(path.join(wt, "app.ts"), "old\n", "utf-8");
    const out = tryApplyTextAsPatch(wt, "Fix the bug in app.ts", "Here:\n```ts\nconst a = 1;\n```");
    assert.deepEqual(out, ["app.ts"]);
    assert.equal(fs.readFileSync(path.join(wt, "app.ts"), "utf-8"), "const a = 1;\n");
  } finally {
    rmRf(wt);
  }
});

test("tryApplyTextAsPatch returns [] for prose-only or missing files", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeRepoTmp();
  try {
    fs.writeFileSync(path.join(wt, "app.ts"), "old\n", "utf-8");
    assert.deepEqual(tryApplyTextAsPatch(wt, "Fix app.ts", "prose without any block"), []);
    assert.deepEqual(tryApplyTextAsPatch(wt, "Fix missing.ts", "```ts\nx\n```"), []);
    assert.equal(fs.readFileSync(path.join(wt, "app.ts"), "utf-8"), "old\n");
  } finally {
    rmRf(wt);
  }
});

// ── Agent branches (seams, offline) ──

test("llm-ok: tool writes win with an explicit trace event", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeRepoTmp();
  try {
    const agent = new ImplementAgent();
    const prose = `Edited the file as requested {"files": ["notes/trace-ok.md"]}`;
    const seams: ImplementAgentSeams = {
      hasSdk: true,
      runPrompt: async () => {
        fs.mkdirSync(path.join(wt, "notes"), { recursive: true });
        fs.writeFileSync(path.join(wt, "notes", "trace-ok.md"), "ok\n", "utf-8");
        return prose;
      },
    };
    const out = await agent.consume(
      { id: "job-trace-ok01", prompt: "crear un notes/trace-ok.md con ok", worktreePath: wt },
      seams,
    );
    assert.equal(out.strategy, "llm");
    assert.ok(out.createdFiles.includes("notes/trace-ok.md"));
    const branches = branchesOf(out);
    assert.ok(branches.includes("llm-ok"), `expected llm-ok, got ${branches.join(",")}`);
    const ev = (out.trace ?? []).find((e) => e.branch === "llm-ok");
    assert.ok(ev && ev.message.length > 0);
    assert.ok((ev.modelSnippet ?? "").length <= 200);
    assert.ok((ev.modelSnippet ?? "").includes("Edited the file"));
  } finally {
    rmRf(wt);
  }
});

test("llm-no-tools: prosa sin writes → un solo turno, vacío y parado", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeRepoTmp();
  try {
    const agent = new ImplementAgent();
    const calls: boolean[] = [];
    const seams: ImplementAgentSeams = {
      hasSdk: true,
      runPrompt: async ({ strictSecondPass }) => {
        calls.push(strictSecondPass);
        return "I would create the folder, here is my plan in prose.";
      },
    };
    const out = await agent.consume(
      { id: "job-trace-sp01", prompt: "crear carepta Zeta en raiz", worktreePath: wt },
      seams,
    );
    assert.deepEqual(calls, [false], "un solo turno, sin second pass");
    assert.equal(out.strategy, "llm");
    assert.deepEqual(out.createdFiles, []);
    const branches = branchesOf(out);
    assert.ok(branches.includes("llm-no-tools"), `trace: ${branches.join(",")}`);
    assert.ok(!branches.includes("llm-second-pass"), "sin second pass");
    assert.equal(fs.existsSync(path.join(wt, "Zeta")), false);
  } finally {
    rmRf(wt);
  }
});

test("prosa con code block NO se aplica como patch (queda parado)", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeRepoTmp();
  try {
    fs.writeFileSync(path.join(wt, "app.ts"), "old\n", "utf-8");
    backdate(path.join(wt, "app.ts"));
    const agent = new ImplementAgent();
    let calls = 0;
    const seams: ImplementAgentSeams = {
      hasSdk: true,
      runPrompt: async () => {
        calls += 1;
        return "Plan:\n```ts\nconst fixed = true;\n```";
      },
    };
    const out = await agent.consume(
      { id: "job-trace-pa01", prompt: "Fix the bug in app.ts", worktreePath: wt },
      seams,
    );
    assert.equal(calls, 1, "un solo turno");
    assert.equal(out.strategy, "llm");
    assert.deepEqual(out.createdFiles, []);
    assert.equal(fs.readFileSync(path.join(wt, "app.ts"), "utf-8"), "old\n");
    assert.ok(branchesOf(out).includes("llm-no-tools"));
  } finally {
    rmRf(wt);
  }
});

test("modify request con prosa inusable falla honesto: vacío y parado", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeRepoTmp();
  try {
    fs.writeFileSync(path.join(wt, "app.ts"), "old\n", "utf-8");
    backdate(path.join(wt, "app.ts"));
    const agent = new ImplementAgent();
    const seams: ImplementAgentSeams = {
      hasSdk: true,
      runPrompt: async () => "Some prose without any code block at all.",
    };
    const out = await agent.consume(
      { id: "job-trace-rf01", prompt: "Fix the bug in app.ts", worktreePath: wt },
      seams,
    );
    assert.equal(out.strategy, "llm");
    assert.deepEqual(out.createdFiles, []);
    assert.deepEqual(out.modifiedFiles, []);
    assert.ok(branchesOf(out).includes("llm-no-tools"));
    assert.equal(fs.existsSync(path.join(wt, "docs", "implement-ola3-job-trace-rf01.md")), false);
    assert.equal(fs.readFileSync(path.join(wt, "app.ts"), "utf-8"), "old\n");
  } finally {
    rmRf(wt);
  }
});

test("timeout branch is traced y queda parado (sin fallback)", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeRepoTmp();
  try {
    const agent = new ImplementAgent();
    const seams: ImplementAgentSeams = {
      hasSdk: true,
      runPrompt: async () => {
        throw new Error("timeout 25000ms");
      },
    };
    const out = await agent.consume(
      { id: "job-trace-to01", prompt: "crear carepta Zeta en raiz", worktreePath: wt },
      seams,
    );
    assert.equal(out.strategy, "llm");
    assert.ok(branchesOf(out).includes("timeout"), `trace: ${branchesOf(out).join(",")}`);
    assert.deepEqual(out.createdFiles, []);
    assert.equal(fs.existsSync(path.join(wt, "Zeta")), false);
  } finally {
    rmRf(wt);
  }
});

test("no-sdk branch never calls the model and stays stopped", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeRepoTmp();
  try {
    const agent = new ImplementAgent();
    let calls = 0;
    const seams: ImplementAgentSeams = {
      hasSdk: false,
      runPrompt: async () => {
        calls += 1;
        return "must never run";
      },
    };
    const out = await agent.consume(
      { id: "job-trace-ns01", prompt: "crear carepta Zeta en raiz", worktreePath: wt },
      seams,
    );
    assert.equal(calls, 0);
    assert.equal(out.strategy, "llm");
    assert.ok(branchesOf(out).includes("no-sdk"));
    assert.deepEqual(out.createdFiles, []);
  } finally {
    rmRf(wt);
  }
});

test("no-git branch triggers on a worktree without repo markers", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeTmp();
  try {
    const agent = new ImplementAgent();
    let calls = 0;
    const out = await agent.consume(
      {
        id: "job-trace-ng01",
        prompt: "crear un docs/trace-nogit.md con hola",
        worktreePath: wt,
      },
      {
        hasSdk: true,
        runPrompt: async () => {
          calls += 1;
          return "must never run without a baseline";
        },
      },
    );
    assert.equal(calls, 0);
    assert.equal(out.strategy, "llm");
    assert.ok(branchesOf(out).includes("no-git"));
    assert.deepEqual(out.createdFiles, []);
  } finally {
    rmRf(wt);
  }
});

test("model excerpts in trace never exceed 200 chars", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeRepoTmp();
  try {
    const agent = new ImplementAgent();
    const huge = `E${"v".repeat(2000)}`;
    const out = await agent.consume(
      { id: "job-trace-sn01", prompt: "crear carepta Zeta en raiz", worktreePath: wt },
      { hasSdk: true, runPrompt: async () => huge },
    );
    for (const ev of out.trace ?? []) {
      assert.ok((ev.modelSnippet ?? "").length <= 200, `branch ${ev.branch} leaks long prose`);
    }
  } finally {
    rmRf(wt);
  }
});

// ── Service wiring: trace lands in timeline, empty stays stopped ──

test("service mirrors agent trace into the timeline and keeps the changed count", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeTmp();
  workItemStore.clear();
  const holderExec = runnerExecutor as unknown as Record<string, unknown>;
  const prevSetup = holderExec["executeSetup"];
  holderExec["executeSetup"] = async () => ({
    name: "setup",
    command: "corepack enable",
    exitCode: 0,
    durationMs: 5,
    status: "pass",
    logSnippet: "mock setup pass (trace)",
    logPath: "logs/build.log",
    isolation: "none",
  });
  const holderVerif = verificationService as unknown as Record<string, unknown>;
  const prevRun = holderVerif["run"];
  holderVerif["run"] = async () => {
    const now = new Date().toISOString();
    return {
      steps: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: 1,
          durationMs: 5,
          status: "fail",
          logSnippet: "mock test fail (trace)",
          logPath: "logs/build.log",
        },
      ],
      overall: "fail",
      startedAt: now,
      finishedAt: now,
      durationMs: 5,
    };
  };
  const holderAgent = implementAgent as unknown as Record<string, unknown>;
  const prevConsume = holderAgent["consume"];
  const jobId = "job-tracemirr01";
  fs.mkdirSync(path.join(wt, "notes"), { recursive: true });
  fs.writeFileSync(path.join(wt, "notes", "m.md"), "hi\n", "utf-8");
  holderAgent["consume"] = async () => ({
    createdFiles: ["notes/m.md"],
    modifiedFiles: ["notes/m.md"],
    durationMs: 7,
    strategy: "llm",
    trace: [
      { branch: "llm-ok", message: "Model edited 1 file(s) via tools: notes/m.md.", modelSnippet: "Edited ok" },
    ],
  });
  try {
    const created = workItemStore.create({ id: jobId, prompt: "edit notes/m.md", worktree: wt });
    workItemStore.transition(created.id, "Foreman", "foreman", "test to Foreman");
    const building = workItemStore.transition(jobId, "Building", "foreman", "test to Building");
    const out = await implementService.handleBuilding(building);
    assert.ok(out, "handleBuilding returns the item");
    const timeline = workItemStore.get(jobId)?.timeline ?? [];
    const traced = timeline.find((e) => e.message.startsWith("implement:llm-ok:"));
    assert.ok(traced, "agent llm-ok branch lands in the timeline with its reason");
    assert.match(traced?.message ?? "", /via tools/);
    assert.equal((traced?.meta as { implementBranch?: string } | undefined)?.implementBranch, "llm-ok");
    assert.equal((traced?.meta as { modelSnippet?: string } | undefined)?.modelSnippet, "Edited ok");
  } finally {
    if (prevSetup === undefined) delete holderExec["executeSetup"];
    else holderExec["executeSetup"] = prevSetup;
    if (prevRun === undefined) delete holderVerif["run"];
    else holderVerif["run"] = prevRun;
    if (prevConsume === undefined) delete holderAgent["consume"];
    else holderAgent["consume"] = prevConsume;
    workItemStore.clear();
    rmRf(wt);
  }
});

test("service deja parado en Building un consume vacío (sin Triage)", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeTmp();
  workItemStore.clear();
  const holderExec = runnerExecutor as unknown as Record<string, unknown>;
  const prevSetup = holderExec["executeSetup"];
  holderExec["executeSetup"] = async () => ({
    name: "setup",
    command: "corepack enable",
    exitCode: 0,
    durationMs: 5,
    status: "pass",
    logSnippet: "mock setup pass (empty)",
    logPath: "logs/build.log",
    isolation: "none",
  });
  const holderAgent = implementAgent as unknown as Record<string, unknown>;
  const prevConsume = holderAgent["consume"];
  const holderVerif = verificationService as unknown as Record<string, unknown>;
  const prevRun = holderVerif["run"];
  holderVerif["run"] = async () => {
    const now = new Date().toISOString();
    return {
      steps: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: 1,
          durationMs: 5,
          status: "fail",
          logSnippet: "mock test fail (empty stays stopped)",
          logPath: "logs/build.log",
        },
      ],
      overall: "fail",
      startedAt: now,
      finishedAt: now,
      durationMs: 5,
    };
  };
  const jobId = "job-traceref01";
  fs.writeFileSync(path.join(wt, "app.ts"), "old\n", "utf-8");
  backdate(path.join(wt, "app.ts"));
  const reason =
    "Model answer held prose with zero tool writes, so nothing changed on disk; job stays stopped in Building (no second pass).";
  holderAgent["consume"] = async () => ({
    createdFiles: [],
    modifiedFiles: [],
    durationMs: 9,
    strategy: "llm",
    trace: [{ branch: "llm-no-tools", message: reason }],
  });
  try {
    const created = workItemStore.create({ id: jobId, prompt: "Fix the bug in app.ts", worktree: wt });
    workItemStore.transition(created.id, "Foreman", "foreman", "test to Foreman");
    const building = workItemStore.transition(jobId, "Building", "foreman", "test to Building");
    const out = await implementService.handleBuilding(building);
    assert.ok(out, "handleBuilding returns the item");
    assert.equal(workItemStore.get(jobId)?.status, "Building");
    const timeline = workItemStore.get(jobId)?.timeline ?? [];
    assert.ok(timeline.some((e) => e.message.startsWith("implement:llm-no-tools:")));
    assert.equal(fs.existsSync(path.join(wt, "docs", `implement-ola3-${jobId}.md`)), false);
    const resultPath = path.join(wt, ".agents", "factory", jobId, "result.json");
    assert.ok(fs.existsSync(resultPath), "empty consume writes result.json evidence");
  } finally {
    if (prevSetup === undefined) delete holderExec["executeSetup"];
    else holderExec["executeSetup"] = prevSetup;
    if (prevConsume === undefined) delete holderAgent["consume"];
    else holderAgent["consume"] = prevConsume;
    if (prevRun === undefined) delete holderVerif["run"];
    else holderVerif["run"] = prevRun;
    workItemStore.clear();
    rmRf(wt);
  }
});
