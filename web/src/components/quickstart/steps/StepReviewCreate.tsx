// StepReviewCreate — SRP: Paso 7 — resumen 3 filas + CTA crear

import { repositoryLabel } from "../../../lib/factory/domain/quickstart.data";
import type { QuickstartState } from "../../../lib/factory/domain/quickstart.wizard";

export interface StepReviewCreateProps {
  readonly state: QuickstartState;
  readonly githubConnected?: boolean;
  readonly githubUsername?: string;
  readonly onCreate: () => void;
  readonly creating?: boolean;
  readonly error?: string;
}

export function StepReviewCreate({ state, githubConnected, githubUsername, onCreate, creating, error }: StepReviewCreateProps) {
  return (
    <div className="grid gap-5">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
        <p className="font-medium text-zinc-900">Resumen</p>
        <dl className="mt-3 grid gap-2">
          <div className="flex justify-between">
            <dt className="text-zinc-500">GitHub</dt>
            <dd className="font-medium">{githubConnected ? `✓ ${githubUsername ?? "conectado"}` : "No conectado"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Repos</dt>
            <dd className="font-medium">{state.repos.length ? state.repos.map(repositoryLabel).join(", ") : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Factory</dt>
            <dd className="font-medium">{state.name || "Sin nombre"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Alias</dt>
            <dd className="font-medium">{state.alias || "—"}</dd>
          </div>
        </dl>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button
        type="button"
        onClick={onCreate}
        disabled={Boolean(creating)}
        className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {creating ? "Creando..." : "Crear factory y ir al Dashboard"}
      </button>
    </div>
  );
}
