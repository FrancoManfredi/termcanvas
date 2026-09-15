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
import { parseAgentFile, parseSkillFile, loadAgentDef, type AgentDef } from "./agentLoader";
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
  list: "list",
  edit: "edit",
  bash: "bash",
  // Solo lectura remota (docs externas): sin escritura, con regla
  // anti-inyección en el cuerpo del espejo.
  webfetch: "webfetch",
  websearch: "websearch",
  todowrite: "todowrite",
  lsp: "lsp",
  // LEGACY: en opencode `edit` cubre write/edit/apply_patch. El frontmatter
  // viejo con `write` sigue aceptado y se pliega acá (la UI ya no lo ofrece).
  write: "edit",
  // `task`, `skill` y `question` ni siquiera entran: los agentes factory no
  // delegan (compone el orquestador), `skill` se otorga con la allowlist de
  // skills y `question` no tiene quién responda en un job automático.
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
 * Modelo `provider/model` del agente para mandar en el payload del turno
 * (fix: el modelo del foreman que el usuario configura se ignoraba en el
 * routing y en los nodos sin pin). Nombres internos del factory
 * (`auto-disjoint`, inválidos, ausentes) devuelven null: el llamador cae al
 * default del workflow/yaml o al de opencode. Lee disco fresco (nunca
 * memoiza): el payload sale siempre con el agente actual. Nunca lanza.
 */
export function resolveAgentModel(name: unknown): string | null {
  try {
    const clean = typeof name === "string" ? name.trim() : "";
    if (!clean || !/^[a-z0-9-]+$/i.test(clean)) return null;
    const def = loadAgentDef(clean);
    if (!def) return null;
    const model = String((def.frontmatter as Record<string, unknown>)?.model ?? "").trim();
    return isOpencodeModelRef(model) ? model : null;
  } catch {
    return null;
  }
}


/**
 * Versión OBJETO del mapeo de permisos (la que viaja inline en el config del
 * server efímero: `permission` de opencode acepta un mapa). Default-deny,
 * allows después, edit/read/bash anidados con denies canónicos. Pura.
 */
type PermissionRule =
  | "ask"
  | "allow"
  | "deny"
  | Record<string, "ask" | "allow" | "deny">;

export function toolsToPermissionConfig(
  tools: unknown,
): Record<string, PermissionRule> {
  try {
    const list: string[] = Array.isArray(tools)
      ? (tools as unknown[]).map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean)
      : tools && typeof tools === "object"
        ? Object.keys(tools as Record<string, unknown>).map((t) => t.trim().toLowerCase()).filter(Boolean)
        : [];
    const config: Record<string, PermissionRule> = { "*": "deny" };
    const seen = new Set<string>();
    for (const tool of list) {
      const perm = TOOL_TO_PERMISSION[tool];
      if (!perm || seen.has(perm)) continue;
      seen.add(perm);
      const denies = PERMISSION_DENIES[perm];
      if (!denies || denies.length === 0) {
        config[perm] = "allow";
        continue;
      }
      const nested: Record<string, "ask" | "allow" | "deny"> = { "*": "allow" };
      for (const pattern of denies) nested[pattern] = "deny";
      config[perm] = nested;
    }
    return config;
  } catch {
    return { "*": "deny" };
  }
}

/**
 * Agente opencode INLINE para el config del server efímero de TermCanvas
 * (`Config.agent`): nunca se escribe a disco, así el opencode del usuario no
 * lo ve. `mode` default `primary` (los agentes de factory son primarios).
 * Pura, nunca lanza (def inválida → null).
 */
export function buildOpencodeAgentConfig(
  def: AgentDef,
): Record<string, unknown> | null {
  try {
    if (!def || typeof def !== "object") return null;
    const fm = (def.frontmatter ?? {}) as Record<string, unknown>;
    const description = String(fm.description ?? "").trim();
    const body = String((def as { body?: unknown }).body ?? "").trim();
    if (!description || !body) return null;
    const rawMode = typeof fm.mode === "string" ? fm.mode.trim() : "";
    const mode =
      rawMode === "primary" || rawMode === "subagent" || rawMode === "all"
        ? rawMode
        : "primary";
    const permission = toolsToPermissionConfig(fm.tools);
    const skills = parseAgentSkills(fm.skills);
    if (skills.length > 0) {
      const skill: Record<string, "ask" | "allow" | "deny"> = { "*": "deny" };
      const seen = new Set<string>();
      for (const name of skills) {
        if (seen.has(name)) continue;
        seen.add(name);
        skill[name] = "allow";
      }
      permission.skill = skill;
    }
    // Los agentes factory no delegan en subagentes (compone el orquestador).
    permission.task = { "*": "deny" };
    const out: Record<string, unknown> = {
      description,
      mode,
      prompt: body,
      permission,
    };
    if (isOpencodeModelRef(fm.model)) out.model = String(fm.model).trim();
    return out;
  } catch {
    return null;
  }
}

/**
 * Mapa `agent` completo para inyectar en el config del server efímero
 * (`buildFactoryAgentsConfig()` → `Config.agent`). Lee `factory/agents/*`
 * como fuente de verdad; NUNCA escribe. Nunca lanza.
 */
