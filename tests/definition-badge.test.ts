/**
 * Ola 20 E2 — suite del badge de definition (lado UI).
 * `npx tsx --test tests/definition-badge.test.ts` (offline, sin daemon, sin
 * red real: el fetch siempre es un mock inyectado). No monta React/DOM: cubre
 * la lógica pura de `definitionUi.ts` + guards estáticos del fuente de
 * `DefinitionBadge.tsx` y del bloque aditivo de `FactoryLabPage.tsx`.
 *
 * Cubre (contrato de la tarea):
 * - parse tolerante del GET (ausente/corrupta → gris `valid: null`, sin throw)
 * - verde / rojo / ámbar según issues (rojo cuenta SOLO errors)
 * - render de `file:line` con y sin line
 * - fetch fallido → gris (el fetch lanza; la página lo mapea a gris)
 * - polling reutilizado: `DEFINITION_POLL_MS === 30000`, cero intervalos nuevos
 *   en el badge y en el bloque de la página (conteo de `setInterval` intacto)
 * - cero hardcodeos en archivos nuevos (sin literales de puerto)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFINITION_POLL_MS,
  badgeForDefinitionStatus,
  countDefinitionIssues,
  definitionStatusUrl,
  fetchDefinitionStatus,
  formatDefinitionIssue,
  parseDefinitionStatusResponse,
} from "../src/features/factoryLab/components/definitionUi.ts";
import type {
  DefinitionStatusData,
  FetchLike,
} from "../src/features/factoryLab/components/definitionUi.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_PATH = path.join(
  HERE,
  "..",
  "src",
  "features",
  "factoryLab",
  "components",
  "definitionUi.ts",
);
const BADGE_PATH = path.join(
  HERE,
  "..",
  "src",
  "features",
  "factoryLab",
  "components",
  "DefinitionBadge.tsx",
);
const PAGE_PATH = path.join(
  HERE,
  "..",
  "src",
  "features",
  "factoryLab",
  "FactoryLabPage.tsx",
);

function mockFetchOk(payload: unknown): FetchLike {
  return async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

function mockFetchHttp(status: number): FetchLike {
  return async (_url: string, _init?: RequestInit) => ({
    ok: false,
    status,
    json: async () => null,
  });
}

function mockFetchReject(): FetchLike {
  return async (_url: string, _init?: RequestInit) => {
    throw new Error("network down");
  };
}

/**
 * Quita comentarios de bloque y de línea para que los guards estáticos miren
 * código y no prosa (los headers documentan decisiones y nombran patrones).
 * Solo se usa en asserts de ausencia; el código real (`x = setInterval(...)`)
 * sobrevive al stripping.
 */
function stripComments(src: string): string {
  try {
    const noBlock = stripBlockComments(src);
    return noBlock
      .split("\n")
      .map((line) => {
        const idx = line.indexOf("//");
        return idx >= 0 ? line.slice(0, idx) : line;
      })
      .join("\n");
  } catch {
    return src;
  }
}

/** Solo comentarios de bloque (para el guard de puertos: un `http://...` con
 *  puerto hardcodeado vive DESPUÉS de `//` y el strip de línea lo escondería). */
function stripBlockComments(src: string): string {
  try {
    return src.replace(/\/\*[\s\S]*?\*\//g, "");
  } catch {
    return src;
  }
}

// ── Parse tolerante (ausente/corrupto → gris, sin throw) ────────────────────

test("parse: respuesta válida con cero issues → valid true", () => {
  const parsed = parseDefinitionStatusResponse({
    valid: true,
    issues: [],
    checkedAt: "2026-09-03T00:00:00.000Z",
    buildId: "dev-abc",
  });
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.checkedAt, "2026-09-03T00:00:00.000Z");
  assert.equal(parsed.buildId, "dev-abc");
});

