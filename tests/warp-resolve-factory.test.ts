/**
 * warp-resolve-factory — Warp Resolve creates a FACTORY job (panel pivot).
 *
 * Contract under test (cohesive, zero quota, zero live jobs):
 * - `factoryIssueJobs.ts` (pure, renderer-safe): prompt building from the
 *   issue (title/body/labels/url, capped), repo parsing from the issue URL,
 *   `issueRef` sanitize/read, active-job detection, and the busy-match
 *   against the EXISTING poll list (zero new polls — callers pass
 *   `useWorkItemStore` items).
 * - `factoryClient.createFactoryJob`: POST /factory/jobs with
 *   prompt/worktree/phase/issueRef (fail-safe, never throws, fetch faked).
 * - `activityActions` resolve: describe guards (daemon down → disabled +
 *   title; active linked job → `Resolving…` + disabled) and invoke flow
 *   (busy/blocked backstops, worktree guard, health probe, create with
 *   stamped `issueRef`, honest notify on every refusal — never a dead
 *   click, never a retry, concurrent double-click → single create).
 * - `activityDerivation`: an issue with an active factory job derives
 *   in-progress/implementing (generic phase, documented — the daemon
 *   status is deliberately NOT mapped onto phases).
 * - `jobCreate.ts` daemon half: `issueRef` in the create body is stamped
 *   (memory key + timeline meta, restore-tolerant); bodies without it
 *   behave byte-identically (pacts F01–F14 intact); junk refs never 400.
 *
 * Offline total: fetch faked + tmp worktrees, global fetch guarded (real
 * network fails the run). No daemon, no docker, no LLM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFactoryJobIssueRef,
  buildFactoryResolvePrompt,
  findActiveFactoryJobForIssue,
  isFactoryJobActive,
  parseGitHubIssueRepo,
  readFactoryJobIssueRef,
  sanitizeFactoryIssueRef,
} from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";
import { deriveActivityStatus } from "../src/features/warpPanel/adapters/activityDerivation.ts";
import {
  describeActivityActions,
  invokeActivityAction,
  type ActivityInvokeDeps,
  type DescribeActivityActionsArgs,
  type FactoryResolveCreateInput,
} from "../src/features/warpPanel/components/activityActions.ts";
import type { LiveReviewSnapshot } from "../src/features/warpPanel/adapters/liveIssues.ts";
import {
  createFactoryJob,
  FACTORY_JOB_CREATE_TIMEOUT_MS,
  type FactoryFetch,
} from "../src/lib/factoryClient.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import {
  createJobRequest,
  getIssueRef,
  JOB_ISSUE_META_KEY,
  readJobIssueRef,
  stampIssueRef,
} from "../headless-runtime/factory/jobs/jobCreate.ts";

/** Test port: travels only in mocked URLs, never touches the network. */
const TEST_PORT = 19877;

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests (inject fetchFn)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  init?: RequestInit;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FactoryFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as FactoryFetch & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

