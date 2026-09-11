import test from "node:test";
import assert from "node:assert/strict";
import { mirrorHeadlessState } from "../src/lib/headlessStateMirror.ts";

function setWindow(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "", protocol: "http:", port: "", host: "x" },
    },
  });
}

function clearWindow(): void {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
}

test("mirror adapta /state y dropea ptys ajenos sin tirar", async () => {
  setWindow();
  const previousFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async () => ({
    ok: true,
    json: async () => [
      {
        id: "p1",
        name: "repo",
        path: "/repo",
        worktrees: [
          {
            id: "w1",
            name: "main",
            path: "/repo",
            terminals: [
              { id: "t1", title: "old", type: "shell", status: "running", ptyId: 99 },
            ],
          },
        ],
      },
    ],
  });
  try {
    const { useProjectStore } = await import("../src/stores/projectStore.ts");
    const previous = useProjectStore.getState();

    const result = await mirrorHeadlessState();
    assert.deepEqual(result, { ok: true, projects: 1 });
    const projects = useProjectStore.getState().projects;
    assert.equal(projects.length, 1);
    assert.equal(projects[0].worktrees.length, 1);
    // Los ptys del server no se heredan: la sesión web spawnea los suyos.
    assert.deepEqual(projects[0].worktrees[0].terminals, []);

    useProjectStore.setState(previous);
  } finally {
    (globalThis as Record<string, unknown>).fetch = previousFetch;
    clearWindow();
  }
});

test("mirror sin daemon: honesto, sin throws, store intacto", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        search: "?headless-port=9",
        protocol: "http:",
        port: "",
        host: "x",
      },
    },
  });
  try {
    const { useProjectStore } = await import("../src/stores/projectStore.ts");
    const before = useProjectStore.getState().projects.length;
    const result = await mirrorHeadlessState();
    assert.equal(result.ok, false);
    assert.equal(useProjectStore.getState().projects.length, before);
  } finally {
    clearWindow();
  }
});
