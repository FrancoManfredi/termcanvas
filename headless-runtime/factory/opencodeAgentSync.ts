/**
 * OpencodeAgentSync — puente factory/agents → agentes opencode reales.
 *
 * Un `factory/agents/<name>/agent.md` es la única fuente de verdad. Este
 * módulo la traduce al formato que opencode lee como agente (markdown con
 * frontmatter `description/mode/model/permission` + cuerpo como system
 * prompt) y la materializa en `.opencode/agents/<name>.md` (dir local,
 * gitignored: siempre se regenera, nunca se commitea, nunca hay drift).
 *
 * Mapeo (fail-closed, espejo de toolPolicy):
 * - `tools: {}` (vacío) → `permission` con solo `"*": deny` (solo enruta).
 * - `tools: {read,glob,grep}` → deny-all primero + allow de lectura.
 * - `tools` con escritura (implement) → deny-all primero + allow de sus tools
 *   (`write` se pliega en `edit`: en opencode `edit` cubre write/edit/apply_patch).
 * - `model` solo se emite si tiene forma `provider/model`; un modelo interno
 *   del factory (ej. `auto-disjoint` de REVIEW) se omite y opencode usa su default.
 * - `mode` sale del frontmatter o cae a `subagent`.
 *
 * Reglas del repo que este archivo honra:
 * - ESM puro, funciones puras salvo el sync a disco, nunca lanza (el sync
 *   reporta skips en vez de tirar).
 * - Solo importa `parseAgentFile` + tipos de agentLoader (sin ciclos:
 *   agentLoader no importa este módulo).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgentFile, parseSkillFile, type AgentDef } from "./agentLoader";
import {
  FORBIDDEN_SHELL_PATTERNS,
  PROTECTED_EDIT_PATHS,
  PROTECTED_READ_PATHS,
} from "../../shared/agentGuardrails";

/** Tools de factory conocidas y su equivalente en permission keys de opencode. */
const TOOL_TO_PERMISSION: Readonly<Record<string, string>> = {
  read: "read",
  glob: "glob",
  grep: "grep",
  edit: "edit",
  bash: "bash",
  // En opencode `edit` cubre write/edit/apply_patch: `write` se pliega acá.
  write: "edit",
  // Solo lectura remota (docs externas): sin escritura, con regla
  // anti-inyección en el cuerpo del espejo.
  webfetch: "webfetch",
};

/**
 * Denies canónicos por permission key (fuente: shared/agentGuardrails).
 * Solo se emiten para tools que el agente tiene en allow: sin allow ya rige
 * el `"*": deny` global y el bloque anidado sería ruido.
 */
const PERMISSION_DENIES: Readonly<Record<string, readonly string[]>> = {
  edit: PROTECTED_EDIT_PATHS,
  read: PROTECTED_READ_PATHS,
  bash: FORBIDDEN_SHELL_PATTERNS,
};

