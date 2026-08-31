import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureCliLauncher,
  getCliLauncherPath,
  getWindowsCliLauncherContent,
} from "../electron/cli-launchers.ts";

test("getCliLauncherPath uses extensionless launcher on unix", () => {
  assert.equal(
    getCliLauncherPath("/tmp/dist-cli/termcanvas.js", "darwin"),
    "/tmp/dist-cli/termcanvas",
  );
});

test("getCliLauncherPath uses cmd launcher on windows", () => {
  assert.equal(
    getCliLauncherPath("C:\\dist-cli\\termcanvas.js", "win32"),
    "C:\\dist-cli\\termcanvas.cmd",
  );
});

test("getWindowsCliLauncherContent targets the bundled js file", () => {
  assert.equal(
    getWindowsCliLauncherContent("C:\\dist-cli\\termcanvas.js"),
    '@echo off\r\nnode "%~dp0\\termcanvas.js" %*\r\n',
  );
});

test(
  "ensureCliLauncher creates a symlink on unix",
  { skip: process.platform === "win32" },
  () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-launcher-unix-"));
  const jsPath = path.join(dir, "termcanvas.js");
  fs.writeFileSync(jsPath, "#!/usr/bin/env node\n");

  ensureCliLauncher(jsPath, "darwin");

  const linkPath = path.join(dir, "termcanvas");
  const stat = fs.lstatSync(linkPath);
  assert.equal(stat.isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(linkPath), "termcanvas.js");

  fs.rmSync(dir, { recursive: true, force: true });
  },
);

test("ensureCliLauncher creates a cmd shim and removes stale unix launcher on windows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-launcher-win-"));
  const jsPath = path.join(dir, "termcanvas.js");
  const staleUnixLauncher = path.join(dir, "termcanvas");
  fs.writeFileSync(jsPath, "#!/usr/bin/env node\r\n");
  fs.writeFileSync(staleUnixLauncher, "stale");

  ensureCliLauncher(jsPath, "win32");

  assert.equal(fs.existsSync(staleUnixLauncher), false);
  assert.equal(
    fs.readFileSync(path.join(dir, "termcanvas.cmd"), "utf-8"),
    '@echo off\r\nnode "%~dp0\\termcanvas.js" %*\r\n',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
