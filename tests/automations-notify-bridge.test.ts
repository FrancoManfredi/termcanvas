/**
 * D18 event path — notify → fireEvent bridge (offline, no daemon).
 * node:test + tsx, sandbox factory dir (TERMCANVAS_FACTORY_DIR).
 *
 * Covers the live seam the seed `announce-ask-human` trigger was missing:
 * a human-born ask_human/proposal-ready notification becomes exactly one
 * fireEvent({id, kind, jobId}) with the notification id as the event id.
 * - happy path: ask_human → 1 mock notify-integration post + ring evidence
 * - proposal-ready bridges too (1:1 kind map)
 * - dedupe: identical content twice = 1 creation = 1 post
 * - quota + cooldown gate distinct second events (engine reuse)
 * - anti-loop: trigger-born (flag, title prefix, dedupe namespace) never
 *   re-emits — the suite terminates (no unbounded chain)
 * - kill-switches: automations.enabled:false and per-trigger enabled:false
 *   stop emission (no post, no fire record)
 * - non-event kinds (spec-approval/benchmark-done/daemon-error) never emit
 * - registry: idempotent arming, hard cap, thrower isolation
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "auto-bridge-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

import {
  addNotificationCreatedListener,
  getNotificationListenerCountForTests,
  listNotifications,
  notify,
  removeNotificationCreatedListener,
  resetNotificationsForTests,
  resetNotificationsOverrideForTests,
  setNotificationsOverrideForTests,
} from "../headless-runtime/notify/notifications.ts";
import {
  ensureAutomationNotifyBridge,
  getSeenEventIdsForTests,
  isAutomationNotifyBridgeArmed,
  resetAutomationServiceForTests,
  setAutomationsConfigForTests,
  setDefaultAutomationDeps,
  type AutomationsConfig,
} from "../headless-runtime/factory/automations/automationService.ts";
import {
  readFires,
  resetAutomationStoreForTests,
} from "../headless-runtime/factory/automations/automationStore.ts";

interface BridgeCalls {
  posts: number;
  created: number;
  notified: number;
  lastPostJobId: string | null;
}

function eventCfg(
  on: "ask_human" | "proposal-ready" = "ask_human",
  over: Partial<AutomationsConfig> = {},
  triggerOver: Record<string, unknown> = {},
): AutomationsConfig {
  return {
    enabled: true,
    tickMs: 30000,
    triggers: [
      {
        kind: "event",
        name: "announce-ask-human",
        enabled: true,
        maxFires: 20,
        cooldownMs: 0,
        on,
        action: "notify-integration",
        ...triggerOver,
      },
    ],
    ...over,
  };
}

function freshBridge(cfg: AutomationsConfig): BridgeCalls {
  try {
    fs.rmSync(SANDBOX_FACTORY, { recursive: true, force: true });
  } catch {
    // first run: nothing to clear
  }
  resetAutomationStoreForTests();
  resetAutomationServiceForTests();
  resetNotificationsForTests();
  resetNotificationsOverrideForTests();
  setNotificationsOverrideForTests(true);
  const calls: BridgeCalls = { posts: 0, created: 0, notified: 0, lastPostJobId: null };
  setAutomationsConfigForTests(cfg);
  setDefaultAutomationDeps({
    createJob: () => {
      calls.created += 1;
      return { ok: true, jobId: `job-bridge-${calls.created}` };
    },
    notifyTrigger: () => {
      calls.notified += 1;
    },
    postIntegration: (input) => {
      calls.posts += 1;
      calls.lastPostJobId = input.jobId;
      return { ok: true, id: `mock-post-${calls.posts}` };
    },
  });
  ensureAutomationNotifyBridge();
  return calls;
}

test.after(() => {
  try {
    resetAutomationStoreForTests();
  } catch {}
  try {
    resetAutomationServiceForTests();
  } catch {}
  try {
    resetNotificationsForTests();
  } catch {}
  try {
    resetNotificationsOverrideForTests();
  } catch {}
  try {
    fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  } catch {}
});

test("bridge arms exactly once (idempotent)", { timeout: 15000 }, () => {
  freshBridge(eventCfg());
  assert.equal(isAutomationNotifyBridgeArmed(), true);
  assert.equal(ensureAutomationNotifyBridge(), true);
  assert.equal(getNotificationListenerCountForTests(), 1);
});

test("ask_human notify emits one notify-integration post with job passthrough", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg());
  const n = notify({
    kind: "ask_human",
    workItemId: "job-bridge-1",
    title: "Revision needs your decision",
    body: "Should I approve the change?",
  });
  assert.ok(n && typeof n.id === "string");
  assert.equal(calls.posts, 1);
  assert.equal(calls.lastPostJobId, "job-bridge-1");
  assert.equal(calls.created, 0);
  const fires = readFires();
  assert.equal(fires.length, 1);
  assert.equal(fires[0]?.triggerName, "announce-ask-human");
  assert.equal(fires[0]?.kind, "event");
  assert.equal(fires[0]?.action, "notify-integration");
  assert.equal(fires[0]?.result, "notified");
  assert.equal(fires[0]?.eventId, n!.id);
  assert.ok(getSeenEventIdsForTests().includes(n!.id));
});

test("proposal-ready notify bridges 1:1 when a trigger listens to it", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg("proposal-ready"));
  const n = notify({
    kind: "proposal-ready",
    title: "Proposal ready for review",
    body: "proposal imp-9 ready",
  });
  assert.ok(n);
  assert.equal(calls.posts, 1);
  assert.equal(calls.lastPostJobId, null);
  assert.equal(readFires().length, 1);
});

test("dedupe: identical content twice creates once and posts once", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg());
  const first = notify({
    kind: "ask_human",
    workItemId: "job-dedupe-1",
    title: "Revision needs your decision",
    body: "Approve?",
  });
  const second = notify({
    kind: "ask_human",
    workItemId: "job-dedupe-1",
    title: "Revision needs your decision",
    body: "Approve?",
  });
  assert.ok(first && second);
  assert.equal(second!.id, first!.id);
  assert.equal(calls.posts, 1);
  assert.equal(readFires().length, 1);
});

test("quota: maxFires 1 lets the first event through and skips the second", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg("ask_human", {}, { maxFires: 1, cooldownMs: 0 }));
  const a = notify({
    kind: "ask_human",
    workItemId: "job-q-1",
    title: "First question",
    body: "first body",
  });
  const b = notify({
    kind: "ask_human",
    workItemId: "job-q-2",
    title: "Second question",
    body: "second body",
  });
  assert.ok(a && b && a.id !== b.id);
  assert.equal(calls.posts, 1);
  assert.equal(readFires().length, 1);
  assert.deepEqual(getSeenEventIdsForTests(), [a!.id, b!.id]);
});

test("cooldown: a second distinct event inside the window does not post", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg("ask_human", {}, { maxFires: 5, cooldownMs: 3600000 }));
  const a = notify({
    kind: "ask_human",
    workItemId: "job-c-1",
    title: "First question",
    body: "first body",
  });
  const b = notify({
    kind: "ask_human",
    workItemId: "job-c-2",
    title: "Second question",
    body: "second body",
  });
  assert.ok(a && b && a.id !== b.id);
  assert.equal(calls.posts, 1);
  assert.equal(readFires().length, 1);
});

test("anti-loop: trigger-born proposal-ready is stored but never re-emits", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg());
  const inner = notify({
    kind: "proposal-ready",
    title: "Proposal ready for review",
    body: "born from a trigger effect",
    fromAutomation: true,
  });
  assert.ok(inner);
  assert.equal(calls.posts, 0);
  assert.equal(readFires().length, 0);
  assert.equal(getSeenEventIdsForTests().length, 0);
});

test("anti-loop end to end: a posting trigger terminates (no chain)", { timeout: 15000 }, () => {
  try {
    fs.rmSync(SANDBOX_FACTORY, { recursive: true, force: true });
  } catch {}
  resetAutomationStoreForTests();
  resetAutomationServiceForTests();
  resetNotificationsForTests();
  resetNotificationsOverrideForTests();
  setNotificationsOverrideForTests(true);
  let posts = 0;
  setAutomationsConfigForTests(eventCfg());
  // Mirrors defaultPostIntegration: the post itself notifies the center
  // with the automation mark, which the bridge must skip.
  setDefaultAutomationDeps({
    postIntegration: (input) => {
      posts += 1;
      notify({
        kind: "proposal-ready",
        title: `[integration-mock] ${input.title}`.slice(0, 200),
        body: `${input.body}${input.jobId ? ` (job ${input.jobId})` : ""}`.slice(0, 2000),
        fromAutomation: true,
      });
      return { ok: true, id: `mock-post-${posts}` };
    },
  });
  ensureAutomationNotifyBridge();
  const n = notify({
    kind: "ask_human",
    workItemId: "job-chain-1",
    title: "Revision needs your decision",
    body: "Approve?",
  });
  assert.ok(n);
  assert.equal(posts, 1);
  assert.equal(listNotifications().length, 2);
  assert.equal(readFires().length, 1);
  assert.deepEqual(getSeenEventIdsForTests(), [n!.id]);
});

test("spoof guards: automation title prefix and dedupe namespace never emit", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg());
  const a = notify({
    kind: "ask_human",
    workItemId: "job-spoof-1",
    title: "[automation] announce-ask-human fired",
    body: "hand-built without the flag",
  });
  const b = notify({
    kind: "ask_human",
    workItemId: "job-spoof-2",
    title: "A real looking question",
    body: "spoofed namespace",
    dedupeKey: "automation:spoof:1",
  });
  assert.ok(a && b);
  assert.equal(calls.posts, 0);
  assert.equal(readFires().length, 0);
  assert.equal(getSeenEventIdsForTests().length, 0);
});

test("kill-switch: automations.enabled false stops emission", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg("ask_human", { enabled: false }));
  const n = notify({
    kind: "ask_human",
    workItemId: "job-kill-1",
    title: "Revision needs your decision",
    body: "Approve?",
  });
  assert.ok(n);
  assert.equal(calls.posts, 0);
  assert.equal(readFires().length, 0);
});

test("kill-switch: per-trigger enabled false stops emission", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg("ask_human", {}, { enabled: false }));
  const n = notify({
    kind: "ask_human",
    workItemId: "job-kill-2",
    title: "Revision needs your decision",
    body: "Approve?",
  });
  assert.ok(n);
  assert.equal(calls.posts, 0);
  assert.equal(readFires().length, 0);
});

test("non-event kinds never reach the event engine", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg());
  const kinds = ["spec-approval", "benchmark-done", "daemon-error"] as const;
  kinds.forEach((kind, i) => {
    const n = notify({ kind, title: `t-${kind}`, body: `b-${kind}-${i}` });
    assert.ok(n);
  });
  assert.equal(calls.posts, 0);
  assert.equal(readFires().length, 0);
  assert.equal(getSeenEventIdsForTests().length, 0);
});

test("a throwing listener never breaks notify nor its siblings", { timeout: 15000 }, () => {
  const calls = freshBridge(eventCfg());
  const bomb = () => {
    throw new Error("listener boom");
  };
  assert.equal(addNotificationCreatedListener(bomb), true);
  try {
    const n = notify({
      kind: "ask_human",
      workItemId: "job-iso-1",
      title: "Revision needs your decision",
      body: "Approve?",
    });
    assert.ok(n);
    assert.equal(calls.posts, 1);
  } finally {
    removeNotificationCreatedListener(bomb);
  }
});

test("registry caps subscribers and stays fail-closed", { timeout: 15000 }, () => {
  freshBridge(eventCfg());
  const dummies: Array<() => void> = [];
  for (let i = 0; i < 7; i++) {
    const fn = () => {};
    dummies.push(fn);
    assert.equal(addNotificationCreatedListener(fn), true);
  }
  assert.equal(getNotificationListenerCountForTests(), 8);
  assert.equal(
    addNotificationCreatedListener(() => {}),
    false,
  );
  // A human event still emits exactly once with a full registry.
  const n = notify({
    kind: "ask_human",
    workItemId: "job-cap-1",
    title: "Revision needs your decision",
    body: "Approve?",
  });
  assert.ok(n);
  dummies.forEach((fn) => removeNotificationCreatedListener(fn));
  assert.equal(getNotificationListenerCountForTests(), 1);
  assert.equal(isAutomationNotifyBridgeArmed(), true);
});
