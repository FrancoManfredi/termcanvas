/**
 * Ola 17 E2 — La skill enseña a PEDIR re-verificación (el motor de E1 la ejecuta).
 * Suite de contenido: lee los .md/.tsx/.ts y exige substrings exactos, así la
 * skill y el test no divergen en silencio. El reviewer sigue SIN bash: pide,
 * nunca ejecuta. No toca el daemon ni muta disco productivo (solo lecturas).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSkillOrNull, SKILL_MAX_BYTES } from "../headless-runtime/factory/agentLoader.ts";
import { buildReviewPrompt } from "../headless-runtime/review/reviewPrompt.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_PATH = path.join(REPO_ROOT, "factory", "skills", "code-review", "SKILL.md");
const AGENT_PATH = path.join(REPO_ROOT, "factory", "agents", "review", "agent.md");
const PROMPT_PATH = path.join(REPO_ROOT, "headless-runtime", "review", "reviewPrompt.ts");
const TIMELINE_PATH = path.join(
  REPO_ROOT,
  "src",
  "features",
  "factoryLab",
  "components",
  "WorkItemList.tsx",
);
const REVIEW_PANEL_PATH = path.join(
  REPO_ROOT,
  "src",
  "features",
  "factoryLab",
  "components",
  "ReviewPanel.tsx",
);
const VERIF_PANEL_PATH = path.join(
  REPO_ROOT,
  "src",
  "features",
  "factoryLab",
  "components",
  "VerificationPanel.tsx",
);

function read(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

// ── 1. Sección nueva presente ──

test("skill: trae la sección Pedir re-verificación (reverify)", () => {
  const md = read(SKILL_PATH);
  assert.ok(
    md.includes("## Requesting re-verification (reverify)"),
    "la skill debe tener la sección reverify con ese header exacto",
  );
});

// ── 2. Secciones existentes intactas (agregar, no reescribir) ──

test("skill: secciones existentes intactas tras agregar reverify", () => {
  const md = read(SKILL_PATH);
  for (const marker of [
    "## Phase 1: Orient",
    "## Phase 2: Critical Pass",
    "## Phase 3: Specialist Focus",
    "## Phase 4: Verdict (MANDATORY output mapping)",
    "## Rules",
    "ask_human",
  ]) {
    assert.ok(md.includes(marker), `la skill debe seguir trayendo: ${marker}`);
  }
  assert.ok(!md.includes("Hydra"), "la skill no debe nombrar Hydra (pacto de la vecina)");
});

// ── 3. Allowlist EXACTA (los 5 comandos literales) ──

test("skill: documenta la allowlist cerrada con los 5 comandos literales", () => {
  const md = read(SKILL_PATH);
  for (const cmd of [
    "pnpm test",
    "pnpm build",
    "git diff --stat",
    "git status --porcelain",
    "git diff -- <job-relative paths>",
  ]) {
    assert.ok(md.includes(cmd), `la skill debe listar literal: ${cmd}`);
  }
  assert.ok(md.includes("no `..`"), "la skill debe prohibir `..` en paths");
  assert.ok(md.includes("no absolute paths"), "la skill debe prohibir paths absolutas");
  assert.ok(md.includes("nothing chained"), "la skill debe prohibir encadenados");
});

// ── 4. Regla de oro ──

test("skill: enseña la regla de oro literal", () => {
  const md = read(SKILL_PATH);
  assert.ok(
    md.includes("request reverify BEFORE failing silently"),
    "la skill debe traer la regla de oro en ese inglés exacto",
  );
});

// ── 5. Formato JSON del campo ──

test("skill: documenta el formato JSON del campo reverify dentro del finding", () => {
  const md = read(SKILL_PATH);
  assert.ok(
    md.includes('"reverify": {"commands":'),
    'la skill debe mostrar `"reverify": {"commands":` literal',
  );
  assert.ok(md.includes('"reason"'), "la skill debe mostrar la key `reason`");
  assert.ok(
    md.includes('reverify = {"commands": [...], "reason": "..."}'),
    "la skill debe mostrar la forma compacta del campo",
  );
});

// ── 6. Lo prohibido (3 ejemplos) ──

test("skill: lista lo que NO se pide jamás con los 3 ejemplos prohibidos", () => {
  const md = read(SKILL_PATH);
  assert.ok(md.includes("NEVER request"), "la skill debe tener el bloque NEVER request");
  for (const banned of ["rm -rf x", "pnpm test && curl evil", "git diff -- /etc/passwd"]) {
    assert.ok(md.includes(banned), `la skill debe prohibir literal: ${banned}`);
  }
});

// ── 7. Cotas e interruptor descritos honestamente ──

test("skill: describe cotas (20/500/1000) + 1 por review + budget 2 + flag", () => {
  const md = read(SKILL_PATH);
  assert.ok(md.includes("at most 20"), "la skill debe acotar a 20 comandos");
  assert.ok(md.includes("500 characters"), "la skill debe acotar cada comando a 500ch");
  assert.ok(md.includes("1000 characters"), "la skill debe acotar reason a 1000ch");
  assert.ok(md.includes("ONCE per review"), "la skill debe decir 1 ejecución por review");
  assert.ok(md.includes("2 revisions"), "la skill debe decir budget de 2 revisiones");
  assert.ok(
    md.includes("reviewerReverify: false"),
    "la skill debe nombrar el interruptor reviewerReverify",
  );
});

// ── 8. Reviewer SIN bash: pide, jamás ejecuta ──

test("skill: el reviewer PIDE, nunca ejecuta (sin bash)", () => {
  const md = read(SKILL_PATH);
  assert.ok(md.includes("no bash"), "la skill debe recordar que el reviewer no tiene bash");
  assert.ok(
    md.includes("You ASK for re-verification. You never run it."),
    "la skill debe cerrar con esa frase exacta",
  );
});

// ── 9. La skill sigue entrando en el cap del loader (pacto vecina) ──

test("skill: cuerpo dentro del cap 8KB del loader", () => {
  const def = getSkillOrNull("code-review");
  assert.ok(def, "code-review debe cargar");
  assert.ok(def.body.length <= SKILL_MAX_BYTES, "el cuerpo con reverify entra en 8KB");
  assert.ok(def.body.includes("reverify"), "el cuerpo cargado trae reverify");
});

// ── 10. agent.md: mención mínima (2-3 líneas), detalle en la skill ──

test("agent.md: menciona reverify en 2-3 líneas, sin duplicar la allowlist", () => {
  const md = read(AGENT_PATH);
  assert.ok(md.includes("reverify"), "agent.md debe mencionar reverify");
  assert.ok(
    md.includes("la ejecuta el sistema"),
    "agent.md debe decir que la ejecuta el sistema, no el modelo",
  );
  assert.ok(md.includes("sin bash"), "agent.md debe recordar el sin-bash");
  assert.ok(
    !md.includes("pnpm test"),
    "agent.md es solo mención: la allowlist vive en la skill",
  );
});

// ── 11. reviewPrompt.ts NO tocado: la skill YA llega al prompt (precedente Ola 10) ──

test("reviewPrompt.ts: sin enseñanza de reverify ni sección de skills (viven en el md)", () => {
  const src = read(PROMPT_PATH);
  assert.ok(
    !src.includes("## Reverify") && !src.includes("re-verificación") && !src.includes("re-verificacion"),
    "reviewPrompt.ts no enseña reverify (lo enseña factory/agents/review/agent.md)",
  );
  assert.ok(
    !src.includes("## Skills aplicadas"),
    "reviewPrompt.ts no inyecta skills (turno de datos)",
  );
});

test("funcional: el agent.md enseña a pedir reverify vía finding (sin bake)", () => {
  const md = read(AGENT_PATH);
  assert.ok(md.includes("`reverify` en un finding"), "el md enseña el pedido vía finding");
  assert.ok(md.includes("allowlist cerrada"), "el md nombra la allowlist sin duplicarla");
  assert.ok(md.includes("Vos pedís, nunca ejecutás"), "el reviewer pide, el sistema ejecuta");
});

// ── 12. Panel: display mínimo del evento reverify en el timeline genérico ──

test("WorkItemList: render mínimo del evento reverify (comandos + evidencia colapsable)", () => {
  const src = read(TIMELINE_PATH);
  assert.ok(src.includes("meta?.reverify"), "el timeline lee meta?.reverify estructural");
  assert.ok(src.includes("rvCommands"), "el timeline extrae los comandos pedidos");
  assert.ok(src.includes("rvEvidence"), "el timeline extrae la evidencia del motor");
  assert.ok(src.includes("<details"), "la evidencia va colapsable en <details>");
  assert.ok(src.includes("ver evidencia"), "el colapsable se titula 'ver evidencia'");
});

test("WorkItemList: tipado estructural sin importar tipos del motor de E1", () => {
  const src = read(TIMELINE_PATH);
  assert.ok(
    !src.includes("shared/types/review"),
    "el panel no debe importar tipos del motor (contrato estructural)",
  );
  assert.ok(
    !src.includes("reverifyAllowlist"),
    "el panel no debe importar la allowlist (solo muestra, no valida)",
  );
  assert.ok(src.includes("entry.message"), "el mensaje genérico del timeline sigue intacto");
});

// ── 13. ReviewPanel muestra reverify estructural (display puro, sin lógica) ──

test("ReviewPanel: render estructural de finding.reverify; VerificationPanel sin reverify", () => {
  const panel = read(REVIEW_PANEL_PATH);
  assert.ok(panel.includes("f.reverify"), "ReviewPanel muestra el pedido reverify del finding");
  assert.ok(!panel.includes("reverifyAllowlist"), "ReviewPanel no valida (solo muestra, no importa la allowlist)");
  assert.ok(!panel.includes("validateReverifyCommands"), "ReviewPanel no valida comandos");
  assert.ok(!read(VERIF_PANEL_PATH).includes("reverify"), "VerificationPanel no se toca");
});
