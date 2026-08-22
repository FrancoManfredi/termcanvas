// Identidad canónica de un proyecto para sincronizar contexto entre máquinas:
// el slug owner/name del remote origin. Los paths locales difieren entre
// computadoras; owner/name es lo único que ambas pueden acordar.

import type { CommandRunner } from "./types.ts";

export interface RepoSlug {
  owner: string;
  name: string;
}

export function slugToString(slug: RepoSlug): string {
  return `${slug.owner}/${slug.name}`;
}

const SLUG_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Interpreta una URL de remote git y extrae {owner, name}.
 * Acepta: https://host/owner/name(.git), http, ssh://git@host/owner/name(.git)
 * y formato scp git@host:owner/name(.git). Devuelve null si no se puede
 * interpretar o si no hay dos segmentos válidos.
 */
export function parseOriginToSlug(rawUrl: string): RepoSlug | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let pathPart: string | null = null;

  // Formato scp-like (git@github.com:owner/name.git). Se exige que después
  // del ':' haya un path con al menos un '/' y que no empiece por slash o
  // backslash — esto último descarta paths de Windows con drive (C:\...).
  const scpLike = /^(?:[^@/]+@)?([^/:\\]+):(?![\\/])([^/].*\/.*)$/.exec(trimmed);
  if (scpLike) {
    pathPart = scpLike[2];
  } else {
    try {
      const parsed = new URL(trimmed);
      const okProtocols = new Set(["https:", "http:", "ssh:", "git:"]);
      if (!parsed.hostname || !okProtocols.has(parsed.protocol)) {
        return null;
      }
      pathPart = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    } catch {
      return null;
    }
  }

  if (!pathPart) return null;
  const cleaned = pathPart.replace(/\.git\/?$/i, "").replace(/\/+$/, "");
  const segments = cleaned.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const name = segments[segments.length - 1];
  const owner = segments[segments.length - 2];
  if (!SLUG_SEGMENT.test(owner) || !SLUG_SEGMENT.test(name)) return null;
  return { owner, name };
}

/**
 * Resuelve la identidad del proyecto leyendo `git remote get-url origin`.
 * Falla con mensaje accionable si no hay origin: sin identidad canónica
 * dos máquinas no pueden acordar a qué subtree del sidecar pertenece el
 * contexto.
 */
export async function resolveProjectIdentity(
  projectPath: string,
  run: CommandRunner,
): Promise<RepoSlug> {
  const result = await run("git", ["remote", "get-url", "origin"], {
    cwd: projectPath,
  });
  if (result.status !== 0) {
    throw new Error(
      `El proyecto ${projectPath} no tiene remote 'origin'. La sincronización de contexto usa owner/name como identidad entre máquinas.\n` +
        result.stderr.trim(),
    );
  }
  const slug = parseOriginToSlug(result.stdout);
  if (!slug) {
    throw new Error(
      `No se pudo interpretar el remote origin como owner/name: ${result.stdout.trim()}`,
    );
  }
  return slug;
}