function jsonRes(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bodyOf(call: Call): Record<string, unknown> {
  const raw = call.init?.body;
  assert.equal(typeof raw, "string");
  return JSON.parse(raw as string) as Record<string, unknown>;
}

function baseReview(
  patch: Partial<LiveReviewSnapshot> = {},
): LiveReviewSnapshot {
  return {
    primaryPrByIssue: {},
    verdictByIssue: {},
    reviewingIssueNumber: null,
    fixingIssueNumber: null,
    mergingIssueNumber: null,
    resolvingConflictIssueNumber: null,
    mergedPrNumbers: [],
    ...patch,
  };
}

function baseArgs(
  patch: Partial<DescribeActivityActionsArgs> = {},
): DescribeActivityActionsArgs {
  return {
    issueNumber: 7,
    prNumber: null,
    prState: "unknown",
    effective: null,
    conflicted: false,
    gateStatus: "idle",
    busy: {
      resolving: false,
      reviewing: false,
      fixing: false,
      merging: false,
      resolvingConflict: false,
      anyActive: false,
    },
    ...patch,
  };
}

function byKind(defs: ReturnType<typeof describeActivityActions>) {
  return new Map(defs.map((d) => [d.kind, d]));
}

const ISSUE_URL = "https://github.com/org/termcanvas/issues/7";

function resolveDeps(
  patch: Partial<ActivityInvokeDeps> = {},
): ActivityInvokeDeps {
  return {
    worktreePath: "C:/repos/termcanvas",
    issueUrl: ISSUE_URL,
    issue: {
      title: "Fix the thing",
      body: "Long description",
      labels: ["bug"],
      url: ISSUE_URL,
    },
    factoryJobs: [],
    checkFactoryHealth: async () => ({ ok: true, error: "" }),
    createFactoryJob: async () => ({ ok: true, id: "job-test-1", error: "" }),
    notify: () => {},
    ...patch,
  };
}

// ─── Prompt building ─────────────────────────────────────────────────────

test("prompt carries title/body/labels/url and no orchestrator boilerplate", () => {
  const prompt = buildFactoryResolvePrompt({
    issueNumber: 7,
    title: "Fix the thing",
    body: "Long description",
    labels: ["bug", "P1"],
    url: ISSUE_URL,
  });
  assert.ok(prompt.includes("# Resolve issue #7"));
  assert.ok(prompt.includes("Fix the thing"));
  assert.ok(prompt.includes("Long description"));
  assert.ok(prompt.includes("bug"));
  assert.ok(prompt.includes(ISSUE_URL));
  // F15: las reglas de orquestador viven en los agent.md; el prompt ya no
  // lleva el bloque SCOPE (ni Closes/NEVER/uncommitted).
  assert.equal(prompt.includes("## SCOPE"), false, "sin bloque SCOPE");
  assert.equal(prompt.includes("NEVER open a pull request"), false);
  assert.equal(prompt.includes("uncommitted"), false);
});

test("prompt no duplica el SCOPE si el body ya lo trae (una sola copia)", () => {
  const withScope = buildFactoryResolvePrompt({
    issueNumber: 86,
    title: "helper",
    body: `Motivation.\n\n## SCOPE\nImplement only what this issue asks for. Do not add features outside its scope and do not skip its no-goals.\nWork in the issue worktree. NEVER open a pull request, push, or commit: the orchestrator creates the PR automatically (body "Closes #86"). Leave all changes uncommitted in the worktree.`,
    labels: [],
    url: ISSUE_URL,
  });
  assert.equal(withScope.split("Implement only what this issue asks for").length - 1, 1);
  assert.equal(withScope.split("NEVER open a pull request").length - 1, 1);
  assert.ok(withScope.includes("Motivation."));
  assert.ok(withScope.includes("Closes #86"));
});

test("prompt caps long inputs and degrades honestly on junk", () => {
  const prompt = buildFactoryResolvePrompt({
    issueNumber: 7,
    title: `t`.repeat(500),
    body: `b`.repeat(5000),
    labels: Array.from({ length: 30 }, (_, i) => `label-${i}`),
    url: ISSUE_URL,
  });
  assert.ok(!prompt.includes(`t`.repeat(500)));
  assert.ok(!prompt.includes(`b`.repeat(5000)));
  assert.ok(!prompt.includes("label-29"));
  const bare = buildFactoryResolvePrompt({ issueNumber: 7 });
  assert.ok(bare.includes("# Resolve issue #7"));
  assert.ok(bare.includes("(no description)"));
  assert.ok(bare.includes("unknown"));
  assert.ok(bare.includes("none"));
  assert.doesNotThrow(() => {
    buildFactoryResolvePrompt(null as unknown as { issueNumber: number });
    buildFactoryResolvePrompt({ issueNumber: 7, labels: 42 as unknown as string[] });
  });
});

// ─── Repo parsing ────────────────────────────────────────────────────────

test("repo parses owner/repo from issue URLs, null otherwise", () => {
  assert.equal(
    parseGitHubIssueRepo("https://github.com/org/termcanvas/issues/7"),
    "org/termcanvas",
  );
  assert.equal(
    parseGitHubIssueRepo("https://github.com/org/termcanvas/issues/7?x=1"),
    "org/termcanvas",
  );
  assert.equal(parseGitHubIssueRepo("https://example.com/a/b"), null);
  assert.equal(parseGitHubIssueRepo(""), null);
  assert.equal(parseGitHubIssueRepo(null), null);
  assert.equal(parseGitHubIssueRepo(42), null);
});

// ─── issueRef shape ──────────────────────────────────────────────────────

test("issueRef builds from the issue URL; repo stays null without URL", () => {
  assert.deepEqual(buildFactoryJobIssueRef({ issueNumber: 7, url: ISSUE_URL }), {
    provider: "github",
    issueNumber: 7,
    repo: "org/termcanvas",
    url: ISSUE_URL,
  });
  const noUrl = buildFactoryJobIssueRef({ issueNumber: 7 });
  assert.equal(noUrl.provider, "github");
  assert.equal(noUrl.issueNumber, 7);
  assert.equal(noUrl.repo, null);
  assert.equal(noUrl.url, null);
});

test("sanitize accepts the exact shape, rejects everything else", () => {
  assert.deepEqual(
    sanitizeFactoryIssueRef({
      provider: "github",
      issueNumber: 7,
      repo: "org/termcanvas",
      url: ISSUE_URL,
      extra: "ignored",
    }),
    {
      provider: "github",
      issueNumber: 7,
      repo: "org/termcanvas",
      url: ISSUE_URL,
    },
  );
  for (const bad of [
    null,
    undefined,
    42,
    "x",
    [],
    {},
    { provider: "linear", issueNumber: 7 },
    { provider: "github", issueNumber: 0 },
    { provider: "github", issueNumber: -3 },
    { provider: "github", issueNumber: 1.5 },
    { provider: "github", issueNumber: "7" },
    { provider: "github" },
  ]) {
    assert.equal(sanitizeFactoryIssueRef(bad), null);
  }
  // repo/url degrade to null instead of rejecting the whole ref
  assert.deepEqual(
    sanitizeFactoryIssueRef({ provider: "github", issueNumber: 7 }),
    { provider: "github", issueNumber: 7, repo: null, url: null },
  );
});

test("read finds memory-key refs and timeline-meta refs (restore path)", () => {
  const ref = {
    provider: "github",
    issueNumber: 7,
    repo: "org/termcanvas",
    url: ISSUE_URL,
  };
  assert.deepEqual(
    readFactoryJobIssueRef({ id: "job-a", status: "Building", [JOB_ISSUE_META_KEY]: ref }),
    ref,
  );
  // Durable path: memory key lost (daemon restart), timeline meta survives.
  const restored = {
    id: "job-b",
    status: "Building",
    timeline: [
      { id: "job-b-t0", message: "created Intake" },
      {
        id: "job-b-t1",
        message: "resolve link github#7",
        meta: { [JOB_ISSUE_META_KEY]: ref },
      },
    ],
  };
  assert.deepEqual(readFactoryJobIssueRef(restored), ref);
  assert.equal(readFactoryJobIssueRef({ id: "job-old", status: "Complete" }), null);
  assert.equal(readFactoryJobIssueRef(null), null);
  assert.equal(
    readFactoryJobIssueRef({ [JOB_ISSUE_META_KEY]: { provider: "nope" } }),
    null,
  );
});

// ─── Active detection ────────────────────────────────────────────────────

test("active covers pipeline statuses and legacy queued/running only", () => {
  for (const status of ["Intake", "Foreman", "Triage", "Building", "Review"]) {
    assert.equal(isFactoryJobActive({ status }), true, status);
  }
  for (const status of ["Complete", "Cancelled"]) {
    assert.equal(isFactoryJobActive({ status }), false, status);
  }
  assert.equal(isFactoryJobActive({ state: "queued" }), true);
  assert.equal(isFactoryJobActive({ state: "running" }), true);
  assert.equal(isFactoryJobActive({ state: "done" }), false);
  assert.equal(isFactoryJobActive({ state: "error" }), false);
  // Unknown shapes never claim busy (honest-absent).
  assert.equal(isFactoryJobActive({}), false);
  assert.equal(isFactoryJobActive({ status: "SomethingNew" }), false);
  assert.equal(isFactoryJobActive(null), false);
});

// ─── Busy match on the existing poll list ────────────────────────────────

function pollJob(
  id: string,
  issueNumber: number,
  status = "Building",
  repo: string | null = "org/termcanvas",
): Record<string, unknown> {
  return {
    id,
    status,
    [JOB_ISSUE_META_KEY]: {
      provider: "github",
      issueNumber,
      repo,
      url: `https://github.com/${repo ?? "org/termcanvas"}/issues/${issueNumber}`,
    },
  };
}

test("match finds the active linked job, skips done/wrong links", () => {
  const jobs = [
    pollJob("job-1", 7, "Building"),
    pollJob("job-2", 9, "Review"),
    pollJob("job-3", 11, "Complete"),
  ];
  const hit = findActiveFactoryJobForIssue(jobs, 7, "org/termcanvas");
  assert.equal((hit as Record<string, unknown>).id, "job-1");
  assert.equal(findActiveFactoryJobForIssue(jobs, 9, "org/termcanvas") !== null, true);
  // Terminal jobs never match (issue free to resolve again).
  assert.equal(findActiveFactoryJobForIssue(jobs, 11, "org/termcanvas"), null);
  assert.equal(findActiveFactoryJobForIssue(jobs, 12, "org/termcanvas"), null);
});

test("match is repo-scoped when both sides know the repo", () => {
  const jobs = [pollJob("job-1", 7, "Building", "org/termcanvas")];
  assert.equal(findActiveFactoryJobForIssue(jobs, 7, "other/repo"), null);
  assert.equal(findActiveFactoryJobForIssue(jobs, 7, "ORG/TermCanvas") !== null, true);
  // Null repo on either side falls back to number-only (old links match).
  assert.equal(findActiveFactoryJobForIssue(jobs, 7, null) !== null, true);
  const noRepo = [pollJob("job-2", 7, "Building", null)];
  assert.equal(findActiveFactoryJobForIssue(noRepo, 7, "org/termcanvas") !== null, true);
});

test("match never throws on malformed lists", () => {
  assert.equal(findActiveFactoryJobForIssue(null, 7), null);
  assert.equal(findActiveFactoryJobForIssue([], 7), null);
  assert.equal(findActiveFactoryJobForIssue([null, 42, {}], 7), null);
  assert.equal(findActiveFactoryJobForIssue([pollJob("j", 7)], 0), null);
  assert.equal(findActiveFactoryJobForIssue([pollJob("j", 7)], -1), null);
});

// ─── factoryClient.createFactoryJob ──────────────────────────────────────

test("create posts prompt/worktree/phase/issueRef and returns the id", async () => {
  const fetchFn = mockFetch(() =>
    jsonRes({ id: "job-new-1", status: "Intake" }, 201),
  );
  const issueRef = {
    provider: "github",
    issueNumber: 7,
    repo: "org/termcanvas",
    url: ISSUE_URL,
  };
  const res = await createFactoryJob(
    {
      prompt: "do the thing",
      worktree: "C:/repos/termcanvas",
      phase: "diagnosisLlm",
      issueRef,
    },
    { fetchFn, port: TEST_PORT },
  );
  assert.equal(res.ok, true);
  assert.equal(res.data.id, "job-new-1");
  assert.equal(fetchFn.calls.length, 1);
  const call = fetchFn.calls[0];
  assert.equal(call.url, `http://127.0.0.1:${TEST_PORT}/factory/jobs`);
  assert.equal(call.init?.method, "POST");
  assert.deepEqual(bodyOf(call), {
    prompt: "do the thing",
    worktree: "C:/repos/termcanvas",
    phase: "diagnosisLlm",
    issueRef,
  });
});

test("create is fail-safe: HTTP error, transport error, bad shape", async () => {
  const http = await createFactoryJob(
    { prompt: "p", worktree: "w" },
    { fetchFn: mockFetch(() => jsonRes({ error: "busy" }, 500)), port: TEST_PORT },
  );
  assert.equal(http.ok, false);
  assert.equal(http.data.id, null);
  const transport = await createFactoryJob(
    { prompt: "p", worktree: "w" },
    {
      fetchFn: mockFetch(() => {
        throw new Error("down");
      }),
      port: TEST_PORT,
    },
  );
  assert.equal(transport.ok, false);
  const shape = await createFactoryJob(
    { prompt: "p", worktree: "w" },
    { fetchFn: mockFetch(() => jsonRes({ nope: 1 }, 201)), port: TEST_PORT },
  );
  assert.equal(shape.ok, false);
  assert.equal(shape.data.id, null);
});

test("create fails closed on missing prompt/worktree without touching the network", async () => {
  const fetchFn = mockFetch(() => jsonRes({ id: "job-x" }, 201));
  for (const bad of [
    { prompt: "", worktree: "w" },
    { prompt: "p", worktree: "" },
    { prompt: "   ", worktree: "w" },
    {},
    null,
  ]) {
    const res = await createFactoryJob(bad as never, { fetchFn, port: TEST_PORT });
    assert.equal(res.ok, false);
    assert.equal(res.data.id, null);
  }
  assert.equal(fetchFn.calls.length, 0);
});

test("create fail-closes on junk/absent issueRef (daemon 400s without a link)", async () => {
  const fetchFn = mockFetch(() => jsonRes({ id: "job-y" }, 201));
  const junk = await createFactoryJob(
    { prompt: "p", worktree: "w", issueRef: "junk" },
    { fetchFn, port: TEST_PORT },
  );
  assert.equal(junk.ok, false);
  assert.match(junk.error, /issueRef is required/);
  const absent = await createFactoryJob(
    { prompt: "p", worktree: "w" } as never,
    { fetchFn, port: TEST_PORT },
  );
  assert.equal(absent.ok, false);
  assert.match(absent.error, /issueRef is required/);
  assert.equal(fetchFn.calls.length, 0, "sin red: falla antes de fetch");
  const VALID_REF = { provider: "github", issueNumber: 7 };
  const res = await createFactoryJob(
    { prompt: "p", worktree: "w", issueRef: VALID_REF },
    { fetchFn, port: TEST_PORT },
  );
  assert.equal(res.ok, true);
  assert.deepEqual(bodyOf(fetchFn.calls[0]).issueRef, VALID_REF);
  assert.ok(
    typeof FACTORY_JOB_CREATE_TIMEOUT_MS === "number" &&
      FACTORY_JOB_CREATE_TIMEOUT_MS > 0,
  );
  const hanging = mockFetch(() => new Promise<Response>(() => {}));
  const timed = await createFactoryJob(
    { prompt: "p", worktree: "w", issueRef: VALID_REF },
    { fetchFn: hanging, port: TEST_PORT, timeoutMs: 40 },
  );
  assert.equal(timed.ok, false);
});

// ─── describe guards ─────────────────────────────────────────────────────

test("describe: daemon down disables resolve with an honest English title", () => {
  const defs = byKind(
    describeActivityActions(baseArgs({ factory: { available: false, active: false } })),
  );
  const resolve = defs.get("resolve");
  assert.equal(resolve?.label, "Resolve Issue");
  assert.equal(resolve?.enabled, false);
  assert.equal(
    resolve?.title,
    "Factory daemon is not available — start the daemon, then resolve again",
  );
  // Other CTAs keep their own rules: session without a live link disables
  // honestly (never a dead tab) — the daemon is down so no session URL can
  // exist for this row.
  assert.equal(defs.get("session")?.enabled, false);
  assert.ok(
    typeof defs.get("session")?.title === "string" &&
      (defs.get("session")?.title as string).length > 0,
  );
});

test("describe: active linked job marks the row busy with Resolving…", () => {
  const defs = byKind(
    describeActivityActions(baseArgs({ factory: { available: true, active: true } })),
  );
  const resolve = defs.get("resolve");
  assert.equal(resolve?.label, "Resolving…");
  assert.equal(resolve?.enabled, false);
  assert.equal(
    resolve?.title,
    "A factory job is already resolving this issue",
  );
});

test("describe: unknown factory state changes nothing; blocked-by wins titles", () => {
  const idle = byKind(describeActivityActions(baseArgs())).get("resolve");
  assert.equal(idle?.label, "Resolve Issue");
  assert.equal(idle?.enabled, true);
  assert.equal(idle?.title, undefined);
  const unknown = byKind(
    describeActivityActions(baseArgs({ factory: { available: null, active: false } })),
  ).get("resolve");
  assert.equal(unknown?.enabled, true);
  const both = byKind(
    describeActivityActions(
      baseArgs({ blockedByBlockers: [12], factory: { available: false } }),
    ),
  ).get("resolve");
  assert.equal(both?.enabled, false);
  assert.equal(
    both?.title,
    "Bloqueado por #12 — se puede resolver cuando esté cerrado",
  );
});

// ─── invoke resolve → factory ────────────────────────────────────────────

test("invoke: resolve creates the job with prompt + worktree + issueRef", async () => {
  const created: FactoryResolveCreateInput[] = [];
  const notes: string[] = [];
  await invokeActivityAction(
    "resolve",
    7,
    undefined,
    resolveDeps({
      createFactoryJob: async (input) => {
        created.push(input);
        return { ok: true, id: "job-new-9", error: "" };
      },
      notify: (message) => {
        notes.push(message);
      },
    }),
  );
  assert.equal(created.length, 1);
  const input = created[0];
  assert.equal(input.worktree, "C:/repos/termcanvas");
  assert.equal(input.phase, "diagnosisLlm");
  assert.ok(input.prompt.includes("Fix the thing"));
  assert.ok(input.prompt.includes("Long description"));
  assert.ok(input.prompt.includes("bug"));
  assert.ok(input.prompt.includes(ISSUE_URL));
  assert.deepEqual(input.issueRef, {
    provider: "github",
    issueNumber: 7,
    repo: "org/termcanvas",
    url: ISSUE_URL,
  });
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes("job-new-9"));
});

