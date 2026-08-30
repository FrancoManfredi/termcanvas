// SRP: render a redacted secret — nunca renderizar valor completo en DOM
// Muestra solo •••• + últimos 4, copy requiere rol (mock)

import { redactSecret } from "./secrets.redact";

interface SecretsRedactedProps {
  value: string;
  canCopy?: boolean; // mock rol check — false por defecto
  label?: string;
  className?: string;
}

export function SecretsRedacted({ value, canCopy = false, label, className }: SecretsRedactedProps) {
  const redacted = redactSecret(value);

  const handleCopy = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // noop — clipboard may not be available in test
    }
  };

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[12px] tabular-nums ${className ?? ""}`}>
      {label && <span className="text-zinc-500">{label}</span>}
      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white" aria-label="redacted secret">
        {redacted}
      </span>
      {canCopy ? (
        <button
          type="button"
          onClick={handleCopy}
          className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-50"
          aria-label="copy secret"
        >
          Copy
        </button>
      ) : (
        <span className="text-[10px] text-zinc-400" title="requiere rol para copiar">
          •••
        </span>
      )}
    </span>
  );
}

export default SecretsRedacted;
