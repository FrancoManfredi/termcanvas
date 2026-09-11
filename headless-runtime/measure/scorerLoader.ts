/**
 * ScorerLoader — Ola 11 Measure.
 * Loader puro para `factory/scorers/<name>/scorer.md` (definitions as code).
 * Espeja el patrón de `agentLoader` (resolve/load + cache + reset,
 * anti-traversal idéntico, cap de tamaño): módulo nuevo, agentLoader intacto.
 *
 * Formato:
 * ```markdown
 * ---
 * name: review-formato-valido
 * description: <una línea>
 * agents: {review} | [review] | review (lista de agentes que juzga;
 *   vocabulario CERRADO: implement|review|verification|triage|spec|foreman)
 * labels: [{"value":"valido","score":1},{"value":"infra-formato","score":0}]
 *   (o mapa corto `{valido:1, infra-formato:0}`)
 * passingScore: 0.5
 * samplingRate: 25
 * model: provider/model (juez LLM)
 * selfImprovement: false
 * ---
 * # <Nombre>
 * <instrucciones del juez: 1 pregunta + cómo decidir cada label>
 * ```
 *
 * Reglas:
 * - `loadScorer`/`listScorers` nunca lanzan: null/[] si falta o es inválido.
 * - `parseScorerFile` sí lanza `ScorerParseError` (para tests de corruptos).
 * - `parseModelRef` se reutiliza por import desde agentLoader (no duplicado).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCORER_AGENT_ROLES,
  validateScorerDefinition,
  type ScorerDefinition,
  type ScorerLabel,
} from "../../shared/types/scorer";

export type { ScorerDefinition, ScorerLabel };

/** Archivo de scorer mayor a esto se considera inválido (nunca lanza: null). */
export const SCORER_MAX_FILE_BYTES = 64 * 1024;
/** Cuerpo (instrucciones del juez) mayor a esto se trunca con nota (espejo skills). */
export const SCORER_MAX_BODY_BYTES = 16 * 1024;

export interface LoadedScorer {
  /** Nombre canónico = directorio en `factory/scorers/<name>/`. */
  name: string;
  definition: ScorerDefinition;
  /** Instrucciones del juez (body del md, acotado con nota si se truncó). */
  instructions: string;
  /** True cuando las instrucciones se acortaron al tope. */
  truncated: boolean;
}

export interface ParsedScorerFile {
  definition: ScorerDefinition;
  instructions: string;
  truncated: boolean;
}

export class ScorerParseError extends Error {
  constructor(message: string) {
    super(`scorer parse error: ${message}`);
    this.name = "ScorerParseError";
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

/** Resuelve `factory/scorers/<name>/scorer.md` desde la raíz del repo. */
export function resolveScorerFilePath(name: string): string {
  return path.join(getRepoRoot(), "factory", "scorers", name, "scorer.md");
}

/** Resuelve el directorio `factory/scorers/` (para listados). */
export function resolveScorersDir(): string {
  return path.join(getRepoRoot(), "factory", "scorers");
}

// ── Parser mínimo de frontmatter plano ──

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

function parseAgentsValue(raw: string, fileRef = ""): string[] {
  const where = fileRef ? ` en ${fileRef}` : "";
  const t = raw.trim();
  if (t.length === 0) throw new ScorerParseError(`\`agents\` vacío${where}: se requiere ≥1 rol de ${SCORER_AGENT_ROLES.join("|")}`);
  // JSON array: ["implement","review"]
  if (t.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch (e) {
      throw new ScorerParseError(
        `\`agents\` JSON inválido: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new ScorerParseError(`\`agents\` debe ser una lista no vacía${where}`);
    }
    return parsed.map((entry, i) => {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw new ScorerParseError(`\`agents\`[${i}] debe ser un string no vacío${where}`);
      }
      return entry.trim();
    });
  }
  // `{a,b}` estilo agent.md, o lista separada por comas, o valor único.
  let inner = t;
  if (inner.startsWith("{") && inner.endsWith("}")) {
    inner = inner.slice(1, -1);
  }
  const parts = inner
    .split(",")
    .map((s) => stripQuotes(s.trim()))
    .filter((s) => s.length > 0);
  if (parts.length === 0) throw new ScorerParseError(`\`agents\` vacío${where}: se requiere ≥1 rol de ${SCORER_AGENT_ROLES.join("|")}`);
  return parts;
}

function parseLabelsValue(raw: string): ScorerLabel[] {
  const t = raw.trim();
  if (t.length === 0) throw new ScorerParseError("`labels` vacío");
  // JSON array: [{"value":"x","score":1,"description?":"..."}]
  if (t.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch (e) {
      throw new ScorerParseError(
        `\`labels\` JSON inválido: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new ScorerParseError("`labels` debe ser un array no vacío");
    }
    return parsed.map((entry, i) => {
      if (!entry || typeof entry !== "object") {
        throw new ScorerParseError(`\`labels\`[${i}] debe ser un objeto`);
      }
      const rec = entry as Record<string, unknown>;
      const value = typeof rec.value === "string" ? rec.value.trim() : "";
      if (!value) throw new ScorerParseError(`\`labels\`[${i}].value vacío`);
      const scoreRaw = rec.score;
      const score =
        typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw);
      if (typeof score !== "number" || !Number.isFinite(score)) {
        throw new ScorerParseError(`\`labels\`[${i}].score debe ser numérico`);
      }
      const descriptionRaw = rec.description;
      const description =
        typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
          ? descriptionRaw.trim().slice(0, 500)
          : undefined;
      return description !== undefined
        ? { value, score, description }
        : { value, score };
    });
  }
  // Mapa corto: {valido:1, infra-formato:0}
  if (t.startsWith("{") && t.endsWith("}")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) throw new ScorerParseError("`labels` vacío");
    const labels = inner.split(",").map((tok) => {
      const idx = tok.indexOf(":");
      if (idx <= 0) {
        throw new ScorerParseError(`label inválido "${tok.trim()}" (forma value:score)`);
      }
      const value = stripQuotes(tok.slice(0, idx).trim());
      const score = Number(stripQuotes(tok.slice(idx + 1).trim()));
      if (!value) throw new ScorerParseError("label con value vacío");
      if (!Number.isFinite(score)) {
        throw new ScorerParseError(`label "${value}" con score no numérico`);
      }
      return { value, score };
    });
    if (labels.length === 0) throw new ScorerParseError("`labels` vacío");
    return labels;
  }
  throw new ScorerParseError(
    "`labels` debe ser JSON array o mapa {label:score}",
  );
}

