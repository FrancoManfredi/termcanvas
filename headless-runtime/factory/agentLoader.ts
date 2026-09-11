/**
 * AgentLoader — Ola 7 Agents as code.
 * Loader puro para `factory/agents/<name>/agent.md` y `factory/factory.yaml`.
 * Sin dependencias nuevas: solo node:fs/path/url con parser mínimo propio.
 *
 * Reglas:
 * - `loadAgentDef` nunca lanza: devuelve null si el archivo falta o es inválido.
 * - `getFactoryConfig` nunca lanza: ante archivo faltante o inválido avisa por
 *   consola y devuelve los defaults en código (espejo de las constantes actuales).
 * - La resolución de rutas parte del propio módulo (fileURLToPath) con fallback
 *   a cwd, así funciona tanto en dev-tsx como en tests.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { FACTORY_AGENT_ROLES, type FactoryAgentRole } from "../../shared/roles";

// ── Tipos de agentes (FASE 1 E2: delegan en shared/roles, C6/C7; valores intactos) ──

export const AGENT_TYPES = FACTORY_AGENT_ROLES;

export type AgentType = FactoryAgentRole;

export interface AgentFrontmatter {
  description: string;
  agentType: AgentType;
  model: string;
  tools: string[] | Record<string, unknown>;
  status?: string;
  /** Instrucciones de ejecución (opencode `mode`). */
  mode?: string;
  /** Skills on-demand `{a, b}` (formato plano, igual que tools). */
  skills?: unknown;
  /** Hook de pipeline: dónde engancha el agente (vocabulario AGENT_STAGES). */
  stage?: unknown;
  /** true = el hook frena el pipeline ante fallo; false = advisory. */
  blocking?: unknown;
  /** Runner por nombre (`runners/<name>.yaml`). */
  runner?: unknown;
  /** Nombres de secrets (los valores viven en el secret store, nunca acá). */
  secrets?: unknown;
  /** Nombres de MCPs. */
  mcps?: unknown;
  [key: string]: unknown;
}

/**
 * Stages de pipeline donde un agente puede enganchar como hook declarativo
 * (alta de agentes sin tocar código: el corredor de hooks lee `stage` del
 * frontmatter). `none` = sin hook (core Triage/Spec/Implement/Review y
 * Foreman, cableados por el pipeline).
 */
export const AGENT_STAGES = [
  "pre-build",
  "post-build",
  "post-review",
  "none",
] as const;

export type AgentStage = (typeof AGENT_STAGES)[number];

/** True si es un stage de hook válido (case-insensitive, con trim). */
export function isAgentStage(value: unknown): value is AgentStage {
  try {
    if (typeof value !== "string") return false;
    const t = value.trim().toLowerCase();
    return (AGENT_STAGES as readonly string[]).includes(t);
  } catch {
    return false;
  }
}

/**
 * Normaliza `stage` del frontmatter (el parser lo deja como string crudo):
 * ausente/vacío/desconocido → `"none"` (fail-closed: sin hook).
 * Puro, nunca lanza.
 */
export function normalizeAgentStage(value: unknown): AgentStage {
  try {
    if (typeof value === "string" && isAgentStage(value)) {
      return value.trim().toLowerCase() as AgentStage;
    }
  } catch {
    // cae a none
  }
  return "none";
}

/**
 * Normaliza `blocking` del frontmatter (string crudo `"true"`/`"false"` o
 * boolean): solo true explícito es blocking. Default false (advisory:
 * informa sin frenar). Puro, nunca lanza.
 */
export function normalizeAgentBlocking(value: unknown): boolean {
  try {
    if (value === true) return true;
    if (typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  } catch {
    // cae a false
  }
  return false;
}

export interface AgentDef {
  name: string;
  frontmatter: AgentFrontmatter;
  body: string;
}

export interface ParsedAgentFile {
  frontmatter: AgentFrontmatter;
  body: string;
}

export class AgentParseError extends Error {
  constructor(message: string) {
    super(`agent parse error: ${message}`);
    this.name = "AgentParseError";
  }
}

export class FactoryConfigError extends Error {
  constructor(message: string) {
    super(`factory.yaml parse error: ${message}`);
    this.name = "FactoryConfigError";
  }
}

// ── Raíz del repo (desde el propio módulo, con fallback a cwd) ──

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
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "factory"))
    )
      return cwd;
    const parent = path.resolve(cwd, "..");
    if (
      fs.existsSync(path.join(parent, "package.json")) &&
      fs.existsSync(path.join(parent, "factory"))
    )
      return parent;
  } catch {
    // sigue a cwd directo
  }
  return process.cwd();
}

export function resolveAgentFilePath(name: string): string {
  return path.join(getRepoRoot(), "factory", "agents", name, "agent.md");
}

export function resolveFactoryYamlPath(): string {
  return path.join(getRepoRoot(), "factory", "factory.yaml");
}

// ── Parser mínimo de frontmatter ──

function stripQuotes(value: string): string {
  const t = value.trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return t.slice(1, -1);
    }
  }
  return t;
}

function parseToolsValue(raw: string): string[] | Record<string, unknown> {
  const t = raw.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) {
    if (t.length === 0) return [];
    return [stripQuotes(t)];
  }
  const inner = t.slice(1, -1).trim();
  if (inner.length === 0) return [];
  const tokens = inner
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const hasRecordShape = tokens.some((tok) => tok.includes(":"));
  if (!hasRecordShape) {
    return tokens.map((tok) => stripQuotes(tok));
  }
  const record: Record<string, unknown> = {};
  for (const tok of tokens) {
    const idx = tok.indexOf(":");
    if (idx <= 0) throw new AgentParseError(`tools con entrada inválida "${tok}"`);
    const key = stripQuotes(tok.slice(0, idx).trim());
    const valRaw = stripQuotes(tok.slice(idx + 1).trim());
    if (!key) throw new AgentParseError(`tools con clave vacía en "${tok}"`);
    if (valRaw === "true") record[key] = true;
    else if (valRaw === "false") record[key] = false;
    else if (/^-?\d+$/.test(valRaw)) record[key] = Number(valRaw);
    else record[key] = valRaw;
  }
  return record;
}

function isValidAgentType(value: string): value is AgentType {
  return (AGENT_TYPES as readonly string[]).includes(value);
}

/**
 * Parsea el texto completo de un `agent.md` en frontmatter + body.
 * Frontmatter plano `key: value` entre líneas `---`, con `tools` como lista
 * `{a,b}` (o mapa `{a: true}`). Sin `maxRetries` (doctrina sin-límites: los
 * reintentos los decide el transporte único, no el frontmatter; una clave
 * `maxRetries` vieja se conserva como extra sin efecto).
 * Lanza AgentParseError si falta `description`/`agentType` o el tipo es inválido.
 */
export function parseAgentFile(text: string): ParsedAgentFile {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new AgentParseError("archivo vacío");
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue;
    if (lines[i].trim() === "---") {
      start = i;
    }
    break;
  }
  if (start === -1) throw new AgentParseError("falta apertura de frontmatter `---`");
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new AgentParseError("falta cierre de frontmatter `---`");

  const raw: Record<string, string> = {};
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) throw new AgentParseError(`línea de frontmatter inválida "${line.trim()}"`);
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) throw new AgentParseError("clave de frontmatter vacía");
    raw[key] = value;
  }

  const description = stripQuotes(raw.description ?? "").trim();
  if (!description) throw new AgentParseError("falta `description`");
  const agentTypeRaw = stripQuotes(raw.agentType ?? "").trim().toUpperCase();
  if (!agentTypeRaw) throw new AgentParseError("falta `agentType`");
  if (!isValidAgentType(agentTypeRaw)) {
    throw new AgentParseError(`agentType inválido "${raw.agentType}"`);
  }
  const model = stripQuotes(raw.model ?? "").trim();
  let tools: string[] | Record<string, unknown> = [];
  if (raw.tools !== undefined) {
    tools = parseToolsValue(raw.tools);
  }
  const frontmatter: AgentFrontmatter = {
    description,
    agentType: agentTypeRaw,
    model,
    tools,
  };
  for (const [key, value] of Object.entries(raw)) {
    if (key in frontmatter) continue;
    // Listas nominales con la misma forma que tools (`{a, b}`, `{a: true}`
    // o valor único): se parsean igual para que todos los consumidores vean
    // string[]|Record en vez del string crudo.
    if (key === "skills" || key === "secrets" || key === "mcps") {
      try {
        frontmatter[key] = parseToolsValue(value);
      } catch {
        frontmatter[key] = stripQuotes(value);
      }
      continue;
    }
    // `blocking` se coerciona a boolean cuando es literal válido; otro
    // texto se conserva crudo para que el validator lo reporte con file:line.
    if (key === "blocking") {
      const t = stripQuotes(value).trim().toLowerCase();
      frontmatter[key] = t === "true" ? true : t === "false" ? false : stripQuotes(value);
      continue;
    }
    frontmatter[key] = stripQuotes(value);
  }

  const body = lines.slice(end + 1).join("\n").trim();
  if (!body) throw new AgentParseError("cuerpo vacío tras el frontmatter");
  return { frontmatter, body };
}

