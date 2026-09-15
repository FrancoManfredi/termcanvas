/**
 * factory/agents/agentFileRoutes — body real de `factory/agents/<name>/agent.md`.
 *
 * La UI del WarpPanel edita SOLO el body (el frontmatter nunca se muestra ni
 * se toca desde la pantalla): el GET devuelve `{ name, body }` y el PUT recibe
 * `{ body }`, preserva el frontmatter byte por byte y revalida el archivo
 * reconstruido con `parseAgentFile` antes de escribir.
 *
 * Reglas (master plans + C1-C10):
 * - ESM puro, cero `require()`, sin timers ni polling (una sola op por llamada).
 * - Nunca lanza hacia el server: toda forma inválida retorna `{ error }` y el
 *   handler HTTP responde 4xx/500 con JSON.
 * - Anti-traversal idéntico al loader: `^[a-z0-9-]+$` + resolución dentro de
 *   `factory/agents/` (el `..`/slash/`%2f` nunca matchea).
 * - Escritura atómica `tmp→rename` (patrón `resultWriter.ts`/`workItemDisk.ts`).
 * - Tras escribir, el próximo job idle recicla el server efímero
 *   (`agentDirty`); los agentes viajan inline, no hay espejos que regenerar.
 * - `factoryDir` es seam SOLO para tests (sandbox): en producción se omite y
 *   se usa `resolveAgentFilePath` del loader.
 */

import fs from "node:fs";
import path from "node:path";
import {
  AGENT_STAGES,
  bumpAgentDefsRevision,
  isAgentStage,
  parseAgentFile,
  resetFactoryConfigCache,
  resetSkillCache,
  resolveAgentFilePath,
} from "../agentLoader";
import { isSessionAgentRole } from "../../../shared/roles";
import { KNOWN_AGENT_TOOLS } from "../definitionValidate";
import { resetServerAgentsMemoForTests } from "../opencodeAgentSync";
import { markAgentsDirty } from "./agentDirty";

/**
 * Tras una escritura exitosa a disco + espejos: marca dirty para que el
 * próximo JOB idle recicle el server opencode (el turno queda idéntico,
 * cero tokens extra) e invalida memos en memoria (skills/factory/server).
 * Best-effort, nunca lanza.
 */
function markAgentsChangedBestEffort(): void {
  try {
    markAgentsDirty();
  } catch {
    // noop
  }
  try {
    resetSkillCache();
  } catch {
    // noop
  }
  try {
    resetFactoryConfigCache();
  } catch {
    // noop
  }
  try {
    resetServerAgentsMemoForTests();
  } catch {
    // noop
  }
  // Roster de hooks (nombres + stages del panel): se invalida al instante.
  // Sin esto, editar el `stage` de un agente existente no se veía hasta un
  // reinicio (el mtime del directorio padre no cambia).
  try {
    bumpAgentDefsRevision();
  } catch {
    // noop
  }
}

/** Tope del body aceptado en PUT (200KB: sobra para un prompt, frena abusos). */
export const AGENT_BODY_MAX_CHARS = 200_000;

/** Nombres válidos: igual que `loadAgentDef` (anti-traversal). */
export function isValidAgentFileName(name: unknown): name is string {
  try {
    return typeof name === "string" && /^[a-z0-9-]+$/i.test(name.trim()) && name.trim().length <= 64;
  } catch {
    return false;
  }
}

/**
 * Parsea `/factory/agents/:name` (sin query: el caller pasa `pathname` ya).
 * Puro, nunca lanza. Rechaza segmentos extra, trailing slash y traversal.
 */
export function parseAgentFilePath(pathname: unknown): { name: string } | { error: string } {
  try {
    if (typeof pathname !== "string" || !pathname.startsWith("/factory/agents/")) {
      return { error: "not found" };
    }
    const rest = pathname.slice("/factory/agents/".length);
    if (!rest || rest.includes("/") || rest.includes("?") || rest.includes("#")) {
      return { error: "not found" };
    }
    let name: string;
    try {
      name = decodeURIComponent(rest).trim();
    } catch {
      return { error: "nombre de agente inválido" };
    }
    if (!isValidAgentFileName(name)) return { error: "nombre de agente inválido" };
    return { name };
  } catch {
    return { error: "nombre de agente inválido" };
  }
}

