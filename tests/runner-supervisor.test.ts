/**
 * Runner supervisor: pure autostart gate, tasklist parsing, backoff and
 * supervised lifecycle with injected fakes. No real processes, no real
 * fs, no secrets anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  RUNNER_MAX_RESTARTS,
  RunnerSupervisor,
  backoffForAttempt,
  parseTasklistForListener,
  shouldAutostartRunner,
} from "../headless-runtime/factory/github/runnerSupervisor.ts";

test("shouldAutostartRunner: matriz de decisión", () => {
  const base = { platform: "win32", dirExists: true, configured: true, services: [], listenerRunning: false };
  assert.deepEqual(shouldAutostartRunner(base), { start: true, reason: "starting" });
  assert.equal(shouldAutostartRunner({ ...base, platform: "linux" }).start, false);
  assert.equal(shouldAutostartRunner({ ...base, dirExists: false }).start, false);
  assert.equal(shouldAutostartRunner({ ...base, configured: false }).start, false);
  assert.deepEqual(shouldAutostartRunner({ ...base, services: ["actions.runner.x"] }), {
    start: false,
    reason: "service-present",
  });
  assert.deepEqual(shouldAutostartRunner({ ...base, listenerRunning: true }), {
    start: false,
    reason: "already-running",
  });
  assert.equal(shouldAutostartRunner(null as unknown as Parameters<typeof shouldAutostartRunner>[0]).start, false);
});

test("parseTasklistForListener: exe sí, INFO no, junk no", () => {
  assert.equal(parseTasklistForListener('"Runner.Listener.exe","1234","Console","1","10.000 K"'), true);
  assert.equal(parseTasklistForListener("runner.listener.exe"), true);
  assert.equal(parseTasklistForListener("INFORMACIÓN: no hay tareas ejecutándose"), false);
  assert.equal(parseTasklistForListener(""), false);
  assert.equal(parseTasklistForListener(null), false);
});

test("backoffForAttempt: tabla con cota", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 99].map((n) => backoffForAttempt(n)),
    [5000, 15000, 30000, 60000, 300000, 300000, 300000],
  );
  assert.equal(backoffForAttempt(-1), 5000);
  assert.equal(RUNNER_MAX_RESTARTS, 5);
});

interface FakeChild extends EventEmitter {
  pid?: number;
  killed: boolean;
  kill(): boolean;
}

function makeSupervisor(overrides: {
  files?: Record<string, boolean>;
  tasklist?: string;
  services?: string;
  platform?: string;
  maxRestarts?: number;
  spawned?: Array<{ cmd: string; args: readonly string[]; cwd: string }>;
  children?: FakeChild[];
} = {}): { supervisor: RunnerSupervisor; spawned: Array<{ cmd: string; args: readonly string[]; cwd: string }>; children: FakeChild[]; logs: string[] } {
  const spawned: Array<{ cmd: string; args: readonly string[]; cwd: string }> = overrides.spawned ?? [];
  const children: FakeChild[] = overrides.children ?? [];
  const logs: string[] = [];
  const files = overrides.files ?? {};
  const supervisor = new RunnerSupervisor({
    existsSync: (p) => files[p] === true,
    execFile: async (cmd) => {
      if (cmd === "tasklist") return { stdout: overrides.tasklist ?? "", stderr: "" };
      if (cmd === "powershell.exe") return { stdout: overrides.services ?? "", stderr: "" };
      throw new Error(`unexpected spawn: ${cmd}`);
    },
    spawnFn: (cmd, args, opts) => {
      spawned.push({ cmd, args, cwd: opts.cwd });
      const child = new EventEmitter() as FakeChild;
      child.pid = 1000 + spawned.length;
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        return true;
      };
      children.push(child);
      return child;
    },
    execTaskkill: async () => undefined,
    platform: overrides.platform ?? "win32",
    maxRestarts: overrides.maxRestarts ?? 5,
    backoffMs: () => 0,
    log: (msg) => {
      logs.push(msg);
    },
  });
  return { supervisor, spawned, children, logs };
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    try {
      if (cond()) return true;
    } catch {
      // retry
    }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("start: spawnea run.cmd cuando corresponde", async () => {
  const { supervisor, spawned, children } = makeSupervisor({
    files: { "C:\\actions-runner": true, "C:\\actions-runner\\.runner": true },
  });
  const res = await supervisor.start("C:\\actions-runner");
  assert.equal(res.started, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0]?.cmd, "cmd.exe");
  assert.ok(spawned[0]?.args.includes("run.cmd"), "corre run.cmd por argv");
  assert.equal(spawned[0]?.cwd, "C:\\actions-runner");
  assert.equal(children.length, 1);
  const snap = supervisor.getSnapshot();
  assert.equal(snap.running, true);
  assert.equal(typeof snap.pid, "number");
  supervisor.stop();
  assert.equal(supervisor.getSnapshot().running, false);
  assert.equal(children[0]?.killed, true);
});

test("start: no duplica (listener, servicio, sin registro, no-Windows)", async () => {
  const configured = { "C:\\actions-runner": true, "C:\\actions-runner\\.runner": true };
  const listener = makeSupervisor({ files: configured, tasklist: '"Runner.Listener.exe","1","Console","1","1 K"' });
  assert.deepEqual(await listener.supervisor.start(), { started: false, reason: "already-running" });

  const service = makeSupervisor({ files: configured, services: "actions.runner.o.r.h\n" });
  assert.deepEqual((await service.supervisor.start()).reason, "service-present");

  const naked = makeSupervisor({ files: { "C:\\actions-runner": true } });
  assert.deepEqual((await naked.supervisor.start()).reason, "not-configured");

  const linux = makeSupervisor({ files: configured, platform: "linux" });
  assert.deepEqual((await linux.supervisor.start()).reason, "non-windows");

  for (const s of [listener, service, naked, linux]) {
    assert.equal(s.supervisor.getSnapshot().running, false);
  }
});

test("crash-loop: reintenta con cota y se rinde honesto", async () => {
  const { supervisor, children, logs } = makeSupervisor({
    files: { "C:\\actions-runner": true, "C:\\actions-runner\\.runner": true },
    maxRestarts: 2,
  });
  await supervisor.start("C:\\actions-runner");
  for (let i = 0; i < 3; i += 1) {
    const child = children[children.length - 1];
    assert.ok(child, `hijo ${i} existe`);
    child?.emit("exit", 1);
    await waitFor(() => children.length > i + 1, 2000).catch(() => false);
  }
  assert.equal(children.length, 3, "1 inicial + 2 restarts");
  assert.equal(await waitFor(() => supervisor.getSnapshot().running === false), true);
  assert.equal(supervisor.getSnapshot().restarts, 2);
  assert.ok(logs.some((l) => l.includes("gave up")), "anuncia que se rinde");
  supervisor.stop();
});

test("stop idempotente y snapshot inicial", () => {
  const { supervisor } = makeSupervisor();
  supervisor.stop();
  supervisor.stop();
  assert.deepEqual(supervisor.getSnapshot(), {
    running: false,
    pid: null,
    restarts: 0,
    lastExit: null,
    dir: "C:\\actions-runner",
  });
});
