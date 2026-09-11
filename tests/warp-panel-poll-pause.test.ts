/**
 * warp-panel-poll-pause — perf Ola 1 (Agents + sidebar re-render storm).
 *
 * Root cause: `WarpPanelShell` mounted `useWorkItemsPolling(true)` + always
 * subscribed `useIssues()` even in Agents (config-only). Every 2.5s tick did
 * `setWorkItems(newIdentity)` → shell re-render → `AgentsPanel/AgentConfig`
 * re-render (with `JSON.stringify` dirty check over the full agent.md body)
 * → jank while typing. `WarpSidePanel` also rebuilt the repo picker inline
 * on every project-store churn.
 *
 * Fix (3 files):
 * - `panelSection.ts: shouldEnableFactoryPoll` — false in Agents (paused,
 *   user-approved stale), true elsewhere.
 * - `WarpPanelShell.tsx` — passes the gate into `useWorkItemsPolling`.
 * - `WarpSidePanel.tsx: deriveWarpRepos` — pure + `useMemo`d.
 * Offline: pure, zero network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { shouldEnableFactoryPoll } from "../src/features/warpPanel/panelSection.ts";
import { deriveWarpRepos } from "../src/features/warpPanel/components/WarpSidePanel.tsx";
import {
  POLL_BACKOFF_EVERY,
  foremanLogsUrl,
  initialPollHealth,
  recordPollSample,
  rotateWindow,
  shouldRunPollTick,
} from "../src/features/factoryLab/hooks/useWorkItemsPolling.ts";

test("factory poll pauses in Agents, stays live elsewhere", () => {
  assert.equal(shouldEnableFactoryPoll("agents"), false);
  assert.equal(shouldEnableFactoryPoll("issues"), true);
  assert.equal(shouldEnableFactoryPoll("activity"), true);
  assert.equal(shouldEnableFactoryPoll("context"), true);
  assert.equal(shouldEnableFactoryPoll("diagnostic"), true);
});

test("poll gate never throws on junk (defaults to live)", () => {
  assert.equal(shouldEnableFactoryPoll(undefined as never), true);
  assert.equal(shouldEnableFactoryPoll(null as never), true);
  assert.equal(shouldEnableFactoryPoll("junk" as never), true);
});

test("deriveWarpRepos maps id/name/primary-branch", () => {
  const repos = deriveWarpRepos([
    {
      id: "p1",
      name: "termcanvas",
      worktrees: [
        { name: "main", isPrimary: true },
        { name: "feat", isPrimary: false },
      ],
    },
    { id: "p2", name: "other", worktrees: [{ name: "dev" }] },
  ]);
  assert.equal(repos.length, 2);
  assert.deepEqual(repos[0], {
    projectId: "p1",
    name: "termcanvas",
    branch: "main",
  });
  assert.deepEqual(repos[1], {
    projectId: "p2",
    name: "other",
    branch: "dev",
  });
});

test("deriveWarpRepos degrades junk to honest-empty", () => {
  assert.deepEqual(deriveWarpRepos(null), []);
  assert.deepEqual(deriveWarpRepos(undefined), []);
  assert.deepEqual(deriveWarpRepos("junk"), []);
  assert.deepEqual(deriveWarpRepos([null, 42, { id: "", name: "" }]), []);
});

// ─── Ola C3: circuit-breaker del poll ───────────────────────────────────
// Dos ticks lentos/grandes seguidos ⇒ degradado + backoff 1 de N;
// un tick sano recupera. El gate decide correr o saltear.

test("healthy ticks always run, single bad tick only counts", () => {
  let h = initialPollHealth();
  let gate = shouldRunPollTick(h);
  assert.equal(gate.run, true);
  h = recordPollSample(gate.health, { slow: false, big: false });
  assert.equal(h.degraded, false);
  h = recordPollSample(h, { slow: true, big: false });
  assert.equal(h.degraded, false);
  assert.equal(h.streak, 1);
});

test("two bad ticks degrade and throttle to 1 of N", () => {
  let h = recordPollSample(initialPollHealth(), { slow: true, big: false });
  h = recordPollSample(h, { slow: false, big: true });
  assert.equal(h.degraded, true);
  let runs = 0;
  for (let i = 0; i < POLL_BACKOFF_EVERY; i += 1) {
    const gate = shouldRunPollTick(h);
    h = gate.health;
    if (gate.run) runs += 1;
  }
  assert.equal(runs, 1);
});

test("one healthy tick recovers, junk never throws", () => {
  let h = recordPollSample(initialPollHealth(), { slow: true, big: false });
  h = recordPollSample(h, { slow: true, big: false });
  assert.equal(h.degraded, true);
  h = recordPollSample(h, { slow: false, big: false });
  assert.deepEqual(h, { streak: 0, skipLeft: 0, degraded: false });
  const gate = shouldRunPollTick(h);
  assert.equal(gate.run, true);
  assert.deepEqual(shouldRunPollTick(null as never).run, true);
  assert.deepEqual(
    recordPollSample(null as never, { slow: false, big: false }).degraded,
    false,
  );
});

test("foreman logs URL only for opted-in surfaces (P0a)", () => {
  assert.equal(
    foremanLogsUrl(17680, true),
    "http://127.0.0.1:17680/foreman/logs?limit=100",
  );
  assert.equal(foremanLogsUrl(17680, false), null);
  assert.equal(foremanLogsUrl(0, true), null);
  assert.equal(foremanLogsUrl(Number.NaN, true), null);
  assert.equal(foremanLogsUrl(17680, null as never), null);
});

test("rotateWindow spreads seed refresh without losing rows (P1a)", () => {
  const ids = [1, 2, 3, 4, 5];
  const first = rotateWindow(ids, 0, 2);
  assert.deepEqual(first.batch, [1, 2]);
  const second = rotateWindow(ids, first.nextCursor, 2);
  assert.deepEqual(second.batch, [3, 4]);
  const third = rotateWindow(ids, second.nextCursor, 2);
  assert.deepEqual(third.batch, [5, 1], "wraps around");
  assert.deepEqual(rotateWindow([], 0, 2), { batch: [], nextCursor: 0 });
  assert.deepEqual(rotateWindow([1], 0, 8).batch, [1]);
  assert.deepEqual(rotateWindow(null as never, 0, 2).batch, []);
  assert.deepEqual(rotateWindow(ids, -1, 2).batch, [1, 2]);
  assert.deepEqual(rotateWindow(ids, 0, 0).batch, [1, 2, 3, 4, 5].slice(0, 8));
});