/**
 * Lee `factory/agents/<name>/agent.md` resuelto desde este módulo.
 * Devuelve null si falta o es inválido — nunca lanza.
 */
export function loadAgentDef(name: string): AgentDef | null {
  try {
    if (typeof name !== "string" || !/^[a-z0-9-]+$/i.test(name.trim())) return null;
    const filePath = resolveAgentFilePath(name.trim());
    let text: string;
    try {
      if (!fs.existsSync(filePath)) return null;
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
    try {
      const parsed = parseAgentFile(text);
      return { name: name.trim(), frontmatter: parsed.frontmatter, body: parsed.body };
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Valida un conjunto de definiciones: exige exactamente un FOREMAN y
 * tipos válidos. Devuelve la lista de errores (vacía = válido).
 */
export function validateAgentSet(defs: Array<AgentDef | null | undefined>): string[] {
  const errors: string[] = [];
  const present = defs.filter((d): d is AgentDef => !!d && typeof d === "object");
  for (const def of present) {
    const t = def.frontmatter?.agentType;
    if (typeof t !== "string" || !isValidAgentType(String(t).toUpperCase())) {
      errors.push(`agente "${def.name ?? "?"}": agentType inválido "${String(t)}"`);
    }
  }
  const foremen = present.filter(
    (d) => String(d.frontmatter?.agentType ?? "").toUpperCase() === "FOREMAN",
  );
  if (foremen.length === 0) {
    errors.push("se requiere exactamente un agente FOREMAN (cero encontrados)");
  } else if (foremen.length > 1) {
    errors.push(
      `se requiere exactamente un agente FOREMAN (${foremen.length} encontrados: ${foremen.map((d) => d.name).join(", ")})`,
    );
  }
  return errors;
}

// ── Config de factory (factory.yaml mínimo y estricto) ──

export interface FactoryPorts {
  factoryDefault: number;
  factoryMax: number;
}

export interface FactoryTimeouts {
  /**
   * Único timeout que queda en yaml: cada paso de verificación
   * (test/build) muere por este techo con kill en 2 fases — seguridad de
   * proceso, no límite de fase. Los turnos LLM usan el fusible global
   * GLOBAL_AGENT_FUSE_MS (doctrina sin-límites, ver agentTransport).
   */
  verifyMs: number;
}

export interface FactoryDefaultModels {
  foreman: string;
  implement: string;
  review: string;
}

export interface ReviewerPair {
  match: string;
  reviewer: string;
}

export interface FactoryConfig {
  ports: FactoryPorts;
  timeouts: FactoryTimeouts;
  defaultModels: FactoryDefaultModels;
  reviewerPairs: ReviewerPair[];
  scorers: { samplingRate: number };
  /** Ola 15 (aditivo): runner por defecto cuando el job no pide otro. */
  runners: FactoryRunnersRef;
  /** Ola 15 (aditivo, regla 8): false = no se estima nada, se muestra "—". */
  costTracking: boolean;
  /** Ola 15 (aditivo): vacío = modo "sin tarifa" (sin USD, nunca 0.00). */
  costRates: FactoryCostRates;
  /**
   * FU-4 (aditivo, Regla 8): fecha de vigencia de `costRates` en formato
   * `YYYY-MM-DD` (ej. "2026-09-05"), o null cuando el yaml no la declara
   * (yaml viejo: sin fecha, sin error). Solo formato, sin semántica de
   * staleness: ningún timer ni fetch la lee (Regla 8); la fecha solo se
   * muestra en el tooltip del CostBadge para que el humano vea si está
   * desactualizada. Malformada = error de parseo (el caller cae a defaults).
   */
  ratesAsOf: string | null;
  /**
   * FU-4 (aditivo): URL de la fuente de las tarifas (ej.
   * "https://opencode.ai/docs/go/"), o null cuando el yaml no la declara.
   * Solo documentación versionada: nada la fetchea (Regla 8).
   */
  ratesSource: string | null;
  /** Ola 16 (aditivo, regla 8): false = sesión nueva por llamada (comportamiento viejo). */
  agentSessions: boolean;
  /** Ola 17 (aditivo, regla 8): false = revise clásico exacto (cero re-verificaciones). */
  reviewerReverify: boolean;
  /**
   * Ola 18 P1.4 (aditivo, regla 8): máx de propuestas `pending|ready`
   * abiertas por scorer antes de frenar el auto-propose. Default 1.
   * 0 = auto-propose apagado (el scoring manual sigue intacto).
   */
  improveProposalCooldown: number;
  /**
   * Ola 19 (aditivo, regla 8): false = centro de notificaciones apagado
   * total (`notify` no-op null, GET devuelve `[]`, el store NO borra).
   * Default true (yaml viejo sin la clave → true).
   */
  notificationsEnabled: boolean;
  /**
   * Ola 19 (aditivo, regla 8): false = sin toast OS nativo (el centro sigue
   * guardando; solo E2 lo consulta). Default true (yaml viejo → true).
   */
  osNotifications: boolean;
  /**
   * T2 triage on-demand (aditivo, regla 8): cuándo corre el Triage-agent.
   * - "auto" (default, yaml viejo sin la clave): el foreman decide primero
   *   con el issue completo; el triage-agent corre SOLO si el foreman dice
   *   needs_triage/needs_input (para formular preguntas). Un issue claro
   *   cuesta 1 llamada en vez de 2.
   * - "always": régimen anterior exacto (pre-triage siempre antes del foreman).
   * - "never": jamás corre el triage-agent (needs_triage parquea directo).
   */
  triageMode: TriageMode;
}

export type TriageMode = "auto" | "always" | "never";

export interface FactoryRunnersRef {
  default: string;
}

export interface FactoryCostRate {
  inputUSDper1M: number;
  outputUSDper1M: number;
}

export type FactoryCostRates = Record<string, FactoryCostRate>;

/** Defaults en código: espejo de las constantes actuales, usados si el yaml falta o es inválido. */
export const FACTORY_DEFAULTS: FactoryConfig = {
  ports: { factoryDefault: 17680, factoryMax: 17690 },
  timeouts: { verifyMs: 120000 },
  defaultModels: {
    foreman: "opencode-go/muse-spark-1.2-contributor",
    implement: "opencode-go/muse-spark-1.2-contributor",
    review: "auto-disjoint",
  },
  reviewerPairs: [
    { match: "muse-spark → big-pickle", reviewer: "opencode/big-pickle" },
    { match: "big-pickle → muse-spark", reviewer: "opencode-go/muse-spark-1.2-contributor" },
    { match: "anthropic/* → gpt-4o", reviewer: "openai/gpt-4o" },
    { match: "openai/* → anthropic", reviewer: "anthropic/claude-sonnet-4-20250514" },
  ],
  scorers: { samplingRate: 25 },
  runners: { default: "windows-local" },
  costTracking: true,
  costRates: {},
  ratesAsOf: null,
  ratesSource: null,
  agentSessions: true,
  reviewerReverify: true,
  improveProposalCooldown: 1,
  notificationsEnabled: true,
  osNotifications: true,
  triageMode: "auto",
};

function defaultsCopy(): FactoryConfig {
  return {
    ports: { ...FACTORY_DEFAULTS.ports },
    timeouts: { ...FACTORY_DEFAULTS.timeouts },
    defaultModels: { ...FACTORY_DEFAULTS.defaultModels },
    reviewerPairs: FACTORY_DEFAULTS.reviewerPairs.map((p) => ({ ...p })),
    scorers: { ...FACTORY_DEFAULTS.scorers },
    runners: { ...FACTORY_DEFAULTS.runners },
    costTracking: FACTORY_DEFAULTS.costTracking,
    costRates: {},
    ratesAsOf: null,
    ratesSource: null,
    agentSessions: FACTORY_DEFAULTS.agentSessions,
    reviewerReverify: FACTORY_DEFAULTS.reviewerReverify,
    improveProposalCooldown: FACTORY_DEFAULTS.improveProposalCooldown,
    notificationsEnabled: FACTORY_DEFAULTS.notificationsEnabled,
    osNotifications: FACTORY_DEFAULTS.osNotifications,
    triageMode: FACTORY_DEFAULTS.triageMode,
  };
}

function parseYamlInt(raw: string, field: string): number {
  const t = stripQuotes(raw).trim();
  if (!/^-?\d+$/.test(t)) throw new FactoryConfigError(`${field} debe ser entero ("${raw}")`);
  const n = Number(t);
  if (!Number.isInteger(n)) throw new FactoryConfigError(`${field} debe ser entero ("${raw}")`);
  return n;
}

function parseYamlString(raw: string, field: string): string {
  const t = stripQuotes(raw).trim();
  if (!t) throw new FactoryConfigError(`${field} no puede estar vacío`);
  return t;
}

/**
 * Parser mínimo y ESTRICTO solo para nuestro schema de factory.yaml
 * (ports/timeouts/defaultModels/reviewerPairs/scorers). Lanza
 * FactoryConfigError ante cualquier forma o valor inesperado.
 */
export function parseFactoryYaml(text: string): FactoryConfig {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new FactoryConfigError("archivo vacío");
  }
  const TOP = ["ports", "timeouts", "defaultModels", "reviewerPairs", "scorers", "runners", "costTracking", "costRates", "ratesAsOf", "ratesSource", "agentSessions", "reviewerReverify", "improveProposalCooldown", "notificationsEnabled", "osNotifications", "triageMode", "automations", "integrations"] as const;
  type Top = (typeof TOP)[number];
  // Secciones con schema estricto requerido (las 5 originales). Las 3 de Ola 15
  // (runners/costTracking/costRates) son OPCIONALES y aditivas: un yaml viejo
  // sin ellas sigue parseando y toma los defaults en código.
  const REQUIRED_TOP = ["ports", "timeouts", "defaultModels", "reviewerPairs", "scorers"] as const;
  const NESTED: Record<string, string[]> = {
    ports: ["factoryDefault", "factoryMax"],
    timeouts: ["verifyMs"],
    defaultModels: ["foreman", "implement", "review"],
    scorers: ["samplingRate"],
    runners: ["default"],
  };

  const scalars: Record<string, Record<string, string>> = {
    ports: {},
    timeouts: {},
    defaultModels: {},
    scorers: {},
    runners: {},
  };
  const pairs: Array<Record<string, string>> = [];
  // Ola 15: estado del parseo tolerante de costTracking/costRates.
  // Ola 16: `agentSessions` sigue el mismo patrón (escalar opcional).
  // Ola 17: `reviewerReverify` idem (escalar opcional, default true).
  let costTracking = FACTORY_DEFAULTS.costTracking;
  let agentSessions = FACTORY_DEFAULTS.agentSessions;
  let reviewerReverify = FACTORY_DEFAULTS.reviewerReverify;
  // Ola 18 P1.4 (aditivo, mismo patrón): entero ≥0, default 1.
  let improveProposalCooldown = FACTORY_DEFAULTS.improveProposalCooldown;
  // Ola 19 (aditivo, mismo patrón): escalares opcionales, default true.
  let notificationsEnabled = FACTORY_DEFAULTS.notificationsEnabled;
  let osNotifications = FACTORY_DEFAULTS.osNotifications;
  // T2 triage on-demand (aditivo, mismo patrón): enum opcional, default auto.
  let triageMode: TriageMode = FACTORY_DEFAULTS.triageMode;
  const costRatesRaw: Record<string, Record<string, number>> = {};
  // FU-4 (aditivo, mismo patrón que costTracking): escalares opcionales.
  let ratesAsOf: string | null = null;
  let ratesSource: string | null = null;
  let currentRate: string | null = null;
  let section: Top | null = null;
  let currentPair: Record<string, string> | null = null;
  let seenTop = new Set<string>();

  const flushPair = (): void => {
    if (currentPair && Object.keys(currentPair).length > 0) {
      pairs.push(currentPair);
      currentPair = null;
    }
  };

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    if (line.trim().length === 0) continue;
    const trimmedAll = line.trim();
    if (trimmedAll.startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (indent === 0) {
      flushPair();
      currentPair = null;
      currentRate = null;
      if (!trimmed.endsWith(":")) {
        // Ola 15: únicos escalares top-level permitidos (el resto sigue
        // estricto: cualquier otra línea sin ":" final es error).
        const scalarIdx = trimmed.indexOf(":");
        if (scalarIdx > 0) {
          const sKey = trimmed.slice(0, scalarIdx).trim();
          const sVal = stripQuotes(trimmed.slice(scalarIdx + 1).trim());
          if (sKey === "costTracking") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (sVal !== "true" && sVal !== "false") {
              throw new FactoryConfigError(`costTracking debe ser true o false ("${trimmed}")`);
            }
            seenTop.add(sKey);
            costTracking = sVal === "true";
            section = null;
            continue;
          }
          // Ola 16 (aditivo, mismo patrón que costTracking): escalar opcional.
          if (sKey === "agentSessions") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (sVal !== "true" && sVal !== "false") {
              throw new FactoryConfigError(`agentSessions debe ser true o false ("${trimmed}")`);
            }
            seenTop.add(sKey);
            agentSessions = sVal === "true";
            section = null;
            continue;
          }
          // Ola 17 (aditivo, mismo patrón): escalar opcional, default true.
          if (sKey === "reviewerReverify") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (sVal !== "true" && sVal !== "false") {
              throw new FactoryConfigError(`reviewerReverify debe ser true o false ("${trimmed}")`);
            }
            seenTop.add(sKey);
            reviewerReverify = sVal === "true";
            section = null;
            continue;
          }
          // Ola 18 P1.4 (aditivo, mismo patrón): escalar opcional, default 1.
          // 0 = auto-propose apagado (Regla 8, estilo `samplingRate: 0`).
          if (sKey === "improveProposalCooldown") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (!/^\d+$/.test(sVal)) {
              throw new FactoryConfigError(`improveProposalCooldown debe ser entero ≥ 0 ("${trimmed}")`);
            }
            seenTop.add(sKey);
            improveProposalCooldown = Math.min(Number(sVal), 100);
            section = null;
            continue;
          }
          // Ola 19 (aditivo, mismo patrón): escalares opcionales, default true.
          if (sKey === "notificationsEnabled") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (sVal !== "true" && sVal !== "false") {
              throw new FactoryConfigError(`notificationsEnabled debe ser true o false ("${trimmed}")`);
            }
            seenTop.add(sKey);
            notificationsEnabled = sVal === "true";
            section = null;
            continue;
          }
          if (sKey === "osNotifications") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (sVal !== "true" && sVal !== "false") {
              throw new FactoryConfigError(`osNotifications debe ser true o false ("${trimmed}")`);
            }
            seenTop.add(sKey);
            osNotifications = sVal === "true";
            section = null;
            continue;
          }
          // T2 triage on-demand (aditivo, mismo patrón): enum auto|always|never.
          if (sKey === "triageMode") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (sVal !== "auto" && sVal !== "always" && sVal !== "never") {
              throw new FactoryConfigError(`triageMode debe ser auto, always o never ("${trimmed}")`);
            }
            seenTop.add(sKey);
            triageMode = sVal;
            section = null;
            continue;
          }
          if (sKey === "costRates" && sVal === "{}") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            seenTop.add(sKey);
            section = null;
            continue;
          }
          // FU-4 (aditivo, mismo patrón): fecha de vigencia YYYY-MM-DD.
          // Solo formato (regex de mes 01-12 y día 01-31; la validez de
          // calendario como feb-30 no se enforcea: es un sello humano,
          // no una fecha de cómputo). Malformada = error (fail-safe a
          // defaults en el caller, nunca fecha inventada).
          if (sKey === "ratesAsOf") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(sVal)) {
              throw new FactoryConfigError(`ratesAsOf debe ser fecha YYYY-MM-DD ("${trimmed}")`);
            }
            seenTop.add(sKey);
            ratesAsOf = sVal;
            section = null;
            continue;
          }
          // FU-4 (aditivo, mismo patrón): fuente documentada, nunca fetcheada.
          if (sKey === "ratesSource") {
            if (seenTop.has(sKey)) throw new FactoryConfigError(`clave duplicada "${sKey}"`);
            if (sVal.length === 0 || !(sVal.startsWith("https://") || sVal.startsWith("http://"))) {
              throw new FactoryConfigError(`ratesSource debe ser URL http(s) ("${trimmed}")`);
            }
            seenTop.add(sKey);
            ratesSource = sVal;
            section = null;
            continue;
          }
        }
        throw new FactoryConfigError(`línea de nivel superior inválida "${trimmed}"`);
      }
      const key = trimmed.slice(0, -1).trim();
      if (key === "costTracking") {
        throw new FactoryConfigError(`costTracking es escalar ("costTracking: true|false"), no sección`);
      }
      if (key === "agentSessions") {
        throw new FactoryConfigError(`agentSessions es escalar ("agentSessions: true|false"), no sección`);
      }
      if (key === "reviewerReverify") {
        throw new FactoryConfigError(`reviewerReverify es escalar ("reviewerReverify: true|false"), no sección`);
      }
      if (key === "improveProposalCooldown") {
        throw new FactoryConfigError(`improveProposalCooldown es escalar ("improveProposalCooldown: 1"), no sección`);
      }
      if (key === "notificationsEnabled") {
        throw new FactoryConfigError(`notificationsEnabled es escalar ("notificationsEnabled: true|false"), no sección`);
      }
      if (key === "osNotifications") {
        throw new FactoryConfigError(`osNotifications es escalar ("osNotifications: true|false"), no sección`);
      }
      if (key === "triageMode") {
        throw new FactoryConfigError(`triageMode es escalar ("triageMode: auto|always|never"), no sección`);
      }
      if (key === "ratesAsOf") {
        throw new FactoryConfigError(`ratesAsOf es escalar ('ratesAsOf: "YYYY-MM-DD"'), no sección`);
      }
      if (key === "ratesSource") {
        throw new FactoryConfigError(`ratesSource es escalar ('ratesSource: "https://..."'), no sección`);
      }
      if (!(TOP as readonly string[]).includes(key)) {
        throw new FactoryConfigError(`clave desconocida "${key}"`);
      }
      if (seenTop.has(key)) throw new FactoryConfigError(`clave duplicada "${key}"`);
      seenTop.add(key);
      section = key as Top;
      continue;
    }

    if (!section) throw new FactoryConfigError(`contenido fuera de sección "${trimmed}"`);

    // Wave 14 T01 (additive tolerance): automations/integrations bodies stay
    // opaque here; typed parsing plus validate rules land in T04 (Track B).
    if (section === "automations" || section === "integrations") continue;

    if (section === "reviewerPairs") {
      if (trimmed.startsWith("- ")) {
        flushPair();
        currentPair = {};
        const rest = trimmed.slice(2).trim();
        if (rest.length === 0) continue;
        const idx = rest.indexOf(":");
        if (idx <= 0) throw new FactoryConfigError(`entrada de reviewerPairs inválida "${trimmed}"`);
        const k = rest.slice(0, idx).trim();
        const v = rest.slice(idx + 1).trim();
        if (k !== "match" && k !== "reviewer") {
          throw new FactoryConfigError(`clave de reviewerPairs inválida "${k}"`);
        }
        currentPair[k] = stripQuotes(v);
        continue;
      }
      const idx = trimmed.indexOf(":");
      if (idx <= 0) throw new FactoryConfigError(`entrada de reviewerPairs inválida "${trimmed}"`);
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (k !== "match" && k !== "reviewer") {
        throw new FactoryConfigError(`clave de reviewerPairs inválida "${k}"`);
      }
      if (!currentPair) throw new FactoryConfigError(`"${k}" fuera de un item "-"`);
      if (currentPair[k] !== undefined) throw new FactoryConfigError(`clave duplicada "${k}" en reviewerPairs`);
      currentPair[k] = stripQuotes(v);
      continue;
    }

    // Ola 15: costRates anidado `"provider/modelo": {inputUSDper1M, outputUSDper1M}`.
    // Forma vacía (`costRates: {}`) se resuelve arriba como escalar.
    if (section === "costRates") {
      if (trimmed.startsWith("- ")) {
        throw new FactoryConfigError(`lista inesperada en "costRates"`);
      }
      if (indent === 2) {
        const idx = trimmed.indexOf(":");
        if (idx <= 0) throw new FactoryConfigError(`entrada de costRates inválida "${trimmed}"`);
        const rateName = stripQuotes(trimmed.slice(0, idx).trim());
        const rest = trimmed.slice(idx + 1).trim();
        if (!rateName) throw new FactoryConfigError(`nombre de tarifa vacío en costRates`);
        if (rest !== "") {
          throw new FactoryConfigError(`costRates."${rateName}" usa forma anidada (inputUSDper1M/outputUSDper1M), no inline`);
        }
        if (costRatesRaw[rateName] !== undefined) {
          throw new FactoryConfigError(`tarifa duplicada "${rateName}" en costRates`);
        }
        costRatesRaw[rateName] = {};
        currentRate = rateName;
        continue;
      }
      if (!currentRate) throw new FactoryConfigError(`"${trimmed}" fuera de una tarifa de costRates`);
      const idx = trimmed.indexOf(":");
      if (idx <= 0) throw new FactoryConfigError(`entrada de costRates inválida "${trimmed}"`);
      const field = trimmed.slice(0, idx).trim();
      const rawVal = stripQuotes(trimmed.slice(idx + 1).trim());
      if (field !== "inputUSDper1M" && field !== "outputUSDper1M") {
        throw new FactoryConfigError(`campo inválido "${field}" en costRates (solo inputUSDper1M|outputUSDper1M)`);
      }
      if (!/^\d+(\.\d+)?$/.test(rawVal)) {
        throw new FactoryConfigError(`costRates.${field} debe ser número ≥ 0 ("${rawVal}")`);
      }
      if (costRatesRaw[currentRate][field] !== undefined) {
        throw new FactoryConfigError(`campo duplicado "${field}" en costRates`);
      }
      costRatesRaw[currentRate][field] = Number(rawVal);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      throw new FactoryConfigError(`lista inesperada en "${section}"`);
    }
    const idx = trimmed.indexOf(":");
    if (idx <= 0) throw new FactoryConfigError(`línea inválida en "${section}": "${trimmed}"`);
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (!(NESTED[section] as string[]).includes(k)) {
      throw new FactoryConfigError(`clave inválida "${k}" en "${section}"`);
    }
    if (scalars[section][k] !== undefined) {
      throw new FactoryConfigError(`clave duplicada "${k}" en "${section}"`);
    }
    scalars[section][k] = v;
  }
  flushPair();

  for (const top of REQUIRED_TOP) {
    if (!seenTop.has(top)) throw new FactoryConfigError(`falta sección "${top}"`);
  }
  for (const [sec, keys] of Object.entries(NESTED)) {
    // Ola 15: las secciones nuevas (runners) son opcionales: sus claves solo
    // se exigen cuando la sección está presente. Las 5 originales siguen
    // estrictas (REQUIRED_TOP ya garantizó su presencia).
    if (!seenTop.has(sec)) continue;
    for (const k of keys) {
      if (scalars[sec][k] === undefined) throw new FactoryConfigError(`falta "${sec}.${k}"`);
    }
  }

  const factoryDefault = parseYamlInt(scalars.ports.factoryDefault, "ports.factoryDefault");
  const factoryMax = parseYamlInt(scalars.ports.factoryMax, "ports.factoryMax");
  if (factoryDefault < 1 || factoryDefault > 65535 || factoryMax < 1 || factoryMax > 65535) {
    throw new FactoryConfigError("ports fuera de rango 1-65535");
  }
  if (factoryDefault > factoryMax) {
    throw new FactoryConfigError("ports.factoryDefault no puede superar a ports.factoryMax");
  }

  const verifyMs = parseYamlInt(scalars.timeouts.verifyMs, "timeouts.verifyMs");
  if (verifyMs <= 0) throw new FactoryConfigError("timeouts.verifyMs debe ser positivo");

  const foreman = parseYamlString(scalars.defaultModels.foreman, "defaultModels.foreman");
  const implement = parseYamlString(scalars.defaultModels.implement, "defaultModels.implement");
  const review = parseYamlString(scalars.defaultModels.review, "defaultModels.review");

  if (pairs.length === 0) throw new FactoryConfigError("reviewerPairs vacío");
  const reviewerPairs: ReviewerPair[] = pairs.map((p, i) => {
    const match = (p.match ?? "").trim();
    const reviewer = (p.reviewer ?? "").trim();
    if (!match) throw new FactoryConfigError(`reviewerPairs[${i}].match vacío`);
    if (!reviewer) throw new FactoryConfigError(`reviewerPairs[${i}].reviewer vacío`);
    const slash = reviewer.indexOf("/");
    if (slash <= 0 || slash >= reviewer.length - 1) {
      throw new FactoryConfigError(`reviewerPairs[${i}].reviewer debe ser "provider/model"`);
    }
    return { match, reviewer };
  });

  const samplingRate = parseYamlInt(scalars.scorers.samplingRate, "scorers.samplingRate");
  if (samplingRate < 0 || samplingRate > 100) {
    throw new FactoryConfigError("scorers.samplingRate debe estar en 0-100");
  }

  // Ola 15 (opcionales, aditivos): runners.default, costTracking, costRates.
  // Ausentes = defaults en código; presentes pero malformados = error (el
  // caller cae a defaults con warn, como el resto del archivo).
  let runnersDefault = FACTORY_DEFAULTS.runners.default;
  if (seenTop.has("runners")) {
    runnersDefault = parseYamlString(scalars.runners.default ?? "", "runners.default");
  }
  const costRates: FactoryCostRates = {};
  if (seenTop.has("costRates")) {
    for (const [rateName, fields] of Object.entries(costRatesRaw)) {
      const input = fields.inputUSDper1M;
      const output = fields.outputUSDper1M;
      if (input === undefined || output === undefined) {
        throw new FactoryConfigError(`costRates."${rateName}" requiere inputUSDper1M y outputUSDper1M`);
      }
      costRates[rateName] = { inputUSDper1M: input, outputUSDper1M: output };
    }
  }

  return {
    ports: { factoryDefault, factoryMax },
    timeouts: { verifyMs },
    defaultModels: { foreman, implement, review },
    reviewerPairs,
    scorers: { samplingRate },
    runners: { default: runnersDefault },
    costTracking,
    costRates,
    ratesAsOf,
    ratesSource,
    agentSessions,
    reviewerReverify,
    improveProposalCooldown,
    notificationsEnabled,
    osNotifications,
    triageMode,
  };
}

