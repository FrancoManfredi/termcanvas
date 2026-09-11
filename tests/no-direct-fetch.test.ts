/**
 * F4-E2 — barrido no-direct-fetch (un cliente, una red).
 *
 * docs/MASTER-PLAN-MODULARIDAD.md §1: `src/lib/factoryClient.ts` es el único
 * cliente HTTP del renderer. Esta suite fija el contrato de migración:
 * - Infra permitida: `src/lib/factoryClient.ts` (único importador) +
 *   `src/lib/factoryDiscovery.ts` (descubre el puerto, no pide datos).
 * - Migrado (cero acceso directo): `NotificationsBell.tsx` (panel prueba
 *   F4-E2: usa `listFactoryNotifications` + `postFactoryNotificationAck`) +
 *   `ReviewPanel.tsx` (T3: `getFactoryReview` + `postFactoryReviewAccept` +
 *   `postFactoryReviewRetry`, misma ruta/body/timeout, polling intacto).
 * - Carry-over documentado (excepción, NO se toca): los otros 7 archivos del
 *   scope con acceso directo (cada uno con su TODO `F4-vista-única`).
 * - Mundo cerrado: cualquier OTRO archivo del scope con acceso directo falla
 *   (un panel nuevo con `fetch(` directo rompe esta suite).
 * - Cada excepción pineada sigue teniendo su acceso directo: migrar un panel
 *   sin actualizar esta suite también falla (C10: la suite se actualiza en la
 *   misma tanda que la migración).
 * - Espejos renderer (`*Ui.ts` + `verificationFallback.ts`): siguen en uso
 *   (test de uso-cero previo en esta misma tanda, punto 3 de F4-E2) → su
 *   borrado queda BLOQUEADO con evidencia (carry-over, jamás a ciegas).
 *
 * Definición de "acceso directo": llamada global `fetch(` en código (se
 * ignoran comentarios de línea; `fetchFn(`, `fetchWithTimeout(`,
 * `fetchNotifications(` y `fetch` como valor no cuentan: el prefijo exige
 * borde no-palabra y no-punto). Scope: superficie renderer→factory
 * (`src/features/factoryLab` + `src/lib`).
 *
 * Offline total: lectura estática + `node:test`. Cero red, cero LLM, daemon
 * intacto. ESM puro, cero `require()`. Reglas: las 8 + C1–C10 (C1: recorrido
 * iterativo con pila, sin recursión escrita a mano, sin timers).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

const SCOPE_DIRS = [
  path.join(REPO, "src", "features", "factoryLab"),
  path.join(REPO, "src", "lib"),
] as const;

/** Infra con red directa permitida (cliente único + discovery). */
const INFRA_ALLOW = new Set([
  "src/lib/factoryClient.ts",
  "src/lib/factoryDiscovery.ts",
]);

/** Migrados F4-E2 + T3: deben tener CERO acceso directo. */
const MIGRATED_ZERO = new Set([
  "src/features/factoryLab/components/NotificationsBell.tsx",
  "src/features/factoryLab/components/ReviewPanel.tsx",
]);

/**
 * Carry-over F4-E2 (excepción documentada, NO tocar): acceso directo
 * preexistente, cada archivo con su TODO `F4-vista-única`. T3 devuelve 6
 * con evidencia (ver reporte): Scorers/Benchmarks/SelfImprovement tocan
 * scorers (PROHIBIDO) + espejos pineados; TriageQuestions/derive sin op en
 * el cliente; VerificationPanel con reconciliación H-008 (5 endpoints);
 * useWorkItemsPolling con abort encadenado + /foreman/logs sin op;
 * FactoryLabPage con discovery propio cacheado (cambio de comportamiento).
 */
