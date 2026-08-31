// useGitHubRepos — DIP: usa el port REAL GitHubReposPort (LocalGitHubReposAdapter) como fuente
// primaria y cae a los fixtures de demo (MOCK_REPOS) si el port no resuelve nada.
// Fase 1: integra VITE_GITHUB_TOKEN via getEffectivePat(), lista repos reales con fallback demo,
// expone search/filter client-side, loading/error/isDemo, y mantiene compatibilidad con useRepoList.

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalGitHubReposAdapter } from "../adapters/githubRepos.adapter";
import type { GitHubReposPort } from "../ports/github.ports";
import { getEffectivePat } from "../config/githubToken";
import { MOCK_REPOS } from "../fixtures/figma.fixtures";
import type { Repo } from "../fixtures/figma.fixtures";

const reposPort: GitHubReposPort = new LocalGitHubReposAdapter();

function toFigmaRepo(r: { fullName: string; name: string; owner: string; private: boolean; updatedAt: string }): Repo {
  return {
    id: r.fullName,
    name: r.name,
    owner: r.owner,
    private: r.private,
    language: "",
    updatedAt: r.updatedAt,
  };
}

export interface UseGitHubReposApi {
  readonly repos: readonly Repo[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly code: string | null;
  readonly isDemo: boolean;
  refresh(): Promise<void>;
  readonly search: string;
  setSearch(q: string): void;
  readonly filtered: readonly Repo[];
}

export function useGitHubRepos(opts?: { perPage?: number }): UseGitHubReposApi {
  const perPage = opts?.perPage ?? 100;
  const [repos, setRepos] = useState<readonly Repo[]>(MOCK_REPOS as readonly Repo[]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState<boolean>(() => {
    try {
      return !getEffectivePat();
    } catch {
      return true;
    }
  });
  const [search, setSearch] = useState("");

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    // isDemo se calcula por presencia de token efectivo (env > storage)
    let demo: boolean;
    try {
      demo = !getEffectivePat();
    } catch {
      demo = true;
    }
    setIsDemo(demo);
    try {
      const res = await reposPort.listRepos({ perPage, search: undefined });
      if (res.ok) {
        const mapped = (res.value ?? []).map(toFigmaRepo);
        // si el adapter devolvió DEMO_REPOS (sin token), ya viene mapeado; si devolvió 0, mantener fallback
        if (mapped.length > 0) {
          setRepos(mapped);
        } else if (demo) {
          // sin token y sin resultados (raro) -> mantener MOCK_REPOS
          setRepos(MOCK_REPOS as readonly Repo[]);
        } else {
          setRepos([]);
        }
        setError(null);
        setCode(null);
      } else {
        const issue = res.issues[0];
        setError(issue?.message ?? "Error al listar repos");
        setCode(issue?.code ?? null);
        // En caso de error de autenticación, no ocultar repos previos; si no hay previos, fallback a demo si es bad_credentials? No, mostrar error pero mantener lista vacía o demo?
        // Para demo sin token, el adapter nunca falla (retorna ok con DEMO_REPOS), así que este branch es solo para errores reales.
        // Mantenemos repos actuales; isDemo ya refleja ausencia de token.
        if (demo) {
          setRepos(MOCK_REPOS as readonly Repo[]);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setCode("network_error");
    } finally {
      setLoading(false);
    }
  }, [perPage]);

  useEffect(() => {
    let cancelled = false;
    // wrapper para evitar setState tras unmount
    void (async () => {
      if (cancelled) return;
      await fetchRepos();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRepos]);

  // Re-evaluar isDemo si cambia storage (p.ej. tras connectWithPat) — polling simple via refresh manual
  // El consumidor puede llamar refresh() tras cambiar token.

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => {
      const full = `${r.owner}/${r.name}`.toLowerCase();
      const idLower = r.id.toLowerCase();
      const nameLower = r.name.toLowerCase();
      return full.includes(q) || idLower.includes(q) || nameLower.includes(q);
    });
  }, [repos, search]);

  const refresh = useCallback(async () => {
    await fetchRepos();
  }, [fetchRepos]);

  return { repos, loading, error, code, isDemo, refresh, search, setSearch, filtered };
}

/**
 * Legacy wrapper — mantiene compatibilidad con componentes que solo necesitan la lista.
 * Retorna repos sin filtrar (el filtrado se hace via useGitHubRepos().filtered).
 */
export function useRepoList(): readonly Repo[] {
  const { repos } = useGitHubRepos();
  return repos;
}