/** Escapa un escalar para frontmatter (siempre entrecomillado doble). */
function yamlQuoted(value: string): string {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Lee la lista `skills` del frontmatter factory (`{a, b}` plano, como tools).
 * Solo nombres válidos opencode; resto se ignora. Pura, nunca lanza.
 */
export function parseAgentSkills(raw: unknown): string[] {
  try {
    if (Array.isArray(raw)) {
      return (raw as unknown[])
        .map((t) => String(t ?? "").trim().toLowerCase())
        .filter((t) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(t));
    }
    if (typeof raw !== "string") return [];
    return raw
      .replace(/^\{/, "")
      .replace(/\}$/, "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(t));
  } catch {
    return [];
  }
}

/** True si el modelo tiene forma `provider/model` usable por opencode. */
export function isOpencodeModelRef(model: unknown): model is string {
  try {
    if (typeof model !== "string") return false;
    const t = model.trim();
    if (!t || /\s/.test(t)) return false;
    const i = t.indexOf("/");
    return i > 0 && i < t.length - 1;
  } catch {
    return false;
  }
}

/**
 * Traduce la lista `tools` del frontmatter factory a bloque `permission`
 * opencode. Default-deny primero (`"*": deny`, en opencode la última regla
 * que matchea gana), luego los allows; `edit`/`read`/`bash` salen como mapa
 * anidado (`"*": allow` primero + denies canónicos después, así el deny
 * gana) porque el allow-all plano dejaría secretos, lockfiles y comandos
 * que cuelgan al alcance del agente. Pura, nunca lanza.
 */
export function toolsToPermissionLines(tools: unknown): string[] {
  try {
    const list: string[] = Array.isArray(tools)
      ? (tools as unknown[]).map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean)
      : tools && typeof tools === "object"
        ? Object.keys(tools as Record<string, unknown>).map((t) => t.trim().toLowerCase()).filter(Boolean)
        : [];
    const lines: string[] = [`  "*": deny`];
    const seen = new Set<string>();
    for (const tool of list) {
      const perm = TOOL_TO_PERMISSION[tool];
      if (!perm || seen.has(perm)) continue;
      seen.add(perm);
      const denies = PERMISSION_DENIES[perm];
      if (!denies || denies.length === 0) {
        lines.push(`  ${perm}: allow`);
        continue;
      }
      lines.push(`  ${perm}:`);
      lines.push(`    "*": allow`);
      for (const pattern of denies) {
        lines.push(`    "${pattern}": deny`);
      }
    }
    return lines;
  } catch {
    return [`  "*": deny`];
  }
}

/**
 * Construye el markdown de agente opencode desde una definición factory.
 * Pura, nunca lanza (ante def inválida devuelve string vacío).
 */
export function buildOpencodeAgentMarkdown(def: AgentDef): string {
  try {
    if (!def || typeof def !== "object") return "";
    const fm = (def.frontmatter ?? {}) as Record<string, unknown>;
    const description = String(fm.description ?? "").trim();
    const body = String((def as { body?: unknown }).body ?? "").trim();
    if (!description || !body) return "";
    const mode = typeof fm.mode === "string" && fm.mode.trim() ? fm.mode.trim() : "subagent";
    const lines = [
      "---",
      `description: ${yamlQuoted(description)}`,
      `mode: ${mode}`,
    ];
    if (isOpencodeModelRef(fm.model)) lines.push(`model: ${String(fm.model).trim()}`);
    lines.push("permission:");
    lines.push(...toolsToPermissionLines(fm.tools));
    // Skills on-demand (nativas opencode): deny-first + allows explícitos.
    // Sin lista no se emite el mapa (el deny top-level ya niega la tool).
    const skills = parseAgentSkills(fm.skills);
    if (skills.length > 0) {
      lines.push("  skill:");
      lines.push(`    "*": deny`);
      const seen = new Set<string>();
      for (const name of skills) {
        if (seen.has(name)) continue;
        seen.add(name);
        lines.push(`    "${name}": allow`);
      }
    }
    // Los agentes factory no delegan en subagentes (compone el orquestador):
    // Task denegado en todos los espejos. El flujo headless no usa Task
    // (va por session API directa), así que esto solo afecta el uso
    // interactivo.
    lines.push("  task:");
    lines.push(`    "*": deny`);
    lines.push("---");
    lines.push(`<!-- Generado desde factory/agents/${def.name}/agent.md — no editar a mano (se pisa con sync:agents). -->`);
    lines.push(body);
    return lines.join("\n") + "\n";
  } catch {
    return "";
  }
}

/** Raíz del repo (mismo patrón que agentLoader, sin importarlo por la raíz). */
function getRepoRoot(): string {
  try {
    const current = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(current), "../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {
    // sigue a fallback por cwd
  }
  try {
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, "package.json"))) return cwd;
  } catch {
    // sigue a cwd directo
  }
  return process.cwd();
}

/** Ruta del espejo opencode para un agente (`<root>/.opencode/agents/<name>.md`). */
export function resolveOpencodeAgentPath(name: string, repoRoot?: string): string {
  const clean = String(name ?? "").trim() || "unknown";
  const root = repoRoot && repoRoot.trim() ? repoRoot.trim() : getRepoRoot();
  return path.join(root, ".opencode", "agents", `${clean}.md`);
}

/**
 * Directorio global de agentes opencode (`~/.config/opencode/agents/`):
 * lo que vive acá vale para TODOS los proyectos/sesiones. Puro, nunca lanza.
 */
export function resolveGlobalAgentsDir(homeDir?: string): string {
  try {
    const home =
      homeDir && homeDir.trim()
        ? homeDir.trim()
        : (process.env.USERPROFILE || process.env.HOME || (typeof os.homedir === "function" ? os.homedir() : "")).trim();
    return path.join(home || process.cwd(), ".config", "opencode", "agents");
  } catch {
    return path.join(process.cwd(), ".config", "opencode", "agents");
  }
}

