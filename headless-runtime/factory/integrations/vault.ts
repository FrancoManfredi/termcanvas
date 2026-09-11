/**
 * integrations/vault — F1 live seam: env-only credential refs + redaction.
 *
 * Secrets live in environment variables ONLY. `factory.yaml` carries env
 * NAMES (`vaultRef`, `webhookSecretRef`), never values; this module is the
 * single place that resolves a name to a value, and it never writes a value
 * to disk or to logs — callers pass every log line through `redact()` first.
 * Every export is total (never throws). Zero I/O beyond `process.env`,
 * zero network, ESM only.
 */

import type { LiveSection } from "./integrationTypes";

/** Vault port: resolve env-name refs, gate live traffic, scrub log lines. */
export interface Vault {
  /** Value of `process.env[ref]`, or null for empty/bad-name/missing refs. */
  readRef(ref: string): string | null;
  /** True only when live is opted in AND its ref resolves to a value. */
  hasLiveCredentials(live: LiveSection): boolean;
  /** Replaces every resolved value occurrence in `text` with `"***"`. */
  redact(text: string, refs: string[]): string;
}

/** Max env-name length accepted (matches LiveSectionSchema vaultRef cap). */
export const VAULT_REF_NAME_MAX = 128;

const VAULT_REF_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REDACTED = "***";

/**
 * Reads one env ref by NAME. Returns the value, or null when the ref is
 * empty, not a valid env identifier, or unset/empty in the environment.
 * Never throws, never logs.
 */
export function readRef(ref: string): string | null {
  try {
    if (typeof ref !== "string") return null;
    const name = ref.trim();
    if (name.length === 0 || name.length > VAULT_REF_NAME_MAX) return null;
    if (!VAULT_REF_NAME_RE.test(name)) return null;
    const value = process.env[name];
    if (typeof value !== "string" || value.length === 0) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Live-traffic gate: true only when `live.liveMode` is true, `vaultRef` is
 * a non-empty name, and that name resolves to a non-empty env value.
 * Anything else (including malformed input) is false. Never throws.
 */
export function hasLiveCredentials(live: LiveSection): boolean {
  try {
    if (!live || typeof live !== "object" || Array.isArray(live)) return false;
    const rec = live as unknown as Record<string, unknown>;
    if (rec.liveMode !== true) return false;
    if (typeof rec.vaultRef !== "string" || rec.vaultRef.trim().length === 0) {
      return false;
    }
    return readRef(rec.vaultRef) !== null;
  } catch {
    return false;
  }
}

/**
 * Scrubs every resolved credential value out of `text`, replacing each
 * occurrence with `"***"`. Unknown/empty refs are skipped; non-string input
 * degrades to `""`. Longest values are replaced first so overlapping
 * secrets cannot leak a suffix. Never throws, never logs.
 */
export function redact(text: string, refs: string[]): string {
  try {
    if (typeof text !== "string") return "";
    if (text.length === 0) return text;
    const names: unknown[] = Array.isArray(refs) ? refs : [];
    const values: string[] = [];
    names.forEach((n) => {
      try {
        if (typeof n !== "string") return;
        const v = readRef(n);
        if (typeof v === "string" && v.length > 0 && !values.includes(v)) {
          values.push(v);
        }
      } catch {
        // a bad ref never aborts the scrub
      }
    });
    values.sort((a, b) => b.length - a.length);
    let out = text;
    values.forEach((v) => {
      try {
        out = out.split(v).join(REDACTED);
      } catch {
        // best-effort per value
      }
    });
    return out;
  } catch {
    try {
      return typeof text === "string" ? text : "";
    } catch {
      return "";
    }
  }
}

/** Default vault port implementation (env-backed, redacting, total). */
export const vault: Vault = {
  readRef: (ref) => readRef(ref),
  hasLiveCredentials: (live) => hasLiveCredentials(live),
  redact: (text, refs) => redact(text, refs),
};
