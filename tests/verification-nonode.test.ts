import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VerificationService } from "../headless-runtime/implement/verification.ts";

// Worktree no-Node (sin package.json): verification no debe fallar —
// test/build skipped con overall pass para que el job siga a Review.

test("sin package.json → test+build skipped, overall pass (no Triage)", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verif-nonode-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verif-nonode-dir-"));
  assert.equal(fs.existsSync(path.join(worktree, "package.json")), false);
  const svc = new VerificationService();
  const report = await svc.run(worktree, dir, "crear archivo de notas de la reunion");
  assert.equal(report.overall, "pass");
  assert.equal(report.steps.length, 2);
  assert.equal(report.steps[0].name, "test");
  assert.equal(report.steps[0].status, "skipped");
  assert.equal(report.steps[1].name, "build");
  assert.equal(report.steps[1].status, "skipped");
  assert.match(report.steps[0].logSnippet ?? "", /no package\.json/);
  assert.match(report.steps[0].logSnippet ?? "", /unknown project kind/);
  const buildLog = fs.readFileSync(path.join(dir, "logs", "build.log"), "utf-8");
  assert.match(buildLog, /JS suite N\/A/);
});

test("sin package.json → no corre pnpm (rápido, sin spawn)", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verif-nonode-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verif-nonode-dir-"));
  const svc = new VerificationService();
  const start = Date.now();
  const report = await svc.run(worktree, dir, "otro prompt neutro");
  assert.ok(Date.now() - start < 10000, "no debe spawnear pnpm (sería lento)");
  assert.equal(report.overall, "pass");
});
