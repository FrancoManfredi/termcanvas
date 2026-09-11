/**
 * ToolPolicy (E2 ③ "solo el runner escribe"): invariantes de la compuerta.
 *
 * - `toolsetFor(rol)` pura: mismo rol → mismo set, copia fresca.
 * - readonly = {read,glob,grep,webfetch} espejo TRIAGE_TOOLS; implement = set con escritura.
 * - Únicos con escritura = runner/implement (ningún otro rol pide write/edit/bash).
 * - Compuerta por rol: todo lo que no sea implement cae a readonly (fail-closed).
 * - PROHIBIDO cualquier literal de tools fuera de toolPolicy (barrido estático
 *   sobre los archivos migrados; factoryServer/implementPrompt son de E1 y van
 *   por carry-over, NO se barren acá para no pisar su ownership).
 *
 * Todo offline: imports puros + lectura estática. Cero LLM, cero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  READONLY_TOOLS,
  IMPLEMENT_TOOLS,
  SKILL_TOOL_GRANT,
  toolsetFor,
  toolsetNameFor,
  canWriteTools,
} from "../headless-runtime/runner/toolPolicy.ts";
import { TRIAGE_TOOLS } from "../headless-runtime/triage/triageAgent.ts";
import { SPEC_TOOLS } from "../headless-runtime/spec/specAgent.ts";
import { REVIEW_TOOLS } from "../headless-runtime/review/reviewAgent.ts";

const REPO = new URL("..", import.meta.url);
function readSrc(rel: string): string {
  return fs.readFileSync(new URL(rel, REPO), "utf-8");
}

// Archivos migrados por E2 (ownership E2): la política ya los cablea.
// factoryServer.ts / implementPrompt.ts / implementService.ts son de E1:
// se leen como invariante donde aplica, pero sus textos van por carry-over.
const WIRED = [
  "headless-runtime/triage/triageAgent.ts",
  "headless-runtime/spec/specAgent.ts",
  "headless-runtime/review/reviewAgent.ts",
  "headless-runtime/foreman/foreman.ts",
  "headless-runtime/implement/implementAgent.ts",
  "headless-runtime/interview/harness/opencode.ts",
];

// ── 1. toolsetFor pura ──

test("toolsetFor es pura: mismo rol → mismo set en copia fresca", () => {
  const a = toolsetFor("triage");
  const b = toolsetFor("triage");
  assert.deepEqual(a, b);
  assert.notEqual(a, b, "copia fresca por llamada (mutar una no afecta a otras)");
  a.read = false;
  assert.equal(toolsetFor("triage").read, true, "la mutación local no contamina la política");
});

test("toolsetNameFor: solo implement es implement; resto (incl. basura) → readonly", () => {
  assert.equal(toolsetNameFor("implement"), "implement");
  assert.equal(toolsetNameFor("IMPLEMENT"), "implement");
  assert.equal(toolsetNameFor(" Implement "), "implement");
  for (const role of ["triage", "spec", "review", "foreman", "mvp-tracking", "interview", "", "foreman ", null, undefined, 42, {}]) {
    assert.equal(toolsetNameFor(role), "readonly", `rol ${JSON.stringify(role)} debe caer a readonly`);
  }
});

// ── 2. readonly espejo triage; implement = set actual del runner ──

test("readonly es el espejo {read,glob,grep,webfetch} (TRIAGE_TOOLS/SPEC/REVIEW intactos por compat)", () => {
  assert.deepEqual(Object.keys({ ...READONLY_TOOLS }).sort(), ["glob", "grep", "read", "webfetch"]);
  assert.deepEqual({ ...TRIAGE_TOOLS }, { ...READONLY_TOOLS });
  assert.deepEqual({ ...SPEC_TOOLS }, { ...READONLY_TOOLS });
  assert.deepEqual({ ...REVIEW_TOOLS }, { ...READONLY_TOOLS });
  for (const tools of [TRIAGE_TOOLS, SPEC_TOOLS, REVIEW_TOOLS]) {
    assert.deepEqual(Object.keys(tools).sort(), ["glob", "grep", "read", "webfetch"]);
  }
});

test("implement es el único set con escritura (read/write/edit/bash/glob/grep/webfetch)", () => {
  assert.deepEqual(Object.keys({ ...IMPLEMENT_TOOLS }).sort(), ["bash", "edit", "glob", "grep", "read", "webfetch", "write"]);
  assert.deepEqual(toolsetFor("implement"), { ...IMPLEMENT_TOOLS });
  for (const role of ["triage", "spec", "review", "foreman", "mvp-tracking", "interview"]) {
    assert.deepEqual(toolsetFor(role), { ...READONLY_TOOLS }, `${role} es readonly`);
  }
});

// ── 3. Compuerta por rol ──

test("compuerta: solo implement puede pedir escritura", () => {
  assert.equal(canWriteTools("implement"), true);
  for (const role of ["triage", "spec", "review", "foreman", "mvp-tracking", "interview", "", null, undefined]) {
    assert.equal(canWriteTools(role), false, `${JSON.stringify(role)} no escribe`);
  }
});

// ── 4. Ningún prompt fuera de implement pide escritura: barrido estático ──

test("barrido: ningún archivo cableado pide write/edit/bash (el literal vive solo en toolPolicy)", () => {
  const hits: string[] = [];
  for (const rel of WIRED) {
    const src = readSrc(rel);
    if (/\bwrite\s*:\s*true/.test(src) || /\bedit\s*:\s*true/.test(src) || /\bbash\s*:\s*true/.test(src)) {
      hits.push(rel);
    }
  }
  assert.deepEqual(hits, [], `archivos con escritura fuera de toolPolicy: ${hits.join(", ")}`);
  const policy = readSrc("headless-runtime/runner/toolPolicy.ts");
  assert.ok(/\bwrite\s*:\s*true/.test(policy), "implement vive en toolPolicy");
});

test("barrido: cableados usan toolsetFor(rol); sin tools:{} (que no niega nada, H-010)", () => {
  const missing: string[] = [];
  const emptyTools: string[] = [];
  for (const rel of WIRED) {
    const src = readSrc(rel);
    if (!src.includes("toolsetFor(")) missing.push(rel);
    if (/tools\s*:\s*\{\s*\}/.test(src)) emptyTools.push(rel);
  }
  assert.deepEqual(missing, [], `sin cablear a la política: ${missing.join(", ")}`);
  assert.deepEqual(emptyTools, [], `tools:{} no niega nada (H-010), debe haber desaparecido: ${emptyTools.join(", ")}`);
});

test("barrido: sin literales read:true fuera de toolPolicy en los cableados", () => {
  const hits: string[] = [];
  for (const rel of WIRED) {
    const src = readSrc(rel);
    if (/\bread\s*:\s*true/.test(src)) hits.push(rel);
  }
  assert.deepEqual(hits, [], `literales de tools fuera de toolPolicy: ${hits.join(", ")}`);
});

test("implement pide su set por rol (trazable a la compuerta)", () => {
  const src = readSrc("headless-runtime/implement/implementAgent.ts");
  assert.ok(src.includes('toolsetFor("implement")'), "implement usa toolsetFor(implement)");
});

// ── 5. Skill grant: solo review lo suma a su set (no es escritura) ──

test("SKILL_TOOL_GRANT es solo {skill:true} y readonly sigue sin skill", () => {
  assert.deepEqual({ ...SKILL_TOOL_GRANT }, { skill: true });
  assert.deepEqual(toolsetFor("review"), { ...READONLY_TOOLS }, "el set base no cambia");
  assert.equal(canWriteTools("review"), false, "skill no es escritura");
});

test("review NO suma skill tool en sesión headless (resolución estática, pineado)", () => {
  // Doctrina vigente: las skills del review se resuelven estáticamente
  // (resolveReviewSkills + override en el turno) y el payload lo pinea
  // review-sdk-envelope (`skill: undefined`). El grant vive en toolPolicy
  // para el espejo interactivo (permission.skill), no para la sesión
  // headless. Este test reemplaza al viejo "review cablea el grant".
  const src = readSrc("headless-runtime/review/reviewAgent.ts");
  assert.ok(!src.includes("SKILL_TOOL_GRANT"), "sesión headless sin skill tool");
  assert.ok(src.includes("resolveReviewSkills"), "resolución estática cableada");
});

// ── 6. ESM: cero require() en la política y cableados tocados ──

test("ESM: cero require() en toolPolicy y archivos cableados", () => {
  const hits: string[] = [];
  for (const rel of ["headless-runtime/runner/toolPolicy.ts", ...WIRED]) {
    const src = readSrc(rel);
    // Llamada real require("...") — la mención en prosa `require()` de la
    // doc no cuenta (el regex exige argumento con string).
    if (/\brequire\s*\(\s*["'`]/.test(src)) hits.push(rel);
  }
  assert.deepEqual(hits, [], `require() fuera de lugar: ${hits.join(", ")}`);
});
