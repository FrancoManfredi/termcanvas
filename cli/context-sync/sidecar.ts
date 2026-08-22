// Sidecar privado termcanvas-context: UN repo git privado que guarda el
// contexto (.agents) de todos los proyectos, bajo projects/<owner>/<name>.
// Vive clonado en ~/.termcanvas/context-sync/repo con su config en
// ~/.termcanvas/context-sync/config.json. La creación usa gh la primera
// vez; después del clone todo es git puro.

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CommandRunner } from "./types.ts";

export const SIDECAR_REPO_NAME = "termcanvas-context";
export const CONTEXT_SYNC_SCHEMA_VERSION = "termcanvas/context-sync/v1";

export interface ContextSyncConfig {
  schema_version: string;
  /** "<owner>/termcanvas-context" */
  slug: string;
  /** URL desde la que se clona (https de GitHub o path local en tests). */
  remote: string;
}

/** Raíz del estado local de sincronización. Override vía TERMCANVAS_CONTEXT_HOME (tests). */
export function contextHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.TERMCANVAS_CONTEXT_HOME?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".termcanvas", "context-sync");
}

export function sidecarRepoDir(home: string): string {
  return path.join(home, "repo");
}

export function configPath(home: string): string {
  return path.join(home, "config.json");
}

export function readConfig(
  home: string,
): ContextSyncConfig | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(configPath(home), "utf-8"),
    ) as ContextSyncConfig;
    if (
      typeof parsed.slug !== "string" ||
      typeof parsed.remote !== "string" ||
      !parsed.slug.includes("/")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeConfig(
  home: string,
  config: ContextSyncConfig,
): void {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(configPath(home), JSON.stringify(config, null, 2));
}

/** Runner real sobre spawnSync. Devuelve status/stdout/stderr sin lanzar. */
export function defaultRunner(): CommandRunner {
  return (cmd, args, opts) =>
    new Promise((resolve) => {
      const res = childProcess.spawnSync(cmd, args, {
        cwd: opts?.cwd,
        encoding: "utf-8",
        windowsHide: true,
      });
      resolve({
        status: res.status ?? 1,
        stdout: res.stdout ?? "",
        stderr: res.stderr ?? "",
      });
    });
}

async function ghLogin(run: CommandRunner): Promise<string> {
  const res = await run("gh", ["api", "user", "--jq", ".login"]);
  if (res.status !== 0 || !res.stdout.trim()) {
    throw new Error(
      "No se pudo resolver el usuario de GitHub con gh. Autenticá primero: gh auth login",
    );
  }
  return res.stdout.trim();
}

export interface SidecarHandle {
  config: ContextSyncConfig;
  repoDir: string;
}

/**
 * Asegura config + repo clonado. Con config preexistente NUNCA llama a gh:
 * el flujo diario es git puro contra el remote guardado (los tests usan esto
 * para apuntar a un bare local).
 */
export async function ensureSidecar(
  home: string,
  run: CommandRunner,
): Promise<SidecarHandle> {
  let config = readConfig(home);
  if (!config) {
    const login = await ghLogin(run);
    const slug = `${login}/${SIDECAR_REPO_NAME}`;
    const view = await run("gh", ["repo", "view", slug, "--json", "nameWithOwner"]);
    if (view.status !== 0) {
      const created = await run("gh", [
        "repo",
        "create",
        SIDECAR_REPO_NAME,
        "--private",
      ]);
      if (created.status !== 0) {
        throw new Error(
          `No se pudo crear el repositorio privado ${slug}:\n${created.stderr.trim()}`,
        );
      }
    }
    config = {
      schema_version: CONTEXT_SYNC_SCHEMA_VERSION,
      slug,
      remote: `https://github.com/${slug}.git`,
    };
    writeConfig(home, config);
  }

  const repoDir = sidecarRepoDir(home);
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    const clone = await run("git", ["clone", config.remote, repoDir]);
    if (clone.status !== 0) {
      throw new Error(
        `No se pudo clonar ${config.remote}:\n${clone.stderr.trim()}`,
      );
    }
  }
  return { config, repoDir };
}

// ─── Helpers de git sobre el sidecar ────────────────────────────────────────

/** true si HEAD existe (el repo tiene al menos un commit). */
export async function hasCommits(
  run: CommandRunner,
  repoDir: string,
): Promise<boolean> {
  const res = await run("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: repoDir,
  });
  return res.status === 0;
}

export async function currentBranch(
  run: CommandRunner,
  repoDir: string,
): Promise<string> {
  const res = await run("git", ["symbolic-ref", "--short", "HEAD"], {
    cwd: repoDir,
  });
  return res.stdout.trim();
}

export async function hasUpstream(
  run: CommandRunner,
  repoDir: string,
): Promise<boolean> {
  const res = await run("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
    cwd: repoDir,
  });
  return res.status === 0;
}

/**
 * user.name/user.email del entorno git; si el ambiente no tiene identidad
 * configurada, genera args -c con identidad derivada del hostname para que
 * el commit nunca falle por configuración faltante.
 */
export async function commitIdentityArgs(
  run: CommandRunner,
  repoDir: string,
): Promise<string[]> {
  const email = await run("git", ["config", "user.email"], { cwd: repoDir });
  const name = await run("git", ["config", "user.name"], { cwd: repoDir });
  if (email.status === 0 && email.stdout.trim() && name.status === 0 && name.stdout.trim()) {
    return [];
  }
  const host = os.hostname().replace(/[^A-Za-z0-9._-]/g, "-");
  return [
    "-c",
    `user.name=${host}`,
    "-c",
    `user.email=${host}@termcanvas.local`,
  ];
}

/**
 * git pull --ff-only sobre el sidecar. Sin commits aún (repo recién creado)
 * no hace nada. Falla con mensaje claro si el sidecar divergió del remote.
 */
export async function ffPullSidecar(
  run: CommandRunner,
  repoDir: string,
): Promise<void> {
  if (!(await hasCommits(run, repoDir))) return;
  const pull = await run("git", ["pull", "--ff-only"], { cwd: repoDir });
  if (pull.status !== 0) {
    throw new Error(
      "El sidecar divergió del remoto y git pull --ff-only falló. Resolvélo manualmente con:\n" +
        `  git -C ${repoDir} pull\n${pull.stderr.trim()}`,
    );
  }
}