export interface OpencodeAgentSyncReport {
  dir: string;
  written: string[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Regenera `.opencode/agents/*.md` desde `factory/agents/*\/agent.md`.
 * Descubre agentes por directorio (igual que definitionValidate): un agente
 * nuevo solo necesita su carpeta + agent.md válido. Nunca lanza: los fallos
 * van a `skipped`.
 *
 * `outDir` opcional redirige la salida (tests y sync global); por defecto el
 * `.opencode/agents/` del proyecto.
 */
export function syncFactoryAgentsToOpencode(repoRoot?: string, outDir?: string): OpencodeAgentSyncReport {
  const report: OpencodeAgentSyncReport = { dir: "", written: [], skipped: [] };
  try {
    const root = repoRoot && repoRoot.trim() ? repoRoot.trim() : getRepoRoot();
    const agentsDir = path.join(root, "factory", "agents");
    const outDirResolved = outDir && outDir.trim() ? outDir.trim() : path.join(root, ".opencode", "agents");
    report.dir = outDirResolved;
    let entries: string[];
    try {
      entries = fs.readdirSync(agentsDir).slice().sort();
    } catch {
      report.skipped.push({ name: "*", reason: "no se pudo leer factory/agents/" });
      return report;
    }
    // Solo se crea el dir de salida si hay al menos un agente válido.
    const pending: Array<{ name: string; text: string }> = [];
    for (const name of entries) {
      try {
        const stat = fs.statSync(path.join(agentsDir, name));
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      // Lectura directa + parseAgentFile (misma validación que loadAgentDef,
      // con anti-traversal idéntico): funciona para el root real y para roots
      // alternos (tests) sin acoplar la resolución de rutas de otro módulo.
      let def: AgentDef | null = null;
      try {
        if (!/^[a-z0-9-]+$/i.test(name)) throw new Error("nombre inválido");
        const text = fs.readFileSync(path.join(agentsDir, name, "agent.md"), "utf-8");
        const parsed = parseAgentFile(text);
        def = { name, frontmatter: parsed.frontmatter, body: parsed.body };
      } catch {
        def = null;
      }
      if (!def) {
        report.skipped.push({ name, reason: "agent.md faltante o inválido" });
        continue;
      }
      const text = buildOpencodeAgentMarkdown(def);
      if (!text) {
        report.skipped.push({ name, reason: "definición sin description o body" });
        continue;
      }
      pending.push({ name, text });
    }
    if (pending.length === 0) return report;
    try {
      fs.mkdirSync(outDirResolved, { recursive: true });
    } catch {
      report.skipped.push({ name: "*", reason: `no se pudo crear ${outDirResolved}` });
      return report;
    }
    for (const { name, text } of pending) {
      try {
        fs.writeFileSync(path.join(outDirResolved, `${name}.md`), text, "utf-8");
        report.written.push(name);
      } catch {
        report.skipped.push({ name, reason: "no se pudo escribir el espejo" });
      }
    }
    return report;
  } catch {
    return report;
  }
}

/**
 * Variante global: espejos en `~/.config/opencode/agents/` (valen para TODOS
 * los proyectos/sesiones). Misma fuente, mismo mapeo, nunca lanza.
 */
export function syncFactoryAgentsGlobal(repoRoot?: string, homeDir?: string): OpencodeAgentSyncReport {
  try {
    return syncFactoryAgentsToOpencode(repoRoot, resolveGlobalAgentsDir(homeDir));
  } catch {
    return { dir: "", written: [], skipped: [{ name: "*", reason: "fallo global inesperado" }] };
  }
}

export interface OpencodeSkillSyncReport {
  dir: string;
  written: string[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Espeja `factory/skills/<name>/SKILL.md` a un dir de skills opencode
 * (`<outDir>/<name>/SKILL.md`). El formato factory YA es SKILL.md válido
 * (frontmatter name+description): el espejo es copia verbatim.
 * Reglas: el nombre debe coincidir con el directorio (lo exige opencode);
 * jamás pisa un SKILL.md existente con otro contenido (no se destruyen
 * skills ajenas). Nunca lanza: los fallos van a `skipped`.
 */
export function syncFactorySkillsToOpencode(repoRoot?: string, outDir?: string): OpencodeSkillSyncReport {
  const report: OpencodeSkillSyncReport = { dir: "", written: [], skipped: [] };
  try {
    const root = repoRoot && repoRoot.trim() ? repoRoot.trim() : getRepoRoot();
    const skillsDir = path.join(root, "factory", "skills");
    const target =
      outDir && outDir.trim() ? outDir.trim() : path.join(root, ".opencode", "skills");
    report.dir = target;
    let entries: string[];
    try {
      entries = fs.readdirSync(skillsDir).slice().sort();
    } catch {
      report.skipped.push({ name: "*", reason: "no se pudo leer factory/skills/" });
      return report;
    }
    const pending: Array<{ name: string; text: string }> = [];
    for (const name of entries) {
      try {
        if (!/^[a-z0-9-]+$/i.test(name)) continue;
        const stat = fs.statSync(path.join(skillsDir, name));
        if (!stat.isDirectory()) continue;
        const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf-8");
        const parsed = parseSkillFile(text);
        if (parsed.frontmatter.name !== name) {
          report.skipped.push({ name, reason: `frontmatter name "${parsed.frontmatter.name}" ≠ directorio` });
          continue;
        }
        pending.push({ name, text });
      } catch {
        report.skipped.push({ name, reason: "SKILL.md faltante o inválido" });
      }
    }
    if (pending.length === 0) return report;
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch {
      report.skipped.push({ name: "*", reason: `no se pudo crear ${target}` });
      return report;
    }
    for (const { name, text } of pending) {
      try {
        const destDir = path.join(target, name);
        const dest = path.join(destDir, "SKILL.md");
        let existing: string | null = null;
        try {
          existing = fs.readFileSync(dest, "utf-8");
        } catch {
          existing = null;
        }
        if (existing !== null && existing !== text) {
          report.skipped.push({ name, reason: "existe con otro contenido (no se pisa)" });
          continue;
        }
        if (existing === text) {
          report.skipped.push({ name, reason: "ya sincronizado" });
          continue;
        }
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(dest, text, "utf-8");
        report.written.push(name);
      } catch {
        report.skipped.push({ name, reason: "no se pudo escribir el espejo" });
      }
    }
    return report;
  } catch {
    return report;
  }
}

/**
 * Variante global: espejos en `~/.config/opencode/skills/` (los ven todos
 * los servers de la máquina). Nunca lanza.
 */
export function syncFactorySkillsGlobal(repoRoot?: string, homeDir?: string): OpencodeSkillSyncReport {
  try {
    return syncFactorySkillsToOpencode(repoRoot, resolveGlobalSkillsDir(homeDir));
  } catch {
    return { dir: "", written: [], skipped: [{ name: "*", reason: "fallo global inesperado" }] };
  }
}

/** Dir global de skills derivado del de agentes (`~/.config/opencode/skills`). */
export function resolveGlobalSkillsDir(homeDir?: string): string {
  try {
    return path.join(resolveGlobalAgentsDir(homeDir), "..", "skills");
  } catch {
    return path.join(process.cwd(), ".config", "opencode", "skills");
  }
}

export interface MirrorCheckReport {
  ok: boolean;
  diffs: string[];
}

/** Lee texto o null (nunca lanza). */
function readTextOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Nombres de subdirectorios (nunca lanza; [] ante fallo). */
function childDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Definiciones factory esperadas (nombre → espejo), o null ante raíz rota.
 * Acepta layout repo-root (`factory/agents/`, canónico) y layout sandbox
 * (`agents/` directo, el que usan los seams de tests): el canónico manda.
 */
function expectedAgentMirrors(repoRoot: string): Map<string, string> | null {
  const defs = new Map<string, string>();
  let agentsDir = path.join(repoRoot, "factory", "agents");
  try {
    fs.readdirSync(agentsDir);
  } catch {
    try {
      agentsDir = path.join(repoRoot, "agents");
      fs.readdirSync(agentsDir);
    } catch {
      return null;
    }
  }
  for (const name of childDirs(agentsDir)) {
    try {
      if (!/^[a-z0-9-]+$/i.test(name)) continue;
      const parsed = parseAgentFile(
        fs.readFileSync(path.join(agentsDir, name, "agent.md"), "utf-8"),
      );
      const text = buildOpencodeAgentMarkdown({ name, frontmatter: parsed.frontmatter, body: parsed.body });
      if (text) defs.set(name, text);
    } catch {
      // def inválida: el validator la reporta; el check solo compara espejos
    }
  }
  return defs;
}

/** Compara definiciones esperadas contra un dir de espejos (falta/difiere/huérfano). */
function diffMirrorsAgainst(defs: Map<string, string>, agentsDir: string, hint: string): string[] {
  const diffs: string[] = [];
  try {
    const onDiskAgents = new Set<string>();
    try {
      for (const f of fs.readdirSync(agentsDir)) {
        if (f.endsWith(".md")) onDiskAgents.add(f.slice(0, -3));
      }
    } catch {
      // sin dir = todos faltan (se reporta abajo)
    }
    for (const [name, expected] of defs) {
      const actual = readTextOrNull(path.join(agentsDir, `${name}.md`));
      if (actual === null) diffs.push(`agents/${name}.md: falta (${hint})`);
      else if (actual !== expected) diffs.push(`agents/${name}.md: difiere (${hint})`);
    }
    for (const name of onDiskAgents) {
      if (!defs.has(name)) diffs.push(`agents/${name}.md: huérfano (sin agent.md en factory/)`);
    }
  } catch {
    // nunca lanza
  }
  return diffs;
}

/**
 * Verifica que los espejos commiteados (`.opencode/agents|skills`) estén en
 * sync con `factory/` (para `sync:agents --check` / CI): regenera en memoria
 * y compara, sin escribir nada. Detecta faltantes, diferencias y huérfanos.
 * Nunca lanza.
 */
export function checkFactoryMirrorsInSync(repoRoot?: string): MirrorCheckReport {
  const diffs: string[] = [];
  try {
    const root = repoRoot && repoRoot.trim() ? repoRoot.trim() : getRepoRoot();
    // Agentes (raíz ilegible = diff: un typo de root no debe pasar en verde).
    const defs = expectedAgentMirrors(root);
    if (defs === null) {
      return { ok: false, diffs: ["no se pudo leer factory/agents/"] };
    }
    diffs.push(...diffMirrorsAgainst(defs, path.join(root, ".opencode", "agents"), "correr sync:agents"));
    // Skills (espejo verbatim).
    const skillSrc = new Map<string, string>();
    for (const name of childDirs(path.join(root, "factory", "skills"))) {
      try {
        const text = fs.readFileSync(path.join(root, "factory", "skills", name, "SKILL.md"), "utf-8");
        const parsed = parseSkillFile(text);
        if (parsed.frontmatter.name !== name) continue;
        skillSrc.set(name, text);
      } catch {
        // skill inválida: el validator la reporta; el check solo compara
      }
    }
    const skillsDir = path.join(root, ".opencode", "skills");
    const onDiskSkills = new Set<string>();
    for (const name of childDirs(skillsDir)) {
      try {
        if (fs.existsSync(path.join(skillsDir, name, "SKILL.md"))) onDiskSkills.add(name);
      } catch {
        // noop
      }
    }
    for (const [name, expected] of skillSrc) {
      const actual = readTextOrNull(path.join(skillsDir, name, "SKILL.md"));
      if (actual === null) diffs.push(`skills/${name}/SKILL.md: falta (correr sync:agents)`);
      else if (actual !== expected) diffs.push(`skills/${name}/SKILL.md: difiere (correr sync:agents)`);
    }
    for (const name of onDiskSkills) {
      if (!skillSrc.has(name)) diffs.push(`skills/${name}/SKILL.md: huérfano (sin skill en factory/)`);
    }
    return { ok: diffs.length === 0, diffs };
  } catch {
    return { ok: false, diffs: ["fallo inesperado del check"] };
  }
}

/**
 * Verifica que los espejos GLOBALES (`~/.config/opencode/agents/`, los que
 * realmente sirven las sesiones de jobs en worktrees sin `.opencode`
 * propio) estén en sync con `factory/`. Sin escribir nada. El drift global
 * es el que sirvió instrucciones viejas (caso punto-12): este check lo
 * hace visible. Nunca lanza.
 */
export function checkFactoryGlobalMirrorsInSync(repoRoot?: string, homeDir?: string): MirrorCheckReport {
  try {
    const root = repoRoot && repoRoot.trim() ? repoRoot.trim() : getRepoRoot();
    const defs = expectedAgentMirrors(root);
    if (defs === null) {
      return { ok: false, diffs: ["no se pudo leer factory/agents/"] };
    }
    const diffs = diffMirrorsAgainst(defs, resolveGlobalAgentsDir(homeDir), "correr sync:agents --global");
    return { ok: diffs.length === 0, diffs };
  } catch {
    return { ok: false, diffs: ["fallo inesperado del check global"] };
  }
}

/**
 * Agentes que cada server confirmó conocer (memo por URL de server: un server
 * no pierde agentes sin reiniciar, y al reiniciar cambia de puerto — salvo el
 * personal, donde lo peor que pasa es un turno completo de más). Solo se
 * memoizan positivos: el negativo se rechequea (auto-detecta un sync nuevo).
 */
const serverAgentsMemo = new Map<string, Set<string>>();

/** Limpia el memo de agentes por server (solo tests). Nunca lanza. */
export function resetServerAgentsMemoForTests(): void {
  try {
    serverAgentsMemo.clear();
  } catch {
    // noop
  }
}

/**
 * True si el server confirma conocer al agente (`app.agents()` del SDK).
 * Es la ÚNICA señal válida para adelgazar un turno: el espejo en disco dice
 * lo que generamos, el server dice lo que puede ejecutar. Nunca lanza
 * (cualquier fallo → false → turno completo, siempre seguro).
 */
export async function serverKnowsAgent(
  clientLike: unknown,
  serverKey: string | undefined,
  name: string,
): Promise<boolean> {
  try {
    const agentName = String(name ?? "").trim();
    const key = String(serverKey ?? "").trim();
    if (!agentName) return false;
    // Sin key no hay memo (chequeo vivo por turno, barato y auto-detecta syncs).
    const known = key ? serverAgentsMemo.get(key) : undefined;
    if (known && known.has(agentName)) return true;
    const app = (clientLike as Record<string, unknown> | null | undefined)?.app as
      | Record<string, unknown>
      | null
      | undefined;
    const listFn = app?.agents;
    if (typeof listFn !== "function") return false;
    const res: unknown = await (listFn as () => Promise<unknown>).call(app);
    const arr = Array.isArray(res)
      ? res
      : res !== null && typeof res === "object" && Array.isArray((res as Record<string, unknown>).data)
        ? ((res as Record<string, unknown>).data as unknown[])
        : null;
    if (!arr) return false;
    const names = new Set<string>();
    for (const entry of arr) {
      if (typeof entry === "string" && entry.trim()) names.add(entry.trim());
      else if (entry && typeof entry === "object") {
        const n = (entry as Record<string, unknown>).name;
        if (typeof n === "string" && n.trim()) names.add(n.trim());
      }
    }
    if (names.has(agentName)) {
      try {
        if (key) {
          const prev = serverAgentsMemo.get(key) ?? new Set<string>();
          prev.add(agentName);
          if (serverAgentsMemo.size > 8) {
            const oldest = serverAgentsMemo.keys().next();
            if (!oldest.done) serverAgentsMemo.delete(oldest.value);
          }
          serverAgentsMemo.set(key, prev);
        }
      } catch {
        // noop: el memo nunca rompe el check
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * True si el espejo opencode del agente existe en disco (o sea: el server que
 * sirve ese root puede resolver su identidad). `repoRoot` opcional para tests.
 * Nunca lanza.
 */
export function mirrorExists(name: string, repoRoot?: string): boolean {
  try {
    if (typeof name !== "string" || !/^[a-z0-9-]+$/i.test(name.trim())) return false;
    return fs.existsSync(resolveOpencodeAgentPath(name.trim(), repoRoot));
  } catch {
    return false;
  }
}

/**
 * Fragmento de identidad para `session.create` y `session.prompt`:
 * `{ agent: name }` cuando el espejo existe en disco, `{}` cuando no (el
 * payload queda byte-idéntico al actual). Nunca lanza.
 *
 * Dos niveles (evidencia viva E2/E3): el `agent` del create SOLO etiqueta la
 * sesión; el que decide QUIÉN EJECUTA el turno es el `agent` del body del
 * prompt. Sin espejo no se manda nada en ningún nivel.
 *
 * Uso en cada fase: `create({ title, directory, ...sessionAgentArgs("triage") })`
 * y `body = { model, tools, ...sessionAgentArgs("triage"), parts }`.
 */
export function sessionAgentArgs(name: string): { agent: string } | Record<string, never> {
  try {
    if (mirrorExists(name)) return { agent: name.trim() };
  } catch {
    // cae a vacío
  }
  return {};
}