test("invoke: resolve refuses on daemon down, missing worktree, failed create", async () => {
  const calls: FactoryResolveCreateInput[] = [];
  const recruiting: ActivityInvokeDeps = resolveDeps({
    createFactoryJob: async (input) => {
      calls.push(input);
      return { ok: true, id: "job-x", error: "" };
    },
  });
  const notes: string[] = [];
  const notify = (message: string) => {
    notes.push(message);
  };
  // Daemon down → honest notify, zero creates.
  await invokeActivityAction(
    "resolve",
    7,
    undefined,
    { ...recruiting, notify, checkFactoryHealth: async () => ({ ok: false, error: "down" }) },
  );
  assert.equal(calls.length, 0);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes("not available"));
  // Health seam throws → same honest path, never throws out.
  notes.length = 0;
  await invokeActivityAction(
    "resolve",
    7,
    undefined,
    {
      ...recruiting,
      notify,
      checkFactoryHealth: async () => {
        throw new Error("boom");
      },
    },
  );
  assert.equal(calls.length, 0);
  assert.equal(notes.length, 1);
  // Missing worktree → honest notify before any network.
  notes.length = 0;
  let probed = false;
  await invokeActivityAction(
    "resolve",
    7,
    undefined,
    {
      ...recruiting,
      notify,
      worktreePath: "   ",
      checkFactoryHealth: async () => {
        probed = true;
        return { ok: true, error: "" };
      },
    },
  );
  assert.equal(calls.length, 0);
  assert.equal(probed, false);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes("worktree"));
  // Create fails → honest notify with the error.
  notes.length = 0;
  await invokeActivityAction(
    "resolve",
    7,
    undefined,
    {
      ...recruiting,
      notify,
      createFactoryJob: async () => ({ ok: false, id: null, error: "busy" }),
    },
  );
  assert.equal(calls.length, 0);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes("Could not create"));
  assert.ok(notes[0].includes("busy"));
});