/** Dir `factory/agents` (sandbox de tests o disco real vía el loader). */
export function resolveFactoryAgentsDir(factoryDir?: string): string {
  return agentsDirFor(factoryDir);
}

function agentsDirFor(factoryDir?: string): string {
  try {
    if (typeof factoryDir === "string" && factoryDir.trim().length > 0) {
      return path.join(factoryDir.trim(), "agents");
    }
  } catch {
    // cae al disco real
  }
  return path.dirname(path.dirname(resolveAgentFilePath("probe")));
}

function filePathFor(name: string, factoryDir?: string): string {
  const sandbox = agentsDirFor(factoryDir);
  if (sandbox) return path.join(sandbox, name, "agent.md");
  return resolveAgentFilePath(name);
}

/**
 * Separa el frontmatter crudo (incluyendo ambas líneas `---`) del body,
 * preservando el frontmatter byte por byte para reconstruir en el PUT.
 * Puro, nunca lanza (null = inválido).
 */
export function splitAgentRaw(text: unknown): { frontmatterRaw: string; body: string } | null {
  try {
    if (typeof text !== "string" || text.length === 0) return null;
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length === 0) continue;
      if (lines[i].trim() === "---") start = i;
      break;
    }
    if (start === -1) return null;
    let end = -1;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }
    if (end === -1) return null;
    const frontmatterRaw = lines.slice(start, end + 1).join("\n");
    const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
    return { frontmatterRaw, body };
  } catch {
    return null;
  }
}

export interface AgentBodyRead {
  name: string;
  body: string;
}

export interface AgentBodyWrite {
  name: string;
  body: string;
  /**
   * False cuando el espejo opencode (local+global) no quedó verificado con
   * el body nuevo tras el save: la próxima sesión puede usar el prompt
   * viejo cacheado. Ausente en reads (solo lo setean las escrituras).
   */
  mirrorSynced?: boolean;
}

export type AgentWriteErrorCode = "invalid" | "duplicate" | "foreman" | "protected" | "not-found" | "io";

export interface AgentWriteError {
  ok: false;
  error: string;
  code: AgentWriteErrorCode;
}

/** Frontmatter recibido por API (JSON): formas flexibles, se canonizan. */
export interface AgentFrontmatterInput {
  description?: unknown;
  agentType?: unknown;
  mode?: unknown;
  model?: unknown;
  tools?: unknown;
  skills?: unknown;
  stage?: unknown;
  blocking?: unknown;
  runner?: unknown;
  secrets?: unknown;
  mcps?: unknown;
  [key: string]: unknown;
}

export interface AgentFullRead {
  name: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Solo en escrituras (ver `AgentBodyWrite.mirrorSynced`). */
  mirrorSynced?: boolean;
}

export interface AgentListItem {
  name: string;
  description: string;
  agentType: string;
  /** Metadata del frontmatter para el índice de la UI (sin abrir el agente). */
  mode: string;
  model: string;
  /** Clave del set curado de íconos de la UI (`""` = sin ícono, monograma). */
  icon: string;
  tools: string[];
  skills: string[];
  mcps: string[];
  stage: string;
  blocking: boolean;
}