const CARRYOVER_EXCEPTIONS = new Set([
  "src/features/factoryLab/components/BenchmarksPanel.tsx",
  "src/features/factoryLab/components/ScorersPanel.tsx",
  "src/features/factoryLab/components/SelfImprovementPanel.tsx",
  "src/features/factoryLab/components/TriageQuestions.tsx",
  "src/features/factoryLab/components/VerificationPanel.tsx",
  "src/features/factoryLab/hooks/useWorkItemsPolling.ts",
  "src/features/factoryLab/FactoryLabPage.tsx",
]);

function toRel(abs: string): string {
  return path.relative(REPO, abs).split(path.sep).join("/");
}

/** Archivos .ts/.tsx del scope (iterativo con pila, C1). */
function scopeFiles(): string[] {
  const out: string[] = [];
  const stack: string[] = [...SCOPE_DIRS];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (
        e.isFile() &&
        (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
        !e.name.endsWith(".test.ts") &&
        !e.name.endsWith(".test.tsx")
      ) {
        out.push(toRel(abs));
      }
    }
  }
  return out.sort();
}

function readRel(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf-8");
}

/**
 * Líneas con llamada global `fetch(` en CÓDIGO (sin comentarios `//` de
 * línea). Limitación honesta: el corte `//` es ingenuo ante `http://` dentro
 * de strings, pero el token `fetch(` precede al literal en esos casos, así
 * que la detección no pierde verdaderos positivos; los comentarios puros con
 * ejemplos sí se ignoran.
 */
function directFetchLines(src: string): string[] {
  const hits: string[] = [];
  for (const raw of src.split("\n")) {
    const code = raw.includes("//") ? raw.slice(0, raw.indexOf("//")) : raw;
    if (/(^|[^A-Za-z0-9_.])fetch\s*\(/.test(code)) hits.push(raw.trim().slice(0, 120));
  }
  return hits;
}

function directFetchCount(rel: string): number {
  return directFetchLines(readRel(rel)).length;
}

// ── Infra + migrado ──

test("F4-E2 no-direct-fetch: infra permitida existe (cliente único + discovery)", () => {
  for (const rel of INFRA_ALLOW) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `${rel} existe`);
  }
  assert.ok(
    readRel("src/lib/factoryClient.ts").includes("listFactoryNotifications"),
    "el cliente único expone notificaciones (lo usa el panel prueba)",
  );
});

test("F4-E2 no-direct-fetch: panel prueba migrado con cero acceso directo", () => {
  for (const rel of MIGRATED_ZERO) {
    assert.deepEqual(directFetchLines(readRel(rel)), [], `${rel} sin fetch( directo`);
  }
});

test("F4-E2 no-direct-fetch: panel prueba usa el cliente único", () => {
  const src = readRel("src/features/factoryLab/components/NotificationsBell.tsx");
  assert.ok(src.includes("lib/factoryClient"), "importa el cliente único");
  assert.ok(src.includes("listFactoryNotifications"), "GET vía cliente");
  assert.ok(src.includes("postFactoryNotificationAck"), "ack vía cliente");
});

test("T3 no-direct-fetch: ReviewPanel migrado usa el cliente único (polling intacto)", () => {
  const src = readRel("src/features/factoryLab/components/ReviewPanel.tsx");
  assert.ok(src.includes("lib/factoryClient"), "importa el cliente único");
  assert.ok(src.includes("getFactoryReview"), "GET review vía cliente");
  assert.ok(src.includes("postFactoryReviewAccept"), "accept vía cliente");
  assert.ok(src.includes("postFactoryReviewRetry"), "retry vía cliente");
  assert.ok(src.includes("TODO(F4-vista-única)") === false, "TODO consumido (ya migrado)");
  assert.ok(src.includes("setInterval"), "polling intacto (el cliente no pollea, C1)");
  assert.ok(src.includes("POLL_MS"), "intervalo original intacto");
});

// ── Carry-over pineado + mundo cerrado ──

test("F4-E2 no-direct-fetch: carry-overs documentados conservan su acceso (no tocar)", () => {
  for (const rel of CARRYOVER_EXCEPTIONS) {
    const n = directFetchCount(rel);
    assert.ok(n >= 1, `${rel} sigue con su acceso directo preexistente (${n})`);
    assert.ok(
      readRel(rel).includes("TODO(F4-vista-única)"),
      `${rel} con TODO de migración futura`,
    );
  }
});

