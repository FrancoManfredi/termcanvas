/**
 * no-console-windows — en Windows con el daemon detached (sin consola),
 * cada spawn/execFile SIN `windowsHide: true` abre una consola visible
 * (PowerShell). Este pin estático exige windowsHide en todos los spawns
 * del daemon + Electron git, y prohíbe el `createOpencodeServer` del SDK
 * (cross-spawn sin windowsHide: se usa el spawner propio).
 *
 * Offline, puro, cero daemon, cero red.
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

function countMatches(src: string, re: RegExp): number {
  const m = src.match(re);
  return m ? m.length : 0;
}

// Archivo → mínimo de ocurrencias `windowsHide: true` esperadas (una por
// sitio de spawn vivo). Si agregás un spawn, agregá su windowsHide acá.
// Barrido completo (2026-09-10): TODO spawn de background del renderer main
// y del daemon oculta su consola en Windows. Los PTY reales
// (pty-manager/pty-launch node-pty) quedan afuera a propósito.
const WINDOWS_HIDE_MIN: ReadonlyArray<readonly [string, number]> = [
  ["headless-runtime/github-lookups.ts", 1],
  ["headless-runtime/artifact-collector.ts", 1],
  ["headless-runtime/implement/minimalChange.ts", 4],
  ["headless-runtime/runner/runnerExecutor.ts", 2],
  ["headless-runtime/implement/verification.ts", 1],
  ["headless-runtime/opencodeServerManager.ts", 3],
  ["headless-runtime/factory/isolation/gitWorktree.ts", 1],
  ["headless-runtime/factory/isolation/gitHubPr.ts", 1],
  ["headless-runtime/factory/jobs/jobDiscard.ts", 1],
  ["headless-runtime/factory/factoryServer.ts", 1],
  ["headless-runtime/worktree-control.ts", 7],
  ["headless-runtime/worktree-helpers.ts", 1],
  ["headless-runtime/review/reviewDiff.ts", 1],
  ["headless-runtime/interview/harness/codebuddy.ts", 1],
  ["electron/main.ts", 76],
  ["electron/git-info.ts", 5],
  ["electron/git-diff.ts", 2],
  ["electron/git-watcher.ts", 1],
  ["electron/worktree-helpers.ts", 1],
  ["electron/api-server.ts", 3],
  ["electron/cli-registration.ts", 4],
  ["electron/search-handlers.ts", 3],
  ["electron/quota-fetcher.ts", 1],
  ["electron/project-scanner.ts", 4],
  ["electron/process-detector.ts", 3],
  ["electron/summary-service.ts", 1],
  ["electron/insights-engine.ts", 1],
  ["electron/playground-ipc.ts", 1],
  ["electron/claude-code-driver.ts", 1],
  ["electron/skill-manager.ts", 2],
  ["electron/mcp/health/local-probe.ts", 3],
  ["electron/pty-launch.ts", 1],
];

test("cada spawn del daemon/Electron lleva windowsHide (cero consolas)", () => {
  for (const [rel, min] of WINDOWS_HIDE_MIN) {
    const src = readRel(rel);
    const n = countMatches(src, /windowsHide:\s*true/g);
    assert.ok(
      n >= min,
      `${rel}: esperaba ≥${min} windowsHide, hay ${n} (un spawn sin ocultar abre PowerShell)`,
    );
  }
});

test("spawn/execFile vivos del daemon siempre con windowsHide (sin excepciones sin pin)", () => {
  // Sitios de spawn conocidos (los cuenta el test anterior). Si este test
  // falla porque agregaste un spawn legítimo YA con windowsHide, subí el
  // mínimo de arriba en vez de tocar este.
  const spawnSites = [
    ...["headless-runtime/implement/minimalChange.ts"].flatMap((f) => {
      const src = readRel(f);
      return Array(countMatches(src, /spawnSync\(/g)).fill(f);
    }),
  ];
  assert.ok(spawnSites.length >= 4, "sanity del conteo spawnSync");
});

test("prohibido createOpencodeServer del SDK en código vivo (abre consola)", () => {
  const live = [
    "headless-runtime/opencodeServerManager.ts",
    "headless-runtime/interview/harness/opencode.ts",
  ];
  for (const rel of live) {
    const src = readRel(rel);
    assert.ok(
      !src.includes("createOpencodeServer("),
      `${rel}: usar spawnOpencodeServer propio (el SDK abre consola en Win)`,
    );
  }
  assert.ok(
    readRel("headless-runtime/opencodeServerManager.ts").includes("spawnOpencodeServer"),
    "el spawner propio existe en opencodeServerManager",
  );
});