// ── Acceso con cache + fallback a defaults ──

let cachedConfig: FactoryConfig | null = null;

/**
 * Devuelve la config efectiva de factory.yaml con cache en memoria.
 * Si el archivo falta o es inválido, avisa y devuelve los defaults en código.
 * Nunca lanza.
 */
export function getFactoryConfig(): FactoryConfig {
  try {
    if (cachedConfig) return cachedConfig;
    let text: string | null = null;
    try {
      const filePath = resolveFactoryYamlPath();
      if (!fs.existsSync(filePath)) {
        console.warn("[agentLoader] factory.yaml ausente, uso defaults en código");
        cachedConfig = defaultsCopy();
        return cachedConfig;
      }
      text = fs.readFileSync(filePath, "utf-8");
    } catch (e) {
      console.warn(`[agentLoader] no se pudo leer factory.yaml, uso defaults: ${e instanceof Error ? e.message : String(e)}`);
      cachedConfig = defaultsCopy();
      return cachedConfig;
    }
    try {
      cachedConfig = parseFactoryYaml(text);
      return cachedConfig;
    } catch (e) {
      console.warn(`[agentLoader] factory.yaml inválido, uso defaults: ${e instanceof Error ? e.message : String(e)}`);
      cachedConfig = defaultsCopy();
      return cachedConfig;
    }
  } catch {
    cachedConfig = defaultsCopy();
    return cachedConfig;
  }
}

