import test from "node:test";
import assert from "node:assert/strict";
import { ProjectStore } from "../headless-runtime/project-store.ts";
import type { GhExecFn } from "../headless-runtime/github-lookups.ts";
import {
  addProjectWithMainWorktree,
  createWorkspaceFixture,
  startHeadlessServer,
  stopHeadlessServer,
} from "./headless-runtime-test-helpers.ts";

const stubGh: GhExecFn = async (file, args) => {
  if (file === "git" && args[0] === "remote") {
    return { stdout: "https://github.com/acme/repo.git\n", stderr: "" };
  }
  if (args[0] === "pr" && args.includes("body")) {
    return { stdout: "Fixes #5\n", stderr: "" };
  }
  if (args.includes("graphql")) {
    return {
      stdout: JSON.stringify({
        data: {
          repository: {
            issue: {
              closedByPullRequestsReferences: {
                nodes: [
                  { number: 12, title: "fix", url: "u", state: "OPEN", headRefName: "b", headRefOid: "h2" },
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
    return { stdout: "looks good\n", stderr: "" };
  }
  return {
    stdout: JSON.stringify({
      decision: "APPROVED",
      headRefOid: "h2",
      reviews: [
        {
          state: "APPROVED",
          body: "VEREDICTO: APROBADO.\nsolid",
          submittedAt: "2026-01-02T00:00:00Z",
          commitOid: "h2",
        },
      ],
      labels: ["review:aprobado"],
    }),
    stderr: "",
  };
};

async function startGithubServer() {
  const workspaceDir = createWorkspaceFixture({ "README.md": "hi\n" });
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "gh-repo");
  return {
    workspaceDir,
    harness: await startHeadlessServer({
      workspaceDir,
      projectStore,
      ghExec: stubGh,
    }),
  };
}

test("GET /github/issues/:n/prs returns prs + preferred (bridge parity)", async () => {
  const { workspaceDir, harness } = await startGithubServer();
  try {
    const res = await fetch(
      `${harness.baseUrl}/github/issues/5/prs?repo=${encodeURIComponent(workspaceDir)}`,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      prs: Array<{ number: number }>;
      preferred: { number: number } | null;
    };
    assert.equal(body.ok, true);
    assert.equal(body.prs.length, 1);
    assert.equal(body.preferred?.number, 12);

    const missing = await fetch(`${harness.baseUrl}/github/issues/5/prs`);
    assert.equal(missing.status, 400);
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("GET /github/prs/:n/decision folds the verdict like the bridge", async () => {
  const { workspaceDir, harness } = await startGithubServer();
  try {
    const res = await fetch(
      `${harness.baseUrl}/github/prs/12/decision?repo=${encodeURIComponent(workspaceDir)}`,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      reviewDecision: string;
      bodyVerdict: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.reviewDecision, "APPROVED");
    assert.equal(body.bodyVerdict, "APROBADO");
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("POST /github/prs/:n/review-label flips the verdict label", async () => {
  const { workspaceDir, harness } = await startGithubServer();
  try {
    const res = await fetch(
      `${harness.baseUrl}/github/prs/12/review-label`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: workspaceDir, verdict: "APPROVED" }),
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const missing = await fetch(
      `${harness.baseUrl}/github/prs/12/review-label`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "APPROVED" }),
      },
    );
    assert.equal(missing.status, 400);
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("POST /github/prs/:n/cycle-label validates before spawning", async () => {
  const { workspaceDir, harness } = await startGithubServer();
  try {
    const res = await fetch(
      `${harness.baseUrl}/github/prs/12/cycle-label`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: workspaceDir,
          label: "review:fix-aplicado",
          issueNumber: 5,
        }),
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const bad = await fetch(
      `${harness.baseUrl}/github/prs/12/cycle-label`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: workspaceDir, label: "bug" }),
      },
    );
    assert.equal(bad.status, 200);
    const badBody = (await bad.json()) as { ok: boolean };
    assert.equal(badBody.ok, false);
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("POST /github/issues/:n/review-label mirrors canonical", async () => {
  const { workspaceDir, harness } = await startGithubServer();
  try {
    const res = await fetch(
      `${harness.baseUrl}/github/issues/5/review-label`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: workspaceDir, prLabels: ["review:aprobado"] }),
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("GET /github/prs/:n/conflict-files runs the git dance", async () => {
  const seen: string[][] = [];
  const gitStub: GhExecFn = async (file, args) => {
    seen.push([file, ...args]);
    if (args[0] === "merge" && !args.includes("--abort")) {
      throw new Error("Auto-merging failed");
    }
    if (args[0] === "diff") return { stdout: "src/clash.ts\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const workspaceDir = createWorkspaceFixture({ "README.md": "hi\n" });
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "gh-conflict");
  const harness = await startHeadlessServer({
    workspaceDir,
    projectStore,
    ghExec: gitStub,
  });
  try {
    const res = await fetch(
      `${harness.baseUrl}/github/prs/12/conflict-files?repo=${encodeURIComponent(workspaceDir)}&branch=${encodeURIComponent("feat")}`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      ok: true,
      conflictFiles: ["src/clash.ts"],
    });

    const missing = await fetch(
      `${harness.baseUrl}/github/prs/12/conflict-files?repo=${encodeURIComponent(workspaceDir)}`,
    );
    assert.equal(missing.status, 400);
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("GET /github/prs/:n/comments returns thread text", async () => {
  const { workspaceDir, harness } = await startGithubServer();
  try {
    const res = await fetch(
      `${harness.baseUrl}/github/prs/12/comments?repo=${encodeURIComponent(workspaceDir)}`,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; text: string };
    assert.deepEqual(body, { ok: true, text: "looks good" });
  } finally {
    await stopHeadlessServer(harness);
  }
});
