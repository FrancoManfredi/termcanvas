import test from "node:test";
import assert from "node:assert/strict";

import type { Terminal } from "@xterm/xterm";
import type { TerminalType } from "../src/types/index.ts";
import {
  decideXtermWheelFallback,
  type XtermWheelFallbackState,
} from "../src/terminal/xtermWheelFallback.ts";

type NativeWheelListener = (event: WheelEvent) => void;

function installRuntimeGlobals() {
  const storage = new Map<string, string>();
  const target = new EventTarget();
  const mockWindow = Object.assign(target, {
    navigator: { language: "en-US", userAgent: "node-test" },
    termcanvas: undefined as unknown,
  }) as Window & { termcanvas: unknown };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) { return storage.get(key) ?? null; },
      setItem(key: string, value: string) { storage.set(key, value); },
      removeItem(key: string) { storage.delete(key); },
      clear() { storage.clear(); },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: mockWindow.navigator,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: mockWindow,
  });
}

function createFakeNode() {
  const node = {
    children: [] as Array<ReturnType<typeof createFakeNode>>,
    parentElement: null as ReturnType<typeof createFakeNode> | null,
    appendChild(child: ReturnType<typeof createFakeNode>) {
      child.parentElement?.removeChild(child);
      this.children.push(child);
      child.parentElement = this;
      return child;
    },
    removeChild(child: ReturnType<typeof createFakeNode>) {
      this.children = this.children.filter((entry) => entry !== child);
      if (child.parentElement === this) child.parentElement = null;
      return child;
    },
    contains(child: ReturnType<typeof createFakeNode>) {
      return this.children.some(
        (entry) => entry === child || entry.contains(child),
      );
    },
  };
  return node;
}

function createFakeXterm() {
  const host = createFakeNode();
  const container = createFakeNode();
  const viewport = Object.assign(createFakeNode(), {
    clientHeight: 874,
    scrollHeight: 874,
  });
  const root = createFakeNode();
  const classNames = new Set<string>();
  const callOrder: string[] = [];
  const inputCalls: Array<{ data: string; wasUserInput: boolean }> = [];
  let dataHandler: ((data: string) => void) | null = null;
  let wheelListener: NativeWheelListener | null = null;
  let wheelRemovalCalls = 0;
  let disposeCalls = 0;
  const canvasTarget = createFakeNode();

  viewport.appendChild(canvasTarget);
  root.appendChild(viewport);
  host.appendChild(root);
  container.appendChild(host);

  const xterm = {
    buffer: { active: { type: "alternate" as "normal" | "alternate" } },
    element: Object.assign(root, {
      classList: {
        contains(name: string) {
          return classNames.has(name);
        },
      },
      addEventListener(type: string, listener: EventListener) {
        assert.equal(type, "wheel");
        wheelListener = listener as NativeWheelListener;
        callOrder.push("addEventListener");
      },
      removeEventListener(type: string, listener: EventListener) {
        assert.equal(type, "wheel");
        assert.equal(listener, wheelListener);
        wheelRemovalCalls += 1;
        wheelListener = null;
        callOrder.push("removeEventListener");
      },
      querySelector(selector: string) {
        return selector === ".xterm-viewport" ? viewport : null;
      },
    }),
    open(openHost: unknown) {
      assert.equal(openHost, host);
      callOrder.push("open");
    },
    input(data: string, wasUserInput: boolean) {
      inputCalls.push({ data, wasUserInput });
    },
    blur() {},
    onData(listener: (data: string) => void) {
      dataHandler = listener;
      return { dispose() { dataHandler = null; } };
    },
    onResize() {
      return { dispose() {} };
    },
    dispose() {
      disposeCalls += 1;
      callOrder.push("dispose");
    },
  };

  return {
    attachedContainer: container,
    callOrder,
    classNames,
    container,
    dataHandler: () => dataHandler,
    disposeCalls: () => disposeCalls,
    host,
    inputCalls,
    root,
    canvasTarget,
    viewport,
    wheelListener: () => wheelListener,
    wheelRemovalCalls: () => wheelRemovalCalls,
    xterm: xterm as unknown as Terminal,
  };
}