/** Limpia el cache en memoria (para tests). */
export function resetFactoryConfigCache(): void {
  cachedConfig = null;
}

/**
 * Revisión global de definiciones de agentes: la bumpea CADA escritura real
 * (create/edit/delete vía agentFileRoutes). Los cachés derivados (p. ej. el
 * roster de hooks en agentHooks) la comparan para invalidarse al instante
 * sin depender del mtime del directorio — editar el `stage` de un agent.md
 * existente no cambia el mtime del padre y dejaba el roster viejo.
 * En memoria, nunca lanza.
 */
let agentDefsRevision = 0;

/** Bump tras una escritura de agentes (best-effort, nunca lanza). */
export function bumpAgentDefsRevision(): void {
  try {
    agentDefsRevision += 1;
  } catch {
    // noop
  }
}

/** Lectura de la revisión vigente (0 = proceso recién arrancado). */
export function getAgentDefsRevision(): number {
  try {
    return agentDefsRevision;
  } catch {
    return 0;
  }
}

// ── Consumidores efectivos de config (Ola 8: cableado yaml + carry-over) ──

export interface EffectiveTimeouts {
  verifyMs: number;
}

export interface EffectiveDefaultModels {
  /** Modelo builder/implement efectivo en forma "provider/model". */
  builder: string;
  /** Modelo foreman efectivo en forma "provider/model". */
  foreman: string;
}

function pickPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return fallback;
}

function pickNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return fallback;
}

/**
 * Coerción pura por campo: cualquier valor ausente o inválido cae a su
 * default en código (espejo de las constantes actuales). Nunca lanza.
 */
export function coerceTimeouts(raw: unknown): EffectiveTimeouts {
  const d = FACTORY_DEFAULTS.timeouts;
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    verifyMs: pickPositiveInt(o.verifyMs, d.verifyMs),
  };
}

/**
 * Coerción pura por campo para modelos default. `builder` es el alias
 * efectivo de `defaultModels.implement`. Nunca lanza.
 */
export function coerceDefaultModels(raw: unknown): EffectiveDefaultModels {
  const d = FACTORY_DEFAULTS.defaultModels;
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    builder: pickNonEmptyString(o.implement, d.implement),
    foreman: pickNonEmptyString(o.foreman, d.foreman),
  };
}

/**
 * Timeouts efectivos: yaml cuando válido, constantes cuando no.
 * Nunca lanza (usa el cache+fallback de getFactoryConfig).
 */
export function getTimeouts(): EffectiveTimeouts {
  try {
    return coerceTimeouts(getFactoryConfig()?.timeouts);
  } catch {
    return { ...FACTORY_DEFAULTS.timeouts };
  }
}

/**
 * Modelos default efectivos: yaml cuando válido, constantes cuando no.
 * Nunca lanza.
 */
export function getDefaultModels(): EffectiveDefaultModels {
  try {
    return coerceDefaultModels(getFactoryConfig()?.defaultModels);
  } catch {
    return {
      builder: FACTORY_DEFAULTS.defaultModels.implement,
      foreman: FACTORY_DEFAULTS.defaultModels.foreman,
    };
  }
}

export interface EffectivePorts {
  factoryDefault: number;
  factoryMax: number;
}

function pickPort(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) return value;
  return fallback;
}

