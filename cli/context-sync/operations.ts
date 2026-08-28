// Operaciones de sincronización de contexto: init / push / pull / status.
//
// Semántica de conflicto (v1, sin fallbacks silenciosos):
// - Los artefactos con nombre timestamped (entrevistas, síntesis, briefs)
//   son aditivos entre máquinas: dos máquinas rara vez tocan el mismo file.
// - pull NUNCA pisa archivos locales. Si el remoto trae un archivo que
//   también cambió localmente, la versión entrante se guarda al lado como
//   <archivo>.conflict-<timestamp> y la local queda intacta: la decisión
//   es del usuario, visible y trazable.
// - push ESPEJA el subtree local (borra en el sidecar lo que ya no existe
//   localmente) y falla si el push es non-fast-forward, indicando correr
//   `termcanvas context pull` primero.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveProjectIdentity,
  slugToString,
  type RepoSlug,
} from "./identity.ts";
import {
  copyFileEnsuring,
  diffTrees,
  listFilesRecursive,
} from "./fs-utils.ts";
import {
  commitIdentityArgs,
  contextHome,
  currentBranch,
  defaultRunner,
  ensureSidecar,
  ffPullSidecar,
  hasCommits,
  hasUpstream,
  readConfig,
  sidecarRepoDir,
  type ContextSyncConfig,
} from "./sidecar.ts";
import type { CommandRunner } from "./types.ts";

export interface ContextOpDeps {
  run: CommandRunner;
  now: () => Date;
  hostname: string;
  /** Override del home de sincronización (tests). Default: contextHome(). */
  home?: string;
}

export function realDeps(): ContextOpDeps {
  return {
    run: defaultRunner(),
    now: () => new Date(),
    hostname: os.hostname(),
  };
}

function resolveHome(deps: ContextOpDeps): string {
  return deps.home ?? contextHome();
}

export interface InitResult {
  slug: string;
  repoDir: string;
  remote: string;
  gitignoreUpdated: boolean;
}

function agentsDirOf(projectPath: string): string {
  return path.join(projectPath, ".agents");
}

function projectSubtree(repoDir: string, slug: RepoSlug): string {
  return path.join(repoDir, "projects", slug.owner, slug.name);
}

// ─── Sync-config por proyecto (4 switches en Sincronización) ───────────────

export interface SyncConfig {
  entrevistas: boolean;
  diagnosticos: boolean;
  mcp: boolean;
  skills: boolean;
}

export function defaultSyncConfig(): SyncConfig {
  return { entrevistas: true, diagnosticos: true, mcp: true, skills: true };
}

export function sanitizeSyncConfig(raw: unknown): SyncConfig {
  const def = defaultSyncConfig();
  if (!raw || typeof raw !== "object") return def;
  const r = raw as Record<string, unknown>;
  return {
    entrevistas: typeof r.entrevistas === "boolean" ? r.entrevistas : def.entrevistas,
    diagnosticos: typeof r.diagnosticos === "boolean" ? r.diagnosticos : def.diagnosticos,
    mcp: typeof r.mcp === "boolean" ? r.mcp : def.mcp,
    skills: typeof r.skills === "boolean" ? r.skills : def.skills,
  };
}

function syncConfigPath(projectPath: string): string {
  return path.join(projectPath, ".agents", "sync-config.json");
}

function legacyDiagnosisSkillsShared(projectPath: string): boolean | null {
  try {
    const p = path.join(projectPath, ".agents", "diagnosis-skills.json");
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (typeof raw.shared === "boolean") return raw.shared;
    return null;
  } catch {
    return null;
  }
}

