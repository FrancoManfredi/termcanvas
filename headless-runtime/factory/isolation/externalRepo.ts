/**
 * Ancla de repos externos para jobs con issue de otro repo.
 *
 * `runIsolationPostCreate` ancla en `wi.worktree` (el checkout del panel).
 * Cuando el `issueRef.repo` ("owner/repo") no coincide con el origin del
 * ancla, el job editaría el repo equivocado. Este módulo resuelve un ancla
 * real: clona el repo del issue (una vez) en un scratch dir y lo reutiliza
 * en jobs siguientes.
 *
 * ESM only, `node:child_process execFile` (sin shell), timeout explícito
 * en cada spawn, `maxBuffer 10 MB`, un intento por llamada. Nunca lanza:
 * uniones honestas, errores recortados a 200 chars. Si el ancla externa
 * no se puede resolver, el llamador decide (típico: seguir en el ancla
 * del panel con evento ruidoso en el timeline).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ghEnv } from "./gitHubPr";
import type { GitExecRun } from "./gitWorktree";
import { GIT_PROBE_TIMEOUT_MS, GIT_EXEC_MAX_BUFFER_BYTES } from "./gitWorktree";

/** Bound: `git clone` inicial, un intento. */
export const EXTERNAL_CLONE_TIMEOUT_MS = 120000;

/** Bound: `git fetch` de refresco en reuso, un intento, best-effort. */
export const EXTERNAL_FETCH_TIMEOUT_MS = 60000;

/** Slice width given honest error strings. */
const ERROR_SLICE = 200;

const execFileAsync = promisify(execFile);

function defaultRun(
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, [...args], {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    maxBuffer: GIT_EXEC_MAX_BUFFER_BYTES,
    env: ghEnv(),
    windowsHide: true,
  }).then((out) => ({
    stdout: typeof out.stdout === "string" ? out.stdout : String(out.stdout),
    stderr: typeof out.stderr === "string" ? out.stderr : String(out.stderr),
  }));
}

function sliceError(value: unknown): string {
  try {
    const msg = value instanceof Error ? value.message : String(value);
    return msg.slice(0, ERROR_SLICE);
  } catch {
    return "git call failed";
  }
}

function sanitizeSegment(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) return null;
  if (trimmed === "." || trimmed === "..") return null;
  return trimmed;
}

/** "owner/repo" (ya validado arriba) o null si el ref viene malformado. */
function parseRepoRef(repo: string): { owner: string; name: string } | null {
  try {
    const parts = repo.split("/");
    if (parts.length !== 2) return null;
    const owner = sanitizeSegment(parts[0] as string);
    const name = sanitizeSegment((parts[1] as string).replace(/\.git$/, ""));
    if (owner === null || name === null) return null;
    return { owner, name };
  } catch {
    return null;
  }
}

/**
 * origin de un checkout -> "owner/repo" en minúsculas. Solo github.com
 * (https, ssh, git@). Null si no hay origin o no se puede parsear.
 */
function parseGitHubOrigin(url: string): string | null {
  try {
    const cleaned = url.trim().replace(/\.git$/, "");
    const match = cleaned.match(
      /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/(.+)$/i,
    );
    if (!match) return null;
    const owner = sanitizeSegment(match[1] as string);
    const name = sanitizeSegment(match[2] as string);
    if (owner === null || name === null) return null;
    return `${owner.toLowerCase()}/${name.toLowerCase()}`;
  } catch {
    return null;
  }
}

function isValidRepoDir(dir: string, run: GitExecRun): Promise<boolean> {
  return run("git", ["rev-parse", "--show-toplevel"], {
    cwd: dir,
    timeoutMs: GIT_PROBE_TIMEOUT_MS,
  }).then(
    () => true,
    () => false,
  );
}

export interface ResolveExternalAnchorInput {
  /** Ancla actual (checkout del panel). Siempre existe como path. */
  readonly anchor: string;
  /** "owner/repo" del issueRef (puede venir con distinta capitalización). */
  readonly repo: string;
  readonly run?: GitExecRun;
  /** Raíz del scratch (default: os.tmpdir()/termcanvas-external-repos). */
  readonly scratchRoot?: string;
}

export type ResolveExternalAnchorResult =
  | {
      ok: true;
      /** Ancla efectiva: el clon/reuso, o el ancla original si coincide. */
      anchor: string;
      /** True cuando el ancla efectiva es un clon externo. */
      external: boolean;
      reason: "same-repo" | "no-origin" | "non-github-origin" | "reused" | "cloned";
    }
  | { ok: false; error: string };

export async function resolveExternalAnchor(
  input: ResolveExternalAnchorInput,
): Promise<ResolveExternalAnchorResult> {
  try {
    const anchor =
      typeof input?.anchor === "string" ? input.anchor : "";
    if (anchor.trim().length === 0) {
      return { ok: false, error: "anchor is required" };
    }
    const want = parseRepoRef(
      typeof input?.repo === "string" ? input.repo : "",
    );
    if (want === null) {
      return { ok: false, error: "invalid repo ref" };
    }
    const run = input?.run ?? defaultRun;
    let originUrl = "";
    try {
      const out = await run("git", ["remote", "get-url", "origin"], {
        cwd: anchor,
        timeoutMs: GIT_PROBE_TIMEOUT_MS,
      });
      originUrl = out.stdout.trim();
    } catch {
      originUrl = "";
    }
    if (originUrl.length === 0) {
      return { ok: true, anchor, external: false, reason: "no-origin" };
    }
    const have = parseGitHubOrigin(originUrl);
    if (have === null) {
      return { ok: true, anchor, external: false, reason: "non-github-origin" };
    }
    const wantLower = `${want.owner.toLowerCase()}/${want.name.toLowerCase()}`;
    if (have === wantLower) {
      return { ok: true, anchor, external: false, reason: "same-repo" };
    }
    const root =
      typeof input?.scratchRoot === "string" && input.scratchRoot.length > 0
        ? input.scratchRoot
        : path.join(os.tmpdir(), "termcanvas-external-repos");
    const dir = path.join(root, `${want.owner}__${want.name}`);
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch {
      return { ok: false, error: "cannot create scratch root" };
    }
    if (await isValidRepoDir(dir, run)) {
      let reuseOrigin = "";
      try {
        const out = await run("git", ["remote", "get-url", "origin"], {
          cwd: dir,
          timeoutMs: GIT_PROBE_TIMEOUT_MS,
        });
        reuseOrigin = out.stdout.trim();
      } catch {
        reuseOrigin = "";
      }
      if (parseGitHubOrigin(reuseOrigin) === wantLower) {
        try {
          await run("git", ["fetch", "origin"], {
            cwd: dir,
            timeoutMs: EXTERNAL_FETCH_TIMEOUT_MS,
          });
        } catch {
          // Best-effort: un clon desactualizado sigue siendo mejor ancla
          // que el repo equivocado.
        }
        return { ok: true, anchor: dir, external: true, reason: "reused" };
      }
    }
    try {
      await run(
        "git",
        ["clone", `https://github.com/${want.owner}/${want.name}.git`, dir],
        { cwd: root, timeoutMs: EXTERNAL_CLONE_TIMEOUT_MS },
      );
    } catch (e) {
      return {
        ok: false,
        error: sliceError(
          `clone failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      };
    }
    if (!(await isValidRepoDir(dir, run))) {
      return { ok: false, error: "clone produced no valid repo" };
    }
    return { ok: true, anchor: dir, external: true, reason: "cloned" };
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}