/**
 * Puertos efectivos: yaml cuando válido, constantes cuando no.
 * Garantiza default <= max (si no, vuelve a defaults). Nunca lanza.
 */
export function getFactoryPorts(): EffectivePorts {
  try {
    const raw = (getFactoryConfig()?.ports ?? {}) as unknown as Record<string, unknown>;
    const d = FACTORY_DEFAULTS.ports;
    const factoryDefault = pickPort(raw.factoryDefault, d.factoryDefault);
    const factoryMax = pickPort(raw.factoryMax, d.factoryMax);
    if (factoryDefault > factoryMax) return { ...d };
    return { factoryDefault, factoryMax };
  } catch {
    return { ...FACTORY_DEFAULTS.ports };
  }
}

/**
 * Cooldown de auto-propose (Ola 18 P1.4): máx de propuestas `pending|ready`
 * abiertas por scorer. yaml cuando válido, 1 cuando no. 0 = apagado.
 * Nunca lanza (usa el cache+fallback de getFactoryConfig).
 */
export function getImproveProposalCooldown(): number {
  try {
    const raw = (getFactoryConfig() as unknown as Record<string, unknown>)
      ?.improveProposalCooldown;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
      return Math.min(raw, 100);
    }
    return FACTORY_DEFAULTS.improveProposalCooldown;
  } catch {
    return FACTORY_DEFAULTS.improveProposalCooldown;
  }
}

/**
 * Parsea un modelRef en forma "provider/model" a sus partes.
 * Devuelve null si la forma es inválida. Puro, nunca lanza.
 */
export function parseModelRef(ref: string): { providerID: string; modelID: string } | null {
  try {
    const s = String(ref ?? "").trim();
    const i = s.indexOf("/");
    if (i <= 0 || i >= s.length - 1) return null;
    const providerID = s.slice(0, i).trim();
    const modelID = s.slice(i + 1).trim();
    if (!providerID || !modelID) return null;
    return { providerID, modelID };
  } catch {
    return null;
  }
}

// ── Skills versionadas (Ola 10) ──
// Espeja el patrón de agentes (resolve/load + cache + reset, anti-traversal
// idéntico). Solo se AGREGA: nada de lo anterior se toca.

/** Tope por skill inyectada al prompt: 8KB con nota de truncado. */
export const SKILL_MAX_BYTES = 8 * 1024;

export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface SkillDef {
  name: string;
  frontmatter: SkillFrontmatter;
  body: string;
  /** True cuando el cuerpo se acortó al tope (ver nota al final del body). */
  truncated: boolean;
}

export interface ParsedSkillFile {
  frontmatter: SkillFrontmatter;
  body: string;
}

export class SkillParseError extends Error {
  constructor(message: string) {
    super(`skill parse error: ${message}`);
    this.name = "SkillParseError";
  }
}

/** Resuelve `factory/skills/<name>/SKILL.md` desde la raíz del repo. */
export function resolveSkillPath(name: string): string {
  return path.join(getRepoRoot(), "factory", "skills", name, "SKILL.md");
}

function parseSkillDescriptionLines(lines: string[], from: number): { value: string; next: number } {
  // Soporta `description: >-` multilínea (estilo fuente) uniendo las
  // líneas indentadas siguientes con espacio; si no hay `>-`, valor simple.
  const first = (lines[from] ?? "").trim();
  if (first !== ">-" && first !== ">" && first !== "|" && first !== "|-") {
    return { value: stripQuotes(lines[from] ?? ""), next: from };
  }
  const joiner = first === "|" || first === "|-" ? "\n" : " ";
  const parts: string[] = [];
  let i = from + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (line.startsWith(" ") || line.startsWith("\t")) {
      parts.push(line.trim());
    } else {
      break;
    }
  }
  return { value: parts.join(joiner).trim(), next: i - 1 };
}

/**
 * Parsea el texto de un `SKILL.md` en frontmatter + body.
 * Frontmatter plano `key: value` entre líneas `---` (con `description: >-`
 * multilínea opcional). Lanza SkillParseError si falta `name` o el cuerpo
 * está vacío. Puro.
 */
export function parseSkillFile(text: string): ParsedSkillFile {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new SkillParseError("archivo vacío");
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue;
    if (lines[i].trim() === "---") {
      start = i;
    }
    break;
  }
  if (start === -1) throw new SkillParseError("falta apertura de frontmatter `---`");
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new SkillParseError("falta cierre de frontmatter `---`");

  const raw: Record<string, string> = {};
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) throw new SkillParseError(`línea de frontmatter inválida "${line.trim()}"`);
    const key = line.slice(0, idx).trim();
    if (!key) throw new SkillParseError("clave de frontmatter vacía");
    if (key === "description") {
      // Valor simple tras los dos puntos, o bloque `>-`/`>`/`|`/`|-`
      // con las líneas indentadas siguientes plegadas.
      const afterColon = line.slice(idx + 1).trim();
      if (afterColon === ">-" || afterColon === ">" || afterColon === "|" || afterColon === "|-") {
        const rest = lines.slice(i + 1, end);
        const folded = parseSkillDescriptionLines([afterColon, ...rest], 0);
        raw[key] = folded.value;
        i += folded.next;
      } else {
        raw[key] = stripQuotes(afterColon);
      }
      continue;
    }
    raw[key] = stripQuotes(line.slice(idx + 1).trim());
  }

  const name = (raw.name ?? "").trim();
  if (!name) throw new SkillParseError("falta `name`");
  const description = (raw.description ?? "").trim();

  const frontmatter: SkillFrontmatter = { name, description };
  for (const [key, value] of Object.entries(raw)) {
    if (key === "name" || key === "description") continue;
    frontmatter[key] = value;
  }

  const body = lines.slice(end + 1).join("\n").trim();
  if (!body) throw new SkillParseError("cuerpo vacío tras el frontmatter");
  return { frontmatter, body };
}

/**
 * Acota un cuerpo de skill al tope con nota de truncado. Puro, nunca lanza.
 */
export function truncateSkillBody(body: string): { body: string; truncated: boolean } {
  try {
    const text = String(body ?? "");
    if (text.length <= SKILL_MAX_BYTES) return { body: text, truncated: false };
    return {
      body: `${text.slice(0, SKILL_MAX_BYTES)}\n\n[skill truncada a 8KB: se muestra el inicio, ver el archivo completo en factory/skills]`,
      truncated: true,
    };
  } catch {
    return { body: "", truncated: false };
  }
}

/**
 * Lee `factory/skills/<name>/SKILL.md` resuelto desde este módulo.
 * Anti-traversal idéntico al de agentes; cuerpo acotado a 8KB con nota.
 * Devuelve null si falta o es inválido — nunca lanza.
 */
