/**
 * Self-hosted runner status (Windows): read-only probes, response parsing
 * and route matcher. All offline (injected fakes, zero network/spawn).
 * Installs are manual (step-by-step guide in the Dependencies panel), so
 * there is no installer surface to test here — and no secrets anywhere:
 * probes check file EXISTENCE only, listings carry names/status only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  RUNNER_DEFAULT_DIR,
  RUNNER_DOWNLOAD_URL,
  RUNNER_PLATFORM,
  RUNNER_SHA256,
  RUNNER_VERSION,
  getRunnersStatus,
  parseRepoSlug,
  parseRunnerDir,
  parseRunnersResponse,
  type RunnerExec,
} from "../headless-runtime/factory/github/runnersService.ts";
import {
  parseRunnersStatusPath,
} from "../headless-runtime/factory/github/runnersRoutes.ts";

test("pinned release: version/platform/url/hash coherentes", () => {
  assert.equal(RUNNER_VERSION, "2.337.0");
  assert.equal(RUNNER_PLATFORM, "win-x64");
  assert.ok(RUNNER_DOWNLOAD_URL.includes(RUNNER_VERSION));
  assert.ok(RUNNER_DOWNLOAD_URL.endsWith(".zip"));
  assert.match(RUNNER_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(RUNNER_DEFAULT_DIR, "C:\\actions-runner");
});

test("parseRepoSlug: owner/name estricto", () => {
  assert.equal(parseRepoSlug("FrancoManfredi/test-orquestador"), "FrancoManfredi/test-orquestador");
  assert.equal(parseRepoSlug(" a/b "), "a/b");
  assert.equal(parseRepoSlug(""), null);
  assert.equal(parseRepoSlug("solo-owner"), null);
  assert.equal(parseRepoSlug("a/b/c"), null);
  assert.equal(parseRepoSlug("a/b c"), null);
  assert.equal(parseRepoSlug(null), null);
  assert.equal(parseRepoSlug("a/".padEnd(300, "b")), null);
});

test("parseRunnerDir: absoluta Windows con cota", () => {
  assert.equal(parseRunnerDir("C:\\actions-runner"), "C:\\actions-runner");
  assert.equal(parseRunnerDir("C:/actions-runner"), "C:\\actions-runner");
  assert.equal(parseRunnerDir("relativa/dir"), null);
  assert.equal(parseRunnerDir(""), null);
  assert.equal(parseRunnerDir(null), null);
});

test("parseRunnersResponse: lista válida, junk honesto", () => {
  const got = parseRunnersResponse({
    runners: [
      { name: "pc-casa", os: "windows", labels: [{ name: "self-hosted" }, "Windows"], status: "online", busy: false },
      { name: "pc-trabajo", os: "windows", labels: [], status: "offline", busy: false },
      { name: "" },
      null,
    ],
  });
  assert.equal(got.length, 2);
  assert.equal(got[0]?.name, "pc-casa");
  assert.equal(got[0]?.online, true);
  assert.deepEqual([...(got[0]?.labels ?? [])], ["self-hosted", "Windows"]);
  assert.equal(got[1]?.online, false);
  assert.deepEqual(parseRunnersResponse(null), []);
  assert.deepEqual(parseRunnersResponse({ runners: "junk" }), []);
});

function fakeExec(
  handler: (cmd: string, args: readonly string[]) => { stdout: string; stderr?: string } | null,
): { calls: Array<{ cmd: string; args: readonly string[] }>; run: RunnerExec } {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const run: RunnerExec = async (cmd, args) => {
    calls.push({ cmd, args });
    const hit = handler(cmd, args);
    if (hit === null) throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
    return { stdout: hit.stdout, stderr: hit.stderr ?? "" };
  };
  return { calls, run };
}

test("status: local + remoto con fakes, pinned completo", async () => {
  const { run } = fakeExec((cmd) => {
    if (cmd === "gh") {
      return {
        stdout: JSON.stringify({
          runners: [{ name: "pc", os: "windows", labels: [], status: "online", busy: true }],
        }),
      };
    }
    if (cmd === "powershell.exe") return { stdout: "" };
    return null;
  });
  const got = await getRunnersStatus({ repo: "a/b", folder: "C:\\actions-runner" }, run);
  assert.equal(got.remote.reachable, true);
  assert.equal(got.remote.runners.length, 1);
  assert.equal(got.remote.runners[0]?.busy, true);
  assert.equal(got.pinned.version, RUNNER_VERSION);
  assert.equal(got.pinned.sha256, RUNNER_SHA256);
  assert.ok(got.pinned.url.includes(RUNNER_VERSION));
});

test("status: repo inválido degrada a solo-local, nunca lanza", async () => {
  const { calls, run } = fakeExec((cmd) => {
    if (cmd === "powershell.exe") return { stdout: "" };
    return null;
  });
  const got = await getRunnersStatus({ repo: "no-slug" }, run);
  assert.equal(got.remote.reachable, false);
  assert.deepEqual(got.remote.runners, []);
  assert.ok(!calls.some((c) => c.cmd === "gh"), "sin repo válido no se llama a gh");
  const nullExec = await getRunnersStatus({ repo: "a/b" }, null as unknown as RunnerExec);
  assert.equal(nullExec.remote.reachable, false);
});

test("routes: match exacto sin alias + null ajeno", () => {
  assert.deepEqual(parseRunnersStatusPath("GET", "/factory/github/runners/status"), { ok: true });
  assert.equal(parseRunnersStatusPath("POST", "/factory/github/runners/status"), null);
  assert.equal(parseRunnersStatusPath("GET", "/factory/github/runners/install"), null);
  assert.equal(parseRunnersStatusPath("GET", "/factory/github/runners/install/stream"), null);
  assert.equal(parseRunnersStatusPath("GET", 123), null);
});
