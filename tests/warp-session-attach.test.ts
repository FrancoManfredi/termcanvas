/**
 * warp-session-attach — B5: "View Agent" never enables, honestly.
 *
 * Root cause: the session link (`dashboardUrl`) is set only when a daemon
 * `session.create` succeeds
 * (headless-runtime/factory/factoryServer.ts `syncSessionFieldsAndPersist`);
 * per-role pipeline sessions never backfill the top-level link, so a job
 * whose MVP handshake failed shows no link at ANY stage — including
 * Review, where the user most expects "View Agent". The old UI disabled
 * the CTA with one generic line forever.
 *
 * Fix: the CTA title now spells out the exact condition with a visible
 * wait state — attaching (elapsed) while within
 * `SESSION_ATTACH_TIMEOUT_MS`, overdue (never-attached-on-this-path) past
 * it — driven by `sessionAttachState` over the adapter-parsed
 * `jobCreatedAtMs`. The URL is still never synthesized. Offline: pure,
 * zero network, zero jobs created.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  describeActivityActions,
  describeFactorySessionLine,
  type DescribeActivityActionsArgs,
} from "../src/features/warpPanel/components/activityActions.ts";
import { SESSION_ATTACH_TIMEOUT_MS } from "../src/features/warpPanel/adapters/factoryJobIndex.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const NOW = 1_800_000_000_000;

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
    nowMs: NOW,
    ...patch,
  };
}

function sessionOf(
  defs: ReturnType<typeof describeActivityActions>,
): { enabled: boolean; title?: string } {
  const def = defs.find((d) => d.kind === "session");
  assert.ok(def !== undefined);
  return { enabled: def.enabled, title: def.title };
}

test("ready: live URL enables View Agent with the open-in-tab title", () => {
  const s = sessionOf(
    describeActivityActions(
      baseArgs({
        factory: {
          available: true,
          active: true,
          sessionUrl: "http://127.0.0.1:4096/abc/session/ses_1",
          jobCreatedAtMs: NOW - 60_000,
        },
      }),
    ),
  );
  assert.equal(s.enabled, true);
  assert.equal(s.title, "Open the live agent session in a new tab");
});

test("attaching: active job without URL disables with elapsed wait text", () => {
  const s = sessionOf(
    describeActivityActions(
      baseArgs({
        factory: {
          available: true,
          active: true,
          sessionUrl: null,
          jobCreatedAtMs: NOW - 120_000,
        },
      }),
    ),
  );
  assert.equal(s.enabled, false);
  assert.ok(
    typeof s.title === "string" &&
      s.title.includes("Attaching the live agent session") &&
      s.title.includes("2m"),
    `attaching title carries the elapsed wait, got: ${s.title}`,
  );
});

test("overdue: active job without URL past the timeout says never-attached", () => {
  const s = sessionOf(
    describeActivityActions(
      baseArgs({
        factory: {
          available: true,
          active: true,
          sessionUrl: null,
          jobCreatedAtMs: NOW - SESSION_ATTACH_TIMEOUT_MS - 60_000,
        },
      }),
    ),
  );
  assert.equal(s.enabled, false);
  assert.ok(
    typeof s.title === "string" &&
      s.title.includes("never attached") &&
      s.title.includes("session handshake"),
    `overdue title names the exact condition, got: ${s.title}`,
  );
});

test("absent: inactive job without URL keeps the legacy honest text", () => {
  const s = sessionOf(
    describeActivityActions(
      baseArgs({ factory: { available: true, active: false, sessionUrl: null } }),
    ),
  );
  assert.equal(s.enabled, false);
  assert.equal(
    s.title,
    "The live agent session is not available yet — it appears when the daemon attaches the session to the job",
  );
});

test("legacy: no factory info stays an enabled placeholder with no title", () => {
  const s = sessionOf(describeActivityActions(baseArgs()));
  assert.equal(s.enabled, true);
  assert.equal(s.title, undefined);
});

test("describeFactorySessionLine mirrors the four states for the caption", () => {
  const base = {
    jobId: "job-1",
    stage: "Building",
    stageLabel: "Building",
    family: "running" as const,
    stepIndex: 3,
    stepCount: 6,
    terminal: false,
  };
  // Attached sessions add no caption suffix (the per-phase Agent sessions
  // block below carries the links instead).
  assert.equal(
    describeFactorySessionLine({
      ...base,
      sessionUrl: "http://127.0.0.1:4096/abc/session/ses_1",
    }),
    "",
  );
  assert.ok(
    describeFactorySessionLine({ ...base, createdAtMs: Date.now() - 30_000 }).includes(
      "attaching the live session",
    ),
  );
  assert.ok(
    describeFactorySessionLine({
      ...base,
      createdAtMs: Date.now() - SESSION_ATTACH_TIMEOUT_MS - 1_000,
    }).includes("never attached"),
  );
  assert.ok(
    describeFactorySessionLine({ ...base, terminal: true }).includes(
      "appears when the daemon attaches it",
    ),
  );
});
