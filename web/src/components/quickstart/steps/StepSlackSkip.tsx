// StepSlackSkip — SRP: Paso 4 — skip Slack explícito en local

export function StepSlackSkip() {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6 text-center">
      <p className="text-sm font-medium text-zinc-900">Slack queda en local, lo salteamos por ahora</p>
      <p className="mt-2 text-xs text-zinc-500">En esta épica no conectamos Slack. Podrás hacerlo más adelante desde Integraciones.</p>
      <p className="mt-3 text-xs text-zinc-400">Hacé clic en Continuar para seguir.</p>
    </div>
  );
}
