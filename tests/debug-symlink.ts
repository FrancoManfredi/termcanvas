import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "symlink-ok-"));
fs.rmSync(dir, { recursive: true });

const targetA = path.join(dir, "no-parent", "target");
try {
  fs.mkdirSync(path.dirname(targetA), { recursive: true });
  fs.symlinkSync(targetA, path.join(os.tmpdir(), "symlink-opencode-test-a"), "dir");
  console.log("SYMLINK OK: target parent exists");
} catch (e) {
  console.log("SYMLINK FAIL, target parent exists:", e.code, e.message);
}

const targetB = path.join(dir, "no-parent-b", "target");
try {
  fs.symlinkSync(targetB, path.join(os.tmpdir(), "symlink-opencode-test-b"), "dir");
  console.log("SYMLINK OK: target parent missing");
} catch (e) {
  console.log("SYMLINK FAIL, target parent missing:", e.code, e.message);
}

fs.rmSync(path.join(os.tmpdir(), "symlink-opencode-test-a"), { force: true });
fs.rmSync(path.join(os.tmpdir(), "symlink-opencode-test-b"), { force: true });