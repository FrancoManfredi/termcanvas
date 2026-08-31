// StepConnectProvider — SRP: Paso 1 — conectar GitHub en pestaña aparte con tick
// Source: PRD §3.2 P0-3/P0-4, ADR-003 Q1+Q2+Q6

import { useGitHubAuth } from "../../../lib/factory/hooks/useGitHubAuth";
import type { GitHubAuthPort } from "../../../lib/factory/ports/github.ports";

export interface StepConnectProviderProps {
  readonly provider: "github" | "gitlab";
  readonly onSelectProvider: (p: "github" | "gitlab") => void;
  readonly githubAuth?: GitHubAuthPort;
}

export function StepConnectProvider({ provider, onSelectProvider, githubAuth }: StepConnectProviderProps) {
  const { status, loading, connect, refresh } = useGitHubAuth(githubAuth);

  const isConnected = status.connected && status.status === "connected";
  const isConnecting = loading || status.status === "connecting";

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onSelectProvider("github")}
          className={`rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20 ${provider === "github" ? "border-blue-600 bg-blue-50" : "border-zinc-200"}`}
          aria-pressed={provider === "github"}
        >
          <span className="block font-medium text-zinc-900">GitHub</span>
          <span className="mt-1 block text-xs text-zinc-500">Repositorio conectado para esta factory</span>
        </button>
        <button
          type="button"
          disabled
          className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left opacity-50"
          aria-pressed={false}
          title="GitLab no disponible en P0"
        >
          <span className="block font-medium text-zinc-900">GitLab</span>
          <span className="mt-1 block text-xs text-zinc-500">No disponible en local</span>
        </button>
      </div>

      {provider === "github" && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          {!isConnected ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (isConnecting) return;
                  void connect();
                }}
                disabled={isConnecting}
                aria-busy={isConnecting}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {isConnecting ? "Conectando..." : "Conectar con GitHub"}
              </button>
              <p className="mt-2 text-xs text-zinc-500">Se abrirá una pestaña aparte para autorizar. Al completar, verás el tick verde.</p>
              {status.status === "error" && status.error && (
                <p className="mt-2 text-xs text-red-600" role="alert">
                  {status.error} — <button type="button" onClick={() => void refresh()} className="underline">Reintentar</button>
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white" aria-label="Conectado">✓</span>
              <div>
                <p className="text-sm font-medium text-emerald-700">GitHub conectado{status.username ? ` @${status.username}` : ""}</p>
                {status.avatarUrl && <img src={status.avatarUrl} alt="" className="mt-1 h-8 w-8 rounded-full" />}
              </div>
              <button type="button" onClick={() => void refresh()} className="ml-auto text-xs text-zinc-500 underline">Reconectar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
