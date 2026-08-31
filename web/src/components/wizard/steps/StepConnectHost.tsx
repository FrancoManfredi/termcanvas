import { GithubIcon } from "../../atoms/icons/GithubIcon";
import { useGitHubAuth } from "../../../lib/factory/hooks/useGitHubAuth";
import { hasEnvPat } from "../../../lib/factory/config/githubToken";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";

export function StepConnectHost({ onNext }: { onNext: () => void }) {
  const { status, loading, refresh } = useGitHubAuth();

  const isConnecting = loading || status.status === "connecting";
  const isConnected = status.connected && !!status.username;
  const isError = status.status === "error";

  const viaBadge = hasEnvPat() ? "via .env" : "via localStorage";

  return (
    <div className="anim-fade-in-up">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Connect your code host</h1>
      <p className="text-sm text-gray-500 mb-7 leading-relaxed">
        Warp will connect to your code host so that you can select which repos you want to use in your factory.
      </p>

      {/* Error banner */}
      {isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start justify-between gap-3">
          <p className="text-sm text-red-700 leading-snug">{status.error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="shrink-0 text-sm font-semibold text-red-700 hover:text-red-800 underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Connecting state */}
      {isConnecting ? (
        <div
          className="w-full flex items-center gap-4 px-5 py-4 border border-gray-200 rounded-xl bg-gray-50 text-left opacity-80"
          style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)" }}
        >
          <GithubIcon size={32} className="text-gray-400" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-700">I want to use repos from GitHub</p>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" aria-hidden />
              Verificando token...
            </p>
          </div>
        </div>
      ) : isConnected ? (
        <button
          type="button"
          onClick={onNext}
          className={`w-full flex items-center gap-4 px-5 py-4 border border-green-200 rounded-xl bg-green-50 hover:bg-green-100 text-left ${BTN_PRESS}`}
          style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)" }}
        >
          <GithubIcon size={32} className="text-gray-900" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">I want to use repos from GitHub</p>
            <p className="text-xs text-green-700 mt-0.5 font-medium flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-600 text-white text-[10px]">✓</span>
              Connected as @{status.username}
              <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-600 text-white">
                {viaBadge}
              </span>
            </p>
          </div>
          {status.avatarUrl ? (
            <img
              src={status.avatarUrl}
              alt={`Avatar de ${status.username}`}
              width={32}
              height={32}
              className="w-8 h-8 rounded-full object-cover border border-green-200 shrink-0"
            />
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          onClick={onNext}
          disabled={isConnecting}
          className={`w-full flex items-center gap-4 px-5 py-4 border rounded-xl text-left ${BTN_PRESS} ${
            isError ? "border-red-200 hover:border-red-300 hover:bg-red-50/60" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)" }}
        >
          <GithubIcon size={32} className="text-gray-900" />
          <div>
            <p className="text-sm font-semibold text-gray-900">I want to use repos from GitHub</p>
            <p className="text-xs text-gray-400 mt-0.5">Connect to GitHub to continue</p>
          </div>
        </button>
      )}

      {/* Continue action — siempre visible salvo connecting; el card ya hace onNext pero reforzamos con botón explícito */}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={isConnecting}
          className={`px-5 py-2 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-800 ${BTN_PRESS} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