test("parse: respuesta ausente/corrupta → valid null, sin throw", () => {
  for (const bad of [
    null,
    undefined,
    42,
    "ok",
    {},
    { valid: "yes", issues: "x" },
    { valid: 1 },
    { issues: [{ file: 1, rule: null }] },
  ]) {
    const parsed = parseDefinitionStatusResponse(bad);
    assert.equal(parsed.valid, null, `debió ser null para ${JSON.stringify(bad)}`);
    assert.deepEqual(parsed.issues, []);
  }
});

test("parse: issues malformadas se descartan, las buenas quedan", () => {
  const parsed = parseDefinitionStatusResponse({
    valid: false,
    issues: [
      { file: "factory/scorers/x/scorer.md", rule: "scorers-labels", message: "m", severity: "error", line: 3 },
      { file: "x", rule: "y", message: "z", severity: "fatal" },
      null,
      "texto",
    ],
    checkedAt: "t",
  });
  assert.equal(parsed.valid, false);
  assert.equal(parsed.issues.length, 1);
  assert.equal(parsed.issues[0].line, 3);
});

test("parse: line inválida se omite pero el issue vale", () => {
  const parsed = parseDefinitionStatusResponse({
    valid: true,
    issues: [
      { file: "f", rule: "r", message: "m", severity: "warn", line: -2 },
      { file: "f", rule: "r", message: "m", severity: "warn", line: 1.5 },
    ],
    checkedAt: "",
  });
  assert.equal(parsed.issues.length, 2);
  assert.equal(parsed.issues[0].line, undefined);
  assert.equal(parsed.issues[1].line, undefined);
});

// ── Badge verde/rojo/ámbar/gris ─────────────────────────────────────────────

test("badge: valid sin issues → verde 'definition válida'", () => {
  const view = badgeForDefinitionStatus({
    valid: true,
    issues: [],
    checkedAt: "t",
  });
  assert.deepEqual(view, { tone: "green", label: "definition válida" });
});

test("badge: !valid → rojo 'definition: N errores' (N = solo errors)", () => {
  const view = badgeForDefinitionStatus({
    valid: false,
    issues: [
      { file: "a", rule: "r1", message: "m", severity: "error" },
      { file: "b", rule: "r2", message: "m", severity: "error", line: 9 },
      { file: "c", rule: "r3", message: "m", severity: "warn" },
    ],
    checkedAt: "t",
  });
  assert.deepEqual(view, { tone: "red", label: "definition: 2 errores" });
});

test("badge: valid con solo warns → ámbar 'definition: N avisos'", () => {
  const view = badgeForDefinitionStatus({
    valid: true,
    issues: [{ file: "a", rule: "r", message: "m", severity: "warn" }],
    checkedAt: "t",
  });
  assert.deepEqual(view, { tone: "amber", label: "definition: 1 avisos" });
});

test("badge: null/desconocida → gris 'definition: ?' sin throw", () => {
  for (const bad of [null, undefined, {} as DefinitionStatusData]) {
    const view = badgeForDefinitionStatus(bad);
    assert.deepEqual(view, { tone: "gray", label: "definition: ?" });
  }
  const unknown = parseDefinitionStatusResponse(null);
  assert.deepEqual(badgeForDefinitionStatus(unknown), {
    tone: "gray",
    label: "definition: ?",
  });
});

test("countDefinitionIssues cuenta errors y warns por separado", () => {
  assert.deepEqual(
    countDefinitionIssues([
      { file: "a", rule: "r", message: "m", severity: "error" },
      { file: "b", rule: "r", message: "m", severity: "warn" },
      { file: "c", rule: "r", message: "m", severity: "warn" },
    ]),
    { errors: 1, warns: 2 },
  );
  assert.deepEqual(countDefinitionIssues(null), { errors: 0, warns: 0 });
});

// ── Render file:line con y sin line ─────────────────────────────────────────

test("format: con line → 'file:line rule message'", () => {
  assert.equal(
    formatDefinitionIssue({
      file: "factory/factory.yaml",
      line: 12,
      rule: "yaml-ports",
      message: "ports fuera de rango",
      severity: "error",
    }),
    "factory/factory.yaml:12 yaml-ports ports fuera de rango",
  );
});

