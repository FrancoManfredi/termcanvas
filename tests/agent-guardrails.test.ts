/**
 * AgentGuardrails — listas canónicas de deny para los 5 agentes factory.
 * Enforcement a nivel servidor (deny bloquea sin preguntar, cero humano),
 * nunca solo-prompt. Todo offline y puro.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FORBIDDEN_SHELL_PATTERNS,
  PROTECTED_EDIT_PATHS,
  PROTECTED_READ_PATHS,
  daemonGuardrailPermission,
} from "../shared/agentGuardrails.ts";

function assertSaneList(list: readonly string[], name: string): void {
  assert.ok(list.length > 0, `${name} no vacía`);
  const seen = new Set<string>();
  for (const p of list) {
    assert.equal(typeof p, "string", `${name}: todo patrón es string`);
    assert.ok(p.trim().length > 0, `${name}: sin patrones vacíos`);
    assert.ok(!p.includes("\0") && !p.includes("\n"), `${name}: patrón limpio ${p}`);
    assert.ok(!seen.has(p), `${name}: sin duplicados (${p})`);
    seen.add(p);
  }
}

test("listas canónicas sanas (no vacías, sin duplicados, patrones limpios)", () => {
  assertSaneList(PROTECTED_EDIT_PATHS, "PROTECTED_EDIT_PATHS");
  assertSaneList(PROTECTED_READ_PATHS, "PROTECTED_READ_PATHS");
  assertSaneList(FORBIDDEN_SHELL_PATTERNS, "FORBIDDEN_SHELL_PATTERNS");
});

test("edit cubre secretos + lockfiles + estado del orquestador", () => {
  for (const p of [".env", ".env.*", "*.pem", "*.key", "pnpm-lock.yaml", "package-lock.json"]) {
    assert.ok((PROTECTED_EDIT_PATHS as readonly string[]).includes(p), `edit deniega ${p}`);
  }
  for (const p of ["node_modules/**", ".git/**", ".agents/factory/**", "logs/**", "**/result.json"]) {
    assert.ok((PROTECTED_EDIT_PATHS as readonly string[]).includes(p), `edit deniega ${p}`);
  }
});

test("read deniega solo secretos (lockfiles/dist legibles para contexto)", () => {
  for (const p of [".env", "*.pem", "*.key"]) {
    assert.ok((PROTECTED_READ_PATHS as readonly string[]).includes(p), `read deniega ${p}`);
  }
  assert.ok(!(PROTECTED_READ_PATHS as readonly string[]).includes("pnpm-lock.yaml"), "lockfiles legibles");
});

test("bash deniega cuelgues, no builds normales", () => {
  for (const p of ["*--watch*", "*tail -f*", "npm run dev*", "pnpm dev*"]) {
    assert.ok((FORBIDDEN_SHELL_PATTERNS as readonly string[]).includes(p), `bash deniega ${p}`);
  }
  for (const cmd of ["pnpm test", "pnpm build", "git status --porcelain", "npx tsc --noEmit"]) {
    const hit = (FORBIDDEN_SHELL_PATTERNS as readonly string[]).some((pat) => {
      const re = new RegExp(`^${pat.replace(/\*/g, ".*")}$`);
      return re.test(cmd);
    });
    assert.equal(hit, false, `comando sano no matchea denies: ${cmd}`);
  }
});

test("daemonGuardrailPermission: granular con allow primero y denies después", () => {
  const perm = daemonGuardrailPermission() as Record<string, unknown>;
  for (const key of ["edit", "read", "bash"]) {
    const block = perm[key] as Record<string, string>;
    assert.equal(block["*"], "allow", `${key}: allow base`);
    const keys = Object.keys(block);
    assert.ok(keys.length > 1, `${key}: con denies`);
    assert.equal(keys[0], "*", `${key}: el allow va primero (gana la última)`);
    for (const k of keys.slice(1)) assert.equal(block[k], "deny", `${key}/${k} es deny`);
  }
  assert.equal(perm.glob, "allow");
  assert.equal(perm.grep, "allow");
  assert.equal(perm.webfetch, "allow");
  assert.equal(perm.external_directory, "allow");
  assert.ok(!("ask" in perm) && !Object.values(perm).includes("ask"), "cero ask: deny no interrumpe");
});

test("read-denies son subconjunto de edit-denies (todo secreto ilegible es intocable)", () => {
  const edit = new Set(PROTECTED_EDIT_PATHS as readonly string[]);
  for (const p of PROTECTED_READ_PATHS) {
    assert.ok(edit.has(p), `${p} denegado en ambos`);
  }
});