export function loadSkill(name: string): SkillDef | null {
  try {
    if (typeof name !== "string" || !/^[a-z0-9-]+$/i.test(name.trim())) return null;
    const clean = name.trim();
    const filePath = resolveSkillPath(clean);
    let text: string;
    try {
      if (!fs.existsSync(filePath)) return null;
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
    try {
      const parsed = parseSkillFile(text);
      const capped = truncateSkillBody(parsed.body);
      return {
        name: clean,
        frontmatter: parsed.frontmatter,
        body: capped.body,
        truncated: capped.truncated,
      };
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

const skillCache = new Map<string, SkillDef | null>();

/**
 * Versión con cache en memoria de `loadSkill` (incluye nulls: una skill
 * faltante se recuerda como faltante hasta `resetSkillCache`). Nunca lanza.
 */
export function getSkillOrNull(name: string): SkillDef | null {
  try {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key) return null;
    if (skillCache.has(key)) return skillCache.get(key) ?? null;
    const loaded = loadSkill(key);
    skillCache.set(key, loaded);
    return loaded;
  } catch {
    return null;
  }
}

/** Limpia el cache de skills en memoria (para tests). */
export function resetSkillCache(): void {
  skillCache.clear();
}

// ── Runners honestos (Ola 15) ──
// Espeja el patrón de agentes/skills (resolve/load + parse puro + cache +
// reset, anti-traversal idéntico). Solo se AGREGA: nada de lo anterior se toca.
//
// Reglas:
// - `getRunner`/`getRunners` nunca lanzan: ante yaml ausente o inválido avisan
//   por consola y devuelven el fallback en código (o null si no hay fallback
//   conocido para ese nombre).
// - Validación con zod 4 (`z.object` + `superRefine`, sin `.refine` legacy):
//   `isolation` enum cerrado none|docker, `setupCommands` no vacía,
//   `vcpus`/`memoryGb` > 0, y `platform.dockerImage` exigido solo cuando
//   isolation es "docker" (windows-local honestamente no tiene imagen).

export const RUNNER_ISOLATION_MODES = ["none", "docker"] as const;

export type RunnerIsolation = (typeof RUNNER_ISOLATION_MODES)[number];

export interface RunnerInstanceShape {
  /** DOCUMENTAL en local: perfil declarado, no hardware reservado. */
  vcpus: number;
  /** DOCUMENTAL en local: perfil declarado, no hardware reservado. */
  memoryGb: number;
}

export interface RunnerPlatform {
  os: string;
  arch: string;
  /** Solo exigida cuando isolation es "docker". */
  dockerImage?: string;
}

export interface RunnerDefinition {
  name: string;
  description: string;
  setupCommands: string[];
  instanceShape: RunnerInstanceShape;
  isolation: RunnerIsolation;
  platform: RunnerPlatform;
}

export class RunnerParseError extends Error {
  constructor(message: string) {
    super(`runner parse error: ${message}`);
    this.name = "RunnerParseError";
  }
}

/** Fallbacks en código (forma de factory/runners/*.yaml), usados si el yaml falta o es inválido. */
export const LINUX_BUILD_RUNNER_FALLBACK: RunnerDefinition = {
  name: "linux-build",
  description:
    "Linux build runner (fallback en código OBSOLETO: no pretende ser verdad; " +
    "la imagen real vive en factory/runners/linux-build.yaml — sin imagen " +
    "embebida a propósito: degrada a local honesto hasta que el yaml vuelva)",
  setupCommands: ["corepack enable"],
  instanceShape: { vcpus: 4, memoryGb: 8 },
  isolation: "docker",
  // Sin dockerImage a propósito (cero hardcodeos): la imagen MANDA del yaml.
  // Con yaml ausente/roto el executor degrada a local (fail-open honesto)
  // en vez de prometer una imagen vieja como verdad.
  platform: { os: "linux", arch: "x86_64" },
};

export const WINDOWS_LOCAL_RUNNER_FALLBACK: RunnerDefinition = {
  name: "windows-local",
  description: "Windows local runner (fallback en código: sin aislamiento)",
  setupCommands: ["corepack enable"],
  instanceShape: { vcpus: 4, memoryGb: 8 },
  isolation: "none",
  platform: { os: "windows", arch: "x64" },
};

export const RUNNER_FALLBACKS: RunnerDefinition[] = [
  LINUX_BUILD_RUNNER_FALLBACK,
  WINDOWS_LOCAL_RUNNER_FALLBACK,
];

function cloneRunnerFallback(def: RunnerDefinition): RunnerDefinition {
  return {
    ...def,
    setupCommands: [...def.setupCommands],
    instanceShape: { ...def.instanceShape },
    platform: { ...def.platform },
  };
}

function runnerFallbackFor(name: string): RunnerDefinition | null {
  const key = name.trim().toLowerCase();
  for (const f of RUNNER_FALLBACKS) {
    if (f.name.toLowerCase() === key) return cloneRunnerFallback(f);
  }
  return null;
}

/** Resuelve `factory/runners/<name>.yaml` desde la raíz del repo. */
export function resolveRunnerFilePath(name: string): string {
  return path.join(getRepoRoot(), "factory", "runners", `${name.trim()}.yaml`);
}

/** Resuelve el directorio `factory/runners` desde la raíz del repo. */
export function resolveRunnersDir(): string {
  return path.join(getRepoRoot(), "factory", "runners");
}

function coerceRunnerNumber(raw: string): number | string {
  const t = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return raw;
}

/**
 * Parser mínimo para la forma conocida de factory/runners/*.yaml
 * (description/isolation escalares, setupCommands como lista "- ", e
 * instanceShape/platform como mapas de un nivel). Lanza RunnerParseError
 * ante cualquier forma inesperada. Puro.
 */
export function parseRunnerYaml(text: string): Record<string, unknown> {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new RunnerParseError("archivo vacío");
  }
  const KNOWN_TOP = ["description", "setupCommands", "instanceShape", "isolation", "platform"];
  const root: Record<string, unknown> = {};
  const nested: Record<string, Record<string, unknown>> = { instanceShape: {}, platform: {} };
  const commands: string[] = [];
  let section: "instanceShape" | "platform" | null = null;
  let listMode = false;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (trimmed.startsWith("- ")) {
      if (!listMode) throw new RunnerParseError(`lista fuera de setupCommands: "${trimmed}"`);
      commands.push(stripQuotes(trimmed.slice(2).trim()));
      continue;
    }

    const idx = trimmed.indexOf(":");
    if (idx <= 0) throw new RunnerParseError(`línea inválida "${trimmed}"`);
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();

    if (indent === 0) {
      section = null;
      listMode = false;
      if (!KNOWN_TOP.includes(key)) throw new RunnerParseError(`clave desconocida "${key}"`);
      if (value === "") {
        if (key === "setupCommands") {
          listMode = true;
          continue;
        }
        if (key === "instanceShape" || key === "platform") {
          section = key;
          continue;
        }
        throw new RunnerParseError(`"${key}" no puede estar vacío`);
      }
      if (key === "setupCommands" || key === "instanceShape" || key === "platform") {
        throw new RunnerParseError(`"${key}" usa forma anidada, no escalar`);
      }
      root[key] = stripQuotes(value);
      continue;
    }

    if (listMode) throw new RunnerParseError(`línea anidada inesperada en setupCommands: "${trimmed}"`);
    if (!section) throw new RunnerParseError(`contenido fuera de sección "${trimmed}"`);
    nested[section][key] = coerceRunnerNumber(stripQuotes(value));
  }

  root.setupCommands = commands;
  root.instanceShape = nested.instanceShape;
  root.platform = nested.platform;
  return root;
}

const RunnerDefinitionSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    setupCommands: z.array(z.string()),
    instanceShape: z.object({ vcpus: z.number(), memoryGb: z.number() }),
    isolation: z.string(),
    platform: z.object({
      os: z.string(),
      arch: z.string(),
      dockerImage: z.string().optional(),
    }),
  })
  .superRefine((d, ctx) => {
    const name = typeof d.name === "string" ? d.name.trim() : "";
    if (!name) {
      ctx.addIssue({ code: "custom", message: "name no puede estar vacío" });
    }
    const description = typeof d.description === "string" ? d.description.trim() : "";
    if (!description) {
      ctx.addIssue({ code: "custom", message: "description no puede estar vacía" });
    }
    if (!Array.isArray(d.setupCommands) || d.setupCommands.length === 0) {
      ctx.addIssue({ code: "custom", message: "setupCommands no puede estar vacía" });
    } else {
      d.setupCommands.forEach((cmd, i) => {
        if (typeof cmd !== "string" || cmd.trim().length === 0) {
          ctx.addIssue({ code: "custom", message: `setupCommands[${i}] no puede estar vacío` });
        }
      });
    }
    const vcpus = d.instanceShape?.vcpus;
    if (typeof vcpus !== "number" || !(vcpus > 0)) {
      ctx.addIssue({
        code: "custom",
        message: "instanceShape.vcpus debe ser número > 0",
        path: ["instanceShape", "vcpus"],
      });
    }
    const memoryGb = d.instanceShape?.memoryGb;
    if (typeof memoryGb !== "number" || !(memoryGb > 0)) {
      ctx.addIssue({
        code: "custom",
        message: "instanceShape.memoryGb debe ser número > 0",
        path: ["instanceShape", "memoryGb"],
      });
    }
    const isolation = typeof d.isolation === "string" ? d.isolation.trim() : "";
    if (isolation !== "none" && isolation !== "docker") {
      ctx.addIssue({
        code: "custom",
        message: `isolation debe ser "none" o "docker" (es "${d.isolation}")`,
        path: ["isolation"],
      });
    }
    const os = typeof d.platform?.os === "string" ? d.platform.os.trim() : "";
    if (!os) {
      ctx.addIssue({ code: "custom", message: "platform.os no puede estar vacío", path: ["platform", "os"] });
    }
    const arch = typeof d.platform?.arch === "string" ? d.platform.arch.trim() : "";
    if (!arch) {
      ctx.addIssue({ code: "custom", message: "platform.arch no puede estar vacío", path: ["platform", "arch"] });
    }
    if (isolation === "docker") {
      const image = typeof d.platform?.dockerImage === "string" ? d.platform.dockerImage.trim() : "";
      if (!image) {
        ctx.addIssue({
          code: "custom",
          message: 'platform.dockerImage requerido cuando isolation es "docker"',
          path: ["platform", "dockerImage"],
        });
      }
    }
  });