export function buildFactoryAgentsConfig(
  repoRoot?: string,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  try {
    const root = repoRoot && repoRoot.trim() ? repoRoot.trim() : getRepoRoot();
    const agentsDir = path.join(root, "factory", "agents");
    const entries = fs.readdirSync(agentsDir).slice().sort();
    for (const name of entries) {
      try {
        if (!/^[a-z0-9-]+$/i.test(name)) continue;
        if (!fs.statSync(path.join(agentsDir, name)).isDirectory()) continue;
        const text = fs.readFileSync(path.join(agentsDir, name, "agent.md"), "utf-8");
        const parsed = parseAgentFile(text);
        const cfg = buildOpencodeAgentConfig({
          name,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
        });
        if (cfg !== null) out[name] = cfg;
      } catch {
        // un agente roto no voltea a los demás
      }
    }
  } catch {
    // honest-empty: sin factory/agents no hay identidades
  }
  return out;
}

/**
 * Directorio fuente de skills factory (`<root>/factory/skills`): se inyecta
 * como `skills.paths` en el config del server efímero para que las skills de
 * los agentes (ej. review) viajen sin mirrors en disco. `null` si no existe.
 * Nunca lanza.
 */
export function resolveFactorySkillsDir(repoRoot?: string): string | null {
  try {
    const root = repoRoot && repoRoot.trim() ? repoRoot.trim() : getRepoRoot();
    const dir = path.join(root, "factory", "skills");
    return fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

export interface FactorySkillEntry {
  name: string;
  description: string;
  path: string;
}

/**
 * Lista las skills disponibles (`factory/skills/<name>/SKILL.md`) con nombre,
 * descripción y path absoluto. Ordenadas; los archivos rotos se omiten (los
 * reporta el validator). Es el catálogo que la UI ofrece como allowlist por
 * agente. Nunca lanza.
 */
export function listFactorySkills(repoRoot?: string): FactorySkillEntry[] {
  const out: FactorySkillEntry[] = [];
  try {
    const dir = resolveFactorySkillsDir(repoRoot);
    if (!dir) return out;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).slice().sort();
    } catch {
      return out;
    }
    for (const entry of entries) {
      try {
        if (!/^[a-z0-9-]+$/i.test(entry)) continue;
        const skillPath = path.join(dir, entry, "SKILL.md");
        if (!fs.existsSync(skillPath)) continue;
        const parsed = parseSkillFile(fs.readFileSync(skillPath, "utf-8"));
        const name = String(parsed.frontmatter.name ?? entry).trim() || entry;
        out.push({
          name,
          description: String(parsed.frontmatter.description ?? "").trim(),
          path: skillPath,
        });
      } catch {
        // rota: la reporta el validator
      }
    }
  } catch {
    // nunca lanza
  }
  return out;
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
 * True si la definición factory del agente existe
 * (`factory/agents/<name>/agent.md`). Es la fuente de verdad de identidad:
 * los agentes viajan INLINE en el config del server efímero de TermCanvas
 * (nunca hay espejos en disco que el opencode del usuario pueda ver).
 * Nunca lanza.
 */
export function factoryAgentExists(name: string, repoRoot?: string): boolean {
  try {
    const clean = typeof name === "string" ? name.trim() : "";
    if (!clean || !/^[a-z0-9-]+$/i.test(clean)) return false;
    const root = repoRoot && repoRoot.trim() ? repoRoot.trim() : getRepoRoot();
    return fs.existsSync(path.join(root, "factory", "agents", clean, "agent.md"));
  } catch {
    return false;
  }
}

/**
 * Fragmento de identidad para `session.create` y `session.prompt`:
 * `{ agent: name }` cuando la definición factory existe (el server efímero
 * la inyecta inline), `{}` cuando no. Nunca lanza.
 *
 * Dos niveles (evidencia viva E2/E3): el `agent` del create SOLO etiqueta la
 * sesión; el que decide QUIÉN EJECUTA el turno es el `agent` del body del
 * prompt. Sin definición no se manda nada en ningún nivel.
 */
export function sessionAgentArgs(name: string): { agent: string } | Record<string, never> {
  try {
    if (factoryAgentExists(name)) return { agent: name.trim() };
  } catch {
    // cae a vacío
  }
  return {};
}

/**
 * Resolución ESTRICTA de identidad para nodos del engine: `{ agent: name }`
 * solo si la definición factory existe (el server efímero la conoce inline).
 * `null` = no resuelto: el llamador DEBE fallar el nodo con error claro —
 * nunca se corre con el agente primario de opencode. Nunca lanza.
 */
export function resolveSessionAgent(
  name: string,
  repoRoot?: string,
): { agent: string } | null {
  try {
    const clean = typeof name === "string" ? name.trim() : "";
    if (!clean || !/^[a-z0-9-]+$/i.test(clean)) return null;
    return factoryAgentExists(clean, repoRoot) ? { agent: clean } : null;
  } catch {
    return null;
  }
}
