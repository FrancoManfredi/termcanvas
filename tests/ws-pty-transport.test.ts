import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import {
  parseClientMessage,
  parseServerMessage,
  serializeClientMessage,
  serializeServerMessage,
} from "../headless-runtime/pty-protocol.ts";
import {
  __resetWsPtyBackendForTest,
  getWsPtyBackend,
  type WsPtySocket,
  type WsPtySocketFactory,
} from "../src/terminal/wsPtyTransport.ts";
import { ProjectStore } from "../headless-runtime/project-store.ts";
import {
  addProjectWithMainWorktree,
  createWorkspaceFixture,
  startHeadlessServer,
  stopHeadlessServer,
} from "./headless-runtime-test-helpers.ts";

// --- protocol unit -------------------------------------------------------

test("pty protocol round-trips every message shape, rejects garbage", () => {
  const shapes = [
    { type: "create", cwd: "/tmp", shell: "/bin/sh", args: ["-l"], cols: 80, rows: 24 },
    { type: "input", data: "ls\r" },
    { type: "resize", cols: 120, rows: 40 },
    { type: "destroy" },
  ] as const;
  for (const shape of shapes) {
    assert.deepEqual(parseClientMessage(serializeClientMessage(shape)), shape);
  }

  const serverShapes = [
    { type: "ready", ptyId: 3 },
    { type: "output", data: "hello" },
    { type: "exit", exitCode: 1 },
  ] as const;
  for (const shape of serverShapes) {
    assert.deepEqual(parseServerMessage(serializeServerMessage(shape)), shape);
  }

  assert.equal(parseClientMessage("raw shell bytes"), null);
  assert.equal(parseClientMessage('{"type":"nope"}'), null);
  assert.equal(parseClientMessage('{"type":"input"}'), null);
  assert.equal(parseServerMessage("not json"), null);
  assert.equal(parseServerMessage('{"type":"output"}'), null);
});

// --- WsPtyBackend with mock socket (no network) --------------------------

interface MockSocketState {
  sent: string[];
  messageCbs: Array<(data: string) => void>;
  closeCbs: Array<(code: number, reason: string) => void>;
  openCbs: Array<() => void>;
  closed: boolean;
}

function createMockSocketFactory(
  onCreate?: (state: MockSocketState, socket: WsPtySocket) => void,
): { factory: WsPtySocketFactory; states: MockSocketState[] } {
  const states: MockSocketState[] = [];
  const factory: WsPtySocketFactory = () => {
    const state: MockSocketState = {
      sent: [],
      messageCbs: [],
      closeCbs: [],
      openCbs: [],
      closed: false,
    };
    states.push(state);
    const socket: WsPtySocket = {
      send: (data) => state.sent.push(data),
      close: () => {
        state.closed = true;
      },
      onMessage: (cb) => state.messageCbs.push(cb),
      onClose: (cb) => state.closeCbs.push(cb),
      onOpen: (cb) => state.openCbs.push(cb),
      onError: () => {},
    };
    onCreate?.(state, socket);
    queueMicrotask(() => {
      for (const cb of state.openCbs) cb();
    });
    return socket;
  };
  return { factory, states };
}

function serverSend(state: MockSocketState, msg: unknown): void {
  for (const cb of state.messageCbs) cb(JSON.stringify(msg));
}