function createWheelEvent(
  overrides: Partial<{
    ctrlKey: boolean;
    defaultPrevented: boolean;
    deltaY: number;
    metaKey: boolean;
    target: unknown;
  }> = {},
) {
  let defaultPrevented = overrides.defaultPrevented ?? false;
  let prevented = false;
  let stopped = false;
  const event = {
    ctrlKey: overrides.ctrlKey ?? false,
    get defaultPrevented() { return defaultPrevented; },
    deltaY: overrides.deltaY ?? 1,
    metaKey: overrides.metaKey ?? false,
    target: overrides.target ?? null,
    preventDefault() {
      defaultPrevented = true;
      prevented = true;
    },
    stopPropagation() { stopped = true; },
  } as unknown as WheelEvent;
  return {
    event,
    wasPrevented: () => prevented,
    wasStopped: () => stopped,
  };
}

function eligibleState(
  overrides: Partial<XtermWheelFallbackState> = {},
): XtermWheelFallbackState {
  return {
    activeBuffer: "alternate",
    ctrlKey: false,
    deltaY: -1,
    liveInputAvailable: true,
    metaKey: false,
    mouseEventsEnabled: false,
    terminalType: "opencode",
    viewport: { clientHeight: 874, scrollHeight: 874 },
    ...overrides,
  };
}

test("decideXtermWheelFallback maps eligible vertical deltas to one direction", () => {
  assert.equal(decideXtermWheelFallback(eligibleState({ deltaY: -1000 })), "up");
  assert.equal(decideXtermWheelFallback(eligibleState({ deltaY: 1000 })), "down");
});

test("decideXtermWheelFallback keeps equal and smaller viewport ranges eligible", () => {
  assert.equal(
    decideXtermWheelFallback(
      eligibleState({ viewport: { clientHeight: 874, scrollHeight: 874 } }),
    ),
    "up",
  );
  assert.equal(
    decideXtermWheelFallback(
      eligibleState({ viewport: { clientHeight: 874, scrollHeight: 800 } }),
    ),
    "up",
  );
});

test("decideXtermWheelFallback preserves xterm ownership for every ineligible predicate", () => {
  const cases: Array<[string, Partial<XtermWheelFallbackState>]> = [
    ["non-OpenCode", { terminalType: "shell" as TerminalType }],
    ["ctrl modifier", { ctrlKey: true }],
    ["meta modifier", { metaKey: true }],
    ["zero vertical delta", { deltaY: 0 }],
    ["mouse reports", { mouseEventsEnabled: true }],
    ["missing live input", { liveInputAvailable: false }],
    ["normal buffer", { activeBuffer: "normal" }],
    ["missing buffer", { activeBuffer: null }],
    ["missing viewport", { viewport: null }],
    ["effective viewport range", {
      viewport: { clientHeight: 874, scrollHeight: 875 },
    }],
  ];
  for (const [name, overrides] of cases) {
    assert.equal(decideXtermWheelFallback(eligibleState(overrides)), "xterm", name);
  }
});

test("xterm wheel fallback registers after open", async () => {
  installRuntimeGlobals();
  const { registerXtermWheelFallback } = await import(
    "../src/terminal/terminalRuntimeStore.ts"
  );
  const fake = createFakeXterm();
  fake.xterm.open(fake.host);
  registerXtermWheelFallback("terminal-1", fake.xterm);
  assert.deepEqual(fake.callOrder, ["open", "addEventListener"]);
  assert.ok(fake.wheelListener());
});

