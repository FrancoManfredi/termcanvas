import test from "node:test";
import assert from "node:assert/strict";
import { ProjectStore } from "../headless-runtime/project-store.ts";
import type { GhExecFn } from "../headless-runtime/github-lookups.ts";
import {
  applyCycleLabel,
  applyReviewLabel,
  findOpenPrsForIssue,
  findPrForIssue,
  getConflictFiles,
  getPrComments,
  getPrReviewDecision,
  syncIssueReviewLabel,
} from "../src/lib/githubClient.ts";
import {
  addProjectWithMainWorktree,
  createWorkspaceFixture,
  startHeadlessServer,
  stopHeadlessServer,
} from "./headless-runtime-test-helpers.ts";

const stubGh: GhExecFn = async (file, args) => {
  if (file === "git") return { stdout: "https://github.com/acme/repo.git\n", stderr: "" };
  if (args.includes("graphql")) {
    return {
      stdout: JSON.stringify({
        data: {
          repository: {
            issue: {
              closedByPullRequestsReferences: {
                nodes: [
                  { number: 7, title: "fix", url: "u", state: "MERGED", headRefName: "a", headRefOid: "h1" },
                  { number: 8, title: "fix2", url: "u8", state: "OPEN", headRefName: "b", headRefOid: "h2" },
                ],
              },
            },
          },
        },
      }),
      stderr: "",
    };
  }
  if (args.includes("--comments")) {
    return { stdout: "nit: rename\n", stderr: "" };
  }
  return {
    stdout: JSON.stringify({
      decision: "APPROVED",
      headRefOid: "h2",
      reviews: [
        {
          state: "APPROVED",
          body: "VEREDICTO: APROBADO.\nok",
          submittedAt: "2026-01-02T00:00:00Z",
          commitOid: "h2",
        },
      ],
      labels: ["review:aprobado"],
    }),
    stderr: "",
  };
};

function setWindowFor(headlessPort: number | null, github?: unknown): void {
  const search = headlessPort === null ? "" : `?headless-port=${headlessPort}`;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search, protocol: "http:", port: "", host: "localhost" },
      ...(github ? { termcanvas: { github } } : {}),
    },
  });
}

function clearWindow(): void {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
}

test("app mode: client delegates to the bridge untouched", async () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const decision = { ok: true as const, reviewDecision: "APPROVED" as const };
  setWindowFor(null, {
    findOpenPrsForIssue: async (...args: unknown[]) => {
      calls.push({ name: "findOpenPrsForIssue", args });
      return { ok: true, prs: [] };
    },
    getPrReviewDecision: async (...args: unknown[]) => {
      calls.push({ name: "getPrReviewDecision", args });
      return decision;
    },
    getConflictFiles: async (...args: unknown[]) => {
      calls.push({ name: "getConflictFiles", args });
      return { ok: true, conflictFiles: ["a.ts"] };
    },
  });
  try {
    const prs = await findOpenPrsForIssue("/repo", 5);
    assert.deepEqual(prs, { ok: true, prs: [] });
    const dec = await getPrReviewDecision("/repo", 8);
    assert.equal(dec, decision);
    assert.deepEqual(await getConflictFiles("/repo", "b", 8), {
      ok: true,
      conflictFiles: ["a.ts"],
    });
    assert.deepEqual(calls[0], {
      name: "findOpenPrsForIssue",
      args: ["/repo", 5],
    });
  } finally {
    clearWindow();
  }
});

test("web mode: pills y veredictos idénticos vía daemon HTTP", async () => {
  const workspaceDir = createWorkspaceFixture({ "README.md": "hi\n" });
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "parity-repo");
  const harness = await startHeadlessServer({
    workspaceDir,
    projectStore,
    ghExec: stubGh,
  });
  setWindowFor(harness.port);
  try {
    const prs = await findOpenPrsForIssue(workspaceDir, 5);
    assert.equal(prs.ok, true);
    if (!prs.ok) return;
    assert.equal(prs.prs.length, 2);

    const one = await findPrForIssue(workspaceDir, 5);
    assert.equal(one.ok, true);
    if (!one.ok) return;
    // Same OPEN-preferred contract as the bridge.
    assert.equal(one.pr?.number, 8);

    const dec = await getPrReviewDecision(workspaceDir, 8);
    assert.deepEqual(dec, {
      ok: true,
      reviewDecision: "APPROVED",
      bodyVerdict: "APROBADO",
      labels: ["review:aprobado"],
      headRefOid: "h2",
      lastReviewCommitId: "h2",
    });

    assert.deepEqual(await getPrComments(workspaceDir, 8), {
      ok: true,
      text: "nit: rename",
    });

    // Clean merge on the stub (merge never throws) → no conflicts.
    assert.deepEqual(await getConflictFiles(workspaceDir, "b", 8), {
      ok: true,
      conflictFiles: [],
    });
  } finally {
    clearWindow();
    await stopHeadlessServer(harness);
  }
});

test("web mode sin daemon: degradación honesta, sin throws", async () => {
  setWindowFor(9);
  try {
    for (const result of [
      await findOpenPrsForIssue("/repo", 5),
      await findPrForIssue("/repo", 5),
      await getPrReviewDecision("/repo", 8),
      await getPrComments("/repo", 8),
      await applyReviewLabel("/repo", 8, "APPROVED"),
      await applyCycleLabel("/repo", 8, 5, "review:aprobado"),
      await syncIssueReviewLabel("/repo", 5, []),
      await getConflictFiles("/repo", "b", 8),
    ]) {
      assert.equal(result.ok, false);
      assert.ok(
        (result as { error: string }).error.length > 0,
        "error must explain itself",
      );
    }
  } finally {
    clearWindow();
  }
});

test("web mode: label writes via daemon HTTP (bridge parity)", async () => {
  const workspaceDir = createWorkspaceFixture({ "README.md": "hi\n" });
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "parity-writes");
  const harness = await startHeadlessServer({
    workspaceDir,
    projectStore,
    ghExec: stubGh,
  });
  setWindowFor(harness.port);
  try {
    assert.deepEqual(
      await applyReviewLabel(workspaceDir, 8, "APPROVED"),
      { ok: true },
    );
    assert.deepEqual(
      await applyCycleLabel(workspaceDir, 8, 5, "review:fix-aplicado"),
      { ok: true },
    );
    assert.deepEqual(
      await syncIssueReviewLabel(workspaceDir, 5, ["review:aprobado"]),
      { ok: true },
    );
  } finally {
    clearWindow();
    await stopHeadlessServer(harness);
  }
});