test("ws backend create/input/resize/destroy speak the JSON protocol", async () => {
  const { factory, states } = createMockSocketFactory();
  const backend = getWsPtyBackend(factory);
  assert.ok(backend);

  const created = backend.create({ cwd: "/tmp/repo" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(states.length, 1);
  assert.deepEqual(parseClientMessage(states[0].sent[0]), {
    type: "create",
    cwd: "/tmp/repo",
  });

  serverSend(states[0], { type: "ready", ptyId: 7 });
  const ptyId = await created;
  assert.equal(ptyId, 7);

  backend.input(ptyId, "echo hi\r");
  assert.deepEqual(parseClientMessage(states[0].sent[1]), {
    type: "input",
    data: "echo hi\r",
  });

  backend.resize(ptyId, 100, 30);
  assert.deepEqual(parseClientMessage(states[0].sent[2]), {
    type: "resize",
    cols: 100,
    rows: 30,
  });

  const outputs: Array<{ ptyId: number; data: string }> = [];
  const exits: Array<{ ptyId: number; exitCode: number }> = [];
  backend.onOutput((id, data) => outputs.push({ ptyId: id, data }));
  backend.onExit((id, exitCode) => exits.push({ ptyId: id, exitCode }));

  serverSend(states[0], { type: "output", data: "hi\r\n" });
  assert.deepEqual(outputs, [{ ptyId: 7, data: "hi\r\n" }]);

  await backend.destroy(ptyId);
  assert.deepEqual(parseClientMessage(states[0].sent[3]), { type: "destroy" });
  assert.ok(states[0].closed);

  __resetWsPtyBackendForTest();
});

test("ws backend surfaces unexpected close as exit (no silent hang, no reconnect)", async () => {
  const { factory, states } = createMockSocketFactory();
  const backend = getWsPtyBackend(factory);
  assert.ok(backend);

  const created = backend.create({ cwd: "/tmp" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  serverSend(states[0], { type: "ready", ptyId: 9 });
  assert.equal(await created, 9);

  const exits: number[] = [];
  backend.onExit((id, code) => {
    assert.equal(id, 9);
    exits.push(code);
  });
  for (const cb of states[0].closeCbs) cb(1006, "abnormal");
  assert.deepEqual(exits, [1]);

  // Input after death drops honestly instead of throwing.
  backend.input(9, "late");
  assert.equal(states[0].sent.length, 1);

  __resetWsPtyBackendForTest();
});

test("pty stream URL tolera bases http/https del launcher", async () => {
  const { toPtyStreamUrl } = await import(
    "../src/terminal/wsPtyTransport.ts"
  );
  assert.equal(
    toPtyStreamUrl("http://127.0.0.1:7080"),
    "ws://127.0.0.1:7080/pty/stream?format=json",
  );
  assert.equal(
    toPtyStreamUrl("https://host/x/"),
    "wss://host/x/pty/stream?format=json",
  );
  assert.equal(
    toPtyStreamUrl("ws://127.0.0.1:7080/pty/stream?format=json"),
    "ws://127.0.0.1:7080/pty/stream?format=json",
  );
});

test("ws backend degrades honestly: getPid/detectCli null, theme no-op", async () => {
  const { factory } = createMockSocketFactory();
  const backend = getWsPtyBackend(factory);
  assert.ok(backend);
  assert.equal(await backend.getPid(1), null);
  assert.equal(await backend.detectCli(1), null);
  backend.notifyThemeChanged(1);
  __resetWsPtyBackendForTest();
});

// --- server JSON round-trip (real WS, fake pty) --------------------------

function waitForMessage(
  ws: WebSocket,
  predicate: (raw: string) => boolean,
  timeoutMs = 3_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("Timed out waiting for WS message"));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      const raw = typeof data === "string" ? data : String(data);
      if (predicate(raw)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(raw);
      }
    };
    ws.on("message", onMessage);
  });
}

test("headless /pty/stream JSON: create/input/resize/destroy/output/exit", async () => {
  const workspaceDir = createWorkspaceFixture({ "README.md": "hello\n" });
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "pty-repo");
  const harness = await startHeadlessServer({ workspaceDir, projectStore });

  try {
    const ws = new WebSocket(
      `ws://127.0.0.1:${harness.port}/pty/stream?format=json`,
    );
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    ws.send(serializeClientMessage({ type: "create", cwd: workspaceDir }));
    const readyRaw = await waitForMessage(
      ws,
      (raw) => parseServerMessage(raw)?.type === "ready",
    );
    const ready = parseServerMessage(readyRaw);
    assert.equal(ready?.type, "ready");
    const ptyId = (ready as { ptyId: number }).ptyId;
    assert.ok(typeof ptyId === "number");

    ws.send(serializeClientMessage({ type: "input", data: "echo hi\r" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(harness.ptyManager.writes, [
      { ptyId, text: "echo hi\r" },
    ]);

    ws.send(serializeClientMessage({ type: "resize", cols: 120, rows: 40 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(harness.ptyManager.resizes, [
      { ptyId, cols: 120, rows: 40 },
    ]);

    harness.ptyManager.emitData(ptyId, "hi\r\n");
    const outRaw = await waitForMessage(
      ws,
      (raw) => parseServerMessage(raw)?.type === "output",
    );
    assert.deepEqual(parseServerMessage(outRaw), {
      type: "output",
      data: "hi\r\n",
    });

    const exitSeen = waitForMessage(
      ws,
      (raw) => parseServerMessage(raw)?.type === "exit",
    );
    const closed = new Promise((resolve) => ws.on("close", resolve));
    ws.send(serializeClientMessage({ type: "destroy" }));
    assert.deepEqual(await exitSeen, serializeServerMessage({ type: "exit", exitCode: 0 }));
    await closed;
    ws.terminate();
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("headless /pty/stream raw mode still works (backward compat)", async () => {
  const workspaceDir = createWorkspaceFixture({ "README.md": "hello\n" });
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "pty-raw");
  const harness = await startHeadlessServer({ workspaceDir, projectStore });

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${harness.port}/pty/stream`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    // Raw auto-create: the server spawned ptyId 1 for this socket.
    ws.send("echo raw\r");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(harness.ptyManager.writes, [
      { ptyId: 1, text: "echo raw\r" },
    ]);

    harness.ptyManager.emitData(1, "raw-out");
    const raw = await waitForMessage(ws, () => true);
    assert.equal(raw, "raw-out");
    ws.terminate();
  } finally {
    await stopHeadlessServer(harness);
  }
});
