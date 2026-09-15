/**
 * F13: "Retomar" legacy retirado. Los jobs CON run se reanudan por el bridge
 * del engine (job-resume interceptado → `resumeRuntimeRun`); los jobs sin run
 * (históricos) reciben 410 honesto. Pin estático del cascarón + del bridge.
 *
 * Offline: solo lectura del fuente, cero daemon, cero red.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRel(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf-8");
}

test("resume legacy retirado: 410 honesto y el engine intercepta job-resume", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  const start = src.indexOf("async function handleJobResumeRoute(");
  assert.ok(start >= 0, "existe handleJobResumeRoute");
  const end = src.indexOf("\nasync function ", start + 10);
  const body = end > start ? src.slice(start, end) : src.slice(start, start + 1200);
  assert.match(body, /410/, "responde 410");
  assert.match(body, /resume legacy retirado/, "mensaje honesto del retiro");
  assert.equal(body.includes("runResumeWorker("), false, "sin worker legacy");
  assert.equal(body.includes("implementService"), false, "sin services legacy");

  const bridge = readRel("headless-runtime/factory/engineBridge.ts");
  assert.ok(
    bridge.includes('"job-resume"'),
    "el bridge intercepta job-resume (engine)",
  );
});
