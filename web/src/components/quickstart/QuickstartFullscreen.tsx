// QuickstartFullscreen — SRP: viewport completo 100vw/vh sin shell cuando 0 factories
// Source: PRD-PULIDO-ONBOARDING §3.1 + §6.1; ADR-003 Q4 (gate condicional)

import { QuickstartWizard } from "./QuickstartWizard";

export interface QuickstartFullscreenProps {
  readonly onComplete?: (uid: string) => void;
}

export function QuickstartFullscreen({ onComplete }: QuickstartFullscreenProps) {
  return (
    <div
      className="flex h-screen w-screen flex-col overflow-auto bg-zinc-50"
      style={{ width: "100vw", height: "100vh" }}
      data-testid="quickstart-fullscreen"
      aria-label="Onboarding a pantalla completa"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-900">TermCanvas</span>
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">Quick Start</span>
        </div>
        <span className="text-xs text-zinc-500">Local only — no se envía nada fuera de tu máquina</span>
      </header>
      <div className="flex flex-1 items-start justify-center p-6">
        <div className="w-full max-w-[640px]">
          <QuickstartWizard onComplete={onComplete} />
        </div>
      </div>
      <footer className="shrink-0 border-t border-zinc-200 bg-white px-6 py-3 text-center text-xs text-zinc-400">
        Local only — no se envía nada fuera de tu máquina
      </footer>
    </div>
  );
}