test("invoke: resolve stays silent on busy/active/blocked/invalid (disabled CTA backstop)", async () => {
  const calls: FactoryResolveCreateInput[] = [];
  const notes: string[] = [];
  const base = resolveDeps({
    createFactoryJob: async (input) => {
      calls.push(input);
      return { ok: true, id: "job-x", error: "" };
    },
    notify: (message) => {
      notes.push(message);
    },
  });
  // Canvas terminal busy.
  await invokeActivityAction("resolve", 7, undefined, {
    ...base,
    busy: { resolving: true },
  });
  // Active factory job in the existing poll list.
  await invokeActivityAction("resolve", 7, undefined, {
    ...base,
    factoryJobs: [pollJob("job-live", 7, "Review")],
  });
  // Terminal job for the same issue does NOT block.
  await invokeActivityAction("resolve", 8, undefined, {
    ...base,
    factoryJobs: [pollJob("job-done", 8, "Complete")],
  });
  // Blocked-by an OPEN issue.
  await invokeActivityAction("resolve", 7, undefined, {
    ...base,
    blockedByBlockers: [12],
  });
  // Invalid issue numbers.
  await invokeActivityAction("resolve", 0, undefined, base);
  await invokeActivityAction("resolve", -3, undefined, base);
  assert.equal(calls.length, 1);
  assert.deepEqual(notes.length, 1);
});

