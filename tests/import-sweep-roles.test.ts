/**
 * Barrido de roles (FASE 1 E1 — C6/C7).
 * Falla si aparece una DEFINICIÓN nueva de lista de roles fuera de
 * `shared/roles.ts`. Los usos sueltos (`toolsetFor("triage")`) NO cuentan:
 * solo cuentan las definiciones (identificadores de lista o arrays con ≥3
 * roles distintos en el mismo archivo).
 *
 * Allowlist: los 5 archivos legacy que aún definen los suyos. Migran en
 * F1-E2 (E2 los delega a shared/roles) / F2-F4; hoy se registran como
 * excepción documentada y NO se tocan (reparto sin solape: E2 es dueño).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Los 5 legacy con definición propia (excepción documentada, no tocar). */
const LEGACY_ALLOWLIST = new Set([
  "headless-runtime/runner/toolPolicy.ts",
  "headless-runtime/sessions/agentSessions.ts",
  "shared/types/scorer.ts",
  "headless-runtime/factory/agentLoader.ts",
  "headless-runtime/workItem/workItemStore.ts",
]);

const CANONICAL = "shared/roles.ts";

/** Identificadores de DEFINICIÓN (no imports/usos): solo shared/roles.ts o allowlist. */
const DEFINITION_PATTERNS: RegExp[] = [
  /\b(?:export\s+)?(?:const|let|var)\s+(?:KNOWN_AGENT_ROLES|AGENT_ROLES|SCORER_AGENT_ROLES|TOOL_ROLES|SESSION_AGENT_ROLES|FACTORY_AGENT_ROLES|SCORER_ROLES|AGENT_TYPES)\b/,
  /\btype\s+(?:ToolRole|AgentRole|FactoryAgentRole|SessionAgentRole|ToolRoleCanonical|ScorerRoleCanonical|ScorerAgentRole|AgentType)\b/,
];

const ROLE_LITERALS = [
  "foreman",
  "triage",
  "spec",
  "implement",
  "review",
  "verification",
  "mvp-tracking",
  "interview",
  "FOREMAN",
  "TRIAGE",
  "SPEC",
  "IMPLEMENT",
  "REVIEW",
  "VERIFY",
];

function listTsFiles(dir: string, out: string[], cap: number): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= cap) return;
    if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      listTsFiles(full, out, cap);
    } else if (e.isFile() && e.name.endsWith(".ts")) {
      out.push(full);
    }
  }
}

function distinctRoleLiteralsIn(src: string): Set<string> {
  const found = new Set<string>();
  for (const lit of ROLE_LITERALS) {
    const quoted = [`"${lit}"`, `'${lit}'`, `\`${lit}\``];
    for (const q of quoted) {
      if (src.includes(q)) {
        found.add(lit.toLowerCase());
        break;
      }
    }
  }
  return found;
}

/**
 * Arrays de ASIGNACIÓN (`= [...]`) con ≥4 roles distintos en el MISMO array
 * → lista nueva. Umbral 4 a propósito: las 4 canónicas tienen 5–7 roles;
 * los subconjuntos derivados de ≤3 (`defaultModels` keys en
 * definitionValidate, `SCORER_STAGELESS_ROLES` en scorerEngine) se permiten
 * hoy y migran en F2-F4 a derivar de shared/roles (carry-over E1-CO2).
 * Los usos sueltos (`toolsetFor("triage")`, `of [...]` iterativos) no cuentan.
 */
function hasNewRoleArrayDefinition(src: string): string | null {
  const re = /=\s*\[([^\]]{0,800})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const body = m[1] ?? "";
    const distinct = distinctRoleLiteralsIn(body);
    if (distinct.size >= 4) {
      return [...distinct].sort().join(",");
    }
  }
  return null;
}

test("barrido roles: sin definiciones nuevas fuera de shared/roles.ts + allowlist", () => {
  const files: string[] = [];
  for (const root of ["headless-runtime", "shared"]) {
    listTsFiles(path.join(REPO, root), files, 600);
  }
  const offenders: string[] = [];
  for (const full of files) {
    const rel = path.relative(REPO, full).split(path.sep).join("/");
    if (rel === CANONICAL) continue;
    if (rel.startsWith("tests/")) continue;
    let src = "";
    try {
      src = fs.readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    if (LEGACY_ALLOWLIST.has(rel)) continue;
    // 1) Definiciones (const/type) fuera de la allowlist → ofensa directa.
    //    Los imports (`import { AGENT_TYPES }`) y usos no cuentan.
    const hitDef = DEFINITION_PATTERNS.some((re) => re.test(src));
    if (hitDef) {
      offenders.push(`${rel} (definición de lista de roles)`);
      continue;
    }
    // 2) Arrays de asignación con ≥3 roles en el mismo array → lista nueva.
    const arrHit = hasNewRoleArrayDefinition(src);
    if (arrHit) {
      offenders.push(`${rel} (array con roles: ${arrHit})`);
    }
  }
  assert.deepEqual(offenders, [], `definiciones de roles fuera de ${CANONICAL} + allowlist:\n${offenders.join("\n")}`);
});

test("allowlist documentada: los 5 legacy siguen existiendo (migran en F1-E2/F2-F4)", () => {
  for (const rel of LEGACY_ALLOWLIST) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `legacy esperado: ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(REPO, CANONICAL)), "shared/roles.ts debe existir");
});

test("ESM: cero require() en los archivos nuevos de E1", () => {
  const news = [
    "shared/roles.ts",
    "headless-runtime/factory/routing/routeTable.ts",
    "headless-runtime/factory/routing/routeParsers.ts",
  ];
  const hits: string[] = [];
  for (const rel of news) {
    const src = fs.readFileSync(path.join(REPO, rel), "utf-8");
    if (/\brequire\s*\(\s*["'`]/.test(src)) hits.push(rel);
  }
  assert.deepEqual(hits, [], `require() fuera de lugar: ${hits.join(",")}`);
});