async function setupLiveOpenCodeRuntime() {
  installRuntimeGlobals();
  const mockWindow = window as Window & { termcanvas: unknown };
  mockWindow.termcanvas = {
    terminal: {
      create: async () => 42,
      destroy: async () => {},
      input: () => {},
      onExit: () => () => {},
      onOutput: () => () => {},
    },
    session: {
      onTurnComplete: () => () => {},
    },
  };
  const {
    destroyAllTerminalRuntimes,
    ensureTerminalRuntime,
    getTerminalRuntime,
    registerXtermWheelFallback,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const previousState = useProjectStore.getState();
  const fake = createFakeXterm();
  const terminal = {
    id: "terminal-1",
    title: "OpenCode",
    type: "opencode" as const,
    minimized: false,
    focused: true,
    ptyId: 42,
    status: "running" as const,
    span: { cols: 1, rows: 1 },
  };
  useProjectStore.setState({
    focusedProjectId: "project-1",
    focusedWorktreeId: "worktree-1",
    projects: [{
      id: "project-1",
      name: "Project One",
      path: "/tmp/project-1",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 0,
      worktrees: [{
        id: "worktree-1",
        name: "main",
        path: "/tmp/project-1",
        position: { x: 0, y: 0 },
        collapsed: false,
        terminals: [terminal],
      }],
    }],
  });
  destroyAllTerminalRuntimes();
  ensureTerminalRuntime({
    projectId: "project-1",
    terminal,
    worktreeId: "worktree-1",
    worktreePath: "/tmp/project-1",
  });
  const runtime = getTerminalRuntime("terminal-1");
  assert.ok(runtime);
  if (!runtime) throw new Error("runtime setup failed");
  runtime.mode = "live";
  runtime.ptyId = 42;
  runtime.xterm = fake.xterm;
  runtime.hostElement = fake.host as unknown as HTMLDivElement;
  runtime.attachedContainer = fake.container as unknown as HTMLDivElement;
  registerXtermWheelFallback("terminal-1", fake.xterm);
  return {
    destroyAllTerminalRuntimes,
    fake,
    previousState,
    runtime,
    useProjectStore,
  };
}

test("xterm root listener owns nested canvas events and maps each direction once", async () => {
  const setup = await setupLiveOpenCodeRuntime();
  try {
    const listener = setup.fake.wheelListener();
    assert.ok(listener);
    const up = createWheelEvent({
      deltaY: -1,
      target: setup.fake.canvasTarget,
    });
    listener?.(up.event);
    assert.deepEqual(setup.fake.inputCalls, [{ data: "\x1b[A", wasUserInput: false }]);
    assert.equal(up.wasPrevented(), true);
    assert.equal(up.wasStopped(), true);

    const down = createWheelEvent({ deltaY: 1 });
    listener?.(down.event);
    assert.deepEqual(setup.fake.inputCalls, [
      { data: "\x1b[A", wasUserInput: false },
      { data: "\x1b[B", wasUserInput: false },
    ]);
  } finally {
    setup.destroyAllTerminalRuntimes();
    setup.useProjectStore.setState(setup.previousState);
  }
});

test("xterm root listener preserves xterm ownership for prevented, scrollback, mouse, and detached events", async () => {
  const setup = await setupLiveOpenCodeRuntime();
  try {
    const listener = setup.fake.wheelListener();
    assert.ok(listener);
    const prevented = createWheelEvent({ defaultPrevented: true });
    listener?.(prevented.event);
    assert.deepEqual(setup.fake.inputCalls, []);
    assert.equal(prevented.wasPrevented(), false);
    assert.equal(prevented.wasStopped(), false);

    setup.fake.viewport.scrollHeight = 900;
    listener?.(createWheelEvent().event);
    setup.fake.viewport.scrollHeight = 874;

    setup.fake.classNames.add("enable-mouse-events");
    listener?.(createWheelEvent().event);
    setup.fake.classNames.clear();

    setup.runtime.attachedContainer = null;
    listener?.(createWheelEvent().event);
    assert.deepEqual(setup.fake.inputCalls, []);
  } finally {
    setup.destroyAllTerminalRuntimes();
    setup.useProjectStore.setState(setup.previousState);
  }
});

test("xterm wheel fallback registration is idempotent and reads current runtime state", async () => {
  const setup = await setupLiveOpenCodeRuntime();
  try {
    const { registerXtermWheelFallback } = await import(
      "../src/terminal/terminalRuntimeStore.ts"
    );
    registerXtermWheelFallback("terminal-1", setup.fake.xterm);
    assert.equal(
      setup.fake.callOrder.filter((entry) => entry === "addEventListener").length,
      1,
    );

    const handler = setup.fake.wheelListener();
    setup.runtime.ptyId = null;
    handler?.(createWheelEvent().event);
    setup.runtime.ptyId = 99;
    handler?.(createWheelEvent().event);
    assert.deepEqual(setup.fake.inputCalls, [{ data: "\x1b[B", wasUserInput: false }]);
  } finally {
    setup.destroyAllTerminalRuntimes();
    setup.useProjectStore.setState(setup.previousState);
  }
});