test("invoke: concurrent double-click creates a single job (in-flight mutex)", async () => {
  let calls = 0;
  const deps = resolveDeps({
    createFactoryJob: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true, id: "job-once", error: "" };
    },
  });
  await Promise.all([
    invokeActivityAction("resolve", 7, undefined, deps),
    invokeActivityAction("resolve", 7, undefined, deps),
  ]);
  assert.equal(calls, 1);
});

// ─── Derivation with factory work ────────────────────────────────────────

test("derivation: active factory job maps to in-progress/implementing", () => {
  assert.deepEqual(deriveActivityStatus(7, baseReview(), null, "OPEN", true), {
    status: "in-progress",
    phase: "implementing",
  });
  assert.deepEqual(deriveActivityStatus(7, baseReview(), null, "OPEN", false), {
    status: "pending",
  });
  assert.deepEqual(deriveActivityStatus(7, baseReview(), null), {
    status: "pending",
  });
  // Real merge evidence still wins over factory work (completion needs proof).
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({
        primaryPrByIssue: {
          7: { number: 50, title: "Fix", url: "https://example.com", state: "MERGED" },
        },
      }),
      null,
      "OPEN",
      true,
    ),
    { status: "done" },
  );
});

// ─── Daemon half: issueRef stamp ─────────────────────────────────────────