export function readSyncConfig(projectPath: string): SyncConfig {
  try {
    const p = syncConfigPath(projectPath);
    if (!fs.existsSync(p)) {
      const legacy = legacyDiagnosisSkillsShared(projectPath);
      if (legacy !== null) {
        const cfg = { ...defaultSyncConfig(), skills: legacy };
        return cfg;
      }
      return defaultSyncConfig();
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return sanitizeSyncConfig(raw);
  } catch {
    return defaultSyncConfig();
  }
}

export function writeSyncConfig(projectPath: string, config: SyncConfig): void {
  const sanitized = sanitizeSyncConfig(config);
  const p = syncConfigPath(projectPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(sanitized, null, 2), "utf-8");
}

function isKeyEnabledForSync(key: string, cfg: SyncConfig): boolean {
  if (key === "sync-config.json") return true;
  if (key === "diagnosis-skills.json") return true;
  if (key.startsWith(".conflicts/") || key.includes(".conflict-")) return false;
  if (key === "README.md" || key === ".gitignore") return false;
  if (key.startsWith("interview/")) return cfg.entrevistas;
  if (key.startsWith("planning/") || key === "planner-results.json" || key === "activity.json") return cfg.diagnosticos;
  if (key === "mcp.json") return cfg.mcp;
  if (key.startsWith("diagnosis-skills/")) return cfg.skills;
  if (key === "repo-context.md") return false;
  return true;
}

function filterKeysBySyncConfig(keys: string[], cfg: SyncConfig): string[] {
  return keys.filter((k) => isKeyEnabledForSync(k, cfg));
}

function filteredCopyTreeMirror(
  srcRoot: string,
  dstRoot: string,
  cfg: SyncConfig,
): { copied: string[]; deleted: string[] } {
  const copied: string[] = [];
  const deleted: string[] = [];
  fs.mkdirSync(dstRoot, { recursive: true });
  const rawSrcKeys = listFilesRecursive(srcRoot);
  const srcKeys = new Set(filterKeysBySyncConfig(rawSrcKeys, cfg));
  // Borrado: solo para keys habilitadas
  for (const key of listFilesRecursive(dstRoot)) {
    if (!isKeyEnabledForSync(key, cfg)) continue;
    if (!srcKeys.has(key)) {
      const full = path.join(dstRoot, ...key.split("/"));
      fs.rmSync(full, { force: true });
      deleted.push(key);
    }
  }
  // prune after deletes
  // reuse pruneEmptyDirs from fs-utils via direct fs logic (avoid import cycle)
  const pruneEmptyDirsLocal = (root: string): void => {
    const visit = (dir: string): boolean => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
      let isEmpty = true;
      for (const e of entries) {
        if (e.isDirectory()) { if (!visit(path.join(dir, e.name))) isEmpty = false; } else isEmpty = false;
      }
      if (isEmpty && dir !== root) { try { fs.rmdirSync(dir); return true; } catch { return false; } }
      return false;
    };
    visit(root);
  };
  pruneEmptyDirsLocal(dstRoot);
  for (const key of srcKeys) {
    const src = path.join(srcRoot, ...key.split("/"));
    const dst = path.join(dstRoot, ...key.split("/"));
    const srcHash = hashFile(src);
    const dstHash = fs.existsSync(dst) ? hashFile(dst) : null;
    if (!fs.existsSync(dst) || srcHash !== dstHash) {
      copyFileEnsuring(src, dst);
      copied.push(key);
    }
  }
  return { copied, deleted };
}

function hashFile(p: string): string | null {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch { return null; }
}

const GITIGNORE_MARKER = /^\s*\.agents\/?\s*$/m;

/**
 * Agrega .agents/ al .gitignore del proyecto para que el contexto nunca
 * termine commiteado al repo principal (el dato sensible vive solo en el
 * sidecar privado). Idempotente.
 */
function ensureGitignore(projectPath: string): boolean {
  const gitignorePath = path.join(projectPath, ".gitignore");
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf-8")
    : "";
  if (GITIGNORE_MARKER.test(existing)) return false;
  const block =
    (existing && !existing.endsWith("\n") ? "\n" : "") +
    "# TermCanvas: contexto local (.agents) sincronizado vía termcanvas-context\n" +
    ".agents/\n";
  fs.writeFileSync(gitignorePath, existing + block);
  return true;
}

async function requireAgentsDir(projectPath: string): Promise<string> {
  const dir = agentsDirOf(projectPath);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `${dir} no existe: no hay contexto (.agents) para sincronizar en este proyecto.`,
    );
  }
  return dir;
}

export async function contextInit(
  projectPath: string,
  deps: ContextOpDeps,
): Promise<InitResult> {
  const slug = await resolveProjectIdentity(projectPath, deps.run);
  const home = resolveHome(deps);
  const sidecar = await ensureSidecar(home, deps.run);
  const gitignoreUpdated = ensureGitignore(projectPath);
  return {
    slug: slugToString(slug),
    repoDir: sidecar.repoDir,
    remote: sidecar.config.remote,
    gitignoreUpdated,
  };
}

export interface PushResult {
  changed: boolean;
  pushed: boolean;
  copiedCount: number;
  deletedCount: number;
}

