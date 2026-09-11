/**
 * opencode-spawn-platform — Windows shim resolution for the ephemeral
 * opencode server (Resolve Issue root cause).
 *
 * On Windows `opencode` installed by npm is a `.cmd` shim: a bare
 * `spawn("opencode", args)` fails with ENOENT because CreateProcess does
 * not resolve PATHEXT for `.cmd`/`.bat` (live evidence: health answered
 * `opencode.status=not_started, error="spawn opencode ENOENT"` and every
 * job parked in Triage with no sessions). The shell form (single command
 * string, empty args array) lets cmd.exe resolve the shim and stays
 * DEP0190-safe. Offline, pure, zero spawns.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveOpencodeCommand } from "../headless-runtime/opencodeServerManager.ts";

test("win32 resolves the npm shim through the shell (single command, no args)", () => {
  const spec = resolveOpencodeCommand(
    ["serve", "--hostname=127.0.0.1", "--port=20274"],
    "win32",
  );
  assert.equal(spec.shell, true, "cmd.exe must resolve opencode.cmd");
  assert.equal(
    spec.command,
    "opencode serve --hostname=127.0.0.1 --port=20274",
  );
  assert.deepEqual(spec.args, [], "no args array with shell:true (no DEP0190)");
});

test("posix keeps the argv array without a shell", () => {
  const spec = resolveOpencodeCommand(["serve", "--port=20274"], "linux");
  assert.equal(spec.shell, false);
  assert.equal(spec.command, "opencode");
  assert.deepEqual(spec.args, ["serve", "--port=20274"]);
});

test("junk args are dropped and quotes stripped (never an injection vector)", () => {
  const spec = resolveOpencodeCommand(
    ["serve", "", 42 as unknown as string, '--label="a-b"'],
    "win32",
  );
  assert.equal(spec.command, "opencode serve --label=a-b");
});