/** Normaliza una lista nominal del frontmatter (array, record o string). Pura. */
function nameListOf(value: unknown): string[] {
  try {
    if (Array.isArray(value)) {
      return (value as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean);
    }
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).map((k) => k.trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .trim()
        .replace(/^\{/, "")
        .replace(/\}$/, "")
        .split(",")
        .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
        .filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Lista agentes (`factory/agents/*\/agent.md`): nombre + description +
 * agentType + metadata del frontmatter para el índice. Los rotos se omiten
 * (los reporta el validator). Ordenados. Nunca lanza.
 */
export function listAgents(factoryDir?: string): AgentListItem[] {
  const out: AgentListItem[] = [];
  try {
    const dir = agentsDirFor(factoryDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).slice().sort();
    } catch {
      return out;
    }
    for (const name of entries) {
      try {
        if (!/^[a-z0-9-]+$/i.test(name)) continue;
        const st = fs.statSync(path.join(dir, name));
        if (!st.isDirectory()) continue;
        const text = fs.readFileSync(path.join(dir, name, "agent.md"), "utf-8");
        const parsed = parseAgentFile(text);
        const fm = parsed.frontmatter as unknown as Record<string, unknown>;
        out.push({
          name,
          description: String(fm.description ?? "").slice(0, 300),
          agentType: String(fm.agentType ?? "").toUpperCase(),
          mode: String(fm.mode ?? "").trim().toLowerCase() || "primary",
          model: String(fm.model ?? "").trim(),
          icon: String(fm.icon ?? "").trim(),
          tools: nameListOf(fm.tools),
          skills: nameListOf(fm.skills),
          mcps: nameListOf(fm.mcps),
          stage: String(fm.stage ?? "").trim().toLowerCase() || "none",
          blocking: fm.blocking === true || String(fm.blocking ?? "").toLowerCase() === "true",
        });
      } catch {
        // roto: lo reporta el validator, acá se omite
      }
    }
  } catch {
    // nunca lanza
  }
  return out;
}

/** Orden canónico de keys al crear (legible y dif-friendly). */
const FRONTMATTER_KEY_ORDER: readonly string[] = [
  "description",
  "agentType",
  "mode",
  "model",
  "tools",
  "skills",
  "stage",
  "blocking",
  "runner",
  "secrets",
  "mcps",
];

/** Escalar simple que no necesita comillas en YAML de una línea. */
function isBareScalar(s: string): boolean {
  try {
    if (s.length === 0) return false;
    if (/^\s|\s$/.test(s)) return false;
    if (/[#:{}\[\],&*!|>'"%@`]/.test(s)) return false;
    if (/^\d+$/.test(s)) return false;
    if (/^(true|false|null|yes|no|on|off)$/i.test(s)) return false;
    return true;
  } catch {
    return false;
  }
}

function encodeScalar(value: string): string {
  try {
    if (isBareScalar(value)) return value;
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  } catch {
    return `""`;
  }
}

/** Serializa un valor de frontmatter a YAML de una línea (round-trip con parseAgentFile). */
function encodeFrontmatterValue(value: unknown): string | null {
  try {
    if (value === undefined || value === null) return null;
    if (typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      return String(value);
    }
    if (typeof value === "string") return encodeScalar(value);
    if (Array.isArray(value)) {
      const items = (value as unknown[])
        .filter((v) => typeof v === "string" && (v as string).trim().length > 0)
        .map((v) => encodeScalar((v as string).trim()));
      return `{${items.join(", ")}}`;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([k, v]) => typeof k === "string" && k.trim().length > 0 && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
        .map(([k, v]) => `${encodeScalar(k.trim())}: ${typeof v === "string" ? encodeScalar(v) : String(v)}`);
      return `{${entries.join(", ")}}`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Normaliza tools/skills recibidos a string[] (acepta lista, `{a,b}`, mapa o string único). */
function normalizeNameList(value: unknown): string[] | null {
  try {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) {
      const out = (value as unknown[])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim());
      return [...new Set(out)];
    }
    if (typeof value === "object") {
      return Object.keys(value as Record<string, unknown>)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    }
    if (typeof value === "string") {
      const t = value.trim().replace(/^\{/, "").replace(/\}$/, "");
      if (t.length === 0) return [];
      return [...new Set(t.split(",").map((s) => s.trim().replace(/^["']+|["']+$/g, "")).filter((s) => s.length > 0))];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Valida el frontmatter ya parseado (mismas reglas que definitionValidate,
 * fail-fast para la API con mensajes accionables). null = válido.
 * Puro, nunca lanza.
 */
function validateParsedFrontmatter(fm: Record<string, unknown>): string | null {
  try {
    const tools = fm.tools as unknown;
    const list: string[] = Array.isArray(tools)
      ? (tools as unknown[]).map((t) => String(t ?? ""))
      : tools && typeof tools === "object"
        ? Object.keys(tools as Record<string, unknown>)
        : [];
    const unknownTools = list.filter((t) => !(KNOWN_AGENT_TOOLS as readonly string[]).includes(t.trim()));
    if (unknownTools.length > 0) {
      return `tools desconocidas [${unknownTools.map((t) => `"${t.slice(0, 40)}"`).join(", ")}] (conocidas: ${KNOWN_AGENT_TOOLS.join("|")})`;
    }
    const rawStage = fm.stage as unknown;
    if (rawStage !== undefined && rawStage !== null && String(rawStage).trim() !== "" && !isAgentStage(rawStage)) {
      return `stage inválido "${String(rawStage).slice(0, 40)}" (vocabulario: ${AGENT_STAGES.join("|")})`;
    }
    const rawBlocking = fm.blocking as unknown;
    if (rawBlocking !== undefined && rawBlocking !== null && String(rawBlocking).trim() !== "") {
      const t = String(rawBlocking).trim().toLowerCase();
      if (rawBlocking !== true && rawBlocking !== false && t !== "true" && t !== "false") {
        return `blocking inválido "${String(rawBlocking).slice(0, 40)}" (usá true o false)`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Construye el texto completo de un agent.md nuevo (orden canónico). */
function buildAgentFileText(fm: Record<string, unknown>, body: string): string {
  const lines = ["---"];
  const seen = new Set<string>();
  for (const key of FRONTMATTER_KEY_ORDER) {
    if (!(key in fm)) continue;
    const encoded = encodeFrontmatterValue(fm[key]);
    if (encoded === null) continue;
    lines.push(`${key}: ${encoded}`);
    seen.add(key);
  }
  for (const [key, value] of Object.entries(fm)) {
    if (seen.has(key)) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    const encoded = encodeFrontmatterValue(value);
    if (encoded === null) continue;
    lines.push(`${key}: ${encoded}`);
    seen.add(key);
  }
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

/** Parchea líneas del frontmatter crudo (preserva comentarios y formato ajeno). */
function patchFrontmatterRaw(frontmatterRaw: string, patch: Record<string, unknown>): string {
  const lines = frontmatterRaw.split("\n");
  const closeIdx = lines.map((l) => l.trim()).lastIndexOf("---");
  const end = closeIdx >= 0 ? closeIdx : lines.length;
  const seen = new Set<string>();
  for (let i = 0; i < end; i++) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0 || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key in patch && !seen.has(key)) {
      const encoded = encodeFrontmatterValue(patch[key]);
      if (encoded !== null) lines[i] = `${key}: ${encoded}`;
      seen.add(key);
    }
  }
  const missing: string[] = [];
  for (const key of Object.keys(patch)) {
    if (seen.has(key)) continue;
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    const encoded = encodeFrontmatterValue(patch[key]);
    if (encoded === null) continue;
    missing.push(`${key}: ${encoded}`);
  }
  if (missing.length > 0) lines.splice(end, 0, ...missing);
  return lines.join("\n");
}

/** Cuenta agentes con agentType FOREMAN (excluye `except`); -1 ante fallo. */
function countForemen(factoryDir: string | undefined, except: string | null): number {
  try {
    const agentsDir = agentsDirFor(factoryDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(agentsDir);
    } catch {
      return 0;
    }
    let count = 0;
    for (const name of entries) {
      try {
        if (except !== null && name === except) continue;
        const st = fs.statSync(path.join(agentsDir, name));
        if (!st.isDirectory()) continue;
        const text = fs.readFileSync(path.join(agentsDir, name, "agent.md"), "utf-8");
        const parsed = parseAgentFile(text);
        if (String(parsed.frontmatter.agentType ?? "").toUpperCase() === "FOREMAN") count += 1;
      } catch {
        // agente roto: lo reporta el validator, acá no frena el conteo
      }
    }
    return count;
  } catch {
    return -1;
  }
}

function writeTextAtomic(filePath: string, content: string): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Seam SOLO para tests: home alternativo para el espejo global (en
 * producción se omite y vale `~/.config`). Sin esto, las suites tocarían
 * el home real al verificar el sync global.
 */
let mirrorTestHome: string | null = null;

export function setMirrorTestHomeForTests(dir: string | null): void {
  try {
    mirrorTestHome = typeof dir === "string" && dir.trim().length > 0 ? dir.trim() : null;
  } catch {
    // noop
  }
}

/**
 * Reporte del espejo tras un save: qué lados quedaron realmente en sync.
 * F14: sin mirrors, `synced: true` = definición factory válida (el server
 * efímero la toma al reciclarse). El caller lo expone (mirrorSynced).
 */
export interface MirrorSyncReport {
  local: boolean;
  global: boolean;
  synced: boolean;
}

/**
 * F14: mirrors ELIMINADOS. Los agentes viajan INLINE en el config del server
 * efímero de TermCanvas (`buildFactoryAgentsConfig`): el opencode del usuario
 * nunca los ve, y un edit impacta al reciclar el server (agentDirty).
 * Este seam se conserva como no-op para no tocar el contrato del CRUD:
 * `synced: true` = definición factory válida. Nunca lanza.
 */
function regenMirrorBestEffort(
  _factoryDir?: string,
  _touchedName?: string,
  _touchedText?: string,
): MirrorSyncReport {
  return { local: true, global: true, synced: true };
}

/**
 * Lee el body de `factory/agents/<name>/agent.md`. Nunca lanza.
 */
export function readAgentBody(
  name: string,
  factoryDir?: string,
): { ok: true; value: AgentBodyRead } | { ok: false; error: string } {
  try {
    if (!isValidAgentFileName(name)) return { ok: false, error: "nombre de agente inválido" };
    const clean = name.trim();
    const filePath = filePathFor(clean, factoryDir);
    let text: string;
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `agente no encontrado: ${clean}` };
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      return { ok: false, error: `no se pudo leer el agente: ${clean}` };
    }
    try {
      const parsed = parseAgentFile(text);
      return { ok: true, value: { name: clean, body: parsed.body } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "agent.md inválido" };
    }
  } catch {
    return { ok: false, error: "no se pudo leer el agente" };
  }
}

/**
 * Escribe SOLO el body, preservando el frontmatter original byte por byte.
 * Revalida el archivo reconstruido con `parseAgentFile` antes de tocar disco.
 * Nunca lanza.
 */
export function writeAgentBody(
  name: string,
  newBody: unknown,
  factoryDir?: string,
): { ok: true; value: AgentBodyWrite } | { ok: false; error: string } {
  try {
    if (!isValidAgentFileName(name)) return { ok: false, error: "nombre de agente inválido" };
    if (typeof newBody !== "string") return { ok: false, error: "body debe ser texto" };
    const trimmed = newBody.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
    if (!trimmed) return { ok: false, error: "body vacío: no se guardó nada" };
    if (trimmed.length > AGENT_BODY_MAX_CHARS) {
      return { ok: false, error: `body demasiado largo (máx ${AGENT_BODY_MAX_CHARS} caracteres)` };
    }
    const clean = name.trim();
    const filePath = filePathFor(clean, factoryDir);
    let current: string;
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `agente no encontrado: ${clean}` };
      current = fs.readFileSync(filePath, "utf-8");
    } catch {
      return { ok: false, error: `no se pudo leer el agente: ${clean}` };
    }
    const split = splitAgentRaw(current);
    if (!split) return { ok: false, error: "agent.md actual inválido: no se tocó nada" };
    const rebuilt = `${split.frontmatterRaw}\n\n${trimmed}\n`;
    try {
      parseAgentFile(rebuilt);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "body inválido" };
    }
    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${filePath}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      fs.writeFileSync(tmp, rebuilt, "utf-8");
      fs.renameSync(tmp, filePath);
    } catch {
      return { ok: false, error: "no se pudo escribir el agent.md" };
    }
    // Espejos proyecto + global best-effort (igual que writeAgentFull:
    // los jobs en worktrees sin `.opencode` solo ven el global) + flag
    // dirty para que el próximo JOB idle recicle el server. El disco ya
    // quedó bien aunque esto falle. En sandbox (tests) no se marca dirty
    // global: hermético.
    let mirrorSynced: boolean | undefined;
    try {
      mirrorSynced = regenMirrorBestEffort(factoryDir, clean, rebuilt).synced;
    } catch {
      mirrorSynced = undefined;
    }
    if (!factoryDir) markAgentsChangedBestEffort();
    return {
      ok: true,
      value: {
        name: clean,
        body: trimmed,
        ...(typeof mirrorSynced === "boolean" ? { mirrorSynced } : {}),
      },
    };
  } catch {
    return { ok: false, error: "no se pudo guardar el agente" };
  }
}

export interface AgentCreateResult {
  name: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** False = espejo opencode sin verificar (ver `AgentBodyWrite`). */
  mirrorSynced?: boolean;
}

/**
 * True si es un agente core (sesión propia del pipeline: foreman, triage,
 * spec, implement, review). Los core NUNCA se eliminan: el pipeline los
 * asume fijos. Fuente: `shared/roles SESSION_AGENT_ROLES`.
 */
export function isCoreAgent(name: unknown): boolean {
  try {
    return typeof name === "string" && isSessionAgentRole(name.trim());
  } catch {
    return false;
  }
}

/**
 * Elimina `factory/agents/<name>/` (agent.md + dir) y su espejo
 * `.opencode/agents/<name>.md` (best-effort). Los core se rechazan con
 * `protected`. Nunca lanza.
 */
export function deleteAgentFile(
  name: unknown,
  factoryDir?: string,
): { ok: true; value: { name: string } } | AgentWriteError {
  try {
    if (!isValidAgentFileName(name)) return { ok: false, error: "nombre de agente inválido", code: "invalid" };
    const clean = (name as string).trim();
    if (isCoreAgent(clean)) {
      return { ok: false, error: `el agente core no se puede eliminar: ${clean}`, code: "protected" };
    }
    const filePath = filePathFor(clean, factoryDir);
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `agente no encontrado: ${clean}`, code: "not-found" };
    } catch {
      return { ok: false, error: "no se pudo verificar el agente", code: "io" };
    }
    try {
      fs.unlinkSync(filePath);
    } catch {
      return { ok: false, error: "no se pudo eliminar el agent.md", code: "io" };
    }
    try {
      fs.rmdirSync(path.dirname(filePath));
    } catch {
      // dir no vacío (skills propias u otros): se deja, el agent.md ya salió
    }
    // F14: sin mirrors en disco. La baja impacta al reciclar el server
    // efímero (agentDirty), que reconstruye los agentes inline.
    markAgentsChangedBestEffort();
    return { ok: true, value: { name: clean } };
  } catch {
    return { ok: false, error: "no se pudo eliminar el agente", code: "io" };
  }
}

/**
 * Crea `factory/agents/<name>/agent.md` de una sola vez (frontmatter +
 * body). Valida nombre, duplicado, frontmatter (parse + tools/stage/
 * blocking conocidos) y unicidad del FOREMAN antes de tocar disco.
 * Escribe atómico tmp→rename y regenera el espejo best-effort.
 * Nunca lanza (los fallos van en `code` para mapear el HTTP).
 */
export function createAgentFile(
  name: unknown,
  frontmatter: unknown,
  body: unknown,
  factoryDir?: string,
): { ok: true; value: AgentCreateResult } | AgentWriteError {
  try {
    if (!isValidAgentFileName(name)) return { ok: false, error: "nombre de agente inválido", code: "invalid" };
    const clean = (name as string).trim();
    if (typeof body !== "string") return { ok: false, error: "body debe ser texto", code: "invalid" };
    const trimmedBody = body.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
    if (!trimmedBody) return { ok: false, error: "body vacío: no se creó nada", code: "invalid" };
    if (trimmedBody.length > AGENT_BODY_MAX_CHARS) {
      return { ok: false, error: `body demasiado largo (máx ${AGENT_BODY_MAX_CHARS} caracteres)`, code: "invalid" };
    }
    const fmIn = (frontmatter !== null && typeof frontmatter === "object" && !Array.isArray(frontmatter)
      ? (frontmatter as Record<string, unknown>)
      : null);
    if (!fmIn) return { ok: false, error: "frontmatter debe ser un objeto", code: "invalid" };
    const filePath = filePathFor(clean, factoryDir);
    try {
      if (fs.existsSync(filePath)) {
        return { ok: false, error: `el agente ya existe: ${clean}`, code: "duplicate" };
      }
    } catch {
      return { ok: false, error: "no se pudo verificar el agente", code: "io" };
    }
    // Canonizar listas recibidas (tools/skills/secrets/mcps) a string[].
    const fm: Record<string, unknown> = { ...fmIn };
    for (const key of ["tools", "skills", "secrets", "mcps"] as const) {
      if (fm[key] !== undefined) {
        const list = normalizeNameList(fm[key]);
        if (list === null) return { ok: false, error: `${key} inválido (usá lista o {a, b})`, code: "invalid" };
        fm[key] = list;
      }
    }
    const text = buildAgentFileText(fm, trimmedBody);
    let parsed: { frontmatter: Record<string, unknown>; body: string };
    try {
      const p = parseAgentFile(text);
      parsed = { frontmatter: p.frontmatter as unknown as Record<string, unknown>, body: p.body };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "agent.md inválido", code: "invalid" };
    }
    const ruleError = validateParsedFrontmatter(parsed.frontmatter);
    if (ruleError) return { ok: false, error: ruleError, code: "invalid" };
    if (String(parsed.frontmatter.agentType ?? "").toUpperCase() === "FOREMAN") {
      const foremans = countForemen(factoryDir, null);
      if (foremans !== 0) {
        return { ok: false, error: "ya existe un FOREMAN: cada factory lleva exactamente uno", code: "foreman" };
      }
    }
    if (!writeTextAtomic(filePath, text)) return { ok: false, error: "no se pudo escribir el agent.md", code: "io" };
    let mirrorSynced: boolean | undefined;
    try {
      mirrorSynced = regenMirrorBestEffort(factoryDir, clean, text).synced;
    } catch {
      mirrorSynced = undefined;
    }
    if (!factoryDir) markAgentsChangedBestEffort();
    return {
      ok: true,
      value: {
        name: clean,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        ...(typeof mirrorSynced === "boolean" ? { mirrorSynced } : {}),
      },
    };
  } catch {
    return { ok: false, error: "no se pudo crear el agente", code: "io" };
  }
}

/**
 * Lee frontmatter + body de `factory/agents/<name>/agent.md`. Nunca lanza.
 */
export function readAgentFull(
  name: string,
  factoryDir?: string,
): { ok: true; value: AgentFullRead } | { ok: false; error: string } {
  try {
    if (!isValidAgentFileName(name)) return { ok: false, error: "nombre de agente inválido" };
    const clean = name.trim();
    const filePath = filePathFor(clean, factoryDir);
    let text: string;
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `agente no encontrado: ${clean}` };
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      return { ok: false, error: `no se pudo leer el agente: ${clean}` };
    }
    try {
      const parsed = parseAgentFile(text);
      return {
        ok: true,
        value: {
          name: clean,
          frontmatter: parsed.frontmatter as unknown as Record<string, unknown>,
          body: parsed.body,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "agent.md inválido" };
    }
  } catch {
    return { ok: false, error: "no se pudo leer el agente" };
  }
}

/**
 * Escribe frontmatter (patch, preservando formato ajeno) y/o body.
 * Valida el reconstruido (parse + reglas + unicidad FOREMAN) antes de disco.
 * Nunca lanza.
 */
export function writeAgentFull(
  name: string,
  patch: unknown,
  newBody: unknown,
  factoryDir?: string,
): { ok: true; value: AgentFullRead } | AgentWriteError {
  try {
    if (!isValidAgentFileName(name)) return { ok: false, error: "nombre de agente inválido", code: "invalid" };
    const clean = name.trim();
    const filePath = filePathFor(clean, factoryDir);
    let current: string;
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `agente no encontrado: ${clean}`, code: "not-found" };
      current = fs.readFileSync(filePath, "utf-8");
    } catch {
      return { ok: false, error: `no se pudo leer el agente: ${clean}`, code: "io" };
    }
    const split = splitAgentRaw(current);
    if (!split) return { ok: false, error: "agent.md actual inválido: no se tocó nada", code: "invalid" };
    let frontmatterRaw = split.frontmatterRaw;
    let trimmedBody: string | null = null;
    if (newBody !== undefined && newBody !== null) {
      if (typeof newBody !== "string") return { ok: false, error: "body debe ser texto", code: "invalid" };
      trimmedBody = newBody.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
      if (!trimmedBody) return { ok: false, error: "body vacío: no se guardó nada", code: "invalid" };
      if (trimmedBody.length > AGENT_BODY_MAX_CHARS) {
        return { ok: false, error: `body demasiado largo (máx ${AGENT_BODY_MAX_CHARS} caracteres)`, code: "invalid" };
      }
    }
    if (patch !== undefined && patch !== null) {
      if (typeof patch !== "object" || Array.isArray(patch)) {
        return { ok: false, error: "frontmatter debe ser un objeto", code: "invalid" };
      }
      const norm: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_-]+$/.test(key)) {
          return { ok: false, error: `clave de frontmatter inválida: ${key}`, code: "invalid" };
        }
        if (key === "tools" || key === "skills" || key === "secrets" || key === "mcps") {
          const list = normalizeNameList(value);
          if (list === null) return { ok: false, error: `${key} inválido (usá lista o {a, b})`, code: "invalid" };
          norm[key] = list;
        } else {
          norm[key] = value;
        }
      }
      frontmatterRaw = patchFrontmatterRaw(frontmatterRaw, norm);
    }
    const rebuilt = `${frontmatterRaw}\n\n${trimmedBody ?? split.body}\n`;
    let parsed: { frontmatter: Record<string, unknown>; body: string };
    try {
      const p = parseAgentFile(rebuilt);
      parsed = { frontmatter: p.frontmatter as unknown as Record<string, unknown>, body: p.body };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "agent.md inválido", code: "invalid" };
    }
    const ruleError = validateParsedFrontmatter(parsed.frontmatter);
    if (ruleError) return { ok: false, error: ruleError, code: "invalid" };
    if (String(parsed.frontmatter.agentType ?? "").toUpperCase() === "FOREMAN") {
      const foremans = countForemen(factoryDir, clean);
      if (foremans !== 0) {
        return { ok: false, error: "ya existe otro FOREMAN: cada factory lleva exactamente uno", code: "foreman" };
      }
    }
    if (!writeTextAtomic(filePath, rebuilt)) return { ok: false, error: "no se pudo escribir el agent.md", code: "io" };
    let mirrorSynced: boolean | undefined;
    try {
      mirrorSynced = regenMirrorBestEffort(factoryDir, clean, rebuilt).synced;
    } catch {
      mirrorSynced = undefined;
    }
    if (!factoryDir) markAgentsChangedBestEffort();
    return {
      ok: true,
      value: {
        name: clean,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        ...(typeof mirrorSynced === "boolean" ? { mirrorSynced } : {}),
      },
    };
  } catch {
    return { ok: false, error: "no se pudo guardar el agente", code: "io" };
  }
}
