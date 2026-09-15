/**
 * Factory dependencies (pr-agent CLI): status parsing, installer command
 * selection and route matchers. All offline (injected fakes, zero
 * network/spawn). Install never auto-runs: it only exists behind the
 * explicit POST .../pr-agent/install.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPS_INSTALL_TIMEOUT_MS,
  DEPS_PROBE_TIMEOUT_MS,
  getDependenciesStatus,
  installPrAgent,
  parseToolVersion,
  type DepsExec,
} from "../headless-runtime/factory/dependencies/depsService.ts";
import {
  parseDependenciesInstallPath,
  parseDependenciesStatusPath,
} from "../headless-runtime/factory/dependencies/depsRoutes.ts";

function fakeExec(
  handler: (cmd: string, args: readonly string[]) => { stdout: string; stderr?: string } | null,
): { calls: Array<{ cmd: string; args: readonly string[] }>; run: DepsExec } {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const run: DepsExec = async (cmd, args) => {
    calls.push({ cmd, args });
    const hit = handler(cmd, args);
    if (hit === null) throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
    return { stdout: hit.stdout, stderr: hit.stderr ?? "" };
  };
  return { calls, run };
}

test("parseToolVersion: primera X.Y[.Z], null sin match ni junk", () => {
  assert.equal(parseToolVersion("pr-agent 0.34.2 (python 3.12)"), "0.34.2");
  assert.equal(parseToolVersion("Python 3.12.3"), "3.12.3");
  assert.equal(parseToolVersion("gh version 2.74.2 (2025-01-27)"), "2.74.2");
  assert.equal(parseToolVersion("sin version"), null);
  assert.equal(parseToolVersion(""), null);
  assert.equal(parseToolVersion(null), null);
  assert.equal(parseToolVersion(42), null);
});

test("bounds: probes 15s, install 240s single attempt", () => {
  assert.equal(DEPS_PROBE_TIMEOUT_MS, 15000);
  assert.equal(DEPS_INSTALL_TIMEOUT_MS, 240000);
});

test("status: todo instalado con versiones", async () => {
  const { run } = fakeExec((cmd) => {
    if (cmd === "pr-agent") return { stdout: "pr-agent 0.34.2\n" };
    if (cmd === "python") return { stdout: "", stderr: "Python 3.12.3\n" };
    if (cmd === "gh") return { stdout: "gh version 2.74.2\n" };
    return null;
  });
  const got = await getDependenciesStatus(run);
  assert.equal(got.tools.length, 3);
  const pr = got.tools.find((t) => t.name === "pr-agent");
  assert.equal(pr?.installed, true);
  assert.equal(pr?.version, "0.34.2");
  assert.equal(pr?.installable, true);
  assert.equal(pr?.installCommand, null, "instalado: sin botón");
  const py = got.tools.find((t) => t.name === "python");
  assert.equal(py?.installed, true);
  assert.equal(py?.version, "3.12.3", "stderr también cuenta");
  assert.equal(py?.installable, false, "info row sin botón");
  const gh = got.tools.find((t) => t.name === "gh");
  assert.equal(gh?.installed, true);
  assert.equal(gh?.version, "2.74.2");
});

test("status: faltante trae comando + hint, nunca lanza", async () => {
  const { run } = fakeExec((cmd) => {
    if (cmd === "python") return { stdout: "Python 3.12.3\n" };
    if (cmd === "gh") return { stdout: "gh version 2.74.2\n" };
    return null;
  });
  const throwing: DepsExec = async (cmd, args, opts) => {
    if (cmd === "pr-agent") throw new Error("spawn pr-agent ENOENT");
    return run(cmd, args, opts);
  };
  const got = await getDependenciesStatus(throwing);
  const pr = got.tools.find((t) => t.name === "pr-agent");
  assert.equal(pr?.installed, false);
  assert.equal(pr?.version, null);
  assert.equal(pr?.installCommand, "uv tool install pr-agent");
  assert.ok((pr?.hint ?? "").length > 0, "hint visible (nota PATH/restart)");
  const nullExec = await getDependenciesStatus(null as unknown as DepsExec);
  assert.equal(nullExec.tools.length, 3, "sin executor: filas como missing, nunca throw");
  assert.ok(nullExec.tools.every((t) => t.installed === false));
});

test("install: usa uv cuando existe y verifica al final", async () => {
  const { calls, run } = fakeExec((cmd, args) => {
    if (cmd === "uv") return { stdout: "uv 0.7.0\n" };
    if (cmd === "pr-agent") return { stdout: "pr-agent 0.34.2\n" };
    return { stdout: "ok\n" };
  });
  const got = await installPrAgent(run);
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.method, "uv");
    assert.equal(got.version, "0.34.2");
    assert.ok(got.log.includes("uv tool install pr-agent"));
  }
  const kinds = calls.map((c) => `${c.cmd} ${(c.args[0] as string) ?? ""}`);
  assert.deepEqual(kinds, ["uv --version", "uv tool", "pr-agent --version"]);
});

test("install: cae a pip sin uv", async () => {
  const { calls, run } = fakeExec((cmd) => {
    if (cmd === "pr-agent") return { stdout: "pr-agent 0.34.2\n" };
    return { stdout: "ok\n" };
  });
  const throwing: DepsExec = async (cmd, args, opts) => {
    if (cmd === "uv") throw new Error("spawn uv ENOENT");
    return run(cmd, args, opts);
  };
  const got = await installPrAgent(throwing);
  assert.equal(got.ok, true);
  if (got.ok) assert.equal(got.method, "pip");
  const pipCall = calls.find((c) => c.cmd === "python");
  assert.deepEqual([...(pipCall?.args ?? [])], ["-m", "pip", "install", "--user", "pr-agent"]);
});

test("install: fallo honesto + verificación fallida honesta", async () => {
  const failRun: DepsExec = async (cmd, args) => {
    if (cmd === "uv" && (args[0] as string) === "--version") return { stdout: "uv 0.7.0\n", stderr: "" };
    throw new Error("pip: network unreachable ".padEnd(300, "x"));
  };
  const bad = await installPrAgent(failRun);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.error.includes("install failed"));
    assert.ok(bad.error.length <= 220);
    assert.ok(bad.log.length > 0);
  }
  const ghostRun: DepsExec = async (cmd) => {
    if (cmd === "pr-agent") throw new Error("spawn pr-agent ENOENT");
    return { stdout: "ok\n", stderr: "" };
  };
  const ghost = await installPrAgent(ghostRun);
  assert.equal(ghost.ok, false);
  if (!ghost.ok) assert.ok(ghost.error.includes("still missing"));
});

test("routes: match exacto dual-sin-alias + null ajeno", () => {
  assert.deepEqual(parseDependenciesStatusPath("GET", "/factory/dependencies/status"), { ok: true });
  assert.equal(parseDependenciesStatusPath("POST", "/factory/dependencies/status"), null);
  assert.equal(parseDependenciesStatusPath("GET", "/factory/dependencies/status/extra"), null);
  assert.equal(parseDependenciesStatusPath("GET", "/factory/dependencies"), null);
  assert.deepEqual(parseDependenciesInstallPath("POST", "/factory/dependencies/pr-agent/install"), { ok: true });
  assert.equal(parseDependenciesInstallPath("GET", "/factory/dependencies/pr-agent/install"), null);
  assert.equal(parseDependenciesInstallPath("POST", "/factory/dependencies/status"), null);
  assert.equal(parseDependenciesStatusPath("GET", 123), null);
});

test("install: uv presente pero falla → fallback a pip y verifica", async () => {
  const { calls, run } = fakeExec(() => ({ stdout: "ok\n" }));
  const flaky: DepsExec = async (cmd, args, opts) => {
    if (cmd === "uv" && (args[0] as string) === "tool") {
      throw new Error("error: Microsoft Visual C++ 14.0 or greater is required");
    }
    if (cmd === "pr-agent") return { stdout: "pr-agent 0.45.0\n", stderr: "" };
    return run(cmd, args, opts);
  };
  const got = await installPrAgent(flaky);
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.method, "pip");
    assert.equal(got.version, "0.45.0");
    assert.ok(got.log.includes("uv tool install pr-agent"), "el intento uv queda en el log");
    assert.ok(got.log.includes("pip install"), "el fallback queda en el log");
  }
  assert.ok(calls.some((c) => c.cmd === "python"), "pip corre tras fallar uv");
});
