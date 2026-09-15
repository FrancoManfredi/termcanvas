/**
 * Ancla de repos externos (issue de otro repo que el checkout del panel).
 * node:test + tsx. Fake `run` inyectado; solo toca os.tmpdir().
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveExternalAnchor } from "../headless-runtime/factory/isolation/externalRepo.ts";

type Call = { cmd: string; args: readonly string[]; cwd: string };

function fakeRun(opts: {
  anchorOrigin: string | null;
  scratchOrigin?: string | null;
  cloneFails?: boolean;
  scratchValid?: boolean;
  calls: Call[];
  cloned?: Set<string>;
}) {
  const cloned = opts.cloned ?? new Set<string>();
  return async (
    cmd: string,
    args: readonly string[],
    runOpts: { cwd: string; timeoutMs: number },
  ): Promise<{ stdout: string; stderr: string }> => {
    opts.calls.push({ cmd, args, cwd: runOpts.cwd });
    const argv = args.join(" ");
    if (argv.startsWith("remote get-url origin")) {
      if (runOpts.cwd.includes("__")) {
        if (opts.scratchOrigin === undefined || opts.scratchOrigin === null) {
          throw new Error("no origin");
        }
        return { stdout: `${opts.scratchOrigin}\n`, stderr: "" };
      }
      if (opts.anchorOrigin === null) throw new Error("no origin");
      return { stdout: `${opts.anchorOrigin}\n`, stderr: "" };
    }
    if (argv.startsWith("rev-parse --show-toplevel")) {
      if (
        opts.scratchValid === true ||
        !runOpts.cwd.includes("__") ||
        cloned.has(runOpts.cwd)
      ) {
        return { stdout: `${runOpts.cwd}\n`, stderr: "" };
      }
      throw new Error("not a repo");
    }
    if (args[0] === "clone") {
      if (opts.cloneFails === true) throw new Error("network down");
      cloned.add(String(args[args.length - 1]));
      return { stdout: "", stderr: "" };
    }
    if (args[0] === "fetch") {
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected call: ${cmd} ${argv}`);
  };
}

function scratchRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ext-anchor-test-"));
}

test("same repo returns the panel anchor without cloning", async () => {
  const calls: Call[] = [];
  const res = await resolveExternalAnchor({
    anchor: "C:/work/termcanvas",
    repo: "Someone/TermCanvas",
    run: fakeRun({
      anchorOrigin: "https://github.com/someone/termcanvas.git",
      calls,
    }),
    scratchRoot: scratchRoot(),
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.anchor, "C:/work/termcanvas");
    assert.equal(res.external, false);
    assert.equal(res.reason, "same-repo");
  }
  assert.equal(
    calls.some((c) => c.args[0] === "clone"),
    false,
  );
});

test("different repo clones into the scratch dir", async () => {
  const calls: Call[] = [];
  const root = scratchRoot();
  const res = await resolveExternalAnchor({
    anchor: "C:/work/termcanvas",
    repo: "FrancoManfredi/test-orquestador",
    run: fakeRun({
      anchorOrigin: "https://github.com/someone/termcanvas.git",
      calls,
    }),
    scratchRoot: root,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.external, true);
    assert.equal(res.reason, "cloned");
    assert.equal(
      res.anchor,
      path.join(root, "FrancoManfredi__test-orquestador"),
    );
  }
});

test("malformed repo ref fails closed without spawning clone", async () => {
  const calls: Call[] = [];
  const res = await resolveExternalAnchor({
    anchor: "C:/work/termcanvas",
    repo: "../evil",
    run: fakeRun({ anchorOrigin: null, calls }),
    scratchRoot: scratchRoot(),
  });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test("clone failure is an honest error, never a throw", async () => {
  const calls: Call[] = [];
  const res = await resolveExternalAnchor({
    anchor: "C:/work/termcanvas",
    repo: "FrancoManfredi/test-orquestador",
    run: fakeRun({
      anchorOrigin: "https://github.com/someone/termcanvas.git",
      cloneFails: true,
      calls,
    }),
    scratchRoot: scratchRoot(),
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.match(res.error, /clone failed/);
  }
});

test("existing matching clone is reused without cloning again", async () => {
  const calls: Call[] = [];
  const root = scratchRoot();
  const res = await resolveExternalAnchor({
    anchor: "C:/work/termcanvas",
    repo: "FrancoManfredi/test-orquestador",
    run: fakeRun({
      anchorOrigin: "https://github.com/someone/termcanvas.git",
      scratchOrigin: "https://github.com/FrancoManfredi/test-orquestador.git",
      scratchValid: true,
      calls,
    }),
    scratchRoot: root,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.external, true);
    assert.equal(res.reason, "reused");
  }
  assert.equal(
    calls.some((c) => c.args[0] === "clone"),
    false,
  );
});

test("anchor without origin keeps legacy behavior", async () => {
  const calls: Call[] = [];
  const res = await resolveExternalAnchor({
    anchor: "C:/work/termcanvas",
    repo: "FrancoManfredi/test-orquestador",
    run: fakeRun({ anchorOrigin: null, calls }),
    scratchRoot: scratchRoot(),
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.anchor, "C:/work/termcanvas");
    assert.equal(res.external, false);
    assert.equal(res.reason, "no-origin");
  }
});