export async function contextPush(
  projectPath: string,
  deps: ContextOpDeps,
): Promise<PushResult> {
  const slug = await resolveProjectIdentity(projectPath, deps.run);
  const sidecar = await ensureSidecar(resolveHome(deps), deps.run);
  await ffPullSidecar(deps.run, sidecar.repoDir);

  const agentsDir = await requireAgentsDir(projectPath);
  const subtree = projectSubtree(sidecar.repoDir, slug);

  // Repo recién creado sin commits: la rama unborn depende del
  // init.defaultBranch LOCAL de cada máquina. Sin normalizarla, dos
  // máquinas podrían terminar en ramas distintas y diverger para siempre.
  // Se fuerza 'main' antes del primer commit.
  if (!(await hasCommits(deps.run, sidecar.repoDir))) {
    const co = await deps.run("git", ["checkout", "-B", "main"], {
      cwd: sidecar.repoDir,
    });
    if (co.status !== 0) {
      throw new Error(`git checkout -B main falló:\n${co.stderr.trim()}`);
    }
  }

  const syncCfg = readSyncConfig(projectPath);
  const mirror = filteredCopyTreeMirror(agentsDir, subtree, syncCfg);

  await deps.run("git", ["add", "-A", "--", "projects/"], {
    cwd: sidecar.repoDir,
  });
  const status = await deps.run("git", ["status", "--porcelain"], {
    cwd: sidecar.repoDir,
  });
  if (!status.stdout.trim()) {
    return { changed: false, pushed: false, copiedCount: 0, deletedCount: 0 };
  }

  const identityArgs = await commitIdentityArgs(deps.run, sidecar.repoDir);
  const stamp = deps.now().toISOString();
  const commit = await deps.run(
    "git",
    [...identityArgs, "commit", "-m", `sync(${slugToString(slug)}): ${deps.hostname} ${stamp}`],
    { cwd: sidecar.repoDir },
  );
  if (commit.status !== 0) {
    throw new Error(`git commit falló:\n${commit.stderr.trim()}`);
  }

  const pushArgs = (await hasUpstream(deps.run, sidecar.repoDir))
    ? ["push"]
    : ["push", "-u", "origin", await currentBranch(deps.run, sidecar.repoDir)];
  const push = await deps.run("git", pushArgs, { cwd: sidecar.repoDir });
  if (push.status !== 0) {
    throw new Error(
      "git push falló (¿el remoto avanzó?). Corré `termcanvas context pull` y volvé a pushear.\n" +
        push.stderr.trim(),
    );
  }

  return {
    changed: true,
    pushed: true,
    copiedCount: mirror.copied.length,
    deletedCount: mirror.deleted.length,
  };
}

export interface PullConflict {
  /** Clave relativa bajo .agents/. */
  key: string;
  /** Ruta absoluta donde quedó la versión entrante. */
  incomingPath: string;
}

export interface PullResult {
  pulled: boolean;
  addedKeys: string[];
  conflicts: PullConflict[];
  onlyLocalCount: number;
}