test("format: sin line → 'file rule message'", () => {
  assert.equal(
    formatDefinitionIssue({
      file: "factory/agents/",
      rule: "agents-exactly-one-foreman",
      message: "se requiere 1 FOREMAN",
      severity: "error",
    }),
    "factory/agents/ agents-exactly-one-foreman se requiere 1 FOREMAN",
  );
  assert.equal(formatDefinitionIssue(null), "");
});

// ── Fetch: ok / HTTP fail / rechazo / JSON corrupto ─────────────────────────

test("fetch: GET ok válido → parseado (URL por discovery, sin puerto literal)", async () => {
  let seenUrl = "";
  const fetchFn: FetchLike = async (url: string, _init?: RequestInit) => {
    seenUrl = url;
    return { ok: true, status: 200, json: async () => ({ valid: true, issues: [], checkedAt: "t" }) };
  };
  const parsed = await fetchDefinitionStatus(fetchFn, 17681);
  assert.equal(parsed.valid, true);
  assert.equal(seenUrl, definitionStatusUrl(17681));
  assert.ok(seenUrl.endsWith("/factory/definition/status"));
});

test("fetch: !ok → lanza (la página lo mapea a gris, fail-safe visible)", async () => {
  await assert.rejects(() => fetchDefinitionStatus(mockFetchHttp(500), 17681));
});

test("fetch: rechazo de red → lanza (la página lo mapea a gris)", async () => {
  await assert.rejects(() => fetchDefinitionStatus(mockFetchReject(), 17681));
});

test("fetch: JSON corrupto con ok → valid null (gris) sin throw", async () => {
  const parsed = await fetchDefinitionStatus(mockFetchOk(null), 17681);
  assert.equal(parsed.valid, null);
  assert.deepEqual(
    badgeForDefinitionStatus(parsed),
    { tone: "gray", label: "definition: ?" },
  );
});

// ── Cotas y guards estáticos ────────────────────────────────────────────────

test("DEFINITION_POLL_MS === 30000 (reutiliza el tick de salud, cero polling nuevo)", () => {
  assert.equal(DEFINITION_POLL_MS, 30000);
});

test("DefinitionBadge.tsx: cero setInterval/setTimeout/fetch (presentacional)", () => {
  const raw = fs.readFileSync(BADGE_PATH, "utf-8");
  // Los guards miran código, no prosa: se ignoran comentarios (el header
  // documenta qué NO hace el archivo y por eso nombra los patrones).
  const src = stripComments(raw);
  assert.ok(!src.includes("setInterval"), "el badge no debe crear intervalos");
  assert.ok(!src.includes("setTimeout"), "el badge no debe crear timeouts");
  assert.ok(!src.includes("fetch("), "el badge no debe fetchear (lo hace el tick de la página)");
  assert.ok(src.includes("details"), "el panel colapsable usa <details>");
  assert.ok(src.includes("definition: ?"), "el estado gris existe");
});

test("definitionUi.ts: cero puertos literales (URLs por discovery)", () => {
  const raw = fs.readFileSync(UI_PATH, "utf-8");
  const src = stripBlockComments(raw);
  assert.ok(!src.includes("17680"), "sin puerto literal 17680");
  assert.ok(!src.includes("4096"), "sin puerto literal 4096");
  assert.ok(!src.includes("setInterval"), "sin intervalos en lógica pura");
  assert.ok(!src.includes("require("), "ESM: cero require()");
});

test("FactoryLabPage: bloque aditivo (import + fetch al tick existente, sin polling nuevo)", () => {
  const src = fs.readFileSync(PAGE_PATH, "utf-8");
  assert.ok(src.includes("DefinitionBadge"), "import + uso del badge");
  assert.ok(
    src.includes("/factory/definition/status") || src.includes("fetchDefinitionStatus"),
    "fetch de definition enganchado",
  );
  const intervals = src.match(/setInterval/g) ?? [];
  assert.equal(
    intervals.length,
    2,
    `la página debe seguir con sus 2 setInterval preexistentes (daemon-health 30s + sync 1.5s), hay ${intervals.length}`,
  );
});
