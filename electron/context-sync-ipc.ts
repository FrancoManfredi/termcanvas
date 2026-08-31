// IPC de sincronización de contexto: expone el motor cli/context-sync al
// renderer. Misma lógica que el CLI standalone (termcanvas context ...),
// corre en el proceso principal con Node completo.

import { ipcMain } from "electron";

import {
  contextInit,
  contextPull,
  contextPush,
  contextStatus,
  readSyncConfig,
  writeSyncConfig,
  type SyncConfig,
  realDeps,
} from "../cli/context-sync/operations.ts";
import type { CommandRunner } from "../cli/context-sync/types.ts";

const deps = { ...realDeps() };

export type IpcEnvelope<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

function wrap<T>(fn: () => Promise<T>): Promise<IpcEnvelope<T>> {
  return fn()
    .then((result) => ({ ok: true as const, result }))
    .catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
}

export interface SmartSyncResult {
  pulled: Awaited<ReturnType<typeof contextPull>>;
  pushed: Awaited<ReturnType<typeof contextPush>>;
}

/**
 * Sync inteligente: pull primero (trae lo remoto, deja conflictos a la
 * vista) y después push (conmuta el estado local ya integrado). Si pull
 * falla por divergencia del sidecar, no se intenta push.
 */
async function smartSync(repoPath: string): Promise<SmartSyncResult> {
  const pulled = await contextPull(repoPath, deps);
  const pushed = await contextPush(repoPath, deps);
  return { pulled, pushed };
}

export function registerContextSyncIpc(runner?: CommandRunner): void {
  if (runner) deps.run = runner;
  ipcMain.handle("context-sync:status", (_event, repoPath: string) =>
    wrap(() => contextStatus(repoPath, deps)),
  );
  ipcMain.handle("context-sync:init", (_event, repoPath: string) =>
    wrap(() => contextInit(repoPath, deps)),
  );
  ipcMain.handle("context-sync:pull", (_event, repoPath: string) =>
    wrap(() => contextPull(repoPath, deps)),
  );
  ipcMain.handle("context-sync:push", (_event, repoPath: string) =>
    wrap(() => contextPush(repoPath, deps)),
  );
  ipcMain.handle("context-sync:sync", (_event, repoPath: string) =>
    wrap(() => smartSync(repoPath)),
  );
  ipcMain.handle("context-sync:get-config", (_event, repoPath: string) =>
    wrap(async () => readSyncConfig(repoPath)),
  );
  ipcMain.handle("context-sync:set-config", (_event, repoPath: string, cfg: SyncConfig) =>
    wrap(async () => {
      writeSyncConfig(repoPath, cfg);
      return readSyncConfig(repoPath);
    }),
  );
}
