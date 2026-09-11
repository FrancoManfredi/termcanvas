/**
 * definitionUi — Ola 20 E2 (Paridad Warp: validación de definition, lado UI).
 *
 * Lógica pura del badge de definition (sin React, sin DOM) para
 * `DefinitionBadge.tsx` + contrato testeable offline por
 * `tests/definition-badge.test.ts`.
 *
 * Contrato que se consume (lo implementó E1; espejo estructural, SIN importar
 * tipos de `headless-runtime`: la UI ESM no depende del backend):
 * - `GET /factory/definition/status` → `{ valid, issues, checkedAt, buildId? }`
 *   donde `valid` = cero issues con severity `error` (los `warn` no bloquean) e
 *   `issues[] = { file, line?, rule, message, severity: "error"|"warn" }`
 *   (`line` aproximada, puede faltar).
 * - CLI espejo: `node scripts/factory.mjs validate` (exit 1 si `!valid`).
 *
 * Reglas (las 8) aplicadas acá:
 * - Cero hardcodeos: el puerto siempre viene del caller (discovery, igual que
 *   `NotificationsBell`); este módulo no contiene ningún literal de puerto.
 * - Polling: CERO intervalos nuevos. El badge reutiliza el tick existente de
 *   salud del daemon en `FactoryLabPage` (`DEFINITION_POLL_MS = 30000`, el mismo
 *   período del health-poll `daemonBuild`); el fetch corre enganchado a ese
 *   tick. Documentado y testeado (el valor vive acá como constante).
 * - Fail-safe visible, no silencioso: fetch fallido o respuesta ausente/corrupta
 *   → badge gris `definition: ?` (nunca rompe la página, nunca finge verde).
 * - Interruptor no aplica (lectura); evidencia: cada issue muestra
 *   `file:line rule message` (sin `line` → `file rule message`).
 * - Tipado estructural (`unknown` + optional chaining); mocks/fetch inyectado
 *   solo en tests.
 *
 * ESM puro, TypeScript estricto, cero `require()`.
 */

// ---------------------------------------------------------------------------
// Polling (Regla 7: reutilizado, período documentado y testeado)
// ---------------------------------------------------------------------------

/**
 * Período del tick que refresca el badge: el tick EXISTENTE de salud del daemon
 * (`loadDaemonBuild` en `FactoryLabPage`, 30s). Este módulo no crea intervalos;
 * la constante existe para que el test fije el contrato (si alguien agrega un
 * polling nuevo para definition, el test de guards lo detecta).
 */
export const DEFINITION_POLL_MS = 30000;

// ---------------------------------------------------------------------------
// Tipos locales mínimos (espejo estructural del contrato E1, sin dependencias)
// ---------------------------------------------------------------------------

export interface DefinitionIssue {
  file: string;
  line?: number;
  rule: string;
  message: string;
  severity: "error" | "warn";
}

export interface DefinitionStatusData {
  /** `true` = válida, `false` = con errores, `null` = desconocida (gris). */
  valid: boolean | null;
  issues: DefinitionIssue[];
  checkedAt: string;
  buildId?: string;
}

/** Fetch inyectable (los tests pasan mocks; el componente pasa el global). */
export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// ---------------------------------------------------------------------------
// URLs (sin puertos hardcodeados: el port siempre viene de discovery)
// ---------------------------------------------------------------------------

export function definitionStatusUrl(port: number): string {
  return `http://127.0.0.1:${port}/factory/definition/status`;
}

// ---------------------------------------------------------------------------
// Parsers defensivos (nunca lanzan; lo desconocido → gris, no verde)
// ---------------------------------------------------------------------------

function asNonEmptyString(v: unknown): string | null {
  try {
    if (typeof v !== "string") return null;
    return v.trim().length > 0 ? v : null;
  } catch {
    return null;
  }
}

