/**
 * factory-ownership — lease de ownership del pipeline (F2).
 *
 * Contexto real: app in-process + standalone de dev (`tsx --watch`) pueden
 * convivir; sin lease, el boot nuevo reclama y parkea los jobs del otro
 * daemon vivo ("daemon reiniciado" en #125). Puro/offline: lock en un path
 * explícito de sandbox, sin tocar el data dir real.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OWNERSHIP_TTL_MS,
  claimOwnership,
  heartbeatOwnership,
  isLockHeldByLiveOwner,
  isProcessAlive,
  maybeHeartbeatOwnership,
  readOwnershipLock,
  releaseOwnership,
  resetOwnershipThrottleForTests,
} from "../headless-runtime/factory/ownership.ts";

function sandboxLock(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-"));
  return path.join(dir, "factory.lock");
}

test("claim en vacío escribe el lock y queda como dueño", () => {
  const lockPath = sandboxLock();
  const claim = claimOwnership(lockPath, { pid: process.pid, instance: "test" });
  assert.equal(claim.claimed, true);
  const lock = readOwnershipLock(lockPath);
  assert.equal(lock?.pid, process.pid);
  assert.equal(lock?.instance, "test");
});

test("owner vivo bloquea el claim; owner muerto se reclama", () => {
  const lockPath = sandboxLock();
  claimOwnership(lockPath, { pid: process.pid, nowMs: 1_000 });
  const foreign = claimOwnership(lockPath, {
    pid: process.pid + 4242,
    nowMs: 2_000,
  });
  assert.equal(foreign.claimed, false, "pid vivo con heartbeat fresco bloquea");
  assert.equal(foreign.lock?.pid, process.pid);

  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: 2 ** 30,
      instance: "x",
      startedAt: "",
      heartbeatAt: new Date().toISOString(),
    }),
    "utf-8",
  );
  const reclaim = claimOwnership(lockPath, { pid: process.pid, nowMs: Date.now() });
  assert.equal(reclaim.claimed, true, "pid muerto se reclama");
  assert.equal(readOwnershipLock(lockPath)?.pid, process.pid);
});

test("heartbeat viejo (TTL) deja el lock reclamable", () => {
  const lockPath = sandboxLock();
  const now = Date.now();
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: process.pid,
      instance: "x",
      startedAt: "",
      heartbeatAt: new Date(now - OWNERSHIP_TTL_MS - 1_000).toISOString(),
    }),
    "utf-8",
  );
  assert.equal(isLockHeldByLiveOwner(readOwnershipLock(lockPath), now), false);
  const claim = claimOwnership(lockPath, { pid: process.pid + 4242, nowMs: now });
  assert.equal(claim.claimed, true, "stale no bloquea a un daemon nuevo");
});

test("heartbeat y release solo tocan el lock propio", () => {
  const lockPath = sandboxLock();
  resetOwnershipThrottleForTests();
  claimOwnership(lockPath, { pid: process.pid, nowMs: 1_000 });
  const before = readOwnershipLock(lockPath)?.heartbeatAt;
  assert.equal(heartbeatOwnership(lockPath, 61_000, true), true);
  const after = readOwnershipLock(lockPath)?.heartbeatAt;
  assert.notEqual(after, before, "heartbeat actualizado");

  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: process.pid + 4242,
      instance: "x",
      startedAt: "",
      heartbeatAt: new Date().toISOString(),
    }),
    "utf-8",
  );
  assert.equal(heartbeatOwnership(lockPath, Date.now(), true), false);
  releaseOwnership(lockPath);
  assert.ok(fs.existsSync(lockPath), "release ajeno no borra");

  resetOwnershipThrottleForTests();
  claimOwnership(lockPath, { pid: process.pid });
  releaseOwnership(lockPath);
  assert.equal(fs.existsSync(lockPath), false, "release propio borra");
});

test("junk nunca lanza y el lock basura se reclama (fail-open)", () => {
  const lockPath = sandboxLock();
  fs.writeFileSync(lockPath, "{ no json", "utf-8");
  assert.equal(readOwnershipLock(lockPath), null);
  assert.equal(isLockHeldByLiveOwner(null), false);
  assert.equal(isProcessAlive("x"), false);
  assert.equal(isProcessAlive(-1), false);
  assert.equal(isProcessAlive(2 ** 30), false);
  const claim = claimOwnership(lockPath, { pid: process.pid });
  assert.equal(claim.claimed, true, "lock basura se reclama");
  resetOwnershipThrottleForTests();
  assert.equal(maybeHeartbeatOwnership(lockPath), true);
});