test("F4-E2 no-direct-fetch: mundo cerrado (ningún otro archivo con acceso directo)", () => {
  const offenders: string[] = [];
  for (const rel of scopeFiles()) {
    if (INFRA_ALLOW.has(rel) || CARRYOVER_EXCEPTIONS.has(rel)) continue;
    if (directFetchCount(rel) > 0) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `acceso directo nuevo fuera del cliente:\n${offenders.join("\n")}`);
});

// ── Punto 3 F4-E2: espejos siguen en uso → borrado bloqueado (misma tanda) ──

test("F4-E2 espejos: notificationsUi red sigue pineada por su suite (prohibido borrar)", () => {
  const suite = readRel("tests/notifications-ui.test.ts");
  assert.ok(
    suite.includes("fetchNotifications") && suite.includes("ackNotificationById"),
    "la suite vecina importa los helpers de red del espejo",
  );
  const ui = readRel("src/features/factoryLab/components/notificationsUi.ts");
  assert.ok(ui.includes("export async function fetchNotifications"), "el espejo sigue exportándolo");
  assert.ok(ui.includes("export async function ackNotificationById"), "el espejo sigue exportándolo");
});

test("F4-E2 espejos: scorersUi sigue importado por paneles vivos (prohibido borrar)", () => {
  assert.ok(
    readRel("src/features/factoryLab/components/ScorersPanel.tsx").includes("./scorersUi"),
    "ScorersPanel (carry-over) usa scorersUi",
  );
  assert.ok(
    readRel("src/features/factoryLab/components/BenchmarksPanel.tsx").includes("./scorersUi"),
    "BenchmarksPanel (carry-over) usa scorersUi",
  );
  const suite = readRel("tests/scorers-ui.test.ts");
  assert.ok(suite.includes("scorersUrl") && suite.includes("parseScorersList"), "suite vecina pinea el espejo");
});

test("F4-E2 espejos: verificationFallback sigue reconciliando el panel (prohibido borrar)", () => {
  const panel = readRel("src/features/factoryLab/components/VerificationPanel.tsx");
  assert.ok(panel.includes("resolveVerificationView"), "el panel usa la vista con fallback");
  assert.ok(panel.includes("verificationFallback"), "el panel importa el módulo");
  const fb = readRel("src/features/factoryLab/components/verificationFallback.ts");
  assert.ok(fb.includes("export function resolveVerificationView"), "el espejo sigue exportándolo");
  assert.ok(fb.includes("export function hasFullVerification"), "el predicado único sigue vivo");
});

// ── ESM ──

test("F4-E2 no-direct-fetch: ESM cero require() en archivos tocados", () => {
  const touched = [
    "src/features/factoryLab/components/NotificationsBell.tsx",
    "src/features/factoryLab/components/ScorersPanel.tsx",
    "src/features/factoryLab/components/VerificationPanel.tsx",
    "src/features/factoryLab/components/ReviewPanel.tsx",
    "src/features/factoryLab/components/BenchmarksPanel.tsx",
    "src/features/factoryLab/components/SelfImprovementPanel.tsx",
    "src/features/factoryLab/components/TriageQuestions.tsx",
    "src/features/factoryLab/hooks/useWorkItemsPolling.ts",
    "src/features/factoryLab/FactoryLabPage.tsx",
    "src/lib/runnerConfig.ts",
    "tests/no-direct-fetch.test.ts",
    "tests/renderer-runner-fallback.test.ts",
  ];
  const hits: string[] = [];
  for (const rel of touched) {
    if (/\brequire\s*\(\s*["'`]/.test(readRel(rel))) hits.push(rel);
  }
  assert.deepEqual(hits, [], `require() prohibido (ESM, C1) en:\n${hits.join("\n")}`);
});
