/**
 * Smoke real del workflow engine contra un server OpenCode scopeado.
 *
 * Por qué existe: los smoke ad-hoc con `tsx --eval` dejaban servers
 * huérfanos escuchando (close() no siempre mata el árbol en Windows con
 * shell:true), y el comando quedaba "colgado" esperando handles abiertos.
 * Este script garantiza:
 *   1. watchdog duro (90s) que fuerza salida;
 *   2. close() + verificación del puerto;
 *   3. taskkill /T /F del PID dueño del puerto si sigue vivo;
 *   4. process.exit explícito al final.
 *
 * Uso: pnpm exec tsx scripts/wf-live-smoke.ts
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { materializeNodeCapabilities } from "../headless-runtime/workflows/capabilities";
import { spawnOpencodeServer } from "../headless-runtime/opencodeServerManager";
import { encontrarPuertoServidor } from "../headless-runtime/interview/puerto-libre";

const HARD_TIMEOUT_MS = 90_000;

const watchdog = setTimeout(() => {
  console.error("[wf-live-smoke] watchdog: forzando salida a los 90s");
  process.exit(2);
}, HARD_TIMEOUT_MS);
watchdog.unref();

function portOwnerPid(port: number): number | null {
  try {
    const out =
      spawnSync("netstat", ["-ano"], { encoding: "utf-8", windowsHide: true })
        .stdout ?? "";
    for (const line of out.split("\n")) {
      if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch {
    // sin netstat: cae al pid del handle
  }
  return null;
}

function killTree(pid: number): void {
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // best-effort
  }
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const scopeDir = path.join(
    repoRoot,
    ".agents",
    "factory",
    "workflow-runs",
    "live-scope",
  );
  const scope = materializeNodeCapabilities(
    { skills: ["code-review"] },
    { repoRoot, workflowDir: repoRoot, scopeDir },
  );
  if (!scope) throw new Error("no se materializó el scope de skills");
  console.log("[wf-live-smoke] config:", JSON.stringify(scope.config));

  const port = await encontrarPuertoServidor(20_000, 45_000, 12);
  const handle = await spawnOpencodeServer({
    hostname: "127.0.0.1",
    port,
    timeout: 20_000,
    config: scope.config,
  });
  console.log(`[wf-live-smoke] server: ${handle.url} pid=${handle.pid ?? "?"}`);

  try {
    const client = createOpencodeClient({ baseUrl: handle.url });
    const created = await client.session.create({
      title: "wf-live-smoke",
      directory: repoRoot,
    });
    const sessionId =
      created && (created.id || (created.data && created.data.id));
    console.log("[wf-live-smoke] session:", sessionId);
    if (sessionId) {
      await client.session.delete({ sessionID: sessionId }).catch(() => {});
    }
  } finally {
    handle.close();
    await new Promise((resolve) => setTimeout(resolve, 800));
    const residual = portOwnerPid(port) ?? handle.pid ?? null;
    if (residual) {
      console.log(`[wf-live-smoke] limpiando server residual pid=${residual}`);
      killTree(residual);
    }
  }
}

main()
  .then(() => {
    console.log("[wf-live-smoke] OK");
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "[wf-live-smoke] FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
