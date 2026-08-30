// StepTrackerMspSkip — SRP: Paso 6 — Tracker + MSP skip explícito

export function StepTrackerMspSkip() {
  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm font-medium text-zinc-900">Tracker — No disponible en local</p>
        <p className="mt-1 text-xs text-zinc-500">Jira/Linear quedan afuera por ahora. Podrás conectarlos después.</p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm font-medium text-zinc-900">Factory MSP — No disponible en local</p>
        <p className="mt-1 text-xs text-zinc-500">No se crea MSP en esta épica.</p>
      </div>
      <p className="text-xs text-zinc-400">Hacé clic en Omitir y crear para ir al resumen.</p>
    </div>
  );
}
