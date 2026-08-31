import { useMemo } from "react";
import { GithubIcon } from "../../atoms/icons/GithubIcon";
import { BackBtn } from "../../atoms/buttons/BackBtn";
import type { Repo } from "../../../lib/factory/fixtures/figma.fixtures";
import { useGitHubRepos } from "../../../lib/factory/hooks/useGitHubRepos";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export interface StepSelectRepoProps {
  /** Optional override for tests — si se pasa, se usa en lugar del hook. */
  repos?: readonly Repo[];
  selectedId: string | null;
  onSelect: (repo: Repo) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepSelectRepo({ repos: reposOverride, selectedId, onSelect, onNext, onBack }: StepSelectRepoProps) {
  const hook = useGitHubRepos({ perPage: 100 });
  const { loading, error, code, isDemo, refresh, search, setSearch } = hook;

  // Si se pasó reposOverride (tests), usarlo; si no, usar hook.filtered
  const displayRepos: readonly Repo[] = useMemo(() => {
    if (reposOverride) {
      const q = search.trim().toLowerCase();
      if (!q) return reposOverride;
      return reposOverride.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
    }
    return hook.filtered;
  }, [reposOverride, hook.filtered, search]);

  const totalRepos = reposOverride ? reposOverride.length : hook.repos.length;
  const headerText = isDemo && !reposOverride ? `Demo repositories — ${displayRepos.length} of ${totalRepos}` : `Showing ${displayRepos.length} repositories`;

  return (
    <div className="anim-fade-in-up">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Select a repository</h1>
      <p className="text-sm text-gray-500 mb-5 leading-relaxed">Pick the GitHub repository you want to use for this factory.</p>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search repositories..."
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-400"
          aria-label="Search repositories"
        />
      </div>

      {/* Demo banner */}
      {isDemo && !reposOverride && !loading && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">Modo demo — mostrando repos de ejemplo. Añadí VITE_GITHUB_TOKEN en web/.env para ver tus repos reales.</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-red-700 font-medium">Error al cargar repos{code ? ` (${code})` : ""}</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
          </div>
          <button type="button" onClick={() => void refresh()} className="shrink-0 text-sm font-semibold text-red-700 hover:text-red-800 underline">
            Retry
          </button>
        </div>
      )}

      {/* Header counter */}
      <p className="text-xs text-gray-400 mb-2">{headerText}</p>

      {/* Loading */}
      {loading ? (
        <div className="border border-gray-200 rounded-xl p-10 flex flex-col items-center justify-center gap-3 mb-6" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
          <span className="inline-block w-5 h-5 border-2 border-gray-200 border-t-gray-700 rounded-full animate-spin" aria-hidden />
          <p className="text-sm text-gray-500">Loading repositories...</p>
        </div>
      ) : displayRepos.length === 0 ? (
        <div className="border border-gray-200 rounded-xl p-10 flex flex-col items-center justify-center gap-2 mb-6" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
          <p className="text-sm text-gray-600">
            {search.trim() ? (
              <>
                No results for &quot;<span className="font-semibold">{search.trim()}</span>&quot;
              </>
            ) : (
              "No repositories found."
            )}
          </p>
          {search.trim() && (
            <button type="button" onClick={() => setSearch("")} className="text-xs text-violet-600 hover:text-violet-700 underline">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden mb-6 divide-y divide-gray-100" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
          {displayRepos.map((repo) => {
            const isSel = selectedId === repo.id;
            return (
              <button
                key={repo.id}
                type="button"
                onClick={() => onSelect(repo)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-[background-color] duration-100 active:scale-[0.99] ${isSel ? "bg-gray-900" : "hover:bg-gray-50"}`}
              >
                <GithubIcon size={15} className={isSel ? "text-white" : "text-gray-700"} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isSel ? "text-white" : "text-gray-800"}`}>
                    {repo.owner}/{repo.name}
                  </p>
                  <p className={`text-xs mt-0.5 ${isSel ? "text-gray-300" : "text-gray-400"}`}>
                    {repo.language ? `${repo.language} · ` : ""}
                    {repo.updatedAt}
                  </p>
                </div>
                {isSel && <span className="text-xs text-violet-400">Selected</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex justify-between">
        <BackBtn onClick={onBack} />
        <button
          type="button"
          onClick={onNext}
          disabled={!selectedId}
          className={`${BTN_PRIMARY} disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100`}
        >
          Next
        </button>
      </div>
    </div>
  );
}
