import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-probe-"));
const script = path.join(dir, "codex.cmd");
fs.writeFileSync(script, "@echo off\r\necho hooks experimental true\r\n");

const prev = process.env.PATH;
process.env.PATH = `${dir}${path.delimiter}${prev ?? ""}`;
try {
  const out = execFileSync("codex", ["features", "list"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2000,
  });
  console.log("EXEC OK:", JSON.stringify(out));
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  console.log("EXEC FAIL:", e.code, "-", (err as Error).message);
} finally {
  if (prev === undefined) delete process.env.PATH;
  else process.env.PATH = prev;
  fs.rmSync(dir, { recursive: true, force: true });
}