function parseOneIssue(v: unknown): DefinitionIssue | null {
  try {
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    const file = asNonEmptyString(r.file);
    const rule = asNonEmptyString(r.rule);
    const message = asNonEmptyString(r.message);
    if (file === null || rule === null || message === null) return null;
    if (r.severity !== "error" && r.severity !== "warn") return null;
    const out: DefinitionIssue = {
      file,
      rule,
      message,
      severity: r.severity,
    };
    try {
      if (
        typeof r.line === "number" &&
        Number.isInteger(r.line) &&
        r.line > 0
      ) {
        out.line = r.line;
      }
    } catch {
      // line aproximada y opcional: sin ella igual vale
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Parsea el GET con tipado estructural (`unknown` + optional chaining, sin
 * importar tipos del backend). Respuesta ausente/corrupta → `valid: null`
 * (gris) + issues `[]`, sin throw. `valid` no-booleano → `null` (jamás se
 * infiere verde). Nunca lanza.
 */
export function parseDefinitionStatusResponse(
  input: unknown,
): DefinitionStatusData {
  try {
    if (!input || typeof input !== "object") {
      return { valid: null, issues: [], checkedAt: "" };
    }
    const r = input as Record<string, unknown>;
    const valid = r.valid === true ? true : r.valid === false ? false : null;
    let issues: DefinitionIssue[] = [];
    try {
      const raw = (r as { issues?: unknown }).issues;
      if (Array.isArray(raw)) {
        const parsed: DefinitionIssue[] = [];
        for (const item of raw) {
          const one = parseOneIssue(item);
          if (one) parsed.push(one);
        }
        issues = parsed;
      }
    } catch {
      issues = [];
    }
    let checkedAt = "";
    try {
      checkedAt =
        typeof r.checkedAt === "string" && r.checkedAt.length > 0
          ? r.checkedAt
          : "";
    } catch {
      checkedAt = "";
    }
    const out: DefinitionStatusData = { valid, issues, checkedAt };
    try {
      const buildId = (r as { buildId?: unknown }).buildId;
      if (typeof buildId === "string" && buildId.trim().length > 0) {
        out.buildId = buildId;
      }
    } catch {
      // buildId opcional: sin él igual vale
    }
    return out;
  } catch {
    return { valid: null, issues: [], checkedAt: "" };
  }
}

/** Cuenta errores y avisos. Entrada corrupta → `{ errors: 0, warns: 0 }`. */
export function countDefinitionIssues(
  issues: DefinitionIssue[] | null | undefined,
): { errors: number; warns: number } {
  try {
    if (!Array.isArray(issues)) return { errors: 0, warns: 0 };
    let errors = 0;
    let warns = 0;
    for (const item of issues) {
      try {
        if (!item || typeof item !== "object") continue;
        if ((item as DefinitionIssue).severity === "error") errors += 1;
        else if ((item as DefinitionIssue).severity === "warn") warns += 1;
      } catch {
        // item roto: se ignora sin romper el conteo
      }
    }
    return { errors, warns };
  } catch {
    return { errors: 0, warns: 0 };
  }
}

export type DefinitionTone = "green" | "red" | "amber" | "gray";

export interface DefinitionBadgeView {
  tone: DefinitionTone;
  label: string;
}

/**
 * Vista del badge: verde `definition válida` si valid; rojo
 * `definition: N errores` si `!valid` (N = solo errors); ámbar
 * `definition: N avisos` si valid con solo warns; gris `definition: ?` si
 * desconocida (`null`: fetch fallido o respuesta corrupta). Nunca lanza.
 */
export function badgeForDefinitionStatus(
  data: DefinitionStatusData | null | undefined,
): DefinitionBadgeView {
  try {
    // Fail-safe: solo un booleano real decide color; cualquier otra forma
    // (ausente, corrupta, `{}`) es desconocida → gris, jamás verde inferido.
    if (!data || typeof data !== "object" || typeof data.valid !== "boolean") {
      return { tone: "gray", label: "definition: ?" };
    }
    let errors = 0;
    let warns = 0;
    try {
      const counted = countDefinitionIssues(data.issues);
      errors = counted.errors;
      warns = counted.warns;
    } catch {
      errors = 0;
      warns = 0;
    }
    if (data.valid === false) {
      return { tone: "red", label: `definition: ${errors} errores` };
    }
    if (warns > 0) {
      return { tone: "amber", label: `definition: ${warns} avisos` };
    }
    return { tone: "green", label: "definition válida" };
  } catch {
    return { tone: "gray", label: "definition: ?" };
  }
}

/**
 * Línea de issue para el panel: `file:line rule message` (`line` aproximada;
 * si falta → `file rule message`). Nunca lanza.
 */
export function formatDefinitionIssue(
  issue: DefinitionIssue | null | undefined,
): string {
  try {
    if (!issue || typeof issue !== "object") return "";
    const file =
      typeof issue.file === "string" && issue.file.length > 0
        ? issue.file
        : "?";
    const rule =
      typeof issue.rule === "string" && issue.rule.length > 0
        ? issue.rule
        : "?";
    const message =
      typeof issue.message === "string" ? issue.message : "";
    const head =
      typeof issue.line === "number" &&
      Number.isInteger(issue.line) &&
      issue.line > 0
        ? `${file}:${issue.line}`
        : file;
    return `${head} ${rule} ${message}`.trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Red con fetch inyectado (tests usan mocks; jamás red real en tests)
// ---------------------------------------------------------------------------

/**
 * GET del estado de definition. Propaga el fallo de red o `!ok` (la página lo
 * mapea a badge gris: fetch fallido visible, cero throw hacia la UI). El JSON
 * corrupto NO lanza (parse tolerante → `valid: null` → gris). Solo lanza ante
 * red/HTTP.
 */
export async function fetchDefinitionStatus(
  fetchFn: FetchLike,
  port: number,
): Promise<DefinitionStatusData> {
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetchFn(definitionStatusUrl(port));
  } catch (e) {
    throw new Error(
      `GET /factory/definition/status falló: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res || res.ok !== true) {
    const status = res && typeof res.status === "number" ? res.status : -1;
    throw new Error(`GET /factory/definition/status → ${status}`);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return parseDefinitionStatusResponse(data);
}
