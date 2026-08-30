// SecretsRedacted helpers — SRP: redact secrets/warpIds — nunca renderizar valor completo en DOM
// Muestra solo •••• + últimos 4, copy requiere rol (mock)

export function redactSecret(value: string): string {
  if (!value) return "••••";
  if (value === "<REPLACE_ME>") return "••••";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return "••••" + trimmed.slice(-4);
}

export function redactWarpId(warpId: string): string {
  return redactSecret(warpId);
}
