/**
 * Factory dependencies: status parsing and route matchers. All offline
 * (injected fakes, zero network/spawn). Rows are info-only: python/gh are
 * managed outside the factory, and the reviewer integration (Pullfrog)
 * appends its own row when configured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPS_PROBE_TIMEOUT_MS,
  getDependenciesStatus,
  parseToolVersion,
  type DepsExec,
} from "../headless-runtime/factory/dependencies/depsService.ts";
import {
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
  assert.equal(parseToolVersion("tool 0.34.2 (python 3.12)"), "0.34.2");
  assert.equal(parseToolVersion("Python 3.12.3"), "3.12.3");
  assert.equal(parseToolVersion("gh version 2.74.2 (2025-01-27)"), "2.74.2");
  assert.equal(parseToolVersion("sin version"), null);
  assert.equal(parseToolVersion(""), null);
  assert.equal(parseToolVersion(null), null);
  assert.equal(parseToolVersion(42), null);
});

test("bounds: probes 15s single attempt", () => {
  assert.equal(DEPS_PROBE_TIMEOUT_MS, 15000);
});

test("status: info rows instalados con versiones", async () => {
  const { run } = fakeExec((cmd) => {
    if (cmd === "python") return { stdout: "", stderr: "Python 3.12.3\n" };
    if (cmd === "gh") return { stdout: "gh version 2.74.2\n" };
    return null;
  });
  const got = await getDependenciesStatus(run);
  assert.equal(got.tools.length, 2);
  const py = got.tools.find((t) => t.name === "python");
  assert.equal(py?.installed, true);
  assert.equal(py?.version, "3.12.3", "stderr también cuenta");
  assert.equal(py?.installable, false, "info row sin botón");
  const gh = got.tools.find((t) => t.name === "gh");
  assert.equal(gh?.installed, true);
  assert.equal(gh?.version, "2.74.2");
  assert.equal(gh?.installable, false, "info row sin botón");
  assert.ok(got.tools.every((t) => t.installCommand === null), "sin comandos de install");
});

test("status: faltantes traen hint, nunca lanza", async () => {
  const throwing: DepsExec = async () => {
    throw new Error("spawn ENOENT");
  };
  const got = await getDependenciesStatus(throwing);
  assert.equal(got.tools.length, 2, "filas presentes aunque falten los binarios");
  assert.ok(got.tools.every((t) => t.installed === false));
  assert.ok(got.tools.every((t) => (t.hint ?? "").length > 0), "hint visible");
  const nullExec = await getDependenciesStatus(null as unknown as DepsExec);
  assert.equal(nullExec.tools.length, 2, "sin executor: filas como missing, nunca throw");
  assert.ok(nullExec.tools.every((t) => t.installed === false));
});

test("routes: match exacto sin alias + null ajeno", () => {
  assert.deepEqual(parseDependenciesStatusPath("GET", "/factory/dependencies/status"), { ok: true });
  assert.equal(parseDependenciesStatusPath("POST", "/factory/dependencies/status"), null);
  assert.equal(parseDependenciesStatusPath("GET", "/factory/dependencies/status/extra"), null);
  assert.equal(parseDependenciesStatusPath("GET", "/factory/dependencies"), null);
  assert.equal(parseDependenciesStatusPath("POST", "/factory/dependencies/pr-agent/install"), null);
  assert.equal(parseDependenciesStatusPath("GET", 123), null);
});