function mkTmp(prefix = "wrp-factory-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

const createdIds: string[] = [];
const createdDirs: string[] = [];

function track(id: string, dir: string): void {
  createdIds.push(id);
  createdDirs.push(dir);
}

function cleanup(): void {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of createdDirs.splice(0)) rmTmp(dir);
}

function infraFor() {
  return {
    resolveDirectory: (w: string) => w,
    getBaseUrl: () => "http://127.0.0.1:4096",
    buildDashboardUrl: (sid?: string) =>
      sid ? `http://127.0.0.1:4096/session/${sid}` : "http://127.0.0.1:4096",
    onIdempotentReset: (_id: string) => {},
  };
}

test("daemon: issueRef in the create body is stamped (memory + timeline)", () => {
  const dir = mkTmp();
  const id = "job-wrp-issuere01";
  track(id, dir);
  try {
    const out = createJobRequest(
      {
        prompt: "resolve the thing",
        worktree: dir,
        id,
        issueRef: {
          provider: "github",
          issueNumber: 7,
          repo: "org/termcanvas",
          url: ISSUE_URL,
        },
      },
      JSON.stringify({ prompt: "resolve the thing" }),
      false,
      infraFor(),
    );
    assert.equal(out.status, 201);
    assert.deepEqual(getIssueRef(id), {
      provider: "github",
      issueNumber: 7,
      repo: "org/termcanvas",
      url: ISSUE_URL,
    });
    // Durable evidence rides the 201 timeline (first read already linked).
    const body = out.body as Record<string, unknown>;
    const workItem = body.workItem as Record<string, unknown>;
    const timeline = workItem.timeline as Array<Record<string, unknown>>;
    const stamped = timeline.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        (entry.meta as Record<string, unknown> | undefined)?.[JOB_ISSUE_META_KEY] !==
          undefined,
    );
    assert.equal(stamped, true);
  } finally {
    cleanup();
  }
});

