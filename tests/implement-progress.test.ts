// implement-progress: the implement turn waits on PROGRESS, not a fixed
// ceiling. While the model emits parts/text the turn lives (up to the
// absolute cap); stalled turns abort on idle. Verified live 2026-09-07:
// partial parts are visible via messages() mid-generation.
// Offline: injected fakes, millisecond windows, zero network.
import test from "node:test";
import assert from "node:assert/strict";
import {
  awaitPromptWithProgress,
  type PromptProgressMetric,
} from "../headless-runtime/implement/implementAgent.ts";
import {
  IMPLEMENT_LLM_TIMEOUT_MS,
  IMPLEMENT_PROGRESS_IDLE_MS,
  IMPLEMENT_PROGRESS_POLL_MS,
} from "../shared/types/implement.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function metric(parts: number, textLen: number): PromptProgressMetric {
  return { parts, textLen };
}

test("progress constants fit real tool loops", () => {
  assert.equal(IMPLEMENT_PROGRESS_POLL_MS, 20_000);
  assert.equal(IMPLEMENT_PROGRESS_IDLE_MS, 180_000);
  assert.equal(IMPLEMENT_LLM_TIMEOUT_MS, 3_600_000);
});

test("resolves the prompt text on success", async () => {
  const out = await awaitPromptWithProgress({
    start: async () => "hecho",
    poll: async () => metric(1, 5),
    idleMs: 500,
    absoluteMs: 2000,
    intervalMs: 10,
    label: "t",
  });
  assert.equal(out, "hecho");
});

test("sync-throwing start rejects", async () => {
  await assert.rejects(
    awaitPromptWithProgress({
      start: () => {
        throw new Error("boom sync");
      },
      poll: async () => metric(0, 0),
      idleMs: 500,
      absoluteMs: 2000,
      intervalMs: 10,
      label: "t",
    }),
    /boom sync/,
  );
});

test("aborts a stalled turn on idle and aborts the fetch", async () => {
  let aborted = false;
  const pending = new Promise<unknown>(() => {});
  const start = (signal: AbortSignal): Promise<unknown> => {
    try {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
    } catch {}
    return pending;
  };
  await assert.rejects(
    awaitPromptWithProgress({
      start,
      poll: async () => metric(2, 40),
      idleMs: 80,
      absoluteMs: 5000,
      intervalMs: 10,
      label: "t-idle",
    }),
    /idle timeout/,
  );
  assert.equal(aborted, true);
});

test("slow-but-progressing turns survive past the idle window", async () => {
  let polls = 0;
  const out = await awaitPromptWithProgress({
    start: async () => {
      await sleep(120);
      return "tarde pero llega";
    },
    poll: async () => {
      polls += 1;
      return metric(polls, polls * 10);
    },
    idleMs: 60,
    absoluteMs: 5000,
    intervalMs: 10,
    label: "t-prog",
  });
  assert.equal(out, "tarde pero llega");
  assert.ok(polls >= 3, "must have polled while working");
});

test("absolute cap fires even with progress", async () => {
  let polls = 0;
  await assert.rejects(
    awaitPromptWithProgress({
      start: () => new Promise<unknown>(() => {}),
      poll: async () => {
        polls += 1;
        return metric(polls, polls * 10);
      },
      idleMs: 60_000,
      absoluteMs: 120,
      intervalMs: 10,
      label: "t-abs",
    }),
    /absolute timeout/,
  );
});

test("failing polls do not fake progress (stall still aborts)", async () => {
  await assert.rejects(
    awaitPromptWithProgress({
      start: () => new Promise<unknown>(() => {}),
      poll: async () => {
        throw new Error("poll down");
      },
      idleMs: 80,
      absoluteMs: 5000,
      intervalMs: 10,
      label: "t-pollfail",
    }),
    /idle timeout/,
  );
});
