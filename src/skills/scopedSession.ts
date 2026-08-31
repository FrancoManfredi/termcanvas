// Capa 2: sesiones scopeadas por skills (mecánica opencode).
//
// Dada una allowlist de nombres de skills, materializa un directorio efímero
// dentro del repo (<repo>/.agents/planning/.scope-<runId>) con:
//
//   .scope-<runId>/
//     diag-seguridad/SKILL.md        ← contenido del registro (Capa 1)
//     <vendor-name>/SKILL.md         ← skills del usuario (vendorSkills.ts)
//     opencode-scope.json            ← config con paths + permission.skill
//
// y devuelve el env { OPENCODE_CONFIG } que el runtime inyecta SOLO en el
// proceso de esa sesión (Capa 3). opencode resuelve la config, descubre las
// skills del path y FILTRA por permisos: las que evalúan "deny" desaparecen
// del <available_skills> Y no pueden invocarse (packages/core/src/skill.ts,
// available()). Resultado garantizado por construcción: la sesión ve
// exactamente la allowlist — ni skills de otras categorías, ni globales.
//
// El caller es dueño del ciclo de vida: release() en destroyRuntime (éxito,
// error, cancel o timeout). runId único evita colisiones entre corridas
// paralelas; un release perdido deja solo basura pequeña y aislada.
//
// Las funciones puras (renderSkillMd / buildSkillScopeConfig) son testeables
// sin window; prepareSkillScope es el único punto con IO (bridge fs).

import type { SpecializedSkill } from "./registry.ts";
import { getSpecializedSkill } from "./registry.ts";
import type { VendorSkill } from "./vendorSkills.ts";

export const OPENCODE_CONFIG_ENV = "OPENCODE_CONFIG";

const SCOPE_DIR_PREFIX = ".scope-";

export function renderSkillMd(skill: SpecializedSkill): string {
  return [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description.replace(/\s+/g, " ")}`,
    "---",
    "",
    skill.body,
    "",
  ].join("\n");
}

export interface SkillScopeConfig {
  $schema?: string;
  skills: { paths: string[] };
  permission: {
    skill: Record<string, "allow" | "deny" | "ask">;
  };
}

// Config scopeada: deny-all + allows explícitos. Los nombres sin skill en el
// registro (ej: delivery skills globales como tdd/branch-pr) NO se escriben a
// disco pero SÍ van al allowlist — opencode simplemente no anuncia las que no
// descubre, así que un nombre inexistente es inocuo.
export function buildSkillScopeConfig(scopeDir: string, allow: string[]): SkillScopeConfig {
  const permission: SkillScopeConfig["permission"]["skill"] = { "*": "deny" };
  for (const name of allow) {
    if (!name || name === "*") continue;
    permission[name] = "allow";
  }
  return {
    skills: { paths: [scopeDir] },
    permission: { skill: permission },
  };
}

export interface LaunchScope {
  // Env a inyectar en el spawn del terminal de esta sesión.
  env: Record<string, string>;
  // Borra el dir efímero. Idempotente y best-effort: nunca lanza.
  release: () => Promise<void>;
}

function fsBridge(): typeof window.termcanvas.fs | null {
  return typeof window !== "undefined" && window.termcanvas?.fs
    ? window.termcanvas.fs
    : null;
}

// Los scopes de sesiones TUI interactivas (resolución de issues) NO tienen
// release automático: el tile puede respawnear el CLI (resume -s) y necesita
// su config viva. En su lugar, cada prepareSkillScope barre scopes con más
// de SCOPE_STALE_MS: la basura queda acotada sin acoplar ciclos de vida.
const SCOPE_STALE_MS = 24 * 60 * 60 * 1000;

async function sweepStaleScopes(fs: typeof window.termcanvas.fs, planningDir: string): Promise<void> {
  try {
    const entries = await fs.listDir(planningDir);
    const cutoff = Date.now() - SCOPE_STALE_MS;
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const match = new RegExp(`^${SCOPE_DIR_PREFIX}(\\d+)-`).exec(entry.name);
      if (!match) continue;
      if (Number(match[1]) >= cutoff) continue;
      await fs.delete(`${planningDir}/${entry.name}`);
    }
  } catch {
    // Sweep best-effort: si falla, los dirs quedan para el próximo sweep.
  }
}

/**
 * Prepara el scope efímero para una sesión. Devuelve null cuando no hay
 * nada que scopear (allowlist vacía) o cuando el bridge fs no está
 * disponible (tests, contextos no-Electron): el caller lanza la sesión
 * SIN scoping, igual que antes de este feature.
 */
export async function prepareSkillScope(options: {
  repoPath: string;
  allow: string[];
  // Skills vendor descubiertas para la categoría (vendorSkills.ts): se
  // escriben crudas al scope y sus nombres entran al allowlist junto a los
  // de la lista base. Ya vienen validadas y sin colisiones entre sí; un
  // nombre que choque con uno base (ej. diag-*) NO pisa al base.
  vendorSkills?: VendorSkill[];
}): Promise<LaunchScope | null> {
  const allow = options.allow.filter((name) => name && name !== "*");
  const vendorSkills = (options.vendorSkills ?? []).filter(
    (skill) => !allow.includes(skill.name),
  );
  if (allow.length === 0 && vendorSkills.length === 0) return null;
  const fs = fsBridge();
  if (!fs) return null;

  const repoRoot = options.repoPath.replace(/[\\/]+$/, "");
  const planningDir = `${repoRoot}/.agents/planning`;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scopeDir = `${planningDir}/${SCOPE_DIR_PREFIX}${runId}`;

  await sweepStaleScopes(fs, planningDir);

  // mkdir del bridge es single-level con recursive:true: cada nivel crea
  // toda su cadena padre faltante, así que tres llamadas cubren cualquier
  // estado previo (.agents inexistente incluido).
  await fs.mkdir(repoRoot, ".agents");
  await fs.mkdir(`${repoRoot}/.agents`, "planning");
  await fs.mkdir(planningDir, `${SCOPE_DIR_PREFIX}${runId}`);

  for (const name of allow) {
    const skill = getSpecializedSkill(name);
    if (!skill) continue;
    await fs.mkdir(scopeDir, skill.name);
    await fs.writeFile(
      `${scopeDir}/${skill.name}/SKILL.md`,
      renderSkillMd(skill),
    );
  }

  // Vendor: el SKILL.md viaja TAL CUAL (frontmatter incluido) — es material
  // del usuario, no lo re-renderizamos.
  for (const skill of vendorSkills) {
    await fs.mkdir(scopeDir, skill.name);
    await fs.writeFile(`${scopeDir}/${skill.name}/SKILL.md`, skill.raw);
  }

  const configPath = `${scopeDir}/opencode-scope.json`;
  await fs.writeFile(
    configPath,
    JSON.stringify(
      buildSkillScopeConfig(scopeDir, [
        ...allow,
        ...vendorSkills.map((skill) => skill.name),
      ]),
      null,
      2,
    ),
  );

  return {
    env: { [OPENCODE_CONFIG_ENV]: configPath },
    release: async () => {
      try {
        await fs.delete(scopeDir);
      } catch {
        // Best-effort: un release fallido deja basura aislada con runId
        // único; nunca rompe el flujo del caller.
      }
    },
  };
}
