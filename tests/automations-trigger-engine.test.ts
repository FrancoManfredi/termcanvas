/**
 * Wave 14 T02 (Track A) — triggerEngine pure decisions.
 * node:test + tsx, offline, zero I/O. Covers schedule/event evaluation,
 * kill-switches (0 = off), quota/cooldown, cron matching, exactly-one
 * fail-closed, and the dedupe FIFO cap.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_SEEN_EVENT_CAP,
  cronMatchesMinute,
  defaultEngineState,
  evaluateDue,
  evaluateEvent,
  isCooldownOver,
  isDuplicateEvent,
  isQuotaLeft,
  isScheduleDue,
  pushSeenEvent,
  type EventTriggerLike,
  type ScheduleTriggerLike,
} from "../headless-runtime/factory/automations/triggerEngine.ts";

const T0 = Date.UTC(2026, 8, 5, 3, 0, 0); // Saturday 2026-09-05 03:00 UTC

function schedule(
  over: Partial<ScheduleTriggerLike> = {},
): ScheduleTriggerLike {
  return {
    kind: "schedule",
    name: "nightly",
    enabled: true,
    maxFires: 5,
    cooldownMs: 60000,
    intervalMs: 86400000,
    promptRef: "factory/prompts/nightly.md",
    ...over,
  };
}

function eventTrigger(over: Partial<EventTriggerLike> = {}): EventTriggerLike {
  return {
    kind: "event",
    name: "announce",
    enabled: true,
    maxFires: 20,
    cooldownMs: 60000,
    on: "ask_human",
    action: "notify-integration",
    ...over,
  };
}

test("schedule: first fire with interval is due", { timeout: 15000 }, () => {
  const due = evaluateDue([schedule()], {}, T0);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.triggerName, "nightly");
  assert.equal(due[0]?.action, "create-job");
  assert.equal(due[0]?.eventId, null);
});

test("schedule: not due inside the interval window", { timeout: 15000 }, () => {
  const at = new Date(T0).toISOString();
  const due = evaluateDue([schedule()], { nightly: { fires: 1, lastFireAt: at } }, T0 + 1000);
  assert.equal(due.length, 0);
});

test("schedule: due once the interval elapsed", { timeout: 15000 }, () => {
  const at = new Date(T0 - 86400000).toISOString();
  const due = evaluateDue([schedule()], { nightly: { fires: 1, lastFireAt: at } }, T0);
  assert.equal(due.length, 1);
});

test("schedule: quota exhausted blocks firing (maxFires reached)", { timeout: 15000 }, () => {
  const at = new Date(T0 - 86400000 * 10).toISOString();
  const due = evaluateDue(
    [schedule({ maxFires: 2 })],
    { nightly: { fires: 2, lastFireAt: at } },
    T0,
  );
  assert.equal(due.length, 0);
  assert.equal(isQuotaLeft({ fires: 2, lastFireAt: at }, { maxFires: 2 }), false);
});

test("schedule: maxFires 0 never fires (0 = off)", { timeout: 15000 }, () => {
  const due = evaluateDue([schedule({ maxFires: 0 })], {}, T0);
  assert.equal(due.length, 0);
});

test("schedule: disabled trigger never fires", { timeout: 15000 }, () => {
  const due = evaluateDue([schedule({ enabled: false })], {}, T0);
  assert.equal(due.length, 0);
});

test("schedule: cooldown blocks a due interval", { timeout: 15000 }, () => {
  const at = new Date(T0 - 1000).toISOString();
  const t = schedule({ intervalMs: 1000, cooldownMs: 60000 });
  assert.equal(isScheduleDue(t, { fires: 1, lastFireAt: at }, T0), true);
  assert.equal(isCooldownOver({ fires: 1, lastFireAt: at }, t, T0), false);
  const due = evaluateDue([t], { nightly: { fires: 1, lastFireAt: at } }, T0);
  assert.equal(due.length, 0);
});

test("schedule: cooldownMs 0 equals no cooldown", { timeout: 15000 }, () => {
  assert.equal(
    isCooldownOver({ fires: 3, lastFireAt: new Date(T0).toISOString() }, { cooldownMs: 0 }, T0),
    true,
  );
});

test("schedule: cron minute-exact match fires", { timeout: 15000 }, () => {
  const t = schedule({ intervalMs: undefined, cron: "0 3 * * *" });
  assert.equal(cronMatchesMinute("0 3 * * *", T0), true);
  const due = evaluateDue([t], {}, T0);
  assert.equal(due.length, 1);
});

test("schedule: cron mismatch does not fire", { timeout: 15000 }, () => {
  assert.equal(cronMatchesMinute("15 3 * * *", T0), false);
  const t = schedule({ intervalMs: undefined, cron: "15 3 * * *" });
  const due = evaluateDue([t], {}, T0);
  assert.equal(due.length, 0);
});

test("schedule: exactly-one violation fails closed (both set)", { timeout: 15000 }, () => {
  const t = schedule({ intervalMs: 1000, cron: "0 3 * * *" });
  assert.equal(isScheduleDue(t, defaultEngineState(), T0), false);
  assert.equal(evaluateDue([t], {}, T0).length, 0);
});

test("schedule: exactly-one violation fails closed (neither set)", { timeout: 15000 }, () => {
  const t = schedule({ intervalMs: undefined, cron: undefined });
  assert.equal(isScheduleDue(t, defaultEngineState(), T0), false);
});

test("schedule: malformed cron fails closed", { timeout: 15000 }, () => {
  assert.equal(cronMatchesMinute("not-a-cron", T0), false);
  assert.equal(cronMatchesMinute("0 3 * *", T0), false);
  const t = schedule({ intervalMs: undefined, cron: "not-a-cron" });
  assert.equal(evaluateDue([t], {}, T0).length, 0);
});

test("schedule: at most one action per trigger per tick", { timeout: 15000 }, () => {
  const due = evaluateDue([schedule(), schedule({ name: "second" })], {}, T0);
  assert.equal(due.length, 2);
  const names = due.map((d) => d.triggerName).sort();
  assert.deepEqual(names, ["nightly", "second"]);
});

test("event: matching kind fires once with the event id", { timeout: 15000 }, () => {
  const out = evaluateEvent(
    eventTrigger(),
    defaultEngineState(),
    { id: "evt-1", kind: "ask_human", jobId: "job-x" },
    T0,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]?.eventId, "evt-1");
  assert.equal(out[0]?.action, "notify-integration");
});

test("event: kind mismatch fires nothing", { timeout: 15000 }, () => {
  const out = evaluateEvent(
    eventTrigger(),
    defaultEngineState(),
    { id: "evt-1", kind: "job-complete" },
    T0,
  );
  assert.equal(out.length, 0);
});

test("event: disabled / quota / cooldown block firing", { timeout: 15000 }, () => {
  const evt = { id: "evt-1", kind: "ask_human" };
  assert.equal(evaluateEvent(eventTrigger({ enabled: false }), defaultEngineState(), evt, T0).length, 0);
  assert.equal(
    evaluateEvent(eventTrigger({ maxFires: 1 }), { fires: 1, lastFireAt: null }, evt, T0).length,
    0,
  );
  const at = new Date(T0 - 1000).toISOString();
  assert.equal(
    evaluateEvent(eventTrigger(), { fires: 1, lastFireAt: at }, evt, T0).length,
    0,
  );
});

test("dedupe helpers: probe plus FIFO cap 500", { timeout: 15000 }, () => {
  assert.equal(AUTOMATION_SEEN_EVENT_CAP, 500);
  const seen: string[] = [];
  assert.equal(isDuplicateEvent(seen, "a"), false);
  pushSeenEvent(seen, "a");
  assert.equal(isDuplicateEvent(seen, "a"), true);
  pushSeenEvent(seen, "a");
  assert.equal(seen.length, 1);
  for (let i = 0; i < 600; i++) {
    seen.push(`bulk-${i}`);
  }
  pushSeenEvent(seen, "last");
  assert.ok(seen.length <= AUTOMATION_SEEN_EVENT_CAP);
  assert.equal(seen.includes("a"), false);
  assert.equal(seen[seen.length - 1], "last");
});