test("daemon: intake requiere issueRef — ausente o basura → 400 honesto", () => {
  const dir = mkTmp();
  const plain = "job-wrp-issuere02";
  const junk = "job-wrp-issuere03";
  track(plain, dir);
  track(junk, dir);
  try {
    const out = createJobRequest(
      { prompt: "plain job", worktree: dir, id: plain },
      JSON.stringify({ prompt: "plain job" }),
      false,
      infraFor(),
    );
    assert.equal(out.status, 400);
    assert.match(String((out.body as Record<string, unknown>).error), /issueRef is required/);
    const bad = createJobRequest(
      { prompt: "junk ref", worktree: dir, id: junk, issueRef: { provider: "nope" } },
      JSON.stringify({ prompt: "junk ref" }),
      false,
      infraFor(),
    );
    assert.equal(bad.status, 400);
    assert.match(String((bad.body as Record<string, unknown>).error), /issueRef is required/);
  } finally {
    cleanup();
  }
});

test("daemon: stamp helpers fail closed on unknown jobs and junk", () => {
  assert.equal(stampIssueRef("job-wrp-does-not-exist", { provider: "github", issueNumber: 1 }), false);
  assert.equal(stampIssueRef("", { provider: "github", issueNumber: 1 }), false);
  assert.equal(stampIssueRef(null, { provider: "github", issueNumber: 1 }), false);
  assert.equal(readJobIssueRef(null), null);
  assert.equal(getIssueRef(""), null);
});