/**
 * Valida un objeto desconocido como RunnerDefinition (zod 4).
 * Lanza RunnerParseError si es inválido — el loader lo convierte en
 * fallback + warn, nunca lo propaga.
 */
export function validateRunnerDefinition(payload: unknown): RunnerDefinition {
  let parsed: z.infer<typeof RunnerDefinitionSchema>;
  try {
    parsed = RunnerDefinitionSchema.parse(payload);
  } catch (e) {
    throw new RunnerParseError(e instanceof Error ? e.message : String(e));
  }
  const isolation: RunnerIsolation = parsed.isolation.trim() === "docker" ? "docker" : "none";
  const dockerImage = typeof parsed.platform.dockerImage === "string" ? parsed.platform.dockerImage.trim() : "";
  return {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    setupCommands: parsed.setupCommands.map((s) => s.trim()),
    instanceShape: { vcpus: parsed.instanceShape.vcpus, memoryGb: parsed.instanceShape.memoryGb },
    isolation,
    platform: {
      os: parsed.platform.os.trim(),
      arch: parsed.platform.arch.trim(),
      ...(dockerImage ? { dockerImage } : {}),
    },
  };
}

/**
 * Parsea el texto de un `factory/runners/<name>.yaml` en RunnerDefinition.
 * Lanza RunnerParseError si la forma o los valores son inválidos. Puro.
 */
export function parseRunnerDefinition(text: string, name: string): RunnerDefinition {
  if (typeof name !== "string" || !/^[a-z0-9-]+$/i.test(name.trim())) {
    throw new RunnerParseError(`nombre de runner inválido "${name}"`);
  }
  const raw = parseRunnerYaml(text);
  raw.name = name.trim();
  return validateRunnerDefinition(raw);
}

/**
 * Lee `factory/runners/<name>.yaml` resuelto desde este módulo.
 * Devuelve null si falta o es inválido — nunca lanza.
 */
export function loadRunnerDef(name: string, runnersDir?: string): RunnerDefinition | null {
  try {
    if (typeof name !== "string" || !/^[a-z0-9-]+$/i.test(name.trim())) return null;
    const clean = name.trim();
    const dir = typeof runnersDir === "string" && runnersDir.length > 0 ? runnersDir : resolveRunnersDir();
    const filePath = path.join(dir, `${clean}.yaml`);
    let text: string;
    try {
      if (!fs.existsSync(filePath)) return null;
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
    try {
      return parseRunnerDefinition(text, clean);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

const runnerCache = new Map<string, RunnerDefinition | null>();

function runnerCacheKey(name: string, runnersDir?: string): string {
  const dir = typeof runnersDir === "string" && runnersDir.length > 0 ? runnersDir : resolveRunnersDir();
  return `${dir}::${name.trim().toLowerCase()}`;
}

/**
 * Devuelve el RunnerDefinition efectivo por nombre, con cache en memoria.
 * Si el yaml falta o es inválido y el nombre es conocido, avisa y devuelve
 * el fallback en código; si el nombre es desconocido, devuelve null.
 * Nunca lanza. `runnersDir` es seam documentado para tests.
 */
export function getRunner(name: string, runnersDir?: string): RunnerDefinition | null {
  try {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key) return null;
    const cacheKey = runnerCacheKey(key, runnersDir);
    if (runnerCache.has(cacheKey)) return runnerCache.get(cacheKey) ?? null;
    const loaded = loadRunnerDef(key, runnersDir);
    if (loaded) {
      runnerCache.set(cacheKey, loaded);
      return loaded;
    }
    const fallback = runnerFallbackFor(key);
    if (fallback) {
      console.warn(
        `[agentLoader] runner "${key}" ausente o inválido, uso fallback en código (isolation=${fallback.isolation})`,
      );
      runnerCache.set(cacheKey, fallback);
      return fallback;
    }
    runnerCache.set(cacheKey, null);
    return null;
  } catch {
    return null;
  }
}

/**
 * Devuelve todos los runners efectivos: los válidos de `factory/runners/`
 * más los fallbacks en código para los nombres conocidos que falten o sean
 * inválidos (con warn visible por cada uno). Nunca vacío, nunca lanza.
 */
export function getRunners(runnersDir?: string): RunnerDefinition[] {
  try {
    const dir = typeof runnersDir === "string" && runnersDir.length > 0 ? runnersDir : resolveRunnersDir();
    let files: string[] = [];
    try {
      if (fs.existsSync(dir)) {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"));
      }
    } catch (e) {
      console.warn(
        `[agentLoader] no se pudo leer factory/runners, uso fallbacks en código: ${e instanceof Error ? e.message : String(e)}`,
      );
      return RUNNER_FALLBACKS.map(cloneRunnerFallback);
    }
    const out: RunnerDefinition[] = [];
    for (const file of files) {
      const runnerName = file.slice(0, -".yaml".length);
      const def = getRunner(runnerName, dir);
      if (def) {
        if (!out.some((d) => d.name.toLowerCase() === def.name.toLowerCase())) out.push(def);
      } else {
        console.warn(`[agentLoader] runner "${runnerName}" inválido y sin fallback conocido, se omite`);
      }
    }
    for (const fallback of RUNNER_FALLBACKS) {
      if (!out.some((d) => d.name.toLowerCase() === fallback.name.toLowerCase())) {
        console.warn(
          `[agentLoader] runner "${fallback.name}" sin yaml válido, uso fallback en código (isolation=${fallback.isolation})`,
        );
        out.push(cloneRunnerFallback(fallback));
      }
    }
    return out;
  } catch {
    return RUNNER_FALLBACKS.map(cloneRunnerFallback);
  }
}

/** Limpia el cache de runners en memoria (para tests). */
export function resetRunnersCache(): void {
  runnerCache.clear();
}

// ── Wave 14 (C7: parsers live in their domains, the loader re-exports) ──
// Single-vocabulary re-export only (zero logic, zero new parsing): the
// trigger + integration schemas keep living in
// `automations/automationTypes.ts` and `integrations/integrationTypes.ts`
// (T01 contracts); `definitionValidate.ts` and consumers import the schemas
// from the domains (C6) or from here (same references, proved by identity).

export {
  AUTOMATION_EVENT_ID_MAX,
  AUTOMATION_NAME_MAX,
  AUTOMATION_TICK_DEFAULT_MS,
  AUTOMATIONS_MAX_ENTRIES,
  AUTOMATIONS_MAX_TRIGGERS,
  AutomationsSectionSchema,
  EventTriggerSchema,
  ScheduleTriggerSchema,
  TriggerRefSchema,
  TriggerSchema,
  TRIGGER_ACTION_ALLOWLIST,
  TRIGGER_EVENT_ALLOWLIST,
} from "./automations/automationTypes";
export type {
  AutomationFireRecord,
  AutomationsFileShape,
  TriggerRuntimeState,
} from "./automations/automationTypes";
export {
  INTEGRATION_BODY_MAX,
  INTEGRATION_MOCK_MAX,
  INTEGRATION_TITLE_MAX,
  IntegrationsSectionSchema,
  MockPostInputSchema,
} from "./integrations/integrationTypes";
export type {
  IntegrationAdapter,
  IntegrationsMockFileShape,
  MockPostRecord,
} from "./integrations/integrationTypes";
