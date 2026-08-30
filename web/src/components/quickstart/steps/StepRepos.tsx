// StepRepos — SRP: Paso 2 — listado real de repos con skeleton/error/empty
// Source: PRD P0-5, ADR-003 Q3

import { useEffect, useState } from "react";
import type { RepositoryRef } from "../../../lib/factory/domain/types";
import type { GitHubRepo, GitHubReposPort } from "../../../lib/factory/ports/github.ports";
import { repositoryLabel } from "../../../lib/factory/domain/quickstart.data";

export interface StepReposProps {
  readonly selected: readonly RepositoryRef[];
  readonly onToggle: (repo: RepositoryRef) => void;
  readonly reposPort?: GitHubReposPort;
}

export function StepRepos({ selected, onToggle, reposPort }: StepReposProps) {
  const [repos, setRepos] = useState<readonly GitHubRepo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!reposPort) {
        setLoading(false);
        setError("Sin conexión GitHub");
        return;
      }
      setLoading(true);
      setError(null);
      const result = await reposPort.listRepos({ page: 1, perPage: 30 });
      if (cancelled) return;
      if (!result.ok) {
        const code = result.issues[0]?.code ?? "";
        if (code === "bad_credentials") setError("Sesión expirada — reconectá GitHub");
        else if (code === "rate_limited") setError("Rate limit — intentá más tarde");
        else setError(result.issues.map((i) => i.message).join(". "));
        setRepos([]);
      } else {
        setRepos(result.value ?? []);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reposPort]);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-lg border border-zinc-200 bg-zinc-50" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-2 text-xs underline">Reintentar</button>
      </div>
    );
  }

  if (!repos || repos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center">
        <p className="text-sm text-zinc-600">No tenés repos o no dimos permisos — revisar instalación</p>
        <a href="https://github.com/new" target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-blue-600 underline">Crear repo en GitHub</a>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {repos.map((repo) => {
          const ref: RepositoryRef = { owner: repo.owner, name: repo.name };
          const isSelected = selected.some((s) => s.owner === ref.owner && s.name === ref.name);
          const atLimit = selected.length >= 2;
          const disabledChip = !isSelected && atLimit;
          return (
            <button
              type="button"
              key={repo.fullName}
              onClick={() => onToggle(ref)}
              className={`rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20 ${isSelected ? "border-blue-600 bg-blue-50" : disabledChip ? "border-zinc-200 bg-zinc-50 opacity-70" : "border-zinc-200 hover:bg-zinc-50"}`}
              aria-pressed={isSelected}
              title={disabledChip ? "2 máx — el 3º reemplaza al más viejo" : undefined}
            >
              <span className="font-mono text-sm text-zinc-900">{repositoryLabel(ref)}</span>
              <span className="mt-1 block text-xs text-zinc-500">
                {repo.private ? "private" : "public"} · {new Date(repo.updatedAt).toLocaleDateString()}
              </span>
              <span className="mt-1 block text-xs text-zinc-500">{isSelected ? "Seleccionado" : "Disponible"}</span>
            </button>
          );
        })}
      </div>
      {selected.length >= 2 && (
        <p className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">2 máx — el 3º reemplaza al más viejo</p>
      )}
    </div>
  );
}