function conflictStamp(now: () => Date): string {
  return now().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export async function contextPull(
  projectPath: string,
  deps: ContextOpDeps,
): Promise<PullResult> {
  const slug = await resolveProjectIdentity(projectPath, deps.run);
  const sidecar = await ensureSidecar(resolveHome(deps), deps.run);
  await ffPullSidecar(deps.run, sidecar.repoDir);

  const subtree = projectSubtree(sidecar.repoDir, slug);
  if (!fs.existsSync(subtree)) {
    return {
      pulled: false,
      addedKeys: [],
      conflicts: [],
      onlyLocalCount: 0,
    };
  }

  const agentsDir = agentsDirOf(projectPath);
  const syncCfg = readSyncConfig(projectPath);
  const diff = diffTrees(subtree, agentsDir);
  const filteredOnlyA = filterKeysBySyncConfig(diff.onlyA, syncCfg);
  const filteredChanged = filterKeysBySyncConfig(diff.changed, syncCfg);
  const filteredOnlyB = filterKeysBySyncConfig(diff.onlyB, syncCfg);

  for (const key of filteredOnlyA) {
    copyFileEnsuring(path.join(subtree, ...key.split("/")), path.join(agentsDir, ...key.split("/")));
  }

  const stamp = conflictStamp(deps.now);
  const conflicts: PullConflict[] = [];
  for (const key of filteredChanged) {
    const src = path.join(subtree, ...key.split("/"));
    const dst = path.join(agentsDir, ...key.split("/"));
    const incomingPath = `${dst}.conflict-${stamp}`;
    fs.copyFileSync(src, incomingPath);
    conflicts.push({ key, incomingPath });
  }

  return {
    pulled: true,
    addedKeys: filteredOnlyA,
    conflicts,
    onlyLocalCount: filteredOnlyB.length,
  };
}

export interface StatusResult {
  initialized: boolean;
  slug?: string;
  remote?: string;
  unpushedCommits: number;
  behindRemote: number;
  uncommittedFiles: number;
  onlyLocal: string[];
  onlyRemote: string[];
  changed: string[];
  syncConfig: SyncConfig;
}

/**
 * Status: compara el .agents local contra el estado REAL del remoto
 * (fetch + ls-tree sobre el remote-tracking), no contra el último pull.
 * No toca el working tree del sidecar ni el proyecto; solo actualiza refs.
 */
export async function contextStatus(
  projectPath: string,
  deps: ContextOpDeps,
): Promise<StatusResult> {
  const slug = await resolveProjectIdentity(projectPath, deps.run);
  const home = resolveHome(deps);
  const config: ContextSyncConfig | null = readConfig(home);
  const syncCfg = readSyncConfig(projectPath);
  const result: StatusResult = {
    initialized: false,
    slug: config?.slug,
    unpushedCommits: 0,
    behindRemote: 0,
    uncommittedFiles: 0,
    onlyLocal: [],
    onlyRemote: [],
    changed: [],
    syncConfig: syncCfg,
  };
  if (!config) return result;

  const repoDir = sidecarRepoDir(home);
  const hasRepo = fs.existsSync(path.join(repoDir, ".git"));
  result.initialized = hasRepo;
  if (!hasRepo) return result;

  const agentsDir = agentsDirOf(projectPath);
  if (!fs.existsSync(agentsDir)) {
    throw new Error(
      `${agentsDir} no existe: no hay contexto local para comparar.`,
    );
  }

  // Best-effort: fetch para ver el estado actual del remoto; offline no rompe.
  await deps.run("git", ["fetch", "--quiet"], { cwd: repoDir });

  // Ref de comparación: upstream si existe, si no HEAD (clone recién hecho).
  let ref = "HEAD";
  if (await hasUpstream(deps.run, repoDir)) ref = "@{u}";

  const countRev = async (range: string): Promise<number> => {
    const res = await deps.run("git", ["rev-list", "--count", range], {
      cwd: repoDir,
    });
    if (res.status !== 0) return 0;
    const n = Number(res.stdout.trim());
    return Number.isFinite(n) ? n : 0;
  };

  let unpushed = 0;
  let behind = 0;
  if (ref === "@{u}" && (await hasCommits(deps.run, repoDir))) {
    unpushed = await countRev("@{u}..HEAD");
    behind = await countRev("HEAD..@{u}");
  }
  const porcelain = await deps.run("git", ["status", "--porcelain"], {
    cwd: repoDir,
  });

  // Árbol remoto del subtree del proyecto: ls-tree da mode/type/sha/path.
  const prefix = `projects/${slug.owner}/${slug.name}/`;
  const lsTree = await deps.run(
    "git",
    ["ls-tree", "-r", ref, "--", prefix],
    { cwd: repoDir },
  );
  const remoteFiles = new Map<string, string>();
  for (const line of lsTree.stdout.split("\n")) {
    const tabIdx = line.indexOf("\t");
    if (tabIdx < 0) continue;
    const meta = line.slice(0, tabIdx).split(/\s+/);
    const filePath = line.slice(tabIdx + 1);
    if (meta.length < 3 || !filePath.startsWith(prefix)) continue;
    remoteFiles.set(filePath.slice(prefix.length), meta[2]);
  }

  // Árbol local con el MISMO hash que usa git para blobs:
  // sha1("blob <len>\0" + contenido).
  const localFiles = new Map<string, string>();
  for (const key of listFilesRecursive(agentsDir)) {
    if (!isKeyEnabledForSync(key, syncCfg)) continue;
    try {
      const content = fs.readFileSync(path.join(agentsDir, ...key.split("/")));
      const sha = crypto
        .createHash("sha1")
        .update(`blob ${content.length}\0`)
        .update(content)
        .digest("hex");
      localFiles.set(key, sha);
    } catch {
      // Ilegible: se trata como distinto para que el usuario lo vea.
      localFiles.set(key, "unreadable");
    }
  }
  // Filtrar remoto también por categoría
  for (const k of [...remoteFiles.keys()]) {
    if (!isKeyEnabledForSync(k, syncCfg)) remoteFiles.delete(k);
  }

  const onlyLocal: string[] = [];
  const changed: string[] = [];
  for (const [key, sha] of localFiles) {
    const remoteSha = remoteFiles.get(key);
    if (remoteSha === undefined) onlyLocal.push(key);
    else if (remoteSha !== sha) changed.push(key);
  }
  const onlyRemote = [...remoteFiles.keys()]
    .filter((k) => !localFiles.has(k))
    .sort();

  return {
    initialized: true,
    slug: config.slug,
    remote: config.remote,
    unpushedCommits: unpushed,
    behindRemote: behind,
    uncommittedFiles: porcelain.stdout.trim()
      ? porcelain.stdout.trim().split("\n").length
      : 0,
    onlyLocal,
    onlyRemote,
    changed,
    syncConfig: syncCfg,
  };
}
