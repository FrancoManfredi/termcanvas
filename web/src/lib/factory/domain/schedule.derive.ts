// SRP: schedule helpers - pure, no I/O, no React
// Source: WarpFactories.md 6 US-040, US-092 T11
// OCP: add preset = add entry, no existing logic mutated

export const SCHEDULE_PRESETS: readonly { readonly cron: string; readonly name?: string; readonly trace: string }[] = [
  { cron: "0 9 * * 1", name: "weekly-dependency-audit", trace: "WarpFactories.md 6 US-092" },
  { cron: "@daily", trace: "WarpFactories.md 6 US-092" },
  { cron: "@every 1h", trace: "WarpFactories.md 6 US-092" },
] as const;

// Alias for plan interface - keep both names for compatibility
export const SCHEDULE_PRESETS_DATA: readonly { readonly cron: string; readonly label: string }[] = [
  { cron: "0 9 * * 1", label: "todos los lunes a las 09:00 UTC" },
  { cron: "@daily", label: "diario a las 00:00 UTC" },
  { cron: "@every 1h", label: "cada hora UTC" },
] as const;

/**
 * Describe a cron expression in Spanish, always noting UTC.
 * Handles known presets specially; fallback is generic.
 */
export function describeSchedule(cron: string): string {
  const trimmed = cron.trim();
  if (trimmed === "0 9 * * 1") return "todos los lunes a las 09:00 UTC";
  if (trimmed === "0 9 * * *") return "todos los dias a las 09:00 UTC";
  if (trimmed === "@daily") return "diario a las 00:00 UTC - todos los dias UTC";
  if (trimmed === "@hourly" || trimmed === "@every 1h") return "cada hora UTC";
  if (trimmed.startsWith("@every")) {
    const rest = trimmed.replace("@every", "").trim();
    if (rest) return `cada ${rest} UTC`;
    return "periodico UTC";
  }
  if (trimmed.startsWith("@")) {
    return `descriptor "${trimmed}" UTC`;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, , , dow] = parts;
    const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    if (dow === "1") return `todos los lunes a las ${time} UTC`;
    if (dow === "*") return `todos los dias a las ${time} UTC`;
    return `cron "${trimmed}" a las ${time} UTC`;
  }
  return `cron "${trimmed}" UTC`;
}

/**
 * Validate a cron expression without external deps.
 * Supports:
 * - 5-field cron: "0 9 * * 1" etc. (each token: *, star-slash-N, N, N-M, lists)
 * - Descriptors: "@daily", "@hourly", "@weekly", "@monthly", "@yearly", "@annually"
 * - Intervals: "@every 1h", "@every 30m"
 */
export function isValidCron(cron: string): boolean {
  const trimmed = cron.trim();
  if (!trimmed) return false;

  if (
    trimmed === "@daily" ||
    trimmed === "@hourly" ||
    trimmed === "@weekly" ||
    trimmed === "@monthly" ||
    trimmed === "@yearly" ||
    trimmed === "@annually"
  ) {
    return true;
  }

  // use RegExp constructor to avoid slash escaping issues in literal
  const everyWithSpace = new RegExp("^@every\\s+\\d+\\s*[smhd]$");
  const everyNoSpace = new RegExp("^@every\\s+\\d+[smhd]$");
  if (everyWithSpace.test(trimmed) || everyNoSpace.test(trimmed)) {
    return true;
  }

  const everyGeneric = new RegExp("^@every\\s+\\d+\\s*[a-z]+$", "i");
  if (everyGeneric.test(trimmed)) {
    const inner = trimmed.replace("@every", "").trim();
    const innerWithSpace = new RegExp("^\\d+\\s*[smhd]$", "i");
    const innerNoSpace = new RegExp("^\\d+[smhd]$", "i");
    if (innerWithSpace.test(inner) || innerNoSpace.test(inner)) return true;
    return false;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return false;

  const fieldRe = new RegExp("^[\\d*\\/\\,\\-]+$");
  for (const p of parts) {
    if (!fieldRe.test(p)) return false;
    if (p.length === 0) return false;
    if (p.includes("//") || p.includes(",,") || p.startsWith(",") || p.endsWith(",")) return false;
  }

  return true;
}