function parseBooleanValue(raw: string, field: string): boolean {
  const t = stripQuotes(raw).trim().toLowerCase();
  if (t === "true") return true;
  if (t === "false") return false;
  throw new ScorerParseError(`\`${field}\` debe ser true/false ("${raw}")`);
}

/**
 * Parsea el texto de un `scorer.md` en definición validada + instrucciones.
 * `fallbackName` es el nombre del directorio (canónico): si el frontmatter
 * trae `name` distinto, el archivo es inválido. Lanza ScorerParseError o
 * error de validación zod/invariante.
 */
export function parseScorerFile(
  text: string,
  fallbackName?: string,
): ParsedScorerFile {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new ScorerParseError("archivo vacío");
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
  if (start === -1) throw new ScorerParseError("falta apertura de frontmatter `---`");
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new ScorerParseError("falta cierre de frontmatter `---`");

  const raw: Record<string, string> = {};
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      throw new ScorerParseError(`línea de frontmatter inválida "${line.trim()}"`);
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) throw new ScorerParseError("clave de frontmatter vacía");
    raw[key] = value;
  }

  const dirName = typeof fallbackName === "string" ? fallbackName.trim() : "";
  const frontName = stripQuotes(raw.name ?? "").trim();
  if (frontName && dirName && frontName !== dirName) {
    throw new ScorerParseError(
      `\`name\` ("${frontName}") no coincide con el directorio ("${dirName}")`,
    );
  }
  const name = frontName || dirName;
  if (!name) throw new ScorerParseError("falta `name`");

  const description = stripQuotes(raw.description ?? "").trim();
  if (!description) throw new ScorerParseError("falta `description`");
  // Ola 18 P1.5: `agents` es vocabulario cerrado (ver SCORER_AGENT_ROLES).
  // Todo error nombra el archivo para que el humano lo arregle sin adivinar.
  const fileRef = `factory/scorers/${dirName || name || "?"}/scorer.md`;
  if (raw.agents === undefined) {
    throw new ScorerParseError(
      `falta \`agents\` en ${fileRef}: agregá \`agents: {review}\` con ≥1 rol de ${SCORER_AGENT_ROLES.join("|")}`,
    );
  }
  if (raw.labels === undefined) throw new ScorerParseError("falta `labels`");
  if (raw.passingScore === undefined) {
    throw new ScorerParseError("falta `passingScore`");
  }
  if (raw.samplingRate === undefined) {
    throw new ScorerParseError("falta `samplingRate`");
  }
  if (raw.model === undefined) throw new ScorerParseError("falta `model`");
  if (raw.selfImprovement === undefined) {
    throw new ScorerParseError(
      `falta \`selfImprovement\` en ${fileRef}: agregá \`selfImprovement: true\` o \`selfImprovement: false\``,
    );
  }

  const agents = parseAgentsValue(raw.agents, fileRef);
  for (let i = 0; i < agents.length; i++) {
    if (!(SCORER_AGENT_ROLES as readonly string[]).includes(agents[i])) {
      throw new ScorerParseError(
        `\`agents\`[${i}] rol desconocido "${agents[i]}" en ${fileRef} (roles válidos: ${SCORER_AGENT_ROLES.join("|")})`,
      );
    }
  }
  const labels = parseLabelsValue(raw.labels);
  const passingScore = Number(stripQuotes(raw.passingScore).trim());
  if (!Number.isFinite(passingScore)) {
    throw new ScorerParseError(`\`passingScore\` no numérico ("${raw.passingScore}")`);
  }
  const samplingRateRaw = stripQuotes(raw.samplingRate).trim();
  if (!/^-?\d+$/.test(samplingRateRaw)) {
    throw new ScorerParseError(`\`samplingRate\` debe ser entero ("${raw.samplingRate}")`);
  }
  const samplingRate = Number(samplingRateRaw);
  const model = stripQuotes(raw.model).trim();
  if (!model) throw new ScorerParseError("`model` vacío");
  const selfImprovement = parseBooleanValue(raw.selfImprovement, "selfImprovement");

  // La definición se valida con el contrato (zod + invariante de labels +
  // vocabulario cerrado de agents). El error nombra el archivo (accionable).
  let definition: ScorerDefinition;
  try {
    definition = validateScorerDefinition({
      name,
      description,
      agents,
      labels,
      passingScore,
      samplingRate,
      model,
      selfImprovement,
    });
  } catch (e) {
    throw new ScorerParseError(
      `${fileRef}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const bodyRaw = lines.slice(end + 1).join("\n").trim();
  if (!bodyRaw) throw new ScorerParseError("cuerpo vacío tras el frontmatter");
  let instructions = bodyRaw;
  let truncated = false;
  if (instructions.length > SCORER_MAX_BODY_BYTES) {
    instructions = `${instructions.slice(0, SCORER_MAX_BODY_BYTES)}\n\n[scorer truncado a 16KB: se muestra el inicio, ver el archivo completo en factory/scorers]`;
    truncated = true;
  }
  return { definition, instructions, truncated };
}

// ── Carga con cache (nunca lanza) ──

const scorerCache = new Map<string, LoadedScorer | null>();

/**
 * Lee `factory/scorers/<name>/scorer.md` resuelto desde este módulo.
 * Anti-traversal idéntico al de agentes/skills; archivo >64KB o inválido → null.
 * Devuelve null si falta o es inválido — nunca lanza.
 */
export function loadScorer(name: string): LoadedScorer | null {
  try {
    if (typeof name !== "string" || !/^[a-z0-9-]+$/i.test(name.trim())) {
      return null;
    }
    const clean = name.trim();
    if (scorerCache.has(clean)) return scorerCache.get(clean) ?? null;
    let loaded: LoadedScorer | null = null;
    try {
      const filePath = resolveScorerFilePath(clean);
      if (!fs.existsSync(filePath)) {
        scorerCache.set(clean, null);
        return null;
      }
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > SCORER_MAX_FILE_BYTES) {
          scorerCache.set(clean, null);
          return null;
        }
      } catch {
        scorerCache.set(clean, null);
        return null;
      }
      const text = fs.readFileSync(filePath, "utf-8");
      const parsed = parseScorerFile(text, clean);
      loaded = {
        name: clean,
        definition: parsed.definition,
        instructions: parsed.instructions,
        truncated: parsed.truncated,
      };
    } catch {
      loaded = null;
    }
    scorerCache.set(clean, loaded);
    return loaded;
  } catch {
    return null;
  }
}

/**
 * Lista todas las definiciones válidas en `factory/scorers/` ordenadas por
 * nombre. Las inválidas se omiten. Nunca lanza.
 */
export function listScorers(): ScorerDefinition[] {
  try {
    return listLoadedScorers().map((s) => s.definition);
  } catch {
    return [];
  }
}

/**
 * Lista los scorers cargados (definición + instrucciones del juez).
 * Nunca lanza.
 */
export function listLoadedScorers(): LoadedScorer[] {
  try {
    const dir = resolveScorersDir();
    let entries: string[] = [];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
    const out: LoadedScorer[] = [];
    for (const entry of entries) {
      try {
        const loaded = loadScorer(entry);
        if (loaded) out.push(loaded);
      } catch {
        // scorer inválido: se omite
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  } catch {
    return [];
  }
}

/** Limpia el cache en memoria (para tests). */
export function resetScorerCache(): void {
  scorerCache.clear();
}